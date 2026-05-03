use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use super::guard::{block_as_error, classify_bash_command};
use super::{RiskLevel, Tool, ToolContext, ToolError, ToolOutput};

#[derive(Deserialize)]
struct Input {
    command: String,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 120_000;

pub struct Bash;

#[async_trait]
impl Tool for Bash {
    fn name(&self) -> &str {
        "bash"
    }

    fn description(&self) -> &str {
        "Run a shell command in the project root. Danger-tier: requires user approval and is subject to the §9.2 blocklist."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "Shell command to execute" },
                "timeout_ms": { "type": "integer", "description": "Optional wall-clock timeout (ms). Capped at 120_000." }
            },
            "required": ["command"]
        })
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Danger
    }

    fn validate(&self, input: &Value) -> Result<(), ToolError> {
        let cmd = input
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidInput("missing command".into()))?;
        if let Some(reason) = classify_bash_command(cmd) {
            return Err(block_as_error(reason));
        }
        Ok(())
    }

    async fn run(&self, input: Value, ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let args: Input =
            serde_json::from_value(input).map_err(|e| ToolError::InvalidInput(e.to_string()))?;
        let timeout = args
            .timeout_ms
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .min(MAX_TIMEOUT_MS);

        let mut cmd = if cfg!(windows) {
            let mut c = tokio::process::Command::new("cmd");
            c.args(["/C", &args.command]);
            c
        } else {
            let mut c = tokio::process::Command::new("bash");
            c.args(["-lc", &args.command]);
            c
        };
        cmd.current_dir(&ctx.project_root);
        cmd.kill_on_drop(true);

        let output = tokio::time::timeout(std::time::Duration::from_millis(timeout), cmd.output())
            .await
            .map_err(|_| {
                ToolError::InvalidInput(format!("bash command timed out after {timeout}ms"))
            })??;

        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        let code = output.status.code().unwrap_or(-1);
        let success = output.status.success();
        let summary = if success {
            format!("exit 0 · {} bytes stdout", stdout.len())
        } else {
            format!("exit {code} · {} bytes stderr", stderr.len())
        };

        Ok(ToolOutput {
            success,
            summary,
            full: json!({
                "command": args.command,
                "exit_code": code,
                "stdout": truncate(&stdout, 16 * 1024),
                "stderr": truncate(&stderr, 16 * 1024),
            }),
        })
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut out = s[..max].to_string();
        out.push_str("\n… [truncated]");
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_blocks_rm_rf_root() {
        let err = Bash
            .validate(&json!({ "command": "rm -rf /" }))
            .unwrap_err();
        match err {
            ToolError::Blocked(reason) => {
                assert!(reason.rule.contains("rm -rf"));
            }
            other => panic!("expected Blocked, got {other:?}"),
        }
    }

    #[test]
    fn validate_allows_benign() {
        assert!(Bash.validate(&json!({ "command": "pnpm test" })).is_ok());
    }

    #[test]
    fn validate_missing_command_errors() {
        let err = Bash.validate(&json!({})).unwrap_err();
        assert!(matches!(err, ToolError::InvalidInput(_)));
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn runs_echo() {
        let tmp = tempfile::tempdir().unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);
        let out = Bash
            .run(json!({ "command": "echo hello" }), &ctx)
            .await
            .unwrap();
        assert!(out.success);
        let full = out.full;
        assert!(full["stdout"].as_str().unwrap().contains("hello"));
    }
}
