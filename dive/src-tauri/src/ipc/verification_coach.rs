use serde_json::json;
use tauri::State;
use uuid::Uuid;

use crate::db::dao::provider_config as provider_dao;
use crate::db::dao::supervision_replay::{NewSupervisionReplay, ReplaySurface};
use crate::dive::event_log::{
    append_to_conn, VERIFICATION_COACH_EVALUATED_EVENT, VERIFICATION_COACH_REQUESTED_EVENT,
    VERIFICATION_OBSERVATION_RECORDED_EVENT,
};
use crate::dive::replay::capture_replay_best_effort;
use crate::dive::verification_coach::{
    build_verification_coach_prompt, evidence_summary, fallback_guidance, next_guide_version,
    parse_guide_json, unavailable_response, validate_guide, verification_coach_prompt_version,
    GuidanceReasonCode, GuidanceValidationOutcome, ObservationEvidenceInput,
    ObservationEvidenceRecord, VerificationCoachGenerateRequest, VerificationCoachGenerateResponse,
    VerificationCoachStatus,
};
use crate::pi_sidecar::{
    run_supervisor_turn, supervisor_turn_timeout, PiSidecarSupervisorErrorKind,
};

use super::{AppState, ProviderKind};

#[tauri::command]
pub async fn verification_coach_generate(
    state: State<'_, AppState>,
    request: VerificationCoachGenerateRequest,
) -> Result<VerificationCoachGenerateResponse, String> {
    verification_coach_generate_impl(&state, request).await
}

pub(crate) async fn verification_coach_generate_impl(
    state: &AppState,
    request: VerificationCoachGenerateRequest,
) -> Result<VerificationCoachGenerateResponse, String> {
    let event_id = Uuid::new_v4().to_string();
    let guide_version = next_guide_version(&request);
    log_requested(state, &request, &event_id, guide_version)?;

    let output = generate_from_runtime(state, &request).await;
    finish_coach_evaluation(state, request, event_id, guide_version, output)
}

/// Validates the runtime output, logs `verification_coach.evaluated`, and
/// captures the replay-corpus row when the prompt reached a model.
fn finish_coach_evaluation(
    state: &AppState,
    request: VerificationCoachGenerateRequest,
    event_id: String,
    guide_version: u32,
    output: CoachRuntimeOutput,
) -> Result<VerificationCoachGenerateResponse, String> {
    // Spec 015 FR-001: `promptVersion` is logged only when the coach prompt
    // actually reached a model (a returned turn or a mid-turn failure).
    let prompt_sent = !matches!(output, CoachRuntimeOutput::Unavailable(_));
    let raw_output = match &output {
        CoachRuntimeOutput::Guide { raw, .. } => Some(raw.clone()),
        _ => None,
    };
    let mut response = match output {
        CoachRuntimeOutput::Guide {
            raw,
            model,
            latency_ms,
        } => match parse_guide_json(&raw) {
            Ok(guide) => {
                let validation = validate_guide(&request, &guide);
                if validation.outcome == GuidanceValidationOutcome::Valid {
                    VerificationCoachGenerateResponse {
                        status: VerificationCoachStatus::Shown,
                        event_id: event_id.clone(),
                        guide_version,
                        guide: Some(guide),
                        fallback_guidance: Vec::new(),
                        validation: Some(validation),
                        drop_reason: None,
                        message: None,
                        model,
                        latency_ms,
                    }
                } else {
                    VerificationCoachGenerateResponse {
                        status: VerificationCoachStatus::Dropped,
                        event_id: event_id.clone(),
                        guide_version,
                        guide: None,
                        fallback_guidance: fallback_guidance(&request),
                        drop_reason: Some(validation.reason_code.clone()),
                        validation: Some(validation),
                        message: None,
                        model,
                        latency_ms,
                    }
                }
            }
            Err(reason) => unavailable_response(event_id.clone(), guide_version, reason, &request),
        },
        CoachRuntimeOutput::Unavailable(reason) | CoachRuntimeOutput::TurnFailed(reason) => {
            unavailable_response(event_id.clone(), guide_version, reason, &request)
        }
    };
    response.event_id = event_id;
    log_evaluated(state, &request, &response, prompt_sent)?;
    if prompt_sent {
        if let Some(replay) = coach_replay_record(&request, &response, raw_output) {
            if let Ok(db) = state.db.lock() {
                capture_replay_best_effort(db.conn(), &replay);
            }
        }
    }
    Ok(response)
}

/// Replay row for a coach evaluation (spec 015 FR-020): the generate request
/// is the builder input, so the prompt is reproducible from it plus
/// `promptVersion`.
fn coach_replay_record(
    request: &VerificationCoachGenerateRequest,
    response: &VerificationCoachGenerateResponse,
    raw_output: Option<String>,
) -> Option<NewSupervisionReplay> {
    let context_json = serde_json::to_string(request)
        .map_err(|err| tracing::warn!(error = %err, "coach replay context did not serialize"))
        .ok()?;
    let validation = response.validation.as_ref();
    Some(NewSupervisionReplay {
        evaluation_id: response.event_id.clone(),
        surface: ReplaySurface::Coach,
        session_id: Some(request.session_id),
        project_id: request.project_id,
        prompt_version: verification_coach_prompt_version().render(),
        policy_version: None,
        model: response.model.clone(),
        context_json,
        raw_output,
        validation_json: json!({
            "status": response.status,
            "validationOutcome": validation.map(|value| &value.outcome),
            "reasonCode": validation.map(|value| &value.reason_code).or(response.drop_reason.as_ref()),
            "latencyMs": response.latency_ms,
        })
        .to_string(),
    })
}

#[tauri::command]
pub async fn verification_observation_record(
    state: State<'_, AppState>,
    observation: ObservationEvidenceInput,
) -> Result<ObservationEvidenceRecord, String> {
    verification_observation_record_impl(&state, observation)
}

pub(crate) fn verification_observation_record_impl(
    state: &AppState,
    observation: ObservationEvidenceInput,
) -> Result<ObservationEvidenceRecord, String> {
    let record = ObservationEvidenceRecord {
        session_id: observation.session_id,
        card_id: observation.card_id,
        plan_step_id: observation.plan_step_id,
        guide_version: observation.guide_version,
        evidence_kind: observation.evidence_kind,
        criterion_ids: observation.criterion_ids,
        observation_text: observation
            .observation_text
            .trim()
            .chars()
            .take(1000)
            .collect(),
        observation_id: Uuid::new_v4().to_string(),
        recorded_at: crate::db::now_ms(),
    };
    let db = state.db.lock().map_err(|e| e.to_string())?;
    append_to_conn(
        db.conn(),
        Some(record.session_id),
        VERIFICATION_OBSERVATION_RECORDED_EVENT,
        serde_json::to_value(&record).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(record)
}

enum CoachRuntimeOutput {
    Guide {
        raw: String,
        model: Option<String>,
        latency_ms: Option<u64>,
    },
    /// No prompt was sent (runtime, provider, credentials, or root missing).
    Unavailable(GuidanceReasonCode),
    /// The prompt was sent but the Pi supervisor turn failed.
    TurnFailed(GuidanceReasonCode),
}

async fn generate_from_runtime(
    state: &AppState,
    request: &VerificationCoachGenerateRequest,
) -> CoachRuntimeOutput {
    let snap = match state.ensure_provider_runtime().await {
        Ok(snap) if !snap.kind.is_none() => snap,
        Ok(_) => {
            let reason = missing_runtime_reason(state);
            tracing::warn!(
                reason = ?reason,
                "verification coach runtime unavailable: provider runtime missing"
            );
            return CoachRuntimeOutput::Unavailable(reason);
        }
        Err(err) => {
            tracing::warn!(
                error = %crate::telemetry::redact_log_text(&err),
                "verification coach provider runtime hydrate failed"
            );
            return CoachRuntimeOutput::Unavailable(GuidanceReasonCode::RuntimeUnavailable);
        }
    };
    let descriptor = match crate::pi_sidecar::parity::pi_provider_descriptor(snap.kind.clone()) {
        Some(descriptor) => descriptor,
        None => {
            tracing::warn!(
                provider_kind = %snap.kind.as_str(),
                "verification coach runtime unavailable: provider has no Pi supervisor mapping"
            );
            return CoachRuntimeOutput::Unavailable(GuidanceReasonCode::ProviderNotSupported);
        }
    };
    let provider_config_id = match snap.config_id {
        Some(id) => id,
        None => {
            tracing::warn!(
                provider_kind = %snap.kind.as_str(),
                "verification coach runtime unavailable: provider config id missing"
            );
            return CoachRuntimeOutput::Unavailable(GuidanceReasonCode::MissingCredentials);
        }
    };
    let cwd = match state.project_root_required() {
        Ok(cwd) => cwd,
        Err(err) => {
            tracing::warn!(
                error = %crate::telemetry::redact_log_text(&err),
                "verification coach runtime unavailable: project root missing"
            );
            return CoachRuntimeOutput::Unavailable(GuidanceReasonCode::MissingProjectRoot);
        }
    };

    match super::chat::runtime_credentials_available(state, &descriptor, provider_config_id) {
        Ok(true) => {}
        Ok(false) => {
            tracing::warn!(
                provider_config_id,
                provider = snap.kind.as_str(),
                "verification coach runtime unavailable: provider credentials are missing"
            );
            return CoachRuntimeOutput::Unavailable(GuidanceReasonCode::MissingCredentials);
        }
        Err(err) => {
            tracing::warn!(
                error = %crate::telemetry::redact_log_text(&err),
                "verification coach runtime unavailable: provider credential check failed"
            );
            return CoachRuntimeOutput::Unavailable(GuidanceReasonCode::RuntimeUnavailable);
        }
    };

    match run_supervisor_turn(
        state.keyring.as_ref(),
        &descriptor,
        provider_config_id,
        cwd,
        snap.model,
        build_verification_coach_prompt(request),
        supervisor_turn_timeout(),
    )
    .await
    {
        Ok(result) => CoachRuntimeOutput::Guide {
            raw: result.assistant_text,
            model: Some(result.model),
            latency_ms: Some(result.latency_ms),
        },
        Err(err) => {
            tracing::warn!(
                error_kind = ?err.kind,
                latency_ms = err.latency_ms,
                message = %crate::telemetry::redact_log_text(&err.message),
                "verification coach Pi supervisor turn failed"
            );
            CoachRuntimeOutput::TurnFailed(sidecar_failure_reason(err.kind))
        }
    }
}

fn sidecar_failure_reason(kind: PiSidecarSupervisorErrorKind) -> GuidanceReasonCode {
    match kind {
        PiSidecarSupervisorErrorKind::CredentialUnavailable => {
            GuidanceReasonCode::MissingCredentials
        }
        PiSidecarSupervisorErrorKind::SidecarUnavailable => GuidanceReasonCode::SidecarUnavailable,
        PiSidecarSupervisorErrorKind::Timeout => GuidanceReasonCode::Timeout,
        PiSidecarSupervisorErrorKind::SidecarError => GuidanceReasonCode::SidecarError,
        PiSidecarSupervisorErrorKind::RuntimeUnavailable => GuidanceReasonCode::RuntimeUnavailable,
    }
}

fn missing_runtime_reason(state: &AppState) -> GuidanceReasonCode {
    let latest_config = state
        .db
        .lock()
        .ok()
        .and_then(|db| provider_dao::list(db.conn()).ok())
        .and_then(|rows| rows.into_iter().last());
    let Some(row) = latest_config else {
        return GuidanceReasonCode::ProviderNotConfigured;
    };
    let kind = ProviderKind::parse(&row.kind);
    if crate::pi_sidecar::parity::pi_provider_descriptor(kind).is_some() {
        GuidanceReasonCode::MissingCredentials
    } else {
        GuidanceReasonCode::ProviderNotSupported
    }
}

fn log_requested(
    state: &AppState,
    request: &VerificationCoachGenerateRequest,
    event_id: &str,
    guide_version: u32,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    append_to_conn(
        db.conn(),
        Some(request.session_id),
        VERIFICATION_COACH_REQUESTED_EVENT,
        json!({
            "eventId": event_id,
            "sessionId": request.session_id,
            "cardId": request.card_id,
            "planStepId": request.plan_step_id,
            "guideVersion": guide_version,
            "sourceUiMode": request.source_ui_mode,
            "evidenceSummary": evidence_summary(request),
            "requestedAt": crate::db::now_ms(),
        }),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn log_evaluated(
    state: &AppState,
    request: &VerificationCoachGenerateRequest,
    response: &VerificationCoachGenerateResponse,
    prompt_sent: bool,
) -> Result<(), String> {
    let validation = response.validation.as_ref();
    let guide = response.guide.as_ref();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    append_to_conn(
        db.conn(),
        Some(request.session_id),
        VERIFICATION_COACH_EVALUATED_EVENT,
        json!({
            "eventId": response.event_id,
            "status": response.status,
            "validationOutcome": validation.map(|value| &value.outcome),
            "reasonCode": validation.map(|value| &value.reason_code).or(response.drop_reason.as_ref()),
            "evidenceRefs": validation.map(|value| &value.evidence_refs),
            "model": response.model,
            "latencyMs": response.latency_ms,
            "promptVersion": prompt_sent.then(|| verification_coach_prompt_version().render()),
            "guideSummary": guide.map(|guide| json!({
                "criterionSummary": guide.criterion_summary,
                "recommendedCheckCount": guide.recommended_checks.len(),
                "recommendedKinds": guide.recommended_checks.iter().map(|check| &check.kind).collect::<Vec<_>>(),
            })),
        }),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coach_request() -> VerificationCoachGenerateRequest {
        VerificationCoachGenerateRequest {
            session_id: 1,
            project_id: Some(1),
            card_id: 1,
            plan_step_id: Some(1),
            guide_version: None,
            source_ui_mode: "work".to_string(),
            locale: Some("ko-KR".to_string()),
            step: crate::dive::verification_coach::VerificationCoachStep {
                title: "Review step".to_string(),
                summary: None,
                instruction: None,
                acceptance_criteria: vec![crate::dive::verification_coach::VerificationCriterion {
                    criterion_id: "c1".to_string(),
                    text: "Resize to 375px and confirm columns adapt".to_string(),
                }],
            },
            evidence: crate::dive::verification_coach::VerificationCoachEvidence {
                changed_files: Vec::new(),
                verification_kind: None,
                verification_command: None,
                verification_manual_check: None,
                test_result: None,
                ai_claimed_done: false,
                preview_available: false,
                app_run_available: false,
                diff_available: false,
                prior_observations: Vec::new(),
            },
        }
    }

    #[test]
    fn coach_evaluation_captures_replay_only_when_the_prompt_was_sent() {
        let state = AppState::dev_mock();
        let (project_id, session_id) = {
            let db = state.db.lock().unwrap();
            crate::db::tests::seed_project_session(db.conn())
        };
        let mut request = coach_request();
        request.session_id = session_id;
        request.project_id = Some(project_id);
        let raw = r#"{"criterionSummary":"열이 바뀐다","recommendedChecks":[{"kind":"manual","label":"크기 조절","instruction":"창을 375px로 줄여 보세요","expectedObservation":"열이 하나로 바뀝니다"}],"expectedObservations":["열이 하나"],"evidencePrompts":["무엇이 보였나요?"]}"#;
        let response = finish_coach_evaluation(
            &state,
            request.clone(),
            "event-sent".into(),
            1,
            CoachRuntimeOutput::Guide {
                raw: raw.into(),
                model: Some("mock-model".into()),
                latency_ms: Some(10),
            },
        )
        .unwrap();
        assert_eq!(response.status, VerificationCoachStatus::Shown);
        finish_coach_evaluation(
            &state,
            request.clone(),
            "event-failed".into(),
            1,
            CoachRuntimeOutput::TurnFailed(GuidanceReasonCode::Timeout),
        )
        .unwrap();
        finish_coach_evaluation(
            &state,
            request,
            "event-unavailable".into(),
            1,
            CoachRuntimeOutput::Unavailable(GuidanceReasonCode::ProviderNotConfigured),
        )
        .unwrap();

        let db = state.db.lock().unwrap();
        let sent =
            crate::db::dao::supervision_replay::get_by_evaluation_id(db.conn(), "event-sent")
                .unwrap()
                .expect("a sent coach prompt is captured");
        assert_eq!(sent.surface, "coach");
        assert_eq!(sent.raw_output.as_deref(), Some(raw));
        assert!(crate::db::dao::supervision_replay::get_by_evaluation_id(
            db.conn(),
            "event-failed"
        )
        .unwrap()
        .is_some_and(|row| row.raw_output.is_none()));
        assert!(crate::db::dao::supervision_replay::get_by_evaluation_id(
            db.conn(),
            "event-unavailable"
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn coach_replay_record_stores_the_request_as_prompt_input() {
        let request = coach_request();
        let mut response = unavailable_response(
            "event-9".to_string(),
            1,
            GuidanceReasonCode::Timeout,
            &request,
        );
        response.model = Some("mock-model".into());
        let replay = coach_replay_record(&request, &response, Some("{\"x\":1}".into())).unwrap();
        assert_eq!(replay.evaluation_id, "event-9");
        assert_eq!(replay.surface, ReplaySurface::Coach);
        assert_eq!(replay.session_id, Some(1));
        assert_eq!(replay.project_id, Some(1));
        assert_eq!(replay.raw_output.as_deref(), Some("{\"x\":1}"));
        assert_eq!(
            replay.prompt_version,
            verification_coach_prompt_version().render()
        );
        let stored: VerificationCoachGenerateRequest =
            serde_json::from_str(&replay.context_json).unwrap();
        assert_eq!(
            build_verification_coach_prompt(&stored),
            build_verification_coach_prompt(&request)
        );
        let validation: serde_json::Value = serde_json::from_str(&replay.validation_json).unwrap();
        assert_eq!(validation["reasonCode"], serde_json::json!("timeout"));
    }

    #[test]
    fn sidecar_failure_modes_return_unavailable_without_panicking() {
        let request = coach_request();
        for (kind, reason) in [
            (
                PiSidecarSupervisorErrorKind::RuntimeUnavailable,
                GuidanceReasonCode::RuntimeUnavailable,
            ),
            (
                PiSidecarSupervisorErrorKind::CredentialUnavailable,
                GuidanceReasonCode::MissingCredentials,
            ),
            (
                PiSidecarSupervisorErrorKind::SidecarUnavailable,
                GuidanceReasonCode::SidecarUnavailable,
            ),
            (
                PiSidecarSupervisorErrorKind::Timeout,
                GuidanceReasonCode::Timeout,
            ),
            (
                PiSidecarSupervisorErrorKind::SidecarError,
                GuidanceReasonCode::SidecarError,
            ),
        ] {
            let response = unavailable_response(
                "event-1".to_string(),
                1,
                sidecar_failure_reason(kind),
                &request,
            );

            assert_eq!(response.status, VerificationCoachStatus::Unavailable);
            assert_eq!(response.drop_reason, Some(reason.clone()));
            assert_eq!(
                response
                    .validation
                    .as_ref()
                    .map(|validation| &validation.outcome),
                Some(&GuidanceValidationOutcome::Unavailable)
            );
            assert_eq!(
                response
                    .validation
                    .as_ref()
                    .map(|validation| &validation.reason_code),
                Some(&reason)
            );
            assert!(response.guide.is_none());
            assert_eq!(response.fallback_guidance.len(), 1);
            assert_eq!(response.fallback_guidance[0].classes, vec!["responsive"]);
        }
    }
}
