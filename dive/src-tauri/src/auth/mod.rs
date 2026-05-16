//! 키링 래퍼 및 인증.
//!
//! 명세 §7.7, §9.5, §10.4. `keyring` crate를 추상화하여 API 키·OAuth 토큰을
//! OS 자격 증명 저장소(Windows Credential Manager 등)에 안전하게 보관한다.
//! ProviderConfig DAO는 비민감 설정만 저장하며, 민감 값은 이 모듈의
//! [`Keyring`] 구현을 통해 저장한다.
//!
//! ProviderConfig 삭제 계약: `provider_config::delete()`를 호출하기 전에
//! `auth::delete_provider_api_key()`를 먼저 호출해 OS keyring 항목을 제거한다.
//! [`LocalFileKeyring`]은 반복 수동 QA 전용이며 `DIVE_SECRET_BACKEND=local-file`
//! 실행에서만 사용한다. 프로덕션 기본값은 항상 [`OsKeyring`]이다.
//! [`InMemoryKeyring`]은 테스트·CI 전용이며 프로덕션 경로에서 사용하지 않는다.

pub mod codex_oauth;
mod error;
pub mod openrouter_provisioning;
mod scope;

use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::Mutex;

pub use codex_oauth::{CodexOAuth, CodexTokens, OAuthError, PkcePair};
pub use error::AuthError;
pub use openrouter_provisioning::{
    ChildKey, ChildKeySummary, OpenRouterProvisioning, ProvisioningError,
};
pub use scope::SecretScope;

pub fn store_codex_tokens(
    keyring: &dyn Keyring,
    provider_config_id: i64,
    tokens: &CodexTokens,
) -> Result<(), AuthError> {
    keyring.store(
        &SecretScope::CodexAccessToken { provider_config_id },
        &tokens.access_token,
    )?;
    keyring.store(
        &SecretScope::CodexRefreshToken { provider_config_id },
        &tokens.refresh_token,
    )?;
    keyring.store(
        &SecretScope::CodexIdToken { provider_config_id },
        &tokens.id_token,
    )?;
    Ok(())
}

pub fn load_codex_tokens(
    keyring: &dyn Keyring,
    provider_config_id: i64,
) -> Result<Option<(String, String, String)>, AuthError> {
    let Some(access) = keyring.load(&SecretScope::CodexAccessToken { provider_config_id })? else {
        return Ok(None);
    };
    let Some(refresh) = keyring.load(&SecretScope::CodexRefreshToken { provider_config_id })?
    else {
        return Ok(None);
    };
    let id = keyring
        .load(&SecretScope::CodexIdToken { provider_config_id })?
        .unwrap_or_default();
    Ok(Some((access, refresh, id)))
}

pub fn delete_codex_tokens(
    keyring: &dyn Keyring,
    provider_config_id: i64,
) -> Result<(), AuthError> {
    keyring.delete(&SecretScope::CodexAccessToken { provider_config_id })?;
    keyring.delete(&SecretScope::CodexRefreshToken { provider_config_id })?;
    keyring.delete(&SecretScope::CodexIdToken { provider_config_id })?;
    Ok(())
}

/// 민감 정보를 저장·조회·삭제하는 동기 keyring 추상화.
pub trait Keyring: Send + Sync {
    fn store(&self, scope: &SecretScope, secret: &str) -> Result<(), AuthError>;
    fn load(&self, scope: &SecretScope) -> Result<Option<String>, AuthError>;
    fn delete(&self, scope: &SecretScope) -> Result<(), AuthError>;

    fn has(&self, scope: &SecretScope) -> Result<bool, AuthError> {
        Ok(self.load(scope)?.is_some())
    }
}

/// OS 표준 자격 증명 저장소를 사용하는 keyring 구현.
#[derive(Debug, Default, Clone, Copy)]
pub struct OsKeyring;

impl OsKeyring {
    pub fn new() -> Self {
        Self
    }

    fn entry(scope: &SecretScope) -> Result<keyring::Entry, AuthError> {
        let account = scope.account();
        Ok(keyring::Entry::new(scope.service(), &account)?)
    }
}

impl Keyring for OsKeyring {
    fn store(&self, scope: &SecretScope, secret: &str) -> Result<(), AuthError> {
        Self::entry(scope)?.set_password(secret)?;
        Ok(())
    }

    fn load(&self, scope: &SecretScope) -> Result<Option<String>, AuthError> {
        match Self::entry(scope)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(AuthError::Keyring(err)),
        }
    }

    fn delete(&self, scope: &SecretScope) -> Result<(), AuthError> {
        match Self::entry(scope)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(AuthError::Keyring(err)),
        }
    }
}

/// 반복 수동 QA 전용 로컬 파일 secret store.
///
/// 이 구현은 OS keyring 인증 프롬프트를 우회하기 위해 app-local 파일에 secret을
/// 평문 저장한다. 릴리스 기본 경로에서는 사용하지 말고, QA 실행에서만
/// `DIVE_SECRET_BACKEND=local-file`로 명시적으로 활성화한다.
pub struct LocalFileKeyring {
    path: PathBuf,
    lock: Mutex<()>,
}

impl LocalFileKeyring {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            lock: Mutex::new(()),
        }
    }

    fn key(scope: &SecretScope) -> String {
        format!("{}\n{}", scope.service(), scope.account())
    }

    fn read_all(&self) -> Result<HashMap<String, String>, AuthError> {
        if !self.path.exists() {
            return Ok(HashMap::new());
        }
        let raw = std::fs::read_to_string(&self.path)
            .map_err(|err| AuthError::BackendUnavailable(err.to_string()))?;
        if raw.trim().is_empty() {
            return Ok(HashMap::new());
        }
        serde_json::from_str(&raw).map_err(|err| AuthError::BackendUnavailable(err.to_string()))
    }

    fn write_all(&self, entries: &HashMap<String, String>) -> Result<(), AuthError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| AuthError::BackendUnavailable(err.to_string()))?;
        }
        let raw = serde_json::to_vec_pretty(entries)
            .map_err(|err| AuthError::BackendUnavailable(err.to_string()))?;
        std::fs::write(&self.path, raw)
            .map_err(|err| AuthError::BackendUnavailable(err.to_string()))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let permissions = std::fs::Permissions::from_mode(0o600);
            std::fs::set_permissions(&self.path, permissions)
                .map_err(|err| AuthError::BackendUnavailable(err.to_string()))?;
        }

        Ok(())
    }
}

impl fmt::Debug for LocalFileKeyring {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LocalFileKeyring")
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
}

impl Keyring for LocalFileKeyring {
    fn store(&self, scope: &SecretScope, secret: &str) -> Result<(), AuthError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|err| AuthError::BackendUnavailable(err.to_string()))?;
        let mut entries = self.read_all()?;
        entries.insert(Self::key(scope), secret.to_owned());
        self.write_all(&entries)
    }

    fn load(&self, scope: &SecretScope) -> Result<Option<String>, AuthError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|err| AuthError::BackendUnavailable(err.to_string()))?;
        if let Some(secret) = self.read_all()?.get(&Self::key(scope)).cloned() {
            return Ok(Some(secret));
        }
        Ok(qa_env_secret(scope))
    }

    fn delete(&self, scope: &SecretScope) -> Result<(), AuthError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|err| AuthError::BackendUnavailable(err.to_string()))?;
        let mut entries = self.read_all()?;
        entries.remove(&Self::key(scope));
        self.write_all(&entries)
    }
}

fn qa_env_secret(scope: &SecretScope) -> Option<String> {
    match scope {
        SecretScope::ProviderApiKey { provider_config_id } => {
            let scoped = format!("DIVE_PROVIDER_API_KEY_{provider_config_id}");
            std::env::var(scoped)
                .ok()
                .or_else(|| std::env::var("DIVE_QA_PROVIDER_API_KEY").ok())
                .map(|secret| secret.trim().to_owned())
                .filter(|secret| !secret.is_empty())
        }
        _ => None,
    }
}

/// 테스트·CI 전용 인메모리 keyring. 프로덕션 경로에서 사용 금지.
pub struct InMemoryKeyring {
    inner: Mutex<HashMap<(String, String), String>>,
}

impl InMemoryKeyring {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    fn key(scope: &SecretScope) -> (String, String) {
        (scope.service().to_owned(), scope.account())
    }
}

impl Default for InMemoryKeyring {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for InMemoryKeyring {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let entries = self.inner.lock().map(|inner| inner.len()).unwrap_or(0);
        f.debug_struct("InMemoryKeyring")
            .field("entries", &entries)
            .finish()
    }
}

impl Keyring for InMemoryKeyring {
    fn store(&self, scope: &SecretScope, secret: &str) -> Result<(), AuthError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|err| AuthError::BackendUnavailable(err.to_string()))?;
        inner.insert(Self::key(scope), secret.to_owned());
        Ok(())
    }

    fn load(&self, scope: &SecretScope) -> Result<Option<String>, AuthError> {
        let inner = self
            .inner
            .lock()
            .map_err(|err| AuthError::BackendUnavailable(err.to_string()))?;
        Ok(inner.get(&Self::key(scope)).cloned())
    }

    fn delete(&self, scope: &SecretScope) -> Result<(), AuthError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|err| AuthError::BackendUnavailable(err.to_string()))?;
        inner.remove(&Self::key(scope));
        Ok(())
    }
}

pub fn upsert_provider_api_key(
    keyring: &dyn Keyring,
    provider_config_id: i64,
    api_key: &str,
) -> Result<(), AuthError> {
    keyring.store(&SecretScope::ProviderApiKey { provider_config_id }, api_key)
}

pub fn load_provider_api_key(
    keyring: &dyn Keyring,
    provider_config_id: i64,
) -> Result<Option<String>, AuthError> {
    keyring.load(&SecretScope::ProviderApiKey { provider_config_id })
}

pub fn delete_provider_api_key(
    keyring: &dyn Keyring,
    provider_config_id: i64,
) -> Result<(), AuthError> {
    keyring.delete(&SecretScope::ProviderApiKey { provider_config_id })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_scopes() -> Vec<SecretScope> {
        vec![
            SecretScope::ProviderApiKey {
                provider_config_id: 1,
            },
            SecretScope::CodexAccessToken {
                provider_config_id: 1,
            },
            SecretScope::CodexRefreshToken {
                provider_config_id: 1,
            },
            SecretScope::CodexIdToken {
                provider_config_id: 1,
            },
            SecretScope::OpenRouterChildKey {
                label: "class-1".into(),
            },
        ]
    }

    #[test]
    fn in_memory_roundtrip_for_each_secret_scope_variant() {
        let keyring = InMemoryKeyring::new();

        for (index, scope) in sample_scopes().iter().enumerate() {
            assert_eq!(keyring.load(scope).unwrap(), None);
            assert!(!keyring.has(scope).unwrap());

            let secret = format!("secret-{index}");
            keyring.store(scope, &secret).unwrap();
            assert_eq!(keyring.load(scope).unwrap(), Some(secret));
            assert!(keyring.has(scope).unwrap());

            keyring.delete(scope).unwrap();
            assert_eq!(keyring.load(scope).unwrap(), None);
            assert!(!keyring.has(scope).unwrap());
        }
    }

    #[test]
    fn in_memory_delete_is_idempotent() {
        let keyring = InMemoryKeyring::new();
        let scope = SecretScope::ProviderApiKey {
            provider_config_id: 404,
        };

        keyring.delete(&scope).unwrap();
        keyring.store(&scope, "secret").unwrap();
        keyring.delete(&scope).unwrap();
        keyring.delete(&scope).unwrap();

        assert_eq!(keyring.load(&scope).unwrap(), None);
    }

    #[test]
    fn in_memory_load_missing_returns_none() {
        let keyring = InMemoryKeyring::new();
        assert_eq!(keyring.load(&sample_scopes()[0]).unwrap(), None);
    }

    #[test]
    fn in_memory_has_reflects_presence() {
        let keyring = InMemoryKeyring::new();
        let scope = SecretScope::OpenRouterChildKey {
            label: "period-3".into(),
        };

        assert!(!keyring.has(&scope).unwrap());
        keyring.store(&scope, "child-key").unwrap();
        assert!(keyring.has(&scope).unwrap());
        keyring.delete(&scope).unwrap();
        assert!(!keyring.has(&scope).unwrap());
    }

    #[test]
    fn in_memory_debug_redacts_values() {
        let keyring = InMemoryKeyring::new();
        keyring.store(&sample_scopes()[0], "super-secret").unwrap();

        let debug = format!("{keyring:?}");

        assert_eq!(debug, "InMemoryKeyring { entries: 1 }");
        assert!(!debug.contains("super-secret"));
    }

    #[test]
    fn provider_api_key_helpers_roundtrip() {
        let keyring = InMemoryKeyring::new();

        upsert_provider_api_key(&keyring, 7, "provider-secret").unwrap();
        assert_eq!(
            load_provider_api_key(&keyring, 7).unwrap(),
            Some("provider-secret".into())
        );

        delete_provider_api_key(&keyring, 7).unwrap();
        assert_eq!(load_provider_api_key(&keyring, 7).unwrap(), None);
    }

    #[test]
    fn codex_tokens_roundtrip_three_scopes() {
        let keyring = InMemoryKeyring::new();
        let tokens = CodexTokens {
            access_token: "at-1".into(),
            refresh_token: "rt-1".into(),
            id_token: "id-1".into(),
            account_id: "acct-1".into(),
            expires_in: 3600,
        };
        store_codex_tokens(&keyring, 9, &tokens).unwrap();
        let (at, rt, id) = load_codex_tokens(&keyring, 9).unwrap().unwrap();
        assert_eq!(at, "at-1");
        assert_eq!(rt, "rt-1");
        assert_eq!(id, "id-1");
        delete_codex_tokens(&keyring, 9).unwrap();
        assert!(load_codex_tokens(&keyring, 9).unwrap().is_none());
    }

    #[test]
    fn codex_tokens_load_returns_none_when_refresh_missing() {
        let keyring = InMemoryKeyring::new();
        keyring
            .store(
                &SecretScope::CodexAccessToken {
                    provider_config_id: 42,
                },
                "only-access",
            )
            .unwrap();
        assert!(load_codex_tokens(&keyring, 42).unwrap().is_none());
    }

    #[test]
    fn local_file_keyring_persists_without_os_keyring() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("qa-secrets.json");
        let scope = SecretScope::ProviderApiKey {
            provider_config_id: 77,
        };

        let keyring = LocalFileKeyring::new(&path);
        keyring.store(&scope, "qa-secret").unwrap();
        assert_eq!(keyring.load(&scope).unwrap(), Some("qa-secret".into()));

        let reopened = LocalFileKeyring::new(&path);
        assert_eq!(reopened.load(&scope).unwrap(), Some("qa-secret".into()));
        reopened.delete(&scope).unwrap();
        assert_eq!(reopened.load(&scope).unwrap(), None);
    }

    #[test]
    fn local_file_debug_does_not_include_secret_values() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("qa-secrets.json");
        let keyring = LocalFileKeyring::new(&path);
        keyring.store(&sample_scopes()[0], "super-secret").unwrap();

        let debug = format!("{keyring:?}");

        assert!(debug.contains("LocalFileKeyring"));
        assert!(!debug.contains("super-secret"));
    }

    #[test]
    fn local_file_keyring_can_read_qa_env_provider_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("qa-secrets.json");
        let keyring = LocalFileKeyring::new(&path);
        let scope = SecretScope::ProviderApiKey {
            provider_config_id: 12345,
        };

        std::env::set_var("DIVE_PROVIDER_API_KEY_12345", "env-secret");
        let loaded = keyring.load(&scope).unwrap();
        std::env::remove_var("DIVE_PROVIDER_API_KEY_12345");

        assert_eq!(loaded, Some("env-secret".into()));
    }

    #[test]
    #[ignore = "uses the host OS keyring; run locally with `cargo test -- --ignored`"]
    fn os_keyring_roundtrip() {
        let keyring = OsKeyring::new();
        let scope = SecretScope::OpenRouterChildKey {
            label: format!("ignored-test-{}", std::process::id()),
        };

        keyring.delete(&scope).unwrap();
        keyring.store(&scope, "os-secret").unwrap();
        assert_eq!(keyring.load(&scope).unwrap(), Some("os-secret".into()));
        keyring.delete(&scope).unwrap();
        assert_eq!(keyring.load(&scope).unwrap(), None);
    }
}
