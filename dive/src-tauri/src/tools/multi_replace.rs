use async_trait::async_trait;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use super::search_files::IGNORED_DIRS;
use super::{RiskLevel, Tool, ToolContext, ToolError, ToolOutput};

#[derive(Deserialize)]
struct Input {
    find: String,
    replace: String,
    #[serde(default)]
    paths: Vec<String>,
    #[serde(default)]
    path_glob: Option<String>,
    #[serde(default)]
    occurrence: Occurrence,
}

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Occurrence {
    First,
    #[default]
    All,
}

impl Occurrence {
    fn as_str(self) -> &'static str {
        match self {
            Self::First => "first",
            Self::All => "all",
        }
    }

    fn replacement_count(self, matches: usize) -> usize {
        match self {
            Self::First => usize::from(matches > 0),
            Self::All => matches,
        }
    }

    fn apply(self, before: &str, find: &str, replace: &str) -> String {
        match self {
            Self::First => before.replacen(find, replace, 1),
            Self::All => before.replace(find, replace),
        }
    }
}

struct Target {
    path: PathBuf,
    rel_path: String,
}

struct ReplacementPlan {
    path: PathBuf,
    rel_path: String,
    before: String,
    after: String,
    matches: usize,
    replacements: usize,
}

pub(crate) struct MultiReplacePreview {
    pub path: String,
    pub before: String,
    pub after: String,
}

pub struct MultiReplace;

#[async_trait]
impl Tool for MultiReplace {
    fn name(&self) -> &str {
        "multi_replace"
    }

    fn description(&self) -> &str {
        "Atomically replace a string across multiple sandboxed project files"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "find": { "type": "string" },
                "replace": { "type": "string" },
                "paths": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Explicit relative target files. Provide either `paths` or `path_glob` (at least one)."
                },
                "path_glob": {
                    "type": "string",
                    "description": "Relative glob for target files, excluding vendor/build directories. Provide either `paths` or `path_glob` (at least one)."
                },
                "occurrence": {
                    "type": "string",
                    "enum": ["first", "all"],
                    "default": "all"
                }
            },
            "required": ["find", "replace"]
        })
        // NOTE: no top-level `anyOf`/`oneOf`/`allOf` combinator here. Anthropic's
        // tool-use API rejects a root-level schema combinator in a tool's
        // input_schema and responds with an EMPTY completion (no text, no tool
        // calls), which silently disables the whole supervised turn. The
        // "provide paths OR path_glob" requirement is documented above and
        // enforced at runtime (see `collect_requested_paths` / the
        // "matched 0 target files" failure below).
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Warn
    }

    async fn run(&self, input: Value, ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let args = parse_input(input)?;
        let requested_paths = collect_requested_paths(&args, ctx.fs.project_root())?;

        if requested_paths.is_empty() {
            return Ok(ToolOutput::failure(
                "multi_replace matched 0 target files; no files changed",
                json!({
                    "occurrence": args.occurrence.as_str(),
                    "path_glob": args.path_glob,
                    "target_file_count": 0,
                    "changed_file_count": 0,
                    "total_replacements": 0,
                    "files": [],
                    "changed_files": [],
                }),
            ));
        }

        let mut seen = BTreeSet::new();
        let mut plans = Vec::new();
        let mut files = Vec::new();
        let mut failures = Vec::new();

        for requested_path in requested_paths {
            match resolve_target(&requested_path, ctx) {
                Ok(target) => {
                    if !seen.insert(target.rel_path.clone()) {
                        continue;
                    }
                    match read_plan(&target, &args).await {
                        Ok(plan) => {
                            files.push(file_table_entry(&plan, "ready"));
                            plans.push(plan);
                        }
                        Err(error) => {
                            failures.push(json!({
                                "path": target.rel_path,
                                "status": "failed",
                                "error": error,
                            }));
                        }
                    }
                }
                Err(error) => {
                    failures.push(json!({
                        "path": requested_path,
                        "status": "failed",
                        "error": error.to_string(),
                    }));
                }
            }
        }

        files.extend(failures.iter().cloned());

        if !failures.is_empty() {
            return Ok(ToolOutput::failure(
                format!(
                    "multi_replace aborted: {} of {} target files failed; no files changed",
                    failures.len(),
                    files.len()
                ),
                json!({
                    "occurrence": args.occurrence.as_str(),
                    "path_glob": args.path_glob,
                    "target_file_count": files.len(),
                    "error_count": failures.len(),
                    "changed_file_count": 0,
                    "total_replacements": 0,
                    "files": files,
                    "changed_files": [],
                }),
            ));
        }

        match apply_plans(ctx, &plans).await {
            Ok(()) => {
                let changed_files = changed_files_json(&plans);
                let total_replacements = plans.iter().map(|plan| plan.replacements).sum::<usize>();
                Ok(ToolOutput::success(
                    format!(
                        "multi_replace changed {} files with {} replacements across {} targets",
                        changed_files.len(),
                        total_replacements,
                        plans.len()
                    ),
                    json!({
                        "occurrence": args.occurrence.as_str(),
                        "path_glob": args.path_glob,
                        "target_file_count": plans.len(),
                        "changed_file_count": changed_files.len(),
                        "total_replacements": total_replacements,
                        "files": files,
                        "changed_files": changed_files,
                    }),
                ))
            }
            Err(error) => Ok(ToolOutput::failure(
                format!(
                    "multi_replace write failed after preflight: {}; rollback_errors={}",
                    error.message,
                    error.rollback_errors.len()
                ),
                json!({
                    "occurrence": args.occurrence.as_str(),
                    "path_glob": args.path_glob,
                    "target_file_count": plans.len(),
                    "error_count": 1,
                    "changed_file_count": 0,
                    "total_replacements": 0,
                    "files": files,
                    "changed_files": [],
                    "rollback_errors": error.rollback_errors,
                }),
            )),
        }
    }
}

pub(crate) async fn preview_replacements(
    input: &Value,
    ctx: &ToolContext,
) -> Result<Vec<MultiReplacePreview>, ToolError> {
    let args = parse_input(input.clone())?;
    let requested_paths = collect_requested_paths(&args, ctx.fs.project_root())?;
    let mut seen = BTreeSet::new();
    let mut previews = Vec::new();

    for requested_path in requested_paths {
        let target = resolve_target(&requested_path, ctx)?;
        if !seen.insert(target.rel_path.clone()) {
            continue;
        }
        let plan = read_plan(&target, &args)
            .await
            .map_err(|error| ToolError::InvalidInput(format!("{}: {error}", target.rel_path)))?;
        previews.push(MultiReplacePreview {
            path: plan.rel_path,
            before: plan.before,
            after: plan.after,
        });
    }

    Ok(previews)
}

fn parse_input(input: Value) -> Result<Input, ToolError> {
    let args: Input =
        serde_json::from_value(input).map_err(|e| ToolError::InvalidInput(e.to_string()))?;
    if args.find.is_empty() {
        return Err(ToolError::InvalidInput("find must not be empty".into()));
    }
    if args.paths.is_empty() && args.path_glob.as_deref().map_or(true, str::is_empty) {
        return Err(ToolError::InvalidInput(
            "at least one of paths or path_glob is required".into(),
        ));
    }
    Ok(args)
}

fn collect_requested_paths(args: &Input, root: &Path) -> Result<Vec<String>, ToolError> {
    let mut requested_paths = args.paths.clone();
    if let Some(path_glob) = args.path_glob.as_deref().filter(|glob| !glob.is_empty()) {
        requested_paths.extend(resolve_path_glob(path_glob, root)?);
    }
    Ok(requested_paths)
}

async fn read_plan(target: &Target, args: &Input) -> Result<ReplacementPlan, String> {
    let bytes = tokio::fs::read(&target.path)
        .await
        .map_err(|e| format!("unreadable target file: {e}"))?;
    let before =
        String::from_utf8(bytes).map_err(|_| "target file is not valid UTF-8".to_string())?;
    let matches = before.matches(&args.find).count();
    let replacements = args.occurrence.replacement_count(matches);
    let after = args.occurrence.apply(&before, &args.find, &args.replace);
    Ok(ReplacementPlan {
        path: target.path.clone(),
        rel_path: target.rel_path.clone(),
        before,
        after,
        matches,
        replacements,
    })
}

fn resolve_target(requested_path: &str, ctx: &ToolContext) -> Result<Target, ToolError> {
    let path = ctx.fs.resolve(requested_path)?;
    let rel_path = relative_slash_path(&path, ctx.fs.project_root());
    reject_ignored_path(&rel_path)?;
    Ok(Target { path, rel_path })
}

fn reject_ignored_path(rel_path: &str) -> Result<(), ToolError> {
    if rel_path
        .split('/')
        .any(|component| IGNORED_DIRS.contains(&component))
    {
        return Err(ToolError::PathDenied(format!(
            "path is inside ignored directory: {rel_path}"
        )));
    }
    Ok(())
}

fn resolve_path_glob(pattern: &str, root: &Path) -> Result<Vec<String>, ToolError> {
    let glob = PathGlob::new(pattern)?;
    let mut paths = Vec::new();
    visit_glob(root, root, &glob, &mut paths)?;
    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn visit_glob(
    path: &Path,
    root: &Path,
    glob: &PathGlob,
    paths: &mut Vec<String>,
) -> Result<(), ToolError> {
    let meta = std::fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_file() {
        let rel_path = relative_slash_path(path, root);
        if glob.is_match(&rel_path) {
            paths.push(rel_path);
        }
        return Ok(());
    }
    if !meta.is_dir() || should_skip_glob_dir(path, root) {
        return Ok(());
    }

    let mut children = std::fs::read_dir(path)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()?;
    children.sort();
    for child in children {
        visit_glob(&child, root, glob, paths)?;
    }
    Ok(())
}

fn should_skip_glob_dir(path: &Path, root: &Path) -> bool {
    if path == root {
        return false;
    }
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    IGNORED_DIRS.contains(&name)
}

struct PathGlob {
    regex: Regex,
    basename_only: bool,
}

impl PathGlob {
    fn new(pattern: &str) -> Result<Self, ToolError> {
        let normalized = pattern.replace('\\', "/");
        let basename_only = !normalized.contains('/');
        let regex = Regex::new(&glob_to_regex(&normalized))
            .map_err(|e| ToolError::InvalidInput(e.to_string()))?;
        Ok(Self {
            regex,
            basename_only,
        })
    }

    fn is_match(&self, path: &str) -> bool {
        if self.basename_only {
            let basename = path.rsplit('/').next().unwrap_or(path);
            self.regex.is_match(basename)
        } else {
            self.regex.is_match(path)
        }
    }
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

fn relative_slash_path(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn file_table_entry(plan: &ReplacementPlan, status: &str) -> Value {
    json!({
        "path": plan.rel_path,
        "status": status,
        "matches": plan.matches,
        "replacements": plan.replacements,
    })
}

fn changed_files_json(plans: &[ReplacementPlan]) -> Vec<Value> {
    plans
        .iter()
        .filter(|plan| plan.replacements > 0)
        .map(|plan| {
            json!({
                "path": plan.rel_path,
                "replacements": plan.replacements,
            })
        })
        .collect()
}

struct StagedWrite<'a> {
    plan: &'a ReplacementPlan,
    after_tmp: PathBuf,
    backup_tmp: PathBuf,
}

struct ApplyError {
    message: String,
    rollback_errors: Vec<String>,
}

async fn apply_plans(ctx: &ToolContext, plans: &[ReplacementPlan]) -> Result<(), ApplyError> {
    let changed = plans
        .iter()
        .filter(|plan| plan.replacements > 0)
        .collect::<Vec<_>>();
    if changed.is_empty() {
        return Ok(());
    }

    for plan in &changed {
        ctx.fs
            .verify_write_parent(&plan.path)
            .map_err(|e| ApplyError {
                message: format!("{}: {e}", plan.rel_path),
                rollback_errors: Vec::new(),
            })?;
    }

    // `stage_writes` now cleans up any partially-staged temp files itself on
    // failure, so a mid-batch error leaves no `.tmp`/`.bak` residue (the old
    // caller-side cleanup ran against an always-empty vec — a no-op leak).
    let staged = stage_writes(&changed).await?;

    let mut applied = Vec::new();
    for (idx, item) in staged.iter().enumerate() {
        if let Err(error) = tokio::fs::rename(&item.after_tmp, &item.plan.path).await {
            let rollback_errors = rollback_applied(&applied).await;
            cleanup_staged_files(&staged[idx..]).await;
            return Err(ApplyError {
                message: format!("{}: failed to replace file: {error}", item.plan.rel_path),
                rollback_errors,
            });
        }
        applied.push(item);
    }

    cleanup_backups(&staged).await;
    Ok(())
}

async fn stage_writes<'a>(
    plans: &[&'a ReplacementPlan],
) -> Result<Vec<StagedWrite<'a>>, ApplyError> {
    let batch_id = Uuid::new_v4().simple().to_string();
    let mut staged: Vec<StagedWrite<'a>> = Vec::new();
    for (idx, plan) in plans.iter().enumerate() {
        match stage_one(plan, &batch_id, idx).await {
            Ok(item) => staged.push(item),
            Err(error) => {
                // A later plan failed: remove the temp files staged for the
                // earlier plans in this batch so nothing leaks.
                cleanup_staged_files(&staged).await;
                return Err(error);
            }
        }
    }
    Ok(staged)
}

async fn stage_one<'a>(
    plan: &'a ReplacementPlan,
    batch_id: &str,
    idx: usize,
) -> Result<StagedWrite<'a>, ApplyError> {
    let parent = plan.path.parent().ok_or_else(|| ApplyError {
        message: format!("{}: target has no parent directory", plan.rel_path),
        rollback_errors: Vec::new(),
    })?;
    let file_name = plan
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| ApplyError {
            message: format!("{}: target file name is not valid UTF-8", plan.rel_path),
            rollback_errors: Vec::new(),
        })?;
    let after_tmp = parent.join(format!(
        ".{file_name}.dive-multi-replace-{batch_id}-{idx}.tmp"
    ));
    let backup_tmp = parent.join(format!(
        ".{file_name}.dive-multi-replace-{batch_id}-{idx}.bak"
    ));
    if after_tmp.exists() || backup_tmp.exists() {
        return Err(ApplyError {
            message: format!("{}: temporary file already exists", plan.rel_path),
            rollback_errors: Vec::new(),
        });
    }

    // If any step fails after the first write, remove this plan's own partial
    // temp files before returning — otherwise the `.tmp` written just above
    // would be orphaned (the never-cleaned residue the old code left behind).
    if let Err(error) = write_staged_files(plan, &after_tmp, &backup_tmp).await {
        let _ = tokio::fs::remove_file(&after_tmp).await;
        let _ = tokio::fs::remove_file(&backup_tmp).await;
        return Err(error);
    }

    Ok(StagedWrite {
        plan,
        after_tmp,
        backup_tmp,
    })
}

async fn write_staged_files(
    plan: &ReplacementPlan,
    after_tmp: &Path,
    backup_tmp: &Path,
) -> Result<(), ApplyError> {
    tokio::fs::write(after_tmp, &plan.after)
        .await
        .map_err(|e| ApplyError {
            message: format!("{}: failed to stage replacement: {e}", plan.rel_path),
            rollback_errors: Vec::new(),
        })?;
    let permissions = tokio::fs::metadata(&plan.path)
        .await
        .map_err(|e| ApplyError {
            message: format!("{}: failed to read target metadata: {e}", plan.rel_path),
            rollback_errors: Vec::new(),
        })?
        .permissions();
    tokio::fs::set_permissions(after_tmp, permissions)
        .await
        .map_err(|e| ApplyError {
            message: format!(
                "{}: failed to stage replacement permissions: {e}",
                plan.rel_path
            ),
            rollback_errors: Vec::new(),
        })?;
    tokio::fs::write(backup_tmp, &plan.before)
        .await
        .map_err(|e| ApplyError {
            message: format!("{}: failed to stage rollback copy: {e}", plan.rel_path),
            rollback_errors: Vec::new(),
        })?;
    Ok(())
}

async fn rollback_applied(staged: &[&StagedWrite<'_>]) -> Vec<String> {
    let mut errors = Vec::new();
    for item in staged.iter().rev() {
        if let Err(error) = tokio::fs::rename(&item.backup_tmp, &item.plan.path).await {
            errors.push(format!("{}: {error}", item.plan.rel_path));
        }
    }
    errors
}

async fn cleanup_staged_files(staged: &[StagedWrite<'_>]) {
    for item in staged {
        let _ = tokio::fs::remove_file(&item.after_tmp).await;
        let _ = tokio::fs::remove_file(&item.backup_tmp).await;
    }
}

async fn cleanup_backups(staged: &[StagedWrite<'_>]) {
    for item in staged {
        let _ = tokio::fs::remove_file(&item.backup_tmp).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn plan_for(path: PathBuf, rel: &str, before: &str, after: &str) -> ReplacementPlan {
        ReplacementPlan {
            path,
            rel_path: rel.to_string(),
            before: before.to_string(),
            after: after.to_string(),
            matches: 1,
            replacements: 1,
        }
    }

    #[tokio::test]
    async fn stage_writes_leaves_no_residue_when_a_later_plan_fails() {
        // Regression for the staging leak: when staging fails on a later plan,
        // no `.tmp`/`.bak` files from this batch may survive.
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("good.txt"), "old\n").unwrap();
        let good = plan_for(tmp.path().join("good.txt"), "good.txt", "old\n", "new\n");
        // The second target does not exist, so reading its metadata fails
        // partway through staging (after its `.tmp` has been written).
        let missing = plan_for(
            tmp.path().join("missing.txt"),
            "missing.txt",
            "old\n",
            "new\n",
        );

        let plans = [&good, &missing];
        let result = stage_writes(&plans).await;
        assert!(result.is_err(), "staging should fail on the missing target");

        let residue: Vec<String> = std::fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains("dive-multi-replace"))
            .collect();
        assert!(residue.is_empty(), "leaked staged temp files: {residue:?}");
    }

    #[tokio::test]
    async fn multi_replace_applies_across_files_and_supports_first_occurrence() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("one.txt"), "old old\n").unwrap();
        std::fs::write(tmp.path().join("two.txt"), "old\n").unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);

        let out = MultiReplace
            .run(
                json!({
                    "find": "old",
                    "replace": "new",
                    "paths": ["one.txt", "two.txt"]
                }),
                &ctx,
            )
            .await
            .unwrap();

        assert!(out.success);
        assert_eq!(out.full["changed_file_count"], 2);
        assert_eq!(out.full["total_replacements"], 3);
        assert_eq!(out.full["changed_files"][0]["path"], "one.txt");
        assert_eq!(out.full["changed_files"][0]["replacements"], 2);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("one.txt")).unwrap(),
            "new new\n"
        );
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("two.txt")).unwrap(),
            "new\n"
        );

        let out = MultiReplace
            .run(
                json!({
                    "find": "new",
                    "replace": "final",
                    "paths": ["one.txt", "two.txt"],
                    "occurrence": "first"
                }),
                &ctx,
            )
            .await
            .unwrap();

        assert!(out.success);
        assert_eq!(out.full["changed_file_count"], 2);
        assert_eq!(out.full["total_replacements"], 2);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("one.txt")).unwrap(),
            "final new\n"
        );
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("two.txt")).unwrap(),
            "final\n"
        );
    }

    #[tokio::test]
    async fn multi_replace_aborts_without_writes_when_any_target_is_non_utf8() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("good.txt"), "old\n").unwrap();
        std::fs::write(tmp.path().join("bad.bin"), [0xff, 0xfe, 0xfd]).unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);

        let out = MultiReplace
            .run(
                json!({
                    "find": "old",
                    "replace": "new",
                    "paths": ["good.txt", "bad.bin"]
                }),
                &ctx,
            )
            .await
            .unwrap();

        assert!(!out.success);
        assert!(out.summary.contains("no files changed"));
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("good.txt")).unwrap(),
            "old\n"
        );
        assert_eq!(
            std::fs::read(tmp.path().join("bad.bin")).unwrap(),
            [0xff, 0xfe, 0xfd]
        );
        let files = out.full["files"].as_array().unwrap();
        assert!(files.iter().any(|entry| entry["path"] == "good.txt"
            && entry["matches"] == 1
            && entry["replacements"] == 1));
        assert!(files.iter().any(|entry| entry["path"] == "bad.bin"
            && entry["status"] == "failed"
            && entry["error"].as_str().unwrap().contains("UTF-8")));
    }

    #[tokio::test]
    async fn multi_replace_denies_sandbox_escape_without_writes() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("good.txt"), "old\n").unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);

        let out = MultiReplace
            .run(
                json!({
                    "find": "old",
                    "replace": "new",
                    "paths": ["good.txt", "../escape.txt"]
                }),
                &ctx,
            )
            .await
            .unwrap();

        assert!(!out.success);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("good.txt")).unwrap(),
            "old\n"
        );
        assert!(out.full["files"].as_array().unwrap().iter().any(|entry| {
            entry["path"] == "../escape.txt"
                && entry["status"] == "failed"
                && entry["error"].as_str().unwrap().contains("path denied")
        }));
    }

    #[tokio::test]
    async fn multi_replace_path_glob_excludes_ignored_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("src")).unwrap();
        std::fs::create_dir_all(tmp.path().join("node_modules/pkg")).unwrap();
        std::fs::write(tmp.path().join("src/app.txt"), "old\n").unwrap();
        std::fs::write(tmp.path().join("node_modules/pkg/app.txt"), "old\n").unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);

        let out = MultiReplace
            .run(
                json!({
                    "find": "old",
                    "replace": "new",
                    "path_glob": "**/*.txt"
                }),
                &ctx,
            )
            .await
            .unwrap();

        assert!(out.success);
        assert_eq!(out.full["target_file_count"], 1);
        assert_eq!(out.full["changed_files"][0]["path"], "src/app.txt");
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("src/app.txt")).unwrap(),
            "new\n"
        );
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("node_modules/pkg/app.txt")).unwrap(),
            "old\n"
        );
    }
}
