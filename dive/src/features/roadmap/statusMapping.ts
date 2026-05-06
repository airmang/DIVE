import type { CardState } from "../../components/workmap/types";
import type { RoadmapStepStatus } from "./types";

export function cardStateToRoadmapStatus(state: CardState): RoadmapStepStatus {
  switch (state) {
    case "decomposed":
      return "planned";
    case "instructed":
      return "in_progress";
    case "verifying":
    case "rejected":
      return "review";
    case "verified":
      return "done";
    case "extended":
      return "shipped";
  }
}

export function roadmapStatusI18nKey(status: RoadmapStepStatus): string {
  return `roadmap.status_v2.${status}`;
}

export const ROADMAP_STATUS_ORDER: readonly RoadmapStepStatus[] = [
  "planned",
  "in_progress",
  "review",
  "done",
  "shipped",
] as const;
