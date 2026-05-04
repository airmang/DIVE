use serde::{Deserialize, Serialize};
use tauri::State;

use crate::checkpoint::CheckpointEngine;
use crate::db::models::{CheckpointRow, CheckpointStats};

use super::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointTimelineItem {
    pub id: i64,
    pub session_id: i64,
    pub card_id: Option<i64>,
    pub git_sha: String,
    pub kind: String,
    pub label: Option<String>,
    pub created_at: i64,
    pub file_changes: i64,
    pub changed_files: Vec<String>,
    pub stats: CheckpointStats,
}

impl From<CheckpointRow> for CheckpointTimelineItem {
    fn from(row: CheckpointRow) -> Self {
        Self {
            id: row.id,
            session_id: row.session_id,
            card_id: row.card_id,
            git_sha: row.git_sha,
            kind: row.kind,
            label: row.label,
            created_at: row.created_at,
            file_changes: row.changed_files.len() as i64,
            changed_files: row.changed_files,
            stats: row.stats,
        }
    }
}

#[tauri::command]
pub async fn checkpoint_timeline(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<Vec<CheckpointTimelineItem>, String> {
    let engine = CheckpointEngine::new(state.project_root_snapshot(), state.db.clone());
    let rows = engine
        .list_checkpoints(session_id)
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(CheckpointTimelineItem::from).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_item_preserves_fields() {
        let row = CheckpointRow {
            id: 42,
            session_id: 1,
            card_id: Some(7),
            git_sha: "abc".into(),
            kind: "auto".into(),
            label: Some("[V 통과] card".into()),
            created_at: 1_000,
            changed_files: vec!["src/main.rs".into(), "src/lib.rs".into()],
            stats: CheckpointStats {
                added: 1,
                removed: 0,
                modified: 1,
            },
        };
        let item = CheckpointTimelineItem::from(row);
        assert_eq!(item.id, 42);
        assert_eq!(item.kind, "auto");
        assert_eq!(item.file_changes, 2);
        assert_eq!(item.changed_files, vec!["src/main.rs", "src/lib.rs"]);
        assert_eq!(item.stats.added, 1);
    }
}
