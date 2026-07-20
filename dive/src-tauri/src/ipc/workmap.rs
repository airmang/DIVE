use serde::Serialize;
use serde_json::json;
use tauri::State;

use super::AppState;
use crate::db::dao::{card as card_dao, workmap as workmap_dao};
use crate::db::models::CardRow;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WorkmapSnapshot {
    pub cards: Vec<CardRow>,
    pub current_card_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CardToolCallStats {
    pub count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CardToolCallCount {
    pub card_id: i64,
    pub count: i64,
}

fn ensure_title(title: String) -> Result<String, String> {
    let title = title.trim().to_owned();
    if title.is_empty() {
        return Err("card title cannot be empty".into());
    }
    Ok(title)
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
}

pub fn card_create_impl(
    state: &AppState,
    session_id: i64,
    title: String,
    position: Option<i64>,
    summary: Option<String>,
    acceptance_criteria: Option<String>,
    instruction_seed: Option<String>,
) -> Result<CardRow, String> {
    let title = ensure_title(title)?;
    let row = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let id = card_dao::insert(
            db.conn(),
            &crate::db::models::NewCard {
                session_id,
                title,
                instruction: normalize_optional_text(instruction_seed),
                assist_summary: normalize_optional_text(summary),
                acceptance_criteria: normalize_optional_text(acceptance_criteria),
                retrospective: None,
                change_summary: None,
                state: crate::db::models::CardState::Decomposed,
                verify_log: None,
                changed_files: None,
                test_command: None,
                approval_judgment: None,
                approval_provenance: None,
                position: position.unwrap_or(
                    card_dao::next_position(db.conn(), session_id).map_err(|e| e.to_string())?,
                ),
            },
        )
        .map_err(|e| e.to_string())?;
        card_dao::get_by_id(db.conn(), id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("card {id} not found after insert"))?
    };
    super::log_event(
        state,
        Some(session_id),
        "card_create",
        json!({
            "card_id": row.id,
            "position": row.position,
            "has_assist_summary": row.assist_summary.is_some(),
            "has_acceptance_criteria": row.acceptance_criteria.is_some(),
        }),
    )?;
    Ok(row)
}

pub fn card_list_impl(state: &AppState, session_id: i64) -> Result<Vec<CardRow>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    card_dao::list_by_session(db.conn(), session_id).map_err(|e| e.to_string())
}

pub fn card_delete_impl(state: &AppState, card_id: i64) -> Result<(), String> {
    let session_id = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let existing = card_dao::get_by_id(db.conn(), card_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("card {card_id} not found"))?;
        card_dao::delete_by_id(db.conn(), card_id).map_err(|e| e.to_string())?;
        existing.session_id
    };
    super::log_event(
        state,
        Some(session_id),
        "card_delete",
        json!({ "card_id": card_id }),
    )
}

pub fn card_reorder_impl(
    state: &AppState,
    session_id: i64,
    ordered_ids: Vec<i64>,
) -> Result<(), String> {
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        card_dao::reorder(db.conn(), session_id, &ordered_ids).map_err(|e| e.to_string())?;
    }
    super::log_event(
        state,
        Some(session_id),
        "card_update",
        json!({ "action": "reorder", "ordered_count": ordered_ids.len() }),
    )
}

pub fn workmap_get_impl(state: &AppState, session_id: i64) -> Result<WorkmapSnapshot, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let cards = card_dao::list_by_session(db.conn(), session_id).map_err(|e| e.to_string())?;
    let current_card_id = workmap_dao::get(db.conn(), session_id)
        .map_err(|e| e.to_string())?
        .and_then(|row| row.current_card_id);
    Ok(WorkmapSnapshot {
        cards,
        current_card_id,
    })
}

pub fn card_tool_call_stats_impl(
    state: &AppState,
    card_id: i64,
) -> Result<CardToolCallStats, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let count = crate::dive::card_tool_call_count(db.conn(), card_id).map_err(|e| e.to_string())?;
    Ok(CardToolCallStats { count })
}

/// S-069 P4-1: all cards' tool-call counts for a session in one call, replacing
/// the per-card `card_tool_call_stats` fan-out the workmap ran on every refresh.
/// Cards with no messages are omitted (the frontend defaults them to 0, which
/// equals their per-card count), so the counts the UI renders are unchanged.
pub fn card_tool_call_stats_batch_impl(
    state: &AppState,
    session_id: i64,
) -> Result<Vec<CardToolCallCount>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let rows = crate::db::dao::tool_call::counts_by_session(db.conn(), session_id)
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(card_id, count)| CardToolCallCount { card_id, count })
        .collect())
}

#[tauri::command]
pub async fn card_create(
    state: State<'_, AppState>,
    session_id: i64,
    title: String,
    position: Option<i64>,
    summary: Option<String>,
    acceptance_criteria: Option<String>,
    instruction_seed: Option<String>,
) -> Result<CardRow, String> {
    card_create_impl(
        &state,
        session_id,
        title,
        position,
        summary,
        acceptance_criteria,
        instruction_seed,
    )
}

#[tauri::command]
pub async fn card_list(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<Vec<CardRow>, String> {
    card_list_impl(&state, session_id)
}

#[tauri::command]
pub async fn card_delete(state: State<'_, AppState>, card_id: i64) -> Result<(), String> {
    card_delete_impl(&state, card_id)
}

#[tauri::command]
pub async fn card_reorder(
    state: State<'_, AppState>,
    session_id: i64,
    ordered_ids: Vec<i64>,
) -> Result<(), String> {
    card_reorder_impl(&state, session_id, ordered_ids)
}

#[tauri::command]
pub async fn workmap_get(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<WorkmapSnapshot, String> {
    workmap_get_impl(&state, session_id)
}

#[tauri::command]
pub async fn card_tool_call_stats(
    state: State<'_, AppState>,
    card_id: i64,
) -> Result<CardToolCallStats, String> {
    card_tool_call_stats_impl(&state, card_id)
}

#[tauri::command]
pub async fn card_tool_call_stats_batch(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<Vec<CardToolCallCount>, String> {
    card_tool_call_stats_batch_impl(&state, session_id)
}

#[tauri::command]
pub async fn workmap_set_current_card(
    state: State<'_, AppState>,
    session_id: i64,
    card_id: Option<i64>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    workmap_dao::set_current_card(db.conn(), session_id, card_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::InMemoryKeyring;
    use crate::db::dao::{message as message_dao, project as project_dao, session as session_dao};
    use crate::db::dao::{tool_call as tool_call_dao, workmap as workmap_dao};
    use crate::db::models::{NewMessage, NewProject, NewSession, NewToolCall};
    use crate::db::Database;
    use crate::providers::MockProvider;
    use serde_json::json;
    use std::sync::Arc;

    fn mk_state() -> AppState {
        let mut db = Database::open_in_memory().unwrap();
        db.migrate().unwrap();
        let provider = Arc::new(MockProvider::new(Vec::new()));
        AppState::new(db, provider, std::env::temp_dir(), "mock".into())
            .with_keyring(Arc::new(InMemoryKeyring::new()))
    }

    fn seed_session(state: &AppState) -> i64 {
        let db = state.db.lock().unwrap();
        let project_id = project_dao::insert(
            db.conn(),
            &NewProject {
                name: "p".into(),
                path: "/tmp/dive-workmap-test".into(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        session_dao::insert(
            db.conn(),
            &NewSession {
                project_id,
                title: "s".into(),
                ended_at: None,
                status: "active".into(),
            },
        )
        .unwrap()
    }

    #[test]
    fn card_create_list_reorder_delete_and_workmap_snapshot() {
        let state = mk_state();
        let session_id = seed_session(&state);
        let first =
            card_create_impl(&state, session_id, "first".into(), None, None, None, None).unwrap();
        let second =
            card_create_impl(&state, session_id, "second".into(), None, None, None, None).unwrap();
        assert_eq!(card_list_impl(&state, session_id).unwrap().len(), 2);
        assert_eq!(second.position, 2);

        card_reorder_impl(&state, session_id, vec![second.id, first.id]).unwrap();
        let reordered = card_list_impl(&state, session_id).unwrap();
        assert_eq!(
            reordered.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![second.id, first.id]
        );

        {
            let db = state.db.lock().unwrap();
            workmap_dao::set_current_card(db.conn(), session_id, Some(first.id)).unwrap();
        }
        let snap = workmap_get_impl(&state, session_id).unwrap();
        assert_eq!(snap.cards.len(), 2);
        assert_eq!(snap.current_card_id, Some(first.id));

        card_delete_impl(&state, first.id).unwrap();
        let snap = workmap_get_impl(&state, session_id).unwrap();
        assert_eq!(
            snap.cards.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![second.id]
        );
    }

    #[test]
    fn card_create_rejects_blank_title() {
        let state = mk_state();
        let session_id = seed_session(&state);
        let err =
            card_create_impl(&state, session_id, "   ".into(), None, None, None, None).unwrap_err();
        assert!(err.contains("title"));
    }

    #[test]
    fn card_create_persists_assist_metadata_without_instruction_gate_fill() {
        let state = mk_state();
        let session_id = seed_session(&state);
        let card = card_create_impl(
            &state,
            session_id,
            "todo input".into(),
            None,
            Some("입력창과 추가 버튼을 만든다".into()),
            Some("빈 입력은 막고 Enter로 추가된다".into()),
            None,
        )
        .unwrap();

        assert_eq!(
            card.assist_summary.as_deref(),
            Some("입력창과 추가 버튼을 만든다")
        );
        assert_eq!(
            card.acceptance_criteria.as_deref(),
            Some("빈 입력은 막고 Enter로 추가된다")
        );
        assert_eq!(card.instruction, None);
    }

    #[test]
    fn card_tool_call_stats_counts_rows_for_card_messages() {
        let state = mk_state();
        let session_id = seed_session(&state);
        let card =
            card_create_impl(&state, session_id, "card".into(), None, None, None, None).unwrap();
        let db = state.db.lock().unwrap();
        let message_id = message_dao::insert(
            db.conn(),
            &NewMessage {
                session_id,
                card_id: Some(card.id),
                role: "assistant".into(),
                content: "tool use".into(),
                reasoning_content: None,
                tool_calls: None,
                usage: None,
                provider: None,
                model: None,
            },
        )
        .unwrap();
        tool_call_dao::insert(
            db.conn(),
            &NewToolCall {
                message_id,
                name: "read_file".into(),
                input: json!({"path":"src/main.rs"}),
                output: Some(json!({"ok": true})),
                approved: Some(true),
                risk_level: "safe".into(),
            },
        )
        .unwrap();
        drop(db);

        let stats = card_tool_call_stats_impl(&state, card.id).unwrap();
        assert_eq!(stats.count, 1);
    }

    // S-069 P4-1: the batch query must return the same count the per-card
    // command produces for every card, and omit only cards with no messages
    // (which the frontend reads as 0).
    #[test]
    fn card_tool_call_stats_batch_matches_per_card() {
        let state = mk_state();
        let session_id = seed_session(&state);
        let a = card_create_impl(&state, session_id, "a".into(), None, None, None, None).unwrap();
        let b = card_create_impl(&state, session_id, "b".into(), None, None, None, None).unwrap();
        // Card c intentionally has no messages at all.
        let c = card_create_impl(&state, session_id, "c".into(), None, None, None, None).unwrap();
        {
            let db = state.db.lock().unwrap();
            let mk_msg = |card_id: i64, tc: Option<serde_json::Value>| {
                message_dao::insert(
                    db.conn(),
                    &NewMessage {
                        session_id,
                        card_id: Some(card_id),
                        role: "assistant".into(),
                        content: "m".into(),
                        reasoning_content: None,
                        tool_calls: tc,
                        usage: None,
                        provider: None,
                        model: None,
                    },
                )
                .unwrap()
            };
            // Card a: one message with a structured row + one with a 2-elem JSON.
            let m1 = mk_msg(a.id, None);
            tool_call_dao::insert(
                db.conn(),
                &NewToolCall {
                    message_id: m1,
                    name: "read_file".into(),
                    input: json!({ "p": "x" }),
                    output: None,
                    approved: Some(true),
                    risk_level: "safe".into(),
                },
            )
            .unwrap();
            mk_msg(a.id, Some(json!([{ "n": "a" }, { "n": "b" }])));
            // Card b: a message but no tool calls → count 0 (still present).
            mk_msg(b.id, None);
        }

        let batch: std::collections::HashMap<i64, i64> =
            card_tool_call_stats_batch_impl(&state, session_id)
                .unwrap()
                .into_iter()
                .map(|row| (row.card_id, row.count))
                .collect();
        for card in [a.id, b.id, c.id] {
            let per_card = card_tool_call_stats_impl(&state, card).unwrap().count;
            assert_eq!(
                batch.get(&card).copied().unwrap_or(0),
                per_card,
                "card {card} diverged from per-card stats"
            );
        }
        assert_eq!(batch.get(&a.id).copied().unwrap_or(0), 3);
        assert_eq!(batch.get(&b.id).copied().unwrap_or(0), 0);
        assert_eq!(batch.get(&c.id).copied().unwrap_or(0), 0);
    }
}
