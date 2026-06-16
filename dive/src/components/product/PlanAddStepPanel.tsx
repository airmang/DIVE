import { FileText, Link2, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AcceptanceCriterion,
  AppendPlanStepInput,
  PlanAdjustmentReviewRequestDetail,
  ProjectSpec,
  ProjectSpecDelta,
  ScopeExpansionAssessment,
  StepDraftInput,
} from "../../features/planning";
import { PLAN_ADJUSTMENT_REVIEW_REQUEST_EVENT } from "../../features/planning";
import {
  ProvocationCardHost,
  createScopeExpansionSupervisorRequest,
  evaluateProvocationSupervisor,
  type ProvocationAction,
  type ProvocationCard,
  type ProvocationContext,
  type ScopeExpansionSupervisorEvaluationRequest,
  type SupervisorEvidenceRefContract,
  type SupervisorSourceUiMode,
} from "../../features/provocation";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import { useProjectSessionStore } from "../../stores/project-session";
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

type ScopeSupervisorState =
  | { status: "idle" }
  | { status: "pending"; evaluationKey: string }
  | { status: "shown"; evaluationKey: string; evaluationId: string; card: ProvocationCard }
  | { status: "none"; evaluationKey: string; evaluationId?: string; dropReason?: string };

type ScopeActionRoute = "link_criterion" | "split_scope" | "edit_prd" | "dismiss_review";
const SCOPE_SUPERVISOR_DEBOUNCE_MS = 650;

const SCOPE_ACTION_ROUTE_COPY: Record<ScopeActionRoute, string> = {
  link_criterion: "연결할 PRD 기준을 선택하세요. 기준이 없다면 PRD를 먼저 수정하세요.",
  split_scope: "제목과 이유를 더 작은 단계로 나눈 뒤 저장하세요.",
  edit_prd: "PRD 수정은 전용 PRD 영역에서 검토 후 반영하세요.",
  dismiss_review: "검토 카드를 닫았습니다. 저장은 계속 가능합니다.",
};

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

function stableHash(value: unknown): string {
  const json = JSON.stringify(value);
  let hash = 0;
  for (let index = 0; index < json.length; index += 1) {
    hash = (hash * 31 + json.charCodeAt(index)) >>> 0;
  }
  return `local:${hash.toString(16)}`;
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

function criterionEvidenceRefs(criteria: AcceptanceCriterion[]): SupervisorEvidenceRefContract[] {
  return criteria.slice(0, 6).map((criterion) => ({
    id: criterion.criterionId,
    source: "plan",
    kind: "acceptance_criteria",
    label: criterion.criterionId,
    valueSummary: {
      criterionId: criterion.criterionId,
      text: criterion.text,
      status: criterion.status,
    },
    verificationEvidence: false,
  }));
}

function buildScopeEvidenceRefs(input: {
  title: string;
  reason: string;
  selectedCriterionIds: string[];
  expectedFiles: string[];
  prdDelta: ProjectSpecDelta | null;
  activeCriteria: AcceptanceCriterion[];
  scopeExpansion: ScopeExpansionAssessment;
}): SupervisorEvidenceRefContract[] {
  const refs: SupervisorEvidenceRefContract[] = [];
  const push = (ref: SupervisorEvidenceRefContract) => {
    if (!refs.some((existing) => existing.id === ref.id)) refs.push(ref);
  };

  if (input.title.trim()) {
    push({
      id: "step.title",
      source: "plan",
      kind: "add_step_draft",
      label: "추가 단계 제목",
      valueSummary: input.title.trim(),
      verificationEvidence: false,
    });
  }
  if (input.reason.trim()) {
    push({
      id: "step.reason",
      source: "plan",
      kind: "add_step_draft",
      label: "추가 단계 이유",
      valueSummary: input.reason.trim(),
      verificationEvidence: false,
    });
  }
  push({
    id: "step.linkedCriterionIds",
    source: "plan",
    kind: "add_step_draft",
    label: "연결된 PRD 기준",
    valueSummary: { linkedCriterionIds: input.selectedCriterionIds },
    verificationEvidence: false,
  });
  input.expectedFiles.slice(0, 4).forEach((expectedFile, index) => {
    push({
      id: `step.expectedFiles[${index}]`,
      source: "plan",
      kind: "add_step_draft",
      label: "예상 파일",
      valueSummary: expectedFile,
      verificationEvidence: false,
    });
  });
  input.prdDelta?.scopeChanges.slice(0, 4).forEach((scopeChange, index) => {
    push({
      id: `prdDelta.scopeChanges[${index}]`,
      source: "plan",
      kind: "prd_scope",
      label: "PRD 범위 변경",
      valueSummary: scopeChange,
      verificationEvidence: false,
    });
  });
  criterionEvidenceRefs(input.activeCriteria).forEach(push);
  input.scopeExpansion.evidenceRefs.forEach((refId) => {
    if (!refs.some((existing) => existing.id === refId)) {
      push({
        id: refId,
        source: "plan",
        kind: "scope_expansion_assessment",
        label: "범위 확장 근거",
        valueSummary: refId,
        verificationEvidence: false,
      });
    }
  });
  return refs;
}

function withScopeCorrelationMetadata(
  card: ProvocationCard,
  request: ScopeExpansionSupervisorEvaluationRequest,
  evaluationId: string,
): ProvocationCard {
  return {
    ...card,
    metadata: {
      ...card.metadata,
      supervisorEvaluationId: card.metadata?.supervisorEvaluationId ?? evaluationId,
      supervisorEvent: card.metadata?.supervisorEvent ?? "scope_expansion",
      projectId: card.metadata?.projectId ?? request.projectId,
      planId: card.metadata?.planId ?? request.planId,
      artifactRef: card.metadata?.artifactRef ?? request.artifactRef,
      contextHash: card.metadata?.contextHash ?? request.contextHash,
      evidenceHash: card.metadata?.evidenceHash ?? request.evidenceHash,
    },
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
  const [scopeSupervisorState, setScopeSupervisorState] = useState<ScopeSupervisorState>({
    status: "idle",
  });
  const [actionRoute, setActionRoute] = useState<ScopeActionRoute | null>(null);
  const [planAdjustmentSuggestion, setPlanAdjustmentSuggestion] =
    useState<PlanAdjustmentReviewRequestDetail | null>(null);
  const currentProjectId = useProjectSessionStore((s) => s.currentProjectId);
  const currentSessionId = useProjectSessionStore((s) => s.currentSessionId);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const reasonInputRef = useRef<HTMLTextAreaElement>(null);
  const criteriaRef = useRef<HTMLDivElement>(null);

  const activeCriteria = useMemo(
    () =>
      projectSpec?.acceptanceCriteria.filter((criterion) => criterion.status === "active") ?? [],
    [projectSpec],
  );
  const expectedFiles = useMemo(() => lines(expectedFilesText), [expectedFilesText]);
  const prdDelta = useMemo(() => buildPrdDelta(projectSpec, title), [projectSpec, title]);
  const hasReviewableDraft = title.trim().length > 0 && reason.trim().length > 0;
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
  const supervisorSessionId = currentProjectId === projectId ? currentSessionId : null;
  const scopeEvidenceRefs = useMemo(
    () =>
      buildScopeEvidenceRefs({
        title,
        reason,
        selectedCriterionIds,
        expectedFiles,
        prdDelta,
        activeCriteria,
        scopeExpansion,
      }),
    [activeCriteria, expectedFiles, prdDelta, reason, scopeExpansion, selectedCriterionIds, title],
  );
  const scopeSupervisorRequest = useMemo(() => {
    if (!hasReviewableDraft || !scopeExpansion.expanded || typeof supervisorSessionId !== "number") {
      return null;
    }
    const artifactRef = {
      kind: "add_step_draft" as const,
      id: `plan-${planId}-add-step-${stableHash({
        title,
        reason,
        expectedFiles,
        selectedCriterionIds,
        prdDelta,
      })}`,
      label: title.trim() || "manual add step",
    };
    return createScopeExpansionSupervisorRequest({
      sessionId: supervisorSessionId,
      projectId,
      planId,
      artifactRef,
      sourceUiMode: provocationMode,
      locale: "ko-KR",
      contextHash: stableHash({
        projectId,
        planId,
        artifactRef,
        scopeExpansion,
      }),
      evidenceHash: stableHash(scopeEvidenceRefs),
      evidenceRefs: scopeEvidenceRefs,
      scopeExpansion,
      uiState: {
        goalSummary: projectSpec?.goal ?? projectName,
        planSummary: { stepCount: 0, activeStep: null },
        verification: {
          aiClaimedDone: false,
          diffReviewed: false,
          appLaunched: false,
          previewChecked: false,
          automatedTestsPassed: false,
          testResult: null,
          acceptanceCriterionConfirmed: false,
          manualChecks: [],
        },
        feasibility: {
          runnable: false,
          previewable: false,
          hasTests: false,
          diffAvailable: false,
        },
      },
    });
  }, [
    expectedFiles,
    hasReviewableDraft,
    planId,
    prdDelta,
    projectId,
    projectName,
    projectSpec?.goal,
    provocationMode,
    reason,
    scopeEvidenceRefs,
    scopeExpansion,
    selectedCriterionIds,
    supervisorSessionId,
    title,
  ]);
  const provocationContext: ProvocationContext = {
    mode: provocationMode,
    stage: "instruct",
    projectId,
    sessionId: supervisorSessionId,
    taskId: `plan-${planId}-add-step`,
    goalText: projectSpec?.goal ?? projectName,
  };
  const scopeSupervisorCard =
    scopeSupervisorState.status === "shown" ? scopeSupervisorState.card : null;

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<PlanAdjustmentReviewRequestDetail>).detail;
      if (!detail || detail.projectId !== projectId || detail.planId !== planId) return;
      setPlanAdjustmentSuggestion(detail);
      setReason((current) => current || detail.suggestedSeed || detail.message);
      requestAnimationFrame(() => reasonInputRef.current?.focus());
    };
    window.addEventListener(PLAN_ADJUSTMENT_REVIEW_REQUEST_EVENT, handler);
    return () => window.removeEventListener(PLAN_ADJUSTMENT_REVIEW_REQUEST_EVENT, handler);
  }, [planId, projectId]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    setActionRoute(null);
    if (!scopeSupervisorRequest) {
      setScopeSupervisorState({ status: "idle" });
      return;
    }

    const evaluationKey = `${scopeSupervisorRequest.artifactRef.id}:${scopeSupervisorRequest.evidenceHash}`;
    setScopeSupervisorState({ status: "pending", evaluationKey });

    timeoutId = setTimeout(() => {
      void evaluateProvocationSupervisor(scopeSupervisorRequest)
        .then((response) => {
          if (cancelled) return;
          if (response.status === "shown" && response.card.type === "scope_expansion") {
            setScopeSupervisorState({
              status: "shown",
              evaluationKey,
              evaluationId: response.evaluationId,
              card: withScopeCorrelationMetadata(
                response.card,
                scopeSupervisorRequest,
                response.evaluationId,
              ),
            });
            return;
          }
          setScopeSupervisorState({
            status: "none",
            evaluationKey,
            evaluationId: response.evaluationId,
            dropReason: response.status === "shown" ? "disallowed_concern" : response.dropReason,
          });
        })
        .catch((err) => {
          if (import.meta.env.DEV) {
            console.warn("scope supervisor evaluation failed:", err);
          }
          if (!cancelled) {
            setScopeSupervisorState({
              status: "none",
              evaluationKey,
              dropReason: "runtime_unavailable",
            });
          }
        });
    }, SCOPE_SUPERVISOR_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [scopeSupervisorRequest]);

  const valid = title.trim().length > 0 && reason.trim().length > 0;

  const toggleCriterion = (criterionId: string) => {
    setSelectedCriterionIds((current) =>
      current.includes(criterionId)
        ? current.filter((item) => item !== criterionId)
        : [...current, criterionId],
    );
  };

  const handleScopeCardAction = (action: ProvocationAction) => {
    if (action.kind === "link_criterion") {
      setActionRoute("link_criterion");
      criteriaRef.current?.querySelector("button")?.focus();
      return;
    }
    if (action.kind === "edit_prd") {
      setActionRoute("edit_prd");
      titleInputRef.current?.focus();
      return;
    }
    if (action.kind === "split_scope") {
      setActionRoute("split_scope");
      reasonInputRef.current?.focus();
      return;
    }
    if (action.kind === "dismiss_review") {
      setActionRoute("dismiss_review");
      setScopeSupervisorState((current) =>
        current.status === "shown"
          ? {
              status: "none",
              evaluationKey: current.evaluationKey,
              evaluationId: current.evaluationId,
              dropReason: "provoke_false",
            }
          : current,
      );
    }
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
      {planAdjustmentSuggestion ? (
        <div
          className="mt-2 rounded-md border border-info/40 bg-info/5 px-2 py-1.5 text-xs"
          data-testid="plan-adjustment-review-suggestion"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-info">재분해 제안 검토</p>
              <p className="mt-1 text-fg-muted">
                {planAdjustmentSuggestion.suggestedSeed || planAdjustmentSuggestion.message}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPlanAdjustmentSuggestion(null)}
              data-testid="plan-adjustment-review-dismiss"
            >
              닫기
            </Button>
          </div>
        </div>
      ) : null}
      <div className="mt-2 grid gap-2">
        <input
          ref={titleInputRef}
          className="h-8 rounded-md border bg-bg px-2 text-xs text-fg outline-none focus:border-accent"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("prd.add_step.title")}
          data-testid="plan-add-step-title"
        />
        <textarea
          ref={reasonInputRef}
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
          <div className="flex flex-wrap gap-1" ref={criteriaRef}>
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

      {scopeSupervisorCard ? (
        <div
          className="mt-2"
          data-testid="plan-add-step-scope-card"
          data-supervisor-status={scopeSupervisorState.status}
          data-evaluation-id={
            scopeSupervisorState.status === "shown" ? scopeSupervisorState.evaluationId : undefined
          }
        >
          <ProvocationCardHost
            cards={[scopeSupervisorCard]}
            context={provocationContext}
            mode={provocationMode}
            onAction={handleScopeCardAction}
          />
        </div>
      ) : null}

      {actionRoute ? (
        <div
          className="mt-2 rounded-md border border-border bg-bg-panel2 px-2 py-1.5 text-[11px] text-fg-muted"
          data-testid="plan-add-step-action-route"
          data-route={actionRoute}
        >
          {SCOPE_ACTION_ROUTE_COPY[actionRoute]}
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
