use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

use super::{RiskLevel, Tool, ToolContext, ToolError, ToolOutput};

#[derive(Deserialize)]
struct Input {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    timeout_sec: Option<u64>,
}

const DEFAULT_TIMEOUT_SEC: u64 = 30;
const MAX_TIMEOUT_SEC: u64 = 60;
const MAX_OUTPUT_BYTES: usize = 16 * 1024;

pub struct RunProcess;

#[async_trait]
impl Tool for RunProcess {
    fn name(&self) -> &str {
        "run_process"
    }

    fn description(&self) -> &str {
        "Run one executable with explicit args in the project root. No shell expansion is performed."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "Executable name or project-relative executable path" },
                "args": { "type": "array", "items": { "type": "string" } },
                "timeout_sec": { "type": "integer", "description": "Wall-clock timeout, capped at 60 seconds" }
            },
            "required": ["command"]
        })
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Danger
    }

    fn validate(&self, input: &Value) -> Result<(), ToolError> {
        let args: Input = serde_json::from_value(input.clone())
            .map_err(|e| ToolError::InvalidInput(e.to_string()))?;
        validate_no_shell(&args.command, "command")?;
        for arg in &args.args {
            validate_no_shell(arg, "arg")?;
            if std::path::Path::new(arg).is_absolute() || arg.split(['/', '\\']).any(|p| p == "..")
            {
                return Err(ToolError::PathDenied(format!(
                    "path-like argument may not escape project root: {arg}"
                )));
            }
        }
        Ok(())
    }

    async fn run(&self, input: Value, ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        self.validate(&input)?;
        let args: Input =
            serde_json::from_value(input).map_err(|e| ToolError::InvalidInput(e.to_string()))?;
        let timeout = args
            .timeout_sec
            .unwrap_or(DEFAULT_TIMEOUT_SEC)
            .min(MAX_TIMEOUT_SEC);

        let command = if args.command.contains('/') || args.command.contains('\\') {
            ctx.fs.resolve(&args.command)?
        } else {
            args.command.clone().into()
        };

        let mut cmd = tokio::process::Command::new(command);
        cmd.args(&args.args)
            .current_dir(&ctx.project_root)
            .kill_on_drop(true);
        let output = tokio::time::timeout(Duration::from_secs(timeout), cmd.output())
            .await
            .map_err(|_| {
                ToolError::InvalidInput(format!("process timed out after {timeout}s"))
            })??;
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        let code = output.status.code().unwrap_or(-1);
        let success = output.status.success();
        Ok(ToolOutput {
            success,
            summary: if success {
                format!("exit 0 · {} bytes stdout", stdout.len())
            } else {
                format!("exit {code} · {} bytes stderr", stderr.len())
            },
            full: json!({
                "command": args.command,
                "args": args.args,
                "exit_code": code,
                "stdout": truncate(&stdout, MAX_OUTPUT_BYTES),
                "stderr": truncate(&stderr, MAX_OUTPUT_BYTES),
            }),
        })
    }
}

fn validate_no_shell(value: &str, label: &str) -> Result<(), ToolError> {
    if value.trim().is_empty() {
        return Err(ToolError::InvalidInput(format!(
            "{label} must not be empty"
        )));
    }
    const FORBIDDEN: &[char] = &['|', '&', ';', '<', '>', '(', ')', '$', '`', '\n', '\r'];
    if value.chars().any(|c| FORBIDDEN.contains(&c)) {
        return Err(ToolError::InvalidInput(format!(
            "shell metacharacter not allowed in {label}: {value}"
        )));
    }
    Ok(())
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
    use serde_json::json;

    #[test]
    fn run_process_validate_rejects_shell_metacharacters_and_escape_args() {
        assert!(RunProcess
            .validate(&json!({ "command": "echo hello; rm -rf ." }))
            .is_err());
        assert!(RunProcess
            .validate(&json!({ "command": "echo", "args": ["../secret"] }))
            .is_err());
        assert!(RunProcess
            .validate(&json!({ "command": "echo", "args": ["hello"] }))
            .is_ok());
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn run_process_executes_without_shell() {
        let tmp = tempfile::tempdir().unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);
        let out = RunProcess
            .run(json!({ "command": "printf", "args": ["hello"] }), &ctx)
            .await
            .unwrap();
        assert!(out.success);
        assert_eq!(out.full["stdout"].as_str().unwrap(), "hello");
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn run_process_allows_project_relative_executable() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        let script = bin.join("say-hi.sh");
        std::fs::write(&script, "#!/bin/sh\nprintf hi").unwrap();
        let mut perms = std::fs::metadata(&script).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script, perms).unwrap();

        let ctx = ToolContext::new(tmp.path(), 1);
        let out = RunProcess
            .run(json!({ "command": "bin/say-hi.sh" }), &ctx)
            .await
            .unwrap();
        assert!(out.success);
        assert_eq!(out.full["stdout"].as_str().unwrap(), "hi");
    }
}
