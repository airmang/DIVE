import { useMemo } from "react";
import { useT } from "../../i18n";
import type { PlanRoadmapStep } from "../../features/roadmap";
import { isPlanStepComplete } from "./plan-status-meta";

interface PlanMiniMapProps {
  steps: PlanRoadmapStep[];
  currentStepId: number | null;
  onSelectStep: (stepId: number) => void;
}

interface Point {
  x: number;
  y: number;
  level: number;
  item: PlanRoadmapStep;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function buildPoints(steps: PlanRoadmapStep[]) {
  const byStableId = new Map(steps.map((item) => [item.step.step_id, item]));
  const levelById = new Map<string, number>();
  const visiting = new Set<string>();
  const levelFor = (item: PlanRoadmapStep): number => {
    const cached = levelById.get(item.step.step_id);
    if (cached !== undefined) return cached;
    // Guard against cyclic/self dependencies so malformed data can't infinite-recurse.
    if (visiting.has(item.step.step_id)) return 0;
    visiting.add(item.step.step_id);
    const deps = stringArray(item.step.dependencies)
      .map((id) => byStableId.get(id))
      .filter((dep): dep is PlanRoadmapStep => Boolean(dep));
    const level = deps.length === 0 ? 0 : Math.max(...deps.map(levelFor)) + 1;
    visiting.delete(item.step.step_id);
    levelById.set(item.step.step_id, level);
    return level;
  };
  const levels = new Map<number, PlanRoadmapStep[]>();
  for (const item of steps) {
    const level = levelFor(item);
    const group = levels.get(level) ?? [];
    group.push(item);
    levels.set(level, group);
  }
  const points = new Map<number, Point>();
  for (const [level, group] of levels) {
    group
      .sort((a, b) => a.step.position - b.step.position)
      .forEach((item, index) => {
        points.set(item.step.id, {
          item,
          level,
          x: 44 + level * 104,
          y: 44 + index * 64,
        });
      });
  }
  const width = Math.max(330, 88 + (Math.max(...levelById.values(), 0) + 1) * 104);
  const height = Math.max(
    150,
    88 + Math.max(...Array.from(levels.values(), (v) => v.length), 1) * 64,
  );
  return { points, width, height };
}

function nodeClass(item: PlanRoadmapStep, current: boolean) {
  if (isPlanStepComplete(item.status)) return "fill-success stroke-success";
  if (item.status === "in_progress" || current) return "fill-bg-panel stroke-accent";
  if (item.status === "ready") return "fill-accent-subtle stroke-accent";
  return "fill-bg-panel stroke-border";
}

export function PlanMiniMap({ steps, currentStepId, onSelectStep }: PlanMiniMapProps) {
  const t = useT();
  const { points, width, height } = useMemo(() => buildPoints(steps), [steps]);
  const pointList = Array.from(points.values()).sort(
    (a, b) => a.item.step.position - b.item.step.position,
  );

  return (
    <section
      id="plan-minimap"
      className="plan-blueprint-grid shrink-0 overflow-auto border-b px-3 py-3"
      data-testid="plan-minimap"
      aria-label={t("plan_view.minimap_aria")}
    >
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="group">
        {pointList.flatMap((point) =>
          stringArray(point.item.step.dependencies).flatMap((dep) => {
            const source = pointList.find((candidate) => candidate.item.step.step_id === dep);
            if (!source) return [];
            const mid = source.x + (point.x - source.x) / 2;
            return (
              <path
                key={`${dep}:${point.item.step.step_id}`}
                d={`M${source.x + 14},${source.y} C${mid},${source.y} ${mid},${point.y} ${point.x - 14},${point.y}`}
                className="fill-none stroke-border"
                strokeWidth="1.5"
                strokeDasharray={point.item.status === "blocked" ? "3 4" : undefined}
              />
            );
          }),
        )}
        {pointList.map((point) => {
          const current = point.item.step.id === currentStepId;
          const label = t("plan_view.minimap_node_aria", {
            step: point.item.step.step_id,
            status: t(`roadmap.plan_graph.status.${point.item.status}`),
          });
          return (
            <g
              key={point.item.step.id}
              role="button"
              tabIndex={0}
              aria-label={label}
              className="plan-minimap-node cursor-pointer outline-none"
              data-testid="plan-minimap-node"
              data-plan-step-id={point.item.step.step_id}
              onClick={() => onSelectStep(point.item.step.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelectStep(point.item.step.id);
              }}
            >
              <circle
                cx={point.x}
                cy={point.y}
                r="13"
                className={nodeClass(point.item, current)}
                strokeWidth={current ? 3 : 2}
                strokeDasharray={point.item.status === "blocked" ? "3 3" : undefined}
              />
              {point.item.status === "ready" ? (
                <circle cx={point.x} cy={point.y} r="4" className="fill-accent" />
              ) : null}
              <text
                x={point.x}
                y={point.y + 30}
                textAnchor="middle"
                className="fill-fg font-mono text-[9.5px] font-bold"
              >
                {point.item.step.step_id}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
