import { useMemo } from "react";
import type { PlanRoadmapStep } from "../../features/roadmap";
import { isPlanStepComplete } from "./plan-status-meta";
import { PlanParallelGroup } from "./PlanParallelGroup";
import { PlanStep } from "./PlanStep";
import type { PlanActionHandlers, PlanLineToken, PlanTimelineEntry } from "./types";

interface PlanTimelineProps {
  steps: PlanRoadmapStep[];
  currentStepId: number | null;
  busyStepId: number | null;
  actions?: PlanActionHandlers;
  onStartGroup: (steps: PlanRoadmapStep[], bucket: string) => void;
  onActionStart: (stepId: number) => void;
  onActionEnd: () => void;
  onActionError: (item: PlanRoadmapStep, error: unknown) => void;
  setStepRef: (id: number, node: HTMLDivElement | null) => void;
}

function entriesFor(steps: PlanRoadmapStep[]): PlanTimelineEntry[] {
  const sorted = [...steps].sort((a, b) => a.step.position - b.step.position);
  const entries: PlanTimelineEntry[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const item = sorted[index];
    const bucket = item.parallelBucket;
    if (!bucket) {
      entries.push({ key: String(item.step.id), type: "step", steps: [item] });
      continue;
    }
    const group = [item];
    while (sorted[index + 1]?.parallelBucket === bucket) {
      group.push(sorted[index + 1]);
      index += 1;
    }
    entries.push(
      group.length > 1
        ? { key: bucket, type: "parallel", steps: group, bucket }
        : { key: String(item.step.id), type: "step", steps: [item] },
    );
  }
  return entries;
}

function lineTokens(flat: PlanRoadmapStep[], index: number, currentStepId: number | null) {
  const item = flat[index];
  const previous = flat[index - 1];
  const next = flat[index + 1];
  const current = item.step.id === currentStepId;
  const previousComplete = previous ? isPlanStepComplete(previous.status) : false;
  const itemComplete = isPlanStepComplete(item.status);
  const nextCurrent = next?.step.id === currentStepId;
  const up: PlanLineToken =
    index === 0
      ? "none"
      : current || (previousComplete && !itemComplete)
        ? "active"
        : previousComplete && itemComplete
          ? "done"
          : "future";
  const down: PlanLineToken =
    index === flat.length - 1
      ? "none"
      : current || (itemComplete && nextCurrent)
        ? "active"
        : itemComplete
          ? "done"
          : "future";
  return { up, down };
}

export function PlanTimeline(props: PlanTimelineProps) {
  const entries = useMemo(() => entriesFor(props.steps), [props.steps]);
  const flat = useMemo(() => entries.flatMap((entry) => entry.steps), [entries]);

  return (
    <div className="px-0 pb-4 pr-5 pt-1" data-testid="plan-timeline">
      {entries.map((entry) => {
        if (entry.type === "parallel") {
          return (
            <PlanParallelGroup
              key={entry.key}
              steps={entry.steps}
              bucket={entry.bucket ?? entry.key}
              currentStepId={props.currentStepId}
              busyStepId={props.busyStepId}
              actions={props.actions}
              onStartGroup={props.onStartGroup}
              onActionStart={props.onActionStart}
              onActionEnd={props.onActionEnd}
              onActionError={props.onActionError}
              setStepRef={props.setStepRef}
            />
          );
        }
        const item = entry.steps[0];
        const index = flat.findIndex((candidate) => candidate.step.id === item.step.id);
        const { up, down } = lineTokens(flat, index, props.currentStepId);
        return (
          <PlanStep
            key={entry.key}
            ref={(node) => props.setStepRef(item.step.id, node)}
            item={item}
            current={item.step.id === props.currentStepId}
            busy={props.busyStepId === item.step.id}
            lineUp={up}
            lineDown={down}
            actions={props.actions}
            onActionStart={props.onActionStart}
            onActionEnd={props.onActionEnd}
            onActionError={props.onActionError}
          />
        );
      })}
    </div>
  );
}
