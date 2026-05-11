import { useCallback, useEffect, useState } from "react";
import { PLAN_ROADMAP_REFRESH_EVENT } from "./usePlanRoadmap";

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

export interface PlanActivityLogRow {
  id: number;
  plan_id: number;
  event_type: string;
  message: string;
  step_id: number | null;
  stable_step_id: string | null;
  step_title: string | null;
  reason: string | null;
  created_at: number;
}

export function usePlanActivity(planId: number | null, limit = 5) {
  const [api, setApi] = useState<TauriApi | null>(null);
  const [activities, setActivities] = useState<PlanActivityLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadTauri().then(setApi);
  }, []);

  const refresh = useCallback(async () => {
    if (planId === null || !api) {
      setActivities([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const rows = await api.invoke<PlanActivityLogRow[]>("workspace_plan_activity", {
        planId,
        limit,
      });
      setActivities(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, limit, planId]);

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

  return {
    activities,
    loading,
    error,
    refresh,
  };
}
