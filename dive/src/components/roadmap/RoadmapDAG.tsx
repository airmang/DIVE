import { useCallback, useMemo, useState } from "react";
import { Play } from "lucide-react";
import { translate, useLocale, useT, type Locale } from "../../i18n";
import type { PlanRoadmapStep, StepSessionMappingRow } from "../../features/roadmap";
import { Button } from "../ui/button";
import { MermaidDiagram } from "../product/MermaidDiagram";
import { useToast } from "../toast/toast-context";

interface RoadmapDAGProps {
  steps: PlanRoadmapStep[];
  loading: boolean;
  error: string | null;
  onOpenStep: (stepId: number, opts?: { focus?: boolean }) => Promise<StepSessionMappingRow>;
  onOpenSession: (sessionId: number) => void;
}

interface ExplicitBucketGroup {
  bucket: string;
  name: string;
  steps: PlanRoadmapStep[];
  readySteps: PlanRoadmapStep[];
}

const STATUS_DOT_CLASS = {
  blocked: "bg-fg-muted",
  ready: "bg-accent",
  in_progress: "bg-warn",
  done: "bg-success",
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function mermaidId(stepId: string): string {
  return stepId.replace(/[^A-Za-z0-9_]/g, "_");
}

function mermaidStepId(item: PlanRoadmapStep): string {
  return `roadmap_step_${item.step.id}`;
}

function mermaidBucketId(name: string): string {
  return `bucket_${mermaidId(name)}`;
}

function escapeMermaid(label: string): string {
  return label
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\[/g, "［")
    .replace(/\]/g, "］")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .replace(/\{/g, "｛")
    .replace(/\}/g, "｝");
}

function statusClassName(
  status: PlanRoadmapStep["status"],
): "blocked" | "ready" | "in_progress" | "done" {
  return status === "shipped" ? "done" : status;
}

function explicitBucketName(bucket: string): string {
  return bucket.replace(/^explicit:/, "");
}

function nodeLine(item: PlanRoadmapStep): string {
  const label = `${item.step.step_id}: ${item.step.title}`;
  return `    ${mermaidStepId(item)}["${escapeMermaid(label)}"]`;
}

function buildRoadmapChart(steps: PlanRoadmapStep[], locale: Locale): string {
  const lines = ["flowchart TD"];
  const explicitBuckets = new Map<string, PlanRoadmapStep[]>();
  const unbucketed: PlanRoadmapStep[] = [];
  const stepIdToNodeId = new Map(steps.map((item) => [item.step.step_id, mermaidStepId(item)]));

  for (const item of steps) {
    const bucket = item.parallelBucket;
    if (bucket?.startsWith("explicit:")) {
      const bucketSteps = explicitBuckets.get(bucket) ?? [];
      bucketSteps.push(item);
      explicitBuckets.set(bucket, bucketSteps);
    } else {
      unbucketed.push(item);
    }
  }

  for (const [bucket, bucketSteps] of explicitBuckets) {
    const name = explicitBucketName(bucket);
    lines.push(
      `  subgraph ${mermaidBucketId(name)}["${escapeMermaid(
        translate(locale, "roadmap.plan_graph.parallel_explicit", { name }),
      )}"]`,
    );
    for (const item of bucketSteps) lines.push(nodeLine(item));
    lines.push("  end");
  }

  for (const item of unbucketed) lines.push(nodeLine(item));

  for (const item of steps) {
    for (const dependency of stringArray(item.step.dependencies)) {
      const dependencyNodeId = stepIdToNodeId.get(dependency);
      if (dependencyNodeId) {
        lines.push(`  ${dependencyNodeId} --> ${mermaidStepId(item)}`);
      }
    }
  }

  for (const item of steps) {
    lines.push(`  class ${mermaidStepId(item)} ${statusClassName(item.status)}`);
    if (item.parallelBucket === "auto") {
      lines.push(`  class ${mermaidStepId(item)} autoParallel`);
    }
  }

  lines.push("  classDef blocked fill:#2f3742,stroke:#768397,color:#e5e7eb");
  lines.push("  classDef ready fill:#0f355d,stroke:#5aa8ff,color:#eef6ff");
  lines.push("  classDef in_progress fill:#473816,stroke:#e0b870,color:#fff7e6");
  lines.push("  classDef done fill:#123b2a,stroke:#57c785,color:#ecfff5");
  lines.push("  classDef autoParallel stroke-dasharray:4 4,stroke-width:2px");
  return lines.join("\n");
}

function buildExplicitBucketGroups(steps: PlanRoadmapStep[]): ExplicitBucketGroup[] {
  const buckets = new Map<string, PlanRoadmapStep[]>();
  for (const item of steps) {
    const bucket = item.parallelBucket;
    if (!bucket?.startsWith("explicit:")) continue;
    const bucketSteps = buckets.get(bucket) ?? [];
    bucketSteps.push(item);
    buckets.set(bucket, bucketSteps);
  }

  return Array.from(buckets, ([bucket, bucketSteps]) => ({
    bucket,
    name: explicitBucketName(bucket),
    steps: bucketSteps,
    readySteps: bucketSteps.filter((item) => item.status === "ready"),
  }));
}

export function RoadmapDAG({ steps, loading, error, onOpenStep, onOpenSession }: RoadmapDAGProps) {
  const t = useT();
  const locale = useLocale();
  const { toast } = useToast();
  const [openingBuckets, setOpeningBuckets] = useState<Set<string>>(() => new Set());
  const chart = useMemo(() => buildRoadmapChart(steps, locale), [locale, steps]);
  const explicitGroups = useMemo(() => buildExplicitBucketGroups(steps), [steps]);
  const stepByStepId = useMemo(
    () => new Map(steps.map((item) => [item.step.step_id, item])),
    [steps],
  );
  const stepIdByNodeId = useMemo(
    () => new Map(steps.map((item) => [mermaidStepId(item), item.step.step_id])),
    [steps],
  );
  const resolveNodeStepId = useCallback(
    (rawId: string): string | null => {
      let candidate = rawId.replace(/^flowchart-/, "");
      while (candidate.length > 0) {
        const stepId = stepIdByNodeId.get(candidate);
        if (stepId) return stepId;
        const next = candidate.replace(/-\d+$/, "");
        if (next === candidate) return null;
        candidate = next;
      }
      return null;
    },
    [stepIdByNodeId],
  );
  const handleNodeClick = useCallback(
    (stepId: string) => {
      const item = stepByStepId.get(stepId);
      if (!item) return;
      if (item.status === "ready") {
        void onOpenStep(item.step.id);
        return;
      }
      if (item.status === "in_progress" && item.mapping?.session_id) {
        onOpenSession(item.mapping.session_id);
      }
    },
    [onOpenSession, onOpenStep, stepByStepId],
  );

  if (loading || error || steps.length === 0) {
    return null;
  }

  const handleStartGroup = async (group: ExplicitBucketGroup) => {
    if (group.readySteps.length === 0) return;
    setOpeningBuckets((current) => new Set(current).add(group.bucket));
    try {
      const results = await Promise.allSettled(
        group.readySteps.map((item) => onOpenStep(item.step.id, { focus: false })),
      );
      const ok = results.filter((result) => result.status === "fulfilled").length;
      toast({
        variant: ok === results.length ? "success" : "warn",
        title: t("roadmap.plan_graph.batch_open_partial", {
          ok,
          total: results.length,
        }),
      });
    } finally {
      setOpeningBuckets((current) => {
        const next = new Set(current);
        next.delete(group.bucket);
        return next;
      });
    }
  };

  return (
    <section
      className="max-h-56 overflow-auto border-b bg-bg-panel px-3 py-3"
      data-testid="plan-roadmap-dag"
    >
      <MermaidDiagram
        chart={chart}
        onNodeClick={handleNodeClick}
        nodeIdResolver={resolveNodeStepId}
      />
      {explicitGroups.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {explicitGroups.map((group) => (
            <Button
              key={group.bucket}
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2 text-[11px]"
              disabled={group.readySteps.length === 0 || openingBuckets.has(group.bucket)}
              data-testid="plan-roadmap-start-group"
              data-parallel-bucket={group.name}
              onClick={() => void handleStartGroup(group)}
            >
              <Play className="h-3 w-3" aria-hidden />
              <span>{t("roadmap.plan_graph.start_group")}</span>
              <span className="text-fg-muted">
                {group.readySteps.length}/{group.steps.length}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted">
        <span className="font-semibold text-fg">{t("roadmap.plan_graph.dag_legend.title")}</span>
        {(["blocked", "ready", "in_progress", "done"] as const).map((status) => (
          <span key={status} className="inline-flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT_CLASS[status]}`} aria-hidden />
            {t(`roadmap.plan_graph.status.${status}`)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="h-0 w-5 border-t border-dashed border-fg-muted" aria-hidden />
          {t("roadmap.plan_graph.dag_legend.auto_dashed")}
        </span>
      </div>
    </section>
  );
}
