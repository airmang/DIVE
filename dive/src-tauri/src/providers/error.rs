#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("api error ({status}): {body}")]
    Api { status: u16, body: String },
    #[error("stream parse: {0}")]
    Stream(String),
    #[error("auth: {0}")]
    Auth(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
}
