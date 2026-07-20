import { useCallback, useEffect, useState } from "react";
import { PLAN_ROADMAP_REFRESH_EVENT } from "./usePlanRoadmap";
import { loadTauri, type TauriApi } from "../../lib/tauri";

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
