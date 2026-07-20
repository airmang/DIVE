use std::collections::{HashMap, HashSet};
use std::sync::RwLock;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::time::{timeout, Duration};

use super::command::{bundled_sidecar_path, resolve_sidecar_command};
use super::protocol::{sidecar_event_name, SidecarEvent};
use super::transport::{redact_line, spawn_sidecar, SpawnedSidecar};

/// Bounded wait for the sidecar's `list_models` handshake response. Shorter
/// than `PI_TURN_TIMEOUT` — this is a local registry lookup with no network
/// calls or model inference, so a healthy sidecar answers in well under a
/// second; this budget only exists to bound a hung/broken process.
const MODEL_REGISTRY_QUERY_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Default)]
struct ModelRegistrySnapshot {
    /// pi-ai provider id -> model ids the pinned registry resolves for it.
    providers: HashMap<String, HashSet<String>>,
}

#[derive(Debug, Clone, Default)]
enum RegistryState {
    #[default]
    NotLoaded,
    Loaded(ModelRegistrySnapshot),
    /// The sidecar could not answer `list_models` (old build, spawn failure,
    /// timeout, malformed response). Sticky for the process lifetime — see
    /// `PiModelRegistryCache` doc comment for why this does not retry.
    Unavailable,
}

/// Caches the pinned pi-ai package's model registry for the life of the DIVE
/// process (S-051 D1). The sidecar itself is spawned fresh per turn (there is
/// no long-lived sidecar process to "restart" in this codebase today), but
/// the registry it resolves against is baked into the bundled sidecar binary
/// and cannot change without an app update — so caching once per app run is
/// the faithful equivalent of "per sidecar lifetime" here. A failed query is
/// remembered as `Unavailable` rather than retried on every chat turn, so a
/// broken/old sidecar degrades to "no preflight" (fail open) instead of
/// re-spawning a node process on every turn.
#[derive(Debug, Default)]
pub struct PiModelRegistryCache {
    state: RwLock<RegistryState>,
}

impl PiModelRegistryCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// `Some(true)` — the pinned registry resolves this provider+model.
    /// `Some(false)` — the registry answered and the model is not in it.
    /// `None` — the cache is not (yet, or ever) populated; callers MUST treat
    /// this as "unknown" and fail open (no capability regression).
    pub async fn executable(&self, provider_kind: &str, model: &str) -> Option<bool> {
        self.ensure_loaded().await;
        let guard = self.state.read().ok()?;
        match &*guard {
            RegistryState::Loaded(snapshot) => snapshot
                .providers
                .get(provider_kind)
                .map(|models| models.contains(model)),
            RegistryState::NotLoaded | RegistryState::Unavailable => None,
        }
    }

    async fn ensure_loaded(&self) {
        let needs_load = matches!(
            self.state.read().ok().as_deref(),
            Some(RegistryState::NotLoaded)
        );
        if !needs_load {
            return;
        }
        match query_model_registry().await {
            Ok(providers) => {
                if let Ok(mut guard) = self.state.write() {
                    if matches!(*guard, RegistryState::NotLoaded) {
                        *guard = RegistryState::Loaded(ModelRegistrySnapshot { providers });
                    }
                }
            }
            Err(err) => {
                tracing::warn!(
                    error = %crate::telemetry::redact_log_text(&err),
                    "pi sidecar list_models query failed; model executability preflight disabled for this run (fail open)"
                );
                if let Ok(mut guard) = self.state.write() {
                    if matches!(*guard, RegistryState::NotLoaded) {
                        *guard = RegistryState::Unavailable;
                    }
                }
            }
        }
    }

    /// `pub(crate)` (not `pub(super)`) so IPC-layer tests (e.g.
    /// `ipc::provider`'s `provider_list_models` executability-annotation
    /// tests, S-051 P2) can preload a fixed registry without spawning the
    /// real sidecar.
    #[cfg(test)]
    pub(crate) fn preloaded_for_test(providers: HashMap<String, HashSet<String>>) -> Self {
        Self {
            state: RwLock::new(RegistryState::Loaded(ModelRegistrySnapshot { providers })),
        }
    }
}

/// Spawns the sidecar solely to ask `list_models` and reads the single
/// response line — no `run` turn, no credentials, no network egress (S-051
/// D1). Used to populate `PiModelRegistryCache`.
pub(super) async fn query_model_registry() -> Result<HashMap<String, HashSet<String>>, String> {
    let sidecar_cmd = resolve_sidecar_command(bundled_sidecar_path())?;
    let SpawnedSidecar {
        mut child,
        mut stdin,
        stdout,
        stderr_task,
    } = spawn_sidecar(&sidecar_cmd, "spawn pi sidecar for list_models")?;

    stdin
        .write_all(b"{\"type\":\"list_models\"}\n")
        .await
        .map_err(|e| format!("write list_models request: {e}"))?;
    drop(stdin);

    let mut reader = BufReader::new(stdout).lines();
    let read_loop = async {
        loop {
            let line = reader
                .next_line()
                .await
                .map_err(|e| format!("read list_models response: {e}"))?
                .ok_or_else(|| {
                    "pi sidecar closed stdout before list_models responded".to_string()
                })?;
            if line.trim().is_empty() {
                continue;
            }
            let event: SidecarEvent = serde_json::from_str(&line)
                .map_err(|e| format!("parse list_models response: {e}: {}", redact_line(&line)))?;
            match event {
                SidecarEvent::ListModelsResult { providers } => {
                    return Ok(providers
                        .into_iter()
                        .map(|(provider, models)| (provider, models.into_iter().collect()))
                        .collect());
                }
                SidecarEvent::Error { message } => {
                    return Err(format!("pi sidecar list_models error: {message}"));
                }
                other => {
                    // Ignore anything unexpected on this handshake path and
                    // keep waiting for the real answer.
                    tracing::debug!(
                        event = sidecar_event_name(&other),
                        "ignored unexpected sidecar event while awaiting list_models"
                    );
                }
            }
        }
    };

    let result = timeout(MODEL_REGISTRY_QUERY_TIMEOUT, read_loop)
        .await
        .map_err(|_| "pi sidecar list_models query timed out".to_string())?;

    let _ = child.start_kill();
    let _ = child.wait().await;
    let stderr_lines = stderr_task.await.unwrap_or_default();
    result.map_err(|err| {
        if stderr_lines.is_empty() {
            err
        } else {
            format!("{err}; stderr={}", stderr_lines.join("\\n"))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn preloaded_cache_answers_true_false_and_unknown_provider() {
        let mut providers = HashMap::new();
        providers.insert(
            "anthropic".to_string(),
            HashSet::from(["claude-sonnet-4-6".to_string()]),
        );
        let cache = PiModelRegistryCache::preloaded_for_test(providers);

        assert_eq!(
            cache.executable("anthropic", "claude-sonnet-4-6").await,
            Some(true)
        );
        assert_eq!(
            cache.executable("anthropic", "claude-sonnet-5").await,
            Some(false)
        );
        // Provider key absent from the snapshot entirely is treated as
        // unknown (fail open), not as a negative answer — see doc comment on
        // `executable`.
        assert_eq!(cache.executable("unknown-provider", "x").await, None);
    }

    #[tokio::test]
    async fn fresh_cache_is_not_loaded_until_queried() {
        let cache = PiModelRegistryCache::new();
        assert!(matches!(
            *cache.state.read().unwrap(),
            RegistryState::NotLoaded
        ));
    }
}
