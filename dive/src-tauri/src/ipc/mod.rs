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
pub mod provider_runtime;
pub mod session;
pub mod timeline;
pub mod workmap;
pub mod workspace_plan;

pub use codex_oauth::*;
pub use mcp::*;
pub use policy::*;
pub use project::*;
pub use provider::*;
pub use provider_runtime::*;
pub use session::*;
pub use timeline::*;
pub use workmap::*;
pub use workspace_plan::*;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::agent::{
    AgentEvent, AgentLoop, AgentRunMode, AutoApprovePolicy, PendingApprovals, PermissionDecision,
    PermissionHook, PolicyAwareHook, RunModePermissionHook, StepContext,
};
use crate::auth::{self, Keyring, LocalFileKeyring, OsKeyring};
use crate::db::dao::{
    card as card_dao, message as message_dao, plan as plan_dao, project as project_dao,
    provider_config as provider_dao, step as step_dao, step_session_mapping as mapping_dao,
    workmap as workmap_dao,
};
use crate::db::models::{CardState, CheckpointRow, MessageRow, NewCard, ProviderConfigRow};
use crate::db::Database;
use crate::dive::event_log as dive_event_log;
use crate::dive::{apply_transition, CardTransition, DiveStage};
use crate::providers::{self, LlmProvider};
use crate::tools::{ToolContext, ToolRegistry};

#[cfg(any(test, feature = "dev-mock"))]
use crate::providers::MockProvider;

#[derive(Debug, thiserror::Error)]
pub enum AppStateError {
    #[error("tauri: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("db: {0}")]
    Db(#[from] crate::db::DbError),
    #[error("auth: {0}")]
    Auth(#[from] crate::auth::AuthError),
    #[error("oauth: {0}")]
    OAuth(#[from] crate::auth::OAuthError),
    #[error("provider: {0}")]
    Provider(#[from] crate::providers::ProviderError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

const PROJECT_NOT_SELECTED_MESSAGE: &str = "프로젝트를 선택하세요";
const PROVIDER_RUNTIME_HYDRATE_TIMEOUT: Duration = Duration::from_secs(120);
const PROVIDER_RUNTIME_HYDRATE_TIMEOUT_MESSAGE: &str =
    "AI 연결 정보를 불러오는 중 시간이 초과되었습니다. macOS 키체인 암호 창이 떠 있다면 로그인 암호를 입력하고 '항상 허용'을 선택한 뒤 다시 시도하세요.";

pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub runtime: Arc<RwLock<ProviderRuntime>>,
    pub registry: Arc<ToolRegistry>,
    pub permission: Arc<dyn PermissionHook>,
    pub auto_policy: Arc<RwLock<AutoApprovePolicy>>,
    pub research_gates_disabled: Arc<RwLock<bool>>,
    pub pending_approvals: PendingApprovals,
    pub project_root: Arc<RwLock<PathBuf>>,
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
        let auto_policy = Arc::new(RwLock::new(AutoApprovePolicy::default()));
        let permission: Arc<dyn PermissionHook> = Arc::new(PolicyAwareHook::new(
            pending.clone(),
            auto_policy.clone(),
            true,
        ));
        let kind = ProviderKind::parse(provider.id());
        let runtime = ProviderRuntime::new(None, kind, model, provider);
        Self {
            db: Arc::new(Mutex::new(db)),
            runtime: Arc::new(RwLock::new(runtime)),
            registry: Arc::new(ToolRegistry::with_builtins()),
            permission,
            auto_policy,
            research_gates_disabled: Arc::new(RwLock::new(false)),
            pending_approvals: pending,
            project_root: Arc::new(RwLock::new(project_root)),
            cancels: Arc::new(Mutex::new(HashMap::new())),
            keyring: Arc::new(OsKeyring::new()),
        }
    }

    #[cfg(any(test, feature = "dev-mock"))]
    pub fn dev_mock() -> Self {
        let mut db = Database::open_in_memory().expect("in-memory db");
        db.migrate().expect("migrate");
        let provider = Arc::new(MockProvider::new(Vec::new()));
        Self::new(db, provider, PathBuf::from("."), "mock-model".into())
    }

    pub fn from_app_handle(app: &AppHandle) -> Result<Self, AppStateError> {
        let data_dir = app.path().app_local_data_dir()?;
        std::fs::create_dir_all(&data_dir)?;
        let mut db = Database::open(data_dir.join("dive.db"))?;
        db.migrate()?;

        let keyring = keyring_from_environment(data_dir.join("qa-secrets.json"));
        let runtime = ProviderRuntime::none();
        let project_root = project_dao::list(db.conn())?
            .last()
            .map(|project| PathBuf::from(&project.path))
            .unwrap_or_default();

        Ok(Self::from_parts(db, runtime, project_root, keyring))
    }

    fn from_parts(
        db: Database,
        runtime: ProviderRuntime,
        project_root: PathBuf,
        keyring: Arc<dyn Keyring>,
    ) -> Self {
        let pending = PendingApprovals::new();
        let auto_policy = Arc::new(RwLock::new(AutoApprovePolicy::default()));
        let permission: Arc<dyn PermissionHook> = Arc::new(PolicyAwareHook::new(
            pending.clone(),
            auto_policy.clone(),
            true,
        ));
        Self {
            db: Arc::new(Mutex::new(db)),
            runtime: Arc::new(RwLock::new(runtime)),
            registry: Arc::new(ToolRegistry::with_builtins()),
            permission,
            auto_policy,
            research_gates_disabled: Arc::new(RwLock::new(false)),
            pending_approvals: pending,
            project_root: Arc::new(RwLock::new(project_root)),
            cancels: Arc::new(Mutex::new(HashMap::new())),
            keyring,
        }
    }

    pub fn with_keyring(mut self, keyring: Arc<dyn Keyring>) -> Self {
        self.keyring = keyring;
        self
    }

    pub fn runtime_snapshot(&self) -> ProviderRuntime {
        self.runtime
            .read()
            .map(|runtime| runtime.clone())
            .unwrap_or_else(|_| ProviderRuntime::none())
    }

    pub fn swap_runtime(&self, next: ProviderRuntime) -> Result<(), String> {
        let mut runtime = self.runtime.write().map_err(|e| e.to_string())?;
        *runtime = next;
        Ok(())
    }

    pub async fn ensure_provider_runtime(&self) -> Result<ProviderRuntime, String> {
        let current = self.runtime_snapshot();
        if !current.kind.is_none() {
            providers::validate_model_for_kind(current.kind.as_str(), &current.model)
                .map_err(|e| e.to_string())?;
            return Ok(current);
        }

        tracing::info!(
            timeout_secs = PROVIDER_RUNTIME_HYDRATE_TIMEOUT.as_secs(),
            "provider runtime hydrate started"
        );
        let db = self.db.clone();
        let keyring = self.keyring.clone();
        let hydrate = tauri::async_runtime::spawn_blocking(move || {
            let rows = {
                let db = db.lock().map_err(|e| e.to_string())?;
                provider_dao::list(db.conn()).map_err(|e| e.to_string())?
            };
            hydrate_provider_runtime_from_rows(rows, keyring.as_ref()).map_err(|e| e.to_string())
        });
        let next = match tokio::time::timeout(PROVIDER_RUNTIME_HYDRATE_TIMEOUT, hydrate).await {
            Ok(result) => result.map_err(|e| format!("provider runtime task failed: {e}"))??,
            Err(_) => {
                tracing::warn!(
                    timeout_secs = PROVIDER_RUNTIME_HYDRATE_TIMEOUT.as_secs(),
                    "provider runtime hydrate timed out"
                );
                return Err(PROVIDER_RUNTIME_HYDRATE_TIMEOUT_MESSAGE.into());
            }
        };
        tracing::info!(
            provider_kind = %next.kind.as_str(),
            has_config_id = next.config_id.is_some(),
            "provider runtime hydrate completed"
        );
        if next.kind.is_none() {
            return Ok(next);
        }
        providers::validate_model_for_kind(next.kind.as_str(), &next.model)
            .map_err(|e| e.to_string())?;
        self.swap_runtime(next.clone())
            .map_err(|e| format!("runtime: {e}"))?;
        Ok(next)
    }

    pub fn project_root_snapshot(&self) -> PathBuf {
        self.project_root
            .read()
            .map(|root| root.clone())
            .unwrap_or_default()
    }

    pub fn project_root_required(&self) -> Result<PathBuf, String> {
        let root = self.project_root_snapshot();
        if root.as_os_str().is_empty() {
            return Err(PROJECT_NOT_SELECTED_MESSAGE.to_owned());
        }
        Ok(root)
    }

    pub fn swap_project_root(&self, next: PathBuf) -> Result<(), String> {
        let mut root = self.project_root.write().map_err(|e| e.to_string())?;
        *root = next;
        Ok(())
    }

    pub fn research_gates_disabled(&self) -> Result<bool, String> {
        self.research_gates_disabled
            .read()
            .map(|value| *value)
            .map_err(|e| e.to_string())
    }

    pub fn set_research_gates_disabled(&self, disabled: bool) -> Result<(), String> {
        let mut value = self
            .research_gates_disabled
            .write()
            .map_err(|e| e.to_string())?;
        *value = disabled;
        Ok(())
    }
}

fn keyring_from_environment(default_local_file_path: PathBuf) -> Arc<dyn Keyring> {
    match std::env::var("DIVE_SECRET_BACKEND").ok().as_deref() {
        Some("local-file") => {
            let path = std::env::var_os("DIVE_LOCAL_SECRET_PATH")
                .map(PathBuf::from)
                .unwrap_or(default_local_file_path);
            tracing::warn!(
                secret_backend = "local-file",
                path = %path.display(),
                "QA local file secret backend enabled"
            );
            Arc::new(LocalFileKeyring::new(path))
        }
        _ => Arc::new(OsKeyring::new()),
    }
}

fn hydrate_provider_runtime(
    db: &Database,
    keyring: &dyn Keyring,
) -> Result<ProviderRuntime, AppStateError> {
    let rows = provider_dao::list(db.conn())?;
    hydrate_provider_runtime_from_rows(rows, keyring)
}

fn hydrate_provider_runtime_from_rows(
    rows: Vec<ProviderConfigRow>,
    keyring: &dyn Keyring,
) -> Result<ProviderRuntime, AppStateError> {
    for row in rows.into_iter().rev() {
        if row.kind == "codex" {
            let Some((access_token, refresh_token, id_token)) =
                auth::load_codex_tokens(keyring, row.id)?
            else {
                continue;
            };
            let account_id = auth::codex_oauth::decode_account_id(&id_token)?;
            let tokens = auth::CodexTokens {
                access_token,
                refresh_token,
                id_token,
                account_id,
                expires_in: 0,
            };
            let provider = Arc::new(crate::providers::CodexProvider::new(
                tokens,
                auth::CodexOAuth::new(),
            ));
            let model = providers::normalize_model_for_kind(
                &row.kind,
                row.config
                    .get("selected_model")
                    .or_else(|| row.config.get("model"))
                    .and_then(|value| value.as_str()),
            );
            return Ok(ProviderRuntime::new(
                Some(row.id),
                ProviderKind::parse(&row.kind),
                model,
                provider,
            ));
        }
        let Some(api_key) = auth::load_provider_api_key(keyring, row.id)? else {
            continue;
        };
        let model = providers::normalize_model_for_kind(
            &row.kind,
            row.config
                .get("selected_model")
                .or_else(|| row.config.get("model"))
                .and_then(|value| value.as_str()),
        );
        let provider = match providers::build_provider(&row.kind, &api_key, row.base_url.as_deref())
        {
            Ok(provider) => provider,
            Err(crate::providers::ProviderError::Unsupported(_)) => continue,
            Err(err) => return Err(err.into()),
        };
        return Ok(ProviderRuntime::new(
            Some(row.id),
            ProviderKind::parse(&row.kind),
            model,
            provider,
        ));
    }
    Ok(ProviderRuntime::none())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_state_runtime_snapshot_and_swap_are_atomic_unit() {
        let state = AppState::dev_mock();
        assert_eq!(state.runtime_snapshot().model, "mock-model");

        state.swap_runtime(ProviderRuntime::none()).unwrap();
        let snap = state.runtime_snapshot();
        assert!(snap.kind.is_none());
        assert_eq!(snap.model, "unset");
    }

    #[tokio::test]
    async fn ensure_provider_runtime_rejects_invalid_active_model_with_cta() {
        let state = AppState::dev_mock();
        state
            .swap_runtime(ProviderRuntime::new(
                Some(1),
                ProviderKind::OpencodeZen,
                "ling-2.6-flash".into(),
                Arc::new(crate::providers::MockProvider::new(Vec::new())),
            ))
            .unwrap();

        let err = match state.ensure_provider_runtime().await {
            Ok(_) => panic!("invalid runtime model should be rejected"),
            Err(err) => err,
        };
        assert!(err.contains("ling-2.6-flash"));
        assert!(err.contains("Settings"));
    }

    #[test]
    fn project_root_required_rejects_empty_snapshot() {
        let state = AppState::dev_mock();
        state.swap_project_root(PathBuf::new()).unwrap();
        let err = state.project_root_required().unwrap_err();
        assert!(err.contains(PROJECT_NOT_SELECTED_MESSAGE));
    }

    #[test]
    fn project_root_snapshot_and_swap_are_atomic_unit() {
        let state = AppState::dev_mock();
        let root = PathBuf::from("/tmp/dive-project-root-snapshot");
        state.swap_project_root(root.clone()).unwrap();
        assert_eq!(state.project_root_snapshot(), root);
        assert_eq!(state.project_root_required().unwrap(), root);
    }

    fn seed_session(state: &AppState, project_root: &std::path::Path) -> i64 {
        let db = state.db.lock().unwrap();
        let project_id = crate::db::dao::project::insert(
            db.conn(),
            &crate::db::models::NewProject {
                name: "p".into(),
                path: project_root.to_string_lossy().into(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        crate::db::dao::session::insert(
            db.conn(),
            &crate::db::models::NewSession {
                project_id,
                title: "s".into(),
                ended_at: None,
                status: "active".into(),
            },
        )
        .unwrap()
    }

    fn seed_card(state: &AppState, session_id: i64, title: &str, card_state: CardState) -> i64 {
        let db = state.db.lock().unwrap();
        crate::db::dao::card::insert(
            db.conn(),
            &NewCard {
                session_id,
                title: title.into(),
                instruction: Some("instruction".into()),
                assist_summary: None,
                acceptance_criteria: None,
                retrospective: None,
                change_summary: None,
                state: card_state,
                verify_log: None,
                changed_files: None,
                test_command: None,
                position: 1,
            },
        )
        .unwrap()
    }

    #[test]
    fn card_transitions_create_dive_stage_auto_checkpoints() {
        let state = AppState::dev_mock();
        let tmp = tempfile::tempdir().unwrap();
        state.swap_project_root(tmp.path().to_path_buf()).unwrap();
        let session_id = seed_session(&state, tmp.path());
        crate::checkpoint::CheckpointEngine::new(tmp.path(), state.db.clone())
            .init()
            .unwrap();

        let cases = [
            (
                "enter.txt",
                CardState::Decomposed,
                CardTransition::EnterInstruct,
                "[I 진입] enter",
                None,
            ),
            (
                "request.txt",
                CardState::Instructed,
                CardTransition::RequestVerify,
                "[V 요청] request",
                None,
            ),
            (
                "reject.txt",
                CardState::Verifying,
                CardTransition::Reject,
                "[V 거부] reject",
                None,
            ),
            (
                "approve.txt",
                CardState::Verifying,
                CardTransition::Approve,
                "[V 통과] approve",
                Some(true),
            ),
            (
                "extend.txt",
                CardState::Verified,
                CardTransition::Extend,
                "[E 진입] extend",
                None,
            ),
        ];

        for (file, initial_state, transition, expected_label, approve_force) in cases {
            std::fs::write(tmp.path().join(file), transition_name(transition)).unwrap();
            let card_id = seed_card(
                &state,
                session_id,
                expected_label
                    .trim_start_matches('[')
                    .split("] ")
                    .last()
                    .unwrap(),
                initial_state,
            );
            let (_next, row) =
                card_transition_with_checkpoint_impl(&state, card_id, transition, approve_force)
                    .unwrap();
            let row = row.expect("transition should create an auto checkpoint");
            assert_eq!(row.kind, "auto");
            assert_eq!(row.label.as_deref(), Some(expected_label));
            assert_eq!(row.git_sha.len(), 40);
            assert!(
                row.changed_files.iter().any(|changed| changed == file),
                "expected {file} in changed files, got {:?}",
                row.changed_files
            );
        }
        let logs = {
            let db = state.db.lock().unwrap();
            crate::db::dao::event_log::list_by_session(db.conn(), session_id).unwrap()
        };
        assert_eq!(
            logs.iter()
                .filter(|row| row.r#type == "card_update")
                .count(),
            5
        );
        assert_eq!(
            logs.iter()
                .filter(|row| row.r#type == "checkpoint_create")
                .count(),
            5
        );
    }

    #[test]
    fn card_update_test_command_saves_trims_clears_and_logs() {
        let state = AppState::dev_mock();
        let tmp = tempfile::tempdir().unwrap();
        state.swap_project_root(tmp.path().to_path_buf()).unwrap();
        let session_id = seed_session(&state, tmp.path());
        let card_id = seed_card(&state, session_id, "verify command", CardState::Instructed);

        card_update_test_command_impl(&state, card_id, Some("  pnpm test  ".into())).unwrap();
        {
            let db = state.db.lock().unwrap();
            let row = crate::db::dao::card::get_by_id(db.conn(), card_id)
                .unwrap()
                .unwrap();
            assert_eq!(row.test_command.as_deref(), Some("pnpm test"));
        }

        card_update_test_command_impl(&state, card_id, Some("   ".into())).unwrap();
        let db = state.db.lock().unwrap();
        let row = crate::db::dao::card::get_by_id(db.conn(), card_id)
            .unwrap()
            .unwrap();
        assert_eq!(row.test_command, None);
        let logs = crate::db::dao::event_log::list_by_session(db.conn(), session_id).unwrap();
        assert_eq!(
            logs.iter()
                .filter(|row| row.r#type == "card_update")
                .count(),
            2
        );
    }

    #[test]
    fn message_list_restores_persisted_chat_rows_for_ui() {
        let state = AppState::dev_mock();
        let tmp = tempfile::tempdir().unwrap();
        state.swap_project_root(tmp.path().to_path_buf()).unwrap();
        let session_id = seed_session(&state, tmp.path());
        {
            let db = state.db.lock().unwrap();
            crate::db::dao::message::insert(
                db.conn(),
                &crate::db::models::NewMessage {
                    session_id,
                    card_id: None,
                    role: "user".into(),
                    content: "hello".into(),
                    reasoning_content: None,
                    tool_calls: None,
                    usage: None,
                    provider: Some("openai".into()),
                    model: Some("gpt".into()),
                },
            )
            .unwrap();
            crate::db::dao::message::insert(
                db.conn(),
                &crate::db::models::NewMessage {
                    session_id,
                    card_id: None,
                    role: "assistant".into(),
                    content: "world".into(),
                    reasoning_content: None,
                    tool_calls: None,
                    usage: None,
                    provider: Some("openai".into()),
                    model: Some("gpt".into()),
                },
            )
            .unwrap();
        }

        let history = message_list_impl(&state, session_id).unwrap();
        assert_eq!(history.len(), 2);
        assert!(matches!(history[0], ChatHistoryMessage::User { .. }));
        assert!(matches!(history[1], ChatHistoryMessage::Assistant { .. }));
    }

    fn transition_name(transition: CardTransition) -> &'static str {
        match transition {
            CardTransition::EnterInstruct => "enter",
            CardTransition::RequestVerify => "request",
            CardTransition::Approve => "approve",
            CardTransition::Reject => "reject",
            CardTransition::ReopenFromReject => "reopen",
            CardTransition::Extend => "extend",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatEventEnvelope {
    pub session_id: i64,
    #[serde(flatten)]
    pub event: AgentEvent,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChatHistoryMessage {
    #[serde(rename_all = "camelCase")]
    User {
        id: String,
        created_at: i64,
        content: String,
    },
    #[serde(rename_all = "camelCase")]
    Assistant {
        id: String,
        created_at: i64,
        content: String,
        streaming: bool,
    },
    #[serde(rename_all = "camelCase")]
    System {
        id: String,
        created_at: i64,
        content: String,
    },
}

fn history_message_from_row(row: MessageRow) -> Option<ChatHistoryMessage> {
    let id = format!("db-{}", row.id);
    match row.role.as_str() {
        "user" => Some(ChatHistoryMessage::User {
            id,
            created_at: row.created_at,
            content: row.content,
        }),
        "assistant" => Some(ChatHistoryMessage::Assistant {
            id,
            created_at: row.created_at,
            content: row.content,
            streaming: false,
        }),
        "system" => Some(ChatHistoryMessage::System {
            id,
            created_at: row.created_at,
            content: row.content,
        }),
        _ => None,
    }
}

fn log_event(
    state: &AppState,
    session_id: Option<i64>,
    event_type: &str,
    payload: Value,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    dive_event_log::append_to_conn(db.conn(), session_id, event_type, payload)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn log_error_event(
    state: &AppState,
    session_id: Option<i64>,
    source: &str,
    message: &str,
) -> Result<(), String> {
    log_event(
        state,
        session_id,
        "error_occurred",
        dive_event_log::error_payload(source, message),
    )
}

fn run_mode_for_stage(stage: DiveStage, plan_accepted: bool) -> AgentRunMode {
    if !plan_accepted {
        return AgentRunMode::Plan;
    }
    match stage {
        DiveStage::D => AgentRunMode::Plan,
        DiveStage::I | DiveStage::E => AgentRunMode::Build,
        DiveStage::V => AgentRunMode::Verify,
    }
}

fn run_mode_strictness(mode: AgentRunMode) -> u8 {
    match mode {
        AgentRunMode::Interview => 0,
        AgentRunMode::Plan => 1,
        AgentRunMode::Verify => 2,
        AgentRunMode::Build => 3,
    }
}

fn safest_run_mode(backend: AgentRunMode, requested: AgentRunMode) -> AgentRunMode {
    if run_mode_strictness(requested) <= run_mode_strictness(backend) {
        requested
    } else {
        backend
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn chat_send(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: i64,
    text: String,
    stage: Option<String>,
    run_mode: Option<String>,
    locale: Option<String>,
    plan_accepted: Option<bool>,
    step_id: Option<i64>,
) -> Result<(), String> {
    let stage = stage
        .as_deref()
        .and_then(DiveStage::parse)
        .unwrap_or(DiveStage::D);
    tracing::info!(
        session_id,
        stage = stage.as_str(),
        requested_run_mode = run_mode.as_deref().unwrap_or("default"),
        text_chars = text.chars().count(),
        step_id,
        "ipc chat_send started"
    );
    let requested_plan_accepted = plan_accepted.unwrap_or(false);
    let step_context = load_active_step_context(&state, session_id, step_id)?;
    let effective_plan_accepted = requested_plan_accepted
        || step_context
            .as_ref()
            .map(|ctx| ctx.plan_approved)
            .unwrap_or(false);
    let backend_run_mode = run_mode_for_stage(stage, effective_plan_accepted);
    let requested_run_mode = run_mode.as_deref().and_then(AgentRunMode::parse);
    let run_mode = match requested_run_mode {
        Some(requested) => safest_run_mode(backend_run_mode, requested),
        None => backend_run_mode,
    };
    let snap = state.ensure_provider_runtime().await?;
    if snap.kind.is_none() {
        let msg = crate::providers::ProviderError::NotConfigured.to_string();
        tracing::warn!(
            session_id,
            "ipc chat_send rejected because provider is not configured"
        );
        let _ = log_error_event(&state, Some(session_id), "provider", &msg);
        return Err(msg);
    }
    let project_root = state.project_root_required()?;
    let disable_gates = policy::research_controls_enabled() && state.research_gates_disabled()?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut guard = state.cancels.lock().map_err(|e| e.to_string())?;
        guard.insert(session_id, cancel.clone());
    }
    let loop_ = AgentLoop::builder()
        .provider(snap.provider)
        .registry(state.registry.clone())
        .permission(Arc::new(
            RunModePermissionHook::new(run_mode, state.permission.clone())
                .with_plan_accepted(effective_plan_accepted)
                .with_active_step_id(step_context.as_ref().map(|ctx| ctx.context.step_id)),
        ))
        .db(state.db.clone())
        .tool_ctx(ToolContext::new(project_root, session_id))
        .model(snap.model)
        .cancel(cancel)
        .stage(stage)
        .run_mode(run_mode)
        .disable_gates(disable_gates)
        .plan_accepted(effective_plan_accepted)
        .locale(locale)
        .step_context(step_context.map(|ctx| ctx.context))
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

    match res {
        Ok(_) => {
            tracing::info!(session_id, "ipc chat_send completed");
            Ok(())
        }
        Err(err) => {
            let message = err.to_string();
            tracing::error!(
                session_id,
                error = %crate::telemetry::redact_log_text(&message),
                "ipc chat_send failed"
            );
            let _ = log_error_event(&state, Some(session_id), "agent_loop", &message);
            Err(message)
        }
    }
}

struct LoadedStepContext {
    context: StepContext,
    plan_approved: bool,
}

fn load_active_step_context(
    state: &AppState,
    session_id: i64,
    step_id: Option<i64>,
) -> Result<Option<LoadedStepContext>, String> {
    let Some(step_id) = step_id else {
        return Ok(None);
    };
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let step = step_dao::get_by_id(db.conn(), step_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("step {step_id} not found"))?;
    let mapping = mapping_dao::get_by_step(db.conn(), step_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("step {step_id} has no active session mapping"))?;
    if mapping.session_id != Some(session_id) {
        return Err(format!(
            "step {step_id} is not active in session {session_id}"
        ));
    }
    let plan = plan_dao::get_by_id(db.conn(), step.plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {} not found", step.plan_id))?;
    Ok(Some(LoadedStepContext {
        context: StepContext {
            step_id: step.id,
            title: step.title,
            instruction_seed: step.instruction_seed,
            acceptance_criteria: join_json_strings(step.acceptance_criteria.as_ref(), "\n"),
            expected_files: join_json_strings(step.expected_files.as_ref(), ", "),
        },
        plan_approved: plan.status == "approved",
    }))
}

fn join_json_strings(value: Option<&Value>, separator: &str) -> Option<String> {
    let items = value?
        .as_array()?
        .iter()
        .filter_map(|item| item.as_str())
        .collect::<Vec<_>>();
    if items.is_empty() {
        None
    } else {
        Some(items.join(separator))
    }
}

fn message_list_impl(state: &AppState, session_id: i64) -> Result<Vec<ChatHistoryMessage>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let rows =
        message_dao::list_by_session(db.conn(), session_id, 500).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .filter_map(history_message_from_row)
        .collect())
}

#[tauri::command]
pub async fn message_list(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<Vec<ChatHistoryMessage>, String> {
    message_list_impl(&state, session_id)
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
    card_update_instruction_impl(&state, card_id, instruction)
}

#[tauri::command]
pub async fn card_update_test_command(
    state: State<'_, AppState>,
    card_id: i64,
    test_command: Option<String>,
) -> Result<(), String> {
    card_update_test_command_impl(&state, card_id, test_command)
}

pub fn card_update_instruction_impl(
    state: &AppState,
    card_id: i64,
    instruction: String,
) -> Result<CardState, String> {
    let (session_id, next_state, instruction_len) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let existing = card_dao::get_by_id(db.conn(), card_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("card {card_id} not found"))?;
        let trimmed = instruction.trim();
        let instruction_len = instruction.chars().count();
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
                assist_summary: existing.assist_summary.clone(),
                acceptance_criteria: existing.acceptance_criteria.clone(),
                retrospective: existing.retrospective.clone(),
                change_summary: existing.change_summary.clone(),
                state: next_state,
                verify_log: existing.verify_log.clone(),
                changed_files: existing.changed_files.clone(),
                test_command: existing.test_command.clone(),
                position: existing.position,
            },
        )
        .map_err(|e| e.to_string())?;
        (existing.session_id, next_state, instruction_len)
    };
    log_event(
        state,
        Some(session_id),
        "card_update",
        serde_json::json!({
            "card_id": card_id,
            "action": "instruction",
            "instruction_len": instruction_len,
            "state": next_state,
        }),
    )?;
    Ok(next_state)
}

pub fn card_update_test_command_impl(
    state: &AppState,
    card_id: i64,
    test_command: Option<String>,
) -> Result<(), String> {
    let normalized = test_command
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let session_id = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let existing = card_dao::get_by_id(db.conn(), card_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("card {card_id} not found"))?;
        card_dao::update(
            db.conn(),
            card_id,
            &NewCard {
                session_id: existing.session_id,
                title: existing.title,
                instruction: existing.instruction,
                assist_summary: existing.assist_summary,
                acceptance_criteria: existing.acceptance_criteria,
                retrospective: existing.retrospective,
                change_summary: existing.change_summary,
                state: existing.state,
                verify_log: existing.verify_log,
                changed_files: existing.changed_files,
                test_command: normalized.clone(),
                position: existing.position,
            },
        )
        .map_err(|e| e.to_string())?;
        existing.session_id
    };
    log_event(
        state,
        Some(session_id),
        "card_update",
        serde_json::json!({
            "card_id": card_id,
            "action": "test_command",
            "test_command_len": normalized.as_ref().map(|s| s.chars().count()).unwrap_or(0),
        }),
    )
}

pub fn card_transition_no_checkpoint_impl(
    state: &AppState,
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
    let change_summary = if matches!(next, CardState::Verified | CardState::Extended) {
        existing
            .change_summary
            .clone()
            .or_else(|| summarize_changed_files(&existing.changed_files))
    } else {
        existing.change_summary.clone()
    };
    card_dao::update(
        db.conn(),
        card_id,
        &NewCard {
            session_id: existing.session_id,
            title: existing.title,
            instruction: existing.instruction,
            assist_summary: existing.assist_summary,
            acceptance_criteria: existing.acceptance_criteria,
            retrospective: existing.retrospective,
            change_summary,
            state: next,
            verify_log: existing.verify_log,
            changed_files: existing.changed_files,
            test_command: existing.test_command,
            position: existing.position,
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(next)
}

fn summarize_changed_files(changed_files: &Option<Value>) -> Option<String> {
    let files = changed_files.as_ref()?.as_array()?;
    let mut paths = files
        .iter()
        .filter_map(|item| {
            item.as_str()
                .or_else(|| item.get("path").and_then(|path| path.as_str()))
        })
        .take(3)
        .collect::<Vec<_>>();
    if paths.is_empty() {
        return None;
    }
    paths.sort_unstable();
    let suffix = if files.len() > paths.len() {
        format!(" 외 {}개", files.len() - paths.len())
    } else {
        String::new()
    };
    Some(format!("변경 파일: {}{}", paths.join(", "), suffix))
}

#[tauri::command]
pub async fn card_save_retrospective(
    state: State<'_, AppState>,
    card_id: i64,
    retrospective: String,
) -> Result<(), String> {
    card_save_retrospective_impl(&state, card_id, retrospective)
}

pub fn card_save_retrospective_impl(
    state: &AppState,
    card_id: i64,
    retrospective: String,
) -> Result<(), String> {
    let normalized = retrospective.trim().to_string();
    let content = if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    };
    let session_id = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let existing = card_dao::get_by_id(db.conn(), card_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("card {card_id} not found"))?;
        card_dao::update(
            db.conn(),
            card_id,
            &NewCard {
                session_id: existing.session_id,
                title: existing.title,
                instruction: existing.instruction,
                assist_summary: existing.assist_summary,
                acceptance_criteria: existing.acceptance_criteria,
                retrospective: content.clone(),
                change_summary: existing.change_summary,
                state: existing.state,
                verify_log: existing.verify_log,
                changed_files: existing.changed_files,
                test_command: existing.test_command,
                position: existing.position,
            },
        )
        .map_err(|e| e.to_string())?;
        existing.session_id
    };
    log_event(
        state,
        Some(session_id),
        "card_update",
        serde_json::json!({
            "card_id": card_id,
            "action": "retrospective",
            "retrospective_len": content.as_ref().map(|s| s.chars().count()).unwrap_or(0),
        }),
    )
}

#[tauri::command]
pub async fn card_transition(
    state: State<'_, AppState>,
    app: AppHandle,
    card_id: i64,
    transition: CardTransition,
    approve_force: Option<bool>,
) -> Result<CardState, String> {
    let (next, checkpoint) =
        card_transition_with_checkpoint_impl(&state, card_id, transition, approve_force)?;

    if let Some(row) = checkpoint {
        let _ = app.emit(
            "checkpoint_created",
            serde_json::json!({
                "id": row.id,
                "session_id": row.session_id,
                "card_id": row.card_id,
                "kind": row.kind,
                "label": row.label,
                "git_sha": row.git_sha,
                "changed_files": row.changed_files,
                "stats": row.stats,
            }),
        );
    }

    Ok(next)
}

fn card_transition_with_checkpoint_impl(
    state: &AppState,
    card_id: i64,
    transition: CardTransition,
    approve_force: Option<bool>,
) -> Result<(CardState, Option<CheckpointRow>), String> {
    let (session_id, card_title, previous_state) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let existing = card_dao::get_by_id(db.conn(), card_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("card {card_id} not found"))?;
        (existing.session_id, existing.title.clone(), existing.state)
    };
    let next = card_transition_no_checkpoint_impl(state, card_id, transition, approve_force)?;
    log_event(
        state,
        Some(session_id),
        "card_update",
        serde_json::json!({
            "card_id": card_id,
            "action": "transition",
            "transition": transition,
            "from": previous_state,
            "to": next,
        }),
    )?;
    let previous_stage = stage_for_card_state(previous_state);
    let next_stage = stage_for_card_state(next);
    if previous_stage != next_stage {
        log_event(
            state,
            Some(session_id),
            "stage_exit",
            serde_json::json!({ "stage": previous_stage, "card_id": card_id }),
        )?;
        log_event(
            state,
            Some(session_id),
            "stage_enter",
            serde_json::json!({ "stage": next_stage, "card_id": card_id }),
        )?;
    }

    let Some(label) = auto_checkpoint_label(transition, &card_title) else {
        return Ok((next, None));
    };
    let project_root = state.project_root_required()?;
    let engine = crate::checkpoint::CheckpointEngine::new(project_root, state.db.clone());
    let checkpoint = if engine.checkpoint_dir().join("HEAD").exists() {
        engine
            .create_checkpoint(session_id, Some(card_id), "auto", Some(&label))
            .ok()
    } else {
        None
    };
    if let Some(row) = checkpoint.as_ref() {
        log_event(
            state,
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
    }
    Ok((next, checkpoint))
}

fn auto_checkpoint_label(transition: CardTransition, card_title: &str) -> Option<String> {
    match transition {
        CardTransition::EnterInstruct => Some(format!("[I 진입] {card_title}")),
        CardTransition::RequestVerify => Some(format!("[V 요청] {card_title}")),
        CardTransition::Reject => Some(format!("[V 거부] {card_title}")),
        CardTransition::Approve => Some(format!("[V 통과] {card_title}")),
        CardTransition::Extend => Some(format!("[E 진입] {card_title}")),
        CardTransition::ReopenFromReject => None,
    }
}

fn stage_for_card_state(state: CardState) -> &'static str {
    match state {
        CardState::Decomposed => "D",
        CardState::Instructed => "I",
        CardState::Verifying | CardState::Rejected => "V",
        CardState::Verified | CardState::Extended => "E",
    }
}

#[tauri::command]
pub async fn card_verify(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: i64,
    card_id: i64,
) -> Result<crate::dive::VerifyLog, String> {
    let snap = state.ensure_provider_runtime().await?;
    if snap.kind.is_none() {
        let msg = crate::providers::ProviderError::NotConfigured.to_string();
        let _ = log_error_event(&state, Some(session_id), "provider", &msg);
        return Err(msg);
    }
    let project_root = state.project_root_required()?;
    let engine = crate::dive::VerifyEngine::new(snap.provider, state.db.clone(), snap.model)
        .with_project_root(project_root);
    log_event(
        &state,
        Some(session_id),
        "verify_start",
        serde_json::json!({ "card_id": card_id }),
    )?;
    let _ = app.emit(
        "verify_started",
        serde_json::json!({ "session_id": session_id, "card_id": card_id }),
    );
    let log = match engine.verify_card(session_id, card_id).await {
        Ok(log) => log,
        Err(err) => {
            let message = err.to_string();
            let _ = log_error_event(&state, Some(session_id), "verify", &message);
            return Err(message);
        }
    };
    log_event(
        &state,
        Some(session_id),
        "verify_complete",
        serde_json::json!({
            "card_id": card_id,
            "intent_match": log.intent_match,
            "test_result": log.test_result,
        }),
    )?;
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
    let snap = state.ensure_provider_runtime().await?;
    if snap.kind.is_none() {
        return Err(crate::providers::ProviderError::NotConfigured.to_string());
    }
    let engine = crate::dive::AiAssistEngine::new(snap.provider, snap.model);
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
    locale: Option<String>,
) -> Result<crate::dive::PromptCheckResult, String> {
    let snap = state.ensure_provider_runtime().await?;
    if snap.kind.is_none() {
        return Err(crate::providers::ProviderError::NotConfigured.to_string());
    }
    let engine = crate::dive::PromptCheckEngine::new(snap.provider, snap.model);
    engine
        .review(&text, stage.as_deref(), locale.as_deref())
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
