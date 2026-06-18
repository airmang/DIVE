use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

use super::guard::{block_as_error, classify_bash_command};
use super::{truncate_utf8, RiskLevel, Tool, ToolContext, ToolError, ToolOutput};

#[derive(Deserialize)]
struct Input {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    timeout_sec: Option<u64>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    expected_effect: Option<String>,
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
                "timeout_sec": { "type": "integer", "minimum": 1, "maximum": 60, "description": "Wall-clock timeout in seconds" },
                "reason": { "type": "string", "description": "Why DIVE wants to run this direct project command" },
                "expected_effect": { "type": "string", "description": "Expected project effect, such as running tests without editing files" }
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
        validate_command_no_shell(&args.command)?;
        validate_timeout(args.timeout_sec)?;
        for arg in &args.args {
            validate_no_shell(arg, "arg")?;
            if has_project_escape(arg) {
                return Err(ToolError::PathDenied(format!(
                    "path-like argument may not escape project root: {arg}"
                )));
            }
        }
        let command_line = std::iter::once(args.command.as_str())
            .chain(args.args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ");
        if let Some(reason) = classify_bash_command(&command_line) {
            return Err(block_as_error(reason));
        }
        Ok(())
    }

    async fn run(&self, input: Value, ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        self.validate(&input)?;
        let args: Input =
            serde_json::from_value(input).map_err(|e| ToolError::InvalidInput(e.to_string()))?;
        let timeout = effective_timeout(args.timeout_sec)?;

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
                "runtimeAction": "project_command",
                "timeout_sec": timeout,
                "reason": args.reason,
                "expected_effect": args.expected_effect,
                "exit_code": code,
                "stdout": truncate(&stdout, MAX_OUTPUT_BYTES),
                "stderr": truncate(&stderr, MAX_OUTPUT_BYTES),
            }),
        })
    }
}

fn validate_command_no_shell(command: &str) -> Result<(), ToolError> {
    validate_no_shell(command, "command")?;
    if (command.contains('/') || command.contains('\\')) && has_project_escape(command) {
        return Err(ToolError::PathDenied(format!(
            "executable path may not escape project root: {command}"
        )));
    }
    let executable = std::path::Path::new(command)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(command)
        .to_ascii_lowercase();
    let executable = executable.strip_suffix(".exe").unwrap_or(&executable);
    const SHELL_EXECUTABLES: &[&str] = &["bash", "sh", "zsh", "fish", "cmd", "powershell", "pwsh"];
    if SHELL_EXECUTABLES.contains(&executable) {
        return Err(ToolError::InvalidInput(format!(
            "shell executable not allowed in command: {command}"
        )));
    }
    Ok(())
}

fn validate_timeout(timeout_sec: Option<u64>) -> Result<(), ToolError> {
    let _ = effective_timeout(timeout_sec)?;
    Ok(())
}

fn effective_timeout(timeout_sec: Option<u64>) -> Result<u64, ToolError> {
    let timeout = timeout_sec.unwrap_or(DEFAULT_TIMEOUT_SEC);
    if timeout == 0 || timeout > MAX_TIMEOUT_SEC {
        return Err(ToolError::InvalidInput(format!(
            "timeout_sec must be between 1 and {MAX_TIMEOUT_SEC}"
        )));
    }
    Ok(timeout)
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

fn has_project_escape(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.starts_with('/') || trimmed.starts_with('\\') || trimmed.starts_with("~/") {
        return true;
    }
    let bytes = trimmed.as_bytes();
    if bytes.len() >= 3
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
        && bytes[0].is_ascii_alphabetic()
    {
        return true;
    }
    trimmed.split(['/', '\\']).any(|part| part == "..")
        || trimmed.contains("../")
        || trimmed.contains("..\\")
}

fn truncate(s: &str, max: usize) -> String {
    truncate_utf8(s, max, "\n… [truncated]")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn truncate_handles_utf8_boundary() {
        let out = truncate("가나다라마바사", 5);
        assert_eq!(out, "가\n… [truncated]");
    }

    #[test]
    fn run_process_validate_rejects_shell_metacharacters_and_escape_args() {
        assert!(RunProcess
            .validate(&json!({ "command": "echo hello; rm -rf ." }))
            .is_err());
        for command in ["bash", "sh", "zsh", "cmd", "powershell", "pwsh", "cmd.exe"] {
            assert!(
                RunProcess.validate(&json!({ "command": command })).is_err(),
                "accepted shell command {command}"
            );
        }
        assert!(RunProcess
            .validate(&json!({ "command": "echo", "args": ["../secret"] }))
            .is_err());
        assert!(RunProcess
            .validate(&json!({ "command": "echo", "args": ["--config=../secret"] }))
            .is_err());
        assert!(RunProcess
            .validate(&json!({ "command": "/bin/echo", "args": ["hello"] }))
            .is_err());
        assert!(RunProcess
            .validate(&json!({ "command": "bin/tool", "args": ["src/App.test.ts"] }))
            .is_ok());
        assert!(RunProcess
            .validate(&json!({ "command": "echo", "args": ["hello"] }))
            .is_ok());
    }

    #[test]
    fn run_process_schema_and_validation_keep_direct_metadata_bounded() {
        let schema = RunProcess.input_schema();
        assert_eq!(schema["properties"]["reason"]["type"], "string");
        assert_eq!(schema["properties"]["expected_effect"]["type"], "string");
        assert_eq!(schema["properties"]["timeout_sec"]["maximum"], 60);

        assert!(RunProcess
            .validate(&json!({
                "command": "pnpm",
                "args": ["test", "--", "src/App.test.ts"],
                "timeout_sec": 60,
                "reason": "Run the step verification command.",
                "expected_effect": "Runs tests without editing files."
            }))
            .is_ok());
        assert!(RunProcess
            .validate(&json!({ "command": "pnpm", "args": ["test"], "timeout_sec": 0 }))
            .is_err());
        assert!(RunProcess
            .validate(&json!({ "command": "pnpm", "args": ["test"], "timeout_sec": 61 }))
            .is_err());
    }

    #[test]
    fn run_process_validate_applies_destructive_command_blocklist() {
        for input in [
            json!({ "command": "dd", "args": ["if=/dev/zero", "of=/dev/sda"] }),
            json!({ "command": "chmod", "args": ["-R", "000", "."] }),
            json!({ "command": "git", "args": ["reset", "--hard"] }),
        ] {
            let err = RunProcess
                .validate(&input)
                .expect_err("destructive command should be blocked");
            assert!(
                matches!(err, ToolError::Blocked(_)),
                "expected blocked error for {input:?}, got {err:?}"
            );
        }

        assert!(RunProcess
            .validate(&json!({ "command": "rm", "args": ["-rf", "build/"] }))
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
        assert_eq!(out.full["runtimeAction"].as_str(), Some("project_command"));
        assert_eq!(out.full["timeout_sec"].as_u64(), Some(DEFAULT_TIMEOUT_SEC));
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
