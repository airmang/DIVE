use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{RiskLevel, Tool, ToolContext, ToolError, ToolOutput};

#[derive(Deserialize)]
struct Input {
    path: String,
    /// Exact substring to find (first occurrence replaced; must be unique).
    find: String,
    replace: String,
}

pub struct EditFile;

#[async_trait]
impl Tool for EditFile {
    fn name(&self) -> &str {
        "edit_file"
    }

    fn description(&self) -> &str {
        "Replace the first occurrence of `find` with `replace` in a file"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "find": { "type": "string" },
                "replace": { "type": "string" }
            },
            "required": ["path", "find", "replace"]
        })
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Warn
    }

    async fn run(&self, input: Value, ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let args: Input =
            serde_json::from_value(input).map_err(|e| ToolError::InvalidInput(e.to_string()))?;
        let path = ctx.fs.resolve(&args.path)?;
        let bytes = tokio::fs::read(&path).await.map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => ToolError::NotFound(args.path.clone()),
            _ => ToolError::Io(e),
        })?;
        let src = String::from_utf8(bytes)
            .map_err(|_| ToolError::InvalidInput("target file is not valid UTF-8".into()))?;
        let count = src.matches(&args.find).count();
        if count == 0 {
            return Ok(ToolOutput::failure(
                format!("'{}' not found in {}", args.find, args.path),
                json!({ "path": args.path, "found": false }),
            ));
        }
        if count > 1 {
            return Ok(ToolOutput::failure(
                format!(
                    "'{}' matches {} times — refine `find` for uniqueness",
                    args.find, count
                ),
                json!({ "path": args.path, "matches": count }),
            ));
        }
        let replaced = src.replacen(&args.find, &args.replace, 1);
        tokio::fs::write(&path, &replaced).await?;
        let summary = format!("edited {} (1 match replaced)", args.path);
        Ok(ToolOutput::success(
            summary,
            json!({ "path": args.path, "bytes": replaced.len() }),
        ))
    }
}
