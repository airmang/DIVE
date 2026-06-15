use std::path::PathBuf;
use std::sync::Arc;

use dive_lib::auth::{self, InMemoryKeyring};
use dive_lib::db::dao::provider_config;
use dive_lib::db::models::{
    NewProviderConfig, RuntimeCapabilityState, RuntimeCapabilityStatus, RuntimeSetupAction,
    RuntimeUnavailableReason,
};
use dive_lib::ipc::{
    chat_runtime_capability_state_for_test, runtime_capability_event_payload_for_test, AppState,
    ProviderKind, ProviderRuntime,
};
use dive_lib::{Database, MockProvider};
use serde_json::json;

const RECORDED_AT: i64 = 123_456;

fn mk_state(project_root: PathBuf) -> AppState {
    let mut db = Database::open_in_memory().unwrap();
    db.migrate().unwrap();
    let provider = Arc::new(MockProvider::new(Vec::new()));
    AppState::new(db, provider, project_root, "mock-model".into())
        .with_keyring(Arc::new(InMemoryKeyring::new()))
}

fn set_runtime(state: &AppState, kind: ProviderKind, model: &str, config_id: Option<i64>) {
    state
        .swap_runtime(ProviderRuntime::new(
            config_id,
            kind,
            model.to_owned(),
            Arc::new(MockProvider::new(Vec::new())),
        ))
        .unwrap();
}

fn insert_provider_config(state: &AppState, kind: &str, model: &str) -> i64 {
    let db = state.db.lock().unwrap();
    provider_config::insert(
        db.conn(),
        &NewProviderConfig {
            kind: kind.to_owned(),
            auth_type: "api_key".into(),
            base_url: None,
            config: json!({ "selected_model": model }),
        },
    )
    .unwrap()
}

fn assert_unavailable(
    capability: RuntimeCapabilityState,
    provider_kind: &str,
    reason: RuntimeUnavailableReason,
    setup_action: RuntimeSetupAction,
) {
    assert_eq!(capability.state, RuntimeCapabilityStatus::Unavailable);
    assert_eq!(capability.provider_kind, provider_kind);
    assert_eq!(capability.reason_code, Some(reason));
    assert_eq!(capability.setup_action, Some(setup_action));
    assert_eq!(capability.recorded_at, RECORDED_AT);
    assert!(!capability.message.trim().is_empty());

    let payload = runtime_capability_event_payload_for_test(&capability);
    assert_eq!(payload["status"], "unavailable");
    assert_eq!(payload["provider_kind"], provider_kind);
    assert_eq!(
        payload["reason_code"],
        serde_json::to_value(reason).unwrap()
    );
    assert_eq!(
        payload["setup_action"],
        serde_json::to_value(setup_action).unwrap()
    );
    assert_eq!(payload["created_at"], RECORDED_AT);
    assert!(payload["message"].as_str().unwrap_or_default().len() > 4);
}

#[tokio::test]
async fn unsupported_provider_is_blocked_instead_of_legacy_runtime() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(tmp.path().to_path_buf());
    set_runtime(&state, ProviderKind::OpencodeZen, "big-pickle", Some(77));

    let capability = chat_runtime_capability_state_for_test(&state, None, RECORDED_AT).await;

    assert_unavailable(
        capability,
        "opencode_zen",
        RuntimeUnavailableReason::ProviderNotPiCapable,
        RuntimeSetupAction::ChooseSupportedProvider,
    );
}

#[tokio::test]
async fn legacy_runtime_override_is_blocked_for_v2_work() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(tmp.path().to_path_buf());
    set_runtime(&state, ProviderKind::OpenAi, "gpt-5.4", Some(88));

    let capability =
        chat_runtime_capability_state_for_test(&state, Some("legacy"), RECORDED_AT).await;

    assert_unavailable(
        capability,
        "openai",
        RuntimeUnavailableReason::LegacyRequested,
        RuntimeSetupAction::RetryRuntime,
    );
}

#[tokio::test]
async fn provider_config_without_credentials_is_blocked_as_missing_credentials() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(tmp.path().to_path_buf());
    state.swap_runtime(ProviderRuntime::none()).unwrap();
    insert_provider_config(&state, "openai", "gpt-5.4");

    let capability = chat_runtime_capability_state_for_test(&state, None, RECORDED_AT).await;

    assert_unavailable(
        capability,
        "openai",
        RuntimeUnavailableReason::MissingCredentials,
        RuntimeSetupAction::AddCredentials,
    );
}

#[tokio::test]
async fn missing_project_root_is_blocked_before_runtime_start() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(tmp.path().to_path_buf());
    let config_id = insert_provider_config(&state, "openai", "gpt-5.4");
    auth::upsert_provider_api_key(state.keyring.as_ref(), config_id, "sk-test").unwrap();
    set_runtime(&state, ProviderKind::OpenAi, "gpt-5.4", Some(config_id));
    state.swap_project_root(PathBuf::new()).unwrap();

    let capability = chat_runtime_capability_state_for_test(&state, None, RECORDED_AT).await;

    assert_unavailable(
        capability,
        "openai",
        RuntimeUnavailableReason::MissingProjectRoot,
        RuntimeSetupAction::OpenProject,
    );
}
