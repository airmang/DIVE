//! Plan draft generation, approval, and the plan interview flow.
//!
//! Moved verbatim from the former `workspace_plan.rs` monolith (Wily S-066).

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::db::dao::{
    interview as interview_dao, plan as plan_dao, prd as prd_dao, project as project_dao,
    step as step_dao,
};
use crate::db::models::{
    AcceptanceCriterion, AcceptanceCriterionSource, AcceptanceCriterionStatus, InterviewRow,
    NewInterview, NewPlan, NewStep, PlanRow, ProjectSpec, ProjectSpecVersionRow, StepRow,
};
use crate::dive::event_log as dive_event_log;
use crate::dive::plan_form_consistency::{form_consistency_annotation, PlanFormStep};
use crate::ipc::AppState;
use crate::workspace_plan as workspace_plan_service;

use super::*;

fn step_traceability_error(step: &StepDraftInput) -> Option<String> {
    let mut missing = Vec::new();
    if compact_linked_criterion_ids(&step.linked_criterion_ids).is_empty() {
        missing.push("linkedCriterionIds");
    }
    if step
        .rationale
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        missing.push("rationale");
    }
    (!missing.is_empty()).then(|| {
        format!(
            "generated step '{}' requires {}",
            step.step_id,
            missing.join(" and ")
        )
    })
}

fn validate_generated_step_traceability(
    plan_input: &PlanDraftInput,
    project_prd: &ProjectSpec,
) -> Result<(), String> {
    let active_ids: HashSet<&str> = project_prd
        .acceptance_criteria
        .iter()
        .filter(|criterion| criterion.status == AcceptanceCriterionStatus::Active)
        .map(|criterion| criterion.criterion_id.as_str())
        .collect();
    for step in &plan_input.steps {
        if let Some(err) = step_traceability_error(step) {
            return Err(err);
        }
        for criterion_id in compact_linked_criterion_ids(&step.linked_criterion_ids) {
            if !active_ids.contains(criterion_id.as_str()) {
                return Err(format!(
                    "generated step '{}' linkedCriterionIds contains unknown criterion '{}'",
                    step.step_id, criterion_id
                ));
            }
        }
    }
    Ok(())
}

fn step_criteria_payload(
    step: &StepDraftInput,
    project_prd: &ProjectSpec,
) -> Result<Value, String> {
    let linked_criterion_ids = compact_linked_criterion_ids(&step.linked_criterion_ids);
    let draft_criteria = normalize_criterion_inputs(
        &step.acceptance_criteria,
        &project_prd.acceptance_criteria,
        project_prd.current_version,
        AcceptanceCriterionSource::Migration,
    );
    let mut criteria = Vec::new();
    for criterion_id in &linked_criterion_ids {
        let criterion = criterion_by_id(&project_prd.acceptance_criteria, criterion_id)
            .or_else(|| criterion_by_id(&draft_criteria, criterion_id))
            .ok_or_else(|| {
                format!(
                    "generated step '{}' linkedCriterionIds contains unknown criterion '{}'",
                    step.step_id, criterion_id
                )
            })?;
        criteria.push(criterion);
    }
    let rationale = step
        .rationale
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("generated step '{}' requires rationale", step.step_id))?;
    Ok(json!({
        "criteria": criteria,
        "linkedCriterionIds": linked_criterion_ids,
        "rationale": rationale,
    }))
}

pub(super) fn append_step_criteria_payload(
    step: &StepDraftInput,
    latest_prd: Option<&ProjectSpecVersionRow>,
) -> Result<Value, String> {
    let linked_criterion_ids = compact_linked_criterion_ids(&step.linked_criterion_ids);
    let rationale = step
        .rationale
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if linked_criterion_ids.is_empty() && rationale.is_none() {
        return Ok(serde_json::json!(step.acceptance_criteria));
    }

    let (existing_criteria, version) = latest_prd
        .map(|row| (row.snapshot.acceptance_criteria.as_slice(), row.version))
        .unwrap_or((&[] as &[AcceptanceCriterion], 1));
    let draft_criteria = normalize_criterion_inputs(
        &step.acceptance_criteria,
        existing_criteria,
        version,
        AcceptanceCriterionSource::Migration,
    );
    let mut criteria = Vec::new();
    if linked_criterion_ids.is_empty() {
        criteria = draft_criteria;
    } else {
        for criterion_id in &linked_criterion_ids {
            let criterion = latest_prd
                .and_then(|row| criterion_by_id(&row.snapshot.acceptance_criteria, criterion_id))
                .or_else(|| criterion_by_id(&draft_criteria, criterion_id))
                .ok_or_else(|| {
                    format!(
                        "appended step linkedCriterionIds contains unknown criterion '{}'",
                        criterion_id
                    )
                })?;
            criteria.push(criterion);
        }
    }

    let mut payload = json!({
        "criteria": criteria,
        "linkedCriterionIds": linked_criterion_ids,
    });
    if let Some(rationale) = rationale {
        if let Value::Object(map) = &mut payload {
            map.insert("rationale".into(), Value::String(rationale));
        }
    }
    Ok(payload)
}

fn plan_generated_criterion_coverage(
    project_prd: &ProjectSpec,
    step_links: &[(String, Vec<String>)],
) -> Value {
    let linked_ids = step_links
        .iter()
        .flat_map(|(_, ids)| ids.iter().cloned())
        .collect::<HashSet<_>>();
    let active_criterion_ids = project_prd
        .acceptance_criteria
        .iter()
        .filter(|criterion| criterion.status == AcceptanceCriterionStatus::Active)
        .map(|criterion| criterion.criterion_id.clone())
        .collect::<Vec<_>>();
    let covered_criterion_ids = active_criterion_ids
        .iter()
        .filter(|criterion_id| linked_ids.contains(*criterion_id))
        .cloned()
        .collect::<Vec<_>>();
    let uncovered_criterion_ids = active_criterion_ids
        .iter()
        .filter(|criterion_id| !linked_ids.contains(*criterion_id))
        .cloned()
        .collect::<Vec<_>>();
    json!({
        "total_criterion_count": active_criterion_ids.len(),
        "covered_criterion_ids": covered_criterion_ids,
        "uncovered_criterion_ids": uncovered_criterion_ids,
        "step_links": step_links
            .iter()
            .map(|(stable_step_id, linked_criterion_ids)| {
                json!({
                    "stable_step_id": stable_step_id,
                    "linked_criterion_ids": linked_criterion_ids,
                })
            })
            .collect::<Vec<_>>(),
    })
}

pub fn workspace_plan_start_interview_impl(
    state: &AppState,
    project_id: i64,
    goal: String,
) -> Result<InterviewRow, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(existing) =
        interview_dao::get_by_project(db.conn(), project_id).map_err(|e| e.to_string())?
    {
        match existing.status.as_str() {
            "draft" | "submitted" => return Ok(existing),
            "discarded" => {
                interview_dao::delete(db.conn(), existing.id).map_err(|e| e.to_string())?;
            }
            _ => {
                return Err(format!(
                    "interview {} is already {}",
                    existing.id, existing.status
                ))
            }
        }
    }

    let interview_id = interview_dao::insert(
        db.conn(),
        &NewInterview {
            project_id,
            goal,
            questions: Some(serde_json::json!([])),
            unresolved_questions: Some(serde_json::json!([])),
            intent_summary: None,
            status: "draft".into(),
        },
    )
    .map_err(|e| e.to_string())?;
    interview_dao::get_by_id(db.conn(), interview_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "interview not found after insert".to_string())
}

pub fn workspace_plan_save_interview_answer_impl(
    state: &AppState,
    interview_id: i64,
    question: String,
    answer: String,
) -> Result<InterviewRow, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let interview = interview_dao::get_by_id(db.conn(), interview_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("interview {interview_id} not found"))?;
    let mut questions = interview
        .questions
        .as_ref()
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    questions.push(serde_json::json!({
        "question": question,
        "answer": answer,
    }));
    interview_dao::update(
        db.conn(),
        interview_id,
        &NewInterview {
            project_id: interview.project_id,
            goal: interview.goal,
            questions: Some(serde_json::Value::Array(questions)),
            unresolved_questions: interview.unresolved_questions,
            intent_summary: interview.intent_summary,
            status: interview.status,
        },
    )
    .map_err(|e| e.to_string())?;
    interview_dao::get_by_id(db.conn(), interview_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "interview not found after update".to_string())
}

pub fn workspace_plan_submit_interview_impl(
    state: &AppState,
    interview_id: i64,
    intent_summary: String,
    unresolved_questions: Vec<String>,
) -> Result<InterviewRow, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let interview = interview_dao::get_by_id(db.conn(), interview_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("interview {interview_id} not found"))?;
    if interview.status != "draft" {
        return Err(format!(
            "interview {interview_id} must be draft before submit"
        ));
    }
    interview_dao::update(
        db.conn(),
        interview_id,
        &NewInterview {
            project_id: interview.project_id,
            goal: interview.goal,
            questions: interview.questions,
            unresolved_questions: Some(serde_json::json!(unresolved_questions)),
            intent_summary: Some(intent_summary),
            status: "submitted".into(),
        },
    )
    .map_err(|e| e.to_string())?;
    interview_dao::get_by_id(db.conn(), interview_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "interview not found after submit".to_string())
}

pub fn workspace_plan_generate_draft_impl(
    state: &AppState,
    interview_id: i64,
    mut plan_input: PlanDraftInput,
    replace_approved: bool,
) -> Result<(PlanRow, Vec<StepRow>), String> {
    validate_plan_draft(&plan_input)?;
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.conn_mut();
    let interview = interview_dao::get_by_id(conn, interview_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("interview {interview_id} not found"))?;
    let project_prd = prd_dao::latest_version(conn, interview.project_id)
        .map_err(|e| e.to_string())?
        .map(|row| row.snapshot);
    if !project_prd
        .as_ref()
        .map(is_minimal_project_spec)
        .unwrap_or(false)
    {
        return Err("minimal PRD is required before generating a plan draft".into());
    }
    let project_prd = project_prd.expect("minimal PRD checked above");
    resolve_prd_criterion_id_references(&mut plan_input, &project_prd);
    let quality_report =
        validate_criterion_quality(&interview.goal, &plan_input).map_err(|e| e.to_string())?;
    for step in &mut plan_input.steps {
        sanitize_step_verification(step);
    }
    validate_generated_step_traceability(&plan_input, &project_prd)?;
    let plan_acceptance_criteria = normalize_criterion_inputs(
        &plan_input.acceptance_criteria,
        &project_prd.acceptance_criteria,
        project_prd.current_version,
        AcceptanceCriterionSource::Migration,
    );
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if let Some(existing) =
        plan_dao::get_by_project(&tx, interview.project_id).map_err(|e| e.to_string())?
    {
        // A draft is always replaced silently. An approved plan is only replaced
        // when the caller explicitly opted in (the UI confirms first, since this
        // discards the approved plan and its steps — Step/StepSessionMapping
        // cascade on the Plan delete). Without opt-in we still refuse, so the UI
        // can detect the case and prompt instead of silently destroying work.
        if existing.status == "draft" || replace_approved {
            plan_dao::delete(&tx, existing.id).map_err(|e| e.to_string())?;
        } else {
            return Err(format!(
                "project {} already has approved plan {}",
                interview.project_id, existing.id
            ));
        }
    }

    let plan_id = plan_dao::insert(
        &tx,
        &NewPlan {
            project_id: interview.project_id,
            interview_id: Some(interview.id),
            goal: plan_input.goal,
            intent_summary: Some(plan_input.intent_summary),
            scope: Some(serde_json::json!(plan_input.scope)),
            non_goals: Some(serde_json::json!(plan_input.non_goals)),
            constraints: Some(serde_json::json!(plan_input.constraints)),
            acceptance_criteria: Some(serde_json::json!(plan_acceptance_criteria)),
            status: "draft".into(),
        },
    )
    .map_err(|e| e.to_string())?;

    let step_count = plan_input.steps.len();
    let annotation_session_id = latest_session_id_for_project(&tx, interview.project_id);
    log_form_consistency_annotations(
        &tx,
        annotation_session_id,
        interview.project_id,
        plan_id,
        &project_prd,
        &plan_input.steps,
    );
    log_criterion_quality_advisories(
        &tx,
        annotation_session_id,
        interview.project_id,
        plan_id,
        &quality_report.advisories,
    );
    let mut step_criterion_links: Vec<(String, Vec<String>)> = Vec::new();
    for step in plan_input.steps {
        let step_kind = step_kind_for_draft(&step);
        let acceptance_criteria = step_criteria_payload(&step, &project_prd)?;
        step_criterion_links.push((
            step.step_id.clone(),
            json_linked_criterion_ids(Some(&acceptance_criteria)),
        ));
        step_dao::insert(
            &tx,
            &NewStep {
                plan_id,
                step_id: step.step_id,
                title: step.title,
                summary: Some(step.summary),
                instruction_seed: Some(step.instruction_seed),
                expected_files: Some(serde_json::json!(step.expected_files)),
                acceptance_criteria: Some(acceptance_criteria),
                step_kind,
                verification_kind: step.verification_type,
                verification_command: step.verification_command,
                verification_manual_check: None,
                dependencies: Some(serde_json::json!(step.dependencies)),
                parallel_group: step.parallel_group.map(|group| group.to_string()),
                position: step.position,
            },
        )
        .map_err(|e| e.to_string())?;
    }
    step_dao::validate_dependencies(&tx, plan_id).map_err(|e| e.to_string())?;
    let criterion_coverage = plan_generated_criterion_coverage(&project_prd, &step_criterion_links);
    // Wily P2 cleanup: stamp with the project's session (same lookup already
    // used for the form-consistency/criterion-quality annotations just above)
    // instead of `None`, so this event is reachable by session-scoped export.
    dive_event_log::append_to_conn(
        &tx,
        annotation_session_id,
        dive_event_log::PLAN_GENERATED_EVENT,
        dive_event_log::plan_generated_payload(
            interview.project_id,
            plan_id,
            project_prd.project_spec_id.clone(),
            project_prd.current_version,
            step_count,
            criterion_coverage,
            "interview",
        ),
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    let plan = plan_dao::get_by_id(conn, plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "plan not found after draft generation".to_string())?;
    let steps = step_dao::list_active_by_plan(conn, plan_id).map_err(|e| e.to_string())?;
    Ok((plan, steps))
}

/// Wily P2 cleanup: also used by sibling submodules (`plan_steps`,
/// `prd_interview`) to stamp plan/PRD lifecycle EventLog rows with a real
/// session_id instead of `None` — the only EventLog export path
/// (`ExportEngine::export_session`) selects `WHERE session_id = ?`, so a NULL
/// session_id makes a row permanently unreachable by any session export.
pub(super) fn latest_session_id_for_project(
    conn: &rusqlite::Connection,
    project_id: i64,
) -> Option<i64> {
    let mut stmt = conn
        .prepare("SELECT id FROM Session WHERE project_id = ? ORDER BY id DESC LIMIT 1")
        .ok()?;
    stmt.query_row([project_id], |row| row.get::<_, i64>(0))
        .ok()
}

/// Wily P2 cleanup: reject a plan-mutation command when the plan's own
/// project no longer matches the ambient selected-project root. Every
/// plan-mutation write site (`plan_steps`, `plan_lifecycle`) fetches `plan_id`
/// from the wire, mutates that plan's project in the DB, then exports
/// artifacts/checkpoints into `state.project_root_required()` (the ambient
/// selected project) with no check that the two agree — a project switch
/// mid-command would mis-attribute the exported `.dive/` artifacts and
/// checkpoints to the wrong project. Called once at command entry, before any
/// mutation, so a mismatch is a clean no-op rejection instead of a partial,
/// mis-attributed write.
pub(super) fn require_plan_matches_ambient_project_root(
    state: &AppState,
    conn: &rusqlite::Connection,
    plan_id: i64,
) -> Result<(), String> {
    let project_root = state.project_root_required()?;
    let plan = plan_dao::get_by_id(conn, plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {plan_id} not found"))?;
    let project = project_dao::get_by_id(conn, plan.project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("project {} not found", plan.project_id))?;
    if std::path::Path::new(&project.path) != project_root.as_path() {
        return Err(format!(
            "plan {plan_id} belongs to project \"{}\", which is not the \
             currently selected project; switch back to it before mutating \
             this plan",
            project.path
        ));
    }
    Ok(())
}

fn log_form_consistency_annotations(
    conn: &rusqlite::Connection,
    session_id: Option<i64>,
    project_id: i64,
    plan_id: i64,
    project_prd: &ProjectSpec,
    steps: &[StepDraftInput],
) {
    let form = project_prd
        .architecture
        .as_ref()
        .map(|architecture| architecture.form);
    for step in steps {
        let annotation = form_consistency_annotation(
            form,
            PlanFormStep {
                title: &step.title,
                summary: &step.summary,
                instruction_seed: &step.instruction_seed,
                expected_files: &step.expected_files,
            },
        );
        let Some(reason) = annotation else {
            continue;
        };
        let Some(form) = form else {
            continue;
        };
        let payload = dive_event_log::plan_form_consistency_payload(
            dive_event_log::PlanFormConsistencyPayloadInput {
                project_id,
                plan_id,
                project_spec_id: &project_prd.project_spec_id,
                project_spec_version: project_prd.current_version,
                form: architecture_form_code(form),
                step_id: &step.step_id,
                step_title: &step.title,
                expected_files: &step.expected_files,
                reason: &reason,
            },
        );
        if let Err(err) = dive_event_log::append_to_conn(
            conn,
            session_id,
            dive_event_log::PLAN_FORM_CONSISTENCY_EVENT,
            payload,
        ) {
            tracing::warn!(
                error = %crate::telemetry::redact_log_text(&err.to_string()),
                "failed to append plan form consistency annotation"
            );
        }
    }
}

/// S-050 D1/P3: logs the accepted draft's non-blocking criterion-quality
/// findings as `plan.criterion_quality_advisory` annotations, mirroring
/// `log_form_consistency_annotations` above (S-049 precedent). Called inside
/// the same transaction as the plan/step insert so a rolled-back draft never
/// leaves advisory rows behind.
pub(super) fn log_criterion_quality_advisories(
    conn: &rusqlite::Connection,
    session_id: Option<i64>,
    project_id: i64,
    plan_id: i64,
    advisories: &[CriterionQualityAdvisory],
) {
    for advisory in advisories {
        let payload = dive_event_log::plan_criterion_quality_advisory_payload(
            dive_event_log::PlanCriterionQualityAdvisoryPayloadInput {
                project_id,
                plan_id,
                code: advisory.code,
                criterion_preview: Some(advisory.criterion_preview.as_str()),
                step_ref: advisory.step_ref.as_deref(),
            },
        );
        if let Err(err) = dive_event_log::append_to_conn(
            conn,
            session_id,
            dive_event_log::PLAN_CRITERION_QUALITY_ADVISORY_EVENT,
            payload,
        ) {
            tracing::warn!(
                error = %crate::telemetry::redact_log_text(&err.to_string()),
                "failed to append criterion quality advisory annotation"
            );
        }
    }
}

fn architecture_form_code(form: crate::db::models::ArchitectureForm) -> &'static str {
    match form {
        crate::db::models::ArchitectureForm::WebApp => "web_app",
        crate::db::models::ArchitectureForm::StaticPage => "static_page",
        crate::db::models::ArchitectureForm::CliTool => "cli_tool",
        crate::db::models::ArchitectureForm::DesktopApp => "desktop_app",
        crate::db::models::ArchitectureForm::ApiService => "api_service",
        crate::db::models::ArchitectureForm::Other => "other",
    }
}

pub fn workspace_plan_current_draft_impl(
    state: &AppState,
    project_id: i64,
) -> Result<Option<(PlanRow, Vec<StepRow>)>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let Some(plan) = plan_dao::get_by_project(db.conn(), project_id).map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    if plan.status != "draft" {
        return Ok(None);
    }
    let steps = step_dao::list_active_by_plan(db.conn(), plan.id).map_err(|e| e.to_string())?;
    Ok(Some((plan, steps)))
}

pub fn workspace_plan_approve_impl(
    state: &AppState,
    plan_id: i64,
    critique_resolution: Option<PlanCritiqueResolution>,
) -> Result<PlanRow, String> {
    let project_root = state.project_root_required()?;
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        // Wily P2 cleanup: reject before mutating/exporting anything if the
        // plan's own project isn't the currently selected (ambient) one.
        require_plan_matches_ambient_project_root(state, db.conn(), plan_id)?;
        workspace_plan_service::approve_plan_and_export(db.conn(), plan_id, &project_root)
            .map_err(|e| e.to_string())?;
        let plan = plan_dao::get_by_id(db.conn(), plan_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("plan {plan_id} not found after approve"))?;
        if let Some(interview_id) = plan.interview_id {
            if let Some(interview) =
                interview_dao::get_by_id(db.conn(), interview_id).map_err(|e| e.to_string())?
            {
                if interview.status == "submitted" {
                    interview_dao::update(
                        db.conn(),
                        interview.id,
                        &NewInterview {
                            project_id: interview.project_id,
                            goal: interview.goal,
                            questions: interview.questions,
                            unresolved_questions: interview.unresolved_questions,
                            intent_summary: interview.intent_summary,
                            status: "approved".into(),
                        },
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }
    }
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let plan = plan_dao::get_by_id(db.conn(), plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {plan_id} not found after approve"))?;
    // Record the student's plan-critique response as supervision evidence so the
    // research ledger can distinguish an engaged approval from a blind one
    // (Constitution IV). The note is the student's own words, not AI self-report.
    let critique_response = critique_resolution.as_ref().map(|res| res.response.clone());
    let critique_note = critique_resolution
        .as_ref()
        .and_then(|res| res.note.as_deref())
        .and_then(bounded_critique_note);
    // S-064: the approval + export already committed above, so a failure here
    // must not roll back the user-visible success — but silently dropping this
    // supervision-evidence event (`let _ =`) leaves the research ledger
    // inconsistent (Constitution IV). Surface it as a warning instead, matching
    // the annotation-logging convention elsewhere in this file.
    // Wily P2 cleanup: stamp with the project's session instead of `None` — a
    // NULL session_id made this row (with the student's critiqueResponse /
    // critiqueNote supervision evidence) permanently unreachable by the
    // session-scoped EventLog export.
    let approval_session_id = latest_session_id_for_project(db.conn(), plan.project_id);
    if let Err(err) = dive_event_log::append_to_conn(
        db.conn(),
        approval_session_id,
        "plan_approved",
        json!({
            "project_id": plan.project_id,
            "plan_id": plan.id,
            "message": "Plan approved",
            "critiqueResponse": critique_response,
            "critiqueNote": critique_note,
        }),
    ) {
        tracing::warn!(
            error = %crate::telemetry::redact_log_text(&err.to_string()),
            plan_id = plan.id,
            "failed to append plan_approved supervision-evidence event"
        );
    }
    Ok(plan)
}

/// Bound a student-authored plan-critique note before it enters the exportable
/// event ledger. Returns `None` for empty/whitespace input.
fn bounded_critique_note(note: &str) -> Option<String> {
    const MAX_CHARS: usize = 280;
    let trimmed = note.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(MAX_CHARS).collect())
}

pub fn workspace_plan_discard_plan_impl(state: &AppState, plan_id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let plan = plan_dao::get_by_id(db.conn(), plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {plan_id} not found"))?;
    if plan.status == "approved" {
        return Err("approved plans cannot be discarded".to_string());
    }
    plan_dao::delete(db.conn(), plan_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod critique_note_tests {
    use super::*;

    #[test]
    fn bounded_critique_note_trims_and_drops_empty() {
        assert_eq!(bounded_critique_note("   "), None);
        assert_eq!(bounded_critique_note(""), None);
        assert_eq!(
            bounded_critique_note("  계획대로 단계가 다 있어요  ").as_deref(),
            Some("계획대로 단계가 다 있어요")
        );
    }

    #[test]
    fn bounded_critique_note_caps_length_by_chars() {
        let long = "가".repeat(400);
        let bounded = bounded_critique_note(&long).expect("non-empty note kept");
        assert_eq!(bounded.chars().count(), 280);
    }
}

#[cfg(test)]
mod ambient_project_root_guard_tests {
    use super::*;
    use crate::db::dao::project as project_dao;
    use crate::db::models::NewProject;

    /// Regression for the P2 finding: a plan-mutation command used to trust
    /// `plan_id` from the wire and export into whatever project happened to
    /// be the ambient selection — a project switch mid-command would mutate
    /// the plan's real project but attribute the exported `.dive/` artifacts
    /// to the wrong one. The guard must reject before any mutation when the
    /// plan's own project differs from the ambient selected project.
    #[test]
    fn approve_rejects_plan_from_a_different_project_than_ambient() {
        let state = AppState::dev_mock();
        let tmp_a = tempfile::tempdir().unwrap();
        let tmp_b = tempfile::tempdir().unwrap();

        let plan_b_id = {
            let db = state.db.lock().unwrap();
            project_dao::insert(
                db.conn(),
                &NewProject {
                    name: "a".into(),
                    path: tmp_a.path().to_string_lossy().into(),
                    provider_default: None,
                    model_default: None,
                },
            )
            .unwrap();
            let project_b = project_dao::insert(
                db.conn(),
                &NewProject {
                    name: "b".into(),
                    path: tmp_b.path().to_string_lossy().into(),
                    provider_default: None,
                    model_default: None,
                },
            )
            .unwrap();
            plan_dao::insert(
                db.conn(),
                &NewPlan {
                    project_id: project_b,
                    interview_id: None,
                    goal: "Build B".into(),
                    intent_summary: None,
                    scope: None,
                    non_goals: None,
                    constraints: None,
                    acceptance_criteria: None,
                    status: "draft".into(),
                },
            )
            .unwrap()
        };

        // Ambient selection is project A's root, but we try to approve
        // project B's plan — a stand-in for a project switch mid-command.
        state.swap_project_root(tmp_a.path().to_path_buf()).unwrap();

        let result = workspace_plan_approve_impl(&state, plan_b_id, None);
        assert!(
            result.is_err(),
            "approving a plan from a non-ambient project must be rejected"
        );

        // And it must be a clean no-op: the plan must still be a draft.
        let db = state.db.lock().unwrap();
        let plan = plan_dao::get_by_id(db.conn(), plan_b_id).unwrap().unwrap();
        assert_eq!(
            plan.status, "draft",
            "a rejected approve must not mutate the plan"
        );
    }
}
