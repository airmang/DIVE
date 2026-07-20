use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::db::models::ScopeExpansionAssessment;

use super::*;

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

    pub fn plan_draft(id: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            kind: "plan_draft".to_string(),
            id: id.into(),
            label: label.into(),
        }
    }

    pub fn diff(id: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            kind: "diff".to_string(),
            id: id.into(),
            label: label.into(),
        }
    }

    pub fn failure(id: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            kind: "failure".to_string(),
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
    PlanDraftAssessment,
    VerificationCoverage,
    CriterionLinkage,
    BroadStep,
    ExpectedFile,
    StepScope,
    DiffView,
    DiffReadyAssessment,
    FailureSummary,
    RecoveryState,
    RetryLoopAssessment,
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
            Self::PlanDraftAssessment => "plan_draft_assessment",
            Self::VerificationCoverage => "verification_coverage",
            Self::CriterionLinkage => "criterion_linkage",
            Self::BroadStep => "broad_step",
            Self::ExpectedFile => "expected_file",
            Self::StepScope => "step_scope",
            Self::DiffView => "diff_view",
            Self::DiffReadyAssessment => "diff_ready_assessment",
            Self::FailureSummary => "failure_summary",
            Self::RecoveryState => "recovery_state",
            Self::RetryLoopAssessment => "retry_loop_assessment",
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
            label: "변경 내용 확인".to_string(),
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
            label: "테스트 결과".to_string(),
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

pub type SupervisorEvidenceRefInput = ScopeExpansionEvidenceRefInput;

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
    if let Some(result) = verification.test_result {
        let mut evidence = EvidenceRef::test_result(result);
        evidence.verification_evidence =
            verification.effective_executed_test_result() == Some(TestResult::Pass);
        evidence_refs.push(evidence);
    } else if verification.automated_tests_passed && verification.has_executed_test_command() {
        evidence_refs.push(EvidenceRef::test_result(TestResult::Pass));
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

pub fn build_expanded_evidence_refs(input_refs: &[SupervisorEvidenceRefInput]) -> Vec<EvidenceRef> {
    let mut evidence_refs = Vec::new();
    for input in input_refs {
        push_unique_evidence_ref(&mut evidence_refs, expanded_evidence_from_input(input));
    }
    evidence_refs
}

fn expanded_evidence_from_input(input: &SupervisorEvidenceRefInput) -> EvidenceRef {
    let id = normalize_evidence_path(&input.id);
    EvidenceRef {
        id: if is_well_formed_evidence_id(&id) {
            id
        } else {
            format!("evidence.{}", scope_slug(&input.id))
        },
        source: evidence_source_from_input(input.source.as_deref()),
        kind: evidence_kind_from_input(input.kind.as_deref()),
        label: bounded_scope_label(
            input
                .label
                .as_deref()
                .filter(|label| !label.trim().is_empty())
                .unwrap_or("감독 근거"),
        ),
        value_summary: bounded_scope_value_summary(if input.value_summary.is_null() {
            json!({ "kind": "summary" })
        } else {
            input.value_summary.clone()
        }),
        verification_evidence: input.verification_evidence,
    }
}

fn evidence_source_from_input(value: Option<&str>) -> EvidenceSource {
    match value.unwrap_or_default() {
        "goal" => EvidenceSource::Goal,
        "plan" => EvidenceSource::Plan,
        "prompt" => EvidenceSource::Prompt,
        "diff" => EvidenceSource::Diff,
        "verification" => EvidenceSource::Verification,
        "terminal" => EvidenceSource::Terminal,
        "agent" => EvidenceSource::Agent,
        "workmap" => EvidenceSource::Workmap,
        "history" => EvidenceSource::History,
        "ui_observation" => EvidenceSource::UiObservation,
        _ => EvidenceSource::Workmap,
    }
}

fn evidence_kind_from_input(value: Option<&str>) -> EvidenceKind {
    match value.unwrap_or_default() {
        "assistant_claim" => EvidenceKind::AssistantClaim,
        "verify_log" => EvidenceKind::VerifyLog,
        "test_result" => EvidenceKind::TestResult,
        "diff_review" => EvidenceKind::DiffReview,
        "preview_observed" => EvidenceKind::PreviewObserved,
        "app_launched" => EvidenceKind::AppLaunched,
        "manual_check" => EvidenceKind::ManualCheck,
        "changed_file" => EvidenceKind::ChangedFile,
        "terminal_error" => EvidenceKind::TerminalError,
        "plan_step" => EvidenceKind::PlanStep,
        "acceptance_criteria" => EvidenceKind::AcceptanceCriteria,
        "prd_scope" => EvidenceKind::PrdScope,
        "add_step_draft" => EvidenceKind::AddStepDraft,
        "scope_expansion_assessment" => EvidenceKind::ScopeExpansionAssessment,
        "plan_draft_assessment" => EvidenceKind::PlanDraftAssessment,
        "verification_coverage" => EvidenceKind::VerificationCoverage,
        "criterion_linkage" => EvidenceKind::CriterionLinkage,
        "broad_step" => EvidenceKind::BroadStep,
        "expected_file" => EvidenceKind::ExpectedFile,
        "step_scope" => EvidenceKind::StepScope,
        "diff_view" => EvidenceKind::DiffView,
        "diff_ready_assessment" => EvidenceKind::DiffReadyAssessment,
        "failure_summary" => EvidenceKind::FailureSummary,
        "recovery_state" => EvidenceKind::RecoveryState,
        "retry_loop_assessment" => EvidenceKind::RetryLoopAssessment,
        "retry_count" => EvidenceKind::RetryCount,
        _ => EvidenceKind::ScopeExpansionAssessment,
    }
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

pub fn sorted_evidence_ids(evidence_refs: &[EvidenceRef]) -> Vec<String> {
    let mut ids = evidence_refs
        .iter()
        .map(|evidence| evidence.id.clone())
        .collect::<Vec<_>>();
    ids.sort();
    ids
}

pub fn is_well_formed_evidence_id(value: &str) -> bool {
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
