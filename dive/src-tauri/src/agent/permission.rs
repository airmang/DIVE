use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::oneshot;

use super::event::DiffPreview;
use crate::providers::ToolCall;
use crate::tools::RiskLevel;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PermissionDecision {
    Approved {
        modified_args: Option<Value>,
        approval_metadata: Option<Value>,
    },
    Denied(String),
}

impl PermissionDecision {
    pub fn approved() -> Self {
        Self::Approved {
            modified_args: None,
            approval_metadata: None,
        }
    }
    pub fn approved_with(args: Value) -> Self {
        Self::Approved {
            modified_args: Some(args),
            approval_metadata: None,
        }
    }
    pub fn approved_with_metadata(metadata: Option<Value>) -> Self {
        Self::Approved {
            modified_args: None,
            approval_metadata: metadata,
        }
    }
    pub fn approved_with_context(args: Value, metadata: Option<Value>) -> Self {
        Self::Approved {
            modified_args: Some(args),
            approval_metadata: metadata,
        }
    }
    pub fn denied(reason: impl Into<String>) -> Self {
        Self::Denied(reason.into())
    }
}

#[derive(Debug, Clone)]
pub struct PermissionRequestContext {
    pub session_id: i64,
    pub params_preview: String,
    pub diff_preview: Option<DiffPreview>,
    pub diff_previews: Vec<DiffPreview>,
    pub approval_warnings: PermissionApprovalWarnings,
    pub args: Value,
}

impl PermissionRequestContext {
    #[cfg(test)]
    pub fn test(session_id: i64) -> Self {
        Self {
            session_id,
            params_preview: "{}".into(),
            diff_preview: None,
            diff_previews: Vec::new(),
            approval_warnings: PermissionApprovalWarnings::default(),
            args: Value::Object(Default::default()),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionApprovalWarnings {
    pub secret_flagged: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub secret_reasons: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub whole_file_overwrite: Option<WholeFileOverwriteWarning>,
}

impl PermissionApprovalWarnings {
    pub fn is_empty(&self) -> bool {
        !self.secret_flagged
            && self.secret_reasons.is_empty()
            && self.whole_file_overwrite.is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WholeFileOverwriteWarning {
    pub lines_removed: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingApprovalSnapshot {
    pub id: String,
    pub session_id: i64,
    pub tool: String,
    pub params_preview: String,
    pub risk: RiskLevel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_preview: Option<DiffPreview>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub diff_previews: Vec<DiffPreview>,
    #[serde(skip_serializing_if = "PermissionApprovalWarnings::is_empty")]
    pub approval_warnings: PermissionApprovalWarnings,
    pub args: Value,
}

impl PendingApprovalSnapshot {
    fn from_request(call: &ToolCall, risk: RiskLevel, context: PermissionRequestContext) -> Self {
        Self {
            id: call.id.clone(),
            session_id: context.session_id,
            tool: call.name.clone(),
            params_preview: context.params_preview,
            risk,
            diff_preview: context.diff_preview,
            diff_previews: context.diff_previews,
            approval_warnings: context.approval_warnings,
            args: context.args,
        }
    }
}

#[async_trait]
pub trait PermissionHook: Send + Sync {
    async fn intercept(
        &self,
        call: &ToolCall,
        risk: RiskLevel,
        context: PermissionRequestContext,
    ) -> PermissionDecision;

    fn cancel_pending(&self, ids: &[String]) -> usize {
        let _ = ids;
        0
    }
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
        if tool_name == "web_fetch" && self != Self::Build {
            return Some(format!(
                "run mode '{}' blocks web_fetch; web access is available only while building",
                self.as_str()
            ));
        }
        let mutating_tool = matches!(
            tool_name,
            "write_file"
                | "edit_file"
                | "multi_replace"
                | "delete_file"
                | "mkdir"
                | "bash"
                | "run_process"
                | "run_terminal_script"
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
    async fn intercept(
        &self,
        call: &ToolCall,
        risk: RiskLevel,
        context: PermissionRequestContext,
    ) -> PermissionDecision {
        if let Some(reason) = self.mode.denies_pre_plan_mutation(
            &call.name,
            risk,
            self.plan_accepted,
            self.active_step_id,
        ) {
            return PermissionDecision::denied(reason);
        }
        self.inner.intercept(call, risk, context).await
    }

    fn cancel_pending(&self, ids: &[String]) -> usize {
        self.inner.cancel_pending(ids)
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
    async fn intercept(
        &self,
        _call: &ToolCall,
        risk: RiskLevel,
        _context: PermissionRequestContext,
    ) -> PermissionDecision {
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
    async fn intercept(
        &self,
        _call: &ToolCall,
        _risk: RiskLevel,
        _context: PermissionRequestContext,
    ) -> PermissionDecision {
        PermissionDecision::approved()
    }
}

/// Always-deny hook used by integration tests.
pub struct AlwaysDenyHook;

#[async_trait]
impl PermissionHook for AlwaysDenyHook {
    async fn intercept(
        &self,
        _call: &ToolCall,
        _risk: RiskLevel,
        _context: PermissionRequestContext,
    ) -> PermissionDecision {
        PermissionDecision::denied("test hook denies all")
    }
}

/// Adapts an `AutoApprovePolicy` to the hook trait.
pub struct PolicyHook {
    pub policy: AutoApprovePolicy,
}

#[async_trait]
impl PermissionHook for PolicyHook {
    async fn intercept(
        &self,
        call: &ToolCall,
        risk: RiskLevel,
        _context: PermissionRequestContext,
    ) -> PermissionDecision {
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
    inner: Arc<Mutex<HashMap<String, PendingApprovalEntry>>>,
}

struct PendingApprovalEntry {
    tx: oneshot::Sender<PermissionDecision>,
    snapshot: PendingApprovalSnapshot,
}

impl PendingApprovals {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &self,
        snapshot: PendingApprovalSnapshot,
    ) -> oneshot::Receiver<PermissionDecision> {
        let (tx, rx) = oneshot::channel();
        if let Ok(mut g) = self.inner.lock() {
            g.insert(snapshot.id.clone(), PendingApprovalEntry { tx, snapshot });
        }
        rx
    }

    pub fn resolve(&self, id: &str, decision: PermissionDecision) -> bool {
        let entry = self.inner.lock().ok().and_then(|mut g| g.remove(id));
        match entry {
            Some(entry) => entry.tx.send(decision).is_ok(),
            None => false,
        }
    }

    pub fn resolve_with_snapshot(
        &self,
        id: &str,
        decision: PermissionDecision,
    ) -> Option<(PendingApprovalSnapshot, bool)> {
        let entry = self.inner.lock().ok().and_then(|mut g| g.remove(id))?;
        let snapshot = entry.snapshot;
        let sent = entry.tx.send(decision).is_ok();
        Some((snapshot, sent))
    }

    pub fn cancel_many(&self, ids: &[String]) -> usize {
        let Ok(mut guard) = self.inner.lock() else {
            return 0;
        };
        ids.iter().filter_map(|id| guard.remove(id)).count()
    }

    pub fn cancel_session(&self, session_id: i64) -> usize {
        let Ok(mut guard) = self.inner.lock() else {
            return 0;
        };
        let ids = guard
            .iter()
            .filter(|(_, entry)| entry.snapshot.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        ids.iter().filter_map(|id| guard.remove(id)).count()
    }

    pub fn list_for_session(&self, session_id: i64) -> Vec<PendingApprovalSnapshot> {
        let Ok(guard) = self.inner.lock() else {
            return Vec::new();
        };
        guard
            .values()
            .filter(|entry| entry.snapshot.session_id == session_id)
            .map(|entry| entry.snapshot.clone())
            .collect()
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
    async fn intercept(
        &self,
        call: &ToolCall,
        risk: RiskLevel,
        context: PermissionRequestContext,
    ) -> PermissionDecision {
        if self.auto_approve_safe && matches!(risk, RiskLevel::Safe) {
            return PermissionDecision::approved();
        }
        let rx = self
            .pending
            .register(PendingApprovalSnapshot::from_request(call, risk, context));
        match rx.await {
            Ok(decision) => decision,
            Err(_) => PermissionDecision::denied("approval channel closed"),
        }
    }

    fn cancel_pending(&self, ids: &[String]) -> usize {
        self.pending.cancel_many(ids)
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
    async fn intercept(
        &self,
        call: &ToolCall,
        risk: RiskLevel,
        context: PermissionRequestContext,
    ) -> PermissionDecision {
        if let Ok(policy) = self.policy.read() {
            if let Some(decision) = policy.decide(&call.name, risk) {
                return decision;
            }
        }
        if self.auto_approve_safe && matches!(risk, RiskLevel::Safe) {
            return PermissionDecision::approved();
        }
        let rx = self
            .pending
            .register(PendingApprovalSnapshot::from_request(call, risk, context));
        match rx.await {
            Ok(decision) => decision,
            Err(_) => PermissionDecision::denied("approval channel closed"),
        }
    }

    fn cancel_pending(&self, ids: &[String]) -> usize {
        self.pending.cancel_many(ids)
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
        let decision = hook
            .intercept(
                &call("read_file"),
                RiskLevel::Safe,
                PermissionRequestContext::test(1),
            )
            .await;
        assert!(matches!(decision, PermissionDecision::Approved { .. }));
    }

    #[tokio::test]
    async fn plan_mode_denies_mutating_write_tool() {
        let hook = RunModePermissionHook::new(AgentRunMode::Plan, Arc::new(AlwaysApproveHook));
        let decision = hook
            .intercept(
                &call("write_file"),
                RiskLevel::Warn,
                PermissionRequestContext::test(1),
            )
            .await;
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
        let decision = hook
            .intercept(
                &call("write_file"),
                RiskLevel::Warn,
                PermissionRequestContext::test(1),
            )
            .await;
        match decision {
            PermissionDecision::Denied(reason) => {
                assert!(reason.contains("build mode"));
                assert!(reason.contains("write_file"));
            }
            other => panic!("expected denial, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn web_fetch_is_denied_outside_build_mode_by_permission_backstop() {
        for mode in [
            AgentRunMode::Interview,
            AgentRunMode::Plan,
            AgentRunMode::Verify,
        ] {
            let hook = RunModePermissionHook::new(mode, Arc::new(AlwaysApproveHook));
            let decision = hook
                .intercept(
                    &call("web_fetch"),
                    RiskLevel::Danger,
                    PermissionRequestContext::test(1),
                )
                .await;
            match decision {
                PermissionDecision::Denied(reason) => {
                    assert!(reason.contains("web_fetch"));
                    assert!(reason.contains("building"));
                }
                other => panic!("expected denial for {mode:?}, got {other:?}"),
            }
        }
    }

    #[tokio::test]
    async fn plan_and_build_mode_deny_multi_replace_without_approved_active_step() {
        let plan_hook = RunModePermissionHook::new(AgentRunMode::Plan, Arc::new(AlwaysApproveHook));
        let plan_decision = plan_hook
            .intercept(
                &call("multi_replace"),
                RiskLevel::Warn,
                PermissionRequestContext::test(1),
            )
            .await;
        match plan_decision {
            PermissionDecision::Denied(reason) => {
                assert!(reason.contains("plan"));
                assert!(reason.contains("multi_replace"));
            }
            other => panic!("expected denial, got {other:?}"),
        }

        let build_hook =
            RunModePermissionHook::new(AgentRunMode::Build, Arc::new(AlwaysApproveHook))
                .with_plan_accepted(true);
        let build_decision = build_hook
            .intercept(
                &call("multi_replace"),
                RiskLevel::Warn,
                PermissionRequestContext::test(1),
            )
            .await;
        match build_decision {
            PermissionDecision::Denied(reason) => {
                assert!(reason.contains("build mode"));
                assert!(reason.contains("multi_replace"));
            }
            other => panic!("expected denial, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn build_mode_allows_mutating_tool_with_approved_plan_and_step() {
        let hook = RunModePermissionHook::new(AgentRunMode::Build, Arc::new(AlwaysApproveHook))
            .with_plan_accepted(true)
            .with_active_step_id(Some(1));
        let decision = hook
            .intercept(
                &call("write_file"),
                RiskLevel::Warn,
                PermissionRequestContext::test(1),
            )
            .await;
        assert!(matches!(decision, PermissionDecision::Approved { .. }));
    }
}
