use serde_json::json;
use tauri::State;
use uuid::Uuid;

use crate::db::dao::provider_config as provider_dao;
use crate::dive::event_log::{
    append_to_conn, VERIFICATION_COACH_EVALUATED_EVENT, VERIFICATION_COACH_REQUESTED_EVENT,
    VERIFICATION_OBSERVATION_RECORDED_EVENT,
};
use crate::dive::verification_coach::{
    build_verification_coach_prompt, evidence_summary, next_guide_version, parse_guide_json,
    unavailable_response, validate_guide, GuidanceReasonCode, GuidanceValidationOutcome,
    ObservationEvidenceInput, ObservationEvidenceRecord, VerificationCoachGenerateRequest,
    VerificationCoachGenerateResponse, VerificationCoachStatus,
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
                        drop_reason: Some(validation.reason_code.clone()),
                        validation: Some(validation),
                        message: Some(
                            "검증 안내가 현재 근거와 맞지 않아 표시하지 않았습니다.".to_string(),
                        ),
                        model,
                        latency_ms,
                    }
                }
            }
            Err(reason) => unavailable_response(event_id.clone(), guide_version, reason),
        },
        CoachRuntimeOutput::Unavailable(reason) => {
            unavailable_response(event_id.clone(), guide_version, reason)
        }
    };
    response.event_id = event_id;
    log_evaluated(state, &request, &response)?;
    Ok(response)
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
    Unavailable(GuidanceReasonCode),
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
            CoachRuntimeOutput::Unavailable(sidecar_failure_reason(err.kind))
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

    #[test]
    fn sidecar_failure_modes_return_unavailable_without_panicking() {
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
            let response =
                unavailable_response("event-1".to_string(), 1, sidecar_failure_reason(kind));

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
        }
    }
}
