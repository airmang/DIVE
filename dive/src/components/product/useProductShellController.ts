import {
  Suspense,
  createElement,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { VerifyLogView } from "../workmap/types";
import type { ApprovalDecision } from "../workmap/ApprovalJudgment";
import type { ToolApprovalMetadata } from "../chat/types";
import { useSlideInStore } from "../../stores/slideIn";
import { useChatComposerStore } from "../../stores/chatComposer";
import {
  promptContextFor,
  selectAllCardsVerified,
  selectCurrentCard,
  useWorkmapStore,
} from "../../stores/workmap";
import {
  selectHasConnectedProvider,
  useProjectSessionStore,
  type ProviderSummary,
} from "../../stores/project-session";
import { cockpitProviderLabel } from "../../lib/provider-format";
import { matchSidecarModelNotFoundError } from "../../lib/error-classify";
import { useToast } from "../toast/toast-context";
import { getCardStateMeta } from "../workmap/card-state-meta";
import { useT } from "../../i18n";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";
import { usePlanRoadmap, useRoadmap } from "../../features/roadmap";
import {
  PLAN_DRAFT_REVIEW_REQUEST_EVENT,
  createLiveProjectSpecDraft,
  requestPlanAddStepDraft,
  quickIntakeInterviewAnswers,
  validateConfirmableProjectSpec,
  usePlan,
  usePlanRouter,
  type ArchitectureProposals,
  type LiveProjectSpecDraft,
  type PrdInterviewConversationTurn,
  type ProjectSpec,
  type RouteDecision,
  type InterviewAnswer,
  type QuickIntakeInput,
} from "../../features/planning";
import type {
  InterviewRow,
  PlanCritiqueResolution,
  PlanGenerationResult,
} from "../../features/planning";
import type { ConfirmableRouteDecision } from "./PlanRouteConfirmModal";
import {
  buildIssueLines,
  collectRecoveryExamples,
  decodePlanDraftQualityError,
  usePlanInterviewLLM,
  type PlanDraftLlmErrorReason,
  type PlanDraftQualityIssue,
} from "../../features/planning/usePlanInterviewLLM";
import { useChatSession } from "../../hooks/useChatSession";
import { refreshMenuRecents, useMenuEvents } from "../../lib/menu-events";
import { pickFolder } from "../../lib/tauri-dialog";
import { useTheme } from "../../hooks/useTheme";
import { hasRecognizedDemoRoute } from "../../lib/dev-demo";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import {
  buildApprovalProvenance,
  normalizeChangedFile,
  normalizePlanStep,
} from "../../features/provocation";
import {
  hasConcreteAutomatedPass,
  hasExecutedTestCommand,
} from "../../features/provocation/verificationGrade";
import { useProductShellDialogs } from "./useProductShellDialogs";
import { PlanDraftRecoveryScreen } from "./PlanDraftRecoveryScreen";
import { PlanDraftPendingScreen } from "./PlanDraftPendingScreen";
import { SocraticInterviewPanel } from "./SocraticInterviewPanel";
import { useProductPlanStepRuntime } from "./useProductPlanStepRuntime";
import { useProductConversationModel } from "./useProductConversationModel";
import { useProductRecovery } from "./useProductRecovery";
import { PrdAuthoringBoard, type PrdPatchFeedback } from "./PrdAuthoringBoard";
import { FinalPrdReadView } from "./FinalPrdReadView";
import { fallbackModels } from "../settings/providerModels";
import { requestProjectRailTab } from "./ProjectRail";
import type { ArchitectureForm } from "../../features/planning";

export type PrdMode = "authoring" | "read" | null;

interface PendingPrdPlanRequest {
  projectSpec: ProjectSpec;
  interviewAnswers?: InterviewAnswer[];
}

function planScaffoldingForForm(form: ArchitectureForm): string | null {
  switch (form) {
    case "web_app":
      return "For web_app, steps should cover browser UI screens/components, client state, user interactions, and frontend verification; avoid CLI-only deliverables unless they directly support the web app.";
    case "static_page":
      return "For static_page, steps should be static HTML/CSS/JS; avoid server, database, or backend-auth steps.";
    case "cli_tool":
      return "For cli_tool, steps should cover command parsing, terminal input/output, files/config if needed, and command verification; avoid DOM, browser page, or UI component steps.";
    case "desktop_app":
      return "For desktop_app, steps should cover desktop window/app shell, local UI flows, packaging/runtime integration, and local persistence when needed; avoid API-service-only endpoint steps.";
    case "api_service":
      return "For api_service, steps should cover endpoints, request/response schemas, validation, data/storage boundaries, and API tests; avoid UI/DOM/browser-page steps.";
    case "other":
      return null;
  }
}

export function buildPrdPlanGenerationPrompt(projectSpec: ProjectSpec): string {
  const activeCriteria = projectSpec.acceptanceCriteria
    .filter((criterion) => criterion.status === "active" && criterion.text.trim().length > 0)
    .map((criterion) => ({
      criterionId: criterion.criterionId,
      text: criterion.text,
    }));
  // S-047 (010 theme 7): the student's confirmed architecture (form + stack) is
  // decomposition context — the model decomposes *for* that form/stack rather than
  // re-choosing one. This is context-only: it shapes the prose, not the plan schema.
  const architecture = projectSpec.architecture
    ? {
        form: projectSpec.architecture.form,
        formLabel: projectSpec.architecture.formOtherLabel?.trim() || projectSpec.architecture.form,
        stack: projectSpec.architecture.stack ?? "",
      }
    : null;
  const prd = {
    goal: projectSpec.goal,
    intentSummary: projectSpec.intentSummary ?? "",
    scope: projectSpec.scope,
    nonGoals: projectSpec.nonGoals,
    constraints: projectSpec.constraints,
    acceptanceCriteria: activeCriteria,
    ...(architecture ? { architecture } : {}),
  };
  const formScaffolding = projectSpec.architecture
    ? planScaffoldingForForm(projectSpec.architecture.form)
    : null;

  return [
    "[PRD_PLAN_GENERATION]",
    "Use the saved PRD below as the source of truth and return compact JSON only.",
    'Return shape: {"intent_summary":"...","unresolved_questions":[],"plan_input":{"goal":"...","intent_summary":"...","scope":[],"non_goals":[],"constraints":[],"acceptance_criteria":[],"steps":[]}}.',
    "Generate 2-6 steps and never exceed 8.",
    "Each step must be small enough for one supervised DIVE turn.",
    "Each step must include: step_id, title, summary, instruction_seed, expected_files, acceptance_criteria, linked_criterion_ids, rationale, step_kind, verification_command, verification_type, dependencies, parallel_group.",
    "step_kind must be one of feature, refactor, rename, comment, debug. Use refactor/rename only for behavior-preserving move/restructure/name changes; use debug for diagnose-then-fix work.",
    "Every step must link to at least one saved PRD criterion ID through linked_criterion_ids and explain the link in rationale.",
    "Use the saved PRD criterion IDs exactly; do not invent AC IDs.",
    ...(architecture
      ? [
          "The PRD includes the student's confirmed architecture (form + tech stack). Decompose for that form and stack: keep every step, expected_files, and verification consistent with it, and do not switch to a different framework or stack.",
        ]
      : []),
    ...(formScaffolding ? ["DIVE form-specific step scaffolding:", formScaffolding] : []),
    "verification_command must be one no-shell command with explicit args when a command is appropriate, otherwise null with a clear manual verification summary in the step text.",
    "Do not include Markdown fences or prose.",
    "",
    `Saved PRD JSON:\n${JSON.stringify(prd)}`,
  ].join("\n");
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

// S-051 D2 point 2 / P2: the composer's runtime-unavailable CTA label per
// `RuntimeSetupAction`. `open_project`/`retry_runtime` keep their existing
// special-cased behavior (retry has no button); `switch_model` gets a
// dedicated label pointing the student at provider/model settings instead
// of the generic "open provider setup" copy.
export function runtimeSetupActionLabel(
  setupAction: string | null | undefined,
  t: Translate,
): string | undefined {
  if (setupAction === "open_project") return t("sidebar.new_project");
  if (setupAction === "retry_runtime") return undefined;
  if (setupAction === "switch_model") return t("runtime.capability.switch_model_action");
  return t("runtime.capability.setup_action");
}

export interface ModelNotFoundToastArgs {
  title: string;
  description: string;
  actionLabel: string;
}

/**
 * S-051 D3: decides whether a chat error is the sidecar's own run-time
 * `model not found` failure and, if so, what a toast surfacing it should
 * say. Pure so the detection/copy logic is unit-testable without mounting
 * the shell controller — see `matchSidecarModelNotFoundError` for the
 * detection regex.
 */
export function modelNotFoundToastArgs(
  errorMessage: string | null | undefined,
  t: Translate,
): ModelNotFoundToastArgs | null {
  if (!errorMessage) return null;
  const match = matchSidecarModelNotFoundError(errorMessage);
  if (!match) return null;
  return {
    title: t("runtime.model_not_found.toast_title"),
    description: t("runtime.model_not_found.toast_description", {
      provider: match.provider,
      model: match.model,
    }),
    actionLabel: t("runtime.capability.switch_model_action"),
  };
}

export function shouldShowEmptyPlanRail(input: {
  currentProjectId: number | null;
  planAccepted: boolean;
  roadmapStepCount: number;
  prdReadiness: "missing" | "draft" | "minimal";
  prdMode: PrdMode;
}) {
  return (
    input.currentProjectId !== null &&
    !input.planAccepted &&
    input.roadmapStepCount === 0 &&
    input.prdReadiness === "minimal" &&
    input.prdMode === "read"
  );
}

export function shouldUsePrdReferenceSurface(input: {
  prdMode: PrdMode;
  hasPlan: boolean;
  roadmapStepCount: number;
  activePlanStepIdForChat?: number;
}) {
  return (
    input.prdMode === "read" &&
    (input.hasPlan || input.roadmapStepCount > 0 || input.activePlanStepIdForChat !== undefined)
  );
}

const PlanDraftApprovalScreen = lazy(() =>
  import("./PlanDraftApprovalScreen").then((module) => ({
    default: module.PlanDraftApprovalScreen,
  })),
);

interface PendingPlanRouteConfirmation {
  decision: ConfirmableRouteDecision;
  resolve: (approved: boolean) => void;
}

export const PLAN_DRAFT_PENDING_TIMEOUT_MS = 30_000;

export function shouldRenderPlanDraftPending(input: {
  planDraftPending: boolean;
  hasGeneratedPlanDraft: boolean;
  hasPlanDraftFailure: boolean;
}): boolean {
  return input.planDraftPending && !input.hasGeneratedPlanDraft && !input.hasPlanDraftFailure;
}

export function usePlanDraftPendingController(timeoutMs: number = PLAN_DRAFT_PENDING_TIMEOUT_MS) {
  const expectingPlanDraftRef = useRef(false);
  const [planDraftPending, setPlanDraftPending] = useState(false);

  const setPlanDraftExpectation = useCallback((pending: boolean) => {
    expectingPlanDraftRef.current = pending;
    setPlanDraftPending(pending);
  }, []);

  useEffect(() => {
    if (!planDraftPending) return;
    const handle = window.setTimeout(() => {
      expectingPlanDraftRef.current = false;
      setPlanDraftPending(false);
    }, timeoutMs);
    return () => window.clearTimeout(handle);
  }, [planDraftPending, timeoutMs]);

  return {
    expectingPlanDraftRef,
    planDraftPending,
    setPlanDraftExpectation,
  };
}

export function interviewAnswersFromQuestions(value: unknown): InterviewAnswer[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const question = typeof record.question === "string" ? record.question.trim() : "";
      const answer = typeof record.answer === "string" ? record.answer.trim() : "";
      return question && answer ? { question, answer } : null;
    })
    .filter((item): item is InterviewAnswer => item !== null);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function safeExportFilenamePart(value: string | null, fallback: string): string {
  const cleaned = (value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || fallback;
}

function downloadSessionExport(
  sessionId: number,
  sessionTitle: string | null,
  jsonl: string,
): void {
  const filenamePart = safeExportFilenamePart(sessionTitle, `session-${sessionId}`);
  const blob = new Blob([jsonl], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `dive-${filenamePart}.jsonl`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function activeConnectedProvider(providers: ProviderSummary[]): ProviderSummary | null {
  return (
    providers.find((provider) => provider.is_connected && provider.is_active) ??
    providers.find((provider) => provider.is_connected) ??
    null
  );
}

function prdTurnFailureDescription(
  err: unknown,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("internal_error") ||
    normalized.includes("internal server error") ||
    normalized.includes("api error (5") ||
    normalized.includes("provider chat api error")
  ) {
    return t("prd.authoring.turn_failed_retryable_description");
  }
  return message;
}

function prdRuntimeSelection(
  providers: ProviderSummary[],
): { provider: string; model: string } | null {
  const provider = activeConnectedProvider(providers);
  if (!provider) return null;
  return {
    provider: provider.kind,
    model: provider.selected_model?.trim() || fallbackModels(provider.kind)[0]?.id || "default",
  };
}

export function draftFromProjectSpec(projectSpec: ProjectSpec): LiveProjectSpecDraft {
  return createLiveProjectSpecDraft(projectSpec.projectId, {
    draftId: `prd-draft-${projectSpec.projectId}`,
    projectSpecId: projectSpec.projectSpecId,
    baseVersion: projectSpec.currentVersion,
    currentVersion: projectSpec.currentVersion,
    goal: projectSpec.goal,
    intentSummary: projectSpec.intentSummary,
    scope: projectSpec.scope,
    nonGoals: projectSpec.nonGoals,
    constraints: projectSpec.constraints,
    acceptanceCriteria: projectSpec.acceptanceCriteria,
    // S-047: carry the decided architecture into the editable draft. Without this,
    // the read-view "Edit" button (which rebuilds the draft here with no backend
    // refetch) would reset architecture to null and permanently drop it on re-save.
    architecture: projectSpec.architecture,
    status: "draft",
  });
}

export function restorePrdDraftIfCurrent(input: {
  currentDraft: LiveProjectSpecDraft | null;
  restoredDraft: LiveProjectSpecDraft | null;
  requestedProjectId: number;
  requestedDraftId: string;
  requestedDraftUpdatedAt: number;
}): LiveProjectSpecDraft | null {
  const {
    currentDraft,
    restoredDraft,
    requestedProjectId,
    requestedDraftId,
    requestedDraftUpdatedAt,
  } = input;
  if (!restoredDraft || !currentDraft) {
    return currentDraft;
  }
  if (
    restoredDraft.projectId !== requestedProjectId ||
    restoredDraft.draftId !== requestedDraftId
  ) {
    return currentDraft;
  }
  if (currentDraft.projectId !== requestedProjectId || currentDraft.draftId !== requestedDraftId) {
    return currentDraft;
  }
  if (currentDraft.updatedAt !== requestedDraftUpdatedAt) {
    return currentDraft;
  }
  return restoredDraft;
}

export function useProductShellController() {
  const t = useT();
  const dialogs = useProductShellDialogs();
  const setOnboardingOpen = dialogs.setOnboardingOpen;
  const [activeInterview, setActiveInterview] = useState<InterviewRow | null>(null);
  const activeInterviewRef = useRef<InterviewRow | null>(null);
  const [generatedPlanDraft, setGeneratedPlanDraft] = useState<PlanGenerationResult | null>(null);
  const [planDraftReviewRequestNonce, setPlanDraftReviewRequestNonce] = useState(0);
  const [planDraftFailure, setPlanDraftFailure] = useState<{
    reason: PlanDraftLlmErrorReason;
    unresolvedQuestions: string[];
    issues?: PlanDraftQualityIssue[];
  } | null>(null);
  const [prdMode, setPrdMode] = useState<PrdMode>(null);
  const [prdDraft, setPrdDraft] = useState<LiveProjectSpecDraft | null>(null);
  const [currentProjectSpec, setCurrentProjectSpec] = useState<ProjectSpec | null>(null);
  const [prdPatchFeedback, setPrdPatchFeedback] = useState<PrdPatchFeedback | null>(null);
  // S-047: the AI's architecture option cards for the current two-stage focus,
  // carried out of the latest interview turn so the board can render them. The
  // student's card click (not this state) is what authors the decision.
  const [architectureProposals, setArchitectureProposals] = useState<ArchitectureProposals | null>(
    null,
  );
  const [prdBusy, setPrdBusy] = useState(false);
  const [pendingPrdPlanRequest, setPendingPrdPlanRequest] = useState<PendingPrdPlanRequest | null>(
    null,
  );
  const { expectingPlanDraftRef, planDraftPending, setPlanDraftExpectation } =
    usePlanDraftPendingController();
  const [pendingPlanRoute, setPendingPlanRoute] = useState<PendingPlanRouteConfirmation | null>(
    null,
  );
  const pendingPlanRouteRef = useRef<PendingPlanRouteConfirmation | null>(null);
  const [pendingPlanReplace, setPendingPlanReplace] = useState<{
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  const pendingPlanReplaceRef = useRef<{ resolve: (confirmed: boolean) => void } | null>(null);
  const wasStreaming = useRef(false);
  const prdDraftRestoreRequestRef = useRef(0);

  const projectSessionLoaded = useProjectSessionStore((s) => s.loaded);
  const loadProjectSession = useProjectSessionStore((s) => s.loadAll);
  const hasConnectedProvider = useProjectSessionStore(selectHasConnectedProvider);
  const providers = useProjectSessionStore((s) => s.providers);
  const setCurrentCardLocal = useWorkmapStore((s) => s.setCurrentCardLocal);
  const currentProjectId = useProjectSessionStore((s) => s.currentProjectId);
  const currentSessionId = useProjectSessionStore((s) => s.currentSessionId);
  const enableProvocationCards = useUiPreferencesStore((s) => s.enableProvocationCards);
  const provocationScaffoldMode = useUiPreferencesStore((s) => s.provocationScaffoldMode);
  const quickIntakeEnabled = useUiPreferencesStore((s) => s.quickIntakeEnabled);
  const currentProjectName = useProjectSessionStore(
    (s) => s.projects.find((p) => p.id === s.currentProjectId)?.name ?? null,
  );
  const currentProjectPath = useProjectSessionStore(
    (s) => s.projects.find((p) => p.id === s.currentProjectId)?.path ?? null,
  );
  const currentSessionTitle = useProjectSessionStore((s) =>
    s.currentSessionId === null
      ? null
      : (s.sessions.find((session) => session.id === s.currentSessionId)?.title ?? null),
  );
  const createSession = useProjectSessionStore((s) => s.createSession);
  const openProject = useProjectSessionStore((s) => s.openProject);
  const selectProject = useProjectSessionStore((s) => s.selectProject);
  const { toast } = useToast();
  const { toggleTheme } = useTheme();

  useEffect(() => {
    if (!projectSessionLoaded) {
      void loadProjectSession().catch((err) => {
        console.warn("project session load failed:", err);
      });
    }
  }, [projectSessionLoaded, loadProjectSession]);

  const isDemoRoute = import.meta.env.DEV && hasRecognizedDemoRoute();

  const roadmapModel = useRoadmap(currentSessionId);
  const planRoadmap = usePlanRoadmap(currentProjectId);
  const plan = usePlan(currentProjectId);
  const getProjectSpec = plan.getProjectSpec;
  const getProjectSpecDraft = plan.getProjectSpecDraft;
  const saveProjectSpecDraft = plan.saveProjectSpecDraft;
  const planRouter = usePlanRouter(currentProjectId);
  const currentDraft = plan.currentDraft;
  const planStatus = plan.status?.status;
  const prdReadiness = plan.prdStatus?.status ?? "missing";

  useEffect(() => {
    if (generatedPlanDraft && generatedPlanDraft.plan.project_id !== currentProjectId) {
      setGeneratedPlanDraft(null);
    }
  }, [currentProjectId, generatedPlanDraft]);

  useEffect(() => {
    prdDraftRestoreRequestRef.current += 1;
    setPrdMode(null);
    setPrdDraft(null);
    setCurrentProjectSpec(null);
    setPrdPatchFeedback(null);
    setPrdBusy(false);
    setPendingPrdPlanRequest(null);
  }, [currentProjectId]);

  useEffect(() => {
    if (currentProjectId === null || prdReadiness !== "minimal") {
      return;
    }
    let cancelled = false;
    void getProjectSpec()
      .then((projectSpec) => {
        if (cancelled || !projectSpec) return;
        setCurrentProjectSpec(projectSpec);
        if (prdMode === null) {
          setPrdMode("read");
        }
      })
      .catch((err) => {
        console.warn("load project spec failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProjectId, getProjectSpec, prdMode, prdReadiness]);

  useEffect(() => {
    const handler = (event: Event) => {
      const requestedProjectId = (event as CustomEvent<{ projectId?: number }>).detail?.projectId;
      if (typeof requestedProjectId === "number" && requestedProjectId !== currentProjectId) {
        return;
      }
      setPlanDraftReviewRequestNonce((nonce) => nonce + 1);
    };
    window.addEventListener(PLAN_DRAFT_REVIEW_REQUEST_EVENT, handler);
    return () => window.removeEventListener(PLAN_DRAFT_REVIEW_REQUEST_EVENT, handler);
  }, [currentProjectId]);

  useEffect(() => {
    if (currentProjectId === null || generatedPlanDraft !== null || planStatus !== "draft") {
      return;
    }
    let cancelled = false;
    void currentDraft()
      .then((draft) => {
        if (!cancelled && draft) {
          setGeneratedPlanDraft(draft);
        }
      })
      .catch((err) => {
        console.warn("load current plan draft failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [currentDraft, currentProjectId, generatedPlanDraft, planDraftReviewRequestNonce, planStatus]);

  useEffect(() => {
    pendingPlanRouteRef.current = pendingPlanRoute;
  }, [pendingPlanRoute]);

  useEffect(
    () => () => {
      pendingPlanRouteRef.current?.resolve(false);
    },
    [],
  );

  const requestPlanRouteConfirmation = useCallback(
    (decision: ConfirmableRouteDecision) =>
      new Promise<boolean>((resolve) => {
        setPendingPlanRoute({ decision, resolve });
      }),
    [],
  );

  const settlePlanRouteConfirmation = useCallback((approved: boolean) => {
    const pending = pendingPlanRouteRef.current;
    if (!pending) return;
    pending.resolve(approved);
    pendingPlanRouteRef.current = null;
    setPendingPlanRoute(null);
  }, []);

  useEffect(() => {
    pendingPlanReplaceRef.current = pendingPlanReplace;
  }, [pendingPlanReplace]);
  useEffect(
    () => () => {
      pendingPlanReplaceRef.current?.resolve(false);
    },
    [],
  );
  const requestPlanReplaceConfirmation = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        setPendingPlanReplace({ resolve });
      }),
    [],
  );
  const settlePlanReplaceConfirmation = useCallback((confirmed: boolean) => {
    const pending = pendingPlanReplaceRef.current;
    if (!pending) return;
    pending.resolve(confirmed);
    pendingPlanReplaceRef.current = null;
    setPendingPlanReplace(null);
  }, []);

  const handleBeforeChatSend = useCallback(
    async ({
      text,
      runMode,
    }: {
      text: string;
      runMode?: "interview" | "plan" | "build" | "verify";
    }) => {
      if (runMode === "interview") return true;
      const approvedPlanId = planRoadmap.status?.has_approved_plan
        ? planRoadmap.status.plan_id
        : plan.status?.has_approved_plan
          ? plan.status.plan_id
          : null;
      if (approvedPlanId === null || currentProjectId === null) return true;

      let decision: RouteDecision;
      try {
        decision = await planRouter.route(text);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes("cancel")) return false;
        toast({
          variant: "error",
          title: t("planning.route.error.routing_failed", {
            message,
          }),
        });
        return true;
      }

      // add_step routes to the dashboard add-step area; remove/supersede apply
      // chat / skip stay normal chat; every confirmable outcome opens the modal.
      // add_step routes to the dashboard add-step area; remove / supersede /
      // multi_step apply from the modal; duplicate / clarify are informational.
      if (decision.action === "chat" || decision.action === "skip") {
        return true;
      }

      const approved = await requestPlanRouteConfirmation(decision);

      if (decision.action === "duplicate" || decision.action === "clarify") {
        // Informational: the modal was the response — duplicate shows the
        // collision, clarify asks a question the user answers in chat (which
        // routes again). Don't re-send the original message.
        return false;
      }

      if (decision.action === "add_step") {
        // "Just chat" keeps the original message as a normal chat turn.
        if (!approved) return true;
        requestProjectRailTab("dashboard");
        requestPlanAddStepDraft({
          projectId: currentProjectId,
          planId: approvedPlanId,
          draft: decision.draft,
          reason: decision.reason,
          source: "chat_route",
        });
        toast({
          variant: "info",
          title: t("planning.route.confirm.dedicated_area_title"),
          description: t("planning.route.confirm.dedicated_area_description"),
        });
        return false;
      }

      // remove_step / supersede_step / multi_step apply directly from the modal;
      // "Cancel" dismisses without re-sending the request to chat.
      if (!approved) return false;
      try {
        if (decision.action === "remove_step") {
          const stepLabel = `${decision.target.stepId}: ${decision.target.title}`;
          await planRouter.removeStep(approvedPlanId, decision.target.dbId, decision.reason);
          toast({
            variant: "success",
            title: t("planning.route.confirm.removed_toast", { step: stepLabel }),
          });
        } else if (decision.action === "supersede_step") {
          const stepLabel = `${decision.target.stepId}: ${decision.target.title}`;
          await planRouter.supersedeStep(
            approvedPlanId,
            decision.target.dbId,
            decision.replacement,
            decision.reason,
          );
          toast({
            variant: "success",
            title: t("planning.route.confirm.superseded_toast", { step: stepLabel }),
          });
        } else {
          // multi_step: insert the whole dependency-ordered batch in one IPC.
          await planRouter.appendSteps(approvedPlanId, decision.drafts, {
            mutationReason: decision.reason,
          });
          toast({
            variant: "success",
            title: t("planning.route.confirm.added_steps_toast", {
              count: decision.drafts.length,
            }),
          });
        }
        await planRoadmap.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast({
          variant: "error",
          title: t("planning.route.confirm.apply_failed", { message }),
        });
      }
      return false;
    },
    [currentProjectId, plan, planRoadmap, planRouter, requestPlanRouteConfirmation, t, toast],
  );

  const planInterviewObserver = usePlanInterviewLLM({
    onPlanDraft: (draft) => {
      const interview = activeInterviewRef.current;
      if (!interview) {
        setPlanDraftExpectation(false);
        return;
      }
      setPlanDraftFailure(null);
      void (async () => {
        try {
          const submitted =
            interview.status === "draft"
              ? await plan.submitInterview(
                  interview.id,
                  draft.intentSummary,
                  draft.unresolvedQuestions,
                )
              : interview;
          setActiveInterview({
            ...submitted,
            intent_summary: draft.intentSummary,
            unresolved_questions: draft.unresolvedQuestions,
          });
          // A project already carrying an APPROVED plan would make plan
          // generation hard-fail in the backend ("already has approved plan").
          // We know this up front via plan.status, so confirm a deliberate
          // replacement (discards the approved plan + its steps) before
          // generating, instead of dead-ending the student on a raw error.
          let replaceApproved = false;
          if (plan.status?.has_approved_plan) {
            replaceApproved = await requestPlanReplaceConfirmation();
            if (!replaceApproved) {
              toast({
                variant: "info",
                title: t("planning.replace.kept_title"),
                description: t("planning.replace.kept_description"),
              });
              return;
            }
          }
          const generated = await plan.generateDraft(
            interview.id,
            draft.planInput,
            replaceApproved,
          );
          setGeneratedPlanDraft(generated);
          await planRoadmap.refresh();
          toast({
            variant: "success",
            title: t("planning.interview.draft_ready_title"),
            description: t("planning.interview.draft_ready_description"),
          });
        } catch (err) {
          const qualityError = decodePlanDraftQualityError(err);
          if (qualityError) {
            const unresolvedQuestions = qualityError.unresolvedQuestions ?? [];
            setPlanDraftFailure({
              reason: qualityError.reason,
              unresolvedQuestions,
              issues: qualityError.issues,
            });
            setActiveInterview((current) =>
              current
                ? {
                    ...current,
                    unresolved_questions: unresolvedQuestions,
                  }
                : current,
            );
            toast({
              variant: "warn",
              title: t(`planning.interview.recovery.${qualityError.reason}.title`),
              description: t(`planning.interview.recovery.${qualityError.reason}.description`),
            });
            return;
          }
          toast({
            variant: "error",
            title: t("planning.interview.draft_failed_title"),
            description: err instanceof Error ? err.message : String(err),
          });
        } finally {
          setPlanDraftExpectation(false);
        }
      })();
    },
    onPlanDraftError: (error) => {
      if (!expectingPlanDraftRef.current) return;
      if (!activeInterviewRef.current) {
        setPlanDraftExpectation(false);
        return;
      }
      setPlanDraftExpectation(false);
      setPlanDraftFailure({
        reason: error.reason,
        unresolvedQuestions: error.unresolvedQuestions ?? [],
        issues: error.issues,
      });
      setActiveInterview((current) =>
        current
          ? {
              ...current,
              unresolved_questions: error.unresolvedQuestions ?? [],
            }
          : current,
      );
      toast({
        variant: "warn",
        title: t(`planning.interview.recovery.${error.reason}.title`),
        description: t(`planning.interview.recovery.${error.reason}.description`),
      });
    },
  });
  const chat = useChatSession(currentSessionId, planInterviewObserver, handleBeforeChatSend);

  useEffect(() => {
    activeInterviewRef.current = activeInterview;
  }, [activeInterview]);

  const cards = roadmapModel.workmapCompat.cards;
  const currentCard = useWorkmapStore(selectCurrentCard);
  const currentCardId = roadmapModel.activeStepId;
  const allVerified = useWorkmapStore(selectAllCardsVerified);
  const pushChatComposerSeed = useChatComposerStore((s) => s.pushSeed);
  const requestChatFocus = useChatComposerStore((s) => s.requestFocus);
  const {
    activePlanStepIdForChat,
    pendingPlanStepPrompt,
    clearPendingPlanStepPrompt,
    rememberJustOpenedPlanStepMapping,
  } = useProductPlanStepRuntime({
    currentSessionId,
    currentCard,
    planRoadmapSteps: planRoadmap.steps,
  });
  const activePlanStep = useMemo(
    () =>
      activePlanStepIdForChat === undefined
        ? null
        : (planRoadmap.steps.find((item) => item.step.id === activePlanStepIdForChat) ?? null),
    [activePlanStepIdForChat, planRoadmap.steps],
  );
  const activePlanStepTargetFiles = useMemo(
    () =>
      Array.isArray(activePlanStep?.step.expected_files)
        ? activePlanStep.step.expected_files.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0,
          )
        : [],
    [activePlanStep],
  );
  const currentPlanRoadmapStep = useMemo(() => {
    if (!currentCard) return null;
    return (
      planRoadmap.steps.find((item) => item.mapping?.card_id === currentCard.id) ??
      (activePlanStepIdForChat === undefined
        ? null
        : (planRoadmap.steps.find((item) => item.step.id === activePlanStepIdForChat) ?? null))
    );
  }, [activePlanStepIdForChat, currentCard, planRoadmap.steps]);
  const currentPlanStepContext = useMemo(() => {
    const step = currentPlanRoadmapStep?.step;
    if (!step) return undefined;
    return {
      expectedFiles: stringArray(step.expected_files),
      verificationCommand: step.verification_command,
      verificationManualCheck: step.verification_manual_check,
      verificationKind: step.verification_kind,
      stepKind: step.step_kind ?? null,
      dependencies: stringArray(step.dependencies),
      parallelGroup: step.parallel_group,
      purpose: step.summary,
    };
  }, [currentPlanRoadmapStep]);
  const currentStepDetailStep = useMemo(() => {
    if (!currentCard) return null;
    const base = roadmapModel.steps.find((s) => s.id === currentCard.id) ?? null;
    if (!base) return null;
    return {
      ...base,
      linkedCriteria: currentPlanRoadmapStep?.linkedCriteria ?? base.linkedCriteria ?? [],
      decompositionRationale:
        currentPlanRoadmapStep?.decompositionRationale ?? base.decompositionRationale ?? null,
    };
  }, [currentCard, currentPlanRoadmapStep, roadmapModel.steps]);
  const hasExistingPlan = Boolean(
    plan.status?.has_plan ||
    plan.status?.has_approved_plan ||
    planRoadmap.hasPlan ||
    planRoadmap.status?.has_plan ||
    planRoadmap.status?.has_approved_plan,
  );
  const prdReferenceMode = shouldUsePrdReferenceSurface({
    prdMode,
    hasPlan: hasExistingPlan,
    roadmapStepCount: roadmapModel.steps.length,
    activePlanStepIdForChat,
  });
  const planAccepted = planRoadmap.hasPlan;
  const showEmptyPlanRail = shouldShowEmptyPlanRail({
    currentProjectId,
    planAccepted,
    roadmapStepCount: roadmapModel.steps.length,
    prdReadiness,
    prdMode,
  });

  const openSlideIn = useSlideInStore((s) => s.open);
  const closeSlideIn = useSlideInStore((s) => s.close);
  const slideInOpen = useSlideInStore((s) => s.isOpen);

  const openResultPanelWithContext = useCallback(() => {
    const currentFiles = currentCard ? roadmapModel.changedFilesForStep(currentCard.id) : [];
    openSlideIn({
      tab: "preview",
      files: currentFiles,
      changeSummary: currentCard?.changeSummary ?? null,
      emptyReason: currentFiles.length > 0 ? null : "no_output",
      previewRequestContext: {
        sessionId: currentSessionId,
        cardId: currentCard?.id ?? null,
        source: "review_action",
      },
      replaceFiles: true,
    });
  }, [currentCard, currentSessionId, openSlideIn, roadmapModel]);

  const promptContext = useMemo(
    () => promptContextFor(currentCard, cards.length, allVerified),
    [currentCard, cards.length, allVerified],
  );

  const showWorkmapError = useCallback(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        variant: "error",
        title: t("toast.workmap_save_failed"),
        description: message,
      });
    },
    [toast, t],
  );

  const handleStepSelect = (stepId: number) => {
    const card = cards.find((candidate) => candidate.id === stepId);
    if (!card) return;

    if (isDemoRoute) {
      setCurrentCardLocal(card.id);
      dialogs.setStepDetailOpen(true);
      return;
    }

    void (async () => {
      try {
        await roadmapModel.selectStep(card.id);
        dialogs.setStepDetailOpen(true);
      } catch (err) {
        showWorkmapError(err);
      }
    })();
  };

  const handleStepDetailOpenChange = (open: boolean) => {
    dialogs.setStepDetailOpen(open);
  };

  const handleOnboardingOpenChange = useCallback(
    (open: boolean) => {
      setOnboardingOpen(open);
    },
    [setOnboardingOpen],
  );

  const handleApprovalDecision = useCallback(
    (decision: ApprovalDecision) => {
      if (!currentCard) return;
      const decidedAt = Date.now();
      const judgment = { ...decision, decided_at: decidedAt };
      const isApprove = decision.outcome !== "revision_requested";
      const action = isApprove ? "approve" : "request_changes";
      const verifyLog = roadmapModel.verifyLogForStep(currentCard.id);
      const executedTestCommand = hasExecutedTestCommand({
        testCommand: verifyLog?.test_command ?? null,
        testExitCode: verifyLog?.test_exit_code ?? null,
      });
      const automatedTestsPassed = hasConcreteAutomatedPass({
        testResult: verifyLog?.test_result ?? null,
        testCommand: verifyLog?.test_command ?? null,
        testExitCode: verifyLog?.test_exit_code ?? null,
      });
      const changedFilesForCurrentStep = roadmapModel.changedFilesForStep(currentCard.id);
      const approvalProvenance = isApprove
        ? buildApprovalProvenance(
            {
              mode: provocationScaffoldMode,
              stage: "finalApproval",
              projectId: currentProjectId,
              sessionId: currentSessionId,
              taskId: currentCard.id,
              goalText: [currentCard.title, currentCard.summary].filter(Boolean).join("\n"),
              changedFiles: changedFilesForCurrentStep.map((file) =>
                normalizeChangedFile({ path: file.path }),
              ),
              verification: {
                aiClaimedDone: Boolean(verifyLog?.intent_match),
                automatedTestsPassed,
                testResult: verifyLog?.test_result,
                testCommand: verifyLog?.test_command ?? null,
                testExitCode: verifyLog?.test_exit_code ?? null,
                externalTestRun: verifyLog ? executedTestCommand : undefined,
                acceptanceCriterionConfirmed:
                  (decision.observationEvidence?.criterionIds.length ?? 0) > 0,
                manualChecks: decision.observationEvidence?.manualChecks ?? [],
                observationIds: decision.observationEvidence?.observationIds ?? [],
              },
            },
            {
              outcome: decision.outcome,
              decidedAt,
              riskReason: decision.outcome === "verification_deferred" ? null : decision.note,
            },
          )
        : null;
      // The ApprovalJudgment gate IS the deliberate human evaluation. honest-verify
      // labels `intent_match` as the AI's self-reported CLAIM, and the thesis makes
      // the human the final evaluator — so an explicit human approve (확인함 → 승인,
      // or 우려 있음 → 그래도 승인) must take effect even when the AI self-reports
      // intent unmet, instead of being blocked by the backend approve-eligibility
      // gate. Blind approval isn't prevented here; it's recorded as the
      // over-trust anti-metric (research design). Hence approveForce on approve.
      void (async () => {
        if (currentCard.state === "rejected") {
          if (!isApprove) {
            if (decision.note) {
              pushChatComposerSeed(decision.note);
              requestChatFocus();
            }
            dialogs.setStepDetailOpen(false);
            return "handled_rejected_revision" as const;
          }
          await roadmapModel.transitionStep(currentCard.id, "reopen");
          await chat.transitionCardRemote(currentCard.id, "request_verify");
        }
        await roadmapModel.transitionStep(currentCard.id, action, {
          judgment,
          approveForce: isApprove,
          approvalProvenance,
        });
        return "transitioned" as const;
      })()
        .then(async (result) => {
          await planRoadmap.refresh();
          if (result === "handled_rejected_revision") return;
          if (decision.outcome === "revision_requested" && decision.note) {
            pushChatComposerSeed(decision.note);
            requestChatFocus();
          }
          dialogs.setStepDetailOpen(false);
        })
        .catch(showWorkmapError);
    },
    [
      chat,
      currentCard,
      currentProjectId,
      currentSessionId,
      dialogs,
      planRoadmap,
      pushChatComposerSeed,
      provocationScaffoldMode,
      requestChatFocus,
      roadmapModel,
      showWorkmapError,
    ],
  );

  const handleGoToChatFromStepDetail = useCallback(() => {
    requestChatFocus();
    dialogs.setStepDetailOpen(false);
  }, [dialogs, requestChatFocus]);

  const openSettingsRoute = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    url.searchParams.set("route", "settings");
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  const openPromptHelperRoute = import.meta.env.DEV
    ? () => {
        const url = new URL(window.location.href);
        url.searchParams.delete("demo");
        url.searchParams.set("route", "prompt-helper");
        window.history.pushState({}, "", url.toString());
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    : undefined;

  const openUserGuideRoute = useCallback((doc: "index" | "troubleshooting") => {
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    url.searchParams.set("route", "user-guide");
    if (doc === "troubleshooting") {
      url.searchParams.set("doc", "troubleshooting");
    } else {
      url.searchParams.delete("doc");
    }
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  const handleOpenProject = useCallback(async () => {
    const picked = await pickFolder({ title: t("project.open_pick_title") });
    if (!picked) return;
    try {
      await openProject(picked);
    } catch (err) {
      toast({
        variant: "error",
        title: t("toast.project_open_failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [openProject, toast, t]);

  const handleExportSession = useCallback(async () => {
    if (currentSessionId === null) {
      toast({
        variant: "error",
        title: t("toast.export_no_session_title"),
        description: t("toast.export_no_session_description"),
      });
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const jsonl = await invoke<string>("export_session", { sessionId: currentSessionId });
      downloadSessionExport(currentSessionId, currentSessionTitle, jsonl);
      toast({
        variant: "success",
        title: t("toast.export_success_title"),
        description: t("toast.export_success_description"),
      });
    } catch (err) {
      toast({
        variant: "error",
        title: t("toast.export_failed_title"),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [currentSessionId, currentSessionTitle, t, toast]);

  useMenuEvents({
    "menu:new-project": () => dialogs.setNewProjectOpen(true),
    "menu:open-project": () => void handleOpenProject(),
    "menu:open-recent": (payload) => {
      const projectId = (payload as { project_id?: number } | undefined)?.project_id;
      if (typeof projectId !== "number") return;
      void selectProject(projectId).then(() => refreshMenuRecents());
    },
    "menu:export-session": () => void handleExportSession(),
    "menu:settings": openSettingsRoute,
    "menu:toggle-theme": () => toggleTheme(),
    "menu:help-tutorial": () => {
      const { tutorialEnabled, setTutorialEnabled } = useUiPreferencesStore.getState();
      const nextEnabled = !tutorialEnabled;
      setTutorialEnabled(nextEnabled);
      toast({
        variant: "info",
        title: nextEnabled ? t("toast.tutorial_on") : t("toast.tutorial_off"),
        description: t("toast.tutorial_description"),
      });
    },
    "menu:help-docs": () => {
      openUserGuideRoute("index");
    },
    "menu:help-issue": () => {
      openUserGuideRoute("troubleshooting");
      toast({
        variant: "info",
        title: t("toast.issue_guidance_title"),
        description: t("toast.issue_guidance_description"),
      });
    },
    "menu:help-about": () =>
      toast({
        variant: "info",
        title: t("toast.about_title"),
        description: t("toast.about_description"),
      }),
  });

  const handleVerify = useCallback(
    async (cardId: number) => {
      try {
        await roadmapModel.verifyStep(cardId);
      } catch (err) {
        showWorkmapError(err);
      }
    },
    [showWorkmapError, roadmapModel],
  );

  const handleOpenCodeForCard = (cardId: number) => {
    const card = cards.find((candidate) => candidate.id === cardId);
    const files = roadmapModel.changedFilesForStep(cardId);
    openSlideIn({
      tab: "code",
      files,
      changeSummary: card?.changeSummary ?? null,
      emptyReason: files.length > 0 ? null : "no_output",
      replaceFiles: true,
    });
  };

  const openCodePanelWithContext = useCallback(() => {
    const currentFiles = currentCard ? roadmapModel.changedFilesForStep(currentCard.id) : [];
    const hasBlockedWithoutOutput =
      planRoadmap.steps.some((step) => step.status === "blocked") &&
      cards.every((card) => roadmapModel.changedFilesForStep(card.id).length === 0);
    openSlideIn({
      tab: "code",
      files: currentFiles,
      changeSummary: currentCard?.changeSummary ?? null,
      emptyReason:
        currentFiles.length > 0
          ? null
          : hasBlockedWithoutOutput
            ? "blocked_no_output"
            : "no_output",
      replaceFiles: true,
    });
  }, [cards, currentCard, openSlideIn, planRoadmap.steps, roadmapModel]);

  const cardStateLabel = currentCard ? t(getCardStateMeta(currentCard.state).labelKey) : null;
  const currentCardIdForDerivedState = currentCard?.id ?? null;
  const currentChangedFiles = useMemo(
    () =>
      currentCardIdForDerivedState !== null
        ? roadmapModel.changedFilesForStep(currentCardIdForDerivedState)
        : [],
    [currentCardIdForDerivedState, roadmapModel],
  );
  const currentToolCallCount = useMemo(
    () =>
      currentCardIdForDerivedState !== null
        ? roadmapModel.toolCallCountForStep(currentCardIdForDerivedState)
        : 0,
    [currentCardIdForDerivedState, roadmapModel],
  );
  const currentVerifyLog: VerifyLogView | null = useMemo(
    () =>
      currentCardIdForDerivedState !== null
        ? roadmapModel.verifyLogForStep(currentCardIdForDerivedState)
        : null,
    [currentCardIdForDerivedState, roadmapModel],
  );
  const currentVerifyState: "idle" | "running" | "error" = useMemo(
    () =>
      currentCardIdForDerivedState !== null
        ? roadmapModel.verifyStateForStep(currentCardIdForDerivedState)
        : "idle",
    [currentCardIdForDerivedState, roadmapModel],
  );
  const currentVerifyError = useMemo(
    () =>
      currentCardIdForDerivedState !== null
        ? roadmapModel.verifyErrorForStep(currentCardIdForDerivedState)
        : null,
    [currentCardIdForDerivedState, roadmapModel],
  );

  // F2 (2026-06-10 E2E): on the happy path a build step never reached the
  // verified state, so the ApprovalJudgment gate — the core supervision moment —
  // was unreachable (handleVerify was only wired into recovery). When a build
  // turn finishes for the active step (still in `decomposed`), automatically
  // drive enter_instruct → request_verify → card_verify and open the step
  // detail so the honest-verify labels + the 확인/우려/수정요청 judgment surface.
  // The student still makes the judgment; the gate is just no longer
  // skippable/hidden. card_verify requires the card to be in Verifying
  // (src-tauri/.../verify.rs), hence the two transitions. We intentionally do
  // NOT gate on changed-files: that data may not have refreshed the instant the
  // turn ends, and missing it would re-hide the gate (the exact F2 bug);
  // card_verify honestly reports a no-output step so the student can pick 우려.
  const autoSurfaceVerifyInFlightRef = useRef(false);
  const prevChatStreamingRef = useRef(false);
  const autoSurfaceVerify = useCallback(async () => {
    const card = currentCard;
    if (autoSurfaceVerifyInFlightRef.current) return;
    if (!card || card.state !== "decomposed") return;
    if (currentVerifyState === "running" || currentVerifyLog) return;
    if (chat.error) return;
    autoSurfaceVerifyInFlightRef.current = true;
    try {
      await chat.transitionCardRemote(card.id, "enter_instruct");
      await chat.transitionCardRemote(card.id, "request_verify");
      await roadmapModel.verifyStep(card.id);
      dialogs.setStepDetailOpen(true);
    } catch (err) {
      showWorkmapError(err);
    } finally {
      autoSurfaceVerifyInFlightRef.current = false;
    }
  }, [
    chat,
    currentCard,
    currentVerifyLog,
    currentVerifyState,
    dialogs,
    roadmapModel,
    showWorkmapError,
  ]);

  useEffect(() => {
    const wasStreaming = prevChatStreamingRef.current;
    prevChatStreamingRef.current = chat.isStreaming;
    if (wasStreaming && !chat.isStreaming) {
      void autoSurfaceVerify();
    }
  }, [autoSurfaceVerify, chat.isStreaming]);

  // S-051 D3: a preflight-missed sidecar `model not found` failure (registry
  // drift, or a run-time race) lands in `chat.error` as a raw IPC rejection
  // string — today that surfaces only inside the chat transcript, which is
  // silent when the student is looking at the PRD screen (P0-02 QA
  // observation). Name the model and offer the switch action wherever they
  // are instead of relying on transcript visibility.
  const lastHandledModelNotFoundErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chat.error) return;
    if (lastHandledModelNotFoundErrorRef.current === chat.error) return;
    const args = modelNotFoundToastArgs(chat.error, t);
    if (!args) return;
    lastHandledModelNotFoundErrorRef.current = chat.error;
    toast({ variant: "error", ...args, onAction: openSettingsRoute });
  }, [chat.error, openSettingsRoute, t, toast]);

  const handleEmptyStateAction = useCallback(() => {
    if (currentProjectId === null) {
      dialogs.setNewProjectOpen(true);
      return;
    }
    void createSession(currentProjectId);
  }, [createSession, currentProjectId, dialogs]);

  const ensurePrdDraft = useCallback(() => {
    if (currentProjectId === null) return null;
    if (prdDraft?.projectId === currentProjectId && currentProjectSpec === null) {
      return prdDraft;
    }
    if (currentProjectSpec?.projectId === currentProjectId) {
      return draftFromProjectSpec(currentProjectSpec);
    }
    return createLiveProjectSpecDraft(currentProjectId, {
      draftId: plan.prdStatus?.draftId ?? `prd-draft-${currentProjectId}`,
      projectSpecId: plan.prdStatus?.projectSpecId ?? undefined,
      baseVersion: plan.prdStatus?.baseVersion ?? null,
      currentVersion: plan.prdStatus?.baseVersion ?? undefined,
    });
  }, [currentProjectId, currentProjectSpec, plan.prdStatus, prdDraft]);

  const handleOpenPrdAuthoring = useCallback(() => {
    if (currentProjectId === null) {
      dialogs.setNewProjectOpen(true);
      return;
    }
    if (!hasConnectedProvider) {
      openSettingsRoute();
      return;
    }
    const nextDraft = ensurePrdDraft();
    if (!nextDraft) return;
    setPrdDraft(nextDraft);
    setPrdPatchFeedback(null);
    setPrdMode("authoring");
    const restoreRequestId = prdDraftRestoreRequestRef.current + 1;
    prdDraftRestoreRequestRef.current = restoreRequestId;
    const requestedProjectId = nextDraft.projectId;
    const requestedDraftId = nextDraft.draftId;
    const requestedDraftUpdatedAt = nextDraft.updatedAt;
    void getProjectSpecDraft(nextDraft.draftId)
      .then((savedDraft) => {
        if (prdDraftRestoreRequestRef.current !== restoreRequestId) return;
        setPrdDraft((currentDraft) =>
          restorePrdDraftIfCurrent({
            currentDraft,
            restoredDraft: savedDraft,
            requestedProjectId,
            requestedDraftId,
            requestedDraftUpdatedAt,
          }),
        );
      })
      .catch(() => {
        // Keep the local draft visible; autosave will retry on the next edit.
      });
  }, [
    currentProjectId,
    dialogs,
    ensurePrdDraft,
    getProjectSpecDraft,
    hasConnectedProvider,
    openSettingsRoute,
  ]);

  const handleSubmitPrdAnswer = useCallback(
    (answer: string, conversation: PrdInterviewConversationTurn[] = []) => {
      if (!prdDraft || prdBusy) return;
      const runtime = prdRuntimeSelection(providers);
      if (!runtime) {
        openSettingsRoute();
        return;
      }
      prdDraftRestoreRequestRef.current += 1;
      setPrdBusy(true);
      return plan
        .submitPrdInterviewTurn({
          draftId: prdDraft.draftId,
          answer,
          conversation,
          provider: runtime.provider,
          model: runtime.model,
        })
        .then((result) => {
          setPrdDraft(result.liveDraft);
          setPrdPatchFeedback({
            validationOutcome: result.validationOutcome,
            appliedFieldPaths: result.appliedFieldPaths,
            rejectedReasons: result.rejectedReasons,
          });
          // S-047: surface (or clear) the AI's architecture cards for this turn.
          setArchitectureProposals(result.architectureProposals ?? null);
          return {
            assistantMessage: result.assistantMessage,
            appliedChange: (result.appliedFieldPaths?.length ?? 0) > 0,
          };
        })
        .catch((err) => {
          toast({
            variant: "error",
            title: t("prd.authoring.turn_failed_title"),
            description: prdTurnFailureDescription(err, t),
          });
          throw err;
        })
        .finally(() => {
          setPrdBusy(false);
        });
    },
    [openSettingsRoute, plan, prdBusy, prdDraft, providers, t, toast],
  );

  const handlePrdDraftChange = useCallback((draft: LiveProjectSpecDraft) => {
    prdDraftRestoreRequestRef.current += 1;
    setPrdDraft(draft);
  }, []);

  useEffect(() => {
    if (prdMode !== "authoring" || !prdDraft || currentProjectId === null) return;
    const handle = window.setTimeout(() => {
      void saveProjectSpecDraft(prdDraft).catch(() => {
        // Draft autosave is best-effort; the next edit or interview turn retries.
      });
    }, 600);
    return () => window.clearTimeout(handle);
  }, [currentProjectId, prdDraft, prdMode, saveProjectSpecDraft]);

  const handleSavePrdAndCreatePlan = useCallback(
    (draft: LiveProjectSpecDraft) => {
      if (currentProjectId === null || prdBusy) return;
      setPrdBusy(true);
      void plan
        .saveProjectSpec(draft.spec, "interview")
        .then((saved) => {
          setCurrentProjectSpec(saved);
          setPrdDraft(null);
          setPrdPatchFeedback(null);
          setArchitectureProposals(null);
          setPrdMode("read");
          toast({
            variant: "success",
            title: t("prd.authoring.save_success_title"),
            description: t("prd.authoring.save_success_description"),
          });
        })
        .catch((err) => {
          toast({
            variant: "error",
            title: t("prd.authoring.save_failed_title"),
            description: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          setPrdBusy(false);
        });
    },
    [currentProjectId, plan, prdBusy, t, toast],
  );

  const startPlanGenerationFromPrd = useCallback(
    async (projectSpec: ProjectSpec, options: { interviewAnswers?: InterviewAnswer[] } = {}) => {
      if (currentProjectId === null) return;
      if (chat.isStreaming) {
        requestChatFocus();
        return;
      }
      try {
        let interview = await plan.startInterview(projectSpec.goal);
        for (const answer of options.interviewAnswers ?? []) {
          interview = await plan.saveInterviewAnswer(interview.id, answer.question, answer.answer);
        }
        activeInterviewRef.current = interview;
        setActiveInterview(interview);
        setPlanDraftExpectation(true);
        setPlanDraftFailure(null);
        setGeneratedPlanDraft(null);
        requestChatFocus();
        await chat.sendUserMessage(buildPrdPlanGenerationPrompt(projectSpec), "interview", false);
      } catch (err) {
        setPlanDraftExpectation(false);
        toast({
          variant: "error",
          title: t("planning.interview.draft_failed_title"),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [chat, currentProjectId, plan, requestChatFocus, setPlanDraftExpectation, t, toast],
  );

  useEffect(() => {
    if (
      pendingPrdPlanRequest === null ||
      currentSessionId === null ||
      chat.loadingHistory ||
      !chat.isTauri
    ) {
      return;
    }
    const { projectSpec, interviewAnswers } = pendingPrdPlanRequest;
    setPendingPrdPlanRequest(null);
    void startPlanGenerationFromPrd(projectSpec, { interviewAnswers });
  }, [
    chat.isTauri,
    chat.loadingHistory,
    currentSessionId,
    pendingPrdPlanRequest,
    startPlanGenerationFromPrd,
  ]);

  const handleCreatePlanFromRail = useCallback(() => {
    if (currentProjectId === null) {
      dialogs.setNewProjectOpen(true);
      return;
    }
    if (!hasConnectedProvider) {
      openSettingsRoute();
      return;
    }
    if (currentProjectSpec) {
      if (hasExistingPlan) {
        setPrdMode("read");
        requestChatFocus();
        toast({
          variant: "info",
          title: t("prd.read_view.plan_created"),
          description: t("prd.read_view.plan_created_description"),
        });
        return;
      }
      if (currentSessionId === null || chat.loadingHistory || !chat.isTauri) {
        setPendingPrdPlanRequest({ projectSpec: currentProjectSpec });
        if (currentSessionId === null) {
          void createSession(currentProjectId);
        }
        requestChatFocus();
        return;
      }
      void startPlanGenerationFromPrd(currentProjectSpec);
      return;
    }
    if (currentSessionId === null) {
      void createSession(currentProjectId).then(() => requestChatFocus());
      return;
    }
    requestChatFocus();
  }, [
    chat.isTauri,
    chat.loadingHistory,
    createSession,
    currentProjectId,
    currentProjectSpec,
    currentSessionId,
    dialogs,
    hasExistingPlan,
    hasConnectedProvider,
    openSettingsRoute,
    requestChatFocus,
    startPlanGenerationFromPrd,
    t,
    toast,
  ]);

  const handleQuickIntakeSubmit = useCallback(
    (draft: LiveProjectSpecDraft, input: QuickIntakeInput) => {
      if (currentProjectId === null || prdBusy) return;
      if (!hasConnectedProvider) {
        openSettingsRoute();
        return;
      }
      // QuickIntake must clear the SAME confirmable gate as the interview path —
      // do not fast-path a vacuous PRD straight to save (round-2 P1-13). The
      // student's answers are already on the live draft, so keep them on the board.
      if (!validateConfirmableProjectSpec(draft.spec).valid) {
        toast({
          variant: "error",
          title: t("prd.authoring.quick_intake_incomplete_title"),
          description: t("prd.authoring.quick_intake_incomplete_description"),
        });
        return;
      }
      const interviewAnswers = quickIntakeInterviewAnswers(input);
      setPrdBusy(true);
      void plan
        .saveProjectSpec(draft.spec, "interview")
        .then((saved) => {
          setCurrentProjectSpec(saved);
          setPrdDraft(null);
          setPrdPatchFeedback(null);
          setArchitectureProposals(null);
          setPrdMode("read");
          toast({
            variant: "success",
            title: t("prd.authoring.save_success_title"),
            description: t("prd.authoring.save_success_description"),
          });
          if (currentSessionId === null || chat.loadingHistory || !chat.isTauri) {
            setPendingPrdPlanRequest({ projectSpec: saved, interviewAnswers });
            if (currentSessionId === null) {
              void createSession(currentProjectId);
            }
            requestChatFocus();
            return;
          }
          void startPlanGenerationFromPrd(saved, { interviewAnswers });
        })
        .catch((err) => {
          toast({
            variant: "error",
            title: t("prd.authoring.save_failed_title"),
            description: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          setPrdBusy(false);
        });
    },
    [
      chat.isTauri,
      chat.loadingHistory,
      createSession,
      currentProjectId,
      currentSessionId,
      hasConnectedProvider,
      openSettingsRoute,
      plan,
      prdBusy,
      requestChatFocus,
      startPlanGenerationFromPrd,
      t,
      toast,
    ],
  );

  const {
    stageBanner,
    inputBlocked,
    composerHint: baseComposerHint,
    emptyState,
    getStarted,
    latestInterviewQuestion,
    showInterviewPanel,
    showProviderSetupBanner,
  } = useProductConversationModel({
    isDemoRoute,
    projectSessionLoaded,
    currentProjectId,
    currentSessionId,
    currentProjectName,
    hasConnectedProvider,
    // S-046 (P1-01): gate the composer when the supervised runtime is
    // unavailable even though a provider is connected. Reason + action come
    // from the concrete runtimeSelection state (message + setupAction).
    runtimeUnavailable: !isDemoRoute && chat.runtimeSelection?.state === "unavailable",
    runtimeReason: chat.runtimeSelection?.message,
    runtimeActionLabel: runtimeSetupActionLabel(chat.runtimeSelection?.setupAction, t),
    runtimeOnAction:
      chat.runtimeSelection?.setupAction === "open_project"
        ? handleEmptyStateAction
        : chat.runtimeSelection?.setupAction === "retry_runtime"
          ? undefined
          : openSettingsRoute,
    providerDoneHint: cockpitProviderLabel(providers),
    cardCount: cards.length,
    currentCard,
    allVerified,
    messages: chat.messages,
    generatedPlanDraftPresent: generatedPlanDraft !== null,
    planStatus: plan.status,
    prdStatus: prdReadiness,
    hasPlan: Boolean(plan.status?.has_plan || planRoadmap.hasPlan || generatedPlanDraft !== null),
    hasApprovedPlan: Boolean(
      plan.status?.has_approved_plan || planRoadmap.status?.has_approved_plan,
    ),
    onEmptyStateAction: handleEmptyStateAction,
    onOpenSettings: openSettingsRoute,
    onWriteInstruction: () => dialogs.setStepDetailOpen(true),
    onProviderAction: () => setOnboardingOpen(true),
    onPrdAction: handleOpenPrdAuthoring,
    onPlanAction: handleCreatePlanFromRail,
    onSessionAction: () => {
      if (currentProjectId !== null) void createSession(currentProjectId);
    },
    onOpenResultPanel: openResultPanelWithContext,
    onOpenReviewPanel: () => dialogs.setStepDetailOpen(true),
    t,
  });

  const planStepComposerHint = useMemo(
    () =>
      pendingPlanStepPrompt
        ? {
            message: t("stage.hint_plan_step_prompt"),
            actionLabel: t("stage.action_insert_step_prompt"),
            onAction: () => {
              pushChatComposerSeed(pendingPlanStepPrompt.prompt);
              clearPendingPlanStepPrompt();
            },
          }
        : null,
    [clearPendingPlanStepPrompt, pendingPlanStepPrompt, pushChatComposerSeed, t],
  );
  const composerHint = planStepComposerHint ?? baseComposerHint;

  const sendMessage = useCallback(
    (text: string) => {
      const effectivePlanAccepted = planAccepted || activePlanStepIdForChat !== undefined;
      void chat.sendUserMessage(text, undefined, effectivePlanAccepted, activePlanStepIdForChat);
      if (pendingPlanStepPrompt) clearPendingPlanStepPrompt();
    },
    [
      activePlanStepIdForChat,
      chat,
      clearPendingPlanStepPrompt,
      pendingPlanStepPrompt,
      planAccepted,
    ],
  );

  const handleRetryError = useCallback(() => {
    const lastUser = [...chat.messages].reverse().find((message) => message.kind === "user");
    if (lastUser?.kind === "user") {
      const effectivePlanAccepted = planAccepted || activePlanStepIdForChat !== undefined;
      void chat.sendUserMessage(
        lastUser.content,
        undefined,
        effectivePlanAccepted,
        activePlanStepIdForChat,
      );
      return;
    }
    if (chat.retryLastUserMessage()) return;
    toast({
      variant: "error",
      title: t("toast.retry_unavailable"),
      description: t("toast.retry_unavailable_description"),
    });
  }, [activePlanStepIdForChat, chat, planAccepted, toast, t]);

  const openPlanInterview = useCallback(
    (goal?: string) => {
      const trimmed = goal?.trim() ?? "";
      if (trimmed.length > 0) {
        void chat.sendUserMessage(trimmed, "interview", false);
      }
    },
    [chat],
  );

  const interviewPanelDisabled = currentSessionId === null || !hasConnectedProvider;
  const interviewAnswers = useMemo(
    () => interviewAnswersFromQuestions(activeInterview?.questions),
    [activeInterview?.questions],
  );
  const unresolvedQuestionCount = useMemo(
    () => stringArray(activeInterview?.unresolved_questions).length,
    [activeInterview?.unresolved_questions],
  );

  const {
    lastManualCheckpointLabel,
    recoveryCheckpoints,
    checkpointsLoading,
    checkpointsError,
    restoringCheckpointId,
    failedStepRecovery,
    refreshCheckpoints,
    handleManualCheckpoint,
    handleRestoreCheckpoint,
  } = useProductRecovery({
    chat,
    currentSessionId,
    currentCard,
    currentVerifyLog,
    currentVerifyState,
    currentVerifyError,
    planAccepted,
    activePlanStepIdForChat,
    onRefreshRoadmap: roadmapModel.refresh,
    onVerifyCurrentStep: () => {
      if (!currentCard) return;
      void handleVerify(currentCard.id);
    },
    onRetryError: handleRetryError,
    onOpenPlanInterview: openPlanInterview,
    toast,
    t,
  });

  useEffect(() => {
    if (wasStreaming.current && !chat.isStreaming) {
      void roadmapModel.refresh();
      void planRoadmap.refresh();
      void refreshCheckpoints();
    }
    wasStreaming.current = chat.isStreaming;
  }, [chat.isStreaming, refreshCheckpoints, roadmapModel, planRoadmap]);

  useGlobalShortcuts({
    onManualCheckpoint: handleManualCheckpoint,
    onNewProject: () => dialogs.setNewProjectOpen(true),
    onOpenSettings: openSettingsRoute,
    onOpenPromptHelper: openPromptHelperRoute,
    onToggleSlidePanel: () => {
      if (slideInOpen) {
        closeSlideIn();
      } else {
        openSlideIn({ tab: "code" });
      }
    },
  });

  const handleStartInterview = useCallback(
    (goal: string) => {
      if (currentProjectId === null) return;
      void (async () => {
        try {
          const interview = await plan.startInterview(goal);
          setActiveInterview(interview);
          await chat.sendUserMessage(goal, "interview", false);
        } catch (err) {
          toast({
            variant: "error",
            title: t("planning.interview.start_failed_title"),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    },
    [chat, currentProjectId, plan, t, toast],
  );

  const handleSubmitInterviewAnswer = useCallback(
    (answer: string) => {
      const interview = activeInterviewRef.current;
      if (!interview) {
        handleStartInterview(answer);
        return;
      }
      void (async () => {
        try {
          const updated = await plan.saveInterviewAnswer(
            interview.id,
            latestInterviewQuestion,
            answer,
          );
          setActiveInterview(updated);
          await chat.sendUserMessage(answer, "interview", false);
        } catch (err) {
          toast({
            variant: "error",
            title: t("planning.interview.save_failed_title"),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    },
    [chat, handleStartInterview, latestInterviewQuestion, plan, t, toast],
  );

  const handleCompleteInterview = useCallback(() => {
    const interview = activeInterviewRef.current;
    if (!interview) return;
    const submitPrompt = t("planning.interview.submit_prompt", {
      goal: interview.goal,
    });
    setPlanDraftExpectation(true);
    setPlanDraftFailure(null);
    void chat.sendUserMessage(submitPrompt, "interview", false);
  }, [chat, setPlanDraftExpectation, t]);

  const handleApproveGeneratedPlan = useCallback(
    (critiqueResolution?: PlanCritiqueResolution) => {
      if (!generatedPlanDraft) return;
      void (async () => {
        try {
          await plan.approvePlan(generatedPlanDraft.plan.id, critiqueResolution);
          setGeneratedPlanDraft(null);
          await planRoadmap.refresh();
        } catch (err) {
          toast({
            variant: "error",
            title: t("planning.approval.approve_failed_title"),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    },
    [generatedPlanDraft, plan, planRoadmap, t, toast],
  );

  const handleRequestPlanRevision = useCallback(
    (feedback: string) => {
      if (!generatedPlanDraft) return;
      const prompt = t("planning.approval.revision_prompt", {
        feedback,
        draft: JSON.stringify({
          plan: generatedPlanDraft.plan,
          steps: generatedPlanDraft.steps,
        }),
      });
      setPlanDraftExpectation(true);
      setPlanDraftFailure(null);
      void chat.sendUserMessage(prompt, "interview", false);
    },
    [chat, generatedPlanDraft, setPlanDraftExpectation, t],
  );

  const handleRetryPlanDraft = useCallback(() => {
    const interview = activeInterviewRef.current;
    if (!interview || !planDraftFailure) return;
    // Feed the concrete missing checks into the retry so regeneration makes
    // progress instead of reproducing the identical rejection (round-2 S-041
    // plan-confirm loop). The reason slug alone never told the model what to add.
    // S-050 D4: when the backend attached machine-coded issues, build the
    // missing-checks line from the same localized copy the recovery screen
    // shows, and append self-passing examples so regeneration has a target.
    const issues = planDraftFailure.issues ?? [];
    const missing =
      issues.length > 0
        ? buildIssueLines(issues, t).join("; ")
        : planDraftFailure.unresolvedQuestions
            .map((item) => item.trim())
            .filter(Boolean)
            .join("; ");
    const recoveryExamples = issues.length > 0 ? collectRecoveryExamples(issues, t) : [];
    const examples =
      recoveryExamples.length > 0
        ? t("planning.interview.compact_retry_examples", { list: recoveryExamples.join("; ") })
        : "";
    const prompt = t("planning.interview.compact_retry_prompt", {
      goal: interview.goal,
      reason: planDraftFailure.reason,
      missing: missing || t("planning.interview.compact_retry_missing_fallback"),
      examples,
    });
    setPlanDraftExpectation(true);
    setPlanDraftFailure(null);
    void chat.sendUserMessage(prompt, "interview", false);
  }, [chat, planDraftFailure, setPlanDraftExpectation, t]);

  const handleDiscardGeneratedPlan = useCallback(() => {
    if (!generatedPlanDraft) return;
    void (async () => {
      try {
        await plan.discardPlan(generatedPlanDraft.plan.id);
        setGeneratedPlanDraft(null);
        await plan.refresh();
      } catch (err) {
        toast({
          variant: "error",
          title: t("planning.approval.discard_failed_title"),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, [generatedPlanDraft, plan, t, toast]);

  const prdSurface = useMemo(() => {
    if (prdMode === "authoring" && prdDraft) {
      return createElement(PrdAuthoringBoard, {
        projectName: currentProjectName ?? t("project.untitled"),
        projectPath: currentProjectPath,
        prdState: prdReadiness === "minimal" ? "editing" : prdReadiness,
        draft: prdDraft,
        busy: prdBusy,
        recentlyChangedFields: prdPatchFeedback?.appliedFieldPaths ?? [],
        patchFeedback: prdPatchFeedback,
        architectureProposals,
        quickIntakeEnabled,
        onDraftChange: handlePrdDraftChange,
        onSubmitAnswer: handleSubmitPrdAnswer,
        onSavePrdAndCreatePlan: handleSavePrdAndCreatePlan,
        onQuickIntakeSubmit: handleQuickIntakeSubmit,
      });
    }
    if (prdMode === "read" && currentProjectSpec) {
      return createElement(FinalPrdReadView, {
        projectName: currentProjectName ?? t("project.untitled"),
        projectSpec: currentProjectSpec,
        planActionLabel: t("prd.authoring.create_plan"),
        canCreatePlan: !hasExistingPlan,
        planStatusLabel: hasExistingPlan ? t("prd.read_view.plan_created") : null,
        onEdit: () => {
          setPrdDraft(draftFromProjectSpec(currentProjectSpec));
          setPrdPatchFeedback(null);
          setArchitectureProposals(null);
          setPrdMode("authoring");
        },
        onCreatePlan: handleCreatePlanFromRail,
      });
    }
    return null;
  }, [
    architectureProposals,
    currentProjectName,
    currentProjectPath,
    currentProjectSpec,
    hasExistingPlan,
    handleCreatePlanFromRail,
    handlePrdDraftChange,
    handleQuickIntakeSubmit,
    handleSavePrdAndCreatePlan,
    handleSubmitPrdAnswer,
    prdBusy,
    prdDraft,
    prdMode,
    prdPatchFeedback,
    prdReadiness,
    quickIntakeEnabled,
    t,
  ]);

  return {
    projectName: currentProjectName,
    providerBanner: {
      show: showProviderSetupBanner && getStarted === null,
      title: t("chat.provider_setup_title"),
      description: t("stage.gate_no_provider"),
      actionLabel: t("stage.action_open_settings"),
      onOpenSettings: openSettingsRoute,
    },
    conversation: {
      messages: chat.messages,
      messagesLoading: chat.loadingHistory,
      getStarted,
      cardTitle: currentCard ? currentCard.title : null,
      sessionTitle: currentSessionTitle,
      cardStateLabel,
      stageBanner,
      onSendMessage: sendMessage,
      onOpenSlidePanel: openCodePanelWithContext,
      onOpenResultPanel: openResultPanelWithContext,
      onRetryError: handleRetryError,
      onApproveToolCall: (
        toolCallId: string,
        modifiedArgs?: unknown,
        approvalMetadata?: ToolApprovalMetadata,
      ) => void chat.approveToolCall(toolCallId, modifiedArgs, approvalMetadata),
      onDenyToolCall: (toolCallId: string, reason?: string) =>
        void chat.denyToolCall(toolCallId, reason),
      interviewPanel: showInterviewPanel
        ? createElement(SocraticInterviewPanel, {
            started: activeInterview !== null,
            answers: interviewAnswers,
            unresolvedQuestionCount,
            loading: chat.isStreaming,
            disabled: interviewPanelDisabled,
            provocation: {
              enabled: enableProvocationCards,
              mode: provocationScaffoldMode,
              projectId: currentProjectId,
              sessionId: currentSessionId,
            },
            onSubmitGoal: handleStartInterview,
            onSubmitAnswer: handleSubmitInterviewAnswer,
            onComplete: handleCompleteInterview,
          })
        : null,
      modelLabel: planRouter.routeBusy
        ? planRouter.routeCancelRequested
          ? t("planning.route.cancel_requested_status")
          : t("planning.route.routing_status")
        : (cockpitProviderLabel(providers) ?? t("chat.input.model_disconnected_label")),
      runtimeSelection: chat.runtimeSelection,
      isStreaming: chat.isStreaming,
      runStartedAt: chat.runStartedAt,
      cancelRequested: chat.cancelRequested,
      onCancelStreaming: () => void chat.cancel(),
      isRouting: planRouter.routeBusy,
      routeStartedAt: planRouter.routeStartedAt,
      routeCancelRequested: planRouter.routeCancelRequested,
      onCancelRouting: () => void planRouter.cancelRoute(),
      inputDisabled:
        chat.isStreaming ||
        planRouter.busy ||
        pendingPlanRoute !== null ||
        (!isDemoRoute && currentSessionId === null),
      inputBlocked,
      composerHint,
      context: promptContext,
      emptyState,
      provocation: {
        enabled: enableProvocationCards,
        mode: provocationScaffoldMode,
        projectId: currentProjectId,
        sessionId: currentSessionId,
        goalText: currentCard?.title ?? currentSessionTitle,
        changedFiles: currentCard
          ? roadmapModel
              .changedFilesForStep(currentCard.id)
              .map((file) => normalizeChangedFile({ path: file.path }))
          : [],
        targetFiles: activePlanStepTargetFiles,
        planSteps: activePlanStep ? [normalizePlanStep(activePlanStep.step)] : [],
        verification: currentCard
          ? {
              aiClaimedDone: Boolean(currentVerifyLog?.intent_match),
              automatedTestsPassed: hasConcreteAutomatedPass({
                testResult: currentVerifyLog?.test_result ?? null,
                testCommand: currentVerifyLog?.test_command ?? null,
                testExitCode: currentVerifyLog?.test_exit_code ?? null,
              }),
              testResult: currentVerifyLog?.test_result,
              testCommand: currentVerifyLog?.test_command ?? null,
              testExitCode: currentVerifyLog?.test_exit_code ?? null,
              externalTestRun: currentVerifyLog
                ? hasExecutedTestCommand({
                    testCommand: currentVerifyLog.test_command ?? null,
                    testExitCode: currentVerifyLog.test_exit_code ?? null,
                  })
                : undefined,
              approvalProvenance: currentCard.approvalProvenance,
              approvedWithRisk: Boolean(currentCard.approvalProvenance?.riskAccepted),
            }
          : undefined,
        approvalProvenance: currentCard?.approvalProvenance ?? null,
        suppressAiSelfReportOnly:
          allVerified || currentCard?.state === "verified" || currentCard?.state === "extended",
        checkpointAvailable: recoveryCheckpoints.length > 0,
        onOpenRecovery: () => dialogs.setRecoveryOpen(true),
      },
      planDraftApproval: generatedPlanDraft
        ? createElement(
            Suspense,
            { fallback: null },
            createElement(PlanDraftApprovalScreen, {
              draft: generatedPlanDraft,
              interview: activeInterview,
              busy: chat.isStreaming,
              provocation: {
                enabled: enableProvocationCards,
                mode: provocationScaffoldMode,
                projectId: currentProjectId,
                sessionId: currentSessionId,
              },
              onApprove: handleApproveGeneratedPlan,
              onRequestRevision: handleRequestPlanRevision,
              onDiscard: handleDiscardGeneratedPlan,
            }),
          )
        : planDraftFailure
          ? createElement(PlanDraftRecoveryScreen, {
              reason: planDraftFailure.reason,
              unresolvedQuestions: planDraftFailure.unresolvedQuestions,
              issues: planDraftFailure.issues,
              busy: chat.isStreaming,
              onRetry: handleRetryPlanDraft,
              onDismiss: () => setPlanDraftFailure(null),
              onEditPrd: () => {
                setPlanDraftFailure(null);
                handleOpenPrdAuthoring();
              },
            })
          : shouldRenderPlanDraftPending({
                planDraftPending,
                hasGeneratedPlanDraft: generatedPlanDraft !== null,
                hasPlanDraftFailure: planDraftFailure !== null,
              })
            ? createElement(PlanDraftPendingScreen)
            : null,
      prdSurface,
      prdSurfaceMode: prdReferenceMode ? ("reference" as const) : ("full" as const),
    },
    roadmap: {
      visible: roadmapModel.steps.length > 0 || planAccepted,
      showEmpty: showEmptyPlanRail,
      steps: roadmapModel.steps,
      activeStepId: roadmapModel.activeStepId,
      progress: roadmapModel.progress,
      goal: generatedPlanDraft?.plan.goal ?? plan.status?.plan_summary ?? null,
      onSelectStep: handleStepSelect,
      onPlanStepOpened: rememberJustOpenedPlanStepMapping,
      onCreatePlan: handleCreatePlanFromRail,
    },
    planRoadmap,
    planStepRationaleChallenge:
      currentProjectId !== null
        ? {
            projectId: currentProjectId,
            onChallenge: plan.challengeStepRationale,
            onAcceptOffer: plan.acceptRationaleChallengeOffer,
            onDismissOffer: plan.dismissRationaleChallengeOffer,
          }
        : undefined,
    stepDetail: {
      open: dialogs.stepDetailOpen,
      step: currentStepDetailStep,
      toolCallCount: currentToolCallCount,
      verifyLog: currentVerifyLog,
      verifyState: currentVerifyState,
      verifyError: currentVerifyError,
      changedFiles: currentChangedFiles,
      planContext: currentPlanStepContext,
      onOpenChange: handleStepDetailOpenChange,
      onOpenCode: () => {
        if (!currentCard) return;
        handleOpenCodeForCard(currentCard.id);
      },
      onOpenPreview: openResultPanelWithContext,
      onOpenRecovery: () => {
        dialogs.setStepDetailOpen(false);
        dialogs.setRecoveryOpen(true);
      },
      onVerifyFirst: () => {
        if (!currentCard) return;
        void handleVerify(currentCard.id);
      },
      rollbackAvailable: recoveryCheckpoints.length > 0,
      provocation: {
        enabled: enableProvocationCards,
        mode: provocationScaffoldMode,
        projectId: currentProjectId,
        sessionId: currentSessionId,
      },
      onApprovalDecision: handleApprovalDecision,
      onGoToChat: handleGoToChatFromStepDetail,
    },
    recovery: {
      open: dialogs.recoveryOpen,
      onOpenChange: dialogs.setRecoveryOpen,
      panel: {
        sessionAvailable: currentSessionId !== null,
        checkpoints: recoveryCheckpoints,
        loading: checkpointsLoading,
        error: checkpointsError,
        restoringCheckpointId,
        failedStep: failedStepRecovery,
        onRefresh: () => void refreshCheckpoints(),
        onCreateCheckpoint: handleManualCheckpoint,
        onRestoreCheckpoint: (checkpointId: number) => void handleRestoreCheckpoint(checkpointId),
      },
      checkpointCount: recoveryCheckpoints.length,
      hasFailedStep: failedStepRecovery !== null,
    },
    modals: {
      onboarding: {
        open: dialogs.onboardingOpen,
        onOpenChange: handleOnboardingOpenChange,
        onConnected: () => {
          if (currentProjectId === null) {
            dialogs.setNewProjectOpen(true);
            return;
          }
          if (currentSessionId === null) void createSession(currentProjectId);
        },
      },
      newProject: {
        open: dialogs.newProjectOpen,
        onOpenChange: dialogs.setNewProjectOpen,
      },
      planRoute: {
        open: pendingPlanRoute !== null,
        decision: pendingPlanRoute?.decision ?? null,
        steps: planRoadmap.steps,
        busy: planRouter.appendBusy,
        onApprove: () => settlePlanRouteConfirmation(true),
        onReject: () => settlePlanRouteConfirmation(false),
      },
      planReplace: {
        open: pendingPlanReplace !== null,
        onConfirm: () => settlePlanReplaceConfirmation(true),
        onCancel: () => settlePlanReplaceConfirmation(false),
      },
    },
    hiddenState: {
      currentCardId,
      lastManualCheckpointLabel,
    },
  };
}

export type ProductShellController = ReturnType<typeof useProductShellController>;
