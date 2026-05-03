use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{RiskLevel, Tool, ToolContext, ToolError, ToolOutput};

#[derive(Deserialize)]
struct Input {
    #[serde(default = "default_path")]
    path: String,
}

fn default_path() -> String {
    ".".into()
}

pub struct ListDir;

#[async_trait]
impl Tool for ListDir {
    fn name(&self) -> &str {
        "list_dir"
    }

    fn description(&self) -> &str {
        "List entries in a directory relative to the project root"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "Relative directory path, defaults to '.'" }
            }
        })
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Safe
    }

    async fn run(&self, input: Value, ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let args: Input =
            serde_json::from_value(input).map_err(|e| ToolError::InvalidInput(e.to_string()))?;
        let path = ctx.fs.resolve_read(&args.path)?;
        let mut entries = tokio::fs::read_dir(&path)
            .await
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => ToolError::NotFound(args.path.clone()),
                _ => ToolError::Io(e),
            })?;
        let mut names: Vec<Value> = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            let file_type = entry.file_type().await?;
            names.push(json!({
                "name": entry.file_name().to_string_lossy().into_owned(),
                "kind": if file_type.is_dir() { "dir" } else if file_type.is_file() { "file" } else { "other" }
            }));
        }
        names.sort_by(|a, b| {
            a["name"]
                .as_str()
                .unwrap_or("")
                .cmp(b["name"].as_str().unwrap_or(""))
        });
        let summary = format!("{}: {} entries", args.path, names.len());
        Ok(ToolOutput::success(
            summary,
            json!({ "path": args.path, "entries": names }),
        ))
    }
}
