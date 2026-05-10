import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspacePlanStatus } from "../planning";

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

export interface PlanStepRow {
  id: number;
  plan_id: number;
  step_id: string;
  title: string;
  summary: string | null;
  instruction_seed: string | null;
  expected_files: unknown | null;
  acceptance_criteria: unknown | null;
  verification_kind: string | null;
  verification_command: string | null;
  verification_manual_check: string | null;
  dependencies: unknown | null;
  parallel_group: string | null;
  position: number;
  created_at: number;
  updated_at: number;
}

export interface StepSessionMappingRow {
  id: number;
  step_id: number;
  session_id: number | null;
  card_id: number | null;
  state_path: string | null;
  status: string;
  started_at: number | null;
  completed_at: number | null;
  checkpoint_ids: unknown | null;
  verification_status: string | null;
  verification_evidence: string | null;
  user_decision: string | null;
  created_at: number;
  updated_at: number;
}

export type PlanRoadmapStatus = "blocked" | "ready" | "in_progress" | "done" | "shipped";

export interface PlanRoadmapStep {
  step: PlanStepRow;
  mapping: StepSessionMappingRow | null;
  status: PlanRoadmapStatus;
  blockedDependencies: string[];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mappingDone(mapping: StepSessionMappingRow | undefined): boolean {
  return mapping?.status === "done" || mapping?.status === "shipped";
}

export function derivePlanRoadmapSteps(
  steps: PlanStepRow[],
  mappings: StepSessionMappingRow[],
): PlanRoadmapStep[] {
  const mappingByStepId = new Map(mappings.map((mapping) => [mapping.step_id, mapping]));
  const doneStableIds = new Set(
    steps
      .filter((step) => mappingDone(mappingByStepId.get(step.id)))
      .map((step) => step.step_id),
  );

  return steps.map((step) => {
    const mapping = mappingByStepId.get(step.id) ?? null;
    if (mapping) {
      const status =
        mapping.status === "done" || mapping.status === "shipped" ? mapping.status : "in_progress";
      return { step, mapping, status, blockedDependencies: [] };
    }

    const blockedDependencies = stringArray(step.dependencies).filter(
      (dependency) => !doneStableIds.has(dependency),
    );
    return {
      step,
      mapping,
      status: blockedDependencies.length === 0 ? "ready" : "blocked",
      blockedDependencies,
    };
  });
}

export function usePlanRoadmap(projectId: number | null) {
  const [api, setApi] = useState<TauriApi | null>(null);
  const [status, setStatus] = useState<WorkspacePlanStatus | null>(null);
  const [steps, setSteps] = useState<PlanStepRow[]>([]);
  const [mappings, setMappings] = useState<StepSessionMappingRow[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadTauri().then(setApi);
  }, []);

  const refresh = useCallback(async () => {
    if (projectId === null || !api) {
      setStatus(null);
      setSteps([]);
      setMappings([]);
      setError(null);
      return;
    }
    setLoadingStatus(true);
    try {
      const nextStatus = await api.invoke<WorkspacePlanStatus>("workspace_plan_status", {
        projectId,
      });
      setStatus(nextStatus);
      const planId = nextStatus.has_approved_plan ? nextStatus.plan_id : null;
      if (planId === null) {
        setSteps([]);
        setMappings([]);
        setError(null);
        return;
      }
      setLoadingDetails(true);
      const [nextSteps, nextMappings] = await Promise.all([
        api.invoke<PlanStepRow[]>("workspace_plan_list_steps", { planId }),
        api.invoke<StepSessionMappingRow[]>("workspace_plan_step_mappings", { planId }),
      ]);
      setSteps(nextSteps);
      setMappings(nextMappings);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingStatus(false);
      setLoadingDetails(false);
    }
  }, [api, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openStep = useCallback(
    async (stepId: number) => {
      if (!api) throw new Error("Tauri IPC unavailable");
      const mapping = await api.invoke<StepSessionMappingRow>("roadmap_step_open", { stepId });
      await refresh();
      return mapping;
    },
    [api, refresh],
  );

  const roadmapSteps = useMemo(() => derivePlanRoadmapSteps(steps, mappings), [steps, mappings]);

  return {
    status,
    steps: roadmapSteps,
    loading: loadingStatus || loadingDetails,
    error,
    hasPlan: Boolean(status?.has_approved_plan),
    openStep,
    refresh,
  };
}
