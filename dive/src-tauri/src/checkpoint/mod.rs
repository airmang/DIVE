//! Checkpoint engine. Spec §6.5.
//!
//! Each DIVE project owns a **bare git repo at `.dive/git/`** that the user's
//! own `.git` (if any) never touches. Every D/I/V transition, every manual
//! save, and every restore are atomic git commits in this sidecar repo.
//! git2-rs is used with the `vendored-libgit2` feature so Windows and ARM64
//! builds do not depend on a system libgit2.
//!
//! Design notes:
//! - Bare repository + explicit work-tree argument. We never use the user's
//!   own `.git`; `.dive/git/` owns the history.
//! - WAL sidecars (`*.sqlite-wal`, `*.sqlite-shm`), the `.dive/` dir itself,
//!   `.dive/*.tmp`, and common build outputs (`node_modules`, `target`,
//!   `dist`) are excluded from `add_all` via an `IndexMatchedPath` filter.
//! - Restore performs a reset-hard to the selected commit, but first takes
//!   an implicit "복원 직전" checkpoint so the operation is reversible.
//! - Concurrency: single user, single process. No advisory lock.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use git2::{Delta, IndexAddOption, ObjectType, Oid, Repository, RepositoryInitOptions, Signature};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::db::dao::{
    card as card_dao, checkpoint as checkpoint_dao, message as message_dao, step as step_dao,
    step_session_mapping as mapping_dao, workmap as workmap_dao,
};
use crate::db::models::{
    CardRow, CheckpointRow, CheckpointStats, MessageRow, NewCheckpoint, StepRow,
    StepSessionMappingRow, WorkmapRow,
};
use crate::db::Database;

pub const CHECKPOINT_DIR: &str = ".dive/git";

const DEFAULT_BRANCH: &str = "main";
const COMMITTER_NAME: &str = "DIVE";
const COMMITTER_EMAIL: &str = "dive@local";

#[derive(Debug, Error)]
pub enum CheckpointError {
    #[error("git: {0}")]
    Git(#[from] git2::Error),
    #[error("db: {0}")]
    Db(String),
    #[error("project root does not exist: {0}")]
    ProjectRootMissing(PathBuf),
    #[error("checkpoint {0} not found")]
    CheckpointNotFound(i64),
    #[error("invalid kind: {0}")]
    InvalidKind(String),
}

pub struct CheckpointEngine {
    pub project_root: PathBuf,
    pub db: Arc<Mutex<Database>>,
}

#[derive(Debug, Clone)]
struct CheckpointCommit {
    sha: String,
    changed_files: Vec<String>,
    stats: CheckpointStats,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionStateSnapshot {
    pub cards: Vec<CardRow>,
    pub messages: Vec<MessageRow>,
    pub workmap: Option<WorkmapRow>,
    #[serde(default)]
    pub steps: Vec<StepRow>,
    pub step_session_mappings: Vec<StepSessionMappingRow>,
}

impl CheckpointEngine {
    pub fn new(project_root: impl Into<PathBuf>, db: Arc<Mutex<Database>>) -> Self {
        Self {
            project_root: project_root.into(),
            db,
        }
    }

    pub fn checkpoint_dir(&self) -> PathBuf {
        self.project_root.join(CHECKPOINT_DIR)
    }

    pub fn init(&self) -> Result<(), CheckpointError> {
        if !self.project_root.exists() {
            return Err(CheckpointError::ProjectRootMissing(
                self.project_root.clone(),
            ));
        }
        let dir = self.checkpoint_dir();
        if dir.join("HEAD").exists() {
            return Ok(());
        }
        std::fs::create_dir_all(&dir)?;
        let mut opts = RepositoryInitOptions::new();
        opts.bare(true);
        opts.initial_head(DEFAULT_BRANCH);
        let repo = Repository::init_opts(&dir, &opts)?;
        self.commit_snapshot(&repo, "init")?;
        Ok(())
    }

    pub fn create_checkpoint(
        &self,
        session_id: i64,
        card_id: Option<i64>,
        kind: &str,
        label: Option<&str>,
    ) -> Result<CheckpointRow, CheckpointError> {
        validate_kind(kind)?;
        let repo = self.open_repo()?;
        let message = label.unwrap_or_else(|| default_label(kind));
        let commit = self.commit_snapshot(&repo, message)?;
        self.persist_checkpoint(session_id, card_id, kind, label, commit)
    }

    /// S-032 pre-edit anchor: like [`create_checkpoint`], but commits **only**
    /// when the working tree differs from the latest checkpoint. Returns
    /// `Ok(None)` when nothing changed, so snapshotting before every approved
    /// write (including read-only/no-op tool runs) does not spawn redundant
    /// restore points. The first write of a clean tree is already covered by
    /// the surrounding card-transition checkpoint.
    pub fn create_checkpoint_if_changed(
        &self,
        session_id: i64,
        card_id: Option<i64>,
        kind: &str,
        label: Option<&str>,
    ) -> Result<Option<CheckpointRow>, CheckpointError> {
        validate_kind(kind)?;
        let repo = self.open_repo()?;
        let message = label.unwrap_or_else(|| default_label(kind));
        let Some(commit) = self.commit_snapshot_opt(&repo, message, true)? else {
            return Ok(None);
        };
        self.persist_checkpoint(session_id, card_id, kind, label, commit)
            .map(Some)
    }

    pub fn create_checkpoint_if_changed_with_snapshot(
        &self,
        session_id: i64,
        card_id: Option<i64>,
        kind: &str,
        label: Option<&str>,
        session_state_snapshot: String,
    ) -> Result<Option<CheckpointRow>, CheckpointError> {
        validate_kind(kind)?;
        let repo = self.open_repo()?;
        let message = label.unwrap_or_else(|| default_label(kind));
        let commit = match self.commit_snapshot_opt(&repo, message, true)? {
            Some(commit) => commit,
            None => {
                if self.latest_checkpoint_matches_snapshot(
                    session_id,
                    kind,
                    &session_state_snapshot,
                )? {
                    return Ok(None);
                }
                self.commit_snapshot(&repo, message)?
            }
        };
        self.persist_checkpoint_with_snapshot(
            session_id,
            card_id,
            kind,
            label,
            commit,
            Some(session_state_snapshot),
        )
        .map(Some)
    }

    pub fn capture_session_state_snapshot(
        &self,
        session_id: i64,
    ) -> Result<String, CheckpointError> {
        let db = self
            .db
            .lock()
            .map_err(|e| CheckpointError::Db(e.to_string()))?;
        serialize_session_state_snapshot(db.conn(), session_id)
    }

    fn latest_checkpoint_matches_snapshot(
        &self,
        session_id: i64,
        kind: &str,
        session_state_snapshot: &str,
    ) -> Result<bool, CheckpointError> {
        let db = self
            .db
            .lock()
            .map_err(|e| CheckpointError::Db(e.to_string()))?;
        let latest = checkpoint_dao::list_by_session(db.conn(), session_id)
            .map_err(|e| CheckpointError::Db(e.to_string()))?
            .into_iter()
            .max_by_key(|row| (row.created_at, row.id));
        Ok(latest.is_some_and(|row| {
            row.kind == kind
                && row.session_state_snapshot.as_deref() == Some(session_state_snapshot)
        }))
    }

    fn persist_checkpoint(
        &self,
        session_id: i64,
        card_id: Option<i64>,
        kind: &str,
        label: Option<&str>,
        commit: CheckpointCommit,
    ) -> Result<CheckpointRow, CheckpointError> {
        self.persist_checkpoint_with_snapshot(session_id, card_id, kind, label, commit, None)
    }

    fn persist_checkpoint_with_snapshot(
        &self,
        session_id: i64,
        card_id: Option<i64>,
        kind: &str,
        label: Option<&str>,
        commit: CheckpointCommit,
        session_state_snapshot: Option<String>,
    ) -> Result<CheckpointRow, CheckpointError> {
        let db = self
            .db
            .lock()
            .map_err(|e| CheckpointError::Db(e.to_string()))?;
        let session_state_snapshot = match session_state_snapshot {
            Some(snapshot) => Some(snapshot),
            None => Some(serialize_session_state_snapshot(db.conn(), session_id)?),
        };
        let id = checkpoint_dao::insert(
            db.conn(),
            &NewCheckpoint {
                session_id,
                card_id,
                git_sha: commit.sha.clone(),
                kind: kind.to_string(),
                label: label.map(str::to_string),
                changed_files: commit.changed_files,
                stats: commit.stats,
                session_state_snapshot,
            },
        )
        .map_err(|e| CheckpointError::Db(e.to_string()))?;
        checkpoint_dao::get_by_id(db.conn(), id)
            .map_err(|e| CheckpointError::Db(e.to_string()))?
            .ok_or(CheckpointError::CheckpointNotFound(id))
    }

    pub fn list_checkpoints(&self, session_id: i64) -> Result<Vec<CheckpointRow>, CheckpointError> {
        let db = self
            .db
            .lock()
            .map_err(|e| CheckpointError::Db(e.to_string()))?;
        checkpoint_dao::list_by_session(db.conn(), session_id)
            .map_err(|e| CheckpointError::Db(e.to_string()))
    }

    pub fn restore_checkpoint(&self, checkpoint_id: i64) -> Result<(), CheckpointError> {
        let target = {
            let db = self
                .db
                .lock()
                .map_err(|e| CheckpointError::Db(e.to_string()))?;
            checkpoint_dao::get_by_id(db.conn(), checkpoint_id)
                .map_err(|e| CheckpointError::Db(e.to_string()))?
                .ok_or(CheckpointError::CheckpointNotFound(checkpoint_id))?
        };

        // S-032: store no prose label — the "auto-pre-restore" kind is localized
        // in the UI, so the stored label stays locale-neutral (NULL). The git
        // commit message still uses the internal default_label fallback.
        self.create_checkpoint(target.session_id, target.card_id, "auto-pre-restore", None)?;

        let repo = self.open_repo()?;
        let oid = git2::Oid::from_str(&target.git_sha)?;
        let commit = repo.find_commit(oid)?;
        let tree = commit.tree()?;

        self.clear_tracked_worktree(&repo)?;
        write_tree_to_disk(&repo, &tree, &self.project_root)?;

        repo.reference("HEAD", oid, true, "checkpoint restore")?;
        if let Some(snapshot) = target.session_state_snapshot.as_deref() {
            self.restore_session_state(target.session_id, snapshot)?;
        }
        Ok(())
    }

    fn restore_session_state(
        &self,
        session_id: i64,
        raw_snapshot: &str,
    ) -> Result<(), CheckpointError> {
        let snapshot: SessionStateSnapshot =
            serde_json::from_str(raw_snapshot).map_err(|e| CheckpointError::Db(e.to_string()))?;
        let mut db = self
            .db
            .lock()
            .map_err(|e| CheckpointError::Db(e.to_string()))?;
        let tx = db
            .conn_mut()
            .transaction()
            .map_err(|e| CheckpointError::Db(e.to_string()))?;
        let checkpoint_card_links = checkpoint_card_links_for_session(&tx, session_id)?;
        let snapshot_plan_ids: BTreeSet<i64> =
            snapshot.steps.iter().map(|step| step.plan_id).collect();
        let snapshot_step_ids: BTreeSet<i64> = snapshot.steps.iter().map(|step| step.id).collect();

        tx.execute("DELETE FROM Message WHERE session_id = ?", [session_id])
            .map_err(|e| CheckpointError::Db(e.to_string()))?;
        tx.execute(
            "DELETE FROM StepSessionMapping WHERE session_id = ?",
            [session_id],
        )
        .map_err(|e| CheckpointError::Db(e.to_string()))?;
        if !snapshot_plan_ids.is_empty() {
            // PlanMutation is an append-only audit ledger. A consistent restore
            // replays Step, the user-visible plan structure; post-snapshot audit
            // rows remain as history, and SQLite may NULL their deleted step_db_id.
            for plan_id in &snapshot_plan_ids {
                let current_step_ids = {
                    let mut stmt = tx
                        .prepare("SELECT id FROM Step WHERE plan_id = ?")
                        .map_err(|e| CheckpointError::Db(e.to_string()))?;
                    let rows = stmt
                        .query_map([plan_id], |row| row.get::<_, i64>(0))
                        .map_err(|e| CheckpointError::Db(e.to_string()))?;
                    let mut ids = Vec::new();
                    for row in rows {
                        ids.push(row.map_err(|e| CheckpointError::Db(e.to_string()))?);
                    }
                    ids
                };
                for step_id in current_step_ids {
                    if !snapshot_step_ids.contains(&step_id) {
                        tx.execute("DELETE FROM Step WHERE id = ?", [step_id])
                            .map_err(|e| CheckpointError::Db(e.to_string()))?;
                    }
                }
            }
            for step in &snapshot.steps {
                upsert_step_row(&tx, step)?;
            }
        }
        tx.execute("DELETE FROM Workmap WHERE session_id = ?", [session_id])
            .map_err(|e| CheckpointError::Db(e.to_string()))?;
        tx.execute("DELETE FROM Card WHERE session_id = ?", [session_id])
            .map_err(|e| CheckpointError::Db(e.to_string()))?;

        for card in &snapshot.cards {
            let changed_files = optional_json_string(card.changed_files.as_ref())?;
            tx.execute(
                "INSERT INTO Card(id, session_id, title, instruction, assist_summary, acceptance_criteria, retrospective, change_summary, state, verify_log, changed_files, test_command, approval_judgment, approval_provenance, position, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    card.id,
                    card.session_id,
                    card.title,
                    card.instruction,
                    card.assist_summary,
                    card.acceptance_criteria,
                    card.retrospective,
                    card.change_summary,
                    card.state,
                    card.verify_log,
                    changed_files,
                    card.test_command,
                    card.approval_judgment,
                    card.approval_provenance,
                    card.position,
                    card.created_at,
                    card.updated_at,
                ],
            )
            .map_err(|e| CheckpointError::Db(e.to_string()))?;
        }

        for (checkpoint_id, card_id) in &checkpoint_card_links {
            tx.execute(
                "UPDATE Checkpoint
                    SET card_id = ?
                  WHERE id = ?
                    AND EXISTS (SELECT 1 FROM Card WHERE id = ?)",
                params![card_id, checkpoint_id, card_id],
            )
            .map_err(|e| CheckpointError::Db(e.to_string()))?;
        }

        if let Some(workmap) = &snapshot.workmap {
            tx.execute(
                "INSERT INTO Workmap(session_id, current_stage, collapsed, current_card_id) VALUES (?, ?, ?, ?)",
                params![
                    workmap.session_id,
                    workmap.current_stage,
                    workmap.collapsed,
                    workmap.current_card_id,
                ],
            )
            .map_err(|e| CheckpointError::Db(e.to_string()))?;
        }

        for message in &snapshot.messages {
            let tool_calls = optional_json_string(message.tool_calls.as_ref())?;
            let usage = optional_json_string(message.usage.as_ref())?;
            tx.execute(
                "INSERT INTO Message(id, session_id, card_id, role, content, reasoning_content, tool_calls, usage, provider, model, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    message.id,
                    message.session_id,
                    message.card_id,
                    message.role,
                    message.content,
                    message.reasoning_content,
                    tool_calls,
                    usage,
                    message.provider,
                    message.model,
                    message.created_at,
                ],
            )
            .map_err(|e| CheckpointError::Db(e.to_string()))?;
        }

        for mapping in &snapshot.step_session_mappings {
            let checkpoint_ids = optional_json_string(mapping.checkpoint_ids.as_ref())?;
            tx.execute(
                "INSERT OR REPLACE INTO StepSessionMapping(id, step_id, session_id, card_id, state_path, status, started_at, completed_at, checkpoint_ids, verification_status, verification_evidence, user_decision, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    mapping.id,
                    mapping.step_id,
                    mapping.session_id,
                    mapping.card_id,
                    mapping.state_path,
                    mapping.status,
                    mapping.started_at,
                    mapping.completed_at,
                    checkpoint_ids,
                    mapping.verification_status,
                    mapping.verification_evidence,
                    mapping.user_decision,
                    mapping.created_at,
                    mapping.updated_at,
                ],
            )
            .map_err(|e| CheckpointError::Db(e.to_string()))?;
        }

        tx.commit()
            .map_err(|e| CheckpointError::Db(e.to_string()))?;
        Ok(())
    }

    fn clear_tracked_worktree(&self, repo: &Repository) -> Result<(), CheckpointError> {
        let head_tree = match repo.head().and_then(|h| h.peel_to_tree()) {
            Ok(t) => t,
            Err(_) => return Ok(()),
        };
        head_tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
            if entry.kind() == Some(ObjectType::Blob) {
                if let Some(name) = entry.name() {
                    let rel = if dir.is_empty() {
                        PathBuf::from(name)
                    } else {
                        PathBuf::from(dir).join(name)
                    };
                    let p = self.project_root.join(&rel);
                    let _ = std::fs::remove_file(&p);
                }
            }
            git2::TreeWalkResult::Ok
        })?;
        Ok(())
    }

    fn open_repo(&self) -> Result<Repository, CheckpointError> {
        let repo = Repository::open_bare(self.checkpoint_dir())?;
        Ok(repo)
    }

    fn commit_snapshot(
        &self,
        repo: &Repository,
        message: &str,
    ) -> Result<CheckpointCommit, CheckpointError> {
        self.commit_snapshot_opt(repo, message, false)
            .map(|c| c.expect("forced snapshot always commits"))
    }

    /// Snapshot the working tree into the sidecar repo. When `skip_if_unchanged`
    /// is set and the tree is identical to the current HEAD, returns `Ok(None)`
    /// without creating an (empty) commit.
    fn commit_snapshot_opt(
        &self,
        repo: &Repository,
        message: &str,
        skip_if_unchanged: bool,
    ) -> Result<Option<CheckpointCommit>, CheckpointError> {
        repo.set_workdir(&self.project_root, false)?;
        let mut index = repo.index()?;
        index.clear()?;
        index.add_all(
            ["*"].iter(),
            IndexAddOption::DEFAULT,
            Some(&mut path_filter),
        )?;
        let tree_oid = index.write_tree_to(repo)?;

        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        if skip_if_unchanged {
            if let Some(parent) = parent.as_ref() {
                if parent.tree_id() == tree_oid {
                    return Ok(None);
                }
            }
        }

        let tree = repo.find_tree(tree_oid)?;
        let sig = Signature::now(COMMITTER_NAME, COMMITTER_EMAIL)?;
        let parent_oid = parent.as_ref().map(|p| p.id());
        let parents: Vec<&git2::Commit> = parent.as_ref().map(|p| vec![p]).unwrap_or_default();

        let commit_oid =
            repo.commit(Some("HEAD"), &sig, &sig, message, &tree, parents.as_slice())?;
        let (changed_files, stats) = checkpoint_metadata(repo, parent_oid, commit_oid)?;
        Ok(Some(CheckpointCommit {
            sha: commit_oid.to_string(),
            changed_files,
            stats,
        }))
    }
}

fn checkpoint_metadata(
    repo: &Repository,
    parent_oid: Option<Oid>,
    commit_oid: Oid,
) -> Result<(Vec<String>, CheckpointStats), CheckpointError> {
    let new_commit = repo.find_commit(commit_oid)?;
    let new_tree = new_commit.tree()?;
    let old_tree = parent_oid
        .map(|oid| repo.find_commit(oid).and_then(|commit| commit.tree()))
        .transpose()?;
    let diff = repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), None)?;
    let mut changed_files = Vec::new();
    let mut stats = CheckpointStats::zero();

    diff.foreach(
        &mut |delta, _| {
            if let Some(path) = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .and_then(path_to_checkpoint_string)
            {
                changed_files.push(path);
            }
            match delta.status() {
                Delta::Added => stats.added += 1,
                Delta::Deleted => stats.removed += 1,
                _ => stats.modified += 1,
            }
            true
        },
        None,
        None,
        None,
    )?;
    changed_files.sort();
    changed_files.dedup();
    Ok((changed_files, stats))
}

fn path_to_checkpoint_string(path: &Path) -> Option<String> {
    let s = path.to_string_lossy().replace('\\', "/");
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn serialize_session_state_snapshot(
    conn: &rusqlite::Connection,
    session_id: i64,
) -> Result<String, CheckpointError> {
    let step_session_mappings = mapping_dao::list_by_session(conn, session_id)
        .map_err(|e| CheckpointError::Db(e.to_string()))?;
    let snapshot = SessionStateSnapshot {
        cards: card_dao::list_by_session(conn, session_id)
            .map_err(|e| CheckpointError::Db(e.to_string()))?,
        messages: message_dao::list_by_session(conn, session_id, i64::MAX)
            .map_err(|e| CheckpointError::Db(e.to_string()))?,
        workmap: workmap_dao::get(conn, session_id)
            .map_err(|e| CheckpointError::Db(e.to_string()))?,
        steps: steps_for_session_plans(conn, &step_session_mappings)?,
        step_session_mappings,
    };
    serde_json::to_string(&snapshot).map_err(|e| CheckpointError::Db(e.to_string()))
}

fn steps_for_session_plans(
    conn: &rusqlite::Connection,
    mappings: &[StepSessionMappingRow],
) -> Result<Vec<StepRow>, CheckpointError> {
    let mut plan_ids = BTreeSet::new();
    for mapping in mappings {
        if let Some(step) = step_dao::get_by_id(conn, mapping.step_id)
            .map_err(|e| CheckpointError::Db(e.to_string()))?
        {
            plan_ids.insert(step.plan_id);
        }
    }

    let mut steps = Vec::new();
    for plan_id in plan_ids {
        steps.extend(
            step_dao::list_by_plan(conn, plan_id)
                .map_err(|e| CheckpointError::Db(e.to_string()))?,
        );
    }
    Ok(steps)
}

fn checkpoint_card_links_for_session(
    conn: &rusqlite::Connection,
    session_id: i64,
) -> Result<Vec<(i64, i64)>, CheckpointError> {
    let mut stmt = conn
        .prepare("SELECT id, card_id FROM Checkpoint WHERE session_id = ? AND card_id IS NOT NULL")
        .map_err(|e| CheckpointError::Db(e.to_string()))?;
    let rows = stmt
        .query_map([session_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| CheckpointError::Db(e.to_string()))?;
    let mut links = Vec::new();
    for row in rows {
        links.push(row.map_err(|e| CheckpointError::Db(e.to_string()))?);
    }
    Ok(links)
}

fn upsert_step_row(conn: &rusqlite::Connection, step: &StepRow) -> Result<(), CheckpointError> {
    let expected_files = optional_json_string(step.expected_files.as_ref())?;
    let acceptance_criteria = optional_json_string(step.acceptance_criteria.as_ref())?;
    let dependencies = optional_json_string(step.dependencies.as_ref())?;
    conn.execute(
        "DELETE FROM Step WHERE plan_id = ? AND step_id = ? AND id <> ?",
        params![step.plan_id, step.step_id, step.id],
    )
    .map_err(|e| CheckpointError::Db(e.to_string()))?;
    let updated = conn
        .execute(
            "UPDATE Step
                SET plan_id = ?,
                    step_id = ?,
                    title = ?,
                    summary = ?,
                    instruction_seed = ?,
                    expected_files = ?,
                    acceptance_criteria = ?,
                    verification_kind = ?,
                    verification_command = ?,
                    verification_manual_check = ?,
                    dependencies = ?,
                    parallel_group = ?,
                    position = ?,
                    created_at = ?,
                    updated_at = ?,
                    status = ?,
                    superseded_by_step_id = ?,
                    suppression_reason = ?
              WHERE id = ?",
            params![
                step.plan_id,
                step.step_id,
                step.title,
                step.summary,
                step.instruction_seed,
                expected_files,
                acceptance_criteria,
                step.verification_kind,
                step.verification_command,
                step.verification_manual_check,
                dependencies,
                step.parallel_group,
                step.position,
                step.created_at,
                step.updated_at,
                step.status,
                step.superseded_by_step_id,
                step.suppression_reason,
                step.id,
            ],
        )
        .map_err(|e| CheckpointError::Db(e.to_string()))?;
    if updated == 0 {
        conn.execute(
            "INSERT INTO Step(id, plan_id, step_id, title, summary, instruction_seed, expected_files, acceptance_criteria, verification_kind, verification_command, verification_manual_check, dependencies, parallel_group, position, created_at, updated_at, status, superseded_by_step_id, suppression_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                step.id,
                step.plan_id,
                step.step_id,
                step.title,
                step.summary,
                step.instruction_seed,
                expected_files,
                acceptance_criteria,
                step.verification_kind,
                step.verification_command,
                step.verification_manual_check,
                dependencies,
                step.parallel_group,
                step.position,
                step.created_at,
                step.updated_at,
                step.status,
                step.superseded_by_step_id,
                step.suppression_reason,
            ],
        )
        .map_err(|e| CheckpointError::Db(e.to_string()))?;
    }
    Ok(())
}

fn optional_json_string(value: Option<&Value>) -> Result<Option<String>, CheckpointError> {
    value
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| CheckpointError::Db(e.to_string()))
}

fn write_tree_to_disk(
    repo: &Repository,
    tree: &git2::Tree<'_>,
    root: &Path,
) -> Result<(), CheckpointError> {
    tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
        if entry.kind() != Some(ObjectType::Blob) {
            return git2::TreeWalkResult::Ok;
        }
        let Some(name) = entry.name() else {
            return git2::TreeWalkResult::Ok;
        };
        let rel = if dir.is_empty() {
            PathBuf::from(name)
        } else {
            PathBuf::from(dir).join(name)
        };
        let abs = root.join(&rel);
        if let Some(parent) = abs.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(obj) = entry.to_object(repo) {
            if let Some(blob) = obj.as_blob() {
                let _ = std::fs::write(&abs, blob.content());
            }
        }
        git2::TreeWalkResult::Ok
    })?;
    Ok(())
}

fn path_filter(path: &Path, _matched_spec: &[u8]) -> i32 {
    let s = path.to_string_lossy();
    if s.starts_with(".dive/")
        || s.contains(".sqlite-wal")
        || s.contains(".sqlite-shm")
        || s.contains(".sqlite-journal")
        || s.contains(".dive.tmp")
        || s.starts_with("node_modules/")
        || s.starts_with("target/")
        || s.starts_with("dist/")
    {
        return 1;
    }
    0
}

fn validate_kind(kind: &str) -> Result<(), CheckpointError> {
    match kind {
        "auto" | "manual" | "auto-pre-restore" | "auto-pre-edit" | "auto-pre-pivot" => Ok(()),
        other => Err(CheckpointError::InvalidKind(other.to_string())),
    }
}

fn default_label(kind: &str) -> &'static str {
    // Used only for the internal git commit message. Auto kinds store a
    // locale-neutral (NULL) DB label and are localized by kind in the UI.
    match kind {
        "init" => "init",
        "auto" => "자동 체크포인트",
        "auto-pre-restore" => "복원 직전",
        "auto-pre-edit" => "편집 직전",
        "auto-pre-pivot" => "계획 조정 직전",
        "manual" => "수동 체크포인트",
        _ => "체크포인트",
    }
}

impl From<std::io::Error> for CheckpointError {
    fn from(e: std::io::Error) -> Self {
        CheckpointError::Db(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dao::{
        card, message, plan, project, session, step, step_session_mapping, workmap,
    };
    use crate::db::models::{
        CardState, NewCard, NewMessage, NewPlan, NewProject, NewSession, NewStep,
        NewStepSessionMapping, NewWorkmap,
    };
    use serde_json::json;

    fn engine_with_tempdir() -> (CheckpointEngine, tempfile::TempDir, i64) {
        let tmp = tempfile::tempdir().unwrap();
        let db_file = tempfile::NamedTempFile::new().unwrap();
        let mut db = Database::open(db_file.path()).unwrap();
        db.migrate().unwrap();
        let pid = project::insert(
            db.conn(),
            &NewProject {
                name: "p".into(),
                path: tmp.path().to_string_lossy().into(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        let sid = session::insert(
            db.conn(),
            &NewSession {
                project_id: pid,
                title: "s".into(),
                ended_at: None,
                status: "active".into(),
            },
        )
        .unwrap();
        Box::leak(Box::new(db_file));
        let engine = CheckpointEngine::new(tmp.path(), Arc::new(Mutex::new(db)));
        (engine, tmp, sid)
    }

    fn current_session_snapshot(
        engine: &CheckpointEngine,
        session_id: i64,
    ) -> SessionStateSnapshot {
        let db = engine.db.lock().unwrap();
        let raw = serialize_session_state_snapshot(db.conn(), session_id).unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    fn project_id_for_session(engine: &CheckpointEngine, session_id: i64) -> i64 {
        let db = engine.db.lock().unwrap();
        db.conn()
            .query_row(
                "SELECT project_id FROM Session WHERE id = ?",
                [session_id],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn seed_session_state_rows(engine: &CheckpointEngine, session_id: i64) -> (i64, i64, i64, i64) {
        let project_id = project_id_for_session(engine, session_id);
        let db = engine.db.lock().unwrap();
        let card_id = card::insert(
            db.conn(),
            &NewCard {
                session_id,
                title: "Snapshot card".into(),
                instruction: Some("Do the saved work".into()),
                assist_summary: Some("Saved assist".into()),
                acceptance_criteria: Some("Saved criterion".into()),
                retrospective: Some("Saved retrospective".into()),
                change_summary: Some("Saved change".into()),
                state: CardState::Instructed,
                verify_log: Some("{\"test_result\":\"pass\"}".into()),
                changed_files: Some(json!(["src/lib.rs"])),
                test_command: Some("cargo test".into()),
                approval_judgment: Some("approved".into()),
                approval_provenance: Some("{\"source\":\"test\"}".into()),
                position: 1,
            },
        )
        .unwrap();
        workmap::upsert(
            db.conn(),
            &NewWorkmap {
                session_id,
                current_stage: "I".into(),
                collapsed: true,
                current_card_id: Some(card_id),
            },
        )
        .unwrap();
        message::insert(
            db.conn(),
            &NewMessage {
                session_id,
                card_id: Some(card_id),
                role: "assistant".into(),
                content: "Saved answer".into(),
                reasoning_content: Some("Saved reasoning".into()),
                tool_calls: Some(json!([{ "name": "read_file" }])),
                usage: Some(json!({ "input_tokens": 1 })),
                provider: Some("mock".into()),
                model: Some("mock-model".into()),
            },
        )
        .unwrap();
        let plan_id = plan::insert(
            db.conn(),
            &NewPlan {
                project_id,
                interview_id: None,
                goal: "Saved goal".into(),
                intent_summary: Some("Saved intent".into()),
                scope: Some(json!(["scope"])),
                non_goals: Some(json!([])),
                constraints: Some(json!([])),
                acceptance_criteria: Some(json!(["Saved criterion"])),
                status: "approved".into(),
            },
        )
        .unwrap();
        let step_id = step::insert(
            db.conn(),
            &NewStep {
                plan_id,
                step_id: "step-001".into(),
                title: "Saved step".into(),
                summary: Some("Saved summary".into()),
                instruction_seed: Some("Saved seed".into()),
                expected_files: Some(json!(["src/lib.rs"])),
                acceptance_criteria: Some(json!(["Saved criterion"])),
                verification_kind: Some("command".into()),
                verification_command: Some("cargo test".into()),
                verification_manual_check: None,
                dependencies: Some(json!([])),
                parallel_group: None,
                position: 1,
            },
        )
        .unwrap();
        let mapping_id = step_session_mapping::insert(
            db.conn(),
            &NewStepSessionMapping {
                step_id,
                session_id: Some(session_id),
                card_id: Some(card_id),
                state_path: Some("step-001".into()),
                status: "in_progress".into(),
                started_at: Some(100),
                completed_at: None,
                checkpoint_ids: Some(json!(["cp-saved"])),
                verification_status: Some("running".into()),
                verification_evidence: Some("saved evidence".into()),
                user_decision: Some("continue".into()),
            },
        )
        .unwrap();
        (card_id, mapping_id, plan_id, step_id)
    }

    fn insert_extra_step(engine: &CheckpointEngine, plan_id: i64, step_id: &str) -> i64 {
        let db = engine.db.lock().unwrap();
        step::insert(
            db.conn(),
            &NewStep {
                plan_id,
                step_id: step_id.into(),
                title: format!("Extra {step_id}"),
                summary: Some("Added after checkpoint".into()),
                instruction_seed: Some("Extra seed".into()),
                expected_files: Some(json!(["src/extra.rs"])),
                acceptance_criteria: Some(json!(["Extra criterion"])),
                verification_kind: Some("manual".into()),
                verification_command: None,
                verification_manual_check: Some("Inspect manually".into()),
                dependencies: Some(json!([])),
                parallel_group: None,
                position: 2,
            },
        )
        .unwrap()
    }

    fn mutate_session_state_rows(engine: &CheckpointEngine, session_id: i64) {
        let db = engine.db.lock().unwrap();
        db.conn()
            .execute(
                "UPDATE Card SET title = 'Mutated card', state = 'verified' WHERE session_id = ?",
                [session_id],
            )
            .unwrap();
        db.conn()
            .execute(
                "UPDATE Message SET content = 'Mutated answer' WHERE session_id = ?",
                [session_id],
            )
            .unwrap();
        db.conn()
            .execute(
                "UPDATE Workmap SET current_stage = 'V', collapsed = 0 WHERE session_id = ?",
                [session_id],
            )
            .unwrap();
        db.conn()
            .execute(
                "UPDATE StepSessionMapping SET status = 'done', completed_at = 200, verification_status = 'passed' WHERE session_id = ?",
                [session_id],
            )
            .unwrap();
    }

    #[test]
    fn init_is_idempotent() {
        let (engine, _tmp, _) = engine_with_tempdir();
        engine.init().unwrap();
        assert!(engine.checkpoint_dir().join("HEAD").exists());
        engine.init().unwrap();
    }

    #[test]
    fn create_roundtrip_and_list() {
        let (engine, tmp, sid) = engine_with_tempdir();
        engine.init().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "hello").unwrap();
        let cp = engine
            .create_checkpoint(sid, None, "manual", Some("first save"))
            .unwrap();
        assert_eq!(cp.kind, "manual");
        assert_eq!(cp.label.as_deref(), Some("first save"));
        assert_eq!(cp.git_sha.len(), 40);

        let list = engine.list_checkpoints(sid).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].git_sha, cp.git_sha);
    }

    #[test]
    fn restore_brings_file_back_and_auto_snapshots() {
        let (engine, tmp, sid) = engine_with_tempdir();
        engine.init().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "v1").unwrap();
        let v1 = engine
            .create_checkpoint(sid, None, "manual", Some("v1"))
            .unwrap();

        std::fs::write(tmp.path().join("a.txt"), "v2").unwrap();
        engine
            .create_checkpoint(sid, None, "manual", Some("v2"))
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("a.txt")).unwrap(),
            "v2"
        );

        engine.restore_checkpoint(v1.id).unwrap();
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("a.txt")).unwrap(),
            "v1"
        );

        let list = engine.list_checkpoints(sid).unwrap();
        assert!(
            list.iter()
                .any(|c| c.kind == "auto-pre-restore" && c.label.is_none()),
            "restore must auto-create a locale-neutral backup checkpoint, got {list:?}",
        );
    }

    #[test]
    fn restore_reapplies_session_state_snapshot() {
        let (engine, tmp, sid) = engine_with_tempdir();
        engine.init().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "v1").unwrap();
        let (_, mapping_id, _, _) = seed_session_state_rows(&engine, sid);

        let v1 = engine
            .create_checkpoint(sid, None, "manual", Some("v1"))
            .unwrap();
        let expected: SessionStateSnapshot =
            serde_json::from_str(v1.session_state_snapshot.as_deref().unwrap()).unwrap();

        std::fs::write(tmp.path().join("a.txt"), "v2").unwrap();
        mutate_session_state_rows(&engine, sid);
        {
            let db = engine.db.lock().unwrap();
            db.conn()
                .execute(
                    "UPDATE StepSessionMapping SET session_id = NULL WHERE id = ?",
                    [mapping_id],
                )
                .unwrap();
        }
        assert_ne!(current_session_snapshot(&engine, sid), expected);

        engine.restore_checkpoint(v1.id).unwrap();

        assert_eq!(
            std::fs::read_to_string(tmp.path().join("a.txt")).unwrap(),
            "v1"
        );
        assert_eq!(current_session_snapshot(&engine, sid), expected);
    }

    #[test]
    fn restore_preserves_checkpoint_card_id_after_card_replay() {
        let (engine, tmp, sid) = engine_with_tempdir();
        engine.init().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "v1").unwrap();
        let (card_id, _, _, _) = seed_session_state_rows(&engine, sid);

        let v1 = engine
            .create_checkpoint(sid, Some(card_id), "manual", Some("v1"))
            .unwrap();

        std::fs::write(tmp.path().join("a.txt"), "v2").unwrap();
        mutate_session_state_rows(&engine, sid);
        engine.restore_checkpoint(v1.id).unwrap();

        let db = engine.db.lock().unwrap();
        let restored = checkpoint_dao::get_by_id(db.conn(), v1.id)
            .unwrap()
            .unwrap();
        assert_eq!(restored.card_id, Some(card_id));
    }

    #[test]
    fn restore_reverts_plan_steps_to_session_snapshot() {
        let (engine, tmp, sid) = engine_with_tempdir();
        engine.init().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "v1").unwrap();
        let (_, _, plan_id, saved_step_id) = seed_session_state_rows(&engine, sid);

        let v1 = engine
            .create_checkpoint(sid, None, "manual", Some("v1"))
            .unwrap();
        let extra_step_id = insert_extra_step(&engine, plan_id, "step-002");

        {
            let db = engine.db.lock().unwrap();
            assert!(step::get_by_id(db.conn(), extra_step_id).unwrap().is_some());
        }

        engine.restore_checkpoint(v1.id).unwrap();

        let db = engine.db.lock().unwrap();
        let steps = step::list_by_plan(db.conn(), plan_id).unwrap();
        let stable_ids = steps
            .iter()
            .map(|step| step.step_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(stable_ids, vec!["step-001"]);
        assert!(step::get_by_id(db.conn(), extra_step_id).unwrap().is_none());
        assert!(step::get_by_id(db.conn(), saved_step_id).unwrap().is_some());
    }

    #[test]
    fn restore_without_session_state_snapshot_keeps_file_only_behavior() {
        let (engine, tmp, sid) = engine_with_tempdir();
        engine.init().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "v1").unwrap();
        seed_session_state_rows(&engine, sid);
        let v1 = engine
            .create_checkpoint(sid, None, "manual", Some("legacy-v1"))
            .unwrap();
        {
            let db = engine.db.lock().unwrap();
            db.conn()
                .execute(
                    "UPDATE Checkpoint SET session_state_snapshot = NULL WHERE id = ?",
                    [v1.id],
                )
                .unwrap();
        }

        std::fs::write(tmp.path().join("a.txt"), "v2").unwrap();
        mutate_session_state_rows(&engine, sid);
        let mutated = current_session_snapshot(&engine, sid);

        engine.restore_checkpoint(v1.id).unwrap();

        assert_eq!(
            std::fs::read_to_string(tmp.path().join("a.txt")).unwrap(),
            "v1"
        );
        assert_eq!(current_session_snapshot(&engine, sid), mutated);
    }

    #[test]
    fn create_if_changed_skips_when_tree_matches_head() {
        let (engine, tmp, sid) = engine_with_tempdir();
        engine.init().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "v1").unwrap();
        engine
            .create_checkpoint(sid, None, "manual", Some("v1"))
            .unwrap();

        // No file changes since the last checkpoint → pre-edit anchor is a no-op.
        let skipped = engine
            .create_checkpoint_if_changed(sid, None, "auto-pre-edit", None)
            .unwrap();
        assert!(
            skipped.is_none(),
            "unchanged tree must not create an anchor"
        );
        assert_eq!(engine.list_checkpoints(sid).unwrap().len(), 1);
    }

    #[test]
    fn create_if_changed_commits_when_tree_is_dirty() {
        let (engine, tmp, sid) = engine_with_tempdir();
        engine.init().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "v1").unwrap();
        engine
            .create_checkpoint(sid, None, "manual", Some("v1"))
            .unwrap();

        // Uncommitted edit since the last checkpoint → pre-edit anchor captures it.
        std::fs::write(tmp.path().join("a.txt"), "v2-dirty").unwrap();
        let row = engine
            .create_checkpoint_if_changed(sid, None, "auto-pre-edit", None)
            .unwrap()
            .expect("dirty tree must create an anchor");
        assert_eq!(row.kind, "auto-pre-edit");
        assert!(
            row.label.is_none(),
            "anchor stays locale-neutral (NULL label)"
        );
        assert_eq!(row.changed_files, vec!["a.txt"]);
        assert_eq!(engine.list_checkpoints(sid).unwrap().len(), 2);
    }

    #[test]
    fn rejects_invalid_kind() {
        let (engine, _tmp, sid) = engine_with_tempdir();
        engine.init().unwrap();
        let err = engine
            .create_checkpoint(sid, None, "scheduled", None)
            .unwrap_err();
        assert!(matches!(err, CheckpointError::InvalidKind(_)));
    }

    #[test]
    fn wal_sidecars_and_dive_dir_are_filtered() {
        let (engine, tmp, sid) = engine_with_tempdir();
        engine.init().unwrap();
        std::fs::create_dir_all(tmp.path().join(".dive")).unwrap();
        std::fs::write(tmp.path().join(".dive/dive.sqlite"), "binary").unwrap();
        std::fs::write(tmp.path().join(".dive/dive.sqlite-wal"), "wal").unwrap();
        std::fs::write(tmp.path().join(".dive/dive.sqlite-shm"), "shm").unwrap();
        std::fs::write(tmp.path().join("keep.txt"), "real content").unwrap();

        let cp = engine
            .create_checkpoint(sid, None, "manual", Some("mixed"))
            .unwrap();
        let repo = engine.open_repo().unwrap();
        let oid = git2::Oid::from_str(&cp.git_sha).unwrap();
        let commit = repo.find_commit(oid).unwrap();
        let tree = commit.tree().unwrap();

        let mut found = Vec::new();
        tree.walk(git2::TreeWalkMode::PreOrder, |_, entry| {
            if let Some(name) = entry.name() {
                found.push(name.to_string());
            }
            git2::TreeWalkResult::Ok
        })
        .unwrap();
        assert!(
            found.iter().any(|n| n == "keep.txt"),
            "expected keep.txt in snapshot, got {found:?}"
        );
        assert!(
            !found.iter().any(|n| n == ".dive"),
            "expected no .dive/ in snapshot, got {found:?}"
        );
        assert!(
            !found.iter().any(|n| n.contains("sqlite")),
            "expected no sqlite* in snapshot, got {found:?}"
        );
    }

    #[test]
    fn checkpoint_metadata_tracks_changed_files_and_file_stats() {
        let (engine, tmp, sid) = engine_with_tempdir();
        engine.init().unwrap();

        std::fs::write(tmp.path().join("a.txt"), "v1").unwrap();
        let first = engine
            .create_checkpoint(sid, None, "manual", Some("first"))
            .unwrap();
        assert_eq!(first.changed_files, vec!["a.txt"]);
        assert_eq!(first.stats.added, 1);

        std::fs::write(tmp.path().join("a.txt"), "v2").unwrap();
        std::fs::write(tmp.path().join("b.txt"), "new").unwrap();
        let second = engine
            .create_checkpoint(sid, None, "manual", Some("second"))
            .unwrap();
        assert_eq!(second.changed_files, vec!["a.txt", "b.txt"]);
        assert_eq!(second.stats.added, 1);
        assert_eq!(second.stats.modified, 1);

        std::fs::remove_file(tmp.path().join("a.txt")).unwrap();
        let third = engine
            .create_checkpoint(sid, None, "manual", Some("third"))
            .unwrap();
        assert_eq!(third.changed_files, vec!["a.txt"]);
        assert_eq!(third.stats.removed, 1);
    }
}
