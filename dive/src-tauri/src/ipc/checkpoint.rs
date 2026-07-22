use tauri::State;

use crate::db::dao::{project as project_dao, session as session_dao};
use crate::db::models::{CheckpointRow, CheckpointStats};

use super::{log_event, AppState};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CheckpointPayload {
    pub id: i64,
    pub session_id: i64,
    pub card_id: Option<i64>,
    pub git_sha: String,
    pub kind: String,
    pub label: Option<String>,
    pub created_at: i64,
    pub changed_files: Vec<String>,
    pub file_changes: i64,
    pub stats: CheckpointStats,
    pub has_session_state_snapshot: bool,
}

impl From<CheckpointRow> for CheckpointPayload {
    fn from(row: CheckpointRow) -> Self {
        let file_changes = row.changed_files.len() as i64;
        Self {
            id: row.id,
            session_id: row.session_id,
            card_id: row.card_id,
            git_sha: row.git_sha,
            kind: row.kind,
            label: row.label,
            created_at: row.created_at,
            changed_files: row.changed_files,
            file_changes,
            stats: row.stats,
            has_session_state_snapshot: row.session_state_snapshot.is_some(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CheckpointRestorePayload {
    pub restored_session_state: bool,
}

#[tauri::command]
pub async fn checkpoint_create(
    state: State<'_, AppState>,
    session_id: i64,
    card_id: Option<i64>,
    label: Option<String>,
) -> Result<CheckpointPayload, String> {
    let project_root = state.project_root_required()?;
    let engine = crate::checkpoint::CheckpointEngine::new(project_root, state.db.clone());
    engine.init().map_err(|e| e.to_string())?;
    let row = engine
        .create_checkpoint(session_id, card_id, "manual", label.as_deref())
        .map_err(|e| e.to_string())?;
    log_event(
        &state,
        Some(session_id),
        "checkpoint_create",
        serde_json::json!({
            "checkpoint_id": row.id,
            "card_id": row.card_id,
            "kind": row.kind,
            "label": row.label,
            "git_sha": row.git_sha,
            "changed_file_count": row.changed_files.len(),
        }),
    )?;
    Ok(row.into())
}

/// Rejects restoring a checkpoint whose session belongs to a project other
/// than the one currently active. This MUST run before
/// `CheckpointEngine::restore_checkpoint` is engaged: that call first fully
/// executes `create_checkpoint` (an "auto-pre-restore" commit against the
/// *active* project's worktree, persisted with `session_id` set to the
/// checkpoint's — possibly foreign — session) before it ever looks up the
/// target git_sha, which only then fails when that sha doesn't exist in the
/// active project's repo. Without this guard, a stale/foreign checkpoint id
/// leaves behind a wrong-project audit row even though the restore itself
/// errors out.
fn ensure_checkpoint_belongs_to_active_project(
    state: &AppState,
    target: &CheckpointRow,
    project_root: &std::path::Path,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let session = session_dao::get_by_id(db.conn(), target.session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("session {} not found", target.session_id))?;
    let active_project_id = project_dao::list(db.conn())
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|row| std::path::Path::new(&row.path) == project_root)
        .map(|row| row.id)
        .ok_or_else(|| "active project not found".to_string())?;
    if session.project_id != active_project_id {
        return Err(format!(
            "checkpoint {} belongs to a different project",
            target.id
        ));
    }
    Ok(())
}

pub(super) fn checkpoint_restore_impl(
    state: &AppState,
    checkpoint_id: i64,
) -> Result<CheckpointRestorePayload, String> {
    let project_root = state.project_root_required()?;
    let engine = crate::checkpoint::CheckpointEngine::new(project_root.clone(), state.db.clone());
    let target = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        crate::db::dao::checkpoint::get_by_id(db.conn(), checkpoint_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("checkpoint {checkpoint_id} not found"))?
    };
    ensure_checkpoint_belongs_to_active_project(state, &target, &project_root)?;
    engine
        .restore_checkpoint(checkpoint_id)
        .map_err(|e| e.to_string())?;
    log_event(
        state,
        Some(target.session_id),
        "checkpoint_restore",
        serde_json::json!({
            "checkpoint_id": checkpoint_id,
            "card_id": target.card_id,
            "git_sha": target.git_sha,
            "pre_restore_backup": true,
        }),
    )?;
    Ok(CheckpointRestorePayload {
        restored_session_state: target.session_state_snapshot.is_some(),
    })
}

#[tauri::command]
pub async fn checkpoint_restore(
    state: State<'_, AppState>,
    checkpoint_id: i64,
) -> Result<CheckpointRestorePayload, String> {
    checkpoint_restore_impl(&state, checkpoint_id)
}

#[tauri::command]
pub async fn checkpoint_list(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<Vec<CheckpointPayload>, String> {
    let project_root = state.project_root_required()?;
    let engine = crate::checkpoint::CheckpointEngine::new(project_root, state.db.clone());
    engine
        .list_checkpoints(session_id)
        .map(|rows| rows.into_iter().map(CheckpointPayload::from).collect())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dao::checkpoint as checkpoint_dao;
    use crate::db::models::{NewCheckpoint, NewProject, NewSession};
    use crate::db::Database;
    use crate::providers::MockProvider;
    use std::path::PathBuf;
    use std::sync::Arc;

    const ACTIVE_PROJECT_PATH: &str = "/tmp/dive-test-checkpoint-restore-active-project";
    const FOREIGN_PROJECT_PATH: &str = "/tmp/dive-test-checkpoint-restore-foreign-project";

    /// Builds a fresh in-memory-db `AppState` with two projects: the state's
    /// active project, and a "foreign" project holding the session a
    /// cross-project checkpoint will belong to.
    fn mk_state_with_two_projects() -> (AppState, i64) {
        let mut db = Database::open_in_memory().unwrap();
        db.migrate().unwrap();

        project_dao::insert(
            db.conn(),
            &NewProject {
                name: "active".into(),
                path: ACTIVE_PROJECT_PATH.into(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        let foreign_project_id = project_dao::insert(
            db.conn(),
            &NewProject {
                name: "foreign".into(),
                path: FOREIGN_PROJECT_PATH.into(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        let foreign_session_id = session_dao::insert(
            db.conn(),
            &NewSession {
                project_id: foreign_project_id,
                title: "foreign session".into(),
                ended_at: None,
                status: "active".into(),
            },
        )
        .unwrap();

        let provider = Arc::new(MockProvider::new(Vec::new()));
        let state = AppState::new(
            db,
            provider,
            PathBuf::from(ACTIVE_PROJECT_PATH),
            "mock-model".into(),
        );
        (state, foreign_session_id)
    }

    #[test]
    fn checkpoint_restore_rejects_a_checkpoint_from_a_non_active_project() {
        let (state, foreign_session_id) = mk_state_with_two_projects();

        let checkpoint_id = {
            let db = state.db.lock().unwrap();
            checkpoint_dao::insert(
                db.conn(),
                &NewCheckpoint {
                    session_id: foreign_session_id,
                    card_id: None,
                    git_sha: "deadbeef".into(),
                    kind: "manual".into(),
                    label: None,
                    changed_files: Vec::new(),
                    stats: CheckpointStats::zero(),
                    session_state_snapshot: None,
                },
            )
            .unwrap()
        };

        let err = checkpoint_restore_impl(&state, checkpoint_id)
            .expect_err("restoring a foreign-project checkpoint must be rejected");
        assert!(err.contains("different project"), "{err}");

        // The guard must reject BEFORE the checkpoint engine is engaged, so
        // no "auto-pre-restore" row should have been inserted for the
        // foreign session — only the original checkpoint remains.
        let db = state.db.lock().unwrap();
        let checkpoints = checkpoint_dao::list_by_session(db.conn(), foreign_session_id).unwrap();
        assert_eq!(checkpoints.len(), 1, "no auto-pre-restore row expected");
        assert_eq!(checkpoints[0].id, checkpoint_id);
        assert_eq!(checkpoints[0].kind, "manual");
    }

    #[test]
    fn checkpoint_restore_reports_missing_checkpoint() {
        let (state, _foreign_session_id) = mk_state_with_two_projects();
        let err = checkpoint_restore_impl(&state, 999_999).unwrap_err();
        assert!(err.contains("999999") || err.contains("not found"), "{err}");
    }
}
