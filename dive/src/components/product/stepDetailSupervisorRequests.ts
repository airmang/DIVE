import {
  createDiffReadySupervisorRequest,
  createRetryLoopSupervisorRequest,
  normalizeChangedFile,
  type ScaffoldMode,
  type SupervisorEvaluationRequest,
  type SupervisorEvaluationUiState,
} from "../../features/provocation";
import type { ChangedFile } from "../slide-in/types";
import type { VerifyLogView } from "../workmap/types";
import type { RoadmapStep } from "../../features/roadmap";

export interface StepDetailProvocation {
  enabled: boolean;
  mode: ScaffoldMode;
  projectId?: number | null;
  sessionId?: number | null;
}

export interface RetryLoopFailureSnapshot {
  failureFingerprint: string;
  failureSummary: string;
  failureCount: number;
  lastFailureAt: number | string;
  lastOccurrenceKey: string;
}

/**
 * Pure builders for the three supervisor evaluation requests StepDetailSlideIn
 * fires on verify entry. Extracted from the component's useMemos so the
 * request-shaping logic is unit-testable; `locale` is passed in (read
 * imperatively at memo time by the caller) to keep them side-effect free.
 */
export function buildSupervisorEvaluationRequest(input: {
  step: RoadmapStep | null;
  supervisorUiState: SupervisorEvaluationUiState | null;
  provocation: StepDetailProvocation | undefined;
  previewOpened: boolean;
  locale: string;
}): SupervisorEvaluationRequest | null {
  const { step, supervisorUiState, provocation, previewOpened, locale } = input;
  if (
    !step ||
    !supervisorUiState ||
    !provocation?.enabled ||
    typeof provocation.sessionId !== "number"
  )
    return null;
  // Keep preview-open transitions as reevaluation triggers without recording them as evidence.
  void previewOpened;
  return {
    sessionId: provocation.sessionId,
    event: "verify_entered",
    artifactRef: {
      kind: "step",
      id: String(step.id),
      label: step.title || `Step ${step.position}`,
    },
    sourceUiMode: provocation.mode,
    locale,
    uiState: supervisorUiState,
  };
}

export function buildDiffReadySupervisorRequest(input: {
  step: RoadmapStep | null;
  supervisorUiState: SupervisorEvaluationUiState | null;
  provocation: StepDetailProvocation | undefined;
  changedFiles: ChangedFile[];
  verifyState: "idle" | "running" | "error";
  verifyTestResult: VerifyLogView["test_result"] | null | undefined;
  planContextPurpose: string | null | undefined;
  verificationPlanText: string | null;
  expectedFiles: string[];
  diffViewed: boolean;
  stepKind: string | null | undefined;
  locale: string;
}) {
  const {
    step,
    supervisorUiState,
    provocation,
    changedFiles,
    verifyState,
    verifyTestResult,
    planContextPurpose,
    verificationPlanText,
    expectedFiles,
    diffViewed,
    stepKind,
    locale,
  } = input;
  if (
    !step ||
    !supervisorUiState ||
    !provocation?.enabled ||
    typeof provocation.sessionId !== "number" ||
    changedFiles.length === 0 ||
    verifyState === "error" ||
    verifyTestResult === "fail"
  ) {
    return null;
  }
  const goalSummary = [step.title, step.description].filter(Boolean).join("\n");
  const stepSummary = [
    step.title,
    step.description,
    step.assistSummary,
    planContextPurpose,
    verificationPlanText,
  ]
    .filter(Boolean)
    .join("\n");
  return createDiffReadySupervisorRequest({
    sessionId: provocation.sessionId,
    projectId: typeof provocation.projectId === "number" ? provocation.projectId : undefined,
    stepId: step.id,
    stepTitle: step.title || `Step ${step.position}`,
    sourceUiMode: provocation.mode,
    locale,
    goalSummary,
    stepSummary,
    changedFiles: changedFiles.map((file) => normalizeChangedFile({ path: file.path })),
    expectedFiles,
    diffViewed,
    stepKind: stepKind ?? null,
    uiState: supervisorUiState,
  });
}

export function buildRetryLoopSupervisorRequest(input: {
  step: RoadmapStep | null;
  supervisorUiState: SupervisorEvaluationUiState | null;
  retryLoopSnapshot: RetryLoopFailureSnapshot | null;
  provocation: StepDetailProvocation | undefined;
  planContextPurpose: string | null | undefined;
  verificationPlanText: string | null;
  rollbackAvailable: boolean;
  locale: string;
}) {
  const {
    step,
    supervisorUiState,
    retryLoopSnapshot,
    provocation,
    planContextPurpose,
    verificationPlanText,
    rollbackAvailable,
    locale,
  } = input;
  if (
    !step ||
    !supervisorUiState ||
    !retryLoopSnapshot ||
    retryLoopSnapshot.failureCount < 2 ||
    !provocation?.enabled ||
    typeof provocation.sessionId !== "number"
  ) {
    return null;
  }
  const goalSummary = [step.title, step.description].filter(Boolean).join("\n");
  const stepSummary = [
    step.title,
    step.description,
    step.assistSummary,
    planContextPurpose,
    verificationPlanText,
  ]
    .filter(Boolean)
    .join("\n");
  return createRetryLoopSupervisorRequest({
    sessionId: provocation.sessionId,
    projectId: typeof provocation.projectId === "number" ? provocation.projectId : undefined,
    stepId: step.id,
    stepTitle: step.title || `Step ${step.position}`,
    sourceUiMode: provocation.mode,
    locale,
    goalSummary,
    stepSummary,
    failureSummary: retryLoopSnapshot.failureSummary,
    failureCount: retryLoopSnapshot.failureCount,
    lastFailureAt: retryLoopSnapshot.lastFailureAt,
    recoveryAvailable: rollbackAvailable,
    lastActionSummary: "verification_failed",
    uiState: supervisorUiState,
  });
}
