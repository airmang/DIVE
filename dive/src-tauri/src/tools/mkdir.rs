use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{RiskLevel, Tool, ToolContext, ToolError, ToolOutput};

#[derive(Deserialize)]
struct Input {
    path: String,
    #[serde(default)]
    recursive: bool,
}

pub struct Mkdir;

#[async_trait]
impl Tool for Mkdir {
    fn name(&self) -> &str {
        "mkdir"
    }

    fn description(&self) -> &str {
        "Create a directory inside the project root"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "recursive": { "type": "boolean", "description": "Create parent directories when true" }
            },
            "required": ["path"]
        })
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Warn
    }

    async fn run(&self, input: Value, ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let args: Input =
            serde_json::from_value(input).map_err(|e| ToolError::InvalidInput(e.to_string()))?;
        let path = ctx.fs.resolve(&args.path)?;
        if path.is_file() {
            return Err(ToolError::InvalidInput(format!(
                "path is a file: {}",
                args.path
            )));
        }
        if args.recursive {
            tokio::fs::create_dir_all(&path).await?;
        } else if !path.exists() {
            tokio::fs::create_dir(&path).await?;
        }
        Ok(ToolOutput::success(
            format!("created directory {}", args.path),
            json!({ "path": args.path, "recursive": args.recursive }),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn mkdir_creates_nested_directory_when_recursive() {
        let tmp = tempfile::tempdir().unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);
        let out = Mkdir
            .run(json!({ "path": "a/b", "recursive": true }), &ctx)
            .await
            .unwrap();
        assert!(out.success);
        assert!(tmp.path().join("a/b").is_dir());
    }

    #[tokio::test]
    async fn mkdir_rejects_escape() {
        let tmp = tempfile::tempdir().unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);
        let err = Mkdir
            .run(json!({ "path": "../escape", "recursive": true }), &ctx)
            .await
            .unwrap_err();
        assert!(matches!(err, ToolError::PathDenied(_)));
    }
}
