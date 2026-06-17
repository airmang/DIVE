use std::sync::Arc;
use std::time::Duration;

use super::{AnthropicProvider, LlmProvider, ModelInfo, OpenAiProvider, ProviderError};

pub fn default_model_for_kind(kind: &str) -> &'static str {
    match kind {
        // Cost-aware v4 defaults: flagship models stay available in the selector,
        // but default to the general-purpose tier for first-run affordability.
        "anthropic" => "claude-sonnet-4-6",
        "openai" => "gpt-5.4",
        "openrouter" => "openai/gpt-5.4-mini",
        "opencode-zen" | "opencode_zen" => "big-pickle",
        "custom-openai" | "custom_openai" => "gpt-5.4",
        "codex" => "gpt-5.5",
        _ => "unset",
    }
}

pub fn models_for_kind(kind: &str) -> Vec<ModelInfo> {
    match kind {
        "anthropic" => AnthropicProvider::new(String::new()).list_models(),
        "openai" | "custom-openai" | "custom_openai" => {
            OpenAiProvider::new(String::new()).list_models()
        }
        "openrouter" => OpenAiProvider::openrouter(String::new()).list_models(),
        "opencode-zen" | "opencode_zen" => {
            OpenAiProvider::opencode_zen(String::new()).list_models()
        }
        "codex" => crate::providers::codex::default_codex_models(),
        _ => Vec::new(),
    }
}

pub fn normalize_model_for_kind(kind: &str, selected: Option<&str>) -> String {
    let selected = selected
        .map(|model| canonical_model_for_kind(kind, model))
        .filter(|model| !model.is_empty());
    let models = models_for_kind(kind);
    if let Some(model) = selected.as_deref() {
        if models.is_empty() || models.iter().any(|candidate| candidate.id == model) {
            return model.to_owned();
        }
    }
    default_model_for_kind(kind).to_owned()
}

pub fn canonical_model_for_kind(kind: &str, model: &str) -> String {
    let trimmed = model.trim();
    match (kind, trimmed) {
        ("codex", "gpt-5.5-codex") => "gpt-5.5".to_owned(),
        ("openai" | "custom-openai" | "custom_openai", "gpt-5.5-codex") => "gpt-5.5".to_owned(),
        ("openrouter", "openai/gpt-5.5-codex") => "openai/gpt-5.5".to_owned(),
        _ => trimmed.to_owned(),
    }
}

pub fn validate_model_for_kind(kind: &str, model: &str) -> Result<(), ProviderError> {
    let canonical = canonical_model_for_kind(kind, model);
    let trimmed = canonical.as_str();
    if trimmed.is_empty() || trimmed == "unset" {
        return Err(ProviderError::InvalidConfig(
            "AI 모델이 설정되지 않았습니다. Settings에서 연결된 AI의 모델을 선택한 뒤 다시 시도하세요."
                .into(),
        ));
    }

    let models = models_for_kind(kind);
    if models.is_empty() || models.iter().any(|candidate| candidate.id == trimmed) {
        return Ok(());
    }

    Err(ProviderError::InvalidConfig(format!(
        "지원하지 않는 AI 모델입니다: {trimmed}. Settings에서 연결된 AI의 사용 가능한 모델로 전환한 뒤 다시 시도하세요."
    )))
}

pub fn build_provider(
    kind: &str,
    api_key: &str,
    base_url: Option<&str>,
) -> Result<Arc<dyn LlmProvider>, ProviderError> {
    let key = api_key.trim().to_owned();
    if key.is_empty() {
        return Err(ProviderError::Auth("api key is empty".into()));
    }
    let base_url = validate_provider_base_url(kind, base_url)?;

    let provider: Arc<dyn LlmProvider> = match kind {
        "anthropic" => {
            let provider = AnthropicProvider::new(key);
            Arc::new(match base_url.as_deref() {
                Some(url) => provider.with_base_url(url),
                None => provider,
            })
        }
        "openai" | "custom-openai" | "custom_openai" => {
            let provider = OpenAiProvider::new(key);
            Arc::new(match base_url.as_deref() {
                Some(url) => provider.with_base_url(url),
                None => provider,
            })
        }
        "openrouter" => {
            let provider = OpenAiProvider::openrouter(key);
            Arc::new(match base_url.as_deref() {
                Some(url) => provider.with_base_url(url),
                None => provider,
            })
        }
        "opencode-zen" | "opencode_zen" => {
            let provider = OpenAiProvider::opencode_zen(key);
            Arc::new(match base_url.as_deref() {
                Some(url) => provider.with_base_url(url),
                None => provider,
            })
        }
        other => {
            return Err(ProviderError::Unsupported(format!(
                "provider kind: {other}"
            )))
        }
    };

    Ok(provider)
}

pub fn validate_provider_base_url(
    _kind: &str,
    base_url: Option<&str>,
) -> Result<Option<String>, ProviderError> {
    let Some(raw) = base_url.map(str::trim).filter(|url| !url.is_empty()) else {
        return Ok(None);
    };
    let parsed = reqwest::Url::parse(raw)
        .map_err(|_| ProviderError::InvalidConfig("base_url must be a valid URL".into()))?;
    match parsed.scheme() {
        "https" => Ok(Some(parsed.as_str().trim_end_matches('/').to_string())),
        "http" if is_local_provider_host(&parsed) => {
            Ok(Some(parsed.as_str().trim_end_matches('/').to_string()))
        }
        "http" => Err(ProviderError::InvalidConfig(
            "base_url must use https unless it targets localhost for local development".into(),
        )),
        _ => Err(ProviderError::InvalidConfig(
            "base_url must use https".into(),
        )),
    }
}

fn is_local_provider_host(url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    host == "localhost" || host == "::1" || host.starts_with("127.")
}

pub async fn health_check(
    kind: &str,
    api_key: &str,
    base_url: Option<&str>,
) -> Result<(), ProviderError> {
    health_check_with_timeout(kind, api_key, base_url, Duration::from_secs(8)).await
}

async fn health_check_with_timeout(
    kind: &str,
    api_key: &str,
    base_url: Option<&str>,
    timeout: Duration,
) -> Result<(), ProviderError> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err(ProviderError::Auth("api key is empty".into()));
    }
    let base_url = validate_provider_base_url(kind, base_url)?;

    let http = reqwest::Client::builder().timeout(timeout).build()?;
    let response = match kind {
        "anthropic" => {
            let base = base_url
                .as_deref()
                .unwrap_or("https://api.anthropic.com")
                .trim_end_matches('/');
            http.get(format!("{base}/v1/models"))
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01")
                .send()
                .await?
        }
        "openai" | "custom-openai" | "custom_openai" => {
            let base = base_url
                .as_deref()
                .unwrap_or("https://api.openai.com/v1")
                .trim_end_matches('/');
            http.get(format!("{base}/models"))
                .bearer_auth(key)
                .send()
                .await?
        }
        "openrouter" => {
            let base = base_url
                .as_deref()
                .unwrap_or("https://openrouter.ai/api/v1")
                .trim_end_matches('/');
            http.get(format!("{base}/models"))
                .bearer_auth(key)
                .send()
                .await?
        }
        "opencode-zen" | "opencode_zen" => {
            let base = base_url
                .as_deref()
                .unwrap_or("https://opencode.ai/zen/v1")
                .trim_end_matches('/');
            http.get(format!("{base}/models"))
                .bearer_auth(key)
                .send()
                .await?
        }
        other => {
            return Err(ProviderError::Unsupported(format!(
                "provider kind: {other}"
            )))
        }
    };

    let status = response.status();
    if !status.is_success() {
        return Err(ProviderError::Api {
            status: status.as_u16(),
            body: response.text().await.unwrap_or_default(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_models_cover_supported_kinds() {
        assert_eq!(default_model_for_kind("anthropic"), "claude-sonnet-4-6");
        assert_eq!(default_model_for_kind("openai"), "gpt-5.4");
        assert_eq!(default_model_for_kind("openrouter"), "openai/gpt-5.4-mini");
        assert_eq!(default_model_for_kind("opencode_zen"), "big-pickle");
        assert_eq!(default_model_for_kind("opencode-zen"), "big-pickle");
        assert_eq!(default_model_for_kind("codex"), "gpt-5.5");
        assert_eq!(default_model_for_kind("unknown"), "unset");
    }

    #[test]
    fn static_models_cover_defaults() {
        for kind in ["anthropic", "openai", "openrouter", "opencode_zen", "codex"] {
            let default_model = default_model_for_kind(kind);
            assert!(
                models_for_kind(kind)
                    .into_iter()
                    .any(|model| model.id == default_model),
                "{kind} list should contain {default_model}"
            );
        }
    }

    #[test]
    fn openrouter_models_use_provider_qualified_ids() {
        let ids = models_for_kind("openrouter")
            .into_iter()
            .map(|model| model.id)
            .collect::<Vec<_>>();
        assert_eq!(
            ids,
            vec![
                "openai/gpt-5.4-mini",
                "openai/gpt-5.4",
                "anthropic/claude-sonnet-4.6",
                "google/gemini-3-flash-preview",
                "deepseek/deepseek-v4-flash",
            ]
        );
        assert!(ids.iter().all(|id| id.contains('/')));
        assert!(ids.iter().any(|id| id == "anthropic/claude-sonnet-4.6"));
        assert!(!ids.iter().any(|id| id == "openai/gpt-5.5-codex"));
    }

    #[test]
    fn retired_gpt_55_codex_alias_normalizes_to_supported_catalog_id() {
        assert_eq!(
            normalize_model_for_kind("codex", Some("gpt-5.5-codex")),
            "gpt-5.5"
        );
        assert_eq!(
            normalize_model_for_kind("openai", Some("gpt-5.5-codex")),
            "gpt-5.5"
        );
        assert_eq!(
            normalize_model_for_kind("openrouter", Some("openai/gpt-5.5-codex")),
            "openai/gpt-5.4-mini"
        );
    }

    #[test]
    fn build_provider_rejects_empty_key() {
        let result = build_provider("openai", "  ", None);
        assert!(matches!(result, Err(ProviderError::Auth(_))));
    }

    #[test]
    fn build_provider_rejects_unknown_kind() {
        let result = build_provider("unknown", "sk-test", None);
        assert!(matches!(result, Err(ProviderError::Unsupported(_))));
    }

    #[test]
    fn base_url_validation_rejects_non_local_http() {
        let err = validate_provider_base_url("openai", Some("http://evil.example/v1")).unwrap_err();
        assert!(matches!(err, ProviderError::InvalidConfig(_)));
        assert!(err.to_string().contains("https"));
    }

    #[test]
    fn base_url_validation_allows_https_and_localhost_http() {
        assert_eq!(
            validate_provider_base_url("openai", Some("https://proxy.example/v1")).unwrap(),
            Some("https://proxy.example/v1".into())
        );
        assert_eq!(
            validate_provider_base_url("openai", Some("http://127.0.0.1:11434/v1")).unwrap(),
            Some("http://127.0.0.1:11434/v1".into())
        );
        assert_eq!(validate_provider_base_url("openai", None).unwrap(), None);
    }

    #[test]
    fn build_provider_rejects_unsafe_base_url_before_key_use() {
        let result = build_provider("openai", "sk-test", Some("http://evil.example/v1"));
        assert!(matches!(result, Err(ProviderError::InvalidConfig(_))));
    }

    #[test]
    fn build_provider_supports_opencode_zen_aliases() {
        let provider = build_provider("opencode_zen", "sk-test", None).unwrap();
        assert_eq!(provider.id(), "opencode_zen");
        assert_eq!(provider.list_models()[0].id, "big-pickle");

        let legacy = build_provider("opencode-zen", "sk-test", None).unwrap();
        assert_eq!(legacy.id(), "opencode_zen");
    }

    #[test]
    fn normalize_model_for_kind_replaces_retired_opencode_model() {
        assert_eq!(
            normalize_model_for_kind("opencode_zen", Some("gpt-5-nano")),
            "big-pickle"
        );
        assert_eq!(
            normalize_model_for_kind("opencode_zen", Some("ling-2.6-flash")),
            "big-pickle"
        );
        assert_eq!(
            normalize_model_for_kind("opencode_zen", Some("hy3-preview-free")),
            "hy3-preview-free"
        );
    }

    #[test]
    fn validate_model_for_kind_rejects_unsupported_opencode_model_with_cta() {
        let err = validate_model_for_kind("opencode_zen", "ling-2.6-flash").unwrap_err();
        assert!(matches!(err, ProviderError::InvalidConfig(_)));
        assert!(err.to_string().contains("Settings"));
        assert!(err.to_string().contains("ling-2.6-flash"));
    }

    #[tokio::test]
    async fn opencode_zen_health_check_uses_models_endpoint() {
        use wiremock::matchers::{bearer_token, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .and(bearer_token("sk-test"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": []
            })))
            .mount(&server)
            .await;

        health_check("opencode_zen", "sk-test", Some(&server.uri()))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn opencode_zen_health_check_rejects_auth_failure() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .respond_with(ResponseTemplate::new(401).set_body_string("bad key"))
            .mount(&server)
            .await;

        let err = health_check("opencode-zen", "sk-test", Some(&server.uri()))
            .await
            .unwrap_err();
        assert!(matches!(err, ProviderError::Api { status: 401, .. }));
    }

    #[tokio::test]
    async fn opencode_zen_health_check_times_out() {
        use std::time::Duration;
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_millis(50)))
            .mount(&server)
            .await;

        let err = health_check_with_timeout(
            "opencode_zen",
            "sk-test",
            Some(&server.uri()),
            Duration::from_millis(1),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, ProviderError::Timeout(_)));
        assert!(err.to_string().contains("timed out"));
    }
}
