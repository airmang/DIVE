import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeStepCriteria, type WorkspacePlanStatus } from "../planning";
import { deriveAgencyStateView } from "./agencyStatus";
import type { AgencyStateView } from "./types";
import { loadTauri, type TauriApi } from "../../lib/tauri";

export const PLAN_ROADMAP_REFRESH_EVENT = "dive:plan-roadmap-refresh";

export interface PlanStepRow {
  id: number;
  plan_id: number;
  step_id: string;
  title: string;
  summary: string | null;
  instruction_seed: string | null;
  expected_files: unknown | null;
  acceptance_criteria: unknown | null;
  step_kind?: string | null;
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

export interface PlanStepStateUpdate {
  stepId: number;
  status: "in_progress" | "done" | "shipped";
  evidence?: string;
  verificationStatus?: string;
}

export interface PlanRoadmapStep {
  step: PlanStepRow;
  mapping: StepSessionMappingRow | null;
  status: PlanRoadmapStatus;
  agency?: AgencyStateView;
  linkedCriteria?: { criterionId: string; text: string }[];
  decompositionRationale?: string | null;
  blockedDependencies: string[];
  parallelBucket: string | null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
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
    steps.filter((step) => mappingDone(mappingByStepId.get(step.id))).map((step) => step.step_id),
  );

  const derived = steps.map((step) => {
    const mapping = mappingByStepId.get(step.id) ?? null;
    const criteriaMetadata = normalizeStepCriteria(step.acceptance_criteria);
    const acceptanceCriteriaText = criteriaMetadata.linkedCriteria.map(
      (criterion) => criterion.text,
    );
    if (mapping) {
      const status: PlanRoadmapStatus =
        mapping.status === "done" || mapping.status === "shipped" || mapping.status === "blocked"
          ? mapping.status
          : "in_progress";
      return {
        step,
        mapping,
        status,
        agency: deriveAgencyStateView({
          goalText: [step.title, step.summary].filter(Boolean).join("\n"),
          acceptanceCriteria: acceptanceCriteriaText,
          status,
          verificationState: mapping.verification_status,
          checkpointAvailable: stringArray(mapping.checkpoint_ids).length > 0,
        }),
        linkedCriteria: criteriaMetadata.linkedCriteria,
        decompositionRationale: criteriaMetadata.rationale,
        blockedDependencies: [],
        parallelBucket: null,
      };
    }

    const blockedDependencies = stringArray(step.dependencies).filter(
      (dependency) => !doneStableIds.has(dependency),
    );
    const status: PlanRoadmapStatus = blockedDependencies.length === 0 ? "ready" : "blocked";
    return {
      step,
      mapping,
      status,
      agency: deriveAgencyStateView({
        goalText: [step.title, step.summary].filter(Boolean).join("\n"),
        acceptanceCriteria: acceptanceCriteriaText,
        planDraftPending: status === "ready" || status === "blocked",
        status,
      }),
      linkedCriteria: criteriaMetadata.linkedCriteria,
      decompositionRationale: criteriaMetadata.rationale,
      blockedDependencies,
      parallelBucket: null,
    };
  });

  const autoReadyCount = derived.filter(
    (item) => !item.step.parallel_group && item.status === "ready",
  ).length;

  return derived.map((item) => {
    if (item.step.parallel_group) {
      return { ...item, parallelBucket: `explicit:${item.step.parallel_group}` };
    }
    if (item.status === "ready" && autoReadyCount >= 2) {
      return { ...item, parallelBucket: "auto" };
    }
    return item;
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
  // Bumped on every refresh() call so a stale response from a superseded
  // project (rapid A -> B switch) can't stomp the current project's state.
  const generation = useRef(0);

  useEffect(() => {
    void loadTauri().then(setApi);
  }, []);

  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
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
      if (generation.current !== requestGeneration) return;
      setStatus(nextStatus);
      const planId = nextStatus.has_plan ? nextStatus.plan_id : null;
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
      if (generation.current !== requestGeneration) return;
      setSteps(nextSteps);
      setMappings(nextMappings);
      setError(null);
    } catch (err) {
      if (generation.current !== requestGeneration) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generation.current === requestGeneration) {
        setLoadingStatus(false);
        setLoadingDetails(false);
      }
    }
  }, [api, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      void refresh();
    };
    window.addEventListener(PLAN_ROADMAP_REFRESH_EVENT, handler);
    return () => window.removeEventListener(PLAN_ROADMAP_REFRESH_EVENT, handler);
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

  const updateStepState = useCallback(
    async (input: PlanStepStateUpdate) => {
      if (!api) throw new Error("Tauri IPC unavailable");
      const mapping = await api.invoke<StepSessionMappingRow>("roadmap_step_update_state", {
        input,
      });
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
    hasPlan: Boolean(status?.has_plan),
    openStep,
    updateStepState,
    refresh,
  };
}
