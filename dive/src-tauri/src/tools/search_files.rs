use async_trait::async_trait;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

use super::{RiskLevel, Tool, ToolContext, ToolError, ToolOutput};

#[derive(Deserialize)]
struct Input {
    pattern: String,
    #[serde(default = "default_path")]
    path: String,
    #[serde(default)]
    use_regex: bool,
}

fn default_path() -> String {
    ".".into()
}

pub struct SearchFiles;

#[async_trait]
impl Tool for SearchFiles {
    fn name(&self) -> &str {
        "search_files"
    }

    fn description(&self) -> &str {
        "Search UTF-8 project files for a literal string or regular expression"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "pattern": { "type": "string", "description": "Text or regex pattern to search for" },
                "path": { "type": "string", "description": "Relative file or directory path, defaults to '.'" },
                "use_regex": { "type": "boolean", "description": "Treat pattern as a regex when true" }
            },
            "required": ["pattern"]
        })
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Safe
    }

    async fn run(&self, input: Value, ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let args: Input =
            serde_json::from_value(input).map_err(|e| ToolError::InvalidInput(e.to_string()))?;
        if args.pattern.is_empty() {
            return Err(ToolError::InvalidInput("pattern must not be empty".into()));
        }
        let root = ctx.fs.resolve_read(&args.path)?;
        let regex = if args.use_regex {
            Some(Regex::new(&args.pattern).map_err(|e| ToolError::InvalidInput(e.to_string()))?)
        } else {
            None
        };
        let mut matches = Vec::new();
        let mut files_scanned = 0usize;
        visit(&root, ctx.fs.project_root(), &mut |file| {
            if matches.len() >= 100 {
                return Ok(());
            }
            files_scanned += 1;
            let bytes = match std::fs::read(file) {
                Ok(bytes) => bytes,
                Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => return Ok(()),
                Err(e) => return Err(ToolError::Io(e)),
            };
            let Ok(text) = String::from_utf8(bytes) else {
                return Ok(());
            };
            for (idx, line) in text.lines().enumerate() {
                let found = match &regex {
                    Some(re) => re.is_match(line),
                    None => line.contains(&args.pattern),
                };
                if found {
                    matches.push(json!({
                        "path": display_rel(file, ctx.fs.project_root()),
                        "line_number": idx + 1,
                        "line": truncate(line, 500),
                    }));
                    if matches.len() >= 100 {
                        break;
                    }
                }
            }
            Ok(())
        })?;
        let summary = format!(
            "{} matches in {} scanned files{}",
            matches.len(),
            files_scanned,
            if matches.len() >= 100 {
                " (truncated)"
            } else {
                ""
            }
        );
        Ok(ToolOutput::success(
            summary,
            json!({
                "pattern": args.pattern,
                "path": args.path,
                "use_regex": args.use_regex,
                "matches": matches,
                "truncated": matches.len() >= 100,
            }),
        ))
    }
}

fn visit<F>(path: &Path, project_root: &Path, cb: &mut F) -> Result<(), ToolError>
where
    F: FnMut(&Path) -> Result<(), ToolError>,
{
    let meta = std::fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_file() {
        return cb(path);
    }
    if !meta.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let child = entry.path();
        if child.file_name().is_some_and(|name| name == ".git") {
            continue;
        }
        if !child.starts_with(project_root) {
            continue;
        }
        visit(&child, project_root, cb)?;
    }
    Ok(())
}

fn display_rel(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_owned()
    } else {
        let mut out = s[..max].to_owned();
        out.push('…');
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn search_files_finds_literal_and_regex_matches() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("src")).unwrap();
        std::fs::write(
            tmp.path().join("src/main.rs"),
            "fn main() {}\nlet token = 42;\n",
        )
        .unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);

        let out = SearchFiles
            .run(json!({ "pattern": "token", "path": "src" }), &ctx)
            .await
            .unwrap();
        assert!(out.success);
        assert_eq!(out.full["matches"].as_array().unwrap().len(), 1);

        let out = SearchFiles
            .run(
                json!({ "pattern": "token\\s*=\\s*\\d+", "use_regex": true }),
                &ctx,
            )
            .await
            .unwrap();
        assert_eq!(out.full["matches"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn search_files_rejects_sandbox_escape() {
        let tmp = tempfile::tempdir().unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);
        let err = SearchFiles
            .run(json!({ "pattern": "x", "path": "../" }), &ctx)
            .await
            .unwrap_err();
        assert!(matches!(err, ToolError::PathDenied(_)));
    }

    #[tokio::test]
    async fn search_files_rejects_bad_regex() {
        let tmp = tempfile::tempdir().unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);
        let err = SearchFiles
            .run(json!({ "pattern": "(", "use_regex": true }), &ctx)
            .await
            .unwrap_err();
        assert!(matches!(err, ToolError::InvalidInput(_)));
    }
}
