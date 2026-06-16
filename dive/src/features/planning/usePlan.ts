import { useCallback, useEffect, useState } from "react";
import type {
  AppendPlanStepInput,
  ChallengeStepRationaleInput,
  ChallengeStepRationaleResult,
  InterviewRow,
  LiveProjectSpecDraft,
  PlanDraftInput,
  PlanGenerationResult,
  PlanAdjustmentReviewRequestDetail,
  PlanRow,
  PrdPatch,
  PrdPatchValidationOutcome,
  ProjectSpec,
  ProjectSpecDraft,
  RationaleChallengeOfferActionInput,
  RationaleChallengeOfferActionResult,
  RationaleChallengeOfferKind,
} from "./types";
import type { PlanStepRow } from "../roadmap";

export const PLAN_DRAFT_REVIEW_REQUEST_EVENT = "dive:plan-draft-review-request";
export const PLAN_ADJUSTMENT_REVIEW_REQUEST_EVENT = "dive:plan-adjustment-review-request";

export function requestPlanDraftReview(projectId: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PLAN_DRAFT_REVIEW_REQUEST_EVENT, {
      detail: { projectId },
    }),
  );
}

export function requestPlanAdjustmentReview(detail: PlanAdjustmentReviewRequestDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PLAN_ADJUSTMENT_REVIEW_REQUEST_EVENT, { detail }));
}

type TauriApi = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
};

async function loadTauri(): Promise<TauriApi | null> {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  if (!w?.__TAURI_INTERNALS__) return null;
  const core = await import("@tauri-apps/api/core");
  return { invoke: core.invoke as TauriApi["invoke"] };
}

export interface WorkspacePlanStatus {
  status: string;
  has_plan: boolean;
  has_approved_plan: boolean;
  plan_summary: string | null;
  plan_id: number | null;
  step_count: number;
  ready_count: number;
  blocked_count: number;
  active_count: number;
  done_count: number;
  prd_status?: WorkspacePrdStatusWire | null;
}

export type WorkspacePrdReadiness = "missing" | "draft" | "minimal";

interface WorkspacePrdStatusWire {
  status: WorkspacePrdReadiness;
  project_spec_id?: string | null;
  projectSpecId?: string | null;
  current_version?: number | null;
  currentVersion?: number | null;
  draft_id?: string | null;
  draftId?: string | null;
  base_version?: number | null;
  baseVersion?: number | null;
}

export interface WorkspacePrdStatus {
  status: WorkspacePrdReadiness;
  projectSpecId: string | null;
  currentVersion: number | null;
  draftId: string | null;
  baseVersion: number | null;
}

export interface SubmitPrdInterviewTurnInput {
  draftId: string;
  answer: string;
  provider: string;
  model: string;
}

export interface PrdInterviewTurnResult {
  turnId: string;
  assistantMessage: string;
  patch: PrdPatch | null;
  validationOutcome: PrdPatchValidationOutcome;
  appliedFieldPaths: string[];
  rejectedReasons: string[];
  liveDraft: LiveProjectSpecDraft;
}

function normalizeGeneratedDraft(value: unknown): PlanGenerationResult {
  if (Array.isArray(value) && value.length === 2) {
    return {
      plan: value[0] as PlanRow,
      steps: value[1] as PlanStepRow[],
    };
  }
  const object = value as { plan?: PlanRow; steps?: PlanStepRow[] };
  return {
    plan: object.plan as PlanRow,
    steps: object.steps ?? [],
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringField(
  value: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): string | null {
  const raw = value[camelKey] ?? value[snakeKey];
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

function isRationaleOfferKind(value: string | null): value is RationaleChallengeOfferKind {
  return value === "redecompose_step" || value === "adjust_plan";
}

function normalizeChallengeStepRationaleResult(value: unknown): ChallengeStepRationaleResult {
  const record = objectRecord(value);
  const objectionId = stringField(record, "objectionId", "objection_id") ?? "";
  const suggestionStatus =
    stringField(record, "suggestionStatus", "suggestion_status") === "offered"
      ? "offered"
      : "none";
  const offerKind = stringField(record, "offerKind", "offer_kind");

  return {
    objectionId,
    suggestionStatus,
    offerId: stringField(record, "offerId", "offer_id") ?? "",
    offerKind:
      suggestionStatus === "offered" && isRationaleOfferKind(offerKind)
        ? offerKind
        : "redecompose_step",
    message: stringField(record, "message", "message") ?? "",
    suggestedSeed: stringField(record, "suggestedSeed", "suggested_seed"),
  };
}

function normalizeRationaleChallengeOfferActionResult(
  value: unknown,
  fallback: RationaleChallengeOfferActionInput & {
    suggestionStatus: RationaleChallengeOfferActionResult["suggestionStatus"];
  },
): RationaleChallengeOfferActionResult {
  const record = objectRecord(value);
  const status = stringField(record, "suggestionStatus", "suggestion_status");
  return {
    objectionId: stringField(record, "objectionId", "objection_id") ?? fallback.objectionId,
    offerId: stringField(record, "offerId", "offer_id") ?? fallback.offerId,
    suggestionStatus:
      status === "accepted" || status === "dismissed" ? status : fallback.suggestionStatus,
  };
}

function normalizePrdStatus(value: WorkspacePrdStatusWire | null | undefined): WorkspacePrdStatus {
  if (!value) {
    return {
      status: "missing",
      projectSpecId: null,
      currentVersion: null,
      draftId: null,
      baseVersion: null,
    };
  }
  return {
    status: value.status,
    projectSpecId: value.projectSpecId ?? value.project_spec_id ?? null,
    currentVersion: value.currentVersion ?? value.current_version ?? null,
    draftId: value.draftId ?? value.draft_id ?? null,
    baseVersion: value.baseVersion ?? value.base_version ?? null,
  };
}

export function usePlan(projectId: number | null) {
  const [api, setApi] = useState<TauriApi | null>(null);
  const [status, setStatus] = useState<WorkspacePlanStatus | null>(null);
  const [prdStatus, setPrdStatus] = useState<WorkspacePrdStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadTauri().then(setApi);
  }, []);

  const refresh = useCallback(async () => {
    if (projectId === null) {
      setStatus(null);
      setPrdStatus(null);
      setError(null);
      return;
    }
    if (!api) {
      setStatus(null);
      setPrdStatus(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const [next, nextPrd] = await Promise.all([
        api.invoke<WorkspacePlanStatus>("workspace_plan_status", { projectId }),
        api.invoke<WorkspacePrdStatusWire>("workspace_prd_status", { projectId }),
      ]);
      setStatus(next);
      setPrdStatus(normalizePrdStatus(nextPrd ?? next.prd_status));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshPrdStatus = useCallback(async () => {
    if (!api || projectId === null) {
      setPrdStatus(null);
      return null;
    }
    const next = normalizePrdStatus(
      await api.invoke<WorkspacePrdStatusWire>("workspace_prd_status", { projectId }),
    );
    setPrdStatus(next);
    return next;
  }, [api, projectId]);

  const startInterview = useCallback(
    async (goal: string) => {
      if (!api || projectId === null) throw new Error("Tauri IPC unavailable");
      const row = await api.invoke<InterviewRow>("workspace_plan_start_interview", {
        projectId,
        goal,
      });
      await refresh();
      return row;
    },
    [api, projectId, refresh],
  );

  const saveInterviewAnswer = useCallback(
    async (interviewId: number, question: string, answer: string) => {
      if (!api) throw new Error("Tauri IPC unavailable");
      return api.invoke<InterviewRow>("workspace_plan_save_interview_answer", {
        interviewId,
        question,
        answer,
      });
    },
    [api],
  );

  const submitInterview = useCallback(
    async (interviewId: number, intentSummary: string, unresolvedQuestions: string[]) => {
      if (!api) throw new Error("Tauri IPC unavailable");
      const row = await api.invoke<InterviewRow>("workspace_plan_submit_interview", {
        interviewId,
        intentSummary,
        unresolvedQuestions,
      });
      await refresh();
      return row;
    },
    [api, refresh],
  );

  const generateDraft = useCallback(
    async (interviewId: number, planInput: PlanDraftInput, replaceApproved = false) => {
      if (!api) throw new Error("Tauri IPC unavailable");
      const raw = await api.invoke<unknown>("workspace_plan_generate_draft", {
        interviewId,
        planInput,
        replaceApproved,
      });
      await refresh();
      return normalizeGeneratedDraft(raw);
    },
    [api, refresh],
  );

  const currentDraft = useCallback(async () => {
    if (!api || projectId === null) return null;
    const raw = await api.invoke<unknown | null>("workspace_plan_current_draft", { projectId });
    return raw === null ? null : normalizeGeneratedDraft(raw);
  }, [api, projectId]);

  const getProjectSpec = useCallback(async () => {
    if (!api || projectId === null) return null;
    return api.invoke<ProjectSpec | null>("workspace_prd_get", { projectId });
  }, [api, projectId]);

  const getProjectSpecDraft = useCallback(
    async (draftId?: string | null) => {
      if (!api || projectId === null) return null;
      return api.invoke<LiveProjectSpecDraft>("workspace_prd_draft_get", {
        projectId,
        draftId: draftId ?? null,
      });
    },
    [api, projectId],
  );

  const saveProjectSpecDraft = useCallback(
    async (draft: LiveProjectSpecDraft) => {
      if (!api || projectId === null) throw new Error("Tauri IPC unavailable");
      const saved = await api.invoke<LiveProjectSpecDraft>("workspace_prd_draft_save", {
        input: {
          projectId,
          draft,
        },
      });
      await refreshPrdStatus();
      return saved;
    },
    [api, projectId, refreshPrdStatus],
  );

  const submitPrdInterviewTurn = useCallback(
    async (input: SubmitPrdInterviewTurnInput) => {
      if (!api || projectId === null) throw new Error("Tauri IPC unavailable");
      const result = await api.invoke<PrdInterviewTurnResult>("workspace_prd_interview_turn", {
        projectId,
        draftId: input.draftId,
        answer: input.answer,
        provider: input.provider,
        model: input.model,
      });
      await refreshPrdStatus();
      return result;
    },
    [api, projectId, refreshPrdStatus],
  );

  const saveProjectSpec = useCallback(
    async (
      spec: ProjectSpec | ProjectSpecDraft,
      reason: "interview" | "student_edit" | "plan_mutation",
    ) => {
      if (!api || projectId === null) throw new Error("Tauri IPC unavailable");
      const saved = await api.invoke<ProjectSpec>("workspace_prd_save", {
        projectId,
        spec,
        reason,
      });
      await refresh();
      await refreshPrdStatus();
      return saved;
    },
    [api, projectId, refresh, refreshPrdStatus],
  );

  const challengeStepRationale = useCallback(
    async (input: ChallengeStepRationaleInput) => {
      if (!api) throw new Error("Tauri IPC unavailable");
      const result = await api.invoke<unknown>(
        "workspace_plan_challenge_step_rationale",
        {
          input,
        },
      );
      await refresh();
      return normalizeChallengeStepRationaleResult(result);
    },
    [api, refresh],
  );

  const acceptRationaleChallengeOffer = useCallback(
    async (input: RationaleChallengeOfferActionInput) => {
      if (!api) throw new Error("Tauri IPC unavailable");
      const result = await api.invoke<unknown>(
        "workspace_plan_respond_to_plan_adjustment_offer",
        {
          input: {
            ...input,
            response: "accepted",
          },
        },
      );
      await refresh();
      return normalizeRationaleChallengeOfferActionResult(result, {
        ...input,
        suggestionStatus: "accepted",
      });
    },
    [api, refresh],
  );

  const dismissRationaleChallengeOffer = useCallback(
    async (input: RationaleChallengeOfferActionInput) => {
      if (!api) throw new Error("Tauri IPC unavailable");
      const result = await api.invoke<unknown>(
        "workspace_plan_respond_to_plan_adjustment_offer",
        {
          input: {
            ...input,
            response: "dismissed",
          },
        },
      );
      await refresh();
      return normalizeRationaleChallengeOfferActionResult(result, {
        ...input,
        suggestionStatus: "dismissed",
      });
    },
    [api, refresh],
  );

  const appendStep = useCallback(
    async (input: AppendPlanStepInput) => {
      if (!api) throw new Error("Tauri IPC unavailable");
      const linkedCriterionIds = input.linkedCriterionIds ?? input.draft.linkedCriterionIds;
      const row = await api.invoke<PlanStepRow>("workspace_plan_append_step", {
        planId: input.planId,
        draft: {
          ...input.draft,
          linkedCriterionIds,
        },
        mutationReason: input.mutationReason ?? null,
        linkedCriterionIds,
        prdDelta: input.prdDelta ?? null,
      });
      await refresh();
      await refreshPrdStatus();
      return row;
    },
    [api, refresh, refreshPrdStatus],
  );

  const approvePlan = useCallback(
    async (planId: number) => {
      if (!api) throw new Error("Tauri IPC unavailable");
      const plan = await api.invoke<PlanRow>("workspace_plan_approve", { planId });
      await refresh();
      return plan;
    },
    [api, refresh],
  );

  const discardPlan = useCallback(
    async (planId: number) => {
      if (!api) throw new Error("Tauri IPC unavailable");
      await api.invoke<void>("workspace_plan_discard_plan", { planId });
      await refresh();
    },
    [api, refresh],
  );

  return {
    status,
    prdStatus,
    loading,
    error,
    refresh,
    refreshPrdStatus,
    startInterview,
    saveInterviewAnswer,
    submitInterview,
    generateDraft,
    currentDraft,
    getProjectSpec,
    getProjectSpecDraft,
    saveProjectSpecDraft,
    submitPrdInterviewTurn,
    saveProjectSpec,
    challengeStepRationale,
    acceptRationaleChallengeOffer,
    dismissRationaleChallengeOffer,
    appendStep,
    approvePlan,
    discardPlan,
  };
}
