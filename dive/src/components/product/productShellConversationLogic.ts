import type { ChatStageBanner } from "../shell/ChatArea";
import type { ChatMessage } from "../chat/types";
import type { CardTileData } from "../workmap/types";
import type {
  GetStartedModel,
  GetStartedStepKey,
  GetStartedStepStatus,
} from "./GetStartedChecklist";
import type { WorkspacePlanStatus, WorkspacePrdReadiness } from "../../features/planning";

type Translate = (key: string, values?: Record<string, string | number>) => string;
type Action = () => void;

export function deriveStageBanner(input: {
  cardCount: number;
  currentCard: Pick<CardTileData, "state" | "summary"> | null;
  allVerified: boolean;
  onOpenResultPanel: Action;
  onOpenReviewPanel?: Action;
  t: Translate;
}): ChatStageBanner | null {
  if (input.cardCount === 0) return null;
  const resultAction = {
    actionLabel: input.t("chat.result_label"),
    onAction: input.onOpenResultPanel,
  };
  if (input.allVerified) {
    return {
      tone: "success",
      message: input.t("stage.banner_all_verified"),
      ...resultAction,
    };
  }
  const active = input.currentCard;
  if (!active) {
    return {
      tone: "info",
      message: input.t("stage.banner_select_card"),
    };
  }
  if (active.state === "decomposed") {
    return { tone: "warn", message: input.t("stage.banner_decomposed") };
  }
  if (active.state === "instructed") {
    const hasInstruction = (active.summary ?? "").trim().length > 0;
    if (!hasInstruction) {
      return { tone: "warn", message: input.t("stage.banner_instructed_empty") };
    }
    return { tone: "info", message: input.t("stage.banner_instructed") };
  }
  if (active.state === "verifying") {
    return {
      tone: "info",
      message: input.t("stage.banner_verifying"),
      actionLabel: input.t("stage.action_open_review"),
      onAction: input.onOpenReviewPanel,
    };
  }
  if (active.state === "rejected") {
    return {
      tone: "warn",
      message: input.t("stage.banner_rejected"),
      actionLabel: input.t("stage.action_open_review"),
      onAction: input.onOpenReviewPanel,
    };
  }
  if (active.state === "verified") {
    return { tone: "success", message: input.t("stage.banner_verified"), ...resultAction };
  }
  return { tone: "success", message: input.t("stage.banner_extended"), ...resultAction };
}

export function deriveInputBlocked(input: {
  isDemoRoute: boolean;
  currentProjectId: number | null;
  currentSessionId: number | null;
  hasConnectedProvider: boolean;
  // S-046 (P1-01): a provider can be connected while the supervised runtime is
  // still unavailable (not Pi-capable, missing credentials, no project root,
  // transient). Gate the composer on that too, using the concrete runtime state.
  runtimeUnavailable?: boolean;
  runtimeReason?: string;
  runtimeActionLabel?: string;
  runtimeOnAction?: Action;
  onEmptyStateAction: Action;
  onOpenSettings: Action;
  t: Translate;
}): { reason: string; actionLabel?: string; onAction?: Action } | null {
  if (!input.isDemoRoute && input.currentProjectId === null) {
    return {
      reason: input.t("stage.gate_no_session"),
      actionLabel: input.t("sidebar.new_project"),
      onAction: input.onEmptyStateAction,
    };
  }
  if (!input.isDemoRoute && !input.hasConnectedProvider) {
    return {
      reason: input.t("stage.gate_no_provider"),
      actionLabel: input.t("stage.action_open_settings"),
      onAction: input.onOpenSettings,
    };
  }
  if (!input.isDemoRoute && input.runtimeUnavailable) {
    return {
      reason: input.runtimeReason ?? input.t("runtime.capability.unavailable_message"),
      actionLabel: input.runtimeActionLabel,
      onAction: input.runtimeOnAction,
    };
  }
  if (!input.isDemoRoute && input.currentSessionId === null) {
    return {
      reason: input.t("stage.gate_no_session"),
      actionLabel: input.t("sidebar.new_session"),
      onAction: input.onEmptyStateAction,
    };
  }
  return null;
}

export function deriveComposerHint(input: {
  currentCard: Pick<CardTileData, "state" | "summary"> | null;
  onWriteInstruction: Action;
  t: Translate;
}): { message: string; actionLabel?: string; onAction?: Action } | null {
  if (input.currentCard?.state === "instructed") {
    const hasInstruction = (input.currentCard.summary ?? "").trim().length > 0;
    if (!hasInstruction) {
      return {
        message: input.t("stage.hint_no_instruction"),
        actionLabel: input.t("stage.action_write_instruction"),
        onAction: input.onWriteInstruction,
      };
    }
  }
  return null;
}

export function deriveEmptyState(input: {
  currentProjectId: number | null;
  currentSessionId: number | null;
  onEmptyStateAction: Action;
  t: Translate;
}): { title: string; description: string; actionLabel?: string; onAction?: Action } | undefined {
  if (input.currentProjectId === null) {
    return {
      title: input.t("chat.empty_no_project_title"),
      description: input.t("chat.empty_no_project_description"),
      actionLabel: input.t("sidebar.new_project"),
      onAction: input.onEmptyStateAction,
    };
  }
  if (input.currentSessionId === null) {
    return {
      title: input.t("chat.empty_no_session_title"),
      description: input.t("chat.empty_no_session_description"),
      actionLabel: input.t("sidebar.new_session"),
      onAction: input.onEmptyStateAction,
    };
  }
  return undefined;
}

export function deriveGetStartedModel(input: {
  isDemoRoute: boolean;
  projectSessionLoaded: boolean;
  currentProjectId: number | null;
  hasConnectedProvider: boolean;
  currentSessionId: number | null;
  currentProjectName: string | null;
  providerDoneHint: string | null;
  prdStatus?: WorkspacePrdReadiness | null;
  hasPlan?: boolean;
  hasApprovedPlan?: boolean;
  onProjectAction: Action;
  onProviderAction: Action;
  onPrdAction?: Action;
  onPlanAction?: Action;
  onSessionAction: Action;
  t: Translate;
}): GetStartedModel | null {
  if (input.isDemoRoute || !input.projectSessionLoaded) return null;
  const hasProject = input.currentProjectId !== null;
  const hasProvider = input.hasConnectedProvider;
  const hasSession = input.currentSessionId !== null;
  const prdStatus = input.prdStatus ?? "minimal";
  const hasMinimalPrd = prdStatus === "minimal";
  const hasPlan = input.hasPlan ?? hasSession;
  const hasApprovedPlan = input.hasApprovedPlan ?? hasSession;
  if (hasProject && hasProvider && hasMinimalPrd && hasApprovedPlan) return null;

  const firstIncomplete: GetStartedStepKey = !hasProject
    ? "project"
    : !hasProvider
      ? "provider"
      : !hasMinimalPrd
        ? "prd"
        : !hasPlan
          ? "plan"
          : "plan";
  const statusOf = (key: GetStartedStepKey, done: boolean): GetStartedStepStatus =>
    done ? "done" : key === firstIncomplete ? "current" : "pending";
  const planDone = hasPlan && hasApprovedPlan && hasSession;

  return {
    steps: [
      {
        key: "project",
        status: statusOf("project", hasProject),
        title: input.t("get_started.project_title"),
        description: input.t("get_started.project_desc"),
        doneHint: input.currentProjectName ?? undefined,
        actionLabel: input.t("get_started.project_action"),
        onAction: input.onProjectAction,
      },
      {
        key: "provider",
        status: statusOf("provider", hasProvider),
        title: input.t("get_started.provider_title"),
        description: input.t("get_started.provider_desc"),
        doneHint: input.providerDoneHint ?? undefined,
        actionLabel: input.t("get_started.provider_action"),
        onAction: input.onProviderAction,
      },
      {
        key: "prd",
        status: statusOf("prd", hasMinimalPrd),
        title: input.t("get_started.prd_title"),
        description: input.t("get_started.prd_desc"),
        doneHint: hasMinimalPrd ? input.t("get_started.prd_done_hint") : undefined,
        actionLabel: input.t(
          prdStatus === "draft" ? "get_started.prd_resume_action" : "get_started.prd_action",
        ),
        onAction: input.onPrdAction ?? input.onSessionAction,
      },
      {
        key: "plan",
        status: statusOf("plan", planDone),
        title: input.t("get_started.plan_title"),
        description: input.t("get_started.plan_desc"),
        actionLabel: input.t("get_started.plan_action"),
        onAction: input.onPlanAction ?? input.onSessionAction,
      },
    ],
  };
}

export function findLatestInterviewQuestion(messages: ChatMessage[], fallback: string): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.kind === "assistant" && message.content.trim().length > 0) {
      return message.content.trim();
    }
  }
  return fallback;
}

export function shouldShowInterviewPanel(input: {
  isDemoRoute: boolean;
  currentProjectId: number | null;
  generatedPlanDraftPresent: boolean;
  planStatus: WorkspacePlanStatus | null;
}): boolean {
  const planStatus = input.planStatus;
  return (
    !input.isDemoRoute &&
    input.currentProjectId !== null &&
    !input.generatedPlanDraftPresent &&
    planStatus !== null &&
    !planStatus.has_approved_plan &&
    (planStatus.status === "needs_interview" ||
      planStatus.status === "interview_draft" ||
      planStatus.status === "interview_submitted" ||
      planStatus.status === "draft" ||
      planStatus.status === "submitted")
  );
}
