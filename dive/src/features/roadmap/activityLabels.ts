import type { PlanActivityLogRow } from "./usePlanActivity";

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export function activityEventLabel(
  t: TranslateFn,
  activity: Pick<PlanActivityLogRow, "event_type" | "message">,
) {
  const key = `roadmap.activity.events.${activity.event_type}`;
  const translated = t(key);
  return translated === key ? activity.message : translated;
}
