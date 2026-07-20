use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::*;

/// Localize a provocation-card evidence chip label at card-build time.
///
/// Matches on the exact known Korean *chrome* strings produced by the
/// EvidenceRef constructors and `default_scope_evidence_label`, mapping each to
/// English. Anything else — caller-provided PRD criterion text, filenames, the
/// already-English `test_result` label — passes through unchanged, so this can
/// never overwrite real data with a generic label.
pub fn localized_evidence_label(fallback: &str, locale_english: bool) -> String {
    if !locale_english {
        return fallback.to_string();
    }
    let english = match fallback {
        "AI 완료 주장" => "AI completion claim",
        "변경 내용 확인" => "Diff reviewed",
        "테스트 결과" => "Test result",
        "프리뷰 확인" => "Preview observed",
        "앱 실행 확인" => "App launch verified",
        "수동 확인" => "Manual check",
        "범위 확장 평가" => "Scope expansion assessment",
        "연결된 PRD 기준" => "Linked PRD criteria",
        "예상 파일" => "Expected files",
        "추가 단계 제목" => "Added step title",
        "추가 단계 이유" => "Added step reason",
        "PRD 기준" => "PRD criteria",
        "PRD 범위 변경" => "PRD scope changes",
        "PRD 범위" => "PRD scope",
        "범위 확장 근거" => "Scope expansion evidence",
        _ => return fallback.to_string(),
    };
    english.to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProvocationCardType {
    AiSelfReportOnly,
    ScopeExpansion,
    PlanDraftReview,
    DiffScopeReview,
    RetryLoopReview,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProvocationCardStage {
    Instruct,
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
    let evidence_locale_english = locale_is_english(&context.locale);
    let evidence = decision
        .evidence_ref_ids
        .iter()
        .filter_map(|id| evidence_by_id.get(id.as_str()).copied())
        .take(CARD_EVIDENCE_CAP)
        .map(|evidence| ProvocationEvidence {
            ref_id: evidence.id.clone(),
            label: localized_evidence_label(&evidence.label, evidence_locale_english),
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
            label: action.label(locale_is_english(&context.locale)).to_string(),
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
    metadata.insert("supervisorEvent".to_string(), json!(context.event.as_str()));
    metadata.insert(
        "artifactRef".to_string(),
        json!(context.artifact_ref.clone()),
    );
    metadata.insert("concern".to_string(), json!(decision.concern.clone()));
    metadata.insert(
        "validationOutcome".to_string(),
        json!(SupervisorValidationOutcome::Shown),
    );
    if let Some(assessment) = assessment_summary_for_context(context) {
        metadata.insert("assessmentSummary".to_string(), assessment);
    }
    if let Some(evaluation_id) = supervisor_evaluation_id {
        metadata.insert("supervisorEvaluationId".to_string(), json!(evaluation_id));
    }

    ProvocationCard {
        id: card_id.to_string(),
        card_type: card_type_for_event(context.event),
        stage: card_stage_for_event(context.event),
        severity: ProvocationSeverity::Caution,
        title: card_title_for_event(context.event, &context.locale).to_string(),
        prompt: Some(decision.question.clone()),
        message: card_message_for_event(context.event, &context.locale).to_string(),
        evidence,
        actions,
        primary_action_id,
        mode_copy,
        metadata: Value::Object(metadata),
        created_at: created_at.to_string(),
    }
}

pub fn assessment_summary_for_context(context: &SupervisorContext) -> Option<Value> {
    match context.event {
        SupervisorEvent::PlanDrafted => context.plan_draft_assessment.as_ref().map(|assessment| {
            json!({
                "reasonCodes": assessment.reason_codes.clone(),
                "evidenceRefs": assessment.evidence_refs.clone(),
                "stepCount": assessment.step_count,
                "criteriaCount": assessment.criteria_count,
                "unverifiedStepIds": assessment.unverified_step_ids.clone(),
                "unlinkedStepIds": assessment.unlinked_step_ids.clone(),
            })
        }),
        SupervisorEvent::DiffReady => context.diff_ready_assessment.as_ref().map(|assessment| {
            json!({
                "reasonCodes": assessment.reason_codes.clone(),
                "evidenceRefs": assessment.evidence_refs.clone(),
                "changedFileCount": assessment.changed_file_count,
                "unexpectedFiles": assessment.unexpected_files.clone(),
                "highRiskFiles": assessment.high_risk_files.clone(),
                "diffViewed": assessment.diff_viewed,
            })
        }),
        SupervisorEvent::RetryLoop => context.retry_loop_assessment.as_ref().map(|assessment| {
            json!({
                "reasonCodes": assessment.reason_codes.clone(),
                "evidenceRefs": assessment.evidence_refs.clone(),
                "failureFingerprint": assessment.failure_fingerprint.clone(),
                "failureCount": assessment.failure_count,
                "lastFailureAt": assessment.last_failure_at.clone(),
                "lastActionSummary": assessment.last_action_summary.clone(),
                "recoveryAvailable": assessment.recovery_available,
            })
        }),
        SupervisorEvent::ScopeExpansion => context.scope_expansion.as_ref().map(|assessment| {
            json!({
                "expanded": assessment.expanded,
                "reasonCodes": assessment.reason_codes.clone(),
                "evidenceRefs": assessment.evidence_refs.clone(),
            })
        }),
        SupervisorEvent::AiClaimedDone | SupervisorEvent::VerifyEntered => None,
    }
}

fn card_type_for_event(event: SupervisorEvent) -> ProvocationCardType {
    match event {
        SupervisorEvent::ScopeExpansion => ProvocationCardType::ScopeExpansion,
        SupervisorEvent::PlanDrafted => ProvocationCardType::PlanDraftReview,
        SupervisorEvent::DiffReady => ProvocationCardType::DiffScopeReview,
        SupervisorEvent::RetryLoop => ProvocationCardType::RetryLoopReview,
        SupervisorEvent::AiClaimedDone | SupervisorEvent::VerifyEntered => {
            ProvocationCardType::AiSelfReportOnly
        }
    }
}

fn card_stage_for_event(event: SupervisorEvent) -> ProvocationCardStage {
    match event {
        SupervisorEvent::ScopeExpansion => ProvocationCardStage::Extend,
        SupervisorEvent::PlanDrafted => ProvocationCardStage::Instruct,
        SupervisorEvent::DiffReady | SupervisorEvent::RetryLoop => ProvocationCardStage::Verify,
        SupervisorEvent::AiClaimedDone | SupervisorEvent::VerifyEntered => {
            ProvocationCardStage::Verify
        }
    }
}

pub fn locale_is_english(locale: &str) -> bool {
    locale.trim().to_ascii_lowercase().starts_with("en")
}

pub fn card_title_for_event(event: SupervisorEvent, locale: &str) -> &'static str {
    let en = locale_is_english(locale);
    match event {
        SupervisorEvent::ScopeExpansion | SupervisorEvent::PlanDrafted => {
            if en {
                "Review card"
            } else {
                "검토 카드"
            }
        }
        SupervisorEvent::DiffReady
        | SupervisorEvent::RetryLoop
        | SupervisorEvent::AiClaimedDone
        | SupervisorEvent::VerifyEntered => {
            if en {
                "Needs verification"
            } else {
                "확인 필요 카드"
            }
        }
    }
}

pub fn card_message_for_event(event: SupervisorEvent, locale: &str) -> &'static str {
    let en = locale_is_english(locale);
    match event {
        SupervisorEvent::ScopeExpansion => {
            if en {
                "Check, with evidence, whether the step you're adding widens the PRD scope."
            } else {
                "추가하려는 단계가 PRD 범위를 넓히는지 근거와 함께 확인하세요."
            }
        }
        SupervisorEvent::PlanDrafted => {
            if en {
                "Before approving the plan, check that your judgment and verification evidence are enough."
            } else {
                "계획을 승인하기 전에 판단과 검증 근거가 충분한지 확인하세요."
            }
        }
        SupervisorEvent::DiffReady => {
            if en {
                "Check whether the changed files stay within the current goal and plan scope."
            } else {
                "변경된 파일이 현재 목표와 계획 범위 안에 있는지 확인하세요."
            }
        }
        SupervisorEvent::RetryLoop => {
            if en {
                "The same failure keeps repeating — before retrying, check reproduction, recovery, and scope."
            } else {
                "같은 실패가 반복되고 있으니 재시도 전에 재현·복구·범위를 확인하세요."
            }
        }
        SupervisorEvent::AiClaimedDone | SupervisorEvent::VerifyEntered => {
            if en {
                "Look at verifiable evidence first."
            } else {
                "확인 가능한 증거를 먼저 살펴보세요."
            }
        }
    }
}
