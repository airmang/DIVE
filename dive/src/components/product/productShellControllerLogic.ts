import { matchSidecarModelNotFoundError } from "../../lib/error-classify";
import type { ProviderSummary } from "../../stores/project-session";
import {
  createLiveProjectSpecDraft,
  type ArchitectureForm,
  type InterviewAnswer,
  type LiveProjectSpecDraft,
  type ProjectSpec,
} from "../../features/planning";
import { fallbackModels } from "../settings/providerModels";

export type PrdMode = "authoring" | "read" | null;

type Translate = (key: string, values?: Record<string, string | number>) => string;

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
    "acceptance_criteria entries must be full observable criterion sentences (copy the PRD criterion text or write a new concrete sentence); never put bare criterion IDs like AC-001 in acceptance_criteria — IDs belong only in linked_criterion_ids.",
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

export const PLAN_DRAFT_PENDING_TIMEOUT_MS = 30_000;

export function shouldRenderPlanDraftPending(input: {
  planDraftPending: boolean;
  hasGeneratedPlanDraft: boolean;
  hasPlanDraftFailure: boolean;
}): boolean {
  return input.planDraftPending && !input.hasGeneratedPlanDraft && !input.hasPlanDraftFailure;
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

export function stringArray(value: unknown): string[] {
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

export function downloadSessionExport(
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

export function prdTurnFailureDescription(
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

export function prdRuntimeSelection(
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
    // S-053 D3: same reasoning for provenance — reopening a confirmed PRD for
    // editing via this client-only rebuild must not reset the intent-check
    // card to the legacy-empty-map "AI summarized this" fallback.
    fieldProvenance: projectSpec.fieldProvenance,
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
