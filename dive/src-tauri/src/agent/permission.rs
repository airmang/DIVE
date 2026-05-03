use std::collections::HashMap;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::providers::ToolCall;
use crate::tools::RiskLevel;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PermissionDecision {
    Approved,
    Denied(String),
}

#[async_trait]
pub trait PermissionHook: Send + Sync {
    async fn intercept(&self, call: &ToolCall, risk: RiskLevel) -> PermissionDecision;
}

/// Spec §8.3 auto-approve policy. MVP supports `Always` / `Never` per tool.
/// Full manual-approval flow arrives with the permission card UI in task 2-4.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AutoApprove {
    Always,
    Never,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AutoApprovePolicy {
    pub rules: HashMap<String, AutoApprove>,
    /// Fallback when the tool is not listed. `Always` only for all-safe fleets.
    pub default: Option<AutoApprove>,
}

impl AutoApprovePolicy {
    pub fn decide(&self, tool_name: &str, risk: RiskLevel) -> Option<PermissionDecision> {
        if matches!(risk, RiskLevel::Danger) {
            return None;
        }
        let explicit = self.rules.get(tool_name);
        let effective = explicit.copied().or(self.default);
        effective.map(|mode| match mode {
            AutoApprove::Always => PermissionDecision::Approved,
            AutoApprove::Never => {
                PermissionDecision::Denied(format!("policy denies '{tool_name}'"))
            }
        })
    }
}

/// Safe-only auto-approve: permits `RiskLevel::Safe` tools automatically and
/// denies everything else with a placeholder reason. Real manual approval
/// (wait-for-user via oneshot channel) lands in task 2-4.
pub struct SafeOnlyHook;

#[async_trait]
impl PermissionHook for SafeOnlyHook {
    async fn intercept(&self, _call: &ToolCall, risk: RiskLevel) -> PermissionDecision {
        match risk {
            RiskLevel::Safe => PermissionDecision::Approved,
            _ => {
                PermissionDecision::Denied("manual approval required (UI lands in task 2-4)".into())
            }
        }
    }
}

/// Blanket approver used by integration tests. Never use in production.
pub struct AlwaysApproveHook;

#[async_trait]
impl PermissionHook for AlwaysApproveHook {
    async fn intercept(&self, _call: &ToolCall, _risk: RiskLevel) -> PermissionDecision {
        PermissionDecision::Approved
    }
}

/// Always-deny hook used by integration tests (verifies deny path).
pub struct AlwaysDenyHook;

#[async_trait]
impl PermissionHook for AlwaysDenyHook {
    async fn intercept(&self, _call: &ToolCall, _risk: RiskLevel) -> PermissionDecision {
        PermissionDecision::Denied("test hook denies all".into())
    }
}

/// Adapts an `AutoApprovePolicy` into a `PermissionHook`. When the policy has
/// no decision, falls back to denying with a placeholder reason.
pub struct PolicyHook {
    pub policy: AutoApprovePolicy,
}

#[async_trait]
impl PermissionHook for PolicyHook {
    async fn intercept(&self, call: &ToolCall, risk: RiskLevel) -> PermissionDecision {
        self.policy
            .decide(&call.name, risk)
            .unwrap_or_else(|| PermissionDecision::Denied("no policy match".into()))
    }
}
