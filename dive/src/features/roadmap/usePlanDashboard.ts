import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectSpec } from "../planning";
import type { PlanActivityLogRow } from "./usePlanActivity";
import type { StepSessionMappingRow } from "./usePlanRoadmap";

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

export interface PlanDashboardStep {
  step_db_id: number;
  stable_step_id: string;
  title: string;
  position: number;
  status: string;
  session_id: number | null;
  card_id: number | null;
}

export interface PlanDashboardProject {
  project_id: number;
  project_name: string;
  project_path: string;
  project_updated_at: number;
  plan_id: number | null;
  plan_goal: string | null;
  plan_status: string | null;
  step_count: number;
  ready_count: number;
  blocked_count: number;
  active_count: number;
  done_count: number;
  shipped_count: number;
  next_ready_steps: PlanDashboardStep[];
  active_steps: PlanDashboardStep[];
  last_activity: PlanActivityLogRow | null;
  project_spec?: ProjectSpec | null;
}

export interface PlanDashboardTotals {
  projects: number;
  plannedProjects: number;
  ready: number;
  active: number;
  blocked: number;
}

export function usePlanDashboard() {
  const [api, setApi] = useState<TauriApi | null>(null);
  const [projects, setProjects] = useState<PlanDashboardProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadTauri().then(setApi);
  }, []);

  const refresh = useCallback(async () => {
    if (!api) {
      setProjects([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const rows = await api.invoke<PlanDashboardProject[]>("workspace_plan_dashboard");
      setProjects(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openStep = useCallback(
    async (stepId: number) => {
      if (!api) throw new Error("Tauri IPC unavailable");
      return api.invoke<StepSessionMappingRow>("roadmap_step_open", { stepId });
    },
    [api],
  );

  const totals = useMemo<PlanDashboardTotals>(
    () =>
      projects.reduce(
        (acc, project) => ({
          projects: acc.projects + 1,
          plannedProjects: acc.plannedProjects + (project.plan_id === null ? 0 : 1),
          ready: acc.ready + project.ready_count,
          active: acc.active + project.active_count,
          blocked: acc.blocked + project.blocked_count,
        }),
        { projects: 0, plannedProjects: 0, ready: 0, active: 0, blocked: 0 },
      ),
    [projects],
  );

  return {
    projects,
    totals,
    loading,
    error,
    refresh,
    openStep,
  };
}
