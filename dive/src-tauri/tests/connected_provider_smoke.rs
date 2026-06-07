use std::{env, path::PathBuf, sync::Arc, time::Duration};

use dive_lib::auth;
use dive_lib::db::dao::provider_config;
use dive_lib::ipc::{self, ProviderKind, ProviderRuntime};
use dive_lib::providers;
use dive_lib::{ChatEvent, ChatRequest, Database, Message, MockProvider};
use futures::StreamExt;
use sha2::{Digest, Sha256};

#[tokio::test]
#[ignore = "manual smoke: requires a real copied DIVE DB and OS keyring provider secret"]
async fn connected_provider_smoke_uses_real_keyring_without_printing_secrets() {
    let db_path = env_path("DIVE_CONNECTED_PROVIDER_SMOKE_DB");
    assert!(
        db_path.exists(),
        "DIVE_CONNECTED_PROVIDER_SMOKE_DB must point to an existing copied dive.db"
    );

    let mut db = Database::open(&db_path).expect("open smoke db");
    db.migrate().expect("migrate smoke db copy");
    let project_root = tempfile::tempdir().expect("temp project root");
    let state = dive_lib::AppState::new(
        db,
        Arc::new(MockProvider::new(Vec::new())),
        project_root.path().to_path_buf(),
        "mock".into(),
    );
    let state = if env::var("DIVE_SECRET_BACKEND").ok().as_deref() == Some("local-file") {
        let secret_path = env::var_os("DIVE_LOCAL_SECRET_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| project_root.path().join("qa-secrets.json"));
        state.with_keyring(Arc::new(auth::LocalFileKeyring::new(secret_path)))
    } else {
        state
    };
    state
        .swap_runtime(ProviderRuntime::none())
        .expect("clear runtime");

    let summaries = ipc::provider::provider_list_impl(&state).expect("provider list");
    let connected_count = summaries
        .iter()
        .filter(|summary| summary.is_connected)
        .count();
    println!("SMOKE provider_list_connected_count={connected_count}");
    for summary in &summaries {
        println!(
            "SMOKE provider_row id={} kind={} auth_type={} connected={} model={} account_id_present={}",
            summary.id,
            summary.kind,
            summary.auth_type,
            summary.is_connected,
            summary.selected_model.as_deref().unwrap_or("unset"),
            summary.account_id.as_deref().is_some_and(|value| !value.is_empty())
        );
    }
    assert!(
        connected_count > 0,
        "provider_list must report at least one connected provider"
    );

    let runtime = select_runtime(&state, &summaries)
        .await
        .expect("select connected provider runtime");
    let config_id = runtime
        .config_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| "none".into());
    println!(
        "SMOKE runtime provider_config_id={} kind={} model={}",
        config_id,
        runtime.kind.as_str(),
        runtime.model
    );

    let request = ChatRequest {
        model: runtime.model.clone(),
        messages: vec![Message::User {
            content: "Return exactly DIVE_SMOKE_OK and no other text.".into(),
        }],
        tools: None,
        tool_choice: None,
        temperature: Some(0.0),
        max_tokens: Some(256),
        stream: true,
    };

    let mut stream = tokio::time::timeout(Duration::from_secs(90), runtime.provider.chat(request))
        .await
        .expect("provider chat should not time out before stream open")
        .expect("provider chat stream should open");

    let mut text = String::new();
    let mut reasoning = String::new();
    let mut event_count = 0_u32;
    let mut tool_event_count = 0_u32;
    let mut prompt_tokens = None;
    let mut completion_tokens = None;
    let mut finish_reason = None;
    tokio::time::timeout(Duration::from_secs(120), async {
        while let Some(event) = stream.next().await {
            event_count += 1;
            match event {
                ChatEvent::ReasoningDelta(delta) => reasoning.push_str(&delta),
                ChatEvent::TextDelta(delta) => text.push_str(&delta),
                ChatEvent::Usage {
                    prompt_tokens: prompt,
                    completion_tokens: completion,
                } => {
                    prompt_tokens = Some(prompt);
                    completion_tokens = Some(completion);
                }
                ChatEvent::Done {
                    finish_reason: done,
                } => {
                    finish_reason = Some(done);
                    break;
                }
                ChatEvent::Error(error) => panic!("provider stream error: {error}"),
                ChatEvent::ToolCallStart { .. }
                | ChatEvent::ToolCallDelta { .. }
                | ChatEvent::ToolCallEnd { .. } => {
                    tool_event_count += 1;
                }
            }
        }
    })
    .await
    .expect("provider stream should complete");

    let output = if text.trim().is_empty() {
        reasoning.as_str()
    } else {
        text.as_str()
    };
    let hash = Sha256::digest(output.as_bytes());
    println!(
        "SMOKE event_count={} assistant_text_len={} reasoning_len={} tool_event_count={} output_sha256={:x} finish_reason={:?} prompt_tokens={:?} completion_tokens={:?}",
        event_count,
        text.len(),
        reasoning.len(),
        tool_event_count,
        hash,
        finish_reason,
        prompt_tokens,
        completion_tokens
    );
    assert!(
        !output.trim().is_empty(),
        "provider smoke should receive non-empty assistant output"
    );
}

async fn select_runtime(
    state: &dive_lib::AppState,
    summaries: &[ipc::provider::ProviderConfigSummary],
) -> Result<ProviderRuntime, String> {
    let rows = {
        let db = state.db.lock().map_err(|err| err.to_string())?;
        provider_config::list(db.conn()).map_err(|err| err.to_string())?
    };

    let requested_id = env::var("DIVE_CONNECTED_PROVIDER_SMOKE_PROVIDER_ID")
        .ok()
        .and_then(|raw| raw.parse::<i64>().ok());
    let selected = requested_id
        .and_then(|id| {
            rows.iter()
                .find(|row| row.id == id && row.kind != "codex")
                .cloned()
        })
        .or_else(|| {
            rows.iter()
                .filter(|row| row.kind != "codex")
                .find(|row| {
                    summaries
                        .iter()
                        .any(|summary| summary.id == row.id && summary.is_connected)
                })
                .cloned()
        });

    if let Some(row) = selected {
        let Some(api_key) = auth::load_provider_api_key(state.keyring.as_ref(), row.id)
            .map_err(|err| err.to_string())?
        else {
            return Err(format!("provider {} has no keyring secret", row.id));
        };
        let model = providers::normalize_model_for_kind(
            &row.kind,
            row.config
                .get("selected_model")
                .or_else(|| row.config.get("model"))
                .and_then(|value| value.as_str()),
        );
        providers::validate_model_for_kind(&row.kind, &model).map_err(|err| err.to_string())?;
        let provider = providers::build_provider(&row.kind, &api_key, row.base_url.as_deref())
            .map_err(|err| err.to_string())?;
        let runtime = ProviderRuntime::new(
            Some(row.id),
            ProviderKind::parse(&row.kind),
            model,
            provider,
        );
        state.swap_runtime(runtime.clone())?;
        return Ok(runtime);
    }

    state.ensure_provider_runtime().await
}

fn env_path(name: &str) -> PathBuf {
    env::var_os(name)
        .map(PathBuf::from)
        .unwrap_or_else(|| panic!("{name} is required for connected-provider smoke"))
}
