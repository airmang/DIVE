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
  | "continue_with_risk"
  | "dismiss"
  | "mark_irrelevant";

export interface ProvocationAction {
  id: string;
  label: string;
  kind: ProvocationActionKind;
  requiresReason?: boolean;
}

export interface ProvocationCard {
  id: string;
  type: ProvocationCardType;
  stage: DiveStage;
  severity: ProvocationSeverity;
  title: string;
  message: string;
  evidence: ProvocationEvidence[];
  actions: ProvocationAction[];
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
  externalTestRun?: boolean;
  failedButAccepted?: boolean;
  approvedWithRisk?: boolean;
}

export interface ProvocationContext {
  mode: ScaffoldMode;
  stage: DiveStage;
  projectId?: number | string | null;
  sessionId?: number | string | null;
  featureId?: number | string | null;
  taskId?: number | string | null;
  goalText?: string;
  acceptanceCriteria?: string[];
  currentFeatureTitle?: string;
  promptDraft?: string;
  planSteps?: ProvocationPlanStep[];
  changedFiles?: ProvocationChangedFile[];
  targetFiles?: string[];
  verification?: ProvocationVerification;
  recentErrors?: Array<{ message: string; normalizedMessage?: string; occurredAt: string }>;
  retryCountForCurrentError?: number;
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
