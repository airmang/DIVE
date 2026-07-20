use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::db::models::ScopeExpansionAssessment;

use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupervisorMode {
    Work,
    Guided,
}

impl SupervisorMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Work => "work",
            Self::Guided => "guided",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceUiMode {
    Guided,
    Work,
    Standard,
    Expert,
}

impl SourceUiMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Guided => "guided",
            Self::Work => "work",
            Self::Standard => "standard",
            Self::Expert => "expert",
        }
    }
}

impl FromStr for SourceUiMode {
    type Err = SupervisorDropReason;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "guided" => Ok(Self::Guided),
            "work" => Ok(Self::Work),
            "standard" => Ok(Self::Standard),
            "expert" => Ok(Self::Expert),
            _ => Err(SupervisorDropReason::InvalidMode),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedSupervisorMode {
    pub mode: SupervisorMode,
    pub source_ui_mode: SourceUiMode,
}

pub fn normalize_source_ui_mode(
    input: &str,
) -> Result<NormalizedSupervisorMode, SupervisorDropReason> {
    let source_ui_mode = SourceUiMode::from_str(input)?;
    let mode = match source_ui_mode {
        SourceUiMode::Guided => SupervisorMode::Guided,
        SourceUiMode::Work | SourceUiMode::Standard | SourceUiMode::Expert => SupervisorMode::Work,
    };
    Ok(NormalizedSupervisorMode {
        mode,
        source_ui_mode,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupervisorEvent {
    AiClaimedDone,
    VerifyEntered,
    ScopeExpansion,
    PlanDrafted,
    DiffReady,
    RetryLoop,
}

impl SupervisorEvent {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AiClaimedDone => "ai_claimed_done",
            Self::VerifyEntered => "verify_entered",
            Self::ScopeExpansion => "scope_expansion",
            Self::PlanDrafted => "plan_drafted",
            Self::DiffReady => "diff_ready",
            Self::RetryLoop => "retry_loop",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TestResult {
    Pass,
    Fail,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationState {
    pub ai_self_report: bool,
    pub concrete_evidence: bool,
    pub test_result: Option<TestResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationFeasibility {
    pub runnable: bool,
    pub previewable: bool,
    pub has_tests: bool,
    pub diff_available: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSummary {
    pub step_count: usize,
    pub active_step: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorVerificationUiState {
    pub ai_claimed_done: bool,
    pub diff_reviewed: bool,
    pub app_launched: bool,
    pub preview_checked: bool,
    pub automated_tests_passed: bool,
    pub test_result: Option<TestResult>,
    #[serde(default)]
    pub test_command: Option<String>,
    #[serde(default)]
    pub test_exit_code: Option<i32>,
    #[serde(default)]
    pub acceptance_criterion_confirmed: bool,
    #[serde(default)]
    pub manual_checks: Vec<String>,
}

impl SupervisorVerificationUiState {
    pub fn has_executed_test_command(&self) -> bool {
        self.test_command
            .as_deref()
            .is_some_and(|command| !command.trim().is_empty())
            && self.test_exit_code.is_some()
    }

    pub fn effective_executed_test_result(&self) -> Option<TestResult> {
        if !self.has_executed_test_command() {
            return None;
        }
        self.test_result
            .or(self.automated_tests_passed.then_some(TestResult::Pass))
    }

    pub fn has_concrete_evidence(&self) -> bool {
        if self.effective_executed_test_result() == Some(TestResult::Fail) {
            return false;
        }
        self.effective_executed_test_result() == Some(TestResult::Pass)
            || ((self.app_launched || self.preview_checked) && self.acceptance_criterion_confirmed)
            || self
                .manual_checks
                .iter()
                .any(|item| !item.trim().is_empty())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStateFeasibilityInput {
    pub runnable_target_available: bool,
    pub preview_target_available: bool,
    #[serde(default)]
    pub test_command: Option<String>,
    pub changed_file_count: usize,
}

pub fn compute_verification_feasibility(
    input: ProjectStateFeasibilityInput,
) -> VerificationFeasibility {
    VerificationFeasibility {
        runnable: input.runnable_target_available,
        previewable: input.preview_target_available,
        has_tests: input
            .test_command
            .as_deref()
            .is_some_and(|command| !command.trim().is_empty()),
        diff_available: input.changed_file_count > 0,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorContextBuildInput {
    pub event: SupervisorEvent,
    pub artifact_ref: ArtifactRef,
    pub source_ui_mode: SourceUiMode,
    pub locale: String,
    pub goal_summary: String,
    pub plan_summary: PlanSummary,
    pub verification: SupervisorVerificationUiState,
    pub feasibility: VerificationFeasibility,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlanDraftReviewAssessment {
    #[serde(default)]
    pub eligible: bool,
    #[serde(default)]
    pub reason_codes: Vec<String>,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
    #[serde(default)]
    pub step_count: usize,
    #[serde(default)]
    pub criteria_count: usize,
    #[serde(default)]
    pub unverified_step_ids: Vec<String>,
    #[serde(default)]
    pub unlinked_step_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiffReadyReviewAssessment {
    #[serde(default)]
    pub eligible: bool,
    #[serde(default)]
    pub reason_codes: Vec<String>,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
    #[serde(default)]
    pub changed_file_count: usize,
    #[serde(default)]
    pub unexpected_files: Vec<String>,
    #[serde(default)]
    pub high_risk_files: Vec<String>,
    #[serde(default)]
    pub diff_viewed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RetryLoopReviewAssessment {
    #[serde(default)]
    pub eligible: bool,
    #[serde(default)]
    pub reason_codes: Vec<String>,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
    #[serde(default)]
    pub failure_fingerprint: String,
    #[serde(default)]
    pub failure_count: usize,
    #[serde(default)]
    pub last_failure_at: Value,
    #[serde(default)]
    pub last_action_summary: Option<String>,
    #[serde(default)]
    pub recovery_available: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScopeExpansionSupervisorContextBuildInput {
    pub artifact_ref: ArtifactRef,
    pub source_ui_mode: SourceUiMode,
    pub locale: String,
    pub goal_summary: String,
    pub plan_summary: PlanSummary,
    pub allowed_action_ids: Vec<SupervisorActionId>,
    pub evidence_refs: Vec<ScopeExpansionEvidenceRefInput>,
    pub scope_expansion: ScopeExpansionAssessment,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanDraftSupervisorContextBuildInput {
    pub artifact_ref: ArtifactRef,
    pub source_ui_mode: SourceUiMode,
    pub locale: String,
    pub goal_summary: String,
    pub plan_summary: PlanSummary,
    pub allowed_action_ids: Vec<SupervisorActionId>,
    pub evidence_refs: Vec<SupervisorEvidenceRefInput>,
    pub plan_draft_assessment: PlanDraftReviewAssessment,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DiffReadySupervisorContextBuildInput {
    pub artifact_ref: ArtifactRef,
    pub source_ui_mode: SourceUiMode,
    pub locale: String,
    pub goal_summary: String,
    pub plan_summary: PlanSummary,
    pub verification: SupervisorVerificationUiState,
    pub feasibility: VerificationFeasibility,
    pub allowed_action_ids: Vec<SupervisorActionId>,
    pub evidence_refs: Vec<SupervisorEvidenceRefInput>,
    pub diff_ready_assessment: DiffReadyReviewAssessment,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RetryLoopSupervisorContextBuildInput {
    pub artifact_ref: ArtifactRef,
    pub source_ui_mode: SourceUiMode,
    pub locale: String,
    pub goal_summary: String,
    pub plan_summary: PlanSummary,
    pub verification: SupervisorVerificationUiState,
    pub feasibility: VerificationFeasibility,
    pub allowed_action_ids: Vec<SupervisorActionId>,
    pub evidence_refs: Vec<SupervisorEvidenceRefInput>,
    pub retry_loop_assessment: RetryLoopReviewAssessment,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorContextBuildResult {
    pub context: SupervisorContext,
    pub source_ui_mode: SourceUiMode,
}

pub fn allowed_actions_for_p1(feasibility: &VerificationFeasibility) -> Vec<SupervisorActionId> {
    let mut actions = Vec::new();
    if feasibility.diff_available {
        actions.push(SupervisorActionId::OpenDiff);
    }
    if feasibility.previewable {
        actions.push(SupervisorActionId::OpenPreview);
    }
    if feasibility.has_tests {
        actions.push(SupervisorActionId::RunTests);
    }
    if feasibility.runnable {
        actions.push(SupervisorActionId::RunApp);
    }
    actions
}

pub fn build_supervisor_context_from_ui(
    input: SupervisorContextBuildInput,
) -> SupervisorContextBuildResult {
    let mode = match input.source_ui_mode {
        SourceUiMode::Guided => SupervisorMode::Guided,
        SourceUiMode::Work | SourceUiMode::Standard | SourceUiMode::Expert => SupervisorMode::Work,
    };
    let evidence_refs = build_p1_evidence_refs(&input.verification);
    let verification_state = VerificationState {
        ai_self_report: input.verification.ai_claimed_done,
        concrete_evidence: input.verification.has_concrete_evidence(),
        test_result: input.verification.effective_executed_test_result(),
    };
    let allowed_action_ids = allowed_actions_for_p1(&input.feasibility);
    let context = SupervisorContext::new(
        input.event,
        input.artifact_ref,
        mode,
        if input.locale.trim().is_empty() {
            "ko-KR".to_string()
        } else {
            input.locale
        },
        allowed_action_ids,
        input.goal_summary,
        input.plan_summary,
        verification_state,
        input.feasibility,
        evidence_refs,
    );
    SupervisorContextBuildResult {
        context,
        source_ui_mode: input.source_ui_mode,
    }
}

pub fn build_scope_expansion_supervisor_context(
    input: ScopeExpansionSupervisorContextBuildInput,
) -> SupervisorContextBuildResult {
    let mode = match input.source_ui_mode {
        SourceUiMode::Guided => SupervisorMode::Guided,
        SourceUiMode::Work | SourceUiMode::Standard | SourceUiMode::Expert => SupervisorMode::Work,
    };
    let (evidence_refs, scope_expansion) =
        build_scope_expansion_evidence_refs(&input.evidence_refs, &input.scope_expansion);
    let context = SupervisorContext::new(
        SupervisorEvent::ScopeExpansion,
        input.artifact_ref,
        mode,
        if input.locale.trim().is_empty() {
            "ko-KR".to_string()
        } else {
            input.locale
        },
        allowed_actions_for_scope_expansion(&input.allowed_action_ids),
        input.goal_summary,
        input.plan_summary,
        VerificationState {
            ai_self_report: false,
            concrete_evidence: false,
            test_result: None,
        },
        VerificationFeasibility {
            runnable: false,
            previewable: false,
            has_tests: false,
            diff_available: false,
        },
        evidence_refs,
    )
    .with_scope_expansion(scope_expansion);
    SupervisorContextBuildResult {
        context,
        source_ui_mode: input.source_ui_mode,
    }
}

pub fn build_plan_drafted_supervisor_context(
    input: PlanDraftSupervisorContextBuildInput,
) -> SupervisorContextBuildResult {
    let mode = mode_from_source(input.source_ui_mode);
    let evidence_refs = build_expanded_evidence_refs(&input.evidence_refs);
    let context = SupervisorContext::new(
        SupervisorEvent::PlanDrafted,
        input.artifact_ref,
        mode,
        locale_or_default(input.locale),
        allowed_actions_for_plan_drafted(&input.allowed_action_ids),
        input.goal_summary,
        input.plan_summary,
        VerificationState {
            ai_self_report: false,
            concrete_evidence: false,
            test_result: None,
        },
        VerificationFeasibility {
            runnable: false,
            previewable: false,
            has_tests: false,
            diff_available: false,
        },
        evidence_refs,
    )
    .with_plan_draft_assessment(input.plan_draft_assessment);
    SupervisorContextBuildResult {
        context,
        source_ui_mode: input.source_ui_mode,
    }
}

pub fn build_diff_ready_supervisor_context(
    input: DiffReadySupervisorContextBuildInput,
) -> SupervisorContextBuildResult {
    let mode = mode_from_source(input.source_ui_mode);
    let evidence_refs = build_expanded_evidence_refs(&input.evidence_refs);
    let verification_state = VerificationState {
        ai_self_report: input.verification.ai_claimed_done,
        concrete_evidence: input.verification.has_concrete_evidence(),
        test_result: input.verification.test_result.or(input
            .verification
            .automated_tests_passed
            .then_some(TestResult::Pass)),
    };
    let context = SupervisorContext::new(
        SupervisorEvent::DiffReady,
        input.artifact_ref,
        mode,
        locale_or_default(input.locale),
        allowed_actions_for_diff_ready(&input.allowed_action_ids),
        input.goal_summary,
        input.plan_summary,
        verification_state,
        input.feasibility,
        evidence_refs,
    )
    .with_diff_ready_assessment(input.diff_ready_assessment);
    SupervisorContextBuildResult {
        context,
        source_ui_mode: input.source_ui_mode,
    }
}

pub fn build_retry_loop_supervisor_context(
    input: RetryLoopSupervisorContextBuildInput,
) -> SupervisorContextBuildResult {
    let mode = mode_from_source(input.source_ui_mode);
    let evidence_refs = build_expanded_evidence_refs(&input.evidence_refs);
    let verification_state = VerificationState {
        ai_self_report: input.verification.ai_claimed_done,
        concrete_evidence: input.verification.has_concrete_evidence(),
        test_result: input.verification.test_result.or(input
            .verification
            .automated_tests_passed
            .then_some(TestResult::Pass)),
    };
    let context = SupervisorContext::new(
        SupervisorEvent::RetryLoop,
        input.artifact_ref,
        mode,
        locale_or_default(input.locale),
        allowed_actions_for_retry_loop(&input.allowed_action_ids),
        input.goal_summary,
        input.plan_summary,
        verification_state,
        input.feasibility,
        evidence_refs,
    )
    .with_retry_loop_assessment(input.retry_loop_assessment);
    SupervisorContextBuildResult {
        context,
        source_ui_mode: input.source_ui_mode,
    }
}

fn mode_from_source(source_ui_mode: SourceUiMode) -> SupervisorMode {
    match source_ui_mode {
        SourceUiMode::Guided => SupervisorMode::Guided,
        SourceUiMode::Work | SourceUiMode::Standard | SourceUiMode::Expert => SupervisorMode::Work,
    }
}

fn locale_or_default(locale: String) -> String {
    if locale.trim().is_empty() {
        "ko-KR".to_string()
    } else {
        locale
    }
}

pub fn allowed_actions_for_scope_expansion(
    requested: &[SupervisorActionId],
) -> Vec<SupervisorActionId> {
    let defaults = [
        SupervisorActionId::LinkCriterion,
        SupervisorActionId::SplitScope,
        SupervisorActionId::EditPrd,
        SupervisorActionId::DismissReview,
    ];
    let source = if requested.is_empty() {
        defaults.as_slice()
    } else {
        requested
    };
    let allowed = defaults
        .iter()
        .copied()
        .collect::<HashSet<SupervisorActionId>>();
    let mut seen = HashSet::new();
    source
        .iter()
        .copied()
        .filter(|action| allowed.contains(action))
        .filter(|action| seen.insert(*action))
        .collect()
}

pub fn allowed_actions_for_plan_drafted(
    requested: &[SupervisorActionId],
) -> Vec<SupervisorActionId> {
    filter_requested_actions(
        requested,
        &[
            SupervisorActionId::AddVerificationStep,
            SupervisorActionId::LinkCriterion,
            SupervisorActionId::SplitScope,
            SupervisorActionId::EditPrd,
            SupervisorActionId::DismissReview,
        ],
    )
}

pub fn allowed_actions_for_diff_ready(requested: &[SupervisorActionId]) -> Vec<SupervisorActionId> {
    filter_requested_actions(
        requested,
        &[
            SupervisorActionId::OpenDiff,
            SupervisorActionId::AskAiForRationale,
            SupervisorActionId::RevertUnrelatedChanges,
            SupervisorActionId::RunTests,
            SupervisorActionId::DismissReview,
        ],
    )
}

pub fn allowed_actions_for_retry_loop(requested: &[SupervisorActionId]) -> Vec<SupervisorActionId> {
    filter_requested_actions(
        requested,
        &[
            SupervisorActionId::CreateReproSteps,
            SupervisorActionId::RollbackLastChange,
            SupervisorActionId::OpenDiff,
            SupervisorActionId::RunTests,
            SupervisorActionId::SplitScope,
            SupervisorActionId::DismissReview,
        ],
    )
}

fn filter_requested_actions(
    requested: &[SupervisorActionId],
    defaults: &[SupervisorActionId],
) -> Vec<SupervisorActionId> {
    let source = if requested.is_empty() {
        defaults
    } else {
        requested
    };
    let allowed = defaults
        .iter()
        .copied()
        .collect::<HashSet<SupervisorActionId>>();
    let mut seen = HashSet::new();
    source
        .iter()
        .copied()
        .filter(|action| allowed.contains(action))
        .filter(|action| seen.insert(*action))
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupervisorActionId {
    OpenDiff,
    OpenPreview,
    RunTests,
    RunApp,
    LinkCriterion,
    SplitScope,
    EditPrd,
    AddVerificationStep,
    AskAiForRationale,
    RevertUnrelatedChanges,
    CreateReproSteps,
    RollbackLastChange,
    DismissReview,
}

impl SupervisorActionId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OpenDiff => "open_diff",
            Self::OpenPreview => "open_preview",
            Self::RunTests => "run_tests",
            Self::RunApp => "run_app",
            Self::LinkCriterion => "link_criterion",
            Self::SplitScope => "split_scope",
            Self::EditPrd => "edit_prd",
            Self::AddVerificationStep => "add_verification_step",
            Self::AskAiForRationale => "ask_ai_for_rationale",
            Self::RevertUnrelatedChanges => "revert_unrelated_changes",
            Self::CreateReproSteps => "create_repro_steps",
            Self::RollbackLastChange => "rollback_last_change",
            Self::DismissReview => "dismiss_review",
        }
    }

    pub(crate) fn label(self, locale_english: bool) -> &'static str {
        if locale_english {
            match self {
                Self::OpenDiff => "View changes",
                Self::OpenPreview => "Open preview",
                Self::RunTests => "Run tests",
                Self::RunApp => "Run app",
                Self::LinkCriterion => "Link criterion",
                Self::SplitScope => "Split scope",
                Self::EditPrd => "Edit PRD",
                Self::AddVerificationStep => "Add verification step",
                Self::AskAiForRationale => "Ask for rationale",
                Self::RevertUnrelatedChanges => "Revert unrelated changes",
                Self::CreateReproSteps => "Create repro steps",
                Self::RollbackLastChange => "Roll back last change",
                Self::DismissReview => "Dismiss",
            }
        } else {
            match self {
                Self::OpenDiff => "변경 보기",
                Self::OpenPreview => "미리보기 열기",
                Self::RunTests => "테스트 실행",
                Self::RunApp => "앱 실행",
                Self::LinkCriterion => "기준 연결",
                Self::SplitScope => "범위 나누기",
                Self::EditPrd => "PRD 수정",
                Self::AddVerificationStep => "검증 단계 추가",
                Self::AskAiForRationale => "근거 묻기",
                Self::RevertUnrelatedChanges => "관련 없는 변경 복구",
                Self::CreateReproSteps => "재현 단계 만들기",
                Self::RollbackLastChange => "마지막 변경 되돌리기",
                Self::DismissReview => "닫기",
            }
        }
    }
}

impl FromStr for SupervisorActionId {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "open_diff" => Ok(Self::OpenDiff),
            "open_preview" => Ok(Self::OpenPreview),
            "run_tests" => Ok(Self::RunTests),
            "run_app" => Ok(Self::RunApp),
            "link_criterion" => Ok(Self::LinkCriterion),
            "split_scope" => Ok(Self::SplitScope),
            "edit_prd" => Ok(Self::EditPrd),
            "add_verification_step" => Ok(Self::AddVerificationStep),
            "ask_ai_for_rationale" => Ok(Self::AskAiForRationale),
            "revert_unrelated_changes" => Ok(Self::RevertUnrelatedChanges),
            "create_repro_steps" => Ok(Self::CreateReproSteps),
            "rollback_last_change" => Ok(Self::RollbackLastChange),
            "dismiss_review" => Ok(Self::DismissReview),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorContext {
    pub schema_version: u8,
    pub event: SupervisorEvent,
    pub artifact_ref: ArtifactRef,
    pub context_hash: String,
    pub mode: SupervisorMode,
    pub locale: String,
    pub allowed_action_ids: Vec<SupervisorActionId>,
    pub goal_summary: String,
    pub plan_summary: PlanSummary,
    pub verification_state: VerificationState,
    pub feasibility: VerificationFeasibility,
    pub evidence_refs: Vec<EvidenceRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_expansion: Option<ScopeExpansionAssessment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_draft_assessment: Option<PlanDraftReviewAssessment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff_ready_assessment: Option<DiffReadyReviewAssessment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_loop_assessment: Option<RetryLoopReviewAssessment>,
}

impl SupervisorContext {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        event: SupervisorEvent,
        artifact_ref: ArtifactRef,
        mode: SupervisorMode,
        locale: impl Into<String>,
        allowed_action_ids: Vec<SupervisorActionId>,
        goal_summary: impl Into<String>,
        plan_summary: PlanSummary,
        verification_state: VerificationState,
        feasibility: VerificationFeasibility,
        evidence_refs: Vec<EvidenceRef>,
    ) -> Self {
        let mut context = Self {
            schema_version: SUPERVISOR_SCHEMA_VERSION,
            event,
            artifact_ref,
            context_hash: String::new(),
            mode,
            locale: locale.into(),
            allowed_action_ids,
            goal_summary: goal_summary.into(),
            plan_summary,
            verification_state,
            feasibility,
            evidence_refs,
            scope_expansion: None,
            plan_draft_assessment: None,
            diff_ready_assessment: None,
            retry_loop_assessment: None,
        };
        context.context_hash = context.compute_context_hash();
        context
    }

    pub fn with_scope_expansion(mut self, scope_expansion: ScopeExpansionAssessment) -> Self {
        self.scope_expansion = Some(scope_expansion);
        self.context_hash = self.compute_context_hash();
        self
    }

    pub fn with_plan_draft_assessment(mut self, assessment: PlanDraftReviewAssessment) -> Self {
        self.plan_draft_assessment = Some(assessment);
        self.context_hash = self.compute_context_hash();
        self
    }

    pub fn with_diff_ready_assessment(mut self, assessment: DiffReadyReviewAssessment) -> Self {
        self.diff_ready_assessment = Some(assessment);
        self.context_hash = self.compute_context_hash();
        self
    }

    pub fn with_retry_loop_assessment(mut self, assessment: RetryLoopReviewAssessment) -> Self {
        self.retry_loop_assessment = Some(assessment);
        self.context_hash = self.compute_context_hash();
        self
    }

    pub fn compute_context_hash(&self) -> String {
        stable_sha256(&json!({
            "schemaVersion": self.schema_version,
            "event": self.event,
            "artifactRef": {
                "kind": self.artifact_ref.kind.clone(),
                "id": self.artifact_ref.id.clone(),
            },
            "evidenceRefIds": sorted_evidence_ids(&self.evidence_refs),
            "verificationState": self.verification_state.clone(),
            "feasibility": self.feasibility.clone(),
            "scopeExpansion": self.scope_expansion.clone(),
            "planDraftAssessment": self.plan_draft_assessment.clone(),
            "diffReadyAssessment": self.diff_ready_assessment.clone(),
            "retryLoopAssessment": self.retry_loop_assessment.clone(),
        }))
    }

    pub fn evidence_hash(&self) -> String {
        let mut evidence = self
            .evidence_refs
            .iter()
            .map(|evidence| {
                json!({
                    "id": evidence.id.clone(),
                    "valueSummary": evidence.value_summary.clone(),
                })
            })
            .collect::<Vec<_>>();
        evidence.sort_by(|a, b| {
            a.get("id")
                .and_then(Value::as_str)
                .cmp(&b.get("id").and_then(Value::as_str))
        });
        stable_sha256(&json!({ "evidence": evidence }))
    }

    pub(crate) fn evidence_by_id(&self) -> HashMap<&str, &EvidenceRef> {
        self.evidence_refs
            .iter()
            .map(|evidence| (evidence.id.as_str(), evidence))
            .collect()
    }

    pub(crate) fn allowed_action_set(&self) -> HashSet<&'static str> {
        self.allowed_action_ids
            .iter()
            .map(|action| action.as_str())
            .collect()
    }
}

fn stable_sha256(value: &Value) -> String {
    let bytes = serde_json::to_vec(value).expect("stable supervisor hash value must serialize");
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{:x}", hasher.finalize())
}
