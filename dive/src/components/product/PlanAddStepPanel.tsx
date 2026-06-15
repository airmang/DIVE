import { FileText, Link2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  AcceptanceCriterion,
  AppendPlanStepInput,
  ProjectSpec,
  ProjectSpecDelta,
  ScopeExpansionAssessment,
  StepDraftInput,
} from "../../features/planning";
import {
  ProvocationCardHost,
  type ProvocationContext,
  type SupervisorSourceUiMode,
} from "../../features/provocation";
import { scopeExpansionAssessmentRule } from "../../features/provocation/rules";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

interface PlanAddStepPanelProps {
  projectId: number;
  planId: number;
  projectName: string;
  projectSpec?: ProjectSpec | null;
  busy?: boolean;
  onAppendStep: (input: AppendPlanStepInput) => Promise<unknown>;
  onAppended?: () => void | Promise<void>;
}

function compactUnique(values: string[]): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function lines(value: string): string[] {
  return compactUnique(value.split(/[\n,]/));
}

function normalizedScopeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function overlaps(left: string, right: string): boolean {
  const normalizedLeft = normalizedScopeText(left);
  const normalizedRight = normalizedScopeText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function scopeChangeCovered(projectSpec: ProjectSpec | null | undefined, scopeChange: string) {
  if (!projectSpec) return true;
  return (
    projectSpec.scope.some((item) => overlaps(scopeChange, item)) ||
    projectSpec.acceptanceCriteria.some(
      (criterion) => criterion.status === "active" && overlaps(scopeChange, criterion.text),
    )
  );
}

function fileMatchesNonGoal(projectSpec: ProjectSpec | null | undefined, expectedFile: string) {
  if (!projectSpec) return false;
  return projectSpec.nonGoals.some((item) => overlaps(expectedFile, item));
}

function assessScopeExpansion(input: {
  projectSpec?: ProjectSpec | null;
  linkedCriterionIds: string[];
  expectedFiles: string[];
  prdDelta: ProjectSpecDelta | null;
}): ScopeExpansionAssessment {
  const reasonCodes: string[] = [];
  const evidenceRefs: string[] = [];
  if (input.linkedCriterionIds.length === 0) {
    reasonCodes.push("missing_criterion_link");
    evidenceRefs.push("step.linkedCriterionIds");
  }
  input.prdDelta?.scopeChanges.forEach((scopeChange, index) => {
    if (!scopeChangeCovered(input.projectSpec, scopeChange)) {
      reasonCodes.push("new_scope_area");
      evidenceRefs.push(`prdDelta.scopeChanges[${index}]`);
    }
  });
  input.expectedFiles.forEach((expectedFile, index) => {
    if (fileMatchesNonGoal(input.projectSpec, expectedFile)) {
      reasonCodes.push("target_outside_scope");
      evidenceRefs.push(`step.expectedFiles[${index}]`);
    }
  });
  return {
    expanded: reasonCodes.length > 0,
    reasonCodes: compactUnique(reasonCodes),
    evidenceRefs: compactUnique(evidenceRefs),
  };
}

function buildPrdDelta(
  projectSpec: ProjectSpec | null | undefined,
  title: string,
): ProjectSpecDelta | null {
  if (!projectSpec || !title.trim()) return null;
  return {
    fromVersion: projectSpec.currentVersion,
    toVersion: projectSpec.currentVersion + 1,
    addedCriteria: [],
    retiredCriterionIds: [],
    scopeChanges: [title.trim()],
    nonGoalChanges: [],
  };
}

export function PlanAddStepPanel({
  projectId,
  planId,
  projectName,
  projectSpec = null,
  busy = false,
  onAppendStep,
  onAppended,
}: PlanAddStepPanelProps) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [expectedFilesText, setExpectedFilesText] = useState("");
  const [verificationCheck, setVerificationCheck] = useState("");
  const [selectedCriterionIds, setSelectedCriterionIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const activeCriteria = useMemo(
    () =>
      projectSpec?.acceptanceCriteria.filter((criterion) => criterion.status === "active") ?? [],
    [projectSpec],
  );
  const expectedFiles = useMemo(() => lines(expectedFilesText), [expectedFilesText]);
  const prdDelta = useMemo(() => buildPrdDelta(projectSpec, title), [projectSpec, title]);
  const hasDraftSignal =
    title.trim().length > 0 || reason.trim().length > 0 || expectedFiles.length > 0;
  const scopeExpansion = useMemo(
    () =>
      assessScopeExpansion({
        projectSpec,
        linkedCriterionIds: selectedCriterionIds,
        expectedFiles,
        prdDelta,
      }),
    [expectedFiles, prdDelta, projectSpec, selectedCriterionIds],
  );
  const provocationMode: SupervisorSourceUiMode = "work";
  const provocationContext: ProvocationContext = {
    mode: provocationMode,
    stage: "instruct",
    projectId,
    taskId: `plan-${planId}-add-step`,
    goalText: projectSpec?.goal ?? projectName,
  };
  const scopeCard = hasDraftSignal
    ? scopeExpansionAssessmentRule(provocationContext, scopeExpansion)
    : null;

  const valid = title.trim().length > 0 && reason.trim().length > 0;

  const toggleCriterion = (criterionId: string) => {
    setSelectedCriterionIds((current) =>
      current.includes(criterionId)
        ? current.filter((item) => item !== criterionId)
        : [...current, criterionId],
    );
  };

  const handleSubmit = async () => {
    if (!valid || saving || busy) return;
    const linkedCriteria: AcceptanceCriterion[] = activeCriteria.filter((criterion) =>
      selectedCriterionIds.includes(criterion.criterionId),
    );
    const draft: StepDraftInput = {
      stepId: "manual-add-step",
      title: title.trim(),
      summary: reason.trim(),
      instructionSeed: reason.trim(),
      expectedFiles,
      acceptanceCriteria: linkedCriteria,
      linkedCriterionIds: selectedCriterionIds,
      rationale: reason.trim(),
      verificationCommand: null,
      verificationType: verificationCheck.trim() ? "manual" : null,
      dependencies: [],
      parallelGroup: null,
      position: 0,
    };
    setSaving(true);
    try {
      await onAppendStep({
        planId,
        draft,
        mutationReason: reason.trim(),
        linkedCriterionIds: selectedCriterionIds,
        prdDelta,
      });
      setTitle("");
      setReason("");
      setExpectedFilesText("");
      setVerificationCheck("");
      setSelectedCriterionIds([]);
      await onAppended?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-3 border-t border-dashed pt-3" data-testid="plan-add-step-panel">
      <div className="flex items-center gap-2 text-xs font-semibold text-fg">
        <Plus className="h-3.5 w-3.5 text-accent" aria-hidden />
        {t("prd.add_step.title")}
      </div>
      <div className="mt-2 grid gap-2">
        <input
          className="h-8 rounded-md border bg-bg px-2 text-xs text-fg outline-none focus:border-accent"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("prd.add_step.title")}
          data-testid="plan-add-step-title"
        />
        <textarea
          className="min-h-[56px] resize-none rounded-md border bg-bg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t("prd.add_step.reason")}
          data-testid="plan-add-step-reason"
        />
        <textarea
          className="min-h-[44px] resize-none rounded-md border bg-bg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
          value={expectedFilesText}
          onChange={(event) => setExpectedFilesText(event.target.value)}
          placeholder="src/path.ts"
          data-testid="plan-add-step-expected-files"
        />
        <input
          className="h-8 rounded-md border bg-bg px-2 text-xs text-fg outline-none focus:border-accent"
          value={verificationCheck}
          onChange={(event) => setVerificationCheck(event.target.value)}
          placeholder="Manual check"
          data-testid="plan-add-step-verification-check"
        />
      </div>

      {activeCriteria.length > 0 ? (
        <div className="mt-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-fg-muted">
            <Link2 className="h-3 w-3" aria-hidden />
            {t("prd.add_step.criterion_link")}
          </div>
          <div className="flex flex-wrap gap-1">
            {activeCriteria.map((criterion) => {
              const selected = selectedCriterionIds.includes(criterion.criterionId);
              return (
                <button
                  key={criterion.criterionId}
                  type="button"
                  className={cn(
                    "rounded-sm border px-2 py-1 text-[11px]",
                    selected
                      ? "border-accent bg-accent-subtle text-accent"
                      : "border-border bg-bg-panel2 text-fg-muted hover:text-fg",
                  )}
                  onClick={() => toggleCriterion(criterion.criterionId)}
                  data-testid={`plan-add-step-criterion-${criterion.criterionId}`}
                  aria-pressed={selected}
                >
                  {criterion.criterionId}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div
        className="mt-2 rounded-md border bg-bg-panel2 p-2 text-[11px] text-fg-muted"
        data-testid="plan-add-step-prd-delta"
      >
        <div className="flex items-center gap-1 font-medium text-fg">
          <FileText className="h-3 w-3" aria-hidden />
          {t("prd.add_step.prd_delta")}
        </div>
        <div className="mt-1">
          {prdDelta
            ? `v${prdDelta.fromVersion} -> v${prdDelta.toVersion}: ${prdDelta.scopeChanges.join(", ")}`
            : t("prd.add_step.prd_delta")}
        </div>
      </div>

      {scopeCard ? (
        <div className="mt-2" data-testid="plan-add-step-scope-card">
          <ProvocationCardHost
            cards={[scopeCard]}
            context={provocationContext}
            mode={provocationMode}
          />
        </div>
      ) : null}

      <Button
        type="button"
        size="sm"
        className="mt-3 w-full"
        disabled={!valid || saving || busy}
        onClick={() => void handleSubmit()}
        data-testid="plan-add-step-save"
      >
        <Plus />
        {saving || busy ? t("roadmap.dashboard.working") : t("prd.add_step.save")}
      </Button>
    </section>
  );
}

export default PlanAddStepPanel;
