#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("keyring: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("invalid scope: {0}")]
    InvalidScope(String),
    #[error("backend unavailable: {0}")]
    BackendUnavailable(String),
}
