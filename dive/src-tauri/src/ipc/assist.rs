use tauri::State;

use super::AppState;

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
    locale: Option<String>,
) -> Result<crate::dive::PromptCheckResult, String> {
    let snap = state.ensure_provider_runtime().await?;
    if snap.kind.is_none() {
        return Err(crate::providers::ProviderError::NotConfigured.to_string());
    }
    let engine = crate::dive::PromptCheckEngine::new(snap.provider, snap.model);
    engine
        .review(&text, locale.as_deref())
        .await
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
