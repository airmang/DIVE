use thiserror::Error;

use crate::db::DbError;
use crate::providers::ProviderError;
use crate::tools::ToolError;

#[derive(Debug, Error)]
pub enum AgentError {
    #[error("provider: {0}")]
    Provider(#[from] ProviderError),
    #[error("db: {0}")]
    Db(#[from] DbError),
    #[error("tool: {0}")]
    Tool(#[from] ToolError),
    #[error("tool not found: {0}")]
    ToolNotFound(String),
    #[error("max iterations ({0}) exceeded")]
    MaxIterations(u32),
    #[error("cancelled")]
    Cancelled,
    #[error("invalid json in tool arguments: {0}")]
    ArgumentJson(serde_json::Error),
    #[error("internal: {0}")]
    Internal(String),
}
