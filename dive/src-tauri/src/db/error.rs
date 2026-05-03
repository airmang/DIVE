#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("migration failed at version {version}: {source}")]
    Migration {
        version: i64,
        source: rusqlite::Error,
    },
    #[error("invalid card state: {0}")]
    InvalidCardState(String),
}
