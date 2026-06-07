import { useMemo, useState } from "react";
import { PlanView, type PlanViewRoadmapModel } from "../components/plan";
import type {
  PlanRoadmapStep,
  PlanRoadmapStatus,
  PlanStepRow,
  StepSessionMappingRow,
} from "../features/roadmap";

function now() {
  return Date.now();
}

function step(
  id: number,
  stableId: string,
  title: string,
  status: PlanRoadmapStatus,
  deps: string[] = [],
  parallelGroup: string | null = null,
): PlanRoadmapStep {
  const row: PlanStepRow = {
    id,
    plan_id: 1,
    step_id: stableId,
    title,
    summary: `${title} summary`,
    instruction_seed: null,
    expected_files: null,
    acceptance_criteria: null,
    verification_kind: null,
    verification_command: null,
    verification_manual_check: null,
    dependencies: deps,
    parallel_group: parallelGroup,
    position: id,
    created_at: now(),
    updated_at: now(),
  };
  return {
    step: row,
    mapping: status === "ready" || status === "blocked" ? null : mappingFor(row, status),
    status,
    blockedDependencies: status === "blocked" ? deps : [],
    parallelBucket: parallelGroup ? `explicit:${parallelGroup}` : null,
  };
}

function mappingFor(row: PlanStepRow, status: string): StepSessionMappingRow {
  return {
    id: row.id,
    step_id: row.id,
    session_id: 1000 + row.id,
    card_id: null,
    state_path: null,
    status,
    started_at: now(),
    completed_at: status === "done" || status === "shipped" ? now() : null,
    checkpoint_ids: null,
    verification_status: null,
    verification_evidence: null,
    user_decision: null,
    created_at: now(),
    updated_at: now(),
  };
}

function seedSteps() {
  return [
    step(1, "S-001", "Project scaffold", "done"),
    step(2, "S-002", "Data model", "done", ["S-001"]),
    step(3, "S-003", "Editor surface", "in_progress", ["S-002"]),
    step(4, "S-004", "Search filters", "ready", ["S-002"]),
    step(5, "S-005", "Unit tests", "ready", ["S-003"], "quality"),
    step(6, "S-006", "User guide", "ready", ["S-003"], "quality"),
    step(7, "S-007", "Package release", "blocked", ["S-005", "S-006"]),
  ];
}

export default function PlanSurfaceDemoPage() {
  const [steps, setSteps] = useState<PlanRoadmapStep[]>(() => seedSteps());
  const model: PlanViewRoadmapModel = useMemo(
    () => ({
      status: {
        status: "approved",
        has_plan: true,
        has_approved_plan: true,
        plan_summary: "Build a local notes app with editing, search, tests, and release packaging.",
        plan_id: 1,
        step_count: steps.length,
        ready_count: steps.filter((item) => item.status === "ready").length,
        blocked_count: steps.filter((item) => item.status === "blocked").length,
        active_count: steps.filter((item) => item.status === "in_progress").length,
        done_count: steps.filter((item) => item.status === "done" || item.status === "shipped")
          .length,
      },
      steps,
      loading: false,
      error: null,
      hasPlan: true,
      refresh: async () => {},
    }),
    [steps],
  );

  return (
    <div className="flex h-screen justify-end bg-bg text-fg" data-testid="plan-surface-demo">
      <div className="h-full w-full max-w-[420px] border-l">
        <PlanView
          roadmap={model}
          projectName="Notes App"
          actions={{
            onOpenStep: async (stepId) => {
              const target = steps.find((item) => item.step.id === stepId);
              if (!target) throw new Error("Missing step");
              const mapping = mappingFor(target.step, "in_progress");
              setSteps((current) =>
                current.map((item) =>
                  item.step.id === stepId
                    ? { ...item, mapping, status: "in_progress", blockedDependencies: [] }
                    : item,
                ),
              );
              return mapping;
            },
            onOpenSession: () => {},
            onCreatePlan: () => {},
          }}
        />
      </div>
    </div>
  );
}
