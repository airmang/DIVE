use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::oneshot;

use crate::providers::ToolCall;
use crate::tools::RiskLevel;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PermissionDecision {
    Approved { modified_args: Option<Value> },
    Denied(String),
}

impl PermissionDecision {
    pub fn approved() -> Self {
        Self::Approved {
            modified_args: None,
        }
    }
    pub fn approved_with(args: Value) -> Self {
        Self::Approved {
            modified_args: Some(args),
        }
    }
    pub fn denied(reason: impl Into<String>) -> Self {
        Self::Denied(reason.into())
    }
}

#[async_trait]
pub trait PermissionHook: Send + Sync {
    async fn intercept(&self, call: &ToolCall, risk: RiskLevel) -> PermissionDecision;
}

/// Spec §8.3 auto-approve policy. MVP supports `Always` / `Never` per tool.
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
            AutoApprove::Always => PermissionDecision::approved(),
            AutoApprove::Never => {
                PermissionDecision::denied(format!("policy denies '{tool_name}'"))
            }
        })
    }
}

/// Auto-approves Safe tools, denies everything else with a placeholder reason.
/// Used as a pre-2-4 fallback when the UI isn't wired yet.
pub struct SafeOnlyHook;

#[async_trait]
impl PermissionHook for SafeOnlyHook {
    async fn intercept(&self, _call: &ToolCall, risk: RiskLevel) -> PermissionDecision {
        match risk {
            RiskLevel::Safe => PermissionDecision::approved(),
            _ => PermissionDecision::denied("manual approval required"),
        }
    }
}

/// Blanket approver used by integration tests. Never use in production.
pub struct AlwaysApproveHook;

#[async_trait]
impl PermissionHook for AlwaysApproveHook {
    async fn intercept(&self, _call: &ToolCall, _risk: RiskLevel) -> PermissionDecision {
        PermissionDecision::approved()
    }
}

/// Always-deny hook used by integration tests.
pub struct AlwaysDenyHook;

#[async_trait]
impl PermissionHook for AlwaysDenyHook {
    async fn intercept(&self, _call: &ToolCall, _risk: RiskLevel) -> PermissionDecision {
        PermissionDecision::denied("test hook denies all")
    }
}

/// Adapts an `AutoApprovePolicy` to the hook trait.
pub struct PolicyHook {
    pub policy: AutoApprovePolicy,
}

#[async_trait]
impl PermissionHook for PolicyHook {
    async fn intercept(&self, call: &ToolCall, risk: RiskLevel) -> PermissionDecision {
        self.policy
            .decide(&call.name, risk)
            .unwrap_or_else(|| PermissionDecision::denied("no policy match"))
    }
}

/// Registry of pending approvals shared by `AwaitUserHook` and the IPC layer.
/// The Agent Loop parks a tool call on a oneshot until the UI resolves it
/// through `tool_approve` / `tool_deny`.
#[derive(Clone, Default)]
pub struct PendingApprovals {
    inner: Arc<Mutex<HashMap<String, oneshot::Sender<PermissionDecision>>>>,
}

impl PendingApprovals {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, id: &str) -> oneshot::Receiver<PermissionDecision> {
        let (tx, rx) = oneshot::channel();
        if let Ok(mut g) = self.inner.lock() {
            g.insert(id.to_string(), tx);
        }
        rx
    }

    pub fn resolve(&self, id: &str, decision: PermissionDecision) -> bool {
        let tx = self.inner.lock().ok().and_then(|mut g| g.remove(id));
        match tx {
            Some(tx) => tx.send(decision).is_ok(),
            None => false,
        }
    }

    pub fn pending_count(&self) -> usize {
        self.inner.lock().map(|g| g.len()).unwrap_or(0)
    }
}

/// Blocks on a oneshot channel until the UI resolves the approval. Safe tools
/// can short-circuit if `auto_approve_safe` is enabled.
pub struct AwaitUserHook {
    pub pending: PendingApprovals,
    pub auto_approve_safe: bool,
}

impl AwaitUserHook {
    pub fn new(pending: PendingApprovals, auto_approve_safe: bool) -> Self {
        Self {
            pending,
            auto_approve_safe,
        }
    }
}

#[async_trait]
impl PermissionHook for AwaitUserHook {
    async fn intercept(&self, call: &ToolCall, risk: RiskLevel) -> PermissionDecision {
        if self.auto_approve_safe && matches!(risk, RiskLevel::Safe) {
            return PermissionDecision::approved();
        }
        let rx = self.pending.register(&call.id);
        match rx.await {
            Ok(decision) => decision,
            Err(_) => PermissionDecision::denied("approval channel closed"),
        }
    }
}
