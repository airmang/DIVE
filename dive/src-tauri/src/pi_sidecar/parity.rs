use crate::ipc::provider_runtime::ProviderKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialMode {
    /// ChatGPT OAuth (codex): DIVE-owned auth.json seeded from keyring.
    OauthFile,
    /// API-key providers: key passed to the sidecar as a runtime override.
    ApiKey,
}

#[derive(Debug, Clone)]
pub struct PiProviderDescriptor {
    /// pi-ai provider id passed to `getModel(provider, model)`.
    pub pi_provider_id: &'static str,
    pub credential_mode: CredentialMode,
}

/// Returns `Some(descriptor)` for providers Pi can drive, `None` when v2 work
/// must surface an unavailable runtime capability state. The mapped
/// `pi_provider_id`s are CONFIRMED via SDK probe (2026-06-08): `getModel(id,
/// model)` resolves each without a base-URL override. Extend this allowlist one
/// provider at a time as new providers are verified.
pub fn pi_provider_descriptor(kind: ProviderKind) -> Option<PiProviderDescriptor> {
    match kind {
        ProviderKind::Codex => Some(PiProviderDescriptor {
            pi_provider_id: "openai-codex",
            credential_mode: CredentialMode::OauthFile,
        }),
        // First-class ApiKey providers: the API key stored for the provider config
        // is handed to the sidecar as a runtime override (see prepare_runtime_credential).
        ProviderKind::OpenAi => Some(PiProviderDescriptor {
            pi_provider_id: "openai",
            credential_mode: CredentialMode::ApiKey,
        }),
        ProviderKind::Anthropic => Some(PiProviderDescriptor {
            pi_provider_id: "anthropic",
            credential_mode: CredentialMode::ApiKey,
        }),
        ProviderKind::OpenRouter => Some(PiProviderDescriptor {
            pi_provider_id: "openrouter",
            credential_mode: CredentialMode::ApiKey,
        }),
        // Not wired yet:
        //   ProviderKind::CustomOpenAi => register via ModelRegistry.registerProvider + base URL / ApiKey
        //   ProviderKind::OpencodeZen  => pi-ai provider id unconfirmed (probe first)
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_maps_to_openai_codex_and_is_eligible() {
        let d = pi_provider_descriptor(ProviderKind::Codex).expect("codex eligible");
        assert_eq!(d.pi_provider_id, "openai-codex");
        assert!(matches!(d.credential_mode, CredentialMode::OauthFile));
    }

    #[test]
    fn first_class_api_key_providers_are_eligible() {
        for (kind, id) in [
            (ProviderKind::OpenAi, "openai"),
            (ProviderKind::Anthropic, "anthropic"),
            (ProviderKind::OpenRouter, "openrouter"),
        ] {
            let d = pi_provider_descriptor(kind).expect("first-class provider eligible");
            assert_eq!(d.pi_provider_id, id);
            assert!(matches!(d.credential_mode, CredentialMode::ApiKey));
        }
    }

    #[test]
    fn unmapped_provider_is_not_eligible() {
        // No confirmed Pi parity yet -> explicit unavailable capability state.
        assert!(pi_provider_descriptor(ProviderKind::OpencodeZen).is_none());
        assert!(pi_provider_descriptor(ProviderKind::CustomOpenAi).is_none());
    }
}
