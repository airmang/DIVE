#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum SecretScope {
    ProviderApiKey { provider_config_id: i64 },
    CodexAccessToken { provider_config_id: i64 },
    CodexRefreshToken { provider_config_id: i64 },
    CodexIdToken { provider_config_id: i64 },
    OpenRouterChildKey { label: String },
}

impl SecretScope {
    pub fn service(&self) -> &'static str {
        "DIVE"
    }

    pub fn account(&self) -> String {
        match self {
            Self::ProviderApiKey { provider_config_id } => {
                format!("provider-api-key:{provider_config_id}")
            }
            Self::CodexAccessToken { provider_config_id } => {
                format!("codex-access-token:{provider_config_id}")
            }
            Self::CodexRefreshToken { provider_config_id } => {
                format!("codex-refresh-token:{provider_config_id}")
            }
            Self::CodexIdToken { provider_config_id } => {
                format!("codex-id-token:{provider_config_id}")
            }
            Self::OpenRouterChildKey { label } => format!("openrouter-child-key:{label}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn account_format_matches_contract() {
        assert_eq!(
            SecretScope::ProviderApiKey {
                provider_config_id: 11,
            }
            .account(),
            "provider-api-key:11"
        );
        assert_eq!(
            SecretScope::CodexAccessToken {
                provider_config_id: 11,
            }
            .account(),
            "codex-access-token:11"
        );
        assert_eq!(
            SecretScope::CodexRefreshToken {
                provider_config_id: 11,
            }
            .account(),
            "codex-refresh-token:11"
        );
        assert_eq!(
            SecretScope::CodexIdToken {
                provider_config_id: 11,
            }
            .account(),
            "codex-id-token:11"
        );
        assert_eq!(
            SecretScope::OpenRouterChildKey {
                label: "teacher-main".into(),
            }
            .account(),
            "openrouter-child-key:teacher-main"
        );
    }

    #[test]
    fn service_name_is_fixed() {
        assert_eq!(
            SecretScope::ProviderApiKey {
                provider_config_id: 1,
            }
            .service(),
            "DIVE"
        );
    }

    #[test]
    fn accounts_are_unique_across_variants_and_values() {
        let scopes = vec![
            SecretScope::ProviderApiKey {
                provider_config_id: 1,
            },
            SecretScope::ProviderApiKey {
                provider_config_id: 2,
            },
            SecretScope::CodexAccessToken {
                provider_config_id: 1,
            },
            SecretScope::CodexAccessToken {
                provider_config_id: 2,
            },
            SecretScope::CodexRefreshToken {
                provider_config_id: 1,
            },
            SecretScope::CodexRefreshToken {
                provider_config_id: 2,
            },
            SecretScope::CodexIdToken {
                provider_config_id: 1,
            },
            SecretScope::CodexIdToken {
                provider_config_id: 2,
            },
            SecretScope::OpenRouterChildKey {
                label: "class-a".into(),
            },
            SecretScope::OpenRouterChildKey {
                label: "class-b".into(),
            },
        ];

        let mut accounts = HashSet::new();
        for scope in &scopes {
            assert!(accounts.insert(scope.account()));
        }
        assert_eq!(accounts.len(), scopes.len());
    }
}
