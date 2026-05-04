use async_trait::async_trait;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

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
        validate_project_boundaries(&args.command, &ctx.project_root)?;
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

static REDIRECT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?P<op>(?:[12]?>|>>|<))\s*(?P<path>[^\s|;&]+)"#).unwrap());
static COPY_MOVE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)\b(?:cp|mv)\b(?:\s+-[^\s]+)*\s+[^\s|;&]+\s+(?P<path>[^\s|;&]+)"#).unwrap()
});
static WRITE_PATH_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)\b(?:touch|mkdir|install)\b(?:\s+-[^\s]+)*\s+(?P<path>[^\s|;&]+)"#).unwrap()
});

fn validate_project_boundaries(command: &str, project_root: &Path) -> Result<(), ToolError> {
    for caps in REDIRECT_RE.captures_iter(command) {
        let Some(raw) = caps.name("path").map(|m| trim_shell_token(m.as_str())) else {
            continue;
        };
        if raw == "/dev/null" {
            continue;
        }
        ensure_path_inside_project(raw, project_root)?;
    }
    for re in [&*COPY_MOVE_RE, &*WRITE_PATH_RE] {
        for caps in re.captures_iter(command) {
            if let Some(raw) = caps.name("path").map(|m| trim_shell_token(m.as_str())) {
                ensure_path_inside_project(raw, project_root)?;
            }
        }
    }
    Ok(())
}

fn trim_shell_token(token: &str) -> &str {
    token.trim_matches(|c| matches!(c, '"' | '\''))
}

fn ensure_path_inside_project(raw: &str, project_root: &Path) -> Result<(), ToolError> {
    if raw.is_empty() || raw.starts_with('$') {
        return Err(ToolError::PathDenied(format!(
            "dynamic shell path is not allowed: {raw}"
        )));
    }
    let path = Path::new(raw);
    let candidate = if path.is_absolute() {
        normalize(path)
    } else {
        normalize(&project_root.join(path))
    };
    let root = normalize(project_root);
    if !candidate.starts_with(&root) {
        return Err(ToolError::PathDenied(format!(
            "bash path escapes project root: {raw}"
        )));
    }
    Ok(())
}

fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in p.components() {
        use std::path::Component;
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
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

    #[test]
    fn validate_runtime_project_boundaries_blocks_external_writes() {
        let root = Path::new("/tmp/dive-project");
        for cmd in [
            "echo x > /tmp/outside",
            "echo x > ../outside",
            "cp file /tmp/outside",
            "mv file ../outside",
            "touch /tmp/outside",
            "echo x > $HOME/outside",
        ] {
            assert!(
                validate_project_boundaries(cmd, root).is_err(),
                "must reject {cmd}"
            );
        }
    }

    #[test]
    fn validate_runtime_project_boundaries_allows_relative_paths_and_dev_null() {
        let root = Path::new("/tmp/dive-project");
        for cmd in [
            "echo x > out.txt",
            "echo x >> logs/out.txt",
            "cp file out/file",
            "mv file out/file",
            "touch out/file",
            "cargo test >/dev/null",
        ] {
            assert!(
                validate_project_boundaries(cmd, root).is_ok(),
                "must allow {cmd}"
            );
        }
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
