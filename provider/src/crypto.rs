//! X25519 keypair + NaCl-compatible authenticated encryption.
//!
//! Wire format: `crypto_box::SalsaBox` (X25519 + XSalsa20-Poly1305),
//! 24-byte random nonce prefix followed by the tag+ciphertext. This
//! is the canonical NaCl `crypto_box` layout, picked so any
//! NaCl-compatible client library can encrypt prompts to a provider
//! without bespoke wire handling.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use crypto_box::{
    aead::{Aead, AeadCore, OsRng, Payload},
    PublicKey, SalsaBox, SecretKey,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("invalid key length")]
    BadKeyLength,
    #[error("decode: {0}")]
    Decode(#[from] base64::DecodeError),
    #[error("aead: {0}")]
    Aead(String),
    #[error("ciphertext truncated (need >=24-byte nonce + tag)")]
    Truncated,
}

const NONCE_LEN: usize = 24;

/// An X25519 keypair owned by the provider.
///
/// `crypto_box::SecretKey` zeroizes itself on drop internally; we don't
/// re-derive `ZeroizeOnDrop` here. We deliberately do **not** persist
/// the secret to disk in this module — that's the caller's choice (e.g.
/// derive deterministically from a Secure Enclave wrapper, or store in
/// the macOS keychain).
pub struct ProviderKeypair {
    secret: SecretKey,
    public: PublicKey,
}

impl ProviderKeypair {
    pub fn generate() -> Self {
        let secret = SecretKey::generate(&mut OsRng);
        let public = secret.public_key();
        Self { secret, public }
    }

    pub fn from_secret_bytes(bytes: &[u8]) -> Result<Self, CryptoError> {
        if bytes.len() != 32 {
            return Err(CryptoError::BadKeyLength);
        }
        let mut buf = [0u8; 32];
        buf.copy_from_slice(bytes);
        let secret = SecretKey::from(buf);
        let public = secret.public_key();
        Ok(Self { secret, public })
    }

    pub fn public_key_b64(&self) -> String {
        B64.encode(self.public.as_bytes())
    }

    pub fn public_key_bytes(&self) -> [u8; 32] {
        *self.public.as_bytes()
    }

    /// Decrypt a ciphertext produced by `seal_to`.
    pub fn open_from(
        &self,
        sender_pub_b64: &str,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        if ciphertext.len() <= NONCE_LEN {
            return Err(CryptoError::Truncated);
        }
        let sender_pub = decode_pub(sender_pub_b64)?;
        let salsabox = SalsaBox::new(&sender_pub, &self.secret);
        let (nonce, body) = ciphertext.split_at(NONCE_LEN);
        let plaintext = salsabox
            .decrypt(
                nonce.into(),
                Payload {
                    msg: body,
                    aad: &[],
                },
            )
            .map_err(|e| CryptoError::Aead(e.to_string()))?;
        Ok(plaintext)
    }

    /// Encrypt a plaintext to a recipient.
    pub fn seal_to(
        &self,
        recipient_pub_b64: &str,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        let recipient_pub = decode_pub(recipient_pub_b64)?;
        let salsabox = SalsaBox::new(&recipient_pub, &self.secret);
        let nonce = SalsaBox::generate_nonce(&mut OsRng);
        let body = salsabox
            .encrypt(
                &nonce,
                Payload {
                    msg: plaintext,
                    aad: &[],
                },
            )
            .map_err(|e| CryptoError::Aead(e.to_string()))?;
        let mut out = Vec::with_capacity(NONCE_LEN + body.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&body);
        Ok(out)
    }
}

fn decode_pub(b64: &str) -> Result<PublicKey, CryptoError> {
    let raw = B64.decode(b64)?;
    if raw.len() != 32 {
        return Err(CryptoError::BadKeyLength);
    }
    let mut buf = [0u8; 32];
    buf.copy_from_slice(&raw);
    Ok(PublicKey::from(buf))
}

/// Stable public-facing description of a provider's encryption key,
/// suitable for inclusion in `dev.cocore.compute.provider` records.
#[allow(non_snake_case)]
#[derive(Debug, Serialize, Deserialize)]
pub struct EncryptionKeyDescriptor {
    pub algorithm: String,
    pub publicKey: String,
}

impl EncryptionKeyDescriptor {
    pub fn x25519(public_key_b64: String) -> Self {
        Self {
            algorithm: "x25519-xsalsa20-poly1305".into(),
            publicKey: public_key_b64,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let alice = ProviderKeypair::generate();
        let bob = ProviderKeypair::generate();
        let msg = b"prompt with very secret content";
        let ct = alice.seal_to(&bob.public_key_b64(), msg).unwrap();
        let pt = bob.open_from(&alice.public_key_b64(), &ct).unwrap();
        assert_eq!(pt, msg);
    }

    #[test]
    fn truncated_ciphertext_errors() {
        let kp = ProviderKeypair::generate();
        let other = ProviderKeypair::generate();
        let err = kp
            .open_from(&other.public_key_b64(), &[0u8; 8])
            .unwrap_err();
        assert!(matches!(err, CryptoError::Truncated));
    }

    #[test]
    fn wrong_sender_key_errors() {
        let alice = ProviderKeypair::generate();
        let bob = ProviderKeypair::generate();
        let mallory = ProviderKeypair::generate();
        let ct = alice.seal_to(&bob.public_key_b64(), b"hi").unwrap();
        let err = bob.open_from(&mallory.public_key_b64(), &ct).unwrap_err();
        assert!(matches!(err, CryptoError::Aead(_)));
    }

    #[test]
    fn public_key_is_32_bytes() {
        let kp = ProviderKeypair::generate();
        assert_eq!(kp.public_key_bytes().len(), 32);
        let decoded = B64.decode(kp.public_key_b64()).unwrap();
        assert_eq!(decoded.len(), 32);
    }
}
