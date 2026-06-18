use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("not authenticated; run `cocore agent pair` first")]
    NotAuthenticated,
    #[error("attestation expired or absent; run `cocore agent attest`")]
    AttestationStale,
    #[error("advisor: {0}")]
    Advisor(String),
    #[error("pds: {0}")]
    Pds(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("crypto: {0}")]
    Crypto(#[from] crate::crypto::CryptoError),
    #[error("canonical: {0}")]
    Canonical(#[from] crate::canonical::CanonicalError),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

pub type Result<T> = std::result::Result<T, ProviderError>;
