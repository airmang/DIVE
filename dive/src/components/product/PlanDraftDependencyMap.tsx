import type { PlanStepRow } from "../../features/roadmap";
import { useT } from "../../i18n";

interface Point {
  step: PlanStepRow;
  x: number;
  y: number;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function pointsFor(steps: PlanStepRow[]) {
  const byId = new Map(steps.map((step) => [step.step_id, step]));
  const levels = new Map<string, number>();
  const levelFor = (step: PlanStepRow): number => {
    const cached = levels.get(step.step_id);
    if (cached !== undefined) return cached;
    const deps = stringArray(step.dependencies)
      .map((id) => byId.get(id))
      .filter((dep): dep is PlanStepRow => Boolean(dep));
    const level = deps.length === 0 ? 0 : Math.max(...deps.map(levelFor)) + 1;
    levels.set(step.step_id, level);
    return level;
  };
  const groups = new Map<number, PlanStepRow[]>();
  for (const step of steps) {
    const level = levelFor(step);
    const group = groups.get(level) ?? [];
    group.push(step);
    groups.set(level, group);
  }
  const points = new Map<string, Point>();
  for (const [level, group] of groups) {
    group
      .sort((a, b) => a.position - b.position)
      .forEach((step, index) => {
        points.set(step.step_id, {
          step,
          x: 44 + level * 108,
          y: 44 + index * 62,
        });
      });
  }
  const width = Math.max(330, 88 + (Math.max(...levels.values(), 0) + 1) * 108);
  const height = Math.max(
    150,
    88 + Math.max(...Array.from(groups.values(), (value) => value.length), 1) * 62,
  );
  return { points, width, height };
}

export function PlanDraftDependencyMap({ steps }: { steps: PlanStepRow[] }) {
  const t = useT();
  const { points, width, height } = pointsFor(steps);
  const list = Array.from(points.values()).sort((a, b) => a.step.position - b.step.position);

  return (
    <div
      className="plan-blueprint-grid overflow-auto border bg-bg p-3"
      data-testid="plan-draft-dependency-map"
      aria-label={t("planning.approval.step_dag")}
    >
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img">
        {list.flatMap((point) =>
          stringArray(point.step.dependencies).flatMap((dep) => {
            const source = points.get(dep);
            if (!source) return [];
            const mid = source.x + (point.x - source.x) / 2;
            return (
              <path
                key={`${dep}:${point.step.step_id}`}
                d={`M${source.x + 13},${source.y} C${mid},${source.y} ${mid},${point.y} ${point.x - 13},${point.y}`}
                className="fill-none stroke-border"
                strokeWidth="1.5"
              />
            );
          }),
        )}
        {list.map((point) => (
          <g key={point.step.id}>
            <circle
              cx={point.x}
              cy={point.y}
              r="13"
              className={
                point.step.parallel_group
                  ? "fill-accent-subtle stroke-accent"
                  : "fill-bg-panel stroke-border"
              }
              strokeWidth="2"
              strokeDasharray={point.step.parallel_group ? "3 3" : undefined}
            />
            <text
              x={point.x}
              y={point.y + 30}
              textAnchor="middle"
              className="fill-fg font-mono text-[9.5px] font-bold"
            >
              {point.step.step_id}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
