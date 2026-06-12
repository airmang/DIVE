use tauri::State;

use super::{log_event, AppState};

#[tauri::command]
pub async fn checkpoint_create(
    state: State<'_, AppState>,
    session_id: i64,
    card_id: Option<i64>,
    label: Option<String>,
) -> Result<crate::db::models::CheckpointRow, String> {
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
    Ok(row)
}

#[tauri::command]
pub async fn checkpoint_restore(
    state: State<'_, AppState>,
    checkpoint_id: i64,
) -> Result<(), String> {
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
    )
}

#[tauri::command]
pub async fn checkpoint_list(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<Vec<crate::db::models::CheckpointRow>, String> {
    let project_root = state.project_root_required()?;
    let engine = crate::checkpoint::CheckpointEngine::new(project_root, state.db.clone());
    engine
        .list_checkpoints(session_id)
        .map_err(|e| e.to_string())
}
