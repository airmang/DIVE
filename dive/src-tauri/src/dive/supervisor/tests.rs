use super::*;
use crate::db::models::ScopeExpansionAssessment;
use serde_json::{json, Value};

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
        question: "AI는 완료됐다고 했지만, 변경된 파일을 확인해 실제 목표와 맞는지 볼 수 있나요?"
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

fn sample_plan_drafted_context() -> SupervisorContext {
    SupervisorContext::new(
        SupervisorEvent::PlanDrafted,
        ArtifactRef::plan_draft("plan-9:draft", "Plan draft"),
        SupervisorMode::Work,
        "ko-KR",
        vec![
            SupervisorActionId::AddVerificationStep,
            SupervisorActionId::LinkCriterion,
            SupervisorActionId::DismissReview,
        ],
        "Build a todo app",
        PlanSummary {
            step_count: 2,
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
        vec![
            EvidenceRef {
                id: "plan.goal".to_string(),
                source: EvidenceSource::Goal,
                kind: EvidenceKind::PlanDraftAssessment,
                label: "Plan goal".to_string(),
                value_summary: json!("Build a todo app"),
                verification_evidence: false,
            },
            EvidenceRef {
                id: "plan.step.s_001.verification".to_string(),
                source: EvidenceSource::Plan,
                kind: EvidenceKind::VerificationCoverage,
                label: "Missing verification".to_string(),
                value_summary: json!({"stepId":"s_001"}),
                verification_evidence: false,
            },
        ],
    )
    .with_plan_draft_assessment(PlanDraftReviewAssessment {
        eligible: true,
        reason_codes: vec!["missing_verification".into()],
        evidence_refs: vec!["plan.goal".into(), "plan.step.s_001.verification".into()],
        step_count: 2,
        criteria_count: 1,
        unverified_step_ids: vec!["s_001".into()],
        unlinked_step_ids: vec![],
    })
}

fn valid_plan_drafted_decision() -> SupervisorDecision {
    SupervisorDecision {
        schema_version: SUPERVISOR_SCHEMA_VERSION,
        provoke: true,
        concern: PLAN_DRAFT_CONCERN.to_string(),
        severity: "caution".to_string(),
        question: "이 계획은 검증 없이 승인해도 완료 판단이 가능한가요?".to_string(),
        evidence_ref_ids: vec![
            "plan.goal".to_string(),
            "plan.step.s_001.verification".to_string(),
        ],
        suggested_action_ids: vec![
            "add_verification_step".to_string(),
            "link_criterion".to_string(),
        ],
        supervision_habit: Some("승인 전 검증 계획을 확인합니다.".to_string()),
        log_rationale: Some("Missing verification".to_string()),
    }
}

fn sample_diff_ready_context() -> SupervisorContext {
    SupervisorContext::new(
        SupervisorEvent::DiffReady,
        ArtifactRef::diff("step-1:diff", "Changed work"),
        SupervisorMode::Work,
        "ko-KR",
        vec![
            SupervisorActionId::OpenDiff,
            SupervisorActionId::AskAiForRationale,
        ],
        "Keep settings changes scoped",
        PlanSummary {
            step_count: 1,
            active_step: Some("Settings save".to_string()),
        },
        VerificationState {
            ai_self_report: false,
            concrete_evidence: false,
            test_result: None,
        },
        VerificationFeasibility {
            runnable: false,
            previewable: false,
            has_tests: true,
            diff_available: true,
        },
        vec![EvidenceRef {
            id: "diff.changed_files".to_string(),
            source: EvidenceSource::Diff,
            kind: EvidenceKind::ChangedFile,
            label: "Changed files".to_string(),
            value_summary: json!({"paths":["src/auth.ts"]}),
            verification_evidence: false,
        }],
    )
    .with_diff_ready_assessment(DiffReadyReviewAssessment {
        eligible: true,
        reason_codes: vec!["unexpected_file".into()],
        evidence_refs: vec!["diff.changed_files".into()],
        changed_file_count: 1,
        unexpected_files: vec!["src/auth.ts".into()],
        high_risk_files: vec!["src/auth.ts".into()],
        diff_viewed: false,
    })
}

fn sample_retry_loop_context() -> SupervisorContext {
    SupervisorContext::new(
        SupervisorEvent::RetryLoop,
        ArtifactRef::failure("step-1:failure", "Repeated failure"),
        SupervisorMode::Work,
        "ko-KR",
        vec![
            SupervisorActionId::CreateReproSteps,
            SupervisorActionId::RollbackLastChange,
        ],
        "Fix settings save",
        PlanSummary {
            step_count: 1,
            active_step: Some("Settings save".to_string()),
        },
        VerificationState {
            ai_self_report: false,
            concrete_evidence: false,
            test_result: Some(TestResult::Fail),
        },
        VerificationFeasibility {
            runnable: false,
            previewable: false,
            has_tests: true,
            diff_available: true,
        },
        vec![EvidenceRef {
            id: "failure.fingerprint".to_string(),
            source: EvidenceSource::Terminal,
            kind: EvidenceKind::FailureSummary,
            label: "Repeated failure".to_string(),
            value_summary: json!({"fingerprint":"panic_at_line"}),
            verification_evidence: false,
        }],
    )
    .with_retry_loop_assessment(RetryLoopReviewAssessment {
        eligible: true,
        reason_codes: vec!["same_failure_repeated".into()],
        evidence_refs: vec!["failure.fingerprint".into()],
        failure_fingerprint: "panic_at_line".into(),
        failure_count: 2,
        last_failure_at: json!(2),
        last_action_summary: Some("asked_ai_to_fix".into()),
        recovery_available: true,
    })
}

fn decision_for(
    concern: &str,
    question: &str,
    evidence_ref_ids: Vec<&str>,
    suggested_action_ids: Vec<&str>,
) -> SupervisorDecision {
    SupervisorDecision {
        schema_version: SUPERVISOR_SCHEMA_VERSION,
        provoke: true,
        concern: concern.to_string(),
        severity: "caution".to_string(),
        question: question.to_string(),
        evidence_ref_ids: evidence_ref_ids.into_iter().map(str::to_owned).collect(),
        suggested_action_ids: suggested_action_ids
            .into_iter()
            .map(str::to_owned)
            .collect(),
        supervision_habit: Some("근거를 보고 다음 행동을 고릅니다.".to_string()),
        log_rationale: Some("expanded test decision".to_string()),
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
            test_command: None,
            test_exit_code: None,
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
        test_command: None,
        test_exit_code: None,
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
    failed_test.test_command = Some("pnpm test".to_string());
    failed_test.test_exit_code = Some(1);
    failed_test.acceptance_criterion_confirmed = true;
    failed_test.preview_checked = true;
    assert!(!failed_test.has_concrete_evidence());

    let mut static_pass = base.clone();
    static_pass.test_result = Some(TestResult::Pass);
    assert!(!static_pass.has_concrete_evidence());
    let static_pass_refs = build_p1_evidence_refs(&static_pass);
    assert!(static_pass_refs.iter().any(|evidence| {
        evidence.id == "verify.test_result" && !evidence.verification_evidence
    }));

    let mut passed_test = base;
    passed_test.test_result = Some(TestResult::Pass);
    passed_test.test_command = Some("pnpm test".to_string());
    passed_test.test_exit_code = Some(0);
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
fn localized_evidence_label_maps_known_chrome_and_passes_data_through() {
    // Korean locale leaves every label untouched.
    assert_eq!(
        localized_evidence_label("AI 완료 주장", false),
        "AI 완료 주장"
    );
    // English locale maps the known chrome strings (fixed + default-scope).
    assert_eq!(
        localized_evidence_label("AI 완료 주장", true),
        "AI completion claim"
    );
    assert_eq!(
        localized_evidence_label("앱 실행 확인", true),
        "App launch verified"
    );
    assert_eq!(localized_evidence_label("PRD 기준", true), "PRD criteria");
    assert_eq!(
        localized_evidence_label("범위 확장 근거", true),
        "Scope expansion evidence"
    );
    // Caller-provided data (criterion text, filenames) must pass through even
    // in English so we never overwrite real evidence with a generic label.
    assert_eq!(
        localized_evidence_label("User sees Saved on the button", true),
        "User sees Saved on the button"
    );
    assert_eq!(
        localized_evidence_label("src/Button.tsx", true),
        "src/Button.tsx"
    );
}

#[test]
fn supervisor_prompt_contains_only_bounded_context_and_json_instruction() {
    let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
    let prompt = build_supervisor_prompt(&context).unwrap();

    assert!(prompt.contains("Return exactly one JSON object"));
    assert!(prompt.contains("no code fences"));
    assert!(prompt.contains("\"schemaVersion\":1"));
    // The exact decision schema must be spelled out so the model emits the
    // contract keys (provoke/concern/severity) and not an invented shape.
    assert!(prompt.contains("provoke"));
    assert!(prompt.contains(P1_CONCERN));
    assert!(prompt.contains("Do not invent other keys"));
    // The question field must be interrogative and end with '?' so the
    // deterministic is_question check accepts it (avoids NotQuestion drops).
    assert!(prompt.contains("end with '?'"));
    assert!(!prompt.contains("\"enabledTools\""));
    assert!(!prompt.contains("dive_context"));
    assert!(!prompt.contains("AGENTS.md"));
    assert!(!prompt.contains(".specify"));
}

#[test]
fn supervisor_prompt_instructs_english_question_for_en_locale() {
    let mut context = sample_context_with_event(SupervisorEvent::VerifyEntered);
    context.locale = "en-US".to_string();
    let prompt = build_supervisor_prompt(&context).unwrap();

    assert!(prompt.contains("written in English"));
    assert!(!prompt.contains("written in Korean"));
}

#[test]
fn supervisor_prompt_instructs_korean_question_for_non_en_locale() {
    let mut context = sample_context_with_event(SupervisorEvent::VerifyEntered);
    context.locale = "ko-KR".to_string();
    let prompt = build_supervisor_prompt(&context).unwrap();

    assert!(prompt.contains("written in Korean"));
    assert!(!prompt.contains("written in English"));

    context.locale.clear();
    let default_prompt = build_supervisor_prompt(&context).unwrap();
    assert!(default_prompt.contains("written in Korean"));
    assert!(!default_prompt.contains("written in English"));
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
    assert_eq!(
        serde_json::to_value(SupervisorEvent::PlanDrafted).unwrap(),
        json!("plan_drafted")
    );
    assert_eq!(
        serde_json::to_value(SupervisorActionId::AddVerificationStep).unwrap(),
        json!("add_verification_step")
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
    let result = validate_supervisor_decision(&context, decision, &mut SupervisorDedupState::new());

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
    let result = validate_supervisor_decision(&context, decision, &mut SupervisorDedupState::new());
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
    // Regression: English locale yields English supervisor card strings.
    assert_eq!(
        card_title_for_event(SupervisorEvent::VerifyEntered, "en-US"),
        "Needs verification"
    );
    assert_eq!(
        card_message_for_event(SupervisorEvent::AiClaimedDone, "en"),
        "Look at verifiable evidence first."
    );
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
fn supervisor_parse_accepts_markdown_fenced_json_object() {
    // Real LLM output (both gpt and claude) wraps the decision JSON in a
    // ```json code fence. A valid decision must still be parsed and shown.
    let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
    let decision = build_stage_c_supervisor_decision(&context);
    let body = serde_json::to_string(&decision).unwrap();
    let fenced = format!("```json\n{body}\n```");

    let mut dedup = SupervisorDedupState::new();
    let result = validate_supervisor_decision_json(&context, &fenced, &mut dedup);
    assert_eq!(
        result.validation_outcome,
        SupervisorValidationOutcome::Shown,
        "fenced-but-valid supervisor JSON must parse, not drop as parse_error"
    );
}

#[test]
fn supervisor_parse_accepts_json_with_surrounding_prose() {
    // Some models prepend a short explanation before the JSON object.
    let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
    let decision = build_stage_c_supervisor_decision(&context);
    let body = serde_json::to_string(&decision).unwrap();
    let with_prose = format!("Here is the decision:\n{body}\nLet me know if you need more.");

    let mut dedup = SupervisorDedupState::new();
    let result = validate_supervisor_decision_json(&context, &with_prose, &mut dedup);
    assert_eq!(
        result.validation_outcome,
        SupervisorValidationOutcome::Shown,
        "valid supervisor JSON wrapped in prose must parse, not drop as parse_error"
    );
}

#[test]
fn supervisor_parse_still_errors_on_truly_malformed_json() {
    // Guard: extraction must not paper over genuinely malformed output.
    let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
    let mut dedup = SupervisorDedupState::new();
    let result =
        validate_supervisor_decision_json(&context, "```json\nnot json at all\n```", &mut dedup);
    assert_eq!(
        result.validation_outcome,
        SupervisorValidationOutcome::Error
    );
    assert_eq!(result.drop_reason, Some(SupervisorDropReason::ParseError));
}

#[test]
fn supervisor_parse_rejects_invented_evaluation_schema() {
    // Observed live failure: the model returned a plausible but wrong shape
    // (passed/confidence/rationale/criterionKey) instead of the contract's
    // provoke/concern/severity. That must surface as parse_error — the
    // prompt, not lenient parsing, is responsible for the correct schema.
    let context = sample_context_with_event(SupervisorEvent::VerifyEntered);
    let invented = r#"{"schemaVersion":1,"passed":false,"confidence":0.41,"rationale":"no evidence","criterionKey":"artifact_correctness","question":"실제로 있나요?","evidenceRefIds":["agent.assistant_claim"],"suggestedActionIds":["open_diff"]}"#;
    let mut dedup = SupervisorDedupState::new();
    let result = validate_supervisor_decision_json(&context, invented, &mut dedup);
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

#[test]
fn supervisor_plan_drafted_gate_and_mapping_use_assessment() {
    let context = sample_plan_drafted_context();
    assert!(supervisor_provoke_gate(&context));

    let mut dedup = SupervisorDedupState::new();
    let result = validate_supervisor_decision(&context, valid_plan_drafted_decision(), &mut dedup);
    assert_eq!(
        result.validation_outcome,
        SupervisorValidationOutcome::Shown
    );
    let card = result.card.as_ref().unwrap();
    assert_eq!(card.card_type, ProvocationCardType::PlanDraftReview);
    assert_eq!(card.stage, ProvocationCardStage::Instruct);
    assert_eq!(card.metadata["supervisorEvent"], json!("plan_drafted"));

    let log = SupervisorEvaluationLog::from_validation(&context, None, &result, None, None, None);
    assert_eq!(log.event, SupervisorEvent::PlanDrafted);
    assert!(log.assessment_summary.is_some());
}

#[test]
fn supervisor_diff_ready_and_retry_loop_gate_and_map_card_types() {
    let cases = [
        (
            sample_diff_ready_context(),
            decision_for(
                DIFF_READY_CONCERN,
                "이 변경 파일이 현재 목표 범위 안에 있나요?",
                vec!["diff.changed_files"],
                vec!["open_diff", "ask_ai_for_rationale"],
            ),
            ProvocationCardType::DiffScopeReview,
        ),
        (
            sample_retry_loop_context(),
            decision_for(
                RETRY_LOOP_CONCERN,
                "같은 실패가 반복되니 먼저 재현 단계를 좁혀볼까요?",
                vec!["failure.fingerprint"],
                vec!["create_repro_steps", "rollback_last_change"],
            ),
            ProvocationCardType::RetryLoopReview,
        ),
    ];

    for (context, decision, expected_type) in cases {
        assert!(supervisor_provoke_gate(&context));
        let mut dedup = SupervisorDedupState::new();
        let result = validate_supervisor_decision(&context, decision, &mut dedup);
        assert_eq!(
            result.validation_outcome,
            SupervisorValidationOutcome::Shown
        );
        let card = result.card.unwrap();
        assert_eq!(card.card_type, expected_type);
        assert_eq!(card.stage, ProvocationCardStage::Verify);
    }
}

#[test]
fn supervisor_diff_ready_card_metadata_carries_high_risk_files() {
    let context = sample_diff_ready_context();
    let question = "이 변경 파일이 현재 목표 범위 안에 있나요?";
    let decision = decision_for(
        DIFF_READY_CONCERN,
        question,
        vec!["diff.changed_files"],
        vec!["open_diff", "ask_ai_for_rationale"],
    );

    let result = validate_supervisor_decision(&context, decision, &mut SupervisorDedupState::new());

    assert_eq!(
        result.validation_outcome,
        SupervisorValidationOutcome::Shown
    );
    let card = result.card.unwrap();
    assert_eq!(card.card_type, ProvocationCardType::DiffScopeReview);
    assert_eq!(card.stage, ProvocationCardStage::Verify);
    assert_eq!(card.severity, ProvocationSeverity::Caution);
    assert_eq!(card.prompt.as_deref(), Some(question));
    assert_eq!(
        card.metadata["assessmentSummary"]["highRiskFiles"],
        json!(["src/auth.ts"])
    );
    assert!(card
        .actions
        .iter()
        .all(|action| action.requires_reason != Some(true)));
}

#[test]
fn supervisor_diff_ready_unexpected_only_card_has_no_high_risk_files() {
    let mut context = sample_diff_ready_context();
    let assessment = context.diff_ready_assessment.as_mut().unwrap();
    assessment.reason_codes = vec!["unexpected_file".into()];
    assessment.unexpected_files = vec!["src/settings.ts".into()];
    assessment.high_risk_files = vec![];
    context.context_hash = context.compute_context_hash();

    let result = validate_supervisor_decision(
        &context,
        decision_for(
            DIFF_READY_CONCERN,
            "이 변경 파일이 현재 목표 범위 안에 있나요?",
            vec!["diff.changed_files"],
            vec!["open_diff"],
        ),
        &mut SupervisorDedupState::new(),
    );

    assert_eq!(
        result.validation_outcome,
        SupervisorValidationOutcome::Shown
    );
    let card = result.card.unwrap();
    assert_eq!(
        card.metadata["assessmentSummary"]["unexpectedFiles"],
        json!(["src/settings.ts"])
    );
    assert!(card.metadata["assessmentSummary"]["highRiskFiles"]
        .as_array()
        .is_some_and(|files| files.is_empty()));
}

#[test]
fn supervisor_diff_ready_gate_covers_scope_drift_edges() {
    let unexpected = sample_diff_ready_context();
    assert!(supervisor_provoke_gate(&unexpected));

    let mut high_risk = sample_diff_ready_context();
    high_risk
        .diff_ready_assessment
        .as_mut()
        .unwrap()
        .reason_codes = vec!["high_risk_area".into()];
    high_risk
        .diff_ready_assessment
        .as_mut()
        .unwrap()
        .unexpected_files = vec![];
    high_risk.context_hash = high_risk.compute_context_hash();
    assert!(supervisor_provoke_gate(&high_risk));

    let mut expected_only = sample_diff_ready_context();
    expected_only
        .diff_ready_assessment
        .as_mut()
        .unwrap()
        .eligible = false;
    expected_only
        .diff_ready_assessment
        .as_mut()
        .unwrap()
        .reason_codes = vec![];
    expected_only
        .diff_ready_assessment
        .as_mut()
        .unwrap()
        .unexpected_files = vec![];
    expected_only
        .diff_ready_assessment
        .as_mut()
        .unwrap()
        .high_risk_files = vec![];
    expected_only.context_hash = expected_only.compute_context_hash();
    assert!(!supervisor_provoke_gate(&expected_only));

    let mut no_changed_files = sample_diff_ready_context();
    no_changed_files
        .diff_ready_assessment
        .as_mut()
        .unwrap()
        .changed_file_count = 0;
    no_changed_files.context_hash = no_changed_files.compute_context_hash();
    assert!(!supervisor_provoke_gate(&no_changed_files));

    let mut missing_assessment_evidence = sample_diff_ready_context();
    missing_assessment_evidence
        .diff_ready_assessment
        .as_mut()
        .unwrap()
        .evidence_refs = vec![];
    missing_assessment_evidence.context_hash = missing_assessment_evidence.compute_context_hash();
    assert!(!supervisor_provoke_gate(&missing_assessment_evidence));
}

#[test]
fn supervisor_diff_ready_validation_drops_missing_or_unknown_evidence_refs() {
    let context = sample_diff_ready_context();

    let no_evidence = decision_for(
        DIFF_READY_CONCERN,
        "이 변경 파일이 현재 목표 범위 안에 있나요?",
        vec![],
        vec!["open_diff"],
    );
    let result =
        validate_supervisor_decision(&context, no_evidence, &mut SupervisorDedupState::new());
    assert_eq!(
        result.drop_reason,
        Some(SupervisorDropReason::MissingEvidence)
    );

    let unknown_evidence = decision_for(
        DIFF_READY_CONCERN,
        "이 변경 파일이 현재 목표 범위 안에 있나요?",
        vec!["diff.raw_hunk"],
        vec!["open_diff"],
    );
    let result =
        validate_supervisor_decision(&context, unknown_evidence, &mut SupervisorDedupState::new());
    assert_eq!(
        result.drop_reason,
        Some(SupervisorDropReason::UnknownEvidenceRef)
    );
}

#[test]
fn supervisor_retry_loop_gate_covers_repeated_failure_edges() {
    let repeated = sample_retry_loop_context();
    assert!(supervisor_provoke_gate(&repeated));

    let mut one_failure = sample_retry_loop_context();
    one_failure
        .retry_loop_assessment
        .as_mut()
        .unwrap()
        .failure_count = 1;
    one_failure.context_hash = one_failure.compute_context_hash();
    assert!(!supervisor_provoke_gate(&one_failure));

    let mut different_failure = sample_retry_loop_context();
    different_failure
        .retry_loop_assessment
        .as_mut()
        .unwrap()
        .failure_fingerprint = "different_failure".into();
    different_failure
        .retry_loop_assessment
        .as_mut()
        .unwrap()
        .failure_count = 1;
    different_failure.context_hash = different_failure.compute_context_hash();
    assert!(!supervisor_provoke_gate(&different_failure));

    let mut success_reset = sample_retry_loop_context();
    success_reset.verification_state.test_result = Some(TestResult::Pass);
    success_reset.context_hash = success_reset.compute_context_hash();
    assert!(!supervisor_provoke_gate(&success_reset));

    let mut missing_evidence = sample_retry_loop_context();
    missing_evidence
        .retry_loop_assessment
        .as_mut()
        .unwrap()
        .evidence_refs = vec![];
    missing_evidence.context_hash = missing_evidence.compute_context_hash();
    assert!(!supervisor_provoke_gate(&missing_evidence));
}

#[test]
fn supervisor_retry_loop_deduplicates_same_failure_evidence_hash() {
    let context = sample_retry_loop_context();
    let decision = decision_for(
        RETRY_LOOP_CONCERN,
        "같은 실패가 반복되니 먼저 재현 단계를 좁혀볼까요?",
        vec!["failure.fingerprint"],
        vec!["create_repro_steps", "rollback_last_change"],
    );
    let mut dedup = SupervisorDedupState::new();
    let first = validate_supervisor_decision(&context, decision.clone(), &mut dedup);
    assert_eq!(first.validation_outcome, SupervisorValidationOutcome::Shown);

    let second = validate_supervisor_decision(&context, decision, &mut dedup);
    assert_eq!(
        second.validation_outcome,
        SupervisorValidationOutcome::Dropped
    );
    assert_eq!(second.drop_reason, Some(SupervisorDropReason::Duplicate));
}

#[test]
fn supervisor_expanded_gate_rejects_missing_assessment_evidence() {
    let mut context = sample_plan_drafted_context();
    context.plan_draft_assessment.as_mut().unwrap().eligible = false;
    context.context_hash = context.compute_context_hash();
    assert!(!supervisor_provoke_gate(&context));

    let mut dedup = SupervisorDedupState::new();
    let result = validate_supervisor_decision(&context, valid_plan_drafted_decision(), &mut dedup);
    assert_eq!(
        result.validation_outcome,
        SupervisorValidationOutcome::Dropped
    );
    assert_eq!(
        result.drop_reason,
        Some(SupervisorDropReason::MissingEvidence)
    );
}
