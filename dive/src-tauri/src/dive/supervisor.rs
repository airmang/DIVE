//! Deterministic supervisor-domain contracts for P1 review cards.
//!
//! The Pi SupervisorAgent returns a `SupervisorDecision`; DIVE validates that
//! decision against Rust-owned context before any UI-facing card is created.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::str::FromStr;

use crate::db::models::ScopeExpansionAssessment;

const SUPERVISOR_SCHEMA_VERSION: u8 = 1;
const P1_CONCERN: &str = "ai_self_report_only";
const SCOPE_EXPANSION_CONCERN: &str = "scope_expansion";
const QUESTION_MAX_CHARS: usize = 140;
const SUPERVISION_HABIT_MAX_CHARS: usize = 60;
const CARD_EVIDENCE_CAP: usize = 3;
const CARD_ACTION_CAP: usize = 3;
const DEFAULT_CARD_CREATED_AT: &str = "1970-01-01T00:00:00.000Z";
const SUPERVISOR_PROMPT_MAX_BYTES: usize = 24 * 1024;
const SCOPE_EVIDENCE_SUMMARY_MAX_CHARS: usize = 160;
const SCOPE_EVIDENCE_ARRAY_CAP: usize = 6;
const SCOPE_EVIDENCE_OBJECT_CAP: usize = 12;

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

pub fn invalid_mode_validation_result() -> SupervisorValidationResult {
    SupervisorValidationResult::dropped(SupervisorDropReason::InvalidMode, None)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupervisorEvent {
    AiClaimedDone,
    VerifyEntered,
    ScopeExpansion,
}

impl SupervisorEvent {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AiClaimedDone => "ai_claimed_done",
            Self::VerifyEntered => "verify_entered",
            Self::ScopeExpansion => "scope_expansion",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRef {
    pub kind: String,
    pub id: String,
    pub label: String,
}

impl ArtifactRef {
    pub fn step(id: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            kind: "step".to_string(),
            id: id.into(),
            label: label.into(),
        }
    }

    pub fn add_step_draft(id: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            kind: "add_step_draft".to_string(),
            id: id.into(),
            label: label.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceSource {
    Goal,
    Plan,
    Prompt,
    Diff,
    Verification,
    Terminal,
    Agent,
    Workmap,
    History,
    UiObservation,
}

impl EvidenceSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Goal => "goal",
            Self::Plan => "plan",
            Self::Prompt => "prompt",
            Self::Diff => "diff",
            Self::Verification => "verification",
            Self::Terminal => "terminal",
            Self::Agent => "agent",
            Self::Workmap => "workmap",
            Self::History => "history",
            Self::UiObservation => "ui_observation",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind {
    AssistantClaim,
    VerifyLog,
    TestResult,
    DiffReview,
    PreviewObserved,
    AppLaunched,
    ManualCheck,
    ChangedFile,
    TerminalError,
    PlanStep,
    AcceptanceCriteria,
    PrdScope,
    AddStepDraft,
    ScopeExpansionAssessment,
    RetryCount,
}

impl EvidenceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AssistantClaim => "assistant_claim",
            Self::VerifyLog => "verify_log",
            Self::TestResult => "test_result",
            Self::DiffReview => "diff_review",
            Self::PreviewObserved => "preview_observed",
            Self::AppLaunched => "app_launched",
            Self::ManualCheck => "manual_check",
            Self::ChangedFile => "changed_file",
            Self::TerminalError => "terminal_error",
            Self::PlanStep => "plan_step",
            Self::AcceptanceCriteria => "acceptance_criteria",
            Self::PrdScope => "prd_scope",
            Self::AddStepDraft => "add_step_draft",
            Self::ScopeExpansionAssessment => "scope_expansion_assessment",
            Self::RetryCount => "retry_count",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceRef {
    pub id: String,
    pub source: EvidenceSource,
    pub kind: EvidenceKind,
    pub label: String,
    pub value_summary: Value,
    pub verification_evidence: bool,
}

impl EvidenceRef {
    pub fn assistant_claim() -> Self {
        Self {
            id: "agent.assistant_claim".to_string(),
            source: EvidenceSource::Agent,
            kind: EvidenceKind::AssistantClaim,
            label: "AI 완료 주장".to_string(),
            value_summary: json!({ "kind": "enum", "value": "claimed_done" }),
            verification_evidence: false,
        }
    }

    pub fn diff_reviewed() -> Self {
        Self {
            id: "diff.reviewed".to_string(),
            source: EvidenceSource::Diff,
            kind: EvidenceKind::DiffReview,
            label: "Diff 확인".to_string(),
            value_summary: json!({ "kind": "enum", "value": "reviewed" }),
            verification_evidence: false,
        }
    }

    pub fn preview_observed() -> Self {
        Self {
            id: "verify.preview_observed".to_string(),
            source: EvidenceSource::Verification,
            kind: EvidenceKind::PreviewObserved,
            label: "프리뷰 확인".to_string(),
            value_summary: json!({ "kind": "enum", "value": "observed" }),
            verification_evidence: true,
        }
    }

    pub fn app_launched() -> Self {
        Self {
            id: "verify.app_launched".to_string(),
            source: EvidenceSource::Verification,
            kind: EvidenceKind::AppLaunched,
            label: "앱 실행 확인".to_string(),
            value_summary: json!({ "kind": "enum", "value": "launched" }),
            verification_evidence: true,
        }
    }

    pub fn manual_check(count: usize) -> Self {
        Self {
            id: "verify.manual_check".to_string(),
            source: EvidenceSource::Verification,
            kind: EvidenceKind::ManualCheck,
            label: "수동 확인".to_string(),
            value_summary: json!({ "kind": "count", "value": count }),
            verification_evidence: count > 0,
        }
    }

    pub fn test_result(result: TestResult) -> Self {
        let value = match result {
            TestResult::Pass => "pass",
            TestResult::Fail => "fail",
            TestResult::Skipped => "skipped",
        };
        Self {
            id: "verify.test_result".to_string(),
            source: EvidenceSource::Verification,
            kind: EvidenceKind::TestResult,
            label: "Test result".to_string(),
            value_summary: json!({ "kind": "enum", "value": value }),
            verification_evidence: result == TestResult::Pass,
        }
    }

    pub fn test_result_skipped() -> Self {
        Self::test_result(TestResult::Skipped)
    }

    pub fn acceptance_criterion(id: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            source: EvidenceSource::Plan,
            kind: EvidenceKind::AcceptanceCriteria,
            label: label.into(),
            value_summary: json!({ "kind": "criterion" }),
            verification_evidence: false,
        }
    }

    pub fn add_step_draft(id: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            source: EvidenceSource::Plan,
            kind: EvidenceKind::AddStepDraft,
            label: label.into(),
            value_summary: json!({ "kind": "draft" }),
            verification_evidence: false,
        }
    }

    pub fn scope_expansion_reason(reason_codes: Vec<String>, evidence_refs: Vec<String>) -> Self {
        Self {
            id: "scope.assessment".to_string(),
            source: EvidenceSource::Workmap,
            kind: EvidenceKind::ScopeExpansionAssessment,
            label: "범위 확장 평가".to_string(),
            value_summary: json!({
                "kind": "scope_expansion_assessment",
                "reasonCodes": reason_codes,
                "evidenceRefs": evidence_refs,
            }),
            verification_evidence: false,
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
    pub acceptance_criterion_confirmed: bool,
    #[serde(default)]
    pub manual_checks: Vec<String>,
}

impl SupervisorVerificationUiState {
    pub fn has_concrete_evidence(&self) -> bool {
        if self.test_result == Some(TestResult::Fail) {
            return false;
        }
        self.automated_tests_passed
            || self.test_result == Some(TestResult::Pass)
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

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeExpansionEvidenceRefInput {
    pub id: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub value_summary: Value,
    #[serde(default)]
    pub verification_evidence: bool,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorContextBuildResult {
    pub context: SupervisorContext,
    pub source_ui_mode: SourceUiMode,
}

pub fn record_ai_claimed_done_evidence(
    evidence_refs: &mut Vec<EvidenceRef>,
    ai_claimed_done: bool,
) {
    if ai_claimed_done
        && !evidence_refs
            .iter()
            .any(|evidence| evidence.kind == EvidenceKind::AssistantClaim)
    {
        evidence_refs.push(EvidenceRef::assistant_claim());
    }
}

pub fn build_p1_evidence_refs(verification: &SupervisorVerificationUiState) -> Vec<EvidenceRef> {
    let mut evidence_refs = Vec::new();
    record_ai_claimed_done_evidence(&mut evidence_refs, verification.ai_claimed_done);

    if verification.diff_reviewed {
        evidence_refs.push(EvidenceRef::diff_reviewed());
    }
    if verification.preview_checked {
        let mut evidence = EvidenceRef::preview_observed();
        evidence.verification_evidence = verification.acceptance_criterion_confirmed;
        evidence_refs.push(evidence);
    }
    if verification.app_launched {
        let mut evidence = EvidenceRef::app_launched();
        evidence.verification_evidence = verification.acceptance_criterion_confirmed;
        evidence_refs.push(evidence);
    }
    let effective_test_result = verification.test_result.or(verification
        .automated_tests_passed
        .then_some(TestResult::Pass));
    if let Some(result) = effective_test_result {
        evidence_refs.push(EvidenceRef::test_result(result));
    }
    let manual_count = verification
        .manual_checks
        .iter()
        .filter(|item| !item.trim().is_empty())
        .count();
    if manual_count > 0 {
        evidence_refs.push(EvidenceRef::manual_check(manual_count));
    }

    evidence_refs
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
        test_result: input.verification.test_result.or(input
            .verification
            .automated_tests_passed
            .then_some(TestResult::Pass)),
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

pub fn build_scope_expansion_evidence_refs(
    input_refs: &[ScopeExpansionEvidenceRefInput],
    assessment: &ScopeExpansionAssessment,
) -> (Vec<EvidenceRef>, ScopeExpansionAssessment) {
    let mut evidence_refs = Vec::new();
    for input in input_refs {
        push_unique_evidence_ref(
            &mut evidence_refs,
            scope_expansion_evidence_from_input(input),
        );
    }

    let mut normalized_assessment_refs = Vec::new();
    for raw_id in &assessment.evidence_refs {
        let id = normalize_scope_evidence_id(raw_id);
        push_unique_string(&mut normalized_assessment_refs, id.clone());
        if !evidence_refs
            .iter()
            .any(|evidence| evidence.id.as_str() == id.as_str())
        {
            push_unique_evidence_ref(
                &mut evidence_refs,
                synthetic_scope_expansion_evidence(raw_id, &id),
            );
        }
    }

    let reason_codes = compact_reason_codes(&assessment.reason_codes);
    let normalized = ScopeExpansionAssessment {
        expanded: assessment.expanded,
        reason_codes: reason_codes.clone(),
        evidence_refs: normalized_assessment_refs,
    };
    push_unique_evidence_ref(
        &mut evidence_refs,
        EvidenceRef::scope_expansion_reason(
            normalized.reason_codes.clone(),
            normalized.evidence_refs.clone(),
        ),
    );
    (evidence_refs, normalized)
}

fn scope_expansion_evidence_from_input(input: &ScopeExpansionEvidenceRefInput) -> EvidenceRef {
    let id = normalize_scope_evidence_id(&input.id);
    let (source, kind) = scope_expansion_evidence_source_kind(&id);
    EvidenceRef {
        id: id.clone(),
        source,
        kind,
        label: bounded_scope_label(
            input
                .label
                .as_deref()
                .filter(|label| !label.trim().is_empty())
                .unwrap_or_else(|| default_scope_evidence_label(&id)),
        ),
        value_summary: bounded_scope_value_summary(if input.value_summary.is_null() {
            json!({
                "kind": "scope_evidence",
                "sourceRef": input.id,
            })
        } else {
            input.value_summary.clone()
        }),
        verification_evidence: false,
    }
}

fn synthetic_scope_expansion_evidence(raw_id: &str, id: &str) -> EvidenceRef {
    let (source, kind) = scope_expansion_evidence_source_kind(id);
    EvidenceRef {
        id: id.to_string(),
        source,
        kind,
        label: bounded_scope_label(default_scope_evidence_label(id)),
        value_summary: json!({
            "kind": "scope_evidence",
            "sourceRef": raw_id,
        }),
        verification_evidence: false,
    }
}

fn push_unique_evidence_ref(evidence_refs: &mut Vec<EvidenceRef>, evidence: EvidenceRef) {
    if !evidence_refs
        .iter()
        .any(|existing| existing.id == evidence.id)
    {
        evidence_refs.push(evidence);
    }
}

fn push_unique_string(values: &mut Vec<String>, value: String) {
    if !value.is_empty() && !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

fn compact_reason_codes(values: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for raw in values {
        push_unique_string(&mut out, scope_slug(raw));
    }
    out
}

fn normalize_scope_evidence_id(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "scope.evidence".to_string();
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower == "step.linkedcriterionids" || lower == "step.linked_criterion_ids" {
        return "add_step.linked_criterion_ids".to_string();
    }
    if lower == "step.title" || lower == "addstep.title" || lower == "add_step.title" {
        return "add_step.title".to_string();
    }
    if lower == "step.reason" || lower == "step.summary" || lower == "add_step.reason" {
        return "add_step.reason".to_string();
    }
    if let Some(index) = indexed_ref(&lower, "step.expectedfiles") {
        return format!("add_step.expected_files_{index}");
    }
    if let Some(index) = indexed_ref(&lower, "step.expected_files") {
        return format!("add_step.expected_files_{index}");
    }
    if let Some(index) = indexed_ref(&lower, "prddelta.scopechanges") {
        return format!("prd_delta.scope_changes_{index}");
    }
    if let Some(index) = indexed_ref(&lower, "prd_delta.scope_changes") {
        return format!("prd_delta.scope_changes_{index}");
    }
    if lower.starts_with("ac-") || lower.starts_with("ac_") {
        return format!("prd.{}", scope_slug(trimmed));
    }

    let normalized = normalize_evidence_path(trimmed);
    if is_well_formed_evidence_id(&normalized) {
        normalized
    } else {
        format!("scope.{}", scope_slug(trimmed))
    }
}

fn indexed_ref(value: &str, prefix: &str) -> Option<usize> {
    let remainder = value.strip_prefix(prefix)?;
    let index = remainder.strip_prefix('[')?.strip_suffix(']')?;
    index.parse::<usize>().ok()
}

fn normalize_evidence_path(value: &str) -> String {
    let mut out = String::new();
    let mut last_separator = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_separator = false;
        } else if ch == '.' {
            if !out.ends_with('.') {
                out.push('.');
            }
            last_separator = true;
        } else if !last_separator && !out.ends_with('.') {
            out.push('_');
            last_separator = true;
        }
    }
    out.trim_matches(|ch| ch == '_' || ch == '.').to_string()
}

fn scope_slug(value: &str) -> String {
    let mut out = String::new();
    let mut last_separator = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_separator = false;
        } else if !last_separator {
            out.push('_');
            last_separator = true;
        }
    }
    let trimmed = out.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "unknown".to_string()
    } else {
        trimmed
    }
}

fn scope_expansion_evidence_source_kind(id: &str) -> (EvidenceSource, EvidenceKind) {
    if id.starts_with("prd.ac_") || id.starts_with("prd.acceptance_criteria") {
        (EvidenceSource::Plan, EvidenceKind::AcceptanceCriteria)
    } else if id.starts_with("prd.") || id.starts_with("prd_delta.") {
        (EvidenceSource::Plan, EvidenceKind::PrdScope)
    } else if id.starts_with("add_step.") {
        (EvidenceSource::Plan, EvidenceKind::AddStepDraft)
    } else {
        (
            EvidenceSource::Workmap,
            EvidenceKind::ScopeExpansionAssessment,
        )
    }
}

fn default_scope_evidence_label(id: &str) -> &'static str {
    if id == "add_step.linked_criterion_ids" {
        "연결된 PRD 기준"
    } else if id.starts_with("add_step.expected_files_") {
        "예상 파일"
    } else if id == "add_step.title" {
        "추가 단계 제목"
    } else if id == "add_step.reason" {
        "추가 단계 이유"
    } else if id.starts_with("prd.ac_") || id.starts_with("prd.acceptance_criteria") {
        "PRD 기준"
    } else if id.starts_with("prd_delta.scope_changes_") {
        "PRD 범위 변경"
    } else if id.starts_with("prd.") {
        "PRD 범위"
    } else {
        "범위 확장 근거"
    }
}

fn bounded_scope_label(value: &str) -> String {
    let trimmed = value.trim();
    let mut label = trimmed.chars().take(80).collect::<String>();
    if trimmed.chars().count() > 80 {
        label.push_str("...");
    }
    if label.is_empty() {
        "범위 확장 근거".to_string()
    } else {
        label
    }
}

fn bounded_scope_value_summary(value: Value) -> Value {
    match value {
        Value::String(text) => {
            let mut bounded = text
                .trim()
                .chars()
                .take(SCOPE_EVIDENCE_SUMMARY_MAX_CHARS)
                .collect::<String>();
            if text.trim().chars().count() > SCOPE_EVIDENCE_SUMMARY_MAX_CHARS {
                bounded.push_str("...");
            }
            Value::String(bounded)
        }
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .take(SCOPE_EVIDENCE_ARRAY_CAP)
                .map(bounded_scope_value_summary)
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .take(SCOPE_EVIDENCE_OBJECT_CAP)
                .map(|(key, value)| (key, bounded_scope_value_summary(value)))
                .collect(),
        ),
        other => other,
    }
}

pub fn p1_provoke_gate(context: &SupervisorContext) -> bool {
    context.event == SupervisorEvent::VerifyEntered
        && context.verification_state.ai_self_report
        && !context.verification_state.concrete_evidence
}

pub fn supervisor_provoke_gate(context: &SupervisorContext) -> bool {
    match context.event {
        SupervisorEvent::ScopeExpansion => context
            .scope_expansion
            .as_ref()
            .is_some_and(|assessment| assessment.expanded),
        SupervisorEvent::AiClaimedDone | SupervisorEvent::VerifyEntered => p1_provoke_gate(context),
    }
}

pub fn build_supervisor_prompt(
    context: &SupervisorContext,
) -> Result<String, SupervisorDropReason> {
    let context_json =
        serde_json::to_string(context).map_err(|_| SupervisorDropReason::ContextTooLarge)?;
    if context_json.len() > SUPERVISOR_PROMPT_MAX_BYTES {
        return Err(SupervisorDropReason::ContextTooLarge);
    }
    Ok(format!(
        concat!(
            "You are DIVE's dedicated SupervisorAgent for a novice coding workflow.\n",
            "You are a one-shot evaluator. You have no tools, no filesystem access, ",
            "no process access, no resource discovery, no long-term memory, and no shared ",
            "main-agent session.\n",
            "DIVE has already built deterministic evidence for this review event. ",
            "Return exactly one JSON object matching SupervisorDecision schemaVersion=1. ",
            "Use only evidenceRefIds and suggestedActionIds present in the context. ",
            "{} ",
            "Never suggest continue_with_risk, verification_deferred, dismiss, or mark_irrelevant. ",
            "Ask one criterion-linked Korean question within 140 characters.\n\n",
            "SupervisorContext JSON:\n",
            "{}"
        ),
        prompt_action_instruction(context.event),
        context_json
    ))
}

fn prompt_action_instruction(event: SupervisorEvent) -> &'static str {
    match event {
        SupervisorEvent::ScopeExpansion => {
            "Suggested actions may only be link_criterion, split_scope, edit_prd, or dismiss_review."
        }
        SupervisorEvent::AiClaimedDone | SupervisorEvent::VerifyEntered => {
            "Suggested actions may only be open_diff, open_preview, run_tests, or run_app."
        }
    }
}

pub fn build_stage_c_supervisor_decision(context: &SupervisorContext) -> SupervisorDecision {
    let artifact_label = bounded_artifact_label(&context.artifact_ref.label);
    let question = format!(
        "AI는 '{artifact_label}' 완료를 보고했지만, 직접 확인한 증거가 아직 없습니다. 변경 내용이나 실행 결과로 목표와 맞는지 볼 수 있나요?"
    );
    SupervisorDecision {
        schema_version: SUPERVISOR_SCHEMA_VERSION,
        provoke: true,
        concern: P1_CONCERN.to_string(),
        severity: "caution".to_string(),
        question,
        evidence_ref_ids: sorted_evidence_ids(&context.evidence_refs),
        suggested_action_ids: context
            .allowed_action_ids
            .iter()
            .map(|action| action.as_str().to_string())
            .collect(),
        supervision_habit: Some("AI의 말과 직접 본 증거를 구분합니다.".to_string()),
        log_rationale: Some("Stage C supervisor evaluation shell decision".to_string()),
    }
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
            Self::DismissReview => "dismiss_review",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::OpenDiff => "변경 보기",
            Self::OpenPreview => "미리보기 열기",
            Self::RunTests => "테스트 실행",
            Self::RunApp => "앱 실행",
            Self::LinkCriterion => "기준 연결",
            Self::SplitScope => "범위 나누기",
            Self::EditPrd => "PRD 수정",
            Self::DismissReview => "닫기",
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
        };
        context.context_hash = context.compute_context_hash();
        context
    }

    pub fn with_scope_expansion(mut self, scope_expansion: ScopeExpansionAssessment) -> Self {
        self.scope_expansion = Some(scope_expansion);
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

    fn evidence_by_id(&self) -> HashMap<&str, &EvidenceRef> {
        self.evidence_refs
            .iter()
            .map(|evidence| (evidence.id.as_str(), evidence))
            .collect()
    }

    fn allowed_action_set(&self) -> HashSet<&'static str> {
        self.allowed_action_ids
            .iter()
            .map(|action| action.as_str())
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorDecision {
    pub schema_version: u8,
    pub provoke: bool,
    pub concern: String,
    pub severity: String,
    pub question: String,
    pub evidence_ref_ids: Vec<String>,
    #[serde(default)]
    pub suggested_action_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supervision_habit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_rationale: Option<String>,
}

pub fn parse_supervisor_decision(raw: &str) -> Result<SupervisorDecision, SupervisorDropReason> {
    serde_json::from_str::<SupervisorDecision>(raw).map_err(|_| SupervisorDropReason::ParseError)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupervisorDropReason {
    ProvokeFalse,
    RuntimeUnavailable,
    Timeout,
    SidecarError,
    ParseError,
    SchemaVersionUnsupported,
    InvalidMode,
    MissingEvidence,
    UnknownEvidenceRef,
    NotQuestion,
    UnknownAction,
    DisallowedConcern,
    Duplicate,
    Cooldown,
    AmbiguousDecision,
    ContextTooLarge,
    ContentTooLong,
}

impl SupervisorDropReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ProvokeFalse => "provoke_false",
            Self::RuntimeUnavailable => "runtime_unavailable",
            Self::Timeout => "timeout",
            Self::SidecarError => "sidecar_error",
            Self::ParseError => "parse_error",
            Self::SchemaVersionUnsupported => "schema_version_unsupported",
            Self::InvalidMode => "invalid_mode",
            Self::MissingEvidence => "missing_evidence",
            Self::UnknownEvidenceRef => "unknown_evidence_ref",
            Self::NotQuestion => "not_question",
            Self::UnknownAction => "unknown_action",
            Self::DisallowedConcern => "disallowed_concern",
            Self::Duplicate => "duplicate",
            Self::Cooldown => "cooldown",
            Self::AmbiguousDecision => "ambiguous_decision",
            Self::ContextTooLarge => "context_too_large",
            Self::ContentTooLong => "content_too_long",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupervisorValidationOutcome {
    Shown,
    #[serde(rename = "none")]
    NoCard,
    Dropped,
    Error,
}

impl SupervisorValidationOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shown => "shown",
            Self::NoCard => "none",
            Self::Dropped => "dropped",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorDecisionSummary {
    pub provoke: bool,
    pub concern: String,
    pub severity: String,
    pub evidence_ref_ids: Vec<String>,
    pub suggested_action_ids: Vec<String>,
    pub stripped_action_ids: Vec<String>,
}

impl SupervisorDecisionSummary {
    fn from_decision(decision: &SupervisorDecision, stripped_action_ids: Vec<String>) -> Self {
        Self {
            provoke: decision.provoke,
            concern: decision.concern.clone(),
            severity: decision.severity.clone(),
            evidence_ref_ids: decision.evidence_ref_ids.clone(),
            suggested_action_ids: decision.suggested_action_ids.clone(),
            stripped_action_ids,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorValidationResult {
    pub validation_outcome: SupervisorValidationOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drop_reason: Option<SupervisorDropReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stripped_action_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision_summary: Option<SupervisorDecisionSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub card: Option<ProvocationCard>,
}

impl SupervisorValidationResult {
    fn shown(
        card: ProvocationCard,
        stripped_action_ids: Vec<String>,
        decision_summary: SupervisorDecisionSummary,
    ) -> Self {
        Self {
            validation_outcome: SupervisorValidationOutcome::Shown,
            drop_reason: None,
            card_id: Some(card.id.clone()),
            stripped_action_ids,
            decision_summary: Some(decision_summary),
            card: Some(card),
        }
    }

    fn none(
        drop_reason: SupervisorDropReason,
        decision_summary: Option<SupervisorDecisionSummary>,
    ) -> Self {
        Self {
            validation_outcome: SupervisorValidationOutcome::NoCard,
            drop_reason: Some(drop_reason),
            card_id: None,
            stripped_action_ids: Vec::new(),
            decision_summary,
            card: None,
        }
    }

    fn dropped(
        drop_reason: SupervisorDropReason,
        decision_summary: Option<SupervisorDecisionSummary>,
    ) -> Self {
        Self {
            validation_outcome: SupervisorValidationOutcome::Dropped,
            drop_reason: Some(drop_reason),
            card_id: None,
            stripped_action_ids: Vec::new(),
            decision_summary,
            card: None,
        }
    }

    fn error(drop_reason: SupervisorDropReason) -> Self {
        Self {
            validation_outcome: SupervisorValidationOutcome::Error,
            drop_reason: Some(drop_reason),
            card_id: None,
            stripped_action_ids: Vec::new(),
            decision_summary: None,
            card: None,
        }
    }
}

pub fn no_card_validation_result(drop_reason: SupervisorDropReason) -> SupervisorValidationResult {
    SupervisorValidationResult::none(drop_reason, None)
}

pub fn dropped_validation_result(drop_reason: SupervisorDropReason) -> SupervisorValidationResult {
    SupervisorValidationResult::dropped(drop_reason, None)
}

pub fn error_validation_result(drop_reason: SupervisorDropReason) -> SupervisorValidationResult {
    SupervisorValidationResult::error(drop_reason)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorEvaluationLog {
    pub schema_version: u8,
    pub event: SupervisorEvent,
    pub artifact_ref: ArtifactRef,
    pub context_hash: String,
    pub evidence_hash: String,
    pub mode: SupervisorMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_ui_mode: Option<SourceUiMode>,
    pub evidence_refs: Vec<EvidenceRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supervisor_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision_summary: Option<SupervisorDecisionSummary>,
    pub validation_outcome: SupervisorValidationOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drop_reason: Option<SupervisorDropReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_response: Option<Value>,
}

impl SupervisorEvaluationLog {
    pub fn from_validation(
        context: &SupervisorContext,
        source_ui_mode: Option<SourceUiMode>,
        validation: &SupervisorValidationResult,
        supervisor_model: Option<String>,
        latency_ms: Option<u64>,
        usage: Option<Value>,
    ) -> Self {
        Self {
            schema_version: SUPERVISOR_SCHEMA_VERSION,
            event: context.event,
            artifact_ref: context.artifact_ref.clone(),
            context_hash: context.context_hash.clone(),
            evidence_hash: context.evidence_hash(),
            mode: context.mode,
            source_ui_mode,
            evidence_refs: context.evidence_refs.clone(),
            supervisor_model,
            latency_ms,
            usage,
            decision_summary: validation.decision_summary.clone(),
            validation_outcome: validation.validation_outcome,
            drop_reason: validation.drop_reason,
            card_id: validation.card_id.clone(),
            user_response: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SupervisorDedupKey {
    artifact_kind: String,
    artifact_id: String,
    concern: String,
    evidence_hash: String,
}

impl SupervisorDedupKey {
    pub fn new(context: &SupervisorContext, concern: &str, evidence_hash: &str) -> Self {
        Self {
            artifact_kind: context.artifact_ref.kind.clone(),
            artifact_id: context.artifact_ref.id.clone(),
            concern: concern.to_string(),
            evidence_hash: evidence_hash.to_string(),
        }
    }
}

#[derive(Debug, Default)]
pub struct SupervisorDedupState {
    shown: HashSet<SupervisorDedupKey>,
}

impl SupervisorDedupState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn remember_if_new(&mut self, key: SupervisorDedupKey) -> bool {
        self.shown.insert(key)
    }
}

pub fn deterministic_card_id(
    context: &SupervisorContext,
    concern: &str,
    evidence_hash: &str,
) -> String {
    format!(
        "provocation:{}:{}:{}",
        context.artifact_ref.id, concern, evidence_hash
    )
}

pub fn validate_supervisor_decision_json(
    context: &SupervisorContext,
    raw: &str,
    dedup: &mut SupervisorDedupState,
) -> SupervisorValidationResult {
    match parse_supervisor_decision(raw) {
        Ok(decision) => validate_supervisor_decision(context, decision, dedup),
        Err(reason) => SupervisorValidationResult::error(reason),
    }
}

pub fn validate_supervisor_decision(
    context: &SupervisorContext,
    decision: SupervisorDecision,
    dedup: &mut SupervisorDedupState,
) -> SupervisorValidationResult {
    let empty_summary = SupervisorDecisionSummary::from_decision(&decision, Vec::new());

    if decision.schema_version != SUPERVISOR_SCHEMA_VERSION {
        return SupervisorValidationResult::dropped(
            SupervisorDropReason::SchemaVersionUnsupported,
            Some(empty_summary),
        );
    }

    if !decision.provoke {
        return SupervisorValidationResult::none(
            SupervisorDropReason::ProvokeFalse,
            Some(empty_summary),
        );
    }

    if context.event == SupervisorEvent::ScopeExpansion
        && !context
            .scope_expansion
            .as_ref()
            .is_some_and(|assessment| assessment.expanded)
    {
        return SupervisorValidationResult::dropped(
            SupervisorDropReason::MissingEvidence,
            Some(empty_summary),
        );
    }

    if decision.concern != expected_concern_for_event(context.event) {
        return SupervisorValidationResult::dropped(
            SupervisorDropReason::DisallowedConcern,
            Some(empty_summary),
        );
    }

    if decision.evidence_ref_ids.is_empty() {
        return SupervisorValidationResult::dropped(
            SupervisorDropReason::MissingEvidence,
            Some(empty_summary),
        );
    }

    let known_evidence = context.evidence_by_id();
    if decision
        .evidence_ref_ids
        .iter()
        .any(|id| !is_well_formed_evidence_id(id) || !known_evidence.contains_key(id.as_str()))
    {
        return SupervisorValidationResult::dropped(
            SupervisorDropReason::UnknownEvidenceRef,
            Some(empty_summary),
        );
    }

    if !is_question(&decision.question) {
        return SupervisorValidationResult::dropped(
            SupervisorDropReason::NotQuestion,
            Some(empty_summary),
        );
    }

    if decision.question.chars().count() > QUESTION_MAX_CHARS {
        return SupervisorValidationResult::dropped(
            SupervisorDropReason::ContentTooLong,
            Some(empty_summary),
        );
    }

    let (accepted_action_ids, stripped_action_ids) =
        strip_unavailable_or_disallowed_actions(&decision.suggested_action_ids, context);
    let decision_summary =
        SupervisorDecisionSummary::from_decision(&decision, stripped_action_ids.clone());
    if context.event == SupervisorEvent::ScopeExpansion && accepted_action_ids.is_empty() {
        return SupervisorValidationResult::dropped(
            SupervisorDropReason::UnknownAction,
            Some(decision_summary),
        );
    }
    let evidence_hash = context.evidence_hash();
    let dedup_key = SupervisorDedupKey::new(context, &decision.concern, &evidence_hash);
    if !dedup.remember_if_new(dedup_key) {
        return SupervisorValidationResult::dropped(
            SupervisorDropReason::Duplicate,
            Some(decision_summary),
        );
    }

    let card_id = deterministic_card_id(context, &decision.concern, &evidence_hash);
    let card = map_decision_to_card_at(
        context,
        &decision,
        &accepted_action_ids,
        &card_id,
        &evidence_hash,
        None,
        DEFAULT_CARD_CREATED_AT,
    );
    SupervisorValidationResult::shown(card, stripped_action_ids, decision_summary)
}

fn expected_concern_for_event(event: SupervisorEvent) -> &'static str {
    match event {
        SupervisorEvent::ScopeExpansion => SCOPE_EXPANSION_CONCERN,
        SupervisorEvent::AiClaimedDone | SupervisorEvent::VerifyEntered => P1_CONCERN,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProvocationCardType {
    AiSelfReportOnly,
    ScopeExpansion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProvocationCardStage {
    Extend,
    Verify,
    FinalApproval,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProvocationSeverity {
    Caution,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvocationEvidence {
    pub ref_id: String,
    pub label: String,
    pub source: EvidenceSource,
    pub kind: EvidenceKind,
    pub verification_evidence: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvocationAction {
    pub id: String,
    pub kind: SupervisorActionId,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requires_reason: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvocationCard {
    pub id: String,
    #[serde(rename = "type")]
    pub card_type: ProvocationCardType,
    pub stage: ProvocationCardStage,
    pub severity: ProvocationSeverity,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    pub message: String,
    pub evidence: Vec<ProvocationEvidence>,
    pub actions: Vec<ProvocationAction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_action_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode_copy: Option<BTreeMap<String, String>>,
    pub metadata: Value,
    pub created_at: String,
}

#[allow(clippy::too_many_arguments)]
pub fn map_decision_to_card_at(
    context: &SupervisorContext,
    decision: &SupervisorDecision,
    accepted_action_ids: &[SupervisorActionId],
    card_id: &str,
    evidence_hash: &str,
    supervisor_evaluation_id: Option<&str>,
    created_at: &str,
) -> ProvocationCard {
    let evidence_by_id = context.evidence_by_id();
    let evidence = decision
        .evidence_ref_ids
        .iter()
        .filter_map(|id| evidence_by_id.get(id.as_str()).copied())
        .take(CARD_EVIDENCE_CAP)
        .map(|evidence| ProvocationEvidence {
            ref_id: evidence.id.clone(),
            label: evidence.label.clone(),
            source: evidence.source,
            kind: evidence.kind,
            verification_evidence: evidence.verification_evidence,
        })
        .collect::<Vec<_>>();

    let actions = accepted_action_ids
        .iter()
        .take(CARD_ACTION_CAP)
        .map(|action| ProvocationAction {
            id: action.as_str().to_string(),
            kind: *action,
            label: action.label().to_string(),
            requires_reason: None,
            reason_prompt: None,
        })
        .collect::<Vec<_>>();

    let primary_action_id = actions.first().map(|action| action.id.clone());
    let mode_copy = decision.supervision_habit.as_ref().and_then(|habit| {
        if habit.chars().count() <= SUPERVISION_HABIT_MAX_CHARS {
            Some(BTreeMap::from([("guided".to_string(), habit.clone())]))
        } else {
            None
        }
    });

    let mut metadata = serde_json::Map::new();
    metadata.insert(
        "contextHash".to_string(),
        json!(context.context_hash.clone()),
    );
    metadata.insert("evidenceHash".to_string(), json!(evidence_hash));
    metadata.insert("concern".to_string(), json!(decision.concern.clone()));
    metadata.insert(
        "validationOutcome".to_string(),
        json!(SupervisorValidationOutcome::Shown),
    );
    if let Some(evaluation_id) = supervisor_evaluation_id {
        metadata.insert("supervisorEvaluationId".to_string(), json!(evaluation_id));
    }

    ProvocationCard {
        id: card_id.to_string(),
        card_type: card_type_for_event(context.event),
        stage: card_stage_for_event(context.event),
        severity: ProvocationSeverity::Caution,
        title: card_title_for_event(context.event).to_string(),
        prompt: Some(decision.question.clone()),
        message: card_message_for_event(context.event).to_string(),
        evidence,
        actions,
        primary_action_id,
        mode_copy,
        metadata: Value::Object(metadata),
        created_at: created_at.to_string(),
    }
}

fn card_type_for_event(event: SupervisorEvent) -> ProvocationCardType {
    match event {
        SupervisorEvent::ScopeExpansion => ProvocationCardType::ScopeExpansion,
        SupervisorEvent::AiClaimedDone | SupervisorEvent::VerifyEntered => {
            ProvocationCardType::AiSelfReportOnly
        }
    }
}

fn card_stage_for_event(event: SupervisorEvent) -> ProvocationCardStage {
    match event {
        SupervisorEvent::ScopeExpansion => ProvocationCardStage::Extend,
        SupervisorEvent::AiClaimedDone | SupervisorEvent::VerifyEntered => {
            ProvocationCardStage::Verify
        }
    }
}

fn card_title_for_event(event: SupervisorEvent) -> &'static str {
    match event {
        SupervisorEvent::ScopeExpansion => "검토 카드",
        SupervisorEvent::AiClaimedDone | SupervisorEvent::VerifyEntered => "확인 필요 카드",
    }
}

fn card_message_for_event(event: SupervisorEvent) -> &'static str {
    match event {
        SupervisorEvent::ScopeExpansion => {
            "추가하려는 단계가 PRD 범위를 넓히는지 근거와 함께 확인하세요."
        }
        SupervisorEvent::AiClaimedDone | SupervisorEvent::VerifyEntered => {
            "확인 가능한 증거를 먼저 살펴보세요."
        }
    }
}

fn strip_unavailable_or_disallowed_actions(
    suggested_action_ids: &[String],
    context: &SupervisorContext,
) -> (Vec<SupervisorActionId>, Vec<String>) {
    let allowed = context.allowed_action_set();
    let mut accepted = Vec::new();
    let mut seen_accepted = HashSet::new();
    let mut stripped = Vec::new();

    for id in suggested_action_ids {
        match SupervisorActionId::from_str(id) {
            Ok(action) if allowed.contains(action.as_str()) => {
                if seen_accepted.insert(action) {
                    accepted.push(action);
                }
            }
            _ => stripped.push(id.clone()),
        }
    }

    (accepted, stripped)
}

fn sorted_evidence_ids(evidence_refs: &[EvidenceRef]) -> Vec<String> {
    let mut ids = evidence_refs
        .iter()
        .map(|evidence| evidence.id.clone())
        .collect::<Vec<_>>();
    ids.sort();
    ids
}

fn stable_sha256(value: &Value) -> String {
    let bytes = serde_json::to_vec(value).expect("stable supervisor hash value must serialize");
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{:x}", hasher.finalize())
}

fn is_question(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.ends_with('?')
        || trimmed.ends_with('？')
        || trimmed.ends_with("나요")
        || trimmed.ends_with("까요")
        || trimmed.ends_with("습니까")
}

fn is_well_formed_evidence_id(value: &str) -> bool {
    let mut saw_dot = false;
    let mut last_was_dot = false;
    for ch in value.chars() {
        let ok = ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' || ch == '.';
        if !ok {
            return false;
        }
        if ch == '.' {
            saw_dot = true;
            if last_was_dot {
                return false;
            }
            last_was_dot = true;
        } else {
            last_was_dot = false;
        }
    }
    saw_dot && !last_was_dot
}

fn bounded_artifact_label(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "이 단계".to_string();
    }
    let mut label = trimmed.chars().take(32).collect::<String>();
    if trimmed.chars().count() > 32 {
        label.push_str("...");
    }
    label
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_context_with_event(event: SupervisorEvent) -> SupervisorContext {
        SupervisorContext::new(
            event,
            ArtifactRef::step("step-3", "Add todo item form"),
            SupervisorMode::Work,
            "ko-KR",
            vec![SupervisorActionId::OpenDiff],
            "사용자가 할 일 앱 입력 폼을 완성하려고 함",
            PlanSummary {
                step_count: 4,
                active_step: Some("입력 폼 구현".to_string()),
            },
            VerificationState {
                ai_self_report: true,
                concrete_evidence: false,
                test_result: Some(TestResult::Skipped),
            },
            VerificationFeasibility {
                runnable: false,
                previewable: false,
                has_tests: false,
                diff_available: true,
            },
            vec![
                EvidenceRef::test_result_skipped(),
                EvidenceRef::assistant_claim(),
            ],
        )
    }

    fn sample_scope_expansion_context() -> SupervisorContext {
        let assessment = ScopeExpansionAssessment {
            expanded: true,
            reason_codes: vec!["missing_criterion_link".into(), "new_scope_area".into()],
            evidence_refs: vec!["add_step.title".into(), "prd.ac_001".into()],
        };
        SupervisorContext::new(
            SupervisorEvent::ScopeExpansion,
            ArtifactRef::add_step_draft("draft-1", "Add analytics dashboard"),
            SupervisorMode::Work,
            "ko-KR",
            vec![
                SupervisorActionId::LinkCriterion,
                SupervisorActionId::SplitScope,
                SupervisorActionId::EditPrd,
                SupervisorActionId::DismissReview,
            ],
            "사용자가 대시보드를 추가하려고 함",
            PlanSummary {
                step_count: 4,
                active_step: Some("로그인 플로우 구현".to_string()),
            },
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
            vec![
                EvidenceRef::add_step_draft("add_step.title", "Analytics dashboard"),
                EvidenceRef::acceptance_criterion("prd.ac_001", "로그인 폼 기준"),
                EvidenceRef::scope_expansion_reason(
                    assessment.reason_codes.clone(),
                    assessment.evidence_refs.clone(),
                ),
            ],
        )
        .with_scope_expansion(assessment)
    }

    fn valid_decision() -> SupervisorDecision {
        SupervisorDecision {
            schema_version: SUPERVISOR_SCHEMA_VERSION,
            provoke: true,
            concern: P1_CONCERN.to_string(),
            severity: "risk".to_string(),
            question:
                "AI는 완료됐다고 했지만, 변경된 파일을 확인해 실제 목표와 맞는지 볼 수 있나요?"
                    .to_string(),
            evidence_ref_ids: vec![
                "agent.assistant_claim".to_string(),
                "verify.test_result".to_string(),
            ],
            suggested_action_ids: vec!["open_diff".to_string()],
            supervision_habit: Some("AI의 말과 직접 본 증거를 구분합니다.".to_string()),
            log_rationale: Some("완료 주장은 있으나 독립 검증 증거가 없음".to_string()),
        }
    }

    fn valid_scope_expansion_decision() -> SupervisorDecision {
        SupervisorDecision {
            schema_version: SUPERVISOR_SCHEMA_VERSION,
            provoke: true,
            concern: SCOPE_EXPANSION_CONCERN.to_string(),
            severity: "caution".to_string(),
            question: "이 새 단계가 기존 PRD 기준과 연결되는지 먼저 확인할까요?".to_string(),
            evidence_ref_ids: vec![
                "add_step.title".to_string(),
                "prd.ac_001".to_string(),
                "scope.assessment".to_string(),
            ],
            suggested_action_ids: vec![
                "link_criterion".to_string(),
                "split_scope".to_string(),
                "edit_prd".to_string(),
            ],
            supervision_habit: Some("새 범위는 PRD 기준과 연결합니다.".to_string()),
            log_rationale: Some("Add-step draft has no clear criterion link".to_string()),
        }
    }

    fn scope_evidence_input(
        id: &str,
        label: &str,
        value_summary: Value,
    ) -> ScopeExpansionEvidenceRefInput {
        ScopeExpansionEvidenceRefInput {
            id: id.to_string(),
            source: None,
            kind: None,
            label: Some(label.to_string()),
            value_summary,
            verification_evidence: true,
        }
    }

    #[test]
    fn supervisor_records_ai_claimed_done_as_non_verification_evidence_only() {
        let mut evidence_refs = Vec::new();
        record_ai_claimed_done_evidence(&mut evidence_refs, true);
        record_ai_claimed_done_evidence(&mut evidence_refs, true);

        assert_eq!(evidence_refs.len(), 1);
        assert_eq!(evidence_refs[0].id, "agent.assistant_claim");
        assert_eq!(evidence_refs[0].kind, EvidenceKind::AssistantClaim);
        assert!(!evidence_refs[0].verification_evidence);
    }

    #[test]
    fn supervisor_builds_context_from_ui_state_with_canonical_work_mode() {
        let input = SupervisorContextBuildInput {
            event: SupervisorEvent::VerifyEntered,
            artifact_ref: ArtifactRef::step("step-3", "Add todo item form"),
            source_ui_mode: SourceUiMode::Expert,
            locale: "".to_string(),
            goal_summary: "Add todo item form".to_string(),
            plan_summary: PlanSummary {
                step_count: 4,
                active_step: Some("입력 폼 구현".to_string()),
            },
            verification: SupervisorVerificationUiState {
                ai_claimed_done: true,
                diff_reviewed: false,
                app_launched: false,
                preview_checked: false,
                automated_tests_passed: false,
                test_result: Some(TestResult::Skipped),
                acceptance_criterion_confirmed: false,
                manual_checks: vec![],
            },
            feasibility: VerificationFeasibility {
                runnable: false,
                previewable: false,
                has_tests: false,
                diff_available: true,
            },
        };

        let result = build_supervisor_context_from_ui(input);

        assert_eq!(result.source_ui_mode, SourceUiMode::Expert);
        assert_eq!(result.context.mode, SupervisorMode::Work);
        assert_eq!(result.context.locale, "ko-KR");
        assert_eq!(
            result.context.allowed_action_ids,
            vec![SupervisorActionId::OpenDiff]
        );
        assert!(result.context.verification_state.ai_self_report);
        assert!(!result.context.verification_state.concrete_evidence);
        assert!(result
            .context
            .evidence_refs
            .iter()
            .any(|evidence| evidence.id == "agent.assistant_claim"));
    }

    #[test]
    fn supervisor_p1_gate_fires_only_for_verify_self_report_without_concrete_evidence() {
        let mut context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        assert!(p1_provoke_gate(&context));
        assert!(supervisor_provoke_gate(&context));

        context.verification_state.concrete_evidence = true;
        context.context_hash = context.compute_context_hash();
        assert!(!p1_provoke_gate(&context));
        assert!(!supervisor_provoke_gate(&context));

        context.verification_state.concrete_evidence = false;
        context.verification_state.ai_self_report = false;
        context.context_hash = context.compute_context_hash();
        assert!(!p1_provoke_gate(&context));
        assert!(!supervisor_provoke_gate(&context));

        let claimed = sample_context_with_event(SupervisorEvent::AiClaimedDone);
        assert!(!p1_provoke_gate(&claimed));
        assert!(!supervisor_provoke_gate(&claimed));

        let mut scope = sample_scope_expansion_context();
        assert!(supervisor_provoke_gate(&scope));
        scope.scope_expansion.as_mut().unwrap().expanded = false;
        scope.context_hash = scope.compute_context_hash();
        assert!(!supervisor_provoke_gate(&scope));
    }

    #[test]
    fn supervisor_concrete_evidence_requires_pass_or_observation_linked_to_criterion() {
        let base = SupervisorVerificationUiState {
            ai_claimed_done: true,
            diff_reviewed: false,
            app_launched: false,
            preview_checked: false,
            automated_tests_passed: false,
            test_result: Some(TestResult::Skipped),
            acceptance_criterion_confirmed: false,
            manual_checks: vec![],
        };

        let mut diff_only = base.clone();
        diff_only.diff_reviewed = true;
        assert!(!diff_only.has_concrete_evidence());

        let mut preview_click_only = base.clone();
        preview_click_only.preview_checked = true;
        assert!(!preview_click_only.has_concrete_evidence());

        let mut criterion_preview = preview_click_only;
        criterion_preview.acceptance_criterion_confirmed = true;
        assert!(criterion_preview.has_concrete_evidence());

        let mut failed_test = base.clone();
        failed_test.test_result = Some(TestResult::Fail);
        failed_test.acceptance_criterion_confirmed = true;
        failed_test.preview_checked = true;
        assert!(!failed_test.has_concrete_evidence());

        let mut passed_test = base;
        passed_test.test_result = Some(TestResult::Pass);
        assert!(passed_test.has_concrete_evidence());
    }

    #[test]
    fn supervisor_computes_feasibility_from_project_state() {
        let feasibility = compute_verification_feasibility(ProjectStateFeasibilityInput {
            runnable_target_available: true,
            preview_target_available: false,
            test_command: Some(" pnpm test ".to_string()),
            changed_file_count: 2,
        });

        assert_eq!(
            feasibility,
            VerificationFeasibility {
                runnable: true,
                previewable: false,
                has_tests: true,
                diff_available: true,
            }
        );

        let infeasible = compute_verification_feasibility(ProjectStateFeasibilityInput {
            runnable_target_available: false,
            preview_target_available: false,
            test_command: Some("   ".to_string()),
            changed_file_count: 0,
        });
        assert_eq!(
            allowed_actions_for_p1(&infeasible),
            Vec::<SupervisorActionId>::new()
        );
    }

    #[test]
    fn supervisor_stage_c_shell_decision_validates_through_domain_mapping() {
        let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let decision = build_stage_c_supervisor_decision(&context);
        assert_eq!(decision.concern, P1_CONCERN);
        assert_eq!(decision.suggested_action_ids, vec!["open_diff"]);

        let mut dedup = SupervisorDedupState::new();
        let result = validate_supervisor_decision(&context, decision, &mut dedup);
        assert_eq!(
            result.validation_outcome,
            SupervisorValidationOutcome::Shown
        );
        assert_eq!(
            result.card.as_ref().map(|card| card.title.as_str()),
            Some("확인 필요 카드")
        );
    }

    #[test]
    fn supervisor_prompt_contains_only_bounded_context_and_json_instruction() {
        let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let prompt = build_supervisor_prompt(&context).unwrap();

        assert!(prompt.contains("Return exactly one JSON object"));
        assert!(prompt.contains("\"schemaVersion\":1"));
        assert!(!prompt.contains("\"enabledTools\""));
        assert!(!prompt.contains("dive_context"));
        assert!(!prompt.contains("AGENTS.md"));
        assert!(!prompt.contains(".specify"));
    }

    #[test]
    fn supervisor_mode_normalization_maps_legacy_inputs() {
        let guided = normalize_source_ui_mode("guided").unwrap();
        assert_eq!(guided.mode, SupervisorMode::Guided);
        assert_eq!(guided.source_ui_mode, SourceUiMode::Guided);

        let work = normalize_source_ui_mode("work").unwrap();
        assert_eq!(work.mode, SupervisorMode::Work);
        assert_eq!(work.source_ui_mode, SourceUiMode::Work);

        let standard = normalize_source_ui_mode("standard").unwrap();
        assert_eq!(standard.mode, SupervisorMode::Work);
        assert_eq!(standard.source_ui_mode, SourceUiMode::Standard);

        let expert = normalize_source_ui_mode("expert").unwrap();
        assert_eq!(expert.mode, SupervisorMode::Work);
        assert_eq!(expert.source_ui_mode, SourceUiMode::Expert);
    }

    #[test]
    fn supervisor_unknown_mode_returns_invalid_mode_drop() {
        assert_eq!(
            normalize_source_ui_mode("solo"),
            Err(SupervisorDropReason::InvalidMode)
        );
        let result = invalid_mode_validation_result();
        assert_eq!(
            result.validation_outcome,
            SupervisorValidationOutcome::Dropped
        );
        assert_eq!(result.drop_reason, Some(SupervisorDropReason::InvalidMode));
    }

    #[test]
    fn supervisor_outcome_and_drop_reason_serialize_to_contract_values() {
        assert_eq!(
            serde_json::to_value(SupervisorValidationOutcome::NoCard).unwrap(),
            json!("none")
        );
        assert_eq!(
            serde_json::to_value(SupervisorValidationOutcome::Shown).unwrap(),
            json!("shown")
        );
        assert_eq!(
            serde_json::to_value(SupervisorDropReason::UnknownEvidenceRef).unwrap(),
            json!("unknown_evidence_ref")
        );
        assert_eq!(
            SupervisorDropReason::UnknownAction.as_str(),
            "unknown_action"
        );
        assert_eq!(
            serde_json::to_value(SupervisorEvent::ScopeExpansion).unwrap(),
            json!("scope_expansion")
        );
        assert_eq!(
            serde_json::to_value(SupervisorActionId::LinkCriterion).unwrap(),
            json!("link_criterion")
        );
    }

    #[test]
    fn supervisor_scope_expansion_context_carries_assessment_and_hashes() {
        let context = sample_scope_expansion_context();

        assert_eq!(context.event, SupervisorEvent::ScopeExpansion);
        assert_eq!(context.artifact_ref.kind, "add_step_draft");
        assert_eq!(
            context
                .scope_expansion
                .as_ref()
                .map(|assessment| assessment.expanded),
            Some(true)
        );
        assert_eq!(
            context
                .allowed_action_ids
                .iter()
                .map(|action| action.as_str())
                .collect::<Vec<_>>(),
            vec![
                "link_criterion",
                "split_scope",
                "edit_prd",
                "dismiss_review"
            ]
        );
        assert!(context.context_hash.starts_with("sha256:"));
        assert!(context.evidence_hash().starts_with("sha256:"));
    }

    #[test]
    fn supervisor_builds_scope_expansion_context_from_add_step_evidence() {
        let assessment = ScopeExpansionAssessment {
            expanded: true,
            reason_codes: vec!["missing_criterion_link".into(), "new_scope_area".into()],
            evidence_refs: vec![
                "step.linkedCriterionIds".into(),
                "prdDelta.scopeChanges[0]".into(),
            ],
        };
        let result =
            build_scope_expansion_supervisor_context(ScopeExpansionSupervisorContextBuildInput {
                artifact_ref: ArtifactRef::add_step_draft("draft-1", "Add analytics dashboard"),
                source_ui_mode: SourceUiMode::Expert,
                locale: "".to_string(),
                goal_summary: "Keep the MVP to login and settings".to_string(),
                plan_summary: PlanSummary {
                    step_count: 3,
                    active_step: Some("Settings form".to_string()),
                },
                allowed_action_ids: vec![
                    SupervisorActionId::LinkCriterion,
                    SupervisorActionId::RunTests,
                    SupervisorActionId::SplitScope,
                    SupervisorActionId::LinkCriterion,
                ],
                evidence_refs: vec![
                    scope_evidence_input(
                        "step.title",
                        "Add analytics dashboard",
                        json!("Add analytics dashboard"),
                    ),
                    scope_evidence_input(
                        "AC-001",
                        "Users can sign in",
                        json!({ "criterionId": "AC-001", "text": "Users can sign in" }),
                    ),
                    scope_evidence_input(
                        "prdDelta.scopeChanges[0]",
                        "Analytics dashboard",
                        json!({ "scopeChange": "Analytics dashboard" }),
                    ),
                ],
                scope_expansion: assessment,
            });
        let context = result.context;

        assert_eq!(result.source_ui_mode, SourceUiMode::Expert);
        assert_eq!(context.mode, SupervisorMode::Work);
        assert_eq!(context.locale, "ko-KR");
        assert_eq!(
            context.allowed_action_ids,
            vec![
                SupervisorActionId::LinkCriterion,
                SupervisorActionId::SplitScope,
            ]
        );
        let evidence_ids = context
            .evidence_refs
            .iter()
            .map(|evidence| evidence.id.as_str())
            .collect::<Vec<_>>();
        assert!(evidence_ids.contains(&"add_step.title"));
        assert!(evidence_ids.contains(&"prd.ac_001"));
        assert!(evidence_ids.contains(&"add_step.linked_criterion_ids"));
        assert!(evidence_ids.contains(&"prd_delta.scope_changes_0"));
        assert!(evidence_ids.contains(&"scope.assessment"));
        assert!(context
            .evidence_refs
            .iter()
            .all(|evidence| !evidence.verification_evidence));
        assert_eq!(
            context.scope_expansion.as_ref().unwrap().evidence_refs,
            vec![
                "add_step.linked_criterion_ids".to_string(),
                "prd_delta.scope_changes_0".to_string()
            ]
        );
    }

    #[test]
    fn supervisor_scope_expansion_validator_maps_valid_card() {
        let context = sample_scope_expansion_context();
        let mut dedup = SupervisorDedupState::new();
        let result =
            validate_supervisor_decision(&context, valid_scope_expansion_decision(), &mut dedup);

        assert_eq!(
            result.validation_outcome,
            SupervisorValidationOutcome::Shown
        );
        let card = result.card.unwrap();
        assert_eq!(card.card_type, ProvocationCardType::ScopeExpansion);
        assert_eq!(card.stage, ProvocationCardStage::Extend);
        assert_eq!(card.title, "검토 카드");
        assert_eq!(card.evidence.len(), CARD_EVIDENCE_CAP);
        assert_eq!(
            card.actions
                .iter()
                .map(|action| action.id.as_str())
                .collect::<Vec<_>>(),
            vec!["link_criterion", "split_scope", "edit_prd"]
        );
        assert_eq!(card.metadata["concern"], json!("scope_expansion"));
    }

    #[test]
    fn supervisor_scope_expansion_prompt_limits_actions_to_review_nudges() {
        let context = sample_scope_expansion_context();
        let prompt = build_supervisor_prompt(&context).unwrap();

        assert!(prompt.contains("link_criterion, split_scope, edit_prd, or dismiss_review"));
        assert!(!prompt.contains("open_diff, open_preview, run_tests, or run_app"));
    }

    #[test]
    fn supervisor_scope_expansion_validator_drops_invalid_evidence_and_missing_assessment() {
        let context = sample_scope_expansion_context();
        let mut unknown = valid_scope_expansion_decision();
        unknown.evidence_ref_ids = vec!["prd.ac_missing".to_string()];
        let mut dedup = SupervisorDedupState::new();
        let result = validate_supervisor_decision(&context, unknown, &mut dedup);
        assert_eq!(
            result.drop_reason,
            Some(SupervisorDropReason::UnknownEvidenceRef)
        );

        let missing_assessment = SupervisorContext::new(
            SupervisorEvent::ScopeExpansion,
            ArtifactRef::add_step_draft("draft-1", "Add analytics dashboard"),
            SupervisorMode::Work,
            "ko-KR",
            vec![SupervisorActionId::LinkCriterion],
            "goal",
            PlanSummary {
                step_count: 1,
                active_step: None,
            },
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
            vec![EvidenceRef::add_step_draft(
                "add_step.title",
                "Analytics dashboard",
            )],
        );
        let result = validate_supervisor_decision(
            &missing_assessment,
            valid_scope_expansion_decision(),
            &mut SupervisorDedupState::new(),
        );
        assert_eq!(
            result.drop_reason,
            Some(SupervisorDropReason::MissingEvidence)
        );
    }

    #[test]
    fn supervisor_scope_expansion_filters_actions_and_deduplicates() {
        let context = sample_scope_expansion_context();
        let mut decision = valid_scope_expansion_decision();
        decision.suggested_action_ids = vec![
            "link_criterion".into(),
            "continue_with_risk".into(),
            "run_tests".into(),
            "dismiss_review".into(),
        ];
        let mut dedup = SupervisorDedupState::new();
        let first = validate_supervisor_decision(&context, decision.clone(), &mut dedup);
        assert_eq!(first.validation_outcome, SupervisorValidationOutcome::Shown);
        assert_eq!(
            first.stripped_action_ids,
            vec!["continue_with_risk".to_string(), "run_tests".to_string()]
        );

        let second = validate_supervisor_decision(&context, decision, &mut dedup);
        assert_eq!(
            second.validation_outcome,
            SupervisorValidationOutcome::Dropped
        );
        assert_eq!(second.drop_reason, Some(SupervisorDropReason::Duplicate));
    }

    #[test]
    fn supervisor_scope_expansion_drops_when_no_valid_action_remains() {
        let context = sample_scope_expansion_context();
        let mut decision = valid_scope_expansion_decision();
        decision.suggested_action_ids = vec![
            "continue_with_risk".into(),
            "run_tests".into(),
            "verification_deferred".into(),
        ];
        let result =
            validate_supervisor_decision(&context, decision, &mut SupervisorDedupState::new());

        assert_eq!(
            result.validation_outcome,
            SupervisorValidationOutcome::Dropped
        );
        assert_eq!(
            result.drop_reason,
            Some(SupervisorDropReason::UnknownAction)
        );
        assert!(result.card.is_none());
    }

    #[test]
    fn supervisor_scope_expansion_disallows_p1_concern() {
        let context = sample_scope_expansion_context();
        let mut decision = valid_scope_expansion_decision();
        decision.concern = P1_CONCERN.to_string();
        let result =
            validate_supervisor_decision(&context, decision, &mut SupervisorDedupState::new());
        assert_eq!(
            result.drop_reason,
            Some(SupervisorDropReason::DisallowedConcern)
        );
    }

    #[test]
    fn supervisor_context_hash_excludes_free_text_and_evidence_hash_excludes_event() {
        let mut first = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let mut second = sample_context_with_event(SupervisorEvent::VerifyEntered);
        second.goal_summary = "different bounded text".to_string();
        second.plan_summary.active_step = Some("different active step".to_string());
        second.context_hash = second.compute_context_hash();
        assert_eq!(first.context_hash, second.context_hash);

        second.verification_state.concrete_evidence = true;
        second.context_hash = second.compute_context_hash();
        assert_ne!(first.context_hash, second.context_hash);

        let evidence_hash = first.evidence_hash();
        first.event = SupervisorEvent::AiClaimedDone;
        first.context_hash = first.compute_context_hash();
        assert_eq!(evidence_hash, first.evidence_hash());
    }

    #[test]
    fn supervisor_evidence_hash_changes_when_sanitized_summary_changes() {
        let first = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let mut second = sample_context_with_event(SupervisorEvent::VerifyEntered);
        second.evidence_refs[0].value_summary = json!({ "kind": "enum", "value": "pass" });
        assert_ne!(first.evidence_hash(), second.evidence_hash());
    }

    #[test]
    fn supervisor_card_id_and_dedup_key_ignore_event() {
        let verify = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let claimed = sample_context_with_event(SupervisorEvent::AiClaimedDone);
        let verify_id = deterministic_card_id(&verify, P1_CONCERN, &verify.evidence_hash());
        let claimed_id = deterministic_card_id(&claimed, P1_CONCERN, &claimed.evidence_hash());
        assert_eq!(verify_id, claimed_id);
    }

    #[test]
    fn supervisor_validator_shows_valid_question_and_maps_p1_card() {
        let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let mut dedup = SupervisorDedupState::new();
        let result = validate_supervisor_decision(&context, valid_decision(), &mut dedup);
        assert_eq!(
            result.validation_outcome,
            SupervisorValidationOutcome::Shown
        );
        assert!(result
            .card_id
            .as_deref()
            .unwrap()
            .starts_with("provocation:step-3:ai_self_report_only:sha256:"));

        let card = result.card.unwrap();
        assert_eq!(card.card_type, ProvocationCardType::AiSelfReportOnly);
        assert_eq!(card.severity, ProvocationSeverity::Caution);
        assert_eq!(card.title, "확인 필요 카드");
        assert_ne!(card.title, "도발카드");
        assert_eq!(card.evidence.len(), 2);
        assert_eq!(card.actions.len(), 1);
        assert_eq!(card.primary_action_id.as_deref(), Some("open_diff"));
        assert_eq!(card.metadata["contextHash"], json!(context.context_hash));
        assert_eq!(
            card.metadata["evidenceHash"],
            json!(context.evidence_hash())
        );
    }

    #[test]
    fn supervisor_validator_strips_unknown_and_decision_gate_actions_without_dropping() {
        let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let mut decision = valid_decision();
        decision.suggested_action_ids = vec![
            "open_diff".to_string(),
            "continue_with_risk".to_string(),
            "verification_deferred".to_string(),
            "dismiss".to_string(),
            "run_tests".to_string(),
        ];
        let mut dedup = SupervisorDedupState::new();
        let result = validate_supervisor_decision(&context, decision, &mut dedup);
        assert_eq!(
            result.validation_outcome,
            SupervisorValidationOutcome::Shown
        );
        assert_eq!(
            result.stripped_action_ids,
            vec![
                "continue_with_risk".to_string(),
                "verification_deferred".to_string(),
                "dismiss".to_string(),
                "run_tests".to_string()
            ]
        );
        let card = result.card.unwrap();
        assert_eq!(card.actions.len(), 1);
        assert_eq!(card.actions[0].id, "open_diff");
    }

    #[test]
    fn supervisor_validator_rejects_proceed_actions_as_suggestions() {
        let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let mut decision = valid_decision();
        decision.suggested_action_ids = vec![
            "continue_with_risk".to_string(),
            "verification_deferred".to_string(),
        ];
        let mut dedup = SupervisorDedupState::new();
        let result = validate_supervisor_decision(&context, decision, &mut dedup);

        assert_eq!(
            result.validation_outcome,
            SupervisorValidationOutcome::Shown
        );
        assert_eq!(
            result.stripped_action_ids,
            vec![
                "continue_with_risk".to_string(),
                "verification_deferred".to_string(),
            ]
        );
        assert!(result.card.unwrap().actions.is_empty());
    }

    #[test]
    fn supervisor_validator_drops_unsupported_schema_and_disallowed_concern() {
        let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let mut dedup = SupervisorDedupState::new();

        let mut unsupported = valid_decision();
        unsupported.schema_version = 2;
        let result = validate_supervisor_decision(&context, unsupported, &mut dedup);
        assert_eq!(
            result.drop_reason,
            Some(SupervisorDropReason::SchemaVersionUnsupported)
        );

        let mut disallowed = valid_decision();
        disallowed.concern = "diff_scope_drift".to_string();
        let result = validate_supervisor_decision(&context, disallowed, &mut dedup);
        assert_eq!(
            result.drop_reason,
            Some(SupervisorDropReason::DisallowedConcern)
        );
    }

    #[test]
    fn supervisor_validator_drops_unknown_evidence_ref() {
        let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let mut decision = valid_decision();
        decision.evidence_ref_ids = vec!["agent.invented_claim".to_string()];
        let mut dedup = SupervisorDedupState::new();
        let result = validate_supervisor_decision(&context, decision, &mut dedup);
        assert_eq!(
            result.validation_outcome,
            SupervisorValidationOutcome::Dropped
        );
        assert_eq!(
            result.drop_reason,
            Some(SupervisorDropReason::UnknownEvidenceRef)
        );
    }

    #[test]
    fn supervisor_validator_drops_malformed_evidence_ref() {
        let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let mut decision = valid_decision();
        decision.evidence_ref_ids = vec!["Agent Bad Ref".to_string()];
        let mut dedup = SupervisorDedupState::new();
        let result = validate_supervisor_decision(&context, decision, &mut dedup);
        assert_eq!(
            result.drop_reason,
            Some(SupervisorDropReason::UnknownEvidenceRef)
        );
    }

    #[test]
    fn supervisor_validator_drops_missing_evidence() {
        let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let mut decision = valid_decision();
        decision.evidence_ref_ids = Vec::new();
        let mut dedup = SupervisorDedupState::new();
        let result = validate_supervisor_decision(&context, decision, &mut dedup);
        assert_eq!(
            result.drop_reason,
            Some(SupervisorDropReason::MissingEvidence)
        );
    }

    #[test]
    fn supervisor_validator_drops_non_question_and_overlong_question() {
        let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let mut non_question = valid_decision();
        non_question.question = "AI가 완료됐다고 했지만 변경 파일을 확인하세요.".to_string();
        let mut dedup = SupervisorDedupState::new();
        let result = validate_supervisor_decision(&context, non_question, &mut dedup);
        assert_eq!(result.drop_reason, Some(SupervisorDropReason::NotQuestion));

        let mut long_question = valid_decision();
        long_question.question = format!("{}?", "확인".repeat(80));
        let result = validate_supervisor_decision(&context, long_question, &mut dedup);
        assert_eq!(
            result.drop_reason,
            Some(SupervisorDropReason::ContentTooLong)
        );
    }

    #[test]
    fn supervisor_validator_dedups_same_artifact_concern_and_evidence_hash() {
        let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let mut dedup = SupervisorDedupState::new();
        let first = validate_supervisor_decision(&context, valid_decision(), &mut dedup);
        assert_eq!(first.validation_outcome, SupervisorValidationOutcome::Shown);

        let second = validate_supervisor_decision(&context, valid_decision(), &mut dedup);
        assert_eq!(
            second.validation_outcome,
            SupervisorValidationOutcome::Dropped
        );
        assert_eq!(second.drop_reason, Some(SupervisorDropReason::Duplicate));
    }

    #[test]
    fn supervisor_validator_handles_provoke_false_as_none() {
        let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let mut decision = valid_decision();
        decision.provoke = false;
        let mut dedup = SupervisorDedupState::new();
        let result = validate_supervisor_decision(&context, decision, &mut dedup);
        assert_eq!(
            result.validation_outcome,
            SupervisorValidationOutcome::NoCard
        );
        assert_eq!(result.drop_reason, Some(SupervisorDropReason::ProvokeFalse));
    }

    #[test]
    fn supervisor_parse_error_uses_error_outcome() {
        let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let mut dedup = SupervisorDedupState::new();
        let result = validate_supervisor_decision_json(&context, "{not json", &mut dedup);
        assert_eq!(
            result.validation_outcome,
            SupervisorValidationOutcome::Error
        );
        assert_eq!(result.drop_reason, Some(SupervisorDropReason::ParseError));
    }

    #[test]
    fn supervisor_card_mapping_caps_evidence_and_actions() {
        let mut context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        context.allowed_action_ids = vec![
            SupervisorActionId::OpenDiff,
            SupervisorActionId::OpenPreview,
            SupervisorActionId::RunTests,
            SupervisorActionId::RunApp,
        ];
        context.evidence_refs = vec![
            EvidenceRef::assistant_claim(),
            EvidenceRef::test_result_skipped(),
            EvidenceRef::diff_reviewed(),
            EvidenceRef::preview_observed(),
        ];
        context.context_hash = context.compute_context_hash();

        let mut decision = valid_decision();
        decision.evidence_ref_ids = vec![
            "agent.assistant_claim".to_string(),
            "verify.test_result".to_string(),
            "diff.reviewed".to_string(),
            "verify.preview_observed".to_string(),
        ];
        decision.suggested_action_ids = vec![
            "open_diff".to_string(),
            "open_preview".to_string(),
            "run_tests".to_string(),
            "run_app".to_string(),
        ];

        let mut dedup = SupervisorDedupState::new();
        let result = validate_supervisor_decision(&context, decision, &mut dedup);
        let card = result.card.unwrap();
        assert_eq!(card.evidence.len(), CARD_EVIDENCE_CAP);
        assert_eq!(card.actions.len(), CARD_ACTION_CAP);
        assert_eq!(
            card.actions
                .iter()
                .map(|action| action.id.as_str())
                .collect::<Vec<_>>(),
            vec!["open_diff", "open_preview", "run_tests"]
        );
    }

    #[test]
    fn supervisor_overlong_habit_is_omitted_not_dropped() {
        let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let mut decision = valid_decision();
        decision.supervision_habit = Some("습관".repeat(40));
        let mut dedup = SupervisorDedupState::new();
        let result = validate_supervisor_decision(&context, decision, &mut dedup);
        assert_eq!(
            result.validation_outcome,
            SupervisorValidationOutcome::Shown
        );
        assert!(result.card.unwrap().mode_copy.is_none());
    }

    #[test]
    fn supervisor_evaluation_log_uses_canonical_mode_and_outcome() {
        let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
        let mut dedup = SupervisorDedupState::new();
        let result = validate_supervisor_decision(&context, valid_decision(), &mut dedup);
        let log = SupervisorEvaluationLog::from_validation(
            &context,
            Some(SourceUiMode::Standard),
            &result,
            Some("openai-codex/gpt-5.4-mini".to_string()),
            Some(812),
            None,
        );
        let value = serde_json::to_value(log).unwrap();
        assert_eq!(value["mode"], json!("work"));
        assert_eq!(value["sourceUiMode"], json!("standard"));
        assert_eq!(value["validationOutcome"], json!("shown"));
        assert_eq!(value["evidenceHash"], json!(context.evidence_hash()));
        assert_eq!(value["decisionSummary"]["severity"], json!("risk"));
    }
}
