import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Circle, Clock3, ExternalLink, FileCode, X } from "lucide-react";
import { Button } from "../ui/button";
import { LearningHint } from "../ui/learning-hint";
import { cn } from "../../lib/utils";
import {
  agencyToneClass,
  deriveAgencyStateView,
  type AgencyStateItem,
  type RoadmapStep,
  type RoadmapStepStatus,
} from "../../features/roadmap";
import type { ChangedFile } from "../slide-in/types";
import type { ApprovalDecision } from "../workmap/ApprovalJudgment";
import type { VerifyLogView } from "../workmap/types";
import { useT } from "../../i18n";
import { useChatComposerStore } from "../../stores/chatComposer";
import {
  requestPlanAdjustmentReview,
  type ChallengeStepRationaleInput,
  type ChallengeStepRationaleResult,
  type RationaleChallengeOfferActionInput,
} from "../../features/planning";
import { DecisionGate } from "./DecisionGate";
import {
  ProvocationCardHost,
  createDiffReadySupervisorRequest,
  createRetryLoopSupervisorRequest,
  deriveVerificationStatuses,
  evaluateProvocationSupervisor,
  normalizeFailureFingerprint,
  normalizeChangedFile,
  type ProvocationCard,
  type ProvocationContext,
  type ScaffoldMode,
  type SupervisorEvaluationRequest,
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
  rationaleChallenge?: {
    projectId: number;
    planId: number;
    stepDbId: number;
    onChallenge: (input: ChallengeStepRationaleInput) => Promise<ChallengeStepRationaleResult>;
    onAcceptOffer: (input: RationaleChallengeOfferActionInput) => Promise<unknown>;
    onDismissOffer: (input: RationaleChallengeOfferActionInput) => Promise<unknown>;
  };
}

const STATUS_CLASS: Record<RoadmapStepStatus, string> = {
  planned: "border-border bg-bg-panel2 text-fg-muted",
  in_progress: "border-accent/60 bg-accent/10 text-accent",
  review: "border-warn/60 bg-warn/10 text-warn",
  done: "border-success/60 bg-success/10 text-success",
  shipped: "border-success/70 bg-success/15 text-success",
};

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

function metadataStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function highRiskFilesFromCards(cards: ProvocationCard[]): string[] {
  return uniqueStrings(
    cards
      .filter(
        (card) =>
          (card.type === "diff_scope_drift" || card.type === "diff_scope_review") &&
          card.severity === "risk",
      )
      .flatMap((card) => metadataStringArray(card.metadata?.highRiskFiles)),
  );
}

function statusIcon(status: RoadmapStepStatus) {
  if (status === "shipped" || status === "done") return <CheckCircle2 aria-hidden />;
  if (status === "review") return <Clock3 aria-hidden />;
  if (status === "in_progress") return <AlertCircle aria-hidden />;
  return <Circle aria-hidden />;
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
  rationaleChallenge,
}: StepDetailSlideInProps) {
  const t = useT();
  const pushComposerSeed = useChatComposerStore((s) => s.pushSeed);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [diffViewedStepIds, setDiffViewedStepIds] = useState<Set<number>>(() => new Set());
  const [criterionEvidenceRef, setCriterionEvidenceRef] = useState<CriterionEvidenceRef>(null);
  const [manualObservationByStep, setManualObservationByStep] = useState<
    Map<number, ObservationEvidenceRecord>
  >(() => new Map());
  const [previewOpenedStepIds, setPreviewOpenedStepIds] = useState<Set<number>>(() => new Set());
  const [appOpenedStepIds, setAppOpenedStepIds] = useState<Set<number>>(() => new Set());
  const retryLoopByStepRef = useRef<Map<number, RetryLoopFailureSnapshot>>(new Map());
  const lastSupervisorEvaluationKeyRef = useRef("");
  const [retryLoopSnapshot, setRetryLoopSnapshot] = useState<RetryLoopFailureSnapshot | null>(null);
  const [rationaleChallengeOpen, setRationaleChallengeOpen] = useState(false);
  const [rationaleChallengeText, setRationaleChallengeText] = useState("");
  const [rationaleChallengeBusy, setRationaleChallengeBusy] = useState(false);
  const [rationaleChallengeError, setRationaleChallengeError] = useState<string | null>(null);
  const [rationaleChallengeResult, setRationaleChallengeResult] =
    useState<ChallengeStepRationaleResult | null>(null);

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
    setRationaleChallengeOpen(false);
    setRationaleChallengeText("");
    setRationaleChallengeBusy(false);
    setRationaleChallengeError(null);
    setRationaleChallengeResult(null);
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
  const criterionConfirmed = criterionEvidenceRef !== null;
  const manualObservation = step ? (manualObservationByStep.get(step.id) ?? null) : null;
  const linkedCriteria = step?.linkedCriteria ?? [];
  const decompositionRationale = step?.decompositionRationale?.trim() ?? "";
  const manualObservationConfirmed = Boolean(
    manualObservation &&
    manualObservation.criterionIds.length > 0 &&
    manualObservation.observationText.trim().length > 0,
  );
  const acceptanceCriterionConfirmed = criterionConfirmed || manualObservationConfirmed;
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
            manualChecks: manualObservation ? [manualObservation.observationText] : [],
            observationIds: manualObservation ? [manualObservation.observationId] : [],
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
        aiClaimedDone: Boolean(verifyLog?.intent_match),
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
      locale: "ko-KR",
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
      locale: "ko-KR",
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
      locale: "ko-KR",
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
      locale: "ko-KR",
      step: {
        title: step.title || `Step ${step.position}`,
        summary: step.description,
        instruction: step.assistSummary,
        acceptanceCriteria: [
          {
            criterionId: `step-${step.id}-criterion-1`,
            text: criterionText,
          },
        ].filter((criterion) => criterion.text.trim().length > 0),
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
        priorObservations: manualObservation ? [manualObservation] : [],
      },
    };
  }, [
    actualChangedFiles,
    criterionText,
    isReview,
    planContext?.verificationCommand,
    planContext?.verificationKind,
    planContext?.verificationManualCheck,
    manualObservation,
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
  const unexpectedHighRiskFiles = highRiskFilesFromCards(provocationCards);
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
    (expectedFiles.length > 0 ||
      actualChangedFiles.length > 0 ||
      verificationStatuses.length > 0 ||
      isReview ||
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
  const handleSubmitRationaleChallenge = async () => {
    const text = rationaleChallengeText.trim();
    if (!rationaleChallenge || text.length === 0) return;
    setRationaleChallengeBusy(true);
    setRationaleChallengeError(null);
    try {
      const result = await rationaleChallenge.onChallenge({
        planId: rationaleChallenge.planId,
        stepDbId: rationaleChallenge.stepDbId,
        text,
        linkedCriterionIds: linkedCriteria.map((criterion) => criterion.criterionId),
      });
      setRationaleChallengeResult(result);
      setRationaleChallengeText("");
      setRationaleChallengeOpen(false);
    } catch (err) {
      setRationaleChallengeError(err instanceof Error ? err.message : String(err));
    } finally {
      setRationaleChallengeBusy(false);
    }
  };

  const rationaleOfferInput = (): RationaleChallengeOfferActionInput | null => {
    if (
      !rationaleChallenge ||
      !rationaleChallengeResult?.objectionId ||
      !rationaleChallengeResult.offerId
    ) {
      return null;
    }
    return {
      planId: rationaleChallenge.planId,
      stepDbId: rationaleChallenge.stepDbId,
      objectionId: rationaleChallengeResult.objectionId,
      offerId: rationaleChallengeResult.offerId,
    };
  };

  const handleAcceptRationaleOffer = async () => {
    const input = rationaleOfferInput();
    if (!input || !rationaleChallenge || !rationaleChallengeResult) return;
    setRationaleChallengeBusy(true);
    setRationaleChallengeError(null);
    try {
      await rationaleChallenge.onAcceptOffer(input);
      requestPlanAdjustmentReview({
        projectId: rationaleChallenge.projectId,
        planId: rationaleChallenge.planId,
        stepDbId: rationaleChallenge.stepDbId,
        objectionId: rationaleChallengeResult.objectionId,
        offerId: rationaleChallengeResult.offerId,
        offerKind: rationaleChallengeResult.offerKind,
        message: rationaleChallengeResult.message || t("prd.decomposition.offer_message"),
        suggestedSeed: rationaleChallengeResult.suggestedSeed ?? null,
      });
      setRationaleChallengeResult({
        ...rationaleChallengeResult,
        suggestionStatus: "accepted",
      });
    } catch (err) {
      setRationaleChallengeError(err instanceof Error ? err.message : String(err));
    } finally {
      setRationaleChallengeBusy(false);
    }
  };

  const handleDismissRationaleOffer = async () => {
    const input = rationaleOfferInput();
    if (!input || !rationaleChallenge || !rationaleChallengeResult) return;
    setRationaleChallengeBusy(true);
    setRationaleChallengeError(null);
    try {
      await rationaleChallenge.onDismissOffer(input);
      setRationaleChallengeResult({
        ...rationaleChallengeResult,
        suggestionStatus: "dismissed",
      });
    } catch (err) {
      setRationaleChallengeError(err instanceof Error ? err.message : String(err));
    } finally {
      setRationaleChallengeBusy(false);
    }
  };

  return (
    <aside
      ref={panelRef}
      className={cn(
        "fixed right-0 top-0 z-50 flex h-full w-[520px] flex-col border-l bg-bg shadow-xl",
        "transition-transform duration-slide ease-out motion-reduce:duration-0",
        open ? "translate-x-0" : "translate-x-full pointer-events-none",
      )}
      role="dialog"
      aria-modal="false"
      aria-labelledby="step-detail-title"
      data-testid="step-detail-panel"
      data-open={open ? "true" : "false"}
      data-step-id={step?.id ?? ""}
      data-status={status ?? ""}
    >
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
              <span className="h-3 w-3">{statusIcon(status)}</span>
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
            hasAcceptanceCriteria={Boolean(step.acceptanceCriteria)}
            criterionEvidenceRef={criterionEvidenceRef}
            previewOpened={previewOpened}
            appOpened={appOpened}
            onConfirmPreview={() => setCriterionEvidenceRef("preview")}
            onConfirmApp={() => setCriterionEvidenceRef("app")}
          />

          {linkedCriteria.length > 0 || decompositionRationale ? (
            <RationaleChallengePanel
              linkedCriteria={linkedCriteria}
              rationale={decompositionRationale}
              challengeAvailable={Boolean(rationaleChallenge)}
              open={rationaleChallengeOpen}
              text={rationaleChallengeText}
              busy={rationaleChallengeBusy}
              error={rationaleChallengeError}
              result={rationaleChallengeResult}
              onToggle={() => setRationaleChallengeOpen((current) => !current)}
              onTextChange={setRationaleChallengeText}
              onSubmit={handleSubmitRationaleChallenge}
              onAcceptOffer={handleAcceptRationaleOffer}
              onDismissOffer={handleDismissRationaleOffer}
            />
          ) : null}

          <VerificationCoachPanel
            request={verificationCoachRequest}
            observation={manualObservation}
            onObservationRecorded={(record) => {
              setManualObservationByStep((current) => {
                const next = new Map(current);
                next.set(record.cardId, record);
                return next;
              });
            }}
          />

          <ProvocationCardHost
            className="mt-3"
            cards={provocationCards}
            context={provocationContext ?? undefined}
            mode={provocation?.mode ?? "standard"}
            onAction={handleProvocationAction}
          />

          {hasSecondaryDetails ? (
            <details
              className="mt-3 rounded-md border border-border bg-bg-panel2/60 px-3 py-2 text-xs"
              data-testid="step-detail-secondary-details"
            >
              <summary
                className="cursor-pointer select-none font-semibold text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                aria-label={t("roadmap.step_detail.secondary_details_aria")}
              >
                {t("roadmap.step_detail.secondary_details_toggle")}
              </summary>
              <div className="mt-3">
                {hasChangedFiles && primaryVerificationAction?.kind !== "open_diff" ? (
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

          {isReview ? (
            <DecisionGate
              verificationStatuses={verificationStatuses}
              agencyState={agencyState}
              provocationCards={provocationCards}
              verifyLog={verifyLog}
              rollbackAvailable={rollbackAvailable}
              acceptanceCriterionConfirmed={acceptanceCriterionConfirmed}
              verificationFeasibility={verificationFeasibility}
              verifyRunning={verifyState === "running"}
              onApprove={() =>
                onApprovalDecision({
                  outcome: "approved",
                  note: null,
                  observationEvidence: manualObservation
                    ? {
                        observationIds: [manualObservation.observationId],
                        manualChecks: [manualObservation.observationText],
                        criterionIds: manualObservation.criterionIds,
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
                onApprovalDecision({ outcome: "revision_requested", note: null })
              }
              onVerifyFirst={onVerifyFirst}
              onRevert={onOpenRecovery}
              onStop={(note) => onApprovalDecision({ outcome: "revision_requested", note })}
            />
          ) : (
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
          )}
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
      {item.label}
    </span>
  );
}

function AgencyStateChip({ item }: { item: AgencyStateItem }) {
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
      {item.label}
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
  hasAcceptanceCriteria,
  criterionEvidenceRef,
  previewOpened,
  appOpened,
  onConfirmPreview,
  onConfirmApp,
}: {
  criterionText: string;
  verificationPlanText: string | null;
  action: VerificationFocusAction | null;
  verificationStatuses: VerificationStatusItem[];
  agencyItems: AgencyStateItem[];
  hasAcceptanceCriteria: boolean;
  criterionEvidenceRef: CriterionEvidenceRef;
  previewOpened: boolean;
  appOpened: boolean;
  onConfirmPreview: () => void;
  onConfirmApp: () => void;
}) {
  const t = useT();
  return (
    <section
      className="mt-3 rounded-md border border-border bg-bg-panel2 px-3 py-3"
      data-testid="step-detail-verification-focus"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-muted">
            {t("roadmap.step_detail.verify_focus_title")}
          </div>
          <p
            className="mt-1 text-sm font-semibold leading-snug text-fg"
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

      {verificationStatuses.length > 0 || agencyItems.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5" data-testid="step-detail-evidence-chips">
          {verificationStatuses.map((item) => (
            <VerificationStatusChip key={item.id} item={item} />
          ))}
          {agencyItems.map((item) => (
            <AgencyStateChip key={item.id} item={item} />
          ))}
        </div>
      ) : null}

      {hasAcceptanceCriteria ? (
        <div
          className="mt-3 border-t border-border/70 pt-3 text-xs text-fg"
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
      ) : null}
    </section>
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

interface RationaleChallengePanelProps {
  linkedCriteria: NonNullable<RoadmapStep["linkedCriteria"]>;
  rationale: string;
  challengeAvailable: boolean;
  open: boolean;
  text: string;
  busy: boolean;
  error: string | null;
  result: ChallengeStepRationaleResult | null;
  onToggle: () => void;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  onAcceptOffer: () => void;
  onDismissOffer: () => void;
}

function RationaleChallengePanel({
  linkedCriteria,
  rationale,
  challengeAvailable,
  open,
  text,
  busy,
  error,
  result,
  onToggle,
  onTextChange,
  onSubmit,
  onAcceptOffer,
  onDismissOffer,
}: RationaleChallengePanelProps) {
  const t = useT();
  const hasOfferedAdjustment = result?.suggestionStatus === "offered";
  return (
    <section
      className="mt-3 rounded-md border border-border bg-bg-panel2/60 px-3 py-2 text-xs"
      data-testid="step-detail-rationale"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-fg">{t("prd.decomposition.rationale")}</p>
          {rationale ? <p className="mt-1 whitespace-pre-wrap text-fg-muted">{rationale}</p> : null}
        </div>
        {challengeAvailable ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            disabled={busy}
            data-testid="step-rationale-challenge-toggle"
          >
            {t("prd.decomposition.challenge")}
          </Button>
        ) : null}
      </div>
      {linkedCriteria.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="step-detail-linked-criteria">
          {linkedCriteria.map((criterion) => (
            <span
              key={criterion.criterionId}
              className="inline-flex max-w-full items-center gap-1 rounded-sm border border-border bg-bg px-1.5 py-0.5 text-fg"
            >
              <span className="shrink-0 font-semibold text-accent">{criterion.criterionId}</span>
              <span className="truncate">{criterion.text}</span>
            </span>
          ))}
        </div>
      ) : null}
      {open ? (
        <div className="mt-2">
          <textarea
            className="min-h-20 w-full resize-none rounded-md border bg-bg px-2 py-1.5 text-xs text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder={t("prd.decomposition.challenge")}
            disabled={busy}
            data-testid="step-rationale-challenge-input"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onSubmit}
              disabled={busy || text.trim().length === 0}
              data-testid="step-rationale-challenge-submit"
            >
              {t("prd.decomposition.challenge")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              disabled={busy}
              data-testid="step-rationale-challenge-cancel"
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : null}
      {result ? (
        <p className="mt-2 text-info" data-testid="step-rationale-challenge-status">
          {t("prd.decomposition.objection_logged")}
        </p>
      ) : null}
      {hasOfferedAdjustment ? (
        <div
          className="mt-2 rounded-md border border-info/40 bg-info/5 px-2 py-1.5"
          data-testid="step-rationale-challenge-offer"
        >
          <p className="font-semibold text-info">{t("prd.decomposition.offer_title")}</p>
          <p className="mt-1 text-fg-muted">
            {result?.message || t("prd.decomposition.offer_message")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onAcceptOffer}
              disabled={busy}
              data-testid="step-rationale-offer-accept"
            >
              {t("prd.decomposition.offer_accept")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDismissOffer}
              disabled={busy}
              data-testid="step-rationale-offer-dismiss"
            >
              {t("prd.decomposition.offer_dismiss")}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="mt-2 text-danger" data-testid="step-rationale-challenge-error">
          {error}
        </p>
      ) : null}
    </section>
  );
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
