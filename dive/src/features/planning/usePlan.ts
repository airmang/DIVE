import { useCallback, useEffect, useState } from "react";
import type { InterviewRow, PlanDraftInput, PlanGenerationResult, PlanRow } from "./types";
import type { PlanStepRow } from "../roadmap";

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

export function usePlan(projectId: number | null) {
  const [api, setApi] = useState<TauriApi | null>(null);
  const [status, setStatus] = useState<WorkspacePlanStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadTauri().then(setApi);
  }, []);

  const refresh = useCallback(async () => {
    if (projectId === null) {
      setStatus(null);
      setError(null);
      return;
    }
    if (!api) {
      setStatus(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const next = await api.invoke<WorkspacePlanStatus>("workspace_plan_status", { projectId });
      setStatus(next);
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
    async (interviewId: number, planInput: PlanDraftInput) => {
      if (!api) throw new Error("Tauri IPC unavailable");
      const raw = await api.invoke<unknown>("workspace_plan_generate_draft", {
        interviewId,
        planInput,
      });
      await refresh();
      return normalizeGeneratedDraft(raw);
    },
    [api, refresh],
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
    loading,
    error,
    refresh,
    startInterview,
    saveInterviewAnswer,
    submitInterview,
    generateDraft,
    approvePlan,
    discardPlan,
  };
}
