//! Tauri IPC commands (spec §11.5).
//!
//! Task 3-1 extends the Phase 2 surface with card state-machine commands
//! and an optional `stage` parameter on `chat_send` so the frontend can
//! request I/V/E gate evaluation in addition to the default D gate.
//!
//! Task 4-1 adds project / session / provider CRUD via the sibling
//! `project`, `session`, and `provider` submodules. The keyring used for
//! provider secrets defaults to the OS-native backend but can be swapped
//! (tests use `InMemoryKeyring`).

pub mod codex_oauth;
pub mod mcp;
pub mod policy;
pub mod project;
pub mod provider;
pub mod session;
pub mod timeline;

pub use codex_oauth::*;
pub use mcp::*;
pub use policy::*;
pub use project::*;
pub use provider::*;
pub use session::*;
pub use timeline::*;

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
use crate::auth::{Keyring, OsKeyring};
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
    pub keyring: Arc<dyn Keyring>,
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
            keyring: Arc::new(OsKeyring::new()),
        }
    }

    pub fn dev_mock() -> Self {
        let mut db = Database::open_in_memory().expect("in-memory db");
        db.migrate().expect("migrate");
        let provider = Arc::new(MockProvider::new(Vec::new()));
        Self::new(db, provider, PathBuf::from("."), "mock-model".into())
    }

    pub fn with_keyring(mut self, keyring: Arc<dyn Keyring>) -> Self {
        self.keyring = keyring;
        self
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
    app: AppHandle,
    card_id: i64,
    transition: CardTransition,
    approve_force: Option<bool>,
) -> Result<CardState, String> {
    let (next, session_id, card_title) = {
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
        (next, existing.session_id, existing.title.clone())
    };

    if matches!(transition, CardTransition::Approve | CardTransition::Extend) {
        let engine =
            crate::checkpoint::CheckpointEngine::new(state.project_root.clone(), state.db.clone());
        if engine.checkpoint_dir().join("HEAD").exists() {
            let label = match transition {
                CardTransition::Approve => format!("[V 통과] {card_title}"),
                CardTransition::Extend => format!("[E 진입] {card_title}"),
                _ => unreachable!(),
            };
            if let Ok(row) =
                engine.create_checkpoint(session_id, Some(card_id), "auto", Some(&label))
            {
                let _ = app.emit(
                    "checkpoint_created",
                    serde_json::json!({
                        "id": row.id,
                        "session_id": row.session_id,
                        "card_id": row.card_id,
                        "kind": row.kind,
                        "label": row.label,
                        "git_sha": row.git_sha,
                    }),
                );
            }
        }
    }

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

#[tauri::command]
pub async fn prompt_check_review(
    state: State<'_, AppState>,
    text: String,
    stage: Option<String>,
) -> Result<crate::dive::PromptCheckResult, String> {
    let engine = crate::dive::PromptCheckEngine::new(state.provider.clone(), state.model.clone());
    engine
        .review(&text, stage.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn checkpoint_create(
    state: State<'_, AppState>,
    session_id: i64,
    card_id: Option<i64>,
    label: Option<String>,
) -> Result<crate::db::models::CheckpointRow, String> {
    let engine =
        crate::checkpoint::CheckpointEngine::new(state.project_root.clone(), state.db.clone());
    engine.init().map_err(|e| e.to_string())?;
    engine
        .create_checkpoint(session_id, card_id, "manual", label.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn checkpoint_restore(
    state: State<'_, AppState>,
    checkpoint_id: i64,
) -> Result<(), String> {
    let engine =
        crate::checkpoint::CheckpointEngine::new(state.project_root.clone(), state.db.clone());
    engine
        .restore_checkpoint(checkpoint_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn checkpoint_list(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<Vec<crate::db::models::CheckpointRow>, String> {
    let engine =
        crate::checkpoint::CheckpointEngine::new(state.project_root.clone(), state.db.clone());
    engine
        .list_checkpoints(session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn openrouter_issue_key(
    main_key: String,
    label: String,
    limit_usd: Option<f64>,
) -> Result<crate::auth::ChildKey, String> {
    let prov = crate::auth::OpenRouterProvisioning::new();
    prov.issue_child_key(&main_key, &label, limit_usd)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn openrouter_revoke_all(
    main_key: String,
    label_prefix: String,
) -> Result<usize, String> {
    let prov = crate::auth::OpenRouterProvisioning::new();
    prov.revoke_all_by_prefix(&main_key, &label_prefix)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn openrouter_list_keys(
    main_key: String,
) -> Result<Vec<crate::auth::ChildKeySummary>, String> {
    let prov = crate::auth::OpenRouterProvisioning::new();
    prov.list_child_keys(&main_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_session(
    state: State<'_, AppState>,
    session_id: i64,
    options: Option<crate::export::ExportOptions>,
) -> Result<String, String> {
    let engine = crate::export::ExportEngine::new(state.db.clone());
    let opts = options.unwrap_or_default();
    engine
        .export_session(session_id, &opts)
        .map_err(|e| e.to_string())
}
