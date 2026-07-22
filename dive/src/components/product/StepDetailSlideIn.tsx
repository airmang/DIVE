import { useEffect, useMemo, useRef, useState } from "react";
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
  deriveAgencyStateView,
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
  type SupervisorEvaluationUiState,
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
import { REVIEW_SIDEBAR_MIN_WIDTH, useReviewSidebarWidth } from "./useReviewSidebarWidth";
import {
  isSubstantiveObservation,
  splitAcceptanceCriteria,
  uniqueStrings,
} from "./stepDetailEvidence";
import {
  buildDiffReadySupervisorRequest,
  buildRetryLoopSupervisorRequest,
  buildSupervisorEvaluationRequest,
  type RetryLoopFailureSnapshot,
  type StepDetailProvocation,
} from "./stepDetailSupervisorRequests";
import {
  ChangeEvidenceBundle,
  CriterionConfirmPanel,
  Section,
  VerificationBlock,
  VerificationFocusPanel,
  type CriterionEvidenceRef,
  type VerificationFocusAction,
} from "./StepDetailSections";

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
    stepKind?: string | null;
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

function statusIcon(status: RoadmapStepStatus) {
  const cls = "h-3 w-3 shrink-0";
  if (status === "shipped" || status === "done")
    return <CheckCircle2 className={cls} aria-hidden />;
  if (status === "review") return <Clock3 className={cls} aria-hidden />;
  if (status === "in_progress") return <AlertCircle className={cls} aria-hidden />;
  return <Circle className={cls} aria-hidden />;
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
  // S-064: tracks the supervisor eval that is currently in flight (or has
  // settled) for a given request set. `cancelled` is flipped only when the
  // request set actually changes or the component unmounts — never on an
  // identity-only re-run — so a "checking…" flag can't get stranded (see the
  // supervisor-eval effect below).
  const supervisorEvalInflightRef = useRef<{ key: string; cancelled: boolean } | null>(null);
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

  // S-064 regression (P1): the S-029 evidence latches below (diffViewedStepIds,
  // previewOpenedStepIds, appOpenedStepIds, manualObservationsByStep,
  // criterionEvidenceRef) are add-only and keyed only by step id. Since the
  // panel now stays mounted across the whole request-changes -> revise ->
  // re-review loop (S-064 E2), a step that returns to "review" after a
  // revision round keeps its round-1 latches — pre-satisfying the gate for a
  // diff the student has never seen, and stamping stale observation ids into
  // the approval provenance as if they covered it. Track the last status seen
  // for each step id and invalidate that step's latches whenever it re-enters
  // "review" from a different status: a genuine new round, not merely
  // reopening the panel on an unchanged review or a background prop update
  // that doesn't touch status.
  const stepLastStatusRef = useRef<Map<number, RoadmapStepStatus | null>>(new Map());
  useEffect(() => {
    if (!step) return;
    const previousStatus = stepLastStatusRef.current.get(step.id);
    stepLastStatusRef.current.set(step.id, status);
    if (previousStatus === undefined || previousStatus === "review" || status !== "review") return;

    setDiffViewedStepIds((current) => {
      if (!current.has(step.id)) return current;
      const next = new Set(current);
      next.delete(step.id);
      return next;
    });
    setPreviewOpenedStepIds((current) => {
      if (!current.has(step.id)) return current;
      const next = new Set(current);
      next.delete(step.id);
      return next;
    });
    setAppOpenedStepIds((current) => {
      if (!current.has(step.id)) return current;
      const next = new Set(current);
      next.delete(step.id);
      return next;
    });
    setManualObservationsByStep((current) => {
      if (!current.has(step.id)) return current;
      const next = new Map(current);
      next.delete(step.id);
      return next;
    });
    setCriterionEvidenceRef(null);
  }, [step, status]);

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
  const supervisorUiState = useMemo<SupervisorEvaluationUiState | null>(() => {
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
  // A stable provocation object whose identity changes only when one of its
  // primitive fields does — mirrors the primitive dep lists the request memos
  // used before extraction, so passing the whole object to the pure builders
  // keeps their recompute frequency unchanged.
  const provocationEnabled = provocation?.enabled;
  const provocationMode = provocation?.mode;
  const provocationProjectId = provocation?.projectId;
  const provocationSessionId = provocation?.sessionId;
  const provocationConfig = useMemo<StepDetailProvocation | undefined>(
    () =>
      // `mode` is required whenever the prop is present, so its presence is the
      // faithful "provocation was provided" signal — reading the destructured
      // primitives (not the object) keeps the memo stable across renders.
      provocationMode === undefined
        ? undefined
        : {
            enabled: provocationEnabled ?? false,
            mode: provocationMode,
            projectId: provocationProjectId,
            sessionId: provocationSessionId,
          },
    [provocationEnabled, provocationMode, provocationProjectId, provocationSessionId],
  );
  const supervisorEvaluationRequest = useMemo(
    () =>
      buildSupervisorEvaluationRequest({
        step,
        supervisorUiState,
        provocation: provocationConfig,
        previewOpened,
        locale: useLocaleStore.getState().locale,
      }),
    [previewOpened, provocationConfig, step, supervisorUiState],
  );
  const diffReadySupervisorRequest = useMemo(
    () =>
      buildDiffReadySupervisorRequest({
        step,
        supervisorUiState,
        provocation: provocationConfig,
        changedFiles,
        verifyState,
        verifyTestResult: verifyLog?.test_result,
        planContextPurpose: planContext?.purpose,
        verificationPlanText,
        expectedFiles,
        diffViewed,
        stepKind: planContext?.stepKind,
        locale: useLocaleStore.getState().locale,
      }),
    [
      changedFiles,
      diffViewed,
      expectedFiles,
      planContext?.purpose,
      planContext?.stepKind,
      provocationConfig,
      step,
      supervisorUiState,
      verificationPlanText,
      verifyLog?.test_result,
      verifyState,
    ],
  );
  const retryLoopSupervisorRequest = useMemo(
    () =>
      buildRetryLoopSupervisorRequest({
        step,
        supervisorUiState,
        retryLoopSnapshot,
        provocation: provocationConfig,
        planContextPurpose: planContext?.purpose,
        verificationPlanText,
        rollbackAvailable,
        locale: useLocaleStore.getState().locale,
      }),
    [
      planContext?.purpose,
      provocationConfig,
      retryLoopSnapshot,
      rollbackAvailable,
      step,
      supervisorUiState,
      verificationPlanText,
    ],
  );
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
  // S-044 (P2-31): deterministic pending flag while the async supervisor eval
  // is in flight, so the review stage shows a "checking…" status instead of a
  // silent pop-in that reflows the stepper total under the user.
  const [supervisorEvalPending, setSupervisorEvalPending] = useState(false);
  // A card is "engaged" only when the student actually looked at the artifact
  // (open diff/preview/run/tests) or recorded a reason — not when they merely
  // dismiss or mark it irrelevant. Only engagement counts as review evidence, so
  // dismissing a card no longer fakes the stepper's "Review response" stage as
  // completed (P2-14). Dismissal visibility + its EventLog record stay owned by
  // ProvocationCardHost.
  const [engagedProvocationCardIds, setEngagedProvocationCardIds] = useState<Set<string>>(
    () => new Set(),
  );

  // Tracks the request-set key of the last evaluation this effect actually
  // saw through to a result (shown card or none) — as opposed to
  // supervisorEvalInflightRef, which is nulled out on close and so can't by
  // itself tell "unchanged since we last settled" from "never run". Without
  // this, closing and reopening with byte-identical inputs re-ran the whole
  // supervisor turn: the backend's per-session dedup then drops the
  // identical re-decision, so the review card and its engagement vanish for
  // good on close/reopen (S-064 regression).
  const supervisorEvalSettledKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // S-064 I1: the panel now stays mounted while closed (E2), so the supervisor
    // eval MUST be gated on `open`. Otherwise a background changedFiles/verifyLog
    // update on a closed panel would fire evaluateProvocationSupervisor with
    // `verify_entered` — an unrequested LLM call that also records a supervision
    // evaluation the student never triggered. When closed we cancel any inflight
    // eval and clear the "checking" flag, but keep the existing cards and their
    // engagement evidence so reopening restores the same review state.
    if (!open) {
      if (supervisorEvalInflightRef.current) {
        supervisorEvalInflightRef.current.cancelled = true;
        supervisorEvalInflightRef.current = null;
      }
      setSupervisorEvalPending(false);
      return;
    }

    const requests = [
      retryLoopSupervisorRequest,
      diffReadySupervisorRequest,
      supervisorEvaluationRequest,
    ].filter((request): request is NonNullable<typeof request> => request !== null);
    const requestKey = JSON.stringify(requests);
    const inflight = supervisorEvalInflightRef.current;

    // Nothing has changed since this exact request set last settled (e.g. a
    // reopen with unchanged inputs, or an identity-only re-render after the
    // inflight ref was nulled by a prior close) — the current cards and
    // engagement already reflect it, so do not restart the eval.
    if (requestKey === supervisorEvalSettledKeyRef.current) {
      return;
    }

    if (requests.length === 0) {
      if (inflight) inflight.cancelled = true;
      supervisorEvalInflightRef.current = null;
      setSupervisorEvalPending(false);
      setProvocationCards((current) => (current.length > 0 ? [] : current));
      supervisorEvalSettledKeyRef.current = requestKey;
      return;
    }

    // A same-content re-run with a new object identity must not restart a live
    // eval — but if the matching eval was already cancelled (key change or a
    // prior unmount), fall through and restart instead of leaving "checking…"
    // stuck forever (S-064: the old code cancelled on every re-run yet skipped
    // the restart when the JSON key matched).
    if (inflight !== null && !inflight.cancelled && inflight.key === requestKey) {
      return;
    }

    // The request set changed: cancel the prior eval before starting a new one.
    if (inflight) inflight.cancelled = true;
    const token = { key: requestKey, cancelled: false };
    supervisorEvalInflightRef.current = token;

    setSupervisorEvalPending(true);
    setProvocationCards((current) => (current.length > 0 ? [] : current));
    void (async () => {
      for (const request of requests) {
        const response = await evaluateProvocationSupervisor(request);
        if (token.cancelled) return;
        if (response.status === "shown") {
          setProvocationCards([response.card]);
          setSupervisorEvalPending(false);
          supervisorEvalSettledKeyRef.current = token.key;
          return;
        }
      }
      setProvocationCards((current) => (current.length > 0 ? [] : current));
      setSupervisorEvalPending(false);
      supervisorEvalSettledKeyRef.current = token.key;
    })().catch((err) => {
      if (import.meta.env.DEV) {
        console.warn("supervisor evaluation failed:", err);
      }
      if (!token.cancelled) {
        setProvocationCards((current) => (current.length > 0 ? [] : current));
        setSupervisorEvalPending(false);
      }
    });
    // No cancelling cleanup here on purpose: an identity-only re-run with the
    // same key must let the in-flight eval finish. Cancellation is explicit —
    // on key change (above), on close (the `!open` guard), and on unmount.
  }, [open, diffReadySupervisorRequest, retryLoopSupervisorRequest, supervisorEvaluationRequest]);

  useEffect(
    () => () => {
      if (supervisorEvalInflightRef.current) {
        supervisorEvalInflightRef.current.cancelled = true;
      }
    },
    [],
  );
  useEffect(() => {
    const currentCardIds = new Set(provocationCards.map((card) => card.id));
    setEngagedProvocationCardIds((current) => {
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
    provocationCards.every((card) => engagedProvocationCardIds.has(card.id));
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
  const markProvocationCardEngaged = (card: ProvocationCard) => {
    setEngagedProvocationCardIds((current) => {
      if (current.has(card.id)) return current;
      return new Set(current).add(card.id);
    });
  };
  const handleReviewCardAction = (
    action: ProvocationAction,
    card: ProvocationCard,
    reason?: string,
  ) => {
    // Taking a card action means looking at the artifact (open diff/preview/run/
    // tests) or recording a reason — real engagement, so it counts as review
    // evidence. Dismiss / mark-irrelevant don't reach here.
    markProvocationCardEngaged(card);
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
      content: () => (
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
      content: (isActive) => (
        <div className="space-y-3">
          <VerificationCoachPanel
            request={verificationCoachRequest}
            observation={manualObservation}
            observationActionBacked={observationActionBacked}
            enabled={open && isActive}
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
      // S-064 P2: keep the coach mounted across stage revisits (see
      // VerificationReviewStepper's `keepMounted` doc) so its typed draft and
      // generated guide survive navigation instead of restarting from
      // scratch; `enabled` above (not mount/unmount) is what gates its LLM
      // calls to only when this stage is actually open and active.
      keepMounted: true,
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
        content: () => (
          <ProvocationCardHost
            className="space-y-2"
            cards={provocationCards}
            context={provocationContext ?? undefined}
            mode={provocation?.mode ?? "standard"}
            onAction={handleReviewCardAction}
          />
        ),
      });
    } else if (supervisorEvalPending) {
      // S-044 (P2-31): reserve the review stage with a deterministic pending
      // status while the supervisor eval runs, so the stepper total does not
      // silently jump when a card resolves. Real async status, not a fake card.
      reviewStages.push({
        id: "review-card-pending",
        marker: "3",
        title: t("roadmap.step_detail.stepper_stage_review_title"),
        evidenced: false,
        summary: t("roadmap.step_detail.stepper_review_eval_pending"),
        content: () => (
          <p
            className="text-xs text-fg-muted"
            role="status"
            aria-live="polite"
            data-testid="review-eval-pending"
          >
            {t("roadmap.step_detail.stepper_review_eval_pending")}
          </p>
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
        content: () => (
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
      // S-064 I2: the panel stays mounted while closed (E2), so `inert` removes
      // its close/open-code/open-chat controls and chat input from the tab order
      // and the SR tree instead of leaving them reachable off-screen (S-044).
      inert={!open}
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

export default StepDetailSlideIn;
