//! OpenRouter Provisioning Keys. Spec §7.5.
//!
//! Teachers hold an OpenRouter main key (Provisioning-enabled) and use the
//! `/api/v1/keys` endpoint to mint per-class / per-period **child keys**
//! with a bounded credit limit. Each child key is returned once at creation
//! (`data.key`) and can never be retrieved again — only revoked by its
//! server-side hash. DIVE stores the child key into the OS keyring under
//! `SecretScope::OpenRouterChildKey { label }` immediately.
//!
//! Endpoint reference (OpenRouter docs):
//!   POST   /api/v1/keys        issue
//!   GET    /api/v1/keys        list
//!   DELETE /api/v1/keys/:hash  revoke
//!
//! Errors short-circuit with the HTTP status + raw body captured in
//! `ProvisioningError::Remote` so the UI can show diagnostic detail.

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const DEFAULT_BASE_URL: &str = "https://openrouter.ai/api/v1";

#[derive(Debug, Error)]
pub enum ProvisioningError {
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("remote error {status}: {body}")]
    Remote { status: u16, body: String },
    #[error("decode: {0}")]
    Decode(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChildKey {
    pub key: String,
    pub hash: String,
    pub label: String,
    pub limit_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChildKeySummary {
    pub hash: String,
    pub label: String,
    pub limit_usd: Option<f64>,
    pub disabled: bool,
}

pub struct OpenRouterProvisioning {
    base_url: String,
    client: reqwest::Client,
}

impl OpenRouterProvisioning {
    pub fn new() -> Self {
        Self::with_base_url(DEFAULT_BASE_URL)
    }

    pub fn with_base_url(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            client: reqwest::Client::new(),
        }
    }

    pub async fn issue_child_key(
        &self,
        main_key: &str,
        label: &str,
        limit_usd: Option<f64>,
    ) -> Result<ChildKey, ProvisioningError> {
        #[derive(Serialize)]
        struct Req<'a> {
            name: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            limit: Option<f64>,
        }

        let body = Req {
            name: label,
            limit: limit_usd,
        };
        let url = format!("{}/keys", self.base_url);
        let resp = self
            .client
            .post(&url)
            .bearer_auth(main_key)
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(remote_error(status, resp.text().await.unwrap_or_default()));
        }
        let raw: serde_json::Value = resp.json().await?;
        let data = raw.get("data").cloned().unwrap_or_else(|| raw.clone());
        let key = data
            .get("key")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ProvisioningError::Decode("missing data.key".into()))?
            .to_string();
        let hash = data
            .get("hash")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ProvisioningError::Decode("missing data.hash".into()))?
            .to_string();
        Ok(ChildKey {
            key,
            hash,
            label: label.to_string(),
            limit_usd,
        })
    }

    pub async fn revoke_child_key(
        &self,
        main_key: &str,
        hash: &str,
    ) -> Result<(), ProvisioningError> {
        let url = format!("{}/keys/{}", self.base_url, hash);
        let resp = self
            .client
            .delete(&url)
            .bearer_auth(main_key)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(remote_error(status, resp.text().await.unwrap_or_default()));
        }
        Ok(())
    }

    pub async fn list_child_keys(
        &self,
        main_key: &str,
    ) -> Result<Vec<ChildKeySummary>, ProvisioningError> {
        let url = format!("{}/keys", self.base_url);
        let resp = self.client.get(&url).bearer_auth(main_key).send().await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(remote_error(status, resp.text().await.unwrap_or_default()));
        }
        let raw: serde_json::Value = resp.json().await?;
        let arr = raw
            .get("data")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut out = Vec::with_capacity(arr.len());
        for item in arr {
            let hash = item
                .get("hash")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let label = item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let limit_usd = item.get("limit").and_then(|v| v.as_f64());
            let disabled = item
                .get("disabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            out.push(ChildKeySummary {
                hash,
                label,
                limit_usd,
                disabled,
            });
        }
        Ok(out)
    }

    pub async fn revoke_all_by_prefix(
        &self,
        main_key: &str,
        label_prefix: &str,
    ) -> Result<usize, ProvisioningError> {
        let list = self.list_child_keys(main_key).await?;
        let mut revoked = 0;
        for summary in list {
            if summary.label.starts_with(label_prefix) && !summary.disabled {
                self.revoke_child_key(main_key, &summary.hash).await?;
                revoked += 1;
            }
        }
        Ok(revoked)
    }
}

impl Default for OpenRouterProvisioning {
    fn default() -> Self {
        Self::new()
    }
}

fn remote_error(status: StatusCode, body: String) -> ProvisioningError {
    ProvisioningError::Remote {
        status: status.as_u16(),
        body,
    }
}
