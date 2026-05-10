use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRunMode {
    Interview,
    Plan,
    Build,
    Verify,
}

impl AgentRunMode {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "interview" => Some(Self::Interview),
            "plan" | "planning" => Some(Self::Plan),
            "build" | "execute" => Some(Self::Build),
            "verify" | "check" => Some(Self::Verify),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Interview => "interview",
            Self::Plan => "plan",
            Self::Build => "build",
            Self::Verify => "verify",
        }
    }

    fn denies_pre_plan_mutation(
        self,
        tool_name: &str,
        risk: RiskLevel,
        plan_accepted: bool,
        active_step_id: Option<i64>,
    ) -> Option<String> {
        let mutating_tool = matches!(
            tool_name,
            "write_file" | "edit_file" | "delete_file" | "mkdir" | "bash" | "run_process"
        );
        match self {
            Self::Interview | Self::Plan => {
                if mutating_tool || !matches!(risk, RiskLevel::Safe) {
                    Some(format!(
                        "plan-first mode '{}' blocks mutating tool '{tool_name}' until the plan is approved",
                        self.as_str()
                    ))
                } else {
                    None
                }
            }
            Self::Build => {
                if mutating_tool && (!plan_accepted || active_step_id.is_none()) {
                    Some(format!(
                        "build mode blocks mutating tool '{tool_name}' until an approved plan with an active step is present"
                    ))
                } else {
                    None
                }
            }
            Self::Verify => None,
        }
    }
}

pub struct RunModePermissionHook {
    pub mode: AgentRunMode,
    pub inner: Arc<dyn PermissionHook>,
    pub plan_accepted: bool,
    pub active_step_id: Option<i64>,
}

impl RunModePermissionHook {
    pub fn new(mode: AgentRunMode, inner: Arc<dyn PermissionHook>) -> Self {
        Self {
            mode,
            inner,
            plan_accepted: false,
            active_step_id: None,
        }
    }

    pub fn with_plan_accepted(mut self, accepted: bool) -> Self {
        self.plan_accepted = accepted;
        self
    }

    pub fn with_active_step_id(mut self, step_id: Option<i64>) -> Self {
        self.active_step_id = step_id;
        self
    }
}

#[async_trait]
impl PermissionHook for RunModePermissionHook {
    async fn intercept(&self, call: &ToolCall, risk: RiskLevel) -> PermissionDecision {
        if let Some(reason) = self.mode.denies_pre_plan_mutation(
            &call.name,
            risk,
            self.plan_accepted,
            self.active_step_id,
        ) {
            return PermissionDecision::denied(reason);
        }
        self.inner.intercept(call, risk).await
    }
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

/// Runtime hook used by the product app: the Settings policy can approve or
/// deny safe/warn tools immediately, while unmatched calls still go through the
/// normal user approval queue. Danger tools are never auto-approved by policy.
pub struct PolicyAwareHook {
    pub pending: PendingApprovals,
    pub policy: Arc<RwLock<AutoApprovePolicy>>,
    pub auto_approve_safe: bool,
}

impl PolicyAwareHook {
    pub fn new(
        pending: PendingApprovals,
        policy: Arc<RwLock<AutoApprovePolicy>>,
        auto_approve_safe: bool,
    ) -> Self {
        Self {
            pending,
            policy,
            auto_approve_safe,
        }
    }
}

#[async_trait]
impl PermissionHook for PolicyAwareHook {
    async fn intercept(&self, call: &ToolCall, risk: RiskLevel) -> PermissionDecision {
        if let Ok(policy) = self.policy.read() {
            if let Some(decision) = policy.decide(&call.name, risk) {
                return decision;
            }
        }
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    fn call(name: &str) -> ToolCall {
        ToolCall {
            id: format!("{name}-1"),
            name: name.to_string(),
            arguments: "{}".into(),
        }
    }

    #[tokio::test]
    async fn plan_mode_allows_safe_read_tool() {
        let hook = RunModePermissionHook::new(AgentRunMode::Plan, Arc::new(AlwaysApproveHook));
        let decision = hook.intercept(&call("read_file"), RiskLevel::Safe).await;
        assert!(matches!(decision, PermissionDecision::Approved { .. }));
    }

    #[tokio::test]
    async fn plan_mode_denies_mutating_write_tool() {
        let hook = RunModePermissionHook::new(AgentRunMode::Plan, Arc::new(AlwaysApproveHook));
        let decision = hook.intercept(&call("write_file"), RiskLevel::Warn).await;
        match decision {
            PermissionDecision::Denied(reason) => {
                assert!(reason.contains("plan"));
                assert!(reason.contains("write_file"));
            }
            other => panic!("expected denial, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn build_mode_denies_mutating_tool_without_approved_plan_and_step() {
        let hook = RunModePermissionHook::new(AgentRunMode::Build, Arc::new(AlwaysApproveHook));
        let decision = hook.intercept(&call("write_file"), RiskLevel::Warn).await;
        match decision {
            PermissionDecision::Denied(reason) => {
                assert!(reason.contains("build mode"));
                assert!(reason.contains("write_file"));
            }
            other => panic!("expected denial, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn build_mode_allows_mutating_tool_with_approved_plan_and_step() {
        let hook = RunModePermissionHook::new(AgentRunMode::Build, Arc::new(AlwaysApproveHook))
            .with_plan_accepted(true)
            .with_active_step_id(Some(1));
        let decision = hook.intercept(&call("write_file"), RiskLevel::Warn).await;
        assert!(matches!(decision, PermissionDecision::Approved { .. }));
    }
}
