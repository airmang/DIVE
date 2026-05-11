use std::sync::Arc;
use std::time::Duration;

use super::{AnthropicProvider, LlmProvider, ModelInfo, OpenAiProvider, ProviderError};

pub fn default_model_for_kind(kind: &str) -> &'static str {
    match kind {
        // Cost-aware v4 defaults: flagship models stay available in the selector,
        // but default to the general-purpose tier for first-run affordability.
        "anthropic" => "claude-sonnet-4-6",
        "openai" => "gpt-5.4",
        "openrouter" => "openai/gpt-5.4",
        "opencode-zen" | "opencode_zen" => "big-pickle",
        "custom-openai" | "custom_openai" => "gpt-5.4",
        "codex" => "gpt-5.5-codex",
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
    let selected = selected.map(str::trim).filter(|model| !model.is_empty());
    let models = models_for_kind(kind);
    if let Some(model) = selected {
        if models.is_empty() || models.iter().any(|candidate| candidate.id == model) {
            return model.to_owned();
        }
    }
    default_model_for_kind(kind).to_owned()
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

    let provider: Arc<dyn LlmProvider> = match kind {
        "anthropic" => {
            let provider = AnthropicProvider::new(key);
            Arc::new(match base_url {
                Some(url) => provider.with_base_url(url),
                None => provider,
            })
        }
        "openai" | "custom-openai" | "custom_openai" => {
            let provider = OpenAiProvider::new(key);
            Arc::new(match base_url {
                Some(url) => provider.with_base_url(url),
                None => provider,
            })
        }
        "openrouter" => {
            let provider = OpenAiProvider::openrouter(key);
            Arc::new(match base_url {
                Some(url) => provider.with_base_url(url),
                None => provider,
            })
        }
        "opencode-zen" | "opencode_zen" => {
            let provider = OpenAiProvider::opencode_zen(key);
            Arc::new(match base_url {
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

    let http = reqwest::Client::builder().timeout(timeout).build()?;
    let response = match kind {
        "anthropic" => {
            let base = base_url
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
                .unwrap_or("https://api.openai.com/v1")
                .trim_end_matches('/');
            http.get(format!("{base}/models"))
                .bearer_auth(key)
                .send()
                .await?
        }
        "openrouter" => {
            let base = base_url
                .unwrap_or("https://openrouter.ai/api/v1")
                .trim_end_matches('/');
            http.get(format!("{base}/models"))
                .bearer_auth(key)
                .send()
                .await?
        }
        "opencode-zen" | "opencode_zen" => {
            let base = base_url
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
        assert_eq!(default_model_for_kind("openrouter"), "openai/gpt-5.4");
        assert_eq!(default_model_for_kind("opencode_zen"), "big-pickle");
        assert_eq!(default_model_for_kind("opencode-zen"), "big-pickle");
        assert_eq!(default_model_for_kind("codex"), "gpt-5.5-codex");
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
    fn openrouter_models_use_openrouter_ids() {
        let ids = models_for_kind("openrouter")
            .into_iter()
            .map(|model| model.id)
            .collect::<Vec<_>>();
        assert!(ids.iter().all(|id| id.starts_with("openai/")));
        assert!(ids.iter().any(|id| id == "openai/gpt-5.3-codex"));
        assert!(!ids.iter().any(|id| id == "openai/gpt-5.5-codex"));
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
            normalize_model_for_kind("opencode_zen", Some("hy3-preview-free")),
            "hy3-preview-free"
        );
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
