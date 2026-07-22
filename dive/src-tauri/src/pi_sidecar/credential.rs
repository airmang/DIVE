use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde_json::json;

use crate::auth::{self, Keyring};

use super::parity::{CredentialMode, PiProviderDescriptor};
use super::PROVIDER_ID;

pub(super) struct TempAuthDir {
    path: PathBuf,
}

impl TempAuthDir {
    pub(super) fn create() -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!("dive-pi-sidecar-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).map_err(|e| format!("temp auth dir: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| format!("chmod temp auth dir: {e}"))?;
        }
        Ok(Self { path })
    }

    pub(super) fn auth_path(&self) -> PathBuf {
        self.path.join("auth.json")
    }

    pub(super) fn agent_dir(&self) -> PathBuf {
        self.path.join("agent")
    }
}

impl Drop for TempAuthDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Best-effort cleanup of stale per-turn OAuth temp dirs left behind when a
/// process exit skips `TempAuthDir`'s `Drop` (e.g. Tauri shutdown calling
/// `std::process::exit` mid-turn, or a hard crash). Intended to be called
/// once at app startup, before any turn creates a new `TempAuthDir`. Safe:
/// every `dive-pi-sidecar-*` entry under the OS temp dir is a per-turn
/// directory named with a fresh UUID (see `TempAuthDir::create`), so nothing
/// live can collide with an old one.
pub(crate) fn sweep_stale_temp_auth_dirs() {
    let base = std::env::temp_dir();
    let entries = match std::fs::read_dir(&base) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        if !name.starts_with("dive-pi-sidecar-") {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

pub(super) enum RuntimeCredential {
    OauthFile {
        _temp: TempAuthDir,
        auth_path: PathBuf,
        auth_file_mode: String,
    },
    ApiKey {
        api_key: String,
        auth_file_mode: String,
    },
}

impl RuntimeCredential {
    pub(super) fn auth_path(&self) -> Option<&Path> {
        match self {
            Self::OauthFile { auth_path, .. } => Some(auth_path.as_path()),
            Self::ApiKey { .. } => None,
        }
    }

    pub(super) fn api_key(&self) -> Option<&str> {
        match self {
            Self::OauthFile { .. } => None,
            Self::ApiKey { api_key, .. } => Some(api_key),
        }
    }

    pub(super) fn auth_file_mode(&self) -> &str {
        match self {
            Self::OauthFile { auth_file_mode, .. } | Self::ApiKey { auth_file_mode, .. } => {
                auth_file_mode
            }
        }
    }
}

pub(super) fn write_codex_auth_file(
    path: &Path,
    access_token: &str,
    refresh_token: &str,
    expires: u64,
    account_id: &str,
) -> Result<(), String> {
    let body = json!({
        PROVIDER_ID: {
            "type": "oauth",
            "access": access_token,
            "refresh": refresh_token,
            "expires": expires,
            "accountId": account_id,
        }
    });
    std::fs::write(
        path,
        format!("{}\n", serde_json::to_string_pretty(&body).unwrap()),
    )
    .map_err(|e| format!("write pi auth.json: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("chmod pi auth.json: {e}"))?;
    }
    Ok(())
}

pub(super) fn prepare_runtime_credential(
    keyring: &dyn Keyring,
    descriptor: &PiProviderDescriptor,
    provider_config_id: i64,
) -> Result<RuntimeCredential, String> {
    match descriptor.credential_mode {
        CredentialMode::OauthFile => {
            let (access_token, refresh_token, account_id, expires) =
                load_codex_auth_entry(keyring, provider_config_id)?;
            let temp = TempAuthDir::create()?;
            std::fs::create_dir_all(temp.agent_dir()).map_err(|e| format!("agent dir: {e}"))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(temp.agent_dir(), std::fs::Permissions::from_mode(0o700))
                    .map_err(|e| format!("chmod agent dir: {e}"))?;
            }
            write_codex_auth_file(
                &temp.auth_path(),
                &access_token,
                &refresh_token,
                expires,
                &account_id,
            )?;

            let auth_file_mode = file_mode_string(&temp.auth_path())?;
            Ok(RuntimeCredential::OauthFile {
                auth_path: temp.auth_path(),
                auth_file_mode,
                _temp: temp,
            })
        }
        CredentialMode::ApiKey => {
            let api_key = auth::load_provider_api_key(keyring, provider_config_id)
                .map_err(|e| format!("keyring: {e}"))?
                .ok_or_else(|| format!("API key not found for provider {provider_config_id}"))?;
            Ok(RuntimeCredential::ApiKey {
                api_key,
                auth_file_mode: "runtime-api-key".to_string(),
            })
        }
    }
}

pub(super) fn load_codex_auth_entry(
    keyring: &dyn Keyring,
    provider_config_id: i64,
) -> Result<(String, String, String, u64), String> {
    let (access_token, refresh_token, id_token) =
        auth::load_codex_tokens(keyring, provider_config_id)
            .map_err(|e| format!("keyring: {e}"))?
            .ok_or_else(|| {
                format!("codex OAuth tokens not found for provider {provider_config_id}")
            })?;

    let access_account_id = auth::codex_oauth::decode_account_id(&access_token).ok();
    let id_account_id = if id_token.trim().is_empty() {
        None
    } else {
        auth::codex_oauth::decode_account_id(&id_token).ok()
    };
    let account_id = access_account_id
        .clone()
        .or(id_account_id)
        .ok_or_else(|| "codex OAuth tokens do not expose a ChatGPT account id".to_string())?;

    if access_account_id.is_none() {
        return Err(
            "Pi Codex OAuth requires the ChatGPT account id claim in the access token".to_string(),
        );
    }

    let expires = decode_jwt_exp_ms(&access_token).unwrap_or_else(default_expiry_ms);
    Ok((access_token, refresh_token, account_id, expires))
}

pub(super) fn decode_jwt_exp_ms(token: &str) -> Option<u64> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.as_bytes())
        .ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    claims.get("exp")?.as_u64().map(|seconds| seconds * 1000)
}

pub(super) fn default_expiry_ms() -> u64 {
    now_epoch_ms() + 55 * 60 * 1000
}

pub(super) fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub(super) fn file_mode_string(path: &Path) -> Result<String, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(path)
            .map_err(|e| format!("stat pi auth.json: {e}"))?
            .permissions()
            .mode()
            & 0o777;
        Ok(format!("{mode:o}"))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok("platform-default".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::super::PROVIDER_ID;
    use super::*;

    #[test]
    fn writes_pi_codex_auth_file_shape_with_private_mode() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        write_codex_auth_file(&path, "access-token", "refresh-token", 12345, "acct_123").unwrap();

        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value[PROVIDER_ID]["type"], "oauth");
        assert_eq!(value[PROVIDER_ID]["access"], "access-token");
        assert_eq!(value[PROVIDER_ID]["refresh"], "refresh-token");
        assert_eq!(value[PROVIDER_ID]["expires"], 12345);
        assert_eq!(value[PROVIDER_ID]["accountId"], "acct_123");

        #[cfg(unix)]
        assert_eq!(file_mode_string(&path).unwrap(), "600");
    }

    #[test]
    fn sweeps_stale_temp_auth_dirs_but_leaves_unrelated_entries() {
        let stale = std::env::temp_dir().join(format!("dive-pi-sidecar-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&stale).unwrap();
        std::fs::write(stale.join("auth.json"), "leftover-refresh-token").unwrap();

        let unrelated =
            std::env::temp_dir().join(format!("dive-unrelated-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&unrelated).unwrap();

        sweep_stale_temp_auth_dirs();

        assert!(
            !stale.exists(),
            "stale dive-pi-sidecar-* dir should be swept"
        );
        assert!(
            unrelated.exists(),
            "unrelated temp dirs must not be touched"
        );

        let _ = std::fs::remove_dir_all(&unrelated);
    }
}
