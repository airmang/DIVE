use std::collections::HashSet;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::*;

pub fn invalid_mode_validation_result() -> SupervisorValidationResult {
    SupervisorValidationResult::dropped(SupervisorDropReason::InvalidMode, None)
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
        SupervisorEvent::PlanDrafted => {
            context
                .plan_draft_assessment
                .as_ref()
                .is_some_and(|assessment| {
                    assessment.eligible
                        && !assessment.reason_codes.is_empty()
                        && !assessment.evidence_refs.is_empty()
                })
        }
        SupervisorEvent::DiffReady => {
            context
                .diff_ready_assessment
                .as_ref()
                .is_some_and(|assessment| {
                    assessment.eligible
                        && assessment.changed_file_count > 0
                        && !assessment.reason_codes.is_empty()
                        && !assessment.evidence_refs.is_empty()
                })
        }
        SupervisorEvent::RetryLoop => {
            context
                .retry_loop_assessment
                .as_ref()
                .is_some_and(|assessment| {
                    assessment.eligible
                        && assessment.failure_count >= 2
                        && !assessment.failure_fingerprint.trim().is_empty()
                        && !assessment.evidence_refs.is_empty()
                        && context.verification_state.test_result != Some(TestResult::Pass)
                })
        }
        SupervisorEvent::AiClaimedDone | SupervisorEvent::VerifyEntered => p1_provoke_gate(context),
    }
}

pub fn build_stage_c_supervisor_decision(context: &SupervisorContext) -> SupervisorDecision {
    let artifact_label = bounded_artifact_label(&context.artifact_ref.label);
    let question = if locale_is_english(&context.locale) {
        format!(
            "The AI reported '{artifact_label}' as done, but there is no evidence you've checked yourself yet. Can you confirm it matches the goal from the changes or the run result?"
        )
    } else {
        format!(
            "AI는 '{artifact_label}' 완료를 보고했지만, 직접 확인한 증거가 아직 없습니다. 변경 내용이나 실행 결과로 목표와 맞는지 볼 수 있나요?"
        )
    };
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
        supervision_habit: Some(if locale_is_english(&context.locale) {
            "Tell apart what the AI says from evidence you've seen yourself.".to_string()
        } else {
            "AI의 말과 직접 본 증거를 구분합니다.".to_string()
        }),
        log_rationale: Some("Stage C supervisor evaluation shell decision".to_string()),
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
    // Defense-in-depth: if the model wraps its object in a markdown ```json
    // fence or a short prose preamble, slice from the first `{` to the last `}`
    // before deserializing. The primary reliability fix is build_supervisor_prompt
    // spelling out the exact key set; this just keeps an otherwise-valid object
    // from being lost to incidental wrapping. Malformed output still fails to parse.
    let json = extract_json_object(raw).unwrap_or(raw);
    serde_json::from_str::<SupervisorDecision>(json).map_err(|_| SupervisorDropReason::ParseError)
}

/// Return the substring spanning the outermost JSON object (`{` … `}`), if any.
fn extract_json_object(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    (start <= end).then(|| &raw[start..=end])
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assessment_summary: Option<Value>,
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
            assessment_summary: assessment_summary_for_context(context),
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

    if requires_supervisor_assessment(context.event) && !supervisor_provoke_gate(context) {
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
    if requires_supervisor_assessment(context.event) && accepted_action_ids.is_empty() {
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

pub fn expected_concern_for_event(event: SupervisorEvent) -> &'static str {
    match event {
        SupervisorEvent::ScopeExpansion => SCOPE_EXPANSION_CONCERN,
        SupervisorEvent::PlanDrafted => PLAN_DRAFT_CONCERN,
        SupervisorEvent::DiffReady => DIFF_READY_CONCERN,
        SupervisorEvent::RetryLoop => RETRY_LOOP_CONCERN,
        SupervisorEvent::AiClaimedDone | SupervisorEvent::VerifyEntered => P1_CONCERN,
    }
}

fn requires_supervisor_assessment(event: SupervisorEvent) -> bool {
    matches!(
        event,
        SupervisorEvent::ScopeExpansion
            | SupervisorEvent::PlanDrafted
            | SupervisorEvent::DiffReady
            | SupervisorEvent::RetryLoop
    )
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

pub fn is_question(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.ends_with('?')
        || trimmed.ends_with('？')
        || trimmed.ends_with("나요")
        || trimmed.ends_with("까요")
        || trimmed.ends_with("습니까")
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
