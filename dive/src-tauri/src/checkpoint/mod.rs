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

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use git2::{IndexAddOption, ObjectType, Repository, RepositoryInitOptions, Signature};
use thiserror::Error;

use crate::db::dao::checkpoint as checkpoint_dao;
use crate::db::models::{CheckpointRow, NewCheckpoint};
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
        let sha = self.commit_snapshot(&repo, message)?;
        let db = self
            .db
            .lock()
            .map_err(|e| CheckpointError::Db(e.to_string()))?;
        let id = checkpoint_dao::insert(
            db.conn(),
            &NewCheckpoint {
                session_id,
                card_id,
                git_sha: sha.clone(),
                kind: kind.to_string(),
                label: label.map(str::to_string),
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

        self.create_checkpoint(target.session_id, target.card_id, "auto", Some("복원 직전"))?;

        let repo = self.open_repo()?;
        let oid = git2::Oid::from_str(&target.git_sha)?;
        let commit = repo.find_commit(oid)?;
        let tree = commit.tree()?;

        self.clear_tracked_worktree(&repo)?;
        write_tree_to_disk(&repo, &tree, &self.project_root)?;

        repo.reference("HEAD", oid, true, "checkpoint restore")?;
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

    fn commit_snapshot(&self, repo: &Repository, message: &str) -> Result<String, CheckpointError> {
        repo.set_workdir(&self.project_root, false)?;
        let mut index = repo.index()?;
        index.clear()?;
        index.add_all(
            ["*"].iter(),
            IndexAddOption::DEFAULT,
            Some(&mut path_filter),
        )?;
        let tree_oid = index.write_tree_to(repo)?;
        let tree = repo.find_tree(tree_oid)?;
        let sig = Signature::now(COMMITTER_NAME, COMMITTER_EMAIL)?;

        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.as_ref().map(|p| vec![p]).unwrap_or_default();

        let commit_oid =
            repo.commit(Some("HEAD"), &sig, &sig, message, &tree, parents.as_slice())?;
        Ok(commit_oid.to_string())
    }
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
        "init" | "auto" | "manual" => Ok(()),
        other => Err(CheckpointError::InvalidKind(other.to_string())),
    }
}

fn default_label(kind: &str) -> &'static str {
    match kind {
        "init" => "init",
        "auto" => "자동 체크포인트",
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
    use crate::db::dao::{project, session};
    use crate::db::models::{NewProject, NewSession};

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
            list.iter().any(|c| c.label.as_deref() == Some("복원 직전")),
            "restore must auto-create a backup checkpoint, got {list:?}",
        );
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
}
