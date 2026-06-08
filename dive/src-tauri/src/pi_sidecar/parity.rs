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

/// Returns `Some(descriptor)` ONLY for providers with proven Pi parity.
/// `None` means "no Pi parity yet" -> caller must route to the legacy runtime.
/// Extend this allowlist one provider at a time as Task D parity smokes pass.
pub fn pi_provider_descriptor(kind: ProviderKind) -> Option<PiProviderDescriptor> {
    match kind {
        ProviderKind::Codex => Some(PiProviderDescriptor {
            pi_provider_id: "openai-codex",
            credential_mode: CredentialMode::OauthFile,
        }),
        // Added as each Task D real-key smoke passes (ids CONFIRMED via SDK probe 2026-06-08):
        //   ProviderKind::OpenAi      => "openai"     / ApiKey  (getModel ok)
        //   ProviderKind::Anthropic   => "anthropic"  / ApiKey  (getModel ok)
        //   ProviderKind::OpenRouter  => "openrouter" / ApiKey  (getModel ok - first-class, NO base-URL hack)
        //   ProviderKind::CustomOpenAi => register via ModelRegistry.registerProvider + base URL / ApiKey
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
    fn unmapped_provider_is_not_eligible() {
        // OpencodeZen has no proven Pi parity yet -> None (legacy fallback).
        assert!(pi_provider_descriptor(ProviderKind::OpencodeZen).is_none());
    }
}
