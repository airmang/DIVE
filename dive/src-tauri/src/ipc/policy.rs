use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::agent::{AutoApprove, AutoApprovePolicy};

use super::AppState;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AutoApprovePolicyDto {
    pub rules: std::collections::HashMap<String, String>,
    pub default: Option<String>,
}

impl AutoApprovePolicyDto {
    pub fn from_policy(policy: &AutoApprovePolicy) -> Self {
        Self {
            rules: policy
                .rules
                .iter()
                .map(|(k, v)| (k.clone(), mode_to_string(*v)))
                .collect(),
            default: policy.default.map(mode_to_string),
        }
    }

    pub fn to_policy(&self) -> AutoApprovePolicy {
        AutoApprovePolicy {
            rules: self
                .rules
                .iter()
                .filter_map(|(k, v)| mode_from_string(v).map(|m| (k.clone(), m)))
                .collect(),
            default: self.default.as_deref().and_then(mode_from_string),
        }
    }
}

fn mode_to_string(mode: AutoApprove) -> String {
    match mode {
        AutoApprove::Always => "always".into(),
        AutoApprove::Never => "never".into(),
    }
}

fn mode_from_string(s: &str) -> Option<AutoApprove> {
    match s {
        "always" => Some(AutoApprove::Always),
        "never" => Some(AutoApprove::Never),
        _ => None,
    }
}

static POLICY_STORE: Lazy<Mutex<AutoApprovePolicyDto>> =
    Lazy::new(|| Mutex::new(AutoApprovePolicyDto::default()));

#[tauri::command]
pub async fn provider_policy_get(
    _state: State<'_, AppState>,
) -> Result<AutoApprovePolicyDto, String> {
    let guard = POLICY_STORE.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
pub async fn provider_policy_set(
    _state: State<'_, AppState>,
    policy: AutoApprovePolicyDto,
) -> Result<(), String> {
    let mut guard = POLICY_STORE.lock().map_err(|e| e.to_string())?;
    *guard = policy;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dto_roundtrip_preserves_rules() {
        let mut rules = std::collections::HashMap::new();
        rules.insert("read_file".into(), "always".into());
        rules.insert("write_file".into(), "never".into());
        let dto = AutoApprovePolicyDto {
            rules,
            default: Some("never".into()),
        };
        let policy = dto.to_policy();
        let dto2 = AutoApprovePolicyDto::from_policy(&policy);
        assert_eq!(dto2.rules.get("read_file"), Some(&"always".to_string()));
        assert_eq!(dto2.rules.get("write_file"), Some(&"never".to_string()));
        assert_eq!(dto2.default, Some("never".into()));
    }

    #[test]
    fn policy_precedence_danger_always_manual() {
        let mut rules = std::collections::HashMap::new();
        rules.insert("rm_rf".into(), AutoApprove::Always);
        let policy = AutoApprovePolicy {
            rules,
            default: None,
        };
        use crate::tools::RiskLevel;
        assert!(policy.decide("rm_rf", RiskLevel::Danger).is_none());
        assert!(policy.decide("rm_rf", RiskLevel::Safe).is_some());
    }

    #[test]
    fn policy_default_fallback_applied() {
        let policy = AutoApprovePolicy {
            rules: std::collections::HashMap::new(),
            default: Some(AutoApprove::Always),
        };
        use crate::tools::RiskLevel;
        let d = policy.decide("anything", RiskLevel::Safe).unwrap();
        assert!(matches!(
            d,
            crate::agent::PermissionDecision::Approved { .. }
        ));
    }
}
