import { Check, CheckCheck, Circle, Lock, Play, Radio, type LucideIcon } from "lucide-react";
import type { PlanRoadmapStatus } from "../../features/roadmap";
import type { PlanLineToken } from "./types";

export interface PlanStatusMeta {
  labelKey: string;
  icon: LucideIcon;
  nodeClass: string;
  tagClass: string;
  lineToken: PlanLineToken;
}

export const PLAN_STATUS_META: Record<PlanRoadmapStatus, PlanStatusMeta> = {
  blocked: {
    labelKey: "roadmap.plan_graph.status.blocked",
    icon: Lock,
    nodeClass: "border-border text-fg-subtle",
    tagClass: "border-border text-fg",
    lineToken: "future",
  },
  ready: {
    labelKey: "roadmap.plan_graph.status.ready",
    icon: Play,
    nodeClass: "border-accent text-accent",
    tagClass: "border-accent/45 bg-accent-subtle text-fg",
    lineToken: "future",
  },
  in_progress: {
    labelKey: "roadmap.plan_graph.status.in_progress",
    icon: Radio,
    nodeClass: "border-accent text-accent plan-node-pulse",
    tagClass: "border-warn/45 bg-warn/10 text-fg",
    lineToken: "active",
  },
  done: {
    labelKey: "roadmap.plan_graph.status.done",
    icon: Check,
    nodeClass: "border-success bg-success text-accent-fg",
    tagClass: "border-success/40 bg-success/10 text-fg",
    lineToken: "done",
  },
  shipped: {
    labelKey: "roadmap.plan_graph.status.shipped",
    icon: CheckCheck,
    nodeClass: "border-success bg-success text-accent-fg",
    tagClass: "border-success/50 bg-success/15 text-fg",
    lineToken: "done",
  },
};

export function planStatusMeta(status: PlanRoadmapStatus): PlanStatusMeta {
  return (
    PLAN_STATUS_META[status] ?? {
      labelKey: "roadmap.plan_graph.status.ready",
      icon: Circle,
      nodeClass: "border-border text-fg-muted",
      tagClass: "border-border text-fg",
      lineToken: "future",
    }
  );
}

export function isPlanStepComplete(status: PlanRoadmapStatus): boolean {
  return status === "done" || status === "shipped";
}
