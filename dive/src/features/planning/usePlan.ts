import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AppendPlanStepInput,
  ArchitectureProposals,
  InterviewRow,
  LiveProjectSpecDraft,
  PlanCritiqueResolution,
  PlanDraftInput,
  PlanGenerationResult,
  PlanAdjustmentReviewRequestDetail,
  PlanRow,
  PrdPatch,
  PrdInterviewConversationTurn,
  PrdPatchValidationOutcome,
  ProjectSpec,
  ProjectSpecDraft,
  StepDraftInput,
} from "./types";
import type { PlanStepRow } from "../roadmap";
import { loadTauri, type TauriApi } from "../../lib/tauri";

export const PLAN_DRAFT_REVIEW_REQUEST_EVENT = "dive:plan-draft-review-request";
export const PLAN_ADJUSTMENT_REVIEW_REQUEST_EVENT = "dive:plan-adjustment-review-request";
export const PLAN_ADD_STEP_DRAFT_REQUEST_EVENT = "dive:plan-add-step-draft-request";

export interface PlanAddStepDraftRequestDetail {
  projectId: number;
  planId: number;
  draft: StepDraftInput;
  reason?: string | null;
  source: "chat_route" | "plan_request";
}

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

export function requestPlanAddStepDraft(detail: PlanAddStepDraftRequestDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PLAN_ADD_STEP_DRAFT_REQUEST_EVENT, { detail }));
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
  conversation?: PrdInterviewConversationTurn[];
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
  // S-047: AI architecture recommendations for the current two-stage focus, or
  // absent when the turn is not on an architecture focus. Rust omits the key
  // entirely when there is nothing to propose, so this is optional.
  architectureProposals?: ArchitectureProposals | null;
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
  // Bumped on every refresh() call so a stale response from a superseded
  // project (rapid A -> B switch) can't stomp the current project's state.
  const generation = useRef(0);

  useEffect(() => {
    void loadTauri().then(setApi);
  }, []);

  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
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
      if (generation.current !== requestGeneration) return;
      setStatus(next);
      setPrdStatus(normalizePrdStatus(nextPrd ?? next.prd_status));
      setError(null);
    } catch (err) {
      if (generation.current !== requestGeneration) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generation.current === requestGeneration) setLoading(false);
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
        conversation: input.conversation ?? [],
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
    async (planId: number, critiqueResolution?: PlanCritiqueResolution) => {
      if (!api) throw new Error("Tauri IPC unavailable");
      const plan = await api.invoke<PlanRow>("workspace_plan_approve", {
        planId,
        critiqueResolution,
      });
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
    appendStep,
    approvePlan,
    discardPlan,
  };
}
