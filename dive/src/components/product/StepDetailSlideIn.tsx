import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  ExternalLink,
  FileCode,
  X,
} from "lucide-react";
import { Button } from "../ui/button";
import { LearningHint } from "../ui/learning-hint";
import { cn } from "../../lib/utils";
import {
  agencyToneClass,
  deriveAgencyStateView,
  type AgencyStateItem,
  type RoadmapLinkedCriterion,
  type RoadmapStep,
  type RoadmapStepStatus,
} from "../../features/roadmap";
import type { ChangedFile } from "../slide-in/types";
import type { ApprovalDecision } from "../workmap/ApprovalJudgment";
import type { VerifyLogView } from "../workmap/types";
import { useLocaleStore, useT } from "../../i18n";
import { useChatComposerStore } from "../../stores/chatComposer";
import { DecisionGate } from "./DecisionGate";
import {
  ProvocationCardHost,
  createDiffReadySupervisorRequest,
  createRetryLoopSupervisorRequest,
  deriveVerificationStatuses,
  evaluateProvocationSupervisor,
  highRiskFilesFromDiffScopeCard,
  normalizeFailureFingerprint,
  normalizeChangedFile,
  type ProvocationAction,
  type ProvocationCard,
  type ProvocationContext,
  type DiffReadySupervisorEvaluationRequest,
  type ScaffoldMode,
  type SupervisorEvaluationRequest,
  VERIFICATION_STATUS_LABEL_KEY,
  type VerificationStatusItem,
  useProvocationActionResolver,
} from "../../features/provocation";
import type { SupervisorFeasibility } from "../../features/provocation";
import {
  hasConcreteAutomatedPass,
  hasExecutedTestCommand,
} from "../../features/provocation/verificationGrade";
import type { VerificationCoachGenerateRequest } from "../../features/verification-coach/types";
import type { ObservationEvidenceRecord } from "../../features/verification-coach/types";
import { VerificationCoachPanel } from "./VerificationCoachPanel";
import {
  VerificationReviewStepper,
  type VerificationReviewStage,
} from "./VerificationReviewStepper";

export interface StepDetailSlideInProps {
  open: boolean;
  step: RoadmapStep | null;
  toolCallCount: number;
  verifyLog: VerifyLogView | null;
  verifyState: "idle" | "running" | "error";
  verifyError: string | null;
  changedFiles: ChangedFile[];
  planContext?: {
    expectedFiles: string[];
    verificationCommand?: string | null;
    verificationManualCheck?: string | null;
    verificationKind?: string | null;
    dependencies?: string[];
    parallelGroup?: string | null;
    purpose?: string | null;
  };
  onOpenChange: (open: boolean) => void;
  onOpenCode: () => void;
  onOpenPreview?: () => void;
  onOpenRecovery: () => void;
  onVerifyFirst: () => void;
  onApprovalDecision: (decision: ApprovalDecision) => void;
  onGoToChat: () => void;
  rollbackAvailable: boolean;
  provocation?: {
    enabled: boolean;
    mode: ScaffoldMode;
    projectId?: number | null;
    sessionId?: number | null;
  };
}

const STATUS_CLASS: Record<RoadmapStepStatus, string> = {
  planned: "border-border bg-bg-panel2 text-fg-muted",
  in_progress: "border-accent/60 bg-accent/10 text-accent",
  review: "border-warn/60 bg-warn/10 text-warn",
  done: "border-success/60 bg-success/10 text-success",
  shipped: "border-success/70 bg-success/15 text-success",
};

const REVIEW_SIDEBAR_WIDTH_STORAGE_KEY = "dive.review-sidebar.width";
const REVIEW_SIDEBAR_DEFAULT_WIDTH = 520;
const REVIEW_SIDEBAR_MIN_WIDTH = 380;
const REVIEW_SIDEBAR_MAX_WIDTH = 900;
const REVIEW_SIDEBAR_VIEWPORT_RATIO = 0.8;
const REVIEW_SIDEBAR_KEYBOARD_STEP = 16;

type CriterionEvidenceRef = "preview" | "app" | null;
type VerificationFocusActionKind =
  | "open_preview"
  | "run_app"
  | "run_tests"
  | "open_diff"
  | "go_chat";

interface VerificationFocusAction {
  kind: VerificationFocusActionKind;
  label: string;
  ariaLabel: string;
  disabled?: boolean;
  onClick: () => void;
}

interface RetryLoopFailureSnapshot {
  failureFingerprint: string;
  failureSummary: string;
  failureCount: number;
  lastFailureAt: number | string;
  lastOccurrenceKey: string;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

/**
 * Minimum length for a manual observation to count as substantive evidence
 * (S-029). A bare keystroke or empty string is not an observation.
 */
const MIN_OBSERVATION_LENGTH = 8;

function isSubstantiveObservation(text: string | null | undefined): boolean {
  return typeof text === "string" && text.trim().length >= MIN_OBSERVATION_LENGTH;
}

/**
 * Split a single acceptance-criteria string into the distinct criteria it
 * enumerates (S-029): a multi-AC goal stored as one summary string (e.g.
 * "AC-1 …\nAC-2 …\nAC-3 …") must still gate on EACH criterion, not collapse to
 * one. Falls back to a single criterion for plain one-line text. Used only when
 * the step has no structured `linkedCriteria`.
 */
function splitAcceptanceCriteria(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  let parts = trimmed
    .split(/\r?\n|[;•]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    const markerParts = trimmed
      .split(/(?=\bAC[\s-]?\d+\b)/i)
      .map((part) => part.replace(/^[,\s]+/, "").trim())
      .filter(Boolean);
    if (markerParts.length > 1) parts = markerParts;
  }
  const unique = [...new Set(parts)];
  return unique.length > 0 ? unique : [trimmed];
}

function highRiskFilesFromCards(cards: ProvocationCard[]): string[] {
  return uniqueStrings(cards.flatMap(highRiskFilesFromDiffScopeCard));
}

function diffReadyAssessmentEvidenceCard(
  request: DiffReadySupervisorEvaluationRequest | null,
): ProvocationCard | null {
  const highRiskFiles = request?.diffReadyAssessment.highRiskFiles ?? [];
  if (!request || highRiskFiles.length === 0) return null;

  return {
    id: `diff_ready:deterministic:${request.contextHash ?? request.evidenceHash ?? request.artifactRef.id}`,
    type: "diff_scope_review",
    stage: "verify",
    severity: "caution",
    title: "Diff ready deterministic evidence",
    message: "Deterministic diff-ready assessment evidence.",
    evidence: [],
    actions: [],
    metadata: {
      supervisorEvent: "diff_ready",
      artifactRef: request.artifactRef,
      contextHash: request.contextHash,
      evidenceHash: request.evidenceHash,
      diffReadyAssessment: request.diffReadyAssessment,
    },
    createdAt: "1970-01-01T00:00:00.000Z",
  };
}

function statusIcon(status: RoadmapStepStatus) {
  const cls = "h-3 w-3 shrink-0";
  if (status === "shipped" || status === "done")
    return <CheckCircle2 className={cls} aria-hidden />;
  if (status === "review") return <Clock3 className={cls} aria-hidden />;
  if (status === "in_progress") return <AlertCircle className={cls} aria-hidden />;
  return <Circle className={cls} aria-hidden />;
}

function reviewSidebarMaxWidth(): number {
  if (typeof window === "undefined") return REVIEW_SIDEBAR_MAX_WIDTH;
  return Math.min(
    REVIEW_SIDEBAR_MAX_WIDTH,
    Math.floor(window.innerWidth * REVIEW_SIDEBAR_VIEWPORT_RATIO),
  );
}

function clampReviewSidebarWidth(width: number, maxWidth = reviewSidebarMaxWidth()): number {
  if (!Number.isFinite(width)) return REVIEW_SIDEBAR_DEFAULT_WIDTH;
  return Math.min(maxWidth, Math.max(REVIEW_SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function readStoredReviewSidebarWidth(): number | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(REVIEW_SIDEBAR_WIDTH_STORAGE_KEY);
  if (!stored) return null;
  const parsed = Number.parseInt(stored, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function persistReviewSidebarWidth(width: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REVIEW_SIDEBAR_WIDTH_STORAGE_KEY, String(width));
}

function useReviewSidebarWidth(open: boolean, panelRef: RefObject<HTMLDivElement | null>) {
  const [maxWidth, setMaxWidth] = useState(() => reviewSidebarMaxWidth());
  const [width, setWidth] = useState(() =>
    clampReviewSidebarWidth(REVIEW_SIDEBAR_DEFAULT_WIDTH, reviewSidebarMaxWidth()),
  );

  const applyWidth = (nextWidth: number) => {
    const nextMaxWidth = reviewSidebarMaxWidth();
    const clamped = clampReviewSidebarWidth(nextWidth, nextMaxWidth);
    setMaxWidth(nextMaxWidth);
    setWidth(clamped);
    persistReviewSidebarWidth(clamped);
  };

  useEffect(() => {
    if (!open) return;
    const nextMaxWidth = reviewSidebarMaxWidth();
    const stored = readStoredReviewSidebarWidth();
    setMaxWidth(nextMaxWidth);
    setWidth(clampReviewSidebarWidth(stored ?? REVIEW_SIDEBAR_DEFAULT_WIDTH, nextMaxWidth));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleResize = () => {
      const nextMaxWidth = reviewSidebarMaxWidth();
      setMaxWidth(nextMaxWidth);
      setWidth((current) => {
        const clamped = clampReviewSidebarWidth(current, nextMaxWidth);
        if (clamped !== current) persistReviewSidebarWidth(clamped);
        return clamped;
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [open]);

  const widthFromClientX = (clientX: number): number => {
    const panelRight = panelRef.current?.getBoundingClientRect().right ?? 0;
    const rightEdge = panelRight > 0 ? panelRight : window.innerWidth;
    return rightEdge - clientX;
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    applyWidth(widthFromClientX(event.clientX));
    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      applyWidth(widthFromClientX(moveEvent.clientX));
    };
    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const resetWidth = () => applyWidth(REVIEW_SIDEBAR_DEFAULT_WIDTH);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      applyWidth(width - REVIEW_SIDEBAR_KEYBOARD_STEP);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      applyWidth(width + REVIEW_SIDEBAR_KEYBOARD_STEP);
    }
  };

  return {
    width,
    maxWidth,
    handleMouseDown,
    handleKeyDown,
    resetWidth,
  };
}

export function StepDetailSlideIn({
  open,
  step,
  toolCallCount,
  verifyLog,
  verifyState,
  verifyError,
  changedFiles,
  planContext,
  onOpenChange,
  onOpenCode,
  onOpenPreview,
  onOpenRecovery,
  onVerifyFirst,
  onApprovalDecision,
  onGoToChat,
  rollbackAvailable,
  provocation,
}: StepDetailSlideInProps) {
  const t = useT();
  const pushComposerSeed = useChatComposerStore((s) => s.pushSeed);
  const panelRef = useRef<HTMLDivElement>(null);
  const sidebarWidth = useReviewSidebarWidth(open, panelRef);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [diffViewedStepIds, setDiffViewedStepIds] = useState<Set<number>>(() => new Set());
  const [criterionEvidenceRef, setCriterionEvidenceRef] = useState<CriterionEvidenceRef>(null);
  const [manualObservationsByStep, setManualObservationsByStep] = useState<
    Map<number, ObservationEvidenceRecord[]>
  >(() => new Map());
  const [previewOpenedStepIds, setPreviewOpenedStepIds] = useState<Set<number>>(() => new Set());
  const [appOpenedStepIds, setAppOpenedStepIds] = useState<Set<number>>(() => new Set());
  const retryLoopByStepRef = useRef<Map<number, RetryLoopFailureSnapshot>>(new Map());
  const lastSupervisorEvaluationKeyRef = useRef("");
  const [retryLoopSnapshot, setRetryLoopSnapshot] = useState<RetryLoopFailureSnapshot | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => closeBtnRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setCriterionEvidenceRef(null);
  }, [step?.id]);

  useEffect(() => {
    if (!step) {
      setRetryLoopSnapshot(null);
      return;
    }

    const failureSummary =
      verifyState === "error" && verifyError?.trim()
        ? verifyError
        : verifyLog?.test_result === "fail" && verifyLog.details?.trim()
          ? verifyLog.details
          : null;

    if (!failureSummary || verifyLog?.test_result === "pass") {
      retryLoopByStepRef.current.delete(step.id);
      setRetryLoopSnapshot(null);
      return;
    }

    const failureFingerprint = normalizeFailureFingerprint(failureSummary);
    if (!failureFingerprint) {
      setRetryLoopSnapshot(null);
      return;
    }

    const lastFailureAt = verifyLog?.ran_at ?? Date.now();
    const lastOccurrenceKey = `${failureFingerprint}:${lastFailureAt}`;
    const previous = retryLoopByStepRef.current.get(step.id);
    const failureCount =
      previous?.failureFingerprint === failureFingerprint
        ? previous.lastOccurrenceKey === lastOccurrenceKey
          ? previous.failureCount
          : previous.failureCount + 1
        : 1;
    const next = {
      failureFingerprint,
      failureSummary,
      failureCount,
      lastFailureAt,
      lastOccurrenceKey,
    };
    retryLoopByStepRef.current.set(step.id, next);
    setRetryLoopSnapshot(next);
  }, [
    step,
    verifyError,
    verifyLog?.details,
    verifyLog?.ran_at,
    verifyLog?.test_result,
    verifyState,
  ]);

  const status = step?.status ?? null;
  const isReview = status === "review";
  const hasChangedFiles = changedFiles.length > 0;
  const diffViewed = step ? diffViewedStepIds.has(step.id) : false;
  const previewOpened = step ? previewOpenedStepIds.has(step.id) : false;
  const appOpened = step ? appOpenedStepIds.has(step.id) : false;
  const stepObservations = useMemo(
    () => (step ? (manualObservationsByStep.get(step.id) ?? []) : []),
    [manualObservationsByStep, step],
  );
  const recordedObservations = useMemo(
    () => stepObservations.filter((obs) => isSubstantiveObservation(obs.observationText)),
    [stepObservations],
  );
  const latestObservation =
    stepObservations.length > 0 ? stepObservations[stepObservations.length - 1] : null;
  // Kept for the coach "saved" indicator and the supervisor priorObservations.
  const manualObservation = latestObservation;
  const previewObserved = criterionEvidenceRef === "preview";
  const appLaunched = criterionEvidenceRef === "app";
  const executedTestCommand = hasExecutedTestCommand({
    testCommand: verifyLog?.test_command ?? null,
    testExitCode: verifyLog?.test_exit_code ?? null,
  });
  const automatedTestsPassed = hasConcreteAutomatedPass({
    testResult: verifyLog?.test_result ?? null,
    testCommand: verifyLog?.test_command ?? null,
    testExitCode: verifyLog?.test_exit_code ?? null,
  });
  const externalTestRun = verifyLog ? executedTestCommand : undefined;
  const expectedFiles = useMemo(
    () => uniqueStrings(planContext?.expectedFiles ?? []),
    [planContext?.expectedFiles],
  );
  const actualChangedFiles = useMemo(
    () => uniqueStrings(changedFiles.map((file) => file.path)),
    [changedFiles],
  );
  const verificationPlanText =
    planContext?.verificationCommand?.trim() ||
    planContext?.verificationManualCheck?.trim() ||
    planContext?.verificationKind?.trim() ||
    null;
  const criterionText =
    step?.acceptanceCriteria?.trim() || verificationPlanText || step?.title || "";
  const verificationFeasibility = useMemo<SupervisorFeasibility>(() => {
    const verificationKind = planContext?.verificationKind?.trim().toLowerCase() ?? "";
    const hasTestCommand = Boolean(planContext?.verificationCommand?.trim() || step?.testCommand);
    const previewHandlerAvailable = Boolean(onOpenPreview);
    return {
      runnable: previewHandlerAvailable && verificationKind === "run",
      previewable: previewHandlerAvailable && verificationKind !== "run",
      hasTests: hasTestCommand,
      diffAvailable: hasChangedFiles,
    };
  }, [
    hasChangedFiles,
    onOpenPreview,
    planContext?.verificationCommand,
    planContext?.verificationKind,
    step?.testCommand,
  ]);
  // S-029 (009 theme 2): the decision gate clears only when EVERY gating
  // acceptance criterion carries an action-backed observation. A criterion is
  // covered when a substantive observation references it AND the corresponding
  // open/click/test action actually happened (or no concrete check is feasible).
  // This closes two loopholes: free text alone, and one observation clearing all
  // linked criteria collectively (specs 002/003 FR-030~033: click != evidence).
  const gatingCriteria = useMemo<RoadmapLinkedCriterion[]>(() => {
    const linked = (step?.linkedCriteria ?? []).filter(
      (criterion) => criterion.criterionId.trim().length > 0 && criterion.text.trim().length > 0,
    );
    if (linked.length > 0) return linked;
    if (step && criterionText.trim().length > 0) {
      return splitAcceptanceCriteria(criterionText).map((text, index) => ({
        criterionId: `step-${step.id}-criterion-${index + 1}`,
        text,
      }));
    }
    return [];
  }, [criterionText, step]);
  const concreteVerificationFeasible =
    verificationFeasibility.runnable ||
    verificationFeasibility.previewable ||
    verificationFeasibility.hasTests;
  const observationActionBacked =
    !concreteVerificationFeasible ||
    (verificationFeasibility.previewable && previewOpened) ||
    (verificationFeasibility.runnable && appOpened) ||
    (verificationFeasibility.hasTests && executedTestCommand);
  const observedCriterionIds = useMemo(() => {
    const covered = new Set<string>();
    if (observationActionBacked) {
      for (const observation of recordedObservations) {
        for (const criterionId of observation.criterionIds) covered.add(criterionId);
      }
    }
    // The focal preview/app confirm (CriterionConfirmPanel) already requires the
    // user to have opened the preview/app, so it counts for the focal criterion.
    if (criterionEvidenceRef !== null && gatingCriteria.length > 0) {
      covered.add(gatingCriteria[0].criterionId);
    }
    return covered;
  }, [criterionEvidenceRef, gatingCriteria, observationActionBacked, recordedObservations]);
  const gatingCriterionIds = useMemo(
    () => gatingCriteria.map((criterion) => criterion.criterionId),
    [gatingCriteria],
  );
  const observedCriterionIdList = useMemo(() => [...observedCriterionIds], [observedCriterionIds]);
  const acceptanceCriterionConfirmed =
    gatingCriteria.length > 0 &&
    gatingCriteria.every((criterion) => observedCriterionIds.has(criterion.criterionId));
  // A step with no gating criteria has nothing to observe per-criterion, so the
  // S-029 approve gate permits approval; mirror that in the stepper so the
  // observe/decision green check matches the gate instead of being stuck at
  // "visited" (vacuous satisfaction). Steps WITH criteria stay strict.
  const acceptanceCriteriaSatisfied = acceptanceCriterionConfirmed || gatingCriteria.length === 0;
  const provocationContext: ProvocationContext | null =
    step && provocation?.enabled
      ? {
          mode: provocation.mode,
          stage: isReview ? "finalApproval" : "verify",
          projectId: provocation.projectId,
          sessionId: provocation.sessionId,
          taskId: step.id,
          goalText: [step.title, step.description].filter(Boolean).join("\n"),
          acceptanceCriteria: step.acceptanceCriteria ? [step.acceptanceCriteria] : [],
          planSteps: [
            {
              id: String(step.id),
              text: [
                step.title,
                step.description,
                step.assistSummary,
                step.testCommand,
                planContext?.purpose,
                verificationPlanText,
              ]
                .filter(Boolean)
                .join(" "),
              expectedFiles,
              verificationCommand: planContext?.verificationCommand ?? step.testCommand,
              verificationManualCheck: planContext?.verificationManualCheck ?? null,
              kind: planContext?.verificationKind ?? undefined,
              dependencies: planContext?.dependencies ?? [],
              parallelGroup: planContext?.parallelGroup ?? null,
            },
          ],
          changedFiles: changedFiles.map((file) => normalizeChangedFile({ path: file.path })),
          targetFiles: expectedFiles,
          approvalProvenance: step.approvalProvenance,
          verification: {
            aiClaimedDone: Boolean(verifyLog?.intent_match),
            diffReviewed: diffViewed,
            appLaunched,
            previewChecked: previewObserved,
            automatedTestsPassed,
            testResult: verifyLog?.test_result,
            testCommand: verifyLog?.test_command ?? null,
            testExitCode: verifyLog?.test_exit_code ?? null,
            acceptanceCriterionConfirmed,
            manualChecks: recordedObservations.map((observation) => observation.observationText),
            observationIds: recordedObservations.map((observation) => observation.observationId),
            externalTestRun,
            failedButAccepted: step.approvalProvenance?.verificationState === "failed_but_accepted",
            approvedWithRisk: Boolean(step.approvalProvenance?.riskAccepted),
            approvalProvenance: step.approvalProvenance,
          },
          userHasViewedDiff: diffViewed,
          userHasViewedPreview: previewOpened,
        }
      : null;
  const supervisorUiState = useMemo(() => {
    if (!step) return null;
    return {
      goalSummary: [step.title, step.description].filter(Boolean).join("\n"),
      planSummary: {
        stepCount: 1,
        activeStep: step.title,
      },
      verification: {
        // Entering review with changes is itself an implicit "AI claimed done"
        // signal — do not depend on the model emitting a completion keyword/intent_match.
        aiClaimedDone: Boolean(verifyLog?.intent_match) || (isReview && changedFiles.length > 0),
        diffReviewed: diffViewed,
        appLaunched,
        previewChecked: previewObserved,
        automatedTestsPassed,
        testResult: verifyLog?.test_result ?? "skipped",
        testCommand: verifyLog?.test_command ?? null,
        testExitCode: verifyLog?.test_exit_code ?? null,
        acceptanceCriterionConfirmed,
        manualChecks: manualObservation ? [manualObservation.observationText] : [],
      },
      feasibility: verificationFeasibility,
    };
  }, [
    appLaunched,
    acceptanceCriterionConfirmed,
    diffViewed,
    manualObservation,
    previewObserved,
    step,
    isReview,
    changedFiles,
    automatedTestsPassed,
    verificationFeasibility,
    verifyLog?.intent_match,
    verifyLog?.test_command,
    verifyLog?.test_exit_code,
    verifyLog?.test_result,
  ]);
  const supervisorEvaluationRequest = useMemo<SupervisorEvaluationRequest | null>(() => {
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
      locale: useLocaleStore.getState().locale,
      uiState: supervisorUiState,
    };
  }, [
    previewOpened,
    provocation?.enabled,
    provocation?.mode,
    provocation?.sessionId,
    step,
    supervisorUiState,
  ]);
  const diffReadySupervisorRequest = useMemo(() => {
    if (
      !step ||
      !supervisorUiState ||
      !provocation?.enabled ||
      typeof provocation.sessionId !== "number" ||
      changedFiles.length === 0 ||
      verifyState === "error" ||
      verifyLog?.test_result === "fail"
    ) {
      return null;
    }
    const goalSummary = [step.title, step.description].filter(Boolean).join("\n");
    const stepSummary = [
      step.title,
      step.description,
      step.assistSummary,
      planContext?.purpose,
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
      locale: useLocaleStore.getState().locale,
      goalSummary,
      stepSummary,
      changedFiles: changedFiles.map((file) => normalizeChangedFile({ path: file.path })),
      expectedFiles,
      diffViewed,
      uiState: supervisorUiState,
    });
  }, [
    changedFiles,
    diffViewed,
    expectedFiles,
    planContext?.purpose,
    provocation?.enabled,
    provocation?.mode,
    provocation?.projectId,
    provocation?.sessionId,
    step,
    supervisorUiState,
    verificationPlanText,
    verifyLog?.test_result,
    verifyState,
  ]);
  const retryLoopSupervisorRequest = useMemo(() => {
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
      planContext?.purpose,
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
      locale: useLocaleStore.getState().locale,
      goalSummary,
      stepSummary,
      failureSummary: retryLoopSnapshot.failureSummary,
      failureCount: retryLoopSnapshot.failureCount,
      lastFailureAt: retryLoopSnapshot.lastFailureAt,
      recoveryAvailable: rollbackAvailable,
      lastActionSummary: "verification_failed",
      uiState: supervisorUiState,
    });
  }, [
    planContext?.purpose,
    provocation?.enabled,
    provocation?.mode,
    provocation?.projectId,
    provocation?.sessionId,
    retryLoopSnapshot,
    rollbackAvailable,
    step,
    supervisorUiState,
    verificationPlanText,
  ]);
  const verificationCoachRequest = useMemo<VerificationCoachGenerateRequest | null>(() => {
    if (!step || !isReview || typeof provocation?.sessionId !== "number") return null;
    return {
      sessionId: provocation.sessionId,
      projectId: provocation.projectId ?? null,
      cardId: step.id,
      planStepId: step.id,
      sourceUiMode: provocation.mode,
      locale: useLocaleStore.getState().locale,
      step: {
        title: step.title || `Step ${step.position}`,
        summary: step.description,
        instruction: step.assistSummary,
        acceptanceCriteria: gatingCriteria.map((criterion) => ({
          criterionId: criterion.criterionId,
          text: criterion.text,
        })),
      },
      evidence: {
        changedFiles: actualChangedFiles,
        verificationKind: planContext?.verificationKind ?? null,
        verificationCommand: planContext?.verificationCommand ?? step.testCommand,
        verificationManualCheck: planContext?.verificationManualCheck ?? null,
        testResult: verifyLog?.test_result ?? "skipped",
        aiClaimedDone: Boolean(verifyLog?.intent_match),
        previewAvailable: verificationFeasibility.previewable,
        appRunAvailable: verificationFeasibility.runnable,
        diffAvailable: verificationFeasibility.diffAvailable,
        priorObservations: stepObservations,
      },
    };
  }, [
    actualChangedFiles,
    gatingCriteria,
    stepObservations,
    isReview,
    planContext?.verificationCommand,
    planContext?.verificationKind,
    planContext?.verificationManualCheck,
    provocation?.mode,
    provocation?.projectId,
    provocation?.sessionId,
    step,
    verificationFeasibility.diffAvailable,
    verificationFeasibility.previewable,
    verificationFeasibility.runnable,
    verifyLog?.intent_match,
    verifyLog?.test_result,
  ]);
  const [provocationCards, setProvocationCards] = useState<ProvocationCard[]>([]);
  const [handledProvocationCardIds, setHandledProvocationCardIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    let cancelled = false;
    const requests = [
      retryLoopSupervisorRequest,
      diffReadySupervisorRequest,
      supervisorEvaluationRequest,
    ].filter((request): request is NonNullable<typeof request> => request !== null);
    const requestKey = JSON.stringify(requests);
    if (requests.length === 0) {
      lastSupervisorEvaluationKeyRef.current = "";
      setProvocationCards((current) => (current.length > 0 ? [] : current));
      return () => {
        cancelled = true;
      };
    }
    if (requestKey === lastSupervisorEvaluationKeyRef.current) {
      return () => {
        cancelled = true;
      };
    }
    lastSupervisorEvaluationKeyRef.current = requestKey;

    setProvocationCards((current) => (current.length > 0 ? [] : current));
    void (async () => {
      for (const request of requests) {
        const response = await evaluateProvocationSupervisor(request);
        if (cancelled) return;
        if (response.status === "shown") {
          setProvocationCards([response.card]);
          return;
        }
      }
      setProvocationCards((current) => (current.length > 0 ? [] : current));
    })().catch((err) => {
      if (import.meta.env.DEV) {
        console.warn("supervisor evaluation failed:", err);
      }
      if (!cancelled) setProvocationCards((current) => (current.length > 0 ? [] : current));
    });

    return () => {
      cancelled = true;
    };
  }, [diffReadySupervisorRequest, retryLoopSupervisorRequest, supervisorEvaluationRequest]);
  useEffect(() => {
    const currentCardIds = new Set(provocationCards.map((card) => card.id));
    setHandledProvocationCardIds((current) => {
      const next = new Set([...current].filter((id) => currentCardIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [provocationCards]);
  const diffReadyDeterministicCard = useMemo(
    () => diffReadyAssessmentEvidenceCard(diffReadySupervisorRequest),
    [diffReadySupervisorRequest],
  );
  const decisionProvocationCards = useMemo(
    () =>
      diffReadyDeterministicCard
        ? [...provocationCards, diffReadyDeterministicCard]
        : provocationCards,
    [diffReadyDeterministicCard, provocationCards],
  );
  const unexpectedHighRiskFiles = highRiskFilesFromCards(decisionProvocationCards);
  const reviewCardsEvidenced =
    provocationCards.length > 0 &&
    provocationCards.every((card) => handledProvocationCardIds.has(card.id));
  const verificationStatuses = provocationContext
    ? deriveVerificationStatuses(provocationContext)
    : [];
  const agencyState = step
    ? deriveAgencyStateView({
        goalText: [step.title, step.description].filter(Boolean).join("\n"),
        acceptanceCriteria: step.acceptanceCriteria,
        status,
        changedFiles,
        diffViewed,
        verifyLog,
        approvalProvenance: step.approvalProvenance,
        running: verifyState === "running",
        acceptanceCriterionConfirmed,
      })
    : null;
  const hasSecondaryDetails = Boolean(
    step &&
    (toolCallCount > 0 ||
      changedFiles.length > 0 ||
      step.description ||
      step.acceptanceCriteria ||
      step.assistSummary ||
      verifyLog ||
      verifyState !== "idle" ||
      step.changeSummary ||
      step.retrospective),
  );

  const handleOpenCode = () => {
    if (step) {
      setDiffViewedStepIds((current) => {
        if (current.has(step.id)) return current;
        const next = new Set(current);
        next.add(step.id);
        return next;
      });
    }
    onOpenCode();
  };

  const handleOpenPreview = () => {
    if (!onOpenPreview) return;
    onOpenPreview();
    if (step) {
      setPreviewOpenedStepIds((current) => new Set(current).add(step.id));
    }
  };

  const handleRunApp = () => {
    if (!onOpenPreview) return;
    onOpenPreview();
    if (step) {
      setAppOpenedStepIds((current) => new Set(current).add(step.id));
    }
  };

  const handleProvocationAction = useProvocationActionResolver({
    pushComposerSeed,
    onGoToChat,
    onOpenDiff: handleOpenCode,
    onOpenPreview: handleOpenPreview,
    onRunApp: handleRunApp,
    onRunTests: onVerifyFirst,
    onOpenRecovery,
    feasibility: verificationFeasibility,
    onContinueWithRisk: (reason) =>
      onApprovalDecision({
        outcome: "approved_with_concern",
        note: reason?.trim() || null,
      }),
  });
  const markProvocationCardHandled = (card: ProvocationCard) => {
    setHandledProvocationCardIds((current) => {
      if (current.has(card.id)) return current;
      return new Set(current).add(card.id);
    });
  };
  const handleReviewCardAction = (
    action: ProvocationAction,
    card: ProvocationCard,
    reason?: string,
  ) => {
    markProvocationCardHandled(card);
    handleProvocationAction(action, card, reason);
  };
  const primaryVerificationAction: VerificationFocusAction | null = step
    ? verificationFeasibility.previewable && onOpenPreview
      ? {
          kind: "open_preview",
          label: t("roadmap.step_detail.verify_action_open_preview"),
          ariaLabel: t("roadmap.step_detail.verify_action_open_preview"),
          onClick: handleOpenPreview,
        }
      : verificationFeasibility.runnable && onOpenPreview
        ? {
            kind: "run_app",
            label: t("roadmap.step_detail.verify_action_run_app"),
            ariaLabel: t("roadmap.step_detail.verify_action_run_app"),
            onClick: handleRunApp,
          }
        : verificationFeasibility.diffAvailable
          ? {
              kind: "open_diff",
              label: t("roadmap.step_detail.verify_action_open_diff"),
              ariaLabel: t("roadmap.step_detail.verify_action_open_diff"),
              onClick: handleOpenCode,
            }
          : verificationFeasibility.hasTests
            ? {
                kind: "run_tests",
                label: t("roadmap.step_detail.verify_action_run_tests"),
                ariaLabel: t("roadmap.step_detail.verify_action_run_tests"),
                disabled: verifyState === "running",
                onClick: onVerifyFirst,
              }
            : {
                kind: "go_chat",
                label: t("roadmap.step_detail.go_to_chat"),
                ariaLabel: t("roadmap.step_detail.go_to_chat"),
                onClick: onGoToChat,
              }
    : null;

  const reviewStages: VerificationReviewStage[] = [];
  if (step) {
    reviewStages.push({
      id: "code",
      marker: "1",
      title: t("roadmap.step_detail.stepper_stage_code_title"),
      evidenced: diffViewed,
      summary: diffViewed
        ? t("roadmap.step_detail.stepper_stage_code_summary_done")
        : t("roadmap.step_detail.stepper_stage_code_summary_pending"),
      content: (
        <div className="space-y-3">
          {hasChangedFiles ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenCode}
              aria-label={t("roadmap.step_detail.verify_action_open_diff")}
              data-testid="step-detail-open-code"
            >
              <FileCode />
              {t("roadmap.step_detail.verify_action_open_diff")}
            </Button>
          ) : null}

          <p className="text-[11px] text-fg-muted" data-testid="step-detail-code-summary">
            {t("roadmap.step_detail.stepper_code_files", { count: changedFiles.length })}
          </p>
          {unexpectedHighRiskFiles.length > 0 ? (
            <p
              className="text-[11px] font-medium text-danger"
              data-testid="step-detail-code-high-risk"
            >
              {t("roadmap.step_detail.stepper_code_high_risk", {
                count: unexpectedHighRiskFiles.length,
              })}
            </p>
          ) : null}
        </div>
      ),
    });

    reviewStages.push({
      id: "observe",
      marker: "2",
      title: t("roadmap.step_detail.stepper_stage_observe_title"),
      evidenced: acceptanceCriteriaSatisfied,
      summary: acceptanceCriteriaSatisfied
        ? t("roadmap.step_detail.stepper_stage_observe_summary_done")
        : t("roadmap.step_detail.stepper_stage_observe_summary_pending"),
      content: (
        <div className="space-y-3">
          <VerificationCoachPanel
            request={verificationCoachRequest}
            observation={manualObservation}
            observationActionBacked={observationActionBacked}
            onObservationRecorded={(record) => {
              setManualObservationsByStep((current) => {
                const next = new Map(current);
                const existing = next.get(record.cardId) ?? [];
                // Replace any prior observation that covered the same criterion,
                // then append — so each criterion keeps its latest observation.
                const retained = existing.filter(
                  (observation) =>
                    !observation.criterionIds.some((criterionId) =>
                      record.criterionIds.includes(criterionId),
                    ),
                );
                next.set(record.cardId, [...retained, record]);
                return next;
              });
            }}
          />
          <CriterionConfirmPanel
            hasAcceptanceCriteria={Boolean(step.acceptanceCriteria)}
            criterionEvidenceRef={criterionEvidenceRef}
            previewOpened={previewOpened}
            appOpened={appOpened}
            onConfirmPreview={() => setCriterionEvidenceRef("preview")}
            onConfirmApp={() => setCriterionEvidenceRef("app")}
          />
        </div>
      ),
    });

    if (provocationCards.length > 0) {
      reviewStages.push({
        id: "review-card",
        marker: "3",
        title: t("roadmap.step_detail.stepper_stage_review_title"),
        evidenced: reviewCardsEvidenced,
        summary: t("roadmap.step_detail.stepper_stage_review_summary", {
          count: provocationCards.length,
        }),
        content: (
          <ProvocationCardHost
            className="space-y-2"
            cards={provocationCards}
            context={provocationContext ?? undefined}
            mode={provocation?.mode ?? "standard"}
            onAction={handleReviewCardAction}
            onHandled={markProvocationCardHandled}
          />
        ),
      });
    }

    if (isReview) {
      reviewStages.push({
        id: "decision",
        marker: "4",
        title: t("roadmap.step_detail.stepper_stage_decision_title"),
        evidenced: acceptanceCriteriaSatisfied,
        summary: acceptanceCriteriaSatisfied
          ? t("roadmap.step_detail.stepper_stage_decision_summary_ready")
          : t("roadmap.step_detail.stepper_stage_decision_summary_needs_observation"),
        content: (
          <DecisionGate
            verificationStatuses={verificationStatuses}
            agencyState={agencyState}
            provocationCards={decisionProvocationCards}
            verifyLog={verifyLog}
            rollbackAvailable={rollbackAvailable}
            acceptanceCriterionConfirmed={acceptanceCriterionConfirmed}
            verificationFeasibility={verificationFeasibility}
            gatingCriterionIds={gatingCriterionIds}
            observedCriterionIds={observedCriterionIdList}
            verifyRunning={verifyState === "running"}
            onApprove={() =>
              onApprovalDecision({
                outcome: "approved",
                note: null,
                observationEvidence:
                  recordedObservations.length > 0
                    ? {
                        observationIds: recordedObservations.map(
                          (observation) => observation.observationId,
                        ),
                        manualChecks: recordedObservations.map(
                          (observation) => observation.observationText,
                        ),
                        criterionIds: [
                          ...new Set(
                            recordedObservations.flatMap((observation) => observation.criterionIds),
                          ),
                        ],
                      }
                    : null,
              })
            }
            onAcceptRisk={(reason) =>
              onApprovalDecision({ outcome: "approved_with_concern", note: reason })
            }
            onDeferVerification={() =>
              onApprovalDecision({ outcome: "verification_deferred", note: null })
            }
            onRequestChanges={() =>
              onApprovalDecision({
                outcome: "revision_requested",
                note: t("roadmap.step_detail.decision_request_changes_note"),
              })
            }
            onVerifyFirst={onVerifyFirst}
            onRevert={onOpenRecovery}
            onStop={(note) => onApprovalDecision({ outcome: "revision_requested", note })}
          />
        ),
      });
    }
  }

  return (
    <aside
      ref={panelRef}
      className={cn(
        "fixed right-0 top-0 z-50 flex h-full flex-col border-l bg-bg shadow-xl",
        "transition-transform duration-slide ease-out motion-reduce:duration-0",
        open ? "translate-x-0" : "translate-x-full pointer-events-none",
      )}
      style={{ width: `${sidebarWidth.width}px` }}
      role="dialog"
      aria-modal="false"
      aria-labelledby="step-detail-title"
      data-testid="step-detail-panel"
      data-open={open ? "true" : "false"}
      data-step-id={step?.id ?? ""}
      data-status={status ?? ""}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={REVIEW_SIDEBAR_MIN_WIDTH}
        aria-valuemax={sidebarWidth.maxWidth}
        aria-valuenow={sidebarWidth.width}
        tabIndex={open ? 0 : -1}
        className="absolute left-0 top-0 z-10 h-full w-2 -translate-x-1 cursor-col-resize touch-none border-l border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        onMouseDown={sidebarWidth.handleMouseDown}
        onDoubleClick={sidebarWidth.resetWidth}
        onKeyDown={sidebarWidth.handleKeyDown}
        data-testid="step-detail-resize-handle"
      />
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-muted">
            {t("roadmap.step_detail.title")}
            {step ? ` · ${t("roadmap.step_number", { position: step.position })}` : null}
          </div>
          <h2
            id="step-detail-title"
            className="mt-0.5 truncate text-sm font-bold text-fg"
            data-testid="step-detail-title"
          >
            {step?.title ?? ""}
          </h2>
          {status ? (
            <span
              className={cn(
                "mt-2 inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-semibold",
                STATUS_CLASS[status],
              )}
              data-testid="step-detail-status"
            >
              {statusIcon(status)}
              {t(`roadmap.status_v2.${status}`)}
            </span>
          ) : null}
        </div>
        <Button
          ref={closeBtnRef}
          size="icon"
          variant="ghost"
          onClick={() => onOpenChange(false)}
          aria-label={t("roadmap.step_detail.close")}
          data-testid="step-detail-close"
        >
          <X />
        </Button>
      </header>

      {step ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <LearningHint className="rounded-md border border-info/40 bg-info/5 px-3 py-2 text-[11px]">
            {t("roadmap.step_detail.read_only_note")}
          </LearningHint>

          <VerificationFocusPanel
            criterionText={criterionText}
            verificationPlanText={verificationPlanText}
            action={primaryVerificationAction}
            verificationStatuses={verificationStatuses}
            agencyItems={agencyState?.items ?? []}
          />

          <VerificationReviewStepper
            ariaLabel={t("roadmap.step_detail.stepper_aria")}
            progressLabel={(current, total) =>
              t("roadmap.step_detail.stepper_progress", { current, total })
            }
            previousLabel={t("roadmap.step_detail.stepper_previous")}
            nextLabel={t("roadmap.step_detail.stepper_next")}
            revisitLabel={t("roadmap.step_detail.stepper_revisit")}
            openStageLabel={t("roadmap.step_detail.stepper_open_stage")}
            stages={reviewStages}
          />

          {hasSecondaryDetails ? (
            <details
              className="group mt-3 rounded-md border border-border bg-bg-panel2 px-3 py-2"
              data-testid="step-detail-secondary-details"
            >
              <summary
                className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg [&::-webkit-details-marker]:hidden"
                aria-label={t("roadmap.step_detail.secondary_details_aria")}
              >
                {t("roadmap.step_detail.secondary_details_toggle")}
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-fg-muted transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="pb-1 pt-2">
                {expectedFiles.length > 0 ||
                actualChangedFiles.length > 0 ||
                verificationStatuses.length > 0 ||
                isReview ? (
                  <Section title={t("roadmap.step_detail.section_change_bundle")}>
                    <ChangeEvidenceBundle
                      expectedFiles={expectedFiles}
                      actualChangedFiles={actualChangedFiles}
                      unexpectedHighRiskFiles={unexpectedHighRiskFiles}
                      verificationStatuses={verificationStatuses}
                      rollbackAvailable={rollbackAvailable}
                      diffViewed={diffViewed}
                      verificationPlanText={verificationPlanText}
                    />
                  </Section>
                ) : null}

                {step.description ? (
                  <Section title={t("roadmap.step_detail.section_goal")}>
                    <p
                      className="whitespace-pre-wrap text-sm text-fg"
                      data-testid="step-detail-goal"
                    >
                      {step.description}
                    </p>
                  </Section>
                ) : null}

                {step.acceptanceCriteria ? (
                  <Section title={t("roadmap.step_detail.section_acceptance_criteria")}>
                    <p
                      className="whitespace-pre-wrap text-sm text-fg"
                      data-testid="step-detail-acceptance"
                    >
                      {step.acceptanceCriteria}
                    </p>
                  </Section>
                ) : null}

                {step.assistSummary ? (
                  <Section title={t("roadmap.step_detail.section_instruction")}>
                    <p
                      className="whitespace-pre-wrap text-sm text-fg"
                      data-testid="step-detail-instruction"
                    >
                      {step.assistSummary}
                    </p>
                    {step.testCommand ? (
                      <p className="mt-2 break-all font-mono text-[11px] text-fg-muted">
                        {step.testCommand}
                      </p>
                    ) : null}
                  </Section>
                ) : null}

                <Section title={t("roadmap.step_detail.section_timeline")}>
                  <ul className="space-y-1 text-[11px] text-fg-muted">
                    <li>
                      {t("roadmap.step_detail.section_instruction")}:{" "}
                      <span className="text-fg">
                        {toolCallCount > 0 ? `${toolCallCount}` : "—"}
                      </span>
                    </li>
                    <li>
                      {t("roadmap.step_detail.section_changed_files")}:{" "}
                      <span className="text-fg">{changedFiles.length}</span>
                    </li>
                  </ul>
                </Section>

                {verifyLog || verifyState !== "idle" ? (
                  <Section title={t("roadmap.step_detail.section_verification")}>
                    <VerificationBlock
                      verifyLog={verifyLog}
                      verifyState={verifyState}
                      verifyError={verifyError}
                    />
                  </Section>
                ) : null}

                {step.changeSummary ? (
                  <Section title={t("roadmap.step_detail.section_changed_files")}>
                    <p
                      className="whitespace-pre-wrap text-sm text-fg"
                      data-testid="step-detail-change-summary"
                    >
                      {step.changeSummary}
                    </p>
                  </Section>
                ) : null}

                {step.retrospective ? (
                  <Section title={t("roadmap.step_detail.section_retrospective")}>
                    <p
                      className="whitespace-pre-wrap text-sm text-fg-muted"
                      data-testid="step-detail-retrospective"
                    >
                      {step.retrospective}
                    </p>
                  </Section>
                ) : null}
              </div>
            </details>
          ) : null}

          {!isReview ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onGoToChat}
                aria-label={t("roadmap.step_detail.go_to_chat")}
                data-testid="step-detail-open-chat"
              >
                <ExternalLink />
                {t("roadmap.step_detail.go_to_chat")}
              </Button>
            </div>
          ) : null}
          <LearningHint className="mt-2 text-[11px]">
            {t("roadmap.step_detail.go_to_chat_hint")}
          </LearningHint>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 py-8 text-center text-sm text-fg-muted">
          {t("roadmap.next_action_v2.pick_step")}
        </div>
      )}
    </aside>
  );
}

const VERIFY_STATUS_CLASS: Record<VerificationStatusItem["tone"], string> = {
  info: "border-info/50 bg-info/10 text-info",
  success: "border-success/60 bg-success/10 text-success",
  warn: "border-warn/60 bg-warn/10 text-warn",
  risk: "border-danger/60 bg-danger/10 text-danger",
};

function VerificationStatusChip({ item }: { item: VerificationStatusItem }) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-semibold",
        VERIFY_STATUS_CLASS[item.tone],
      )}
      data-testid="verification-status-chip"
      data-status-id={item.id}
      data-evidence-backed={item.evidenceBacked ? "true" : "false"}
    >
      {t(VERIFICATION_STATUS_LABEL_KEY[item.id])}
    </span>
  );
}

function AgencyStateChip({ item }: { item: AgencyStateItem }) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-semibold",
        agencyToneClass(item.tone),
      )}
      data-testid="agency-state-chip"
      data-agency-state={item.id}
      data-agency-component={item.component}
      data-evidence-backed={item.evidenceBacked ? "true" : "false"}
    >
      {t(item.labelKey)}
    </span>
  );
}

function verificationActionIcon(kind: VerificationFocusActionKind) {
  if (kind === "open_diff") return <FileCode aria-hidden />;
  if (kind === "run_tests") return <Clock3 aria-hidden />;
  return <ExternalLink aria-hidden />;
}

function VerificationFocusPanel({
  criterionText,
  verificationPlanText,
  action,
  verificationStatuses,
  agencyItems,
}: {
  criterionText: string;
  verificationPlanText: string | null;
  action: VerificationFocusAction | null;
  verificationStatuses: VerificationStatusItem[];
  agencyItems: AgencyStateItem[];
}) {
  const t = useT();
  const verificationStatusIds = new Set<string>(verificationStatuses.map((item) => item.id));
  const dedupedAgencyItems = agencyItems.filter((item) => !verificationStatusIds.has(item.id));
  return (
    <section
      className="mt-4 border-b border-border/70 pb-4"
      data-testid="step-detail-verification-focus"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
            {t("roadmap.step_detail.verify_focus_title")}
          </div>
          <p
            className="mt-2 text-lg font-semibold leading-snug text-fg"
            data-testid="step-detail-criterion-focal"
          >
            {criterionText}
          </p>
          {verificationPlanText ? (
            <p
              className="mt-1 break-words font-mono text-[11px] text-fg-muted"
              data-testid="step-detail-feasible-method"
            >
              {verificationPlanText}
            </p>
          ) : null}
        </div>
        {action ? (
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="min-h-10 px-3 text-sm"
            disabled={action.disabled}
            onClick={action.onClick}
            aria-label={action.ariaLabel}
            data-testid="step-detail-primary-verification-action"
            data-action-kind={action.kind}
          >
            {verificationActionIcon(action.kind)}
            {action.label}
          </Button>
        ) : null}
      </div>

      {verificationStatuses.length > 0 || dedupedAgencyItems.length > 0 ? (
        <div
          className="mt-3 flex flex-wrap gap-1.5 text-fg-muted"
          data-testid="step-detail-evidence-chips"
        >
          {verificationStatuses.map((item) => (
            <VerificationStatusChip key={item.id} item={item} />
          ))}
          {dedupedAgencyItems.map((item) => (
            <AgencyStateChip key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CriterionConfirmPanel({
  hasAcceptanceCriteria,
  criterionEvidenceRef,
  previewOpened,
  appOpened,
  onConfirmPreview,
  onConfirmApp,
}: {
  hasAcceptanceCriteria: boolean;
  criterionEvidenceRef: CriterionEvidenceRef;
  previewOpened: boolean;
  appOpened: boolean;
  onConfirmPreview: () => void;
  onConfirmApp: () => void;
}) {
  const t = useT();
  if (!hasAcceptanceCriteria) return null;

  return (
    <div
      className="border-t border-border/70 pt-3 text-xs text-fg"
      data-testid="step-detail-criterion-confirm"
    >
      <p className="font-medium">{t("roadmap.step_detail.criterion_confirm_label")}</p>
      <p className="mt-0.5 text-[11px] text-fg-muted">
        {t("roadmap.step_detail.criterion_confirm_hint")}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant={criterionEvidenceRef === "preview" ? "primary" : "outline"}
          size="sm"
          disabled={!previewOpened}
          onClick={onConfirmPreview}
          aria-label={t("roadmap.step_detail.criterion_confirm_preview")}
          data-testid="step-detail-confirm-preview"
        >
          {t("roadmap.step_detail.criterion_confirm_preview")}
        </Button>
        <Button
          type="button"
          variant={criterionEvidenceRef === "app" ? "primary" : "outline"}
          size="sm"
          disabled={!appOpened}
          onClick={onConfirmApp}
          aria-label={t("roadmap.step_detail.criterion_confirm_app")}
          data-testid="step-detail-confirm-app"
        >
          {t("roadmap.step_detail.criterion_confirm_app")}
        </Button>
      </div>
      {criterionEvidenceRef ? (
        <p
          className="mt-2 text-[11px] font-medium text-success"
          data-testid="step-detail-criterion-evidence-ref"
        >
          {criterionEvidenceRef === "preview"
            ? t("roadmap.step_detail.criterion_confirm_preview_selected")
            : t("roadmap.step_detail.criterion_confirm_app_selected")}
        </p>
      ) : null}
    </div>
  );
}

function ChangeEvidenceBundle({
  expectedFiles,
  actualChangedFiles,
  unexpectedHighRiskFiles,
  verificationStatuses,
  rollbackAvailable,
  diffViewed,
  verificationPlanText,
}: {
  expectedFiles: string[];
  actualChangedFiles: string[];
  unexpectedHighRiskFiles: string[];
  verificationStatuses: VerificationStatusItem[];
  rollbackAvailable: boolean;
  diffViewed: boolean;
  verificationPlanText: string | null;
}) {
  const t = useT();
  return (
    <div className="space-y-3 text-xs" data-testid="step-detail-change-bundle">
      <div className="grid gap-2 sm:grid-cols-2">
        <BundleList
          testId="step-detail-expected-files"
          title={t("roadmap.step_detail.bundle_expected_files")}
          items={expectedFiles}
          empty={t("roadmap.step_detail.bundle_none")}
        />
        <BundleList
          testId="step-detail-actual-files"
          title={t("roadmap.step_detail.bundle_actual_files")}
          items={actualChangedFiles}
          empty={t("roadmap.step_detail.bundle_none")}
        />
      </div>
      <div
        className={cn(
          "rounded-sm border px-2 py-2",
          unexpectedHighRiskFiles.length > 0
            ? "border-danger/50 bg-danger/5 text-danger"
            : "border-border bg-bg/60 text-fg-muted",
        )}
        data-testid="step-detail-unexpected-high-risk-files"
        data-count={unexpectedHighRiskFiles.length}
      >
        <p className="font-semibold text-fg">
          {t("roadmap.step_detail.bundle_unexpected_high_risk")}
        </p>
        <p className="mt-1 break-words font-mono">
          {unexpectedHighRiskFiles.length > 0
            ? compactBundleItems(unexpectedHighRiskFiles)
            : t("roadmap.step_detail.bundle_none")}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-sm border bg-bg/60 px-2 py-2" data-testid="step-detail-diff-viewed">
          <p className="font-semibold text-fg">{t("roadmap.step_detail.bundle_diff_review")}</p>
          <p className="mt-1 text-fg-muted">
            {diffViewed
              ? t("roadmap.step_detail.bundle_diff_reviewed")
              : t("roadmap.step_detail.bundle_diff_not_reviewed")}
          </p>
        </div>
        <div
          className="rounded-sm border bg-bg/60 px-2 py-2"
          data-testid="step-detail-rollback-availability"
        >
          <p className="font-semibold text-fg">{t("roadmap.step_detail.bundle_rollback")}</p>
          <p className="mt-1 text-fg-muted">
            {rollbackAvailable
              ? t("roadmap.step_detail.bundle_rollback_available")
              : t("roadmap.step_detail.bundle_rollback_unavailable")}
          </p>
        </div>
      </div>
      <div className="rounded-sm border bg-bg/60 px-2 py-2">
        <p className="font-semibold text-fg">{t("roadmap.step_detail.bundle_verification")}</p>
        {verificationPlanText ? (
          <p className="mt-1 break-words font-mono text-[11px] text-fg-muted">
            {verificationPlanText}
          </p>
        ) : null}
        {verificationStatuses.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {verificationStatuses.map((item) => (
              <VerificationStatusChip key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <p className="mt-1 text-fg-muted">
            {t("roadmap.step_detail.bundle_verification_missing")}
          </p>
        )}
      </div>
    </div>
  );
}

function BundleList({
  title,
  items,
  empty,
  testId,
}: {
  title: string;
  items: string[];
  empty: string;
  testId: string;
}) {
  return (
    <div className="rounded-sm border bg-bg/60 px-2 py-2" data-testid={testId}>
      <p className="font-semibold text-fg">{title}</p>
      <p className="mt-1 break-words font-mono text-fg-muted">
        {items.length > 0 ? compactBundleItems(items) : empty}
      </p>
    </div>
  );
}

function compactBundleItems(items: string[]): string {
  if (items.length <= 4) return items.join(", ");
  return `${items.slice(0, 4).join(", ")} +${items.length - 4}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 border-t border-border/70 pt-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-muted">
        {title}
      </div>
      <div className="mt-1">{children}</div>
    </section>
  );
}

interface VerificationBlockProps {
  verifyLog: VerifyLogView | null;
  verifyState: "idle" | "running" | "error";
  verifyError: string | null;
}

function VerificationBlock({ verifyLog, verifyState, verifyError }: VerificationBlockProps) {
  const t = useT();
  if (verifyState === "running") {
    return <p className="text-xs text-fg-muted">…</p>;
  }
  if (verifyState === "error" && verifyError) {
    return (
      <p className="text-xs text-danger" data-testid="step-detail-verify-error">
        {verifyError}
      </p>
    );
  }
  if (!verifyLog) {
    return <p className="text-xs text-fg-muted">—</p>;
  }
  return (
    <div className="space-y-2 text-xs" data-testid="step-detail-verify-log">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-semibold",
            verifyLog.intent_match
              ? "border-info/60 bg-info/10 text-info"
              : "border-warn/60 bg-warn/10 text-warn",
          )}
          data-testid="step-detail-intent-match"
          data-intent-match={verifyLog.intent_match ? "true" : "false"}
        >
          {verifyLog.intent_match
            ? t("roadmap.step_detail.intent_match_true")
            : t("roadmap.step_detail.intent_match_false")}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-semibold",
            verifyLog.test_result === "pass"
              ? "border-success/60 bg-success/10 text-success"
              : verifyLog.test_result === "fail"
                ? "border-danger/60 bg-danger/10 text-danger"
                : "border-warn/60 bg-warn/10 text-warn",
          )}
          data-testid="step-detail-test-result"
          data-test-result={verifyLog.test_result}
        >
          {t(`roadmap.step_detail.test_result.${verifyLog.test_result}`)}
        </span>
      </div>
      {verifyLog.test_result === "skipped" ? (
        <p className="text-[10px] text-fg-muted" data-testid="step-detail-unverified-note">
          {t("roadmap.step_detail.unverified_note")}
        </p>
      ) : null}
      {verifyLog.test_command ? (
        <p className="break-all font-mono text-[11px] text-fg">{verifyLog.test_command}</p>
      ) : null}
      {verifyLog.details ? (
        <p className="whitespace-pre-wrap text-[11px] text-fg-muted">{verifyLog.details}</p>
      ) : null}
    </div>
  );
}

export default StepDetailSlideIn;
