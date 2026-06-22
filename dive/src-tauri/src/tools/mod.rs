//! Built-in tools.
//!
//! Spec §8.4 — `Tool` trait + `RiskLevel`. Four built-ins land here in task 2-3:
//! read_file, list_dir, write_file, edit_file. `search_files` arrives later.

pub mod context;
pub mod delete_file;
pub mod edit_file;
pub mod fs_guard;
pub mod guard;
pub mod list_dir;
pub mod mkdir;
pub mod read_file;
pub mod registry;
pub mod run_process;
pub mod runtime;
pub mod search_files;
pub mod terminal_script;
pub mod write_file;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

pub use context::ToolContext;
pub use fs_guard::FsGuard;
pub use guard::{classify_bash_command, BlockReason};
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
    #[error("blocked: {} ({})", .0.rule, .0.pattern)]
    Blocked(BlockReason),
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
    /// Spec §9.2. Cheap pre-flight check run before permission prompt.
    /// Blocks destructive patterns even if the user later clicks approve.
    /// Default = always allow; danger tools override to enforce the blocklist.
    fn validate(&self, _input: &Value) -> Result<(), ToolError> {
        Ok(())
    }
    async fn run(&self, input: Value, ctx: &ToolContext) -> Result<ToolOutput, ToolError>;
}

/// One-line preview of tool arguments for UI (spec §5.3.1). Generic default
/// that extracts a single representative field; tools may override.
pub fn params_preview(tool_name: &str, args: &Value) -> String {
    match tool_name {
        "read_file" | "write_file" | "edit_file" | "delete_file" | "mkdir" => args
            .get("path")
            .and_then(|v| v.as_str())
            .map(|p| format!("path: \"{p}\""))
            .unwrap_or_else(|| args.to_string()),
        "list_dir" | "search_files" => args
            .get("path")
            .and_then(|v| v.as_str())
            .map(|p| format!("path: \"{p}\""))
            .unwrap_or_else(|| "path: \".\"".to_string()),
        "run_process" => {
            let command = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let argv = args
                .get("args")
                .and_then(|v| v.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();
            if argv.is_empty() {
                format!("command: \"{command}\"")
            } else {
                format!("command: \"{command} {argv}\"")
            }
        }
        "preview_open" => {
            let kind = args.get("kind").and_then(|v| v.as_str()).unwrap_or("auto");
            let target = args.get("target").and_then(|v| v.as_str()).unwrap_or("");
            if target.is_empty() {
                format!("preview: \"{kind}\"")
            } else {
                format!("preview: \"{kind} {target}\"")
            }
        }
        "run_terminal_script" => args
            .get("script")
            .and_then(|v| v.as_str())
            .map(|script| format!("script: \"{}\"", truncate_utf8(script, 77, "...")))
            .unwrap_or_else(|| "script: \"\"".to_string()),
        _ => {
            let s = args.to_string();
            truncate_utf8(&s, 77, "...")
        }
    }
}

pub(crate) fn truncate_utf8(s: &str, max_bytes: usize, suffix: &str) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }

    let mut end = 0;
    for (idx, _) in s.char_indices() {
        if idx > max_bytes {
            break;
        }
        end = idx;
    }

    let mut out = s[..end].to_string();
    out.push_str(suffix);
    out
}

#[cfg(test)]
mod integration_tests {
    #[cfg(unix)]
    use super::{
        edit_file::EditFile, mkdir::Mkdir, run_process::RunProcess, search_files::SearchFiles,
        Tool, ToolContext,
    };
    use serde_json::json;

    #[test]
    fn truncate_utf8_keeps_char_boundary_with_multibyte_text() {
        let input = "가나다라마바사";
        let out = super::truncate_utf8(input, 5, "...");
        assert_eq!(out, "가...");
    }

    #[test]
    fn params_preview_truncates_json_without_panicking_on_korean() {
        let args = json!({
            "message": "가나다라마바사아자차카타파하가나다라마바사아자차카타파하"
        });
        let preview = super::params_preview("unknown_tool", &args);
        assert!(preview.ends_with("..."));
        assert!(preview.is_char_boundary(preview.len()));
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn tools_integration_chain_search_mkdir_edit_run_process() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("note.txt"), "hello old world\n").unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);

        let search = SearchFiles
            .run(json!({ "pattern": "old", "path": "." }), &ctx)
            .await
            .unwrap();
        assert_eq!(search.full["matches"].as_array().unwrap().len(), 1);

        Mkdir
            .run(json!({ "path": "out", "recursive": false }), &ctx)
            .await
            .unwrap();
        assert!(tmp.path().join("out").is_dir());

        EditFile
            .run(
                json!({ "path": "note.txt", "find": "old", "replace": "new" }),
                &ctx,
            )
            .await
            .unwrap();

        let out = RunProcess
            .run(json!({ "command": "cat", "args": ["note.txt"] }), &ctx)
            .await
            .unwrap();
        assert!(out.full["stdout"].as_str().unwrap().contains("new world"));
    }
}
