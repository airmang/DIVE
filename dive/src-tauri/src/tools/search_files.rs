use async_trait::async_trait;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

use super::{RiskLevel, Tool, ToolContext, ToolError, ToolOutput};

const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    ".next",
    ".turbo",
    "coverage",
    "out",
];
const DEFAULT_MAX_RESULTS: usize = 50;
const MAX_RESULTS_PER_FILE: usize = 5;
const MATCH_LINE_MAX_CHARS: usize = 160;
const TRUNCATION_MARKER: &str = "... [truncated]";

#[derive(Deserialize)]
struct Input {
    pattern: String,
    #[serde(default = "default_path")]
    path: String,
    #[serde(default)]
    use_regex: bool,
    #[serde(default)]
    include_vendor: bool,
    #[serde(default = "default_max_results")]
    max_results: usize,
    #[serde(default)]
    include_glob: Option<String>,
    #[serde(default)]
    exclude_glob: Option<String>,
}

fn default_path() -> String {
    ".".into()
}

fn default_max_results() -> usize {
    DEFAULT_MAX_RESULTS
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
                "use_regex": { "type": "boolean", "description": "Treat pattern as a regex when true" },
                "include_vendor": {
                    "type": "boolean",
                    "description": "Include vendor/build output directories such as node_modules, dist, build, and target",
                    "default": false
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of matches to return; total matches are still counted",
                    "default": DEFAULT_MAX_RESULTS
                },
                "include_glob": {
                    "type": "string",
                    "description": "Optional relative-path glob for files to include"
                },
                "exclude_glob": {
                    "type": "string",
                    "description": "Optional relative-path glob for files to exclude"
                }
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
        let include_glob = compile_glob(args.include_glob.as_deref())?;
        let exclude_glob = compile_glob(args.exclude_glob.as_deref())?;
        let mut matches = Vec::new();
        let mut files_scanned = 0usize;
        let mut total_match_count = 0usize;
        let mut visit_stats = VisitStats::default();
        visit(
            &root,
            ctx.fs.project_root(),
            args.include_vendor,
            &mut visit_stats,
            &mut |file| {
                let rel_path = display_rel(file, ctx.fs.project_root());
                if !path_allowed(&rel_path, include_glob.as_ref(), exclude_glob.as_ref()) {
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
                let mut returned_for_file = 0usize;
                for (idx, line) in text.lines().enumerate() {
                    let found = match &regex {
                        Some(re) => re.is_match(line),
                        None => line.contains(&args.pattern),
                    };
                    if found {
                        total_match_count += 1;
                        if matches.len() < args.max_results
                            && returned_for_file < MAX_RESULTS_PER_FILE
                        {
                            matches.push(json!({
                                "path": rel_path.clone(),
                                "line_number": idx + 1,
                                "line": truncate(line, MATCH_LINE_MAX_CHARS),
                            }));
                            returned_for_file += 1;
                        }
                    }
                }
                Ok(())
            },
        )?;
        let shown_match_count = matches.len();
        let capped = shown_match_count < total_match_count;
        let mut summary = format!(
            "scanned {files_scanned} files, {total_match_count} matches, showing {shown_match_count}"
        );
        if capped {
            summary.push_str(" (capped)");
        }
        if !args.include_vendor && visit_stats.excluded_vendor_dirs > 0 {
            summary.push_str(&format!(
                ", excluded {} vendor/build dirs",
                visit_stats.excluded_vendor_dirs
            ));
        }
        Ok(ToolOutput::success(
            summary,
            json!({
                "pattern": args.pattern,
                "path": args.path,
                "use_regex": args.use_regex,
                "include_vendor": args.include_vendor,
                "max_results": args.max_results,
                "max_results_per_file": MAX_RESULTS_PER_FILE,
                "include_glob": args.include_glob,
                "exclude_glob": args.exclude_glob,
                "files_scanned": files_scanned,
                "total_match_count": total_match_count,
                "shown_match_count": shown_match_count,
                "matches": matches,
                "capped": capped,
                "truncated": capped,
                "excluded_vendor_dirs": visit_stats.excluded_vendor_dirs,
            }),
        ))
    }
}

#[derive(Default)]
struct VisitStats {
    excluded_vendor_dirs: usize,
}

fn visit<F>(
    path: &Path,
    project_root: &Path,
    include_vendor: bool,
    stats: &mut VisitStats,
    cb: &mut F,
) -> Result<(), ToolError>
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
    if should_skip_dir(path, project_root, include_vendor, stats) {
        return Ok(());
    }
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let child = entry.path();
        if !child.starts_with(project_root) {
            continue;
        }
        visit(&child, project_root, include_vendor, stats, cb)?;
    }
    Ok(())
}

fn should_skip_dir(
    path: &Path,
    project_root: &Path,
    include_vendor: bool,
    stats: &mut VisitStats,
) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if name == ".git" {
        return true;
    }
    if path == project_root {
        return false;
    }
    if !include_vendor && is_ignored_vendor_dir(name) {
        stats.excluded_vendor_dirs += 1;
        return true;
    }
    false
}

fn is_ignored_vendor_dir(name: &str) -> bool {
    IGNORED_DIRS
        .iter()
        .any(|ignored| *ignored != ".git" && *ignored == name)
}

fn display_rel(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/")
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_owned()
    } else {
        let keep = max.saturating_sub(TRUNCATION_MARKER.chars().count());
        let mut out: String = s.chars().take(keep).collect();
        out.push_str(TRUNCATION_MARKER);
        out
    }
}

struct GlobMatcher {
    regex: Regex,
    basename_only: bool,
}

impl GlobMatcher {
    fn is_match(&self, path: &str) -> bool {
        if self.basename_only {
            let basename = path.rsplit('/').next().unwrap_or(path);
            self.regex.is_match(basename)
        } else {
            self.regex.is_match(path)
        }
    }
}

fn compile_glob(pattern: Option<&str>) -> Result<Option<GlobMatcher>, ToolError> {
    pattern
        .map(|pattern| {
            let normalized = pattern.replace('\\', "/");
            let basename_only = !normalized.contains('/');
            let regex = Regex::new(&glob_to_regex(&normalized))
                .map_err(|e| ToolError::InvalidInput(e.to_string()))?;
            Ok(GlobMatcher {
                regex,
                basename_only,
            })
        })
        .transpose()
}

fn glob_to_regex(pattern: &str) -> String {
    let chars: Vec<char> = pattern.chars().collect();
    let mut out = String::from("^");
    let mut i = 0usize;
    while i < chars.len() {
        match chars[i] {
            '*' if chars.get(i + 1) == Some(&'*') => {
                i += 2;
                if chars.get(i) == Some(&'/') {
                    i += 1;
                    out.push_str("(?:.*/)?");
                } else {
                    out.push_str(".*");
                }
            }
            '*' => {
                out.push_str("[^/]*");
                i += 1;
            }
            '?' => {
                out.push_str("[^/]");
                i += 1;
            }
            c => {
                out.push_str(&regex::escape(&c.to_string()));
                i += 1;
            }
        }
    }
    out.push('$');
    out
}

fn path_allowed(
    path: &str,
    include_glob: Option<&GlobMatcher>,
    exclude_glob: Option<&GlobMatcher>,
) -> bool {
    if include_glob.is_some_and(|glob| !glob.is_match(path)) {
        return false;
    }
    if exclude_glob.is_some_and(|glob| glob.is_match(path)) {
        return false;
    }
    true
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

    #[tokio::test]
    async fn search_files_excludes_vendor_dirs_by_default_with_opt_in() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("src")).unwrap();
        std::fs::create_dir_all(tmp.path().join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(tmp.path().join(".git")).unwrap();
        std::fs::write(tmp.path().join("src/main.rs"), "let app_token = true;\n").unwrap();
        std::fs::write(
            tmp.path().join("node_modules/pkg/index.js"),
            "const app_token = true;\n",
        )
        .unwrap();
        std::fs::write(tmp.path().join(".git/HEAD"), "app_token\n").unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);

        let out = SearchFiles
            .run(json!({ "pattern": "app_token" }), &ctx)
            .await
            .unwrap();
        let matches = out.full["matches"].as_array().unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["path"], "src/main.rs");
        assert_eq!(out.full["total_match_count"], 1);
        assert_eq!(out.full["excluded_vendor_dirs"], 1);
        assert!(out.summary.contains("excluded 1 vendor/build dirs"));

        let out = SearchFiles
            .run(
                json!({ "pattern": "app_token", "include_vendor": true }),
                &ctx,
            )
            .await
            .unwrap();
        let paths: Vec<_> = out.full["matches"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["path"].as_str().unwrap())
            .collect();
        assert_eq!(paths.len(), 2);
        assert!(paths.contains(&"src/main.rs"));
        assert!(paths.contains(&"node_modules/pkg/index.js"));
        assert_eq!(out.full["total_match_count"], 2);
        assert_eq!(out.full["excluded_vendor_dirs"], 0);
    }

    #[tokio::test]
    async fn search_files_counts_total_matches_while_capping_returned_results() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("src")).unwrap();
        for file_idx in 0..11 {
            let mut text = String::new();
            for line_idx in 0..6 {
                text.push_str(&format!("needle file-{file_idx} line-{line_idx}\n"));
            }
            std::fs::write(tmp.path().join(format!("src/file_{file_idx}.txt")), text).unwrap();
        }
        let ctx = ToolContext::new(tmp.path(), 1);

        let out = SearchFiles
            .run(json!({ "pattern": "needle" }), &ctx)
            .await
            .unwrap();

        assert_eq!(out.full["files_scanned"], 11);
        assert_eq!(out.full["total_match_count"], 66);
        assert_eq!(out.full["shown_match_count"], DEFAULT_MAX_RESULTS);
        assert_eq!(out.full["capped"], true);
        assert!(out
            .summary
            .contains("scanned 11 files, 66 matches, showing 50"));
        assert!(out.summary.contains("(capped)"));

        let matches = out.full["matches"].as_array().unwrap();
        assert_eq!(matches.len(), DEFAULT_MAX_RESULTS);
        for file_idx in 0..11 {
            let path = format!("src/file_{file_idx}.txt");
            let returned_for_file = matches.iter().filter(|entry| entry["path"] == path).count();
            assert!(returned_for_file <= MAX_RESULTS_PER_FILE);
        }
        assert!(matches.iter().any(|entry| {
            let path = entry["path"].as_str().unwrap();
            matches
                .iter()
                .filter(|other| other["path"].as_str().unwrap() == path)
                .count()
                == MAX_RESULTS_PER_FILE
        }));
    }

    #[tokio::test]
    async fn search_files_truncates_returned_lines_to_new_limit() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("long.txt"),
            format!("needle {}\n", "x".repeat(MATCH_LINE_MAX_CHARS * 2)),
        )
        .unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);

        let out = SearchFiles
            .run(json!({ "pattern": "needle" }), &ctx)
            .await
            .unwrap();
        let line = out.full["matches"][0]["line"].as_str().unwrap();
        assert!(line.chars().count() <= MATCH_LINE_MAX_CHARS);
        assert!(line.ends_with(TRUNCATION_MARKER));
    }

    #[tokio::test]
    async fn search_files_include_and_exclude_globs_filter_paths() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("src")).unwrap();
        std::fs::create_dir_all(tmp.path().join("tests")).unwrap();
        std::fs::write(tmp.path().join("src/keep.rs"), "needle keep\n").unwrap();
        std::fs::write(tmp.path().join("src/skip.rs"), "needle skip\n").unwrap();
        std::fs::write(tmp.path().join("tests/keep.rs"), "needle test\n").unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);

        let out = SearchFiles
            .run(
                json!({
                    "pattern": "needle",
                    "include_glob": "src/*.rs",
                    "exclude_glob": "src/skip.rs"
                }),
                &ctx,
            )
            .await
            .unwrap();

        let matches = out.full["matches"].as_array().unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["path"], "src/keep.rs");
        assert_eq!(out.full["files_scanned"], 1);
        assert_eq!(out.full["total_match_count"], 1);
    }
}
