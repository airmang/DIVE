//! Tauri IPC commands (spec §11.5).
//!
//! Exposes `chat_send` and `chat_cancel` wired to the Agent Loop. `AppState`
//! owns the shared runtime handles (DB, provider, registry, permission hook,
//! in-flight cancel tokens). The provider is initialized from the
//! `DIVE_PROVIDER` env var in task 2-3; full settings UI lands in task 4-2.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::agent::{AgentEvent, AgentLoop, PermissionHook, SafeOnlyHook};
use crate::db::Database;
use crate::providers::{LlmProvider, MockProvider};
use crate::tools::{ToolContext, ToolRegistry};

pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub provider: Arc<dyn LlmProvider>,
    pub registry: Arc<ToolRegistry>,
    pub permission: Arc<dyn PermissionHook>,
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
        Self {
            db: Arc::new(Mutex::new(db)),
            provider,
            registry: Arc::new(ToolRegistry::with_builtins()),
            permission: Arc::new(SafeOnlyHook),
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
) -> Result<(), String> {
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
