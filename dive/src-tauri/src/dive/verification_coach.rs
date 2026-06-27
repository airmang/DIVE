use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VerificationCoachStatus {
    Shown,
    Unavailable,
    Dropped,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VerificationCheckKind {
    Preview,
    AppRun,
    Terminal,
    File,
    Diff,
    Test,
    Manual,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ObservationEvidenceKind {
    ManualObservation,
    PreviewObservation,
    AppRunObservation,
    TerminalObservation,
    FileObservation,
    TestObservation,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GuidanceValidationOutcome {
    Valid,
    Dropped,
    Unavailable,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GuidanceReasonCode {
    Ok,
    ProviderNotConfigured,
    MissingCredentials,
    MissingProjectRoot,
    ProviderNotSupported,
    RuntimeUnavailable,
    SidecarUnavailable,
    SidecarError,
    Timeout,
    MalformedOutput,
    GenericGuidance,
    UnsupportedEvidence,
    UnsafeAction,
    MissingCriterion,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationCriterion {
    pub criterion_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationCoachStep {
    pub title: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub instruction: Option<String>,
    #[serde(default)]
    pub acceptance_criteria: Vec<VerificationCriterion>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriorObservationEvidence {
    pub observation_id: String,
    #[serde(default)]
    pub guide_version: Option<u32>,
    #[serde(default)]
    pub criterion_ids: Vec<String>,
    pub evidence_kind: ObservationEvidenceKind,
    pub observation_text: String,
    #[serde(default)]
    pub recorded_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationCoachEvidence {
    #[serde(default)]
    pub changed_files: Vec<String>,
    #[serde(default)]
    pub verification_kind: Option<String>,
    #[serde(default)]
    pub verification_command: Option<String>,
    #[serde(default)]
    pub verification_manual_check: Option<String>,
    #[serde(default)]
    pub test_result: Option<String>,
    #[serde(default)]
    pub ai_claimed_done: bool,
    #[serde(default)]
    pub preview_available: bool,
    #[serde(default)]
    pub app_run_available: bool,
    #[serde(default)]
    pub diff_available: bool,
    #[serde(default)]
    pub prior_observations: Vec<PriorObservationEvidence>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationCoachGenerateRequest {
    pub session_id: i64,
    #[serde(default)]
    pub project_id: Option<i64>,
    pub card_id: i64,
    #[serde(default)]
    pub plan_step_id: Option<i64>,
    #[serde(default)]
    pub guide_version: Option<u32>,
    pub source_ui_mode: String,
    #[serde(default)]
    pub locale: Option<String>,
    pub step: VerificationCoachStep,
    pub evidence: VerificationCoachEvidence,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerificationRecommendedCheck {
    pub kind: VerificationCheckKind,
    pub label: String,
    pub instruction: String,
    pub expected_observation: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerificationGuide {
    pub criterion_summary: String,
    #[serde(default)]
    pub recommended_checks: Vec<VerificationRecommendedCheck>,
    #[serde(default)]
    pub expected_observations: Vec<String>,
    #[serde(default)]
    pub evidence_prompts: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GuidanceValidationResult {
    pub outcome: GuidanceValidationOutcome,
    pub reason_code: GuidanceReasonCode,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerificationFallbackGuidance {
    pub criterion_id: String,
    pub classes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationCoachGenerateResponse {
    pub status: VerificationCoachStatus,
    pub event_id: String,
    pub guide_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guide: Option<VerificationGuide>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fallback_guidance: Vec<VerificationFallbackGuidance>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<GuidanceValidationResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drop_reason: Option<GuidanceReasonCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationEvidenceInput {
    pub session_id: i64,
    pub card_id: i64,
    #[serde(default)]
    pub plan_step_id: Option<i64>,
    #[serde(default)]
    pub guide_version: Option<u32>,
    pub evidence_kind: ObservationEvidenceKind,
    #[serde(default)]
    pub criterion_ids: Vec<String>,
    pub observation_text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationEvidenceRecord {
    pub session_id: i64,
    pub card_id: i64,
    #[serde(default)]
    pub plan_step_id: Option<i64>,
    #[serde(default)]
    pub guide_version: Option<u32>,
    pub evidence_kind: ObservationEvidenceKind,
    pub criterion_ids: Vec<String>,
    pub observation_text: String,
    pub observation_id: String,
    pub recorded_at: i64,
}

pub fn next_guide_version(request: &VerificationCoachGenerateRequest) -> u32 {
    request.guide_version.unwrap_or(0).saturating_add(1).max(1)
}

pub fn evidence_summary(request: &VerificationCoachGenerateRequest) -> Value {
    json!({
        "criterionCount": request.step.acceptance_criteria.len(),
        "changedFileCount": request.evidence.changed_files.len(),
        "changedFiles": request.evidence.changed_files.iter().take(12).collect::<Vec<_>>(),
        "verificationKind": request.evidence.verification_kind,
        "verificationCommandPresent": request.evidence.verification_command.as_ref().is_some_and(|value| !value.trim().is_empty()),
        "verificationManualCheckPresent": request.evidence.verification_manual_check.as_ref().is_some_and(|value| !value.trim().is_empty()),
        "testResult": request.evidence.test_result,
        "aiClaimedDone": request.evidence.ai_claimed_done,
        "previewAvailable": request.evidence.preview_available,
        "appRunAvailable": request.evidence.app_run_available,
        "diffAvailable": request.evidence.diff_available,
        "priorObservationCount": request.evidence.prior_observations.len(),
    })
}

pub fn build_verification_coach_prompt(request: &VerificationCoachGenerateRequest) -> String {
    let locale = request.locale.as_deref().unwrap_or("ko-KR");
    let english =
        crate::dive::prompt_locale_is_english(request.locale.as_deref().unwrap_or("ko-KR"));
    let locale_clause = if english {
        format!(" Current user language: {locale}. Write criterionSummary, every recommendedChecks label/instruction/expectedObservation, every expectedObservations entry, and every evidencePrompts entry in that language. JSON keys stay in English.")
    } else {
        format!(" 현재 사용자 언어: {locale}. criterionSummary와 모든 recommendedChecks의 label/instruction/expectedObservation, expectedObservations, evidencePrompts를 그 언어로 작성하세요. JSON 키는 영어로 둡니다.")
    };
    let system_instruction = format!(
        "{}{}",
        "You are DIVE's verification coach. Generate concise JSON only. Explain how the student can verify the current real project step. Do not approve the step. Do not claim the step is done. Use only supplied evidence and safe inspection actions.",
        locale_clause
    );
    let context = json!({
        "step": request.step,
        "evidence": request.evidence,
        "sourceUiMode": request.source_ui_mode,
        "locale": locale,
    });
    format!(
        "{}\n\n{}\n{}",
        system_instruction,
        "Return shape: {\"criterionSummary\":\"...\",\"recommendedChecks\":[{\"kind\":\"terminal|file|diff|test|preview|app_run|manual\",\"label\":\"...\",\"instruction\":\"...\",\"expectedObservation\":\"...\"}],\"expectedObservations\":[\"...\"],\"evidencePrompts\":[\"...\"]}.",
        serde_json::to_string(&context).unwrap_or_else(|_| "{}".to_string())
    )
}

pub fn parse_guide_json(raw: &str) -> Result<VerificationGuide, GuidanceReasonCode> {
    serde_json::from_str::<VerificationGuide>(raw).map_err(|_| GuidanceReasonCode::MalformedOutput)
}

pub fn validate_guide(
    request: &VerificationCoachGenerateRequest,
    guide: &VerificationGuide,
) -> GuidanceValidationResult {
    if request.step.acceptance_criteria.is_empty() && guide.criterion_summary.trim().is_empty() {
        return dropped(GuidanceReasonCode::MissingCriterion);
    }
    if guide.recommended_checks.is_empty() {
        return dropped(GuidanceReasonCode::GenericGuidance);
    }
    if guide
        .recommended_checks
        .iter()
        .any(|check| check.label.trim().is_empty() || check.instruction.trim().is_empty())
    {
        return dropped(GuidanceReasonCode::GenericGuidance);
    }
    let combined = serde_json::to_string(guide)
        .unwrap_or_default()
        .to_lowercase();
    if contains_done_claim(&combined) {
        return dropped(GuidanceReasonCode::UnsupportedEvidence);
    }
    if contains_unsafe_action(&combined) {
        return dropped(GuidanceReasonCode::UnsafeAction);
    }
    let unsupported_command = guide.recommended_checks.iter().any(|check| {
        check.kind == VerificationCheckKind::Terminal
            && request
                .evidence
                .verification_command
                .as_ref()
                .filter(|command| !command.trim().is_empty())
                .is_none()
            && !is_safe_terminal_inspection(&check.instruction)
    });
    if unsupported_command {
        return dropped(GuidanceReasonCode::UnsupportedEvidence);
    }
    GuidanceValidationResult {
        outcome: GuidanceValidationOutcome::Valid,
        reason_code: GuidanceReasonCode::Ok,
        evidence_refs: evidence_refs(request),
    }
}

pub fn unavailable_response(
    event_id: String,
    guide_version: u32,
    reason: GuidanceReasonCode,
    request: &VerificationCoachGenerateRequest,
) -> VerificationCoachGenerateResponse {
    VerificationCoachGenerateResponse {
        status: VerificationCoachStatus::Unavailable,
        event_id,
        guide_version,
        guide: None,
        fallback_guidance: fallback_guidance(request),
        validation: Some(GuidanceValidationResult {
            outcome: GuidanceValidationOutcome::Unavailable,
            reason_code: reason.clone(),
            evidence_refs: Vec::new(),
        }),
        drop_reason: Some(reason),
        message: None,
        model: None,
        latency_ms: None,
    }
}

pub fn fallback_guidance(
    request: &VerificationCoachGenerateRequest,
) -> Vec<VerificationFallbackGuidance> {
    request
        .step
        .acceptance_criteria
        .iter()
        .map(|criterion| VerificationFallbackGuidance {
            criterion_id: criterion.criterion_id.clone(),
            classes: crate::dive::plan_quality_constants::criterion_classes(&criterion.text)
                .into_iter()
                .map(|class| class.as_str().to_string())
                .collect(),
        })
        .collect()
}

fn dropped(reason_code: GuidanceReasonCode) -> GuidanceValidationResult {
    GuidanceValidationResult {
        outcome: GuidanceValidationOutcome::Dropped,
        reason_code,
        evidence_refs: Vec::new(),
    }
}

fn evidence_refs(request: &VerificationCoachGenerateRequest) -> Vec<String> {
    let mut refs = request
        .step
        .acceptance_criteria
        .iter()
        .map(|criterion| format!("criterion:{}", criterion.criterion_id))
        .collect::<Vec<_>>();
    refs.extend(
        request
            .evidence
            .changed_files
            .iter()
            .take(8)
            .map(|path| format!("changed_file:{path}")),
    );
    if request.evidence.verification_command.is_some() {
        refs.push("verification_command".to_string());
    }
    if request.evidence.diff_available {
        refs.push("diff_available".to_string());
    }
    refs
}

fn contains_done_claim(value: &str) -> bool {
    [
        "step is complete",
        "work is complete",
        "verified complete",
        "완료되었습니다",
        "완료됐습니다",
    ]
    .iter()
    .any(|term| value.contains(term))
}

fn contains_unsafe_action(value: &str) -> bool {
    [
        "rm -rf",
        "sudo ",
        "curl ",
        "wget ",
        "chmod 777",
        "powershell -enc",
    ]
    .iter()
    .any(|term| value.contains(term))
}

fn is_safe_terminal_inspection(instruction: &str) -> bool {
    let lower = instruction.trim().to_lowercase();
    lower.starts_with("npm ")
        || lower.starts_with("pnpm ")
        || lower.starts_with("yarn ")
        || lower.starts_with("cargo ")
        || lower.starts_with("python ")
        || lower.starts_with("node ")
        || lower.starts_with("cat ")
        || lower.starts_with("ls ")
        || lower.starts_with("dir ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> VerificationCoachGenerateRequest {
        VerificationCoachGenerateRequest {
            session_id: 1,
            project_id: Some(7),
            card_id: 3,
            plan_step_id: Some(9),
            guide_version: None,
            source_ui_mode: "work".to_string(),
            locale: Some("ko-KR".to_string()),
            step: VerificationCoachStep {
                title: "캐릭터 생성 구현".to_string(),
                summary: Some("CLI character creation".to_string()),
                instruction: Some("Implement a saved character flow".to_string()),
                acceptance_criteria: vec![VerificationCriterion {
                    criterion_id: "AC-001".to_string(),
                    text: "플레이어가 캐릭터를 만들 수 있다.".to_string(),
                }],
            },
            evidence: VerificationCoachEvidence {
                changed_files: vec!["src/main.ts".to_string()],
                verification_kind: Some("command".to_string()),
                verification_command: Some("pnpm test".to_string()),
                verification_manual_check: None,
                test_result: Some("skipped".to_string()),
                ai_claimed_done: true,
                preview_available: false,
                app_run_available: false,
                diff_available: true,
                prior_observations: Vec::new(),
            },
        }
    }

    fn guide(kind: VerificationCheckKind, instruction: &str) -> VerificationGuide {
        VerificationGuide {
            criterion_summary: "플레이어가 캐릭터를 만들 수 있다.".to_string(),
            recommended_checks: vec![VerificationRecommendedCheck {
                kind,
                label: "검증 실행".to_string(),
                instruction: instruction.to_string(),
                expected_observation: "완료 기준이 출력으로 확인되어야 합니다.".to_string(),
            }],
            expected_observations: vec![],
            evidence_prompts: vec!["무엇을 관찰했나요?".to_string()],
        }
    }

    #[test]
    fn validates_grounded_terminal_guidance() {
        let result = validate_guide(
            &request(),
            &guide(VerificationCheckKind::Terminal, "pnpm test"),
        );

        assert_eq!(result.outcome, GuidanceValidationOutcome::Valid);
        assert_eq!(result.reason_code, GuidanceReasonCode::Ok);
        assert!(result
            .evidence_refs
            .contains(&"criterion:AC-001".to_string()));
        assert!(result
            .evidence_refs
            .contains(&"changed_file:src/main.ts".to_string()));
    }

    #[test]
    fn drops_generic_guidance_without_checks() {
        let result = validate_guide(
            &request(),
            &VerificationGuide {
                criterion_summary: "플레이어가 캐릭터를 만들 수 있다.".to_string(),
                recommended_checks: vec![],
                expected_observations: vec![],
                evidence_prompts: vec![],
            },
        );

        assert_eq!(result.outcome, GuidanceValidationOutcome::Dropped);
        assert_eq!(result.reason_code, GuidanceReasonCode::GenericGuidance);
    }

    #[test]
    fn drops_unsafe_guidance() {
        let result = validate_guide(
            &request(),
            &guide(VerificationCheckKind::Terminal, "sudo rm -rf /tmp/example"),
        );

        assert_eq!(result.outcome, GuidanceValidationOutcome::Dropped);
        assert_eq!(result.reason_code, GuidanceReasonCode::UnsafeAction);
    }

    #[test]
    fn drops_unsupported_terminal_command_when_no_command_evidence_exists() {
        let mut request = request();
        request.evidence.verification_command = None;

        let result = validate_guide(
            &request,
            &guide(VerificationCheckKind::Terminal, "bash deploy.sh"),
        );

        assert_eq!(result.outcome, GuidanceValidationOutcome::Dropped);
        assert_eq!(result.reason_code, GuidanceReasonCode::UnsupportedEvidence);
    }

    #[test]
    fn prompt_context_includes_cli_manual_no_preview_evidence() {
        let mut request = request();
        request.evidence.preview_available = false;
        request.evidence.app_run_available = false;
        request.evidence.verification_kind = Some("manual".to_string());
        request.evidence.verification_command = None;
        request.evidence.verification_manual_check = Some("Run the CLI and inspect output".into());

        let prompt = build_verification_coach_prompt(&request);

        assert!(prompt.contains("플레이어가 캐릭터를 만들 수 있다"));
        assert!(prompt.contains("Run the CLI and inspect output"));
        assert!(prompt.contains("src/main.ts"));
        assert!(prompt.contains("\"previewAvailable\":false"));
        assert!(prompt.contains("\"appRunAvailable\":false"));
    }

    #[test]
    fn prompt_value_language_clause_matches_locale() {
        let english_clause = "Current user language: en. Write criterionSummary, every recommendedChecks label/instruction/expectedObservation, every expectedObservations entry, and every evidencePrompts entry in that language. JSON keys stay in English.";
        let korean_clause = "현재 사용자 언어: ko. criterionSummary와 모든 recommendedChecks의 label/instruction/expectedObservation, expectedObservations, evidencePrompts를 그 언어로 작성하세요. JSON 키는 영어로 둡니다.";

        let mut english_request = request();
        english_request.locale = Some("en".to_string());
        let english_prompt = build_verification_coach_prompt(&english_request);

        assert!(english_prompt.contains(english_clause));
        assert!(!english_prompt.contains(korean_clause));

        let mut korean_request = request();
        korean_request.locale = Some("ko".to_string());
        let korean_prompt = build_verification_coach_prompt(&korean_request);

        assert!(korean_prompt.contains(korean_clause));
        assert!(!korean_prompt.contains(english_clause));
    }

    #[test]
    fn unavailable_response_includes_per_criterion_fallback_guidance() {
        let mut request = request();
        request.step.acceptance_criteria = vec![
            VerificationCriterion {
                criterion_id: "responsive".to_string(),
                text: "Resize to 375px and confirm the columns collapse".to_string(),
            },
            VerificationCriterion {
                criterion_id: "persistence".to_string(),
                text: "Reload and confirm the saved value persists".to_string(),
            },
            VerificationCriterion {
                criterion_id: "accessibility".to_string(),
                text: "Tab through the form and confirm ARIA labels".to_string(),
            },
            VerificationCriterion {
                criterion_id: "loading-empty-error".to_string(),
                text: "Show a loading spinner, empty state, and retryable error".to_string(),
            },
            VerificationCriterion {
                criterion_id: "generic".to_string(),
                text: "The success sound plays".to_string(),
            },
        ];

        let response = unavailable_response(
            "event-1".to_string(),
            2,
            GuidanceReasonCode::RuntimeUnavailable,
            &request,
        );

        assert_eq!(response.status, VerificationCoachStatus::Unavailable);
        assert!(response.guide.is_none());
        assert!(response.message.is_none());
        assert_eq!(response.fallback_guidance.len(), 5);
        assert_eq!(response.fallback_guidance[0].criterion_id, "responsive");
        assert_eq!(response.fallback_guidance[0].classes, vec!["responsive"]);
        assert_eq!(response.fallback_guidance[1].classes, vec!["persistence"]);
        assert_eq!(response.fallback_guidance[2].classes, vec!["accessibility"]);
        assert_eq!(
            response.fallback_guidance[3].classes,
            vec!["loading", "empty", "error"]
        );
        assert!(response.fallback_guidance[4].classes.is_empty());

        let serialized = serde_json::to_string(&response).expect("serializes response");
        assert!(!serialized.contains("현재 검증 안내를 만들 수 없습니다"));
    }
}
