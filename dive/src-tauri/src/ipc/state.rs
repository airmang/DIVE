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

use super::preview::{PreviewProcess, StaticPreviewServer};
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
    pub(crate) static_preview_server: Arc<Mutex<Option<StaticPreviewServer>>>,
    pub cancels: Arc<Mutex<HashMap<i64, Arc<AtomicBool>>>>,
    pub route_cancels: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub keyring: Arc<dyn Keyring>,
    /// Cached pi-ai model registry, queried from the sidecar once per app run
    /// (S-051 D1). See `crate::pi_sidecar::PiModelRegistryCache` doc comment.
    pub pi_model_registry: Arc<crate::pi_sidecar::PiModelRegistryCache>,
    /// Single-flight gate for `ensure_provider_runtime`'s hydrate path: only
    /// one concurrent caller performs the keyring/db hydrate at a time, the
    /// rest block here and then re-check the now-populated runtime instead
    /// of each hydrating independently.
    hydrate_gate: Arc<tokio::sync::Mutex<()>>,
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
            static_preview_server: Arc::new(Mutex::new(None)),
            cancels: Arc::new(Mutex::new(HashMap::new())),
            route_cancels: Arc::new(Mutex::new(HashMap::new())),
            keyring: Arc::new(OsKeyring::new()),
            pi_model_registry: Arc::new(crate::pi_sidecar::PiModelRegistryCache::new()),
            hydrate_gate: Arc::new(tokio::sync::Mutex::new(())),
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
            static_preview_server: Arc::new(Mutex::new(None)),
            cancels: Arc::new(Mutex::new(HashMap::new())),
            route_cancels: Arc::new(Mutex::new(HashMap::new())),
            keyring,
            pi_model_registry: Arc::new(crate::pi_sidecar::PiModelRegistryCache::new()),
            hydrate_gate: Arc::new(tokio::sync::Mutex::new(())),
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

    /// Installs `next` only if no runtime is currently set, checked and
    /// written atomically under the same write-lock critical section.
    /// Returns `None` when `next` was installed, or `Some(current)` when a
    /// concurrent caller (e.g. `provider_connect`/`provider_select`/
    /// `provider_disconnect`) already installed a runtime — in which case
    /// `next` is dropped rather than clobbering that racing write.
    fn swap_runtime_if_none(
        &self,
        next: ProviderRuntime,
    ) -> Result<Option<ProviderRuntime>, String> {
        let mut runtime = self.runtime.write().map_err(|e| e.to_string())?;
        if runtime.kind.is_none() {
            *runtime = next;
            Ok(None)
        } else {
            Ok(Some(runtime.clone()))
        }
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

    /// Returns `Some(current)` when the active runtime is already usable
    /// (no hydrate needed), or `None` when the caller must hydrate. As a
    /// side effect, resets a stale Codex runtime (revoked tokens) to `none`
    /// so the subsequent hydrate re-derives it from disk.
    fn resolve_active_runtime(&self) -> Result<Option<ProviderRuntime>, String> {
        let current = self.runtime_snapshot();
        if current.kind.is_none() {
            return Ok(None);
        }
        if current.kind == ProviderKind::Codex
            && current
                .config_id
                .and_then(|id| auth::load_codex_tokens(self.keyring.as_ref(), id).ok())
                .flatten()
                .is_none()
        {
            self.swap_runtime(ProviderRuntime::none())
                .map_err(|e| format!("runtime: {e}"))?;
            return Ok(None);
        }
        providers::validate_model_for_kind(current.kind.as_str(), &current.model)
            .map_err(|e| e.to_string())?;
        Ok(Some(current))
    }

    pub async fn ensure_provider_runtime(&self) -> Result<ProviderRuntime, String> {
        if let Some(current) = self.resolve_active_runtime()? {
            return Ok(current);
        }

        // Single-flight: only one caller hydrates at a time. Concurrent
        // callers block on this gate and, once it is free, re-check the
        // runtime below instead of each independently hitting the db and
        // keyring (this also enforces the CAS re-check that keeps a stale
        // hydrate result from clobbering a concurrent connect/select/
        // disconnect that raced in while we were waiting or hydrating).
        let _hydrate_guard = self.hydrate_gate.lock().await;
        if let Some(current) = self.resolve_active_runtime()? {
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
        // CAS re-check: install `next` only if the runtime is still `none`.
        // A concurrent provider_connect/select/disconnect (outside this
        // gate) may have installed a runtime while we were hydrating; in
        // that case discard the stale hydrate result instead of clobbering
        // theirs.
        match self.swap_runtime_if_none(next.clone())? {
            None => Ok(next),
            Some(current) => {
                tracing::info!(
                    provider_kind = %current.kind.as_str(),
                    "discarding stale provider runtime hydrate result: runtime changed concurrently"
                );
                Ok(current)
            }
        }
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
        if let Ok(mut preview) = self.preview_process.lock() {
            if let Some(mut process) = preview.take() {
                let _ = process.child.start_kill();
            }
        }
        if let Ok(mut server) = self.static_preview_server.lock() {
            if let Some(server) = server.take() {
                server.abort();
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::InMemoryKeyring;

    fn provider_runtime_for_test(config_id: i64, model: &str) -> ProviderRuntime {
        ProviderRuntime::new(
            Some(config_id),
            ProviderKind::Anthropic,
            model.to_owned(),
            Arc::new(MockProvider::new(Vec::new())),
        )
    }

    /// Regression test for the hydrate-clobber race: a hydrate that resolves
    /// after a concurrent `provider_connect`/`select`/`disconnect` already
    /// installed a runtime must not overwrite it. This exercises the exact
    /// CAS re-check `ensure_provider_runtime` performs via
    /// `swap_runtime_if_none` right before installing a hydrate result.
    #[test]
    fn swap_runtime_if_none_does_not_clobber_a_concurrently_installed_runtime() {
        let state = AppState::dev_mock();

        // Baseline: installs cleanly into an empty runtime, same as the
        // uncontended hydrate path.
        state.swap_runtime(ProviderRuntime::none()).unwrap();
        let first = provider_runtime_for_test(1, "claude-sonnet-5");
        assert!(state.swap_runtime_if_none(first).unwrap().is_none());
        assert_eq!(state.runtime_snapshot().config_id, Some(1));

        // Simulate the race: runtime goes back to `none` (as it would right
        // before a hydrate is kicked off), then a concurrent caller (e.g.
        // provider_connect) installs a runtime directly via `swap_runtime`
        // while the hydrate is still in flight.
        state.swap_runtime(ProviderRuntime::none()).unwrap();
        let concurrent = provider_runtime_for_test(2, "claude-opus-4-6");
        state.swap_runtime(concurrent).unwrap();

        // The late hydrate result must be rejected, not installed, and the
        // concurrently-installed runtime must remain in place.
        let stale_hydrate = provider_runtime_for_test(3, "claude-haiku-4-5");
        let rejected = state
            .swap_runtime_if_none(stale_hydrate)
            .unwrap()
            .expect("stale hydrate result must be rejected when runtime is no longer none");
        assert_eq!(rejected.config_id, Some(2));
        assert_eq!(state.runtime_snapshot().config_id, Some(2));
    }

    /// End-to-end companion: concurrent `ensure_provider_runtime` calls that
    /// both start from `none` must converge on one consistent hydrated
    /// runtime rather than racing to install different results.
    #[tokio::test]
    async fn ensure_provider_runtime_converges_under_concurrent_calls() {
        let state = AppState::dev_mock().with_keyring(Arc::new(InMemoryKeyring::new()));
        let id = {
            let db = state.db.lock().unwrap();
            provider_dao::insert(
                db.conn(),
                &crate::db::models::NewProviderConfig {
                    kind: "anthropic".into(),
                    auth_type: "api_key".into(),
                    base_url: None,
                    config: serde_json::Value::Object(serde_json::Map::new()),
                },
            )
            .unwrap()
        };
        auth::upsert_provider_api_key(state.keyring.as_ref(), id, "sk-test").unwrap();
        state.swap_runtime(ProviderRuntime::none()).unwrap();

        let state_a = state.clone();
        let state_b = state.clone();
        let (a, b) = tokio::join!(
            tokio::spawn(async move { state_a.ensure_provider_runtime().await }),
            tokio::spawn(async move { state_b.ensure_provider_runtime().await }),
        );
        let runtime_a = a.unwrap().unwrap();
        let runtime_b = b.unwrap().unwrap();
        assert_eq!(runtime_a.config_id, Some(id));
        assert_eq!(runtime_b.config_id, Some(id));
        assert_eq!(state.runtime_snapshot().config_id, Some(id));
    }
}
