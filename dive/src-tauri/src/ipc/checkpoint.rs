use tauri::State;

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

#[tauri::command]
pub async fn checkpoint_restore(
    state: State<'_, AppState>,
    checkpoint_id: i64,
) -> Result<CheckpointRestorePayload, String> {
    let project_root = state.project_root_required()?;
    let engine = crate::checkpoint::CheckpointEngine::new(project_root, state.db.clone());
    let target = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        crate::db::dao::checkpoint::get_by_id(db.conn(), checkpoint_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("checkpoint {checkpoint_id} not found"))?
    };
    engine
        .restore_checkpoint(checkpoint_id)
        .map_err(|e| e.to_string())?;
    log_event(
        &state,
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
