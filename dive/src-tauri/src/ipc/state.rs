use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::agent::{AutoApprovePolicy, PendingApprovals, PermissionHook, PolicyAwareHook};
use crate::auth::{self, Keyring, LocalFileKeyring, OsKeyring};
use crate::db::dao::{project as project_dao, provider_config as provider_dao};
use crate::db::models::ProviderConfigRow;
use crate::db::Database;
use crate::providers::{self, LlmProvider};
use crate::tools::ToolRegistry;

#[cfg(any(test, feature = "dev-mock"))]
use crate::providers::MockProvider;

use super::preview::PreviewProcess;
use crate::db::models::RuntimeCapabilityState;

use super::{ProviderKind, ProviderRuntime};

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

pub(super) const PROJECT_NOT_SELECTED_MESSAGE: &str = "프로젝트를 선택하세요";
const PROVIDER_RUNTIME_HYDRATE_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeChoice {
    Pi { capability: RuntimeCapabilityState },
    Blocked { capability: RuntimeCapabilityState },
}
const PROVIDER_RUNTIME_HYDRATE_TIMEOUT_MESSAGE: &str =
    "AI 연결 정보를 불러오는 중 시간이 초과되었습니다. macOS 키체인 암호 창이 떠 있다면 로그인 암호를 입력하고 '항상 허용'을 선택한 뒤 다시 시도하세요.";

const SESSION_TURN_IN_PROGRESS_MESSAGE: &str =
    "이 세션에서 이전 작업이 아직 진행 중입니다. 승인 대기 중인 작업을 먼저 승인하거나 거부하세요.";

pub(super) struct ActiveTurnGuard {
    cancels: Arc<Mutex<HashMap<i64, Arc<AtomicBool>>>>,
    session_id: i64,
    token: Arc<AtomicBool>,
}

impl ActiveTurnGuard {
    pub(super) fn begin(state: &AppState, session_id: i64) -> Result<Self, String> {
        let token = Arc::new(AtomicBool::new(false));
        let mut guard = state.cancels.lock().map_err(|e| e.to_string())?;
        if guard.contains_key(&session_id) {
            return Err(SESSION_TURN_IN_PROGRESS_MESSAGE.into());
        }
        guard.insert(session_id, token.clone());
        Ok(Self {
            cancels: state.cancels.clone(),
            session_id,
            token,
        })
    }

    pub(super) fn token(&self) -> Arc<AtomicBool> {
        self.token.clone()
    }
}

impl Drop for ActiveTurnGuard {
    fn drop(&mut self) {
        let Ok(mut guard) = self.cancels.lock() else {
            return;
        };
        let should_remove = guard
            .get(&self.session_id)
            .map(|current| Arc::ptr_eq(current, &self.token))
            .unwrap_or(false);
        if should_remove {
            guard.remove(&self.session_id);
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub runtime: Arc<RwLock<ProviderRuntime>>,
    pub registry: Arc<ToolRegistry>,
    pub permission: Arc<dyn PermissionHook>,
    pub auto_policy: Arc<RwLock<AutoApprovePolicy>>,
    pub research_gates_disabled: Arc<RwLock<bool>>,
    pub require_approval_judgment: Arc<RwLock<bool>>,
    pub pending_approvals: PendingApprovals,
    pub project_root: Arc<RwLock<PathBuf>>,
    pub(crate) preview_process: Arc<Mutex<Option<PreviewProcess>>>,
    pub cancels: Arc<Mutex<HashMap<i64, Arc<AtomicBool>>>>,
    pub route_cancels: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
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
            require_approval_judgment: Arc::new(RwLock::new(true)),
            pending_approvals: pending,
            project_root: Arc::new(RwLock::new(project_root)),
            preview_process: Arc::new(Mutex::new(None)),
            cancels: Arc::new(Mutex::new(HashMap::new())),
            route_cancels: Arc::new(Mutex::new(HashMap::new())),
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
        let data_dir = app_data_dir_from_environment(app)?;
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
            require_approval_judgment: Arc::new(RwLock::new(true)),
            pending_approvals: pending,
            project_root: Arc::new(RwLock::new(project_root)),
            preview_process: Arc::new(Mutex::new(None)),
            cancels: Arc::new(Mutex::new(HashMap::new())),
            route_cancels: Arc::new(Mutex::new(HashMap::new())),
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

    pub fn invalidate_codex_credentials(&self, provider_config_id: i64) -> Result<(), String> {
        auth::delete_codex_tokens(self.keyring.as_ref(), provider_config_id)
            .map_err(|err| format!("keyring: {err}"))?;
        {
            let db = self.db.lock().map_err(|e| e.to_string())?;
            if let Some(row) = provider_dao::get_by_id(db.conn(), provider_config_id)
                .map_err(|e| e.to_string())?
                .filter(|row| row.kind == "codex")
            {
                let mut config = row.config.as_object().cloned().unwrap_or_default();
                config.insert("oauth_connected".to_owned(), serde_json::json!(false));
                config.insert(
                    "oauth_invalidated_at".to_owned(),
                    serde_json::json!(crate::db::now_ms()),
                );
                provider_dao::update(
                    db.conn(),
                    provider_config_id,
                    &crate::db::models::NewProviderConfig {
                        kind: row.kind,
                        auth_type: row.auth_type,
                        base_url: row.base_url,
                        config: serde_json::Value::Object(config),
                    },
                )
                .map_err(|e| e.to_string())?;
            }
        }
        if self.runtime_snapshot().config_id == Some(provider_config_id) {
            self.swap_runtime(ProviderRuntime::none())
                .map_err(|err| format!("runtime: {err}"))?;
        }
        Ok(())
    }

    pub async fn ensure_provider_runtime(&self) -> Result<ProviderRuntime, String> {
        let current = self.runtime_snapshot();
        if !current.kind.is_none() {
            if current.kind == ProviderKind::Codex
                && current
                    .config_id
                    .and_then(|id| auth::load_codex_tokens(self.keyring.as_ref(), id).ok())
                    .flatten()
                    .is_none()
            {
                self.swap_runtime(ProviderRuntime::none())
                    .map_err(|e| format!("runtime: {e}"))?;
            } else {
                providers::validate_model_for_kind(current.kind.as_str(), &current.model)
                    .map_err(|e| e.to_string())?;
                return Ok(current);
            }
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

    pub fn require_approval_judgment_value(&self) -> Result<bool, String> {
        self.require_approval_judgment
            .read()
            .map(|value| *value)
            .map_err(|e| e.to_string())
    }

    pub fn set_require_approval_judgment(&self, required: bool) -> Result<(), String> {
        let mut value = self
            .require_approval_judgment
            .write()
            .map_err(|e| e.to_string())?;
        *value = required;
        Ok(())
    }
}

pub(super) fn app_data_dir_from_environment(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    if let Some(path) = std::env::var_os("DIVE_QA_APP_DATA_DIR").map(PathBuf::from) {
        tracing::warn!(
            path = %path.display(),
            "QA app data directory override enabled"
        );
        return Ok(path);
    }
    app.path().app_local_data_dir()
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
            if super::provider::is_codex_config_marked_disconnected(&row.config) {
                continue;
            }
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
