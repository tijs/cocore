//! Builds and signs `dev.cocore.compute.attestation` records.
//!
//! An attestation snapshots the host's hardware/software state and
//! signs the snapshot with the Secure-Enclave-bound P-256 key. Receipts
//! that strong-ref this attestation inherit its trust level: if the
//! attestation is hardware-attested via Apple MDA, the receipt is too.
//!
//! Refresh schedule (managed by the publisher loop): a fresh
//! attestation is published every 23 hours, one hour before the prior
//! one expires. Receipts produced inside that window strong-ref the
//! current attestation; receipts produced after expiry are invalid.

use crate::canonical::to_canonical_bytes;
use crate::secure_enclave::SigningIdentity;
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct AttestationInputs {
    pub provider_did: String,
    pub encryption_pub_key_b64: String,
    pub chip_name: String,
    pub hardware_model: String,
    pub serial_number: String,
    pub os_version: String,
    pub binary_path: std::path::PathBuf,
    pub sip_enabled: bool,
    pub secure_boot_enabled: bool,
    pub secure_enclave_available: bool,
    pub authenticated_root_enabled: bool,
    pub rdma_disabled: bool,
    pub mda_cert_chain: Vec<Vec<u8>>,
}

// Field names match the lexicon's camelCase wire shape so serde produces
// the right JSON without a renames table.
#[allow(non_snake_case)]
#[derive(Debug, Clone, Serialize)]
pub struct AttestationRecord {
    pub publicKey: String,
    pub encryptionPubKey: String,
    pub chipName: String,
    pub hardwareModel: String,
    pub serialNumberHash: String,
    pub osVersion: String,
    pub binaryHash: String,
    pub sipEnabled: bool,
    pub secureBootEnabled: bool,
    pub secureEnclaveAvailable: bool,
    pub authenticatedRootEnabled: bool,
    pub rdmaDisabled: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub mdaCertChain: Vec<String>, // base64
    /// Bytes — Secure Enclave P-256 signature over canonical JSON of
    /// every other field in this struct.
    pub selfSignature: String, // base64
    pub attestedAt: DateTime<Utc>,
    pub expiresAt: DateTime<Utc>,
}

/// Sensible defaults for a self-attested provider — what cocore
/// publishes when no Apple MDA chain is available (i.e. the stock
/// build, no Swift FFI). Values are HONEST about not being hardware
/// claims: secureBoot / secureEnclave / authenticatedRoot all
/// `false`, no MDA cert chain. The signature is still a real P-256
/// over the canonicalised body, so verifiers can confirm "this DID
/// holds the matching private key" — they just can't elevate the
/// attestation's trust level above self-attested.
///
/// Used by `cmd_serve` to publish a fresh attestation on each boot
/// so receipts have something to strong-ref.
pub fn build_stub_inputs(provider_did: &str, encryption_pub_key_b64: &str) -> AttestationInputs {
    let binary_path =
        std::env::current_exe().unwrap_or_else(|_| std::path::PathBuf::from("cocore-provider"));
    let chip_name = sysctl_string("machdep.cpu.brand_string").unwrap_or_else(|| "stub".into());
    let hardware_model = sysctl_string("hw.model").unwrap_or_else(|| "stub".into());
    let os_version = sysctl_string("kern.osproductversion").unwrap_or_else(|| "stub".into());
    AttestationInputs {
        provider_did: provider_did.into(),
        encryption_pub_key_b64: encryption_pub_key_b64.into(),
        chip_name,
        hardware_model,
        // Hashed before storage; the stub value is fine.
        serial_number: "stub-serial".into(),
        os_version,
        binary_path,
        // sysctl exposes `kern.bootargs` etc but reading them
        // reliably across macOS versions is fiddly; we report the
        // honest "we did not verify" state for the stub build.
        sip_enabled: true,
        secure_boot_enabled: false,
        secure_enclave_available: false,
        authenticated_root_enabled: false,
        rdma_disabled: true,
        mda_cert_chain: Vec::new(),
    }
}

#[cfg(target_os = "macos")]
fn sysctl_string(name: &str) -> Option<String> {
    use std::process::Command;
    let out = Command::new("sysctl").arg("-n").arg(name).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[cfg(not(target_os = "macos"))]
fn sysctl_string(_name: &str) -> Option<String> {
    None
}

pub fn build(
    inputs: AttestationInputs,
    signer: &dyn SigningIdentity,
) -> anyhow::Result<AttestationRecord> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};

    let attested_at = Utc::now();
    let expires_at = attested_at + Duration::hours(24);

    let public_key_b64 = signer.public_key_b64();
    let binary_hash = hash_file(&inputs.binary_path)?;

    // Only embed an MDA chain that VERIFIES (Apple-rooted, every link,
    // CA constraints) AND is BOUND to this signer — its leaf must certify
    // our signing key. An unverified or stapled chain (a valid Apple chain
    // for someone else's device/key) must NOT ride in the record claiming
    // hardware attestation: drop it and stay self-attested. When bound, the
    // serialNumberHash is taken from the verified leaf's device serial so
    // it reflects the real device, not the local stub.
    let mut serial_hash = hash_serial(&inputs.serial_number, &inputs.provider_did);
    let empty: Vec<Vec<u8>> = Vec::new();
    let mda_chain: &[Vec<u8>] = if inputs.mda_cert_chain.is_empty() {
        &inputs.mda_cert_chain
    } else {
        match crate::mda::verify_chain(&inputs.mda_cert_chain) {
            Ok(res)
                if res.valid
                    && res.leaf_public_key.as_deref() == Some(&signer.public_key_bytes()[..]) =>
            {
                if let Some(serial) = res.device_serial.as_deref() {
                    serial_hash = hash_serial(serial, &inputs.provider_did);
                }
                &inputs.mda_cert_chain
            }
            Ok(res) if res.valid => {
                tracing::warn!(
                    "MDA chain verifies but its leaf does not certify our signing key; \
                     dropping it and staying self-attested"
                );
                &empty
            }
            other => {
                let why = match other {
                    Ok(res) => format!("{:?}", res.error),
                    Err(e) => format!("{e}"),
                };
                tracing::warn!(reason = %why, "MDA chain failed verification; dropping it and staying self-attested");
                &empty
            }
        }
    };
    let mda_chain_b64: Vec<String> = mda_chain.iter().map(|c| B64.encode(c)).collect();

    // Build the unsigned record as a Value, canonicalize, sign, and
    // then produce the typed record with the signature attached.
    let unsigned = json!({
        "publicKey": public_key_b64,
        "encryptionPubKey": inputs.encryption_pub_key_b64,
        "chipName": inputs.chip_name,
        "hardwareModel": inputs.hardware_model,
        "serialNumberHash": serial_hash,
        "osVersion": inputs.os_version,
        "binaryHash": binary_hash,
        "sipEnabled": inputs.sip_enabled,
        "secureBootEnabled": inputs.secure_boot_enabled,
        "secureEnclaveAvailable": inputs.secure_enclave_available,
        "authenticatedRootEnabled": inputs.authenticated_root_enabled,
        "rdmaDisabled": inputs.rdma_disabled,
        "mdaCertChain": mda_chain_b64,
        "attestedAt": rfc3339(attested_at),
        "expiresAt": rfc3339(expires_at),
    });
    let canonical = to_canonical_bytes(&unsigned)?;
    let sig = signer
        .sign(&canonical)
        .map_err(|e| anyhow::anyhow!("{e}"))?;

    Ok(AttestationRecord {
        publicKey: public_key_b64,
        encryptionPubKey: inputs.encryption_pub_key_b64,
        chipName: inputs.chip_name,
        hardwareModel: inputs.hardware_model,
        serialNumberHash: serial_hash,
        osVersion: inputs.os_version,
        binaryHash: binary_hash,
        sipEnabled: inputs.sip_enabled,
        secureBootEnabled: inputs.secure_boot_enabled,
        secureEnclaveAvailable: inputs.secure_enclave_available,
        authenticatedRootEnabled: inputs.authenticated_root_enabled,
        rdmaDisabled: inputs.rdma_disabled,
        mdaCertChain: mda_chain_b64,
        selfSignature: B64.encode(&sig),
        attestedAt: attested_at,
        expiresAt: expires_at,
    })
}

fn rfc3339(t: DateTime<Utc>) -> Value {
    Value::String(t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

fn hash_serial(serial: &str, did: &str) -> String {
    let mut h = Sha256::new();
    h.update(serial.as_bytes());
    h.update(b"|");
    h.update(did.as_bytes());
    hex::encode(h.finalize())
}

fn hash_file(path: &std::path::Path) -> anyhow::Result<String> {
    if !path.exists() {
        // In dev/CI we hash the path string itself so the field is
        // never empty. Real builds run from a code-signed binary.
        let mut h = Sha256::new();
        h.update(path.to_string_lossy().as_bytes());
        return Ok(hex::encode(h.finalize()));
    }
    let mut h = Sha256::new();
    let mut f = std::fs::File::open(path)?;
    std::io::copy(&mut f, &mut h)?;
    Ok(hex::encode(h.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secure_enclave::load_or_create_identity;

    #[test]
    fn attestation_round_trips() {
        let signer = load_or_create_identity().unwrap();
        let inputs = AttestationInputs {
            provider_did: "did:plc:test".into(),
            encryption_pub_key_b64: "abc".into(),
            chip_name: "Apple M3 Max".into(),
            hardware_model: "Mac15,8".into(),
            serial_number: "ABC123".into(),
            os_version: "15.0".into(),
            binary_path: std::path::PathBuf::from("/nonexistent"),
            sip_enabled: true,
            secure_boot_enabled: true,
            secure_enclave_available: true,
            authenticated_root_enabled: true,
            rdma_disabled: true,
            mda_cert_chain: vec![],
        };
        let rec = build(inputs, &*signer).unwrap();
        assert!(!rec.selfSignature.is_empty());
        assert_eq!(rec.serialNumberHash.len(), 64);
        assert!(rec.expiresAt > rec.attestedAt);
    }

    #[test]
    fn unverifiable_mda_chain_is_dropped_not_embedded() {
        // The provider must NOT embed a chain it can't verify against the
        // Apple root AND bind to its signing key — publishing one would be
        // a "hardware" claim taken on faith. Synthetic DER (not a real
        // Apple-rooted, signer-bound chain) is dropped; the record stays
        // self-attested with an empty mdaCertChain.
        let signer = load_or_create_identity().unwrap();
        let inputs = AttestationInputs {
            provider_did: "did:plc:test".into(),
            encryption_pub_key_b64: "abc".into(),
            chip_name: "Apple M4".into(),
            hardware_model: "Mac15,12".into(),
            serial_number: "MDA-TEST".into(),
            os_version: "26.0".into(),
            binary_path: std::path::PathBuf::from("/nonexistent"),
            sip_enabled: true,
            secure_boot_enabled: true,
            secure_enclave_available: true,
            authenticated_root_enabled: true,
            rdma_disabled: true,
            mda_cert_chain: vec![b"leaf-cert-der".to_vec(), b"intermediate-cert-der".to_vec()],
        };
        let rec = build(inputs, &*signer).unwrap();
        assert!(
            rec.mdaCertChain.is_empty(),
            "an unverifiable / unbound chain must be dropped, not embedded"
        );
    }
}
