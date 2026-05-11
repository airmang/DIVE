#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("http: {0}")]
    Http(reqwest::Error),
    #[error("network timeout: {0}")]
    Timeout(String),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("api error ({status}): {body}")]
    Api { status: u16, body: String },
    #[error("stream parse: {0}")]
    Stream(String),
    #[error("auth: {0}")]
    Auth(String),
    #[error("provider not configured")]
    NotConfigured,
    #[error("unsupported: {0}")]
    Unsupported(String),
}

impl From<reqwest::Error> for ProviderError {
    fn from(error: reqwest::Error) -> Self {
        if error.is_timeout() {
            Self::Timeout(
                "provider request timed out while waiting for the network; check the connection and retry"
                    .into(),
            )
        } else {
            Self::Http(error)
        }
    }
}
