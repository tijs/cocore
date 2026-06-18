//! Cross-language signature parity fixture generator.
//!
//! Produces a JSON file under `target/cross-lang-fixture.json` that
//! the TypeScript test in `packages/sdk/src/p256.test.ts` reads to
//! verify Rust-produced ECDSA-P256 DER signatures with WebCrypto.
//!
//! ECDSA with the default RustCrypto signer is **non-deterministic**
//! (uses a random nonce). That's fine for the parity test — TS only
//! cares that the signature verifies for the published public key,
//! not that the bytes are pinned. We still emit the canonical bytes
//! that were signed so the TS side can re-canonicalise the receipt
//! and prove byte-equality at the same time.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use cocore_provider::canonical::to_canonical_bytes;
use cocore_provider::mda::{verify_chain_against, APPLE_ENTERPRISE_ATTESTATION_ROOT_CA_PEM};
use cocore_provider::receipt::{build, Money, ReceiptInputs, StrongRef};
use cocore_provider::secure_enclave::load_or_create_identity;
use rcgen::{
    BasicConstraints, CertificateParams, CustomExtension, DistinguishedName, DnType, IsCa, KeyPair,
    PKCS_ECDSA_P256_SHA256,
};
use serde_json::json;

#[test]
fn writes_cross_lang_fixture() {
    let signer = load_or_create_identity().unwrap();

    // A pinned input — same bytes the TS test expects to canonicalise.
    let inputs = ReceiptInputs {
        job: StrongRef {
            uri: "at://did:plc:requester/dev.cocore.compute.job/x".into(),
            cid: "bafyjob".into(),
        },
        requester: "did:plc:requester".into(),
        model: "llama-3.1-70b".into(),
        input_commitment: "a".repeat(64),
        output_commitment: "b".repeat(64),
        // New optional fields stay None here so the pinned canonical bytes
        // (and the cross-language golden fixture) are unchanged — both are
        // skip-serialized when absent.
        output_cipher_commitment: None,
        params: None,
        output_cipher_url: None,
        tokens_in: 32,
        tokens_out: 128,
        started_at: chrono::DateTime::parse_from_rfc3339("2026-05-07T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc),
        completed_at: chrono::DateTime::parse_from_rfc3339("2026-05-07T12:00:03Z")
            .unwrap()
            .with_timezone(&chrono::Utc),
        price: Money {
            amount: 12,
            currency: "USD".into(),
        },
        attestation: StrongRef {
            uri: "at://did:plc:provider/dev.cocore.compute.attestation/x".into(),
            cid: "bafyatt".into(),
        },
    };
    let (record, canonical) = build(inputs, &*signer).unwrap();

    // Self-test: round-trip the typed record through serde, strip the
    // signature, and prove the canonical bytes match what we signed.
    let mut body_value = serde_json::to_value(&record).unwrap();
    body_value
        .as_object_mut()
        .unwrap()
        .remove("enclaveSignature");
    let recanon = to_canonical_bytes(&body_value).unwrap();
    assert_eq!(
        recanon, canonical,
        "round-tripping the typed record must reproduce the signed bytes",
    );

    let fixture = json!({
        "publicKeyB64": signer.public_key_b64(),
        "isHardwareBound": signer.is_hardware_bound(),
        "canonicalB64": B64.encode(&canonical),
        "receipt": record,
    });

    let target = workspace_target_dir().join("cross-lang-fixture.json");
    std::fs::write(&target, serde_json::to_vec_pretty(&fixture).unwrap())
        .unwrap_or_else(|e| panic!("write {}: {e}", target.display()));
    eprintln!("wrote {}", target.display());
}

/// Generate an MDA cert chain fixture: a synthetic root + a single
/// leaf signed by it, with the Apple-defined OIDs encoded as
/// extensions. The TS test verifies this exactly the same way
/// `verify_chain_against` does in Rust — same root bytes, same chain
/// bytes — proving cross-language parity on the cert path too.
#[test]
fn writes_mda_cross_lang_fixture() {
    let now = time::OffsetDateTime::now_utc();
    let nb = now - time::Duration::HOUR;
    let na = now + time::Duration::days(365 * 2);

    // Root.
    let mut root_params = CertificateParams::new(vec!["cocore MDA Test Root".into()]).unwrap();
    let mut root_dn = DistinguishedName::new();
    root_dn.push(DnType::CommonName, "cocore MDA Test Root");
    root_params.distinguished_name = root_dn;
    root_params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    root_params.not_before = nb;
    root_params.not_after = na;
    let root_key = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).unwrap();
    let root_cert = root_params.self_signed(&root_key).unwrap();

    // Leaf.
    let mut leaf_params = CertificateParams::new(vec!["mda-cross-lang-device".into()]).unwrap();
    let mut leaf_dn = DistinguishedName::new();
    leaf_dn.push(DnType::CommonName, "mda-cross-lang-device");
    leaf_dn.push(
        DnType::CustomDnType(vec![2, 5, 4, 5]), // X.500 serialNumber
        "C02CROSSLANG",
    );
    leaf_params.distinguished_name = leaf_dn;
    leaf_params.is_ca = IsCa::NoCa;
    leaf_params.not_before = nb;
    leaf_params.not_after = na;
    let mut sip = CustomExtension::from_oid_content(
        &[1, 2, 840, 113635, 100, 8, 13, 1],
        vec![0x01, 0x01, 0xff],
    );
    sip.set_criticality(false);
    leaf_params.custom_extensions.push(sip);
    let mut udid = CustomExtension::from_oid_content(&[1, 2, 840, 113635, 100, 8, 9, 2], {
        let s = "UDID-CROSSLANG";
        let mut o = vec![0x0c, s.len() as u8];
        o.extend_from_slice(s.as_bytes());
        o
    });
    udid.set_criticality(false);
    leaf_params.custom_extensions.push(udid);
    let leaf_key = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).unwrap();
    let leaf_cert = leaf_params
        .signed_by(&leaf_key, &root_cert, &root_key)
        .unwrap();

    let root_der = root_cert.der().to_vec();
    let chain_der = vec![leaf_cert.der().to_vec()];

    // Self-test: prove the Rust verifier accepts what we just built
    // before we ask the TS verifier to do the same.
    let now_chrono = chrono::Utc::now();
    let result = verify_chain_against(&chain_der, &root_der, &now_chrono).unwrap();
    assert!(result.valid, "Rust must verify its own fixture");
    assert_eq!(result.device_serial.as_deref(), Some("C02CROSSLANG"));

    // Also include the Apple Root PEM so the TS test can prove the
    // wrong-root path works (synthetic chain MUST NOT verify against
    // the real Apple root).
    let fixture = json!({
        "rootDerB64": B64.encode(&root_der),
        "chainDerB64": chain_der.iter().map(|d| B64.encode(d)).collect::<Vec<_>>(),
        "appleRootPem": APPLE_ENTERPRISE_ATTESTATION_ROOT_CA_PEM,
        "expected": {
            "valid": true,
            "deviceSerial": "C02CROSSLANG",
            "deviceUdid": "UDID-CROSSLANG",
            "sipEnabled": true,
        },
    });
    let path = workspace_target_dir().join("mda-cross-lang-fixture.json");
    std::fs::write(&path, serde_json::to_vec_pretty(&fixture).unwrap())
        .unwrap_or_else(|e| panic!("write {}: {e}", path.display()));
    eprintln!("wrote {}", path.display());
}

fn workspace_target_dir() -> std::path::PathBuf {
    // CARGO_TARGET_DIR or <workspace>/target. We want a stable path
    // under the workspace root so the TS test can find the fixture
    // regardless of which crate's target dir cargo was using.
    let workspace = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .to_path_buf();
    let dir = workspace.join("target");
    std::fs::create_dir_all(&dir).ok();
    dir
}
