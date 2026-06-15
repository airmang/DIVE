export type SupervisorMode = "work" | "guided";

export type LegacyScaffoldMode = "standard" | "expert";

export type ScaffoldMode = SupervisorMode;

export type SupervisorSourceUiMode = ScaffoldMode | LegacyScaffoldMode;

export type DiveStage =
  | "decompose"
  | "instruct"
  | "execute"
  | "verify"
  | "extend"
  | "finalApproval";

export type ProvocationSeverity = "info" | "caution" | "risk";

export type ProvocationCardType =
  | "oversized_scope"
  | "scope_expansion"
  | "missing_acceptance_criteria"
  | "missing_verification_step"
  | "diff_scope_drift"
  | "ai_self_report_only"
  | "regeneration_loop";

export type ProvocationEvidenceSource =
  | "goal"
  | "plan"
  | "prompt"
  | "diff"
  | "verification"
  | "terminal"
  | "agent"
  | "workmap"
  | "history"
  | "ui_observation";

export interface ProvocationEvidence {
  refId?: string;
  label: string;
  value?: string;
  source: ProvocationEvidenceSource;
  kind?: string;
  verificationEvidence?: boolean;
}

export type ProvocationActionKind =
  | "add_acceptance_criteria"
  | "split_scope"
  | "add_verification_step"
  | "open_diff"
  | "ask_ai_for_rationale"
  | "revert_unrelated_changes"
  | "run_app"
  | "run_tests"
  | "open_preview"
  | "create_repro_steps"
  | "rollback_last_change"
  | "retry_with_ai"
  | "continue_with_risk"
  | "dismiss"
  | "mark_irrelevant";

export interface ProvocationAction {
  id: string;
  label: string;
  kind: ProvocationActionKind;
  requiresReason?: boolean;
  reasonPrompt?: string;
  disabledReason?: string;
  todoId?: string;
}

export interface ProvocationCard {
  id: string;
  type: ProvocationCardType;
  stage: DiveStage;
  severity: ProvocationSeverity;
  title: string;
  /** The question the student must answer using the material (Sarkar axis 1). */
  prompt?: string;
  message: string;
  evidence: ProvocationEvidence[];
  actions: ProvocationAction[];
  /** id of the action that routes into the material; rendered as the primary affordance. */
  primaryActionId?: string;
  modeCopy?: {
    work?: string;
    guided?: string;
    standard?: string;
    expert?: string;
  };
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ProvocationPlanStep {
  id: string;
  text: string;
  kind?: string;
  expectedFiles?: string[];
  verificationCommand?: string | null;
  verificationManualCheck?: string | null;
  dependencies?: string[];
  parallelGroup?: string | number | null;
}

export type ChangedFileCategory =
  | "ui"
  | "logic"
  | "config"
  | "dependency"
  | "auth"
  | "db"
  | "test"
  | "routing"
  | "unknown";

export interface ProvocationChangedFile {
  path: string;
  changeType?: "added" | "modified" | "deleted" | "renamed";
  category?: ChangedFileCategory;
}

export interface ProvocationVerification {
  aiClaimedDone?: boolean;
  diffReviewed?: boolean;
  appLaunched?: boolean;
  previewChecked?: boolean;
  manualChecks?: string[];
  automatedTestsPassed?: boolean;
  testResult?: "pass" | "fail" | "skipped";
  acceptanceCriterionConfirmed?: boolean;
  externalTestRun?: boolean;
  failedButAccepted?: boolean;
  approvedWithRisk?: boolean;
  verificationDeferred?: boolean;
  approvalProvenance?: ApprovalProvenance | null;
}

export interface ProvocationAssistantReport {
  source: "assistant_message" | "verify_log";
  messageId?: string;
  createdAt?: number | string;
}

export interface ProvocationRetrySignal {
  errorKey: string;
  retryCount: number;
  retryPhrases: string[];
  lastUserMessageId?: string;
  rollbackOrReproMentioned?: boolean;
  scopeNarrowed?: boolean;
}

export interface ProvocationContext {
  mode: SupervisorSourceUiMode;
  stage: DiveStage;
  projectId?: number | string | null;
  sessionId?: number | string | null;
  featureId?: number | string | null;
  taskId?: number | string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  goalText?: string;
  acceptanceCriteria?: string[];
  currentFeatureTitle?: string;
  promptDraft?: string;
  planSteps?: ProvocationPlanStep[];
  changedFiles?: ProvocationChangedFile[];
  targetFiles?: string[];
  verification?: ProvocationVerification;
  assistantReports?: ProvocationAssistantReport[];
  approvalProvenance?: ApprovalProvenance | null;
  recentErrors?: Array<{ message: string; normalizedMessage?: string; occurredAt: string }>;
  retryCountForCurrentError?: number;
  retrySignals?: ProvocationRetrySignal[];
  userHasViewedDiff?: boolean;
  userHasViewedPreview?: boolean;
  userHasViewedTestResult?: boolean;
}

export type SupervisorEvent = "ai_claimed_done" | "verify_entered";

export type SupervisorEvaluationStatus = "shown" | "none" | "dropped";

export type SupervisorValidationOutcome = SupervisorEvaluationStatus | "error";

export type SupervisorDropReason =
  | "provoke_false"
  | "runtime_unavailable"
  | "timeout"
  | "sidecar_error"
  | "parse_error"
  | "schema_version_unsupported"
  | "invalid_mode"
  | "missing_evidence"
  | "unknown_evidence_ref"
  | "not_question"
  | "unknown_action"
  | "disallowed_concern"
  | "duplicate"
  | "cooldown"
  | "ambiguous_decision"
  | "context_too_large"
  | "content_too_long";

export type SupervisorAllowedActionId = Extract<
  ProvocationActionKind,
  "open_diff" | "open_preview" | "run_tests" | "run_app"
>;

export interface SupervisorArtifactRef {
  kind: "step";
  id: string;
  label: string;
}

export interface SupervisorPlanSummary {
  stepCount: number;
  activeStep?: string | null;
}

export interface SupervisorVerificationSnapshot {
  aiClaimedDone: boolean;
  diffReviewed: boolean;
  appLaunched: boolean;
  previewChecked: boolean;
  automatedTestsPassed: boolean;
  testResult: ProvocationVerification["testResult"] | null;
  acceptanceCriterionConfirmed?: boolean;
  manualChecks: string[];
}

export interface SupervisorFeasibility {
  runnable: boolean;
  previewable: boolean;
  hasTests: boolean;
  diffAvailable: boolean;
}

export interface SupervisorEvaluationRequest {
  sessionId: number;
  event: "verify_entered";
  artifactRef: SupervisorArtifactRef;
  sourceUiMode: SupervisorSourceUiMode;
  locale?: string;
  uiState: {
    goalSummary?: string;
    planSummary?: SupervisorPlanSummary;
    verification: SupervisorVerificationSnapshot;
    feasibility: SupervisorFeasibility;
  };
}

export type SupervisorEvaluationResponse =
  | {
      status: "shown";
      evaluationId: string;
      card: ProvocationCard;
    }
  | {
      status: "none" | "dropped";
      evaluationId: string;
      dropReason: SupervisorDropReason;
    };

export type VerificationStatusId =
  | "ai_self_report_only"
  | "diff_reviewed"
  | "app_launched"
  | "preview_checked"
  | "automated_tests_passed"
  | "external_test_not_run"
  | "failed_but_accepted"
  | "approved_with_risk"
  | "verification_deferred";

export interface VerificationStatusItem {
  id: VerificationStatusId;
  label: string;
  evidenceBacked: boolean;
  tone: "info" | "success" | "warn" | "risk";
}

export type VerificationProvenanceSource =
  | "ai_self_report"
  | "diff_review"
  | "app_launch"
  | "preview"
  | "automated_test"
  | "external_test"
  | "manual_check"
  | "risk_approval"
  | "deferred_verification";

export interface VerificationProvenanceItem extends VerificationStatusItem {
  source: VerificationProvenanceSource;
  recordedAt?: number;
}

export interface VerificationEvidenceSummary {
  concreteEvidence: boolean;
  aiSelfReport: boolean;
  automatedTestsPassed: boolean;
  externalTestRun: boolean | null;
  testResult: "pass" | "fail" | "skipped" | null;
  manualEvidenceCount: number;
  evidenceLabels: string[];
}

export type ApprovalVerificationState =
  | "verified_with_evidence"
  | "unverified_risk_accepted"
  | "failed_but_accepted"
  | "verification_deferred";

export type ApprovalDecisionOutcome =
  | "approved"
  | "approved_with_concern"
  | "revision_requested"
  | "verification_deferred";

export interface ApprovalProvenance {
  schemaVersion: 1;
  verificationState: ApprovalVerificationState;
  statuses: VerificationProvenanceItem[];
  statusIds: VerificationStatusId[];
  evidenceSummary: VerificationEvidenceSummary;
  riskAccepted: boolean;
  riskReason: string | null;
  approvalOutcome?: ApprovalDecisionOutcome;
  decidedAt?: number;
}
