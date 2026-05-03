use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{RiskLevel, Tool, ToolContext, ToolError, ToolOutput};

#[derive(Deserialize)]
struct Input {
    path: String,
}

pub struct ReadFile;

#[async_trait]
impl Tool for ReadFile {
    fn name(&self) -> &str {
        "read_file"
    }

    fn description(&self) -> &str {
        "Read the contents of a file relative to the project root"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Relative file path" }
            },
            "required": ["path"]
        })
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Safe
    }

    async fn run(&self, input: Value, ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let args: Input =
            serde_json::from_value(input).map_err(|e| ToolError::InvalidInput(e.to_string()))?;
        let path = ctx.fs.resolve_read(&args.path)?;
        let bytes = tokio::fs::read(&path).await.map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => ToolError::NotFound(args.path.clone()),
            _ => ToolError::Io(e),
        })?;
        let content = String::from_utf8_lossy(&bytes).into_owned();
        let summary = format!("{}: {} bytes", args.path, bytes.len());
        Ok(ToolOutput::success(
            summary,
            json!({ "path": args.path, "content": content }),
        ))
    }
}
