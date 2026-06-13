export type DiveStage =
  | "decompose"
  | "instruct"
  | "execute"
  | "verify"
  | "extend"
  | "finalApproval";

export type ScaffoldMode = "guided" | "standard" | "expert";

export type ProvocationSeverity = "info" | "caution" | "risk";

export type ProvocationCardType =
  | "oversized_scope"
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
  | "history";

export interface ProvocationEvidence {
  label: string;
  value?: string;
  source: ProvocationEvidenceSource;
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
  externalTestRun?: boolean;
  failedButAccepted?: boolean;
  approvedWithRisk?: boolean;
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
  mode: ScaffoldMode;
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

export type VerificationStatusId =
  | "ai_self_report_only"
  | "diff_reviewed"
  | "app_launched"
  | "preview_checked"
  | "automated_tests_passed"
  | "external_test_not_run"
  | "failed_but_accepted"
  | "approved_with_risk";

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
  | "risk_approval";

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
  | "failed_but_accepted";

export type ApprovalDecisionOutcome = "approved" | "approved_with_concern" | "revision_requested";

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
