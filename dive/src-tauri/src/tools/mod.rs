//! Built-in tools.
//!
//! Spec §8.4 — `Tool` trait + `RiskLevel`. Four built-ins land here in task 2-3:
//! read_file, list_dir, write_file, edit_file. `bash`/`search_files` arrive later.

pub mod context;
pub mod edit_file;
pub mod fs_guard;
pub mod list_dir;
pub mod read_file;
pub mod registry;
pub mod write_file;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

pub use context::ToolContext;
pub use fs_guard::FsGuard;
pub use registry::ToolRegistry;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Safe,
    Warn,
    Danger,
}

impl RiskLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Safe => "safe",
            Self::Warn => "warn",
            Self::Danger => "danger",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolOutput {
    pub success: bool,
    pub summary: String,
    pub full: Value,
}

impl ToolOutput {
    pub fn success(summary: impl Into<String>, full: Value) -> Self {
        Self {
            success: true,
            summary: summary.into(),
            full,
        }
    }

    pub fn failure(summary: impl Into<String>, full: Value) -> Self {
        Self {
            success: false,
            summary: summary.into(),
            full,
        }
    }
}

#[derive(Debug, Error)]
pub enum ToolError {
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("path denied: {0}")]
    PathDenied(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("not found: {0}")]
    NotFound(String),
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn input_schema(&self) -> Value;
    fn risk_level(&self) -> RiskLevel;
    async fn run(&self, input: Value, ctx: &ToolContext) -> Result<ToolOutput, ToolError>;
}

/// One-line preview of tool arguments for UI (spec §5.3.1). Generic default
/// that extracts a single representative field; tools may override.
pub fn params_preview(tool_name: &str, args: &Value) -> String {
    match tool_name {
        "read_file" | "write_file" | "edit_file" => args
            .get("path")
            .and_then(|v| v.as_str())
            .map(|p| format!("path: \"{p}\""))
            .unwrap_or_else(|| args.to_string()),
        "list_dir" => args
            .get("path")
            .and_then(|v| v.as_str())
            .map(|p| format!("path: \"{p}\""))
            .unwrap_or_else(|| "path: \".\"".to_string()),
        _ => {
            let s = args.to_string();
            if s.len() > 80 {
                format!("{}...", &s[..77])
            } else {
                s
            }
        }
    }
}
