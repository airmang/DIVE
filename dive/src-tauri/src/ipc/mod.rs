//! Tauri IPC commands (spec §11.5).
//!
//! Task 3-1 extends the Phase 2 surface with card state-machine commands
//! and an optional `stage` parameter on `chat_send` so the frontend can
//! request I/V/E gate evaluation in addition to the default D gate.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::agent::{
    AgentEvent, AgentLoop, AwaitUserHook, PendingApprovals, PermissionDecision, PermissionHook,
};
use crate::db::dao::{card as card_dao, workmap as workmap_dao};
use crate::db::models::{CardState, NewCard};
use crate::db::Database;
use crate::dive::{apply_transition, CardTransition, DiveStage};
use crate::providers::{LlmProvider, MockProvider};
use crate::tools::{ToolContext, ToolRegistry};

pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub provider: Arc<dyn LlmProvider>,
    pub registry: Arc<ToolRegistry>,
    pub permission: Arc<dyn PermissionHook>,
    pub pending_approvals: PendingApprovals,
    pub project_root: PathBuf,
    pub model: String,
    pub cancels: Arc<Mutex<HashMap<i64, Arc<AtomicBool>>>>,
}

impl AppState {
    pub fn new(
        db: Database,
        provider: Arc<dyn LlmProvider>,
        project_root: PathBuf,
        model: String,
    ) -> Self {
        let pending = PendingApprovals::new();
        let permission: Arc<dyn PermissionHook> =
            Arc::new(AwaitUserHook::new(pending.clone(), true));
        Self {
            db: Arc::new(Mutex::new(db)),
            provider,
            registry: Arc::new(ToolRegistry::with_builtins()),
            permission,
            pending_approvals: pending,
            project_root,
            model,
            cancels: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn dev_mock() -> Self {
        let mut db = Database::open_in_memory().expect("in-memory db");
        db.migrate().expect("migrate");
        let provider = Arc::new(MockProvider::new(Vec::new()));
        Self::new(db, provider, PathBuf::from("."), "mock-model".into())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatEventEnvelope {
    pub session_id: i64,
    #[serde(flatten)]
    pub event: AgentEvent,
}

#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: i64,
    text: String,
    stage: Option<String>,
) -> Result<(), String> {
    let stage = stage
        .as_deref()
        .and_then(DiveStage::parse)
        .unwrap_or(DiveStage::D);
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut guard = state.cancels.lock().map_err(|e| e.to_string())?;
        guard.insert(session_id, cancel.clone());
    }
    let loop_ = AgentLoop::builder()
        .provider(state.provider.clone())
        .registry(state.registry.clone())
        .permission(state.permission.clone())
        .db(state.db.clone())
        .tool_ctx(ToolContext::new(&state.project_root, session_id))
        .model(state.model.clone())
        .cancel(cancel)
        .stage(stage)
        .build()
        .map_err(|e| e.to_string())?;

    let app_clone = app.clone();
    let res = loop_
        .run(session_id, &text, &mut move |evt| {
            let envelope = ChatEventEnvelope {
                session_id,
                event: evt,
            };
            let _ = app_clone.emit(&format!("chat://event/{session_id}"), &envelope);
        })
        .await;

    {
        let mut guard = state.cancels.lock().map_err(|e| e.to_string())?;
        guard.remove(&session_id);
    }

    res.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn chat_cancel(state: State<'_, AppState>, session_id: i64) -> Result<(), String> {
    let guard = state.cancels.lock().map_err(|e| e.to_string())?;
    if let Some(token) = guard.get(&session_id) {
        token.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub async fn tool_approve(
    state: State<'_, AppState>,
    tool_call_id: String,
    modified_args: Option<Value>,
) -> Result<bool, String> {
    let decision = match modified_args {
        Some(args) => PermissionDecision::approved_with(args),
        None => PermissionDecision::approved(),
    };
    Ok(state.pending_approvals.resolve(&tool_call_id, decision))
}

#[tauri::command]
pub async fn tool_deny(
    state: State<'_, AppState>,
    tool_call_id: String,
    reason: Option<String>,
) -> Result<bool, String> {
    let decision = PermissionDecision::denied(reason.unwrap_or_else(|| "사용자가 거부함".into()));
    Ok(state.pending_approvals.resolve(&tool_call_id, decision))
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

#[tauri::command]
pub async fn card_update_instruction(
    state: State<'_, AppState>,
    card_id: i64,
    instruction: String,
) -> Result<CardState, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let existing = card_dao::get_by_id(db.conn(), card_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("card {card_id} not found"))?;
    let trimmed = instruction.trim();
    let next_state = if trimmed.is_empty() {
        existing.state
    } else if existing.state == CardState::Decomposed {
        CardState::Instructed
    } else {
        existing.state
    };
    card_dao::update(
        db.conn(),
        card_id,
        &NewCard {
            session_id: existing.session_id,
            title: existing.title.clone(),
            instruction: Some(instruction),
            state: next_state,
            verify_log: existing.verify_log.clone(),
            changed_files: existing.changed_files.clone(),
            position: existing.position,
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(next_state)
}

#[tauri::command]
pub async fn card_transition(
    state: State<'_, AppState>,
    card_id: i64,
    transition: CardTransition,
    approve_force: Option<bool>,
) -> Result<CardState, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let existing = card_dao::get_by_id(db.conn(), card_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("card {card_id} not found"))?;

    if matches!(transition, CardTransition::Approve) && !approve_force.unwrap_or(false) {
        let log_str = existing
            .verify_log
            .as_deref()
            .ok_or_else(|| "verify_log required: run card_verify first".to_string())?;
        let log = crate::dive::VerifyLog::from_json_str(log_str).map_err(|e| e.to_string())?;
        if !log.approve_eligible() {
            return Err(format!(
                "verify failed: intent_match={}, test_result={:?}. Pass approve_force=true to override.",
                log.intent_match, log.test_result
            ));
        }
    }

    let next = apply_transition(existing.state, transition).map_err(|e| e.to_string())?;
    card_dao::update(
        db.conn(),
        card_id,
        &NewCard {
            session_id: existing.session_id,
            title: existing.title.clone(),
            instruction: existing.instruction.clone(),
            state: next,
            verify_log: existing.verify_log.clone(),
            changed_files: existing.changed_files.clone(),
            position: existing.position,
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
pub async fn card_verify(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: i64,
    card_id: i64,
) -> Result<crate::dive::VerifyLog, String> {
    let engine = crate::dive::VerifyEngine::new(
        state.provider.clone(),
        state.db.clone(),
        state.model.clone(),
    );
    let _ = app.emit(
        "verify_started",
        serde_json::json!({ "session_id": session_id, "card_id": card_id }),
    );
    let log = engine
        .verify_card(session_id, card_id)
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit(
        "verify_done",
        serde_json::json!({
            "session_id": session_id,
            "card_id": card_id,
            "intent_match": log.intent_match,
        }),
    );
    Ok(log)
}

#[tauri::command]
pub async fn ai_assist_cards(
    state: State<'_, AppState>,
    description: String,
) -> Result<Vec<crate::dive::AssistedCard>, String> {
    let engine = crate::dive::AiAssistEngine::new(state.provider.clone(), state.model.clone());
    engine
        .suggest_cards(&description)
        .await
        .map_err(|e| e.to_string())
}
