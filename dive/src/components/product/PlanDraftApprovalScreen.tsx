import { AlertTriangle, Check, ChevronDown, ChevronUp, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import type {
  InterviewRow,
  PlanCritiqueResolution,
  PlanGenerationResult,
} from "../../features/planning";
import { criterionTexts, normalizeStepCriteria } from "../../features/planning";
import { useTutorialEnabled } from "../../stores/ui-preferences";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { PlanDraftDependencyMap } from "./PlanDraftDependencyMap";
import {
  ProvocationCardHost,
  createPlanDraftSupervisorRequest,
  evaluateProvocationSupervisor,
  normalizePlanStep,
  type ProvocationCard,
  type ScaffoldMode,
  useProvocationActionResolver,
} from "../../features/provocation";

interface PlanDraftApprovalScreenProps {
  draft: PlanGenerationResult;
  interview: InterviewRow | null;
  busy?: boolean;
  provocation?: {
    enabled: boolean;
    mode: ScaffoldMode;
    projectId?: number | null;
    sessionId?: number | null;
  };
  onApprove: (critiqueResolution?: PlanCritiqueResolution) => void;
  onRequestRevision: (feedback: string) => void;
  onDiscard: () => void;
}

type StepReviewAction = "too_large" | "split" | "merge" | "criteria" | "unneeded";

type StepRevisionTarget = {
  kind: "step";
  stepId: string;
  title: string;
  summary: string | null;
  linkedCriteria: { criterionId: string; text: string }[];
  rationale: string | null;
  reviewAction: StepReviewAction | null;
};

type RevisionTarget = { kind: "plan" } | StepRevisionTarget;

const STEP_REVIEW_ACTIONS: {
  id: StepReviewAction;
  labelKey: string;
  feedbackKey: string;
}[] = [
  {
    id: "too_large",
    labelKey: "planning.approval.quick_too_large",
    feedbackKey: "planning.approval.quick_too_large_feedback",
  },
  {
    id: "split",
    labelKey: "planning.approval.quick_split",
    feedbackKey: "planning.approval.quick_split_feedback",
  },
  {
    id: "merge",
    labelKey: "planning.approval.quick_merge",
    feedbackKey: "planning.approval.quick_merge_feedback",
  },
  {
    id: "criteria",
    labelKey: "planning.approval.quick_criteria",
    feedbackKey: "planning.approval.quick_criteria_feedback",
  },
  {
    id: "unneeded",
    labelKey: "planning.approval.quick_unneeded",
    feedbackKey: "planning.approval.quick_unneeded_feedback",
  },
];

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function buildPlanMarkdown(draft: PlanGenerationResult): string {
  const plan = draft.plan;
  const lines = [`## ${plan.goal}`, ""];
  if (plan.intent_summary) {
    lines.push("### Intent summary", plan.intent_summary, "");
  }
  const addList = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`### ${title}`);
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  };
  addList("Scope", stringArray(plan.scope));
  addList("Non-goals", stringArray(plan.non_goals));
  addList("Constraints", stringArray(plan.constraints));
  addList("Acceptance criteria", criterionTexts(plan.acceptance_criteria));
  lines.push("### Steps");
  for (const step of draft.steps) {
    const metadata = normalizeStepCriteria(step.acceptance_criteria, {
      linkedCriterionIds:
        (step as unknown as Record<string, unknown>).linkedCriterionIds ??
        (step as unknown as Record<string, unknown>).linked_criterion_ids,
      rationale:
        (step as unknown as Record<string, unknown>).rationale ??
        (step as unknown as Record<string, unknown>).decomposition_rationale,
    });
    lines.push(`- ${step.step_id}: ${step.title}`);
    if (step.summary) lines.push(`  - ${step.summary}`);
    for (const criterion of metadata.linkedCriteria) {
      lines.push(`  - Acceptance: ${criterion.criterionId} ${criterion.text}`);
    }
    if (metadata.rationale) {
      lines.push(`  - Rationale: ${metadata.rationale}`);
    }
  }
  return lines.join("\n");
}

function compactList(items: string[], fallback: string): string {
  if (items.length === 0) return fallback;
  return items.slice(0, 4).join(", ") + (items.length > 4 ? ` +${items.length - 4}` : "");
}

function hasStepVerification(step: PlanGenerationResult["steps"][number]): boolean {
  return Boolean(
    step.verification_command?.trim() ||
    step.verification_manual_check?.trim() ||
    (step.verification_kind?.trim() && step.verification_kind.trim() !== "none"),
  );
}

function stepVerificationDetail(step: PlanGenerationResult["steps"][number]): string | null {
  return step.verification_command?.trim() || step.verification_manual_check?.trim() || null;
}

function buildStepRevisionFeedback(feedback: string, target: StepRevisionTarget): string {
  const criteria =
    target.linkedCriteria
      .map((criterion) => `${criterion.criterionId} ${criterion.text}`)
      .join("; ") || "none";

  return [
    "[STEP_REVISION]",
    `Target step: ${target.stepId} ${target.title}`,
    `Review action: ${target.reviewAction ?? "custom"}`,
    `User feedback: ${feedback}`,
    `Current purpose: ${target.summary ?? "none"}`,
    `Linked criteria: ${criteria}`,
    `Current rationale: ${target.rationale ?? "none"}`,
  ].join("\n");
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  const nodes = markdown.split("\n").map((line, index) => {
    const key = `${index}-${line}`;
    if (line.startsWith("### ")) {
      return (
        <h3 key={key} className="mt-5 text-sm font-semibold text-fg first:mt-0">
          {line.slice(4)}
        </h3>
      );
    }
    if (line.startsWith("## ")) {
      return (
        <h2 key={key} className="text-lg font-semibold text-fg">
          {line.slice(3)}
        </h2>
      );
    }
    if (line.startsWith("  - ")) {
      return (
        <li key={key} className="ml-6 list-disc text-sm text-fg-muted">
          {line.slice(4)}
        </li>
      );
    }
    if (line.startsWith("- ")) {
      return (
        <li key={key} className="ml-4 list-disc text-sm text-fg-muted">
          {line.slice(2)}
        </li>
      );
    }
    if (!line.trim()) return <div key={key} className="h-2" aria-hidden />;
    return (
      <p key={key} className="text-sm text-fg-muted">
        {line}
      </p>
    );
  });
  return <div className="rounded-md border bg-bg-panel2 p-4">{nodes}</div>;
}

export function PlanDraftApprovalScreen({
  draft,
  interview,
  busy = false,
  provocation,
  onApprove,
  onRequestRevision,
  onDiscard,
}: PlanDraftApprovalScreenProps) {
  const t = useT();
  const tutorialEnabled = useTutorialEnabled();
  const [feedback, setFeedback] = useState("");
  const [revisionTarget, setRevisionTarget] = useState<RevisionTarget | null>(null);
  const [rawDraftOpen, setRawDraftOpen] = useState(false);
  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(() => new Set());
  const [critique, setCritique] = useState<"unset" | "none" | "found">("unset");
  const [critiqueNote, setCritiqueNote] = useState("");
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const lastSupervisorEvaluationKeyRef = useRef("");
  const unresolved = useMemo(
    () => stringArray(interview?.unresolved_questions),
    [interview?.unresolved_questions],
  );
  const markdown = useMemo(() => buildPlanMarkdown(draft), [draft]);
  const plan = draft.plan;
  // The "없음 — 승인 가능" path must carry one authored line about the real plan
  // before it unblocks approval, so a beginner can't one-click rubber-stamp
  // without engaging (P1-14). Tutorial-off keeps the gate-free fast path.
  const critiqueNoteValid = critiqueNote.trim().length >= 4;
  const approveBlocked = tutorialEnabled && (critique !== "none" || !critiqueNoteValid);
  const critiqueResolution: PlanCritiqueResolution | undefined =
    tutorialEnabled && critique !== "unset"
      ? {
          response: critique,
          note: critique === "none" && critiqueNote.trim() ? critiqueNote.trim() : undefined,
        }
      : undefined;
  const revisionOpen = revisionTarget !== null;
  const acceptanceCriteria = useMemo(
    () => criterionTexts(plan.acceptance_criteria),
    [plan.acceptance_criteria],
  );
  const planDraftSupervisorRequest = useMemo(() => {
    if (!provocation?.enabled || typeof provocation.sessionId !== "number") return null;
    return createPlanDraftSupervisorRequest({
      sessionId: provocation.sessionId,
      projectId: typeof provocation.projectId === "number" ? provocation.projectId : undefined,
      planId: plan.id,
      sourceUiMode: provocation.mode,
      locale: "ko-KR",
      goalSummary: plan.goal,
      acceptanceCriteria,
      unresolvedQuestions: unresolved,
      planSteps: draft.steps.map((step) => {
        const metadata = normalizeStepCriteria(step.acceptance_criteria, {
          linkedCriterionIds:
            (step as unknown as Record<string, unknown>).linkedCriterionIds ??
            (step as unknown as Record<string, unknown>).linked_criterion_ids,
          rationale:
            (step as unknown as Record<string, unknown>).rationale ??
            (step as unknown as Record<string, unknown>).decomposition_rationale,
        });
        return normalizePlanStep({
          ...step,
          linkedCriterionIds: metadata.linkedCriteria.map((criterion) => criterion.criterionId),
        });
      }),
    });
  }, [
    acceptanceCriteria,
    draft.steps,
    plan.goal,
    plan.id,
    provocation?.enabled,
    provocation?.mode,
    provocation?.projectId,
    provocation?.sessionId,
    unresolved,
  ]);
  const [provocationCards, setProvocationCards] = useState<ProvocationCard[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!planDraftSupervisorRequest) {
      lastSupervisorEvaluationKeyRef.current = "";
      setProvocationCards([]);
      return () => {
        cancelled = true;
      };
    }
    const requestKey = JSON.stringify(planDraftSupervisorRequest);
    if (requestKey === lastSupervisorEvaluationKeyRef.current) {
      return () => {
        cancelled = true;
      };
    }
    lastSupervisorEvaluationKeyRef.current = requestKey;

    setProvocationCards([]);
    void evaluateProvocationSupervisor(planDraftSupervisorRequest)
      .then((response) => {
        if (cancelled) return;
        setProvocationCards(response.status === "shown" ? [response.card] : []);
      })
      .catch((err) => {
        if (import.meta.env.DEV) {
          console.warn("plan draft supervisor evaluation failed:", err);
        }
        if (!cancelled) setProvocationCards([]);
      });

    return () => {
      cancelled = true;
    };
  }, [planDraftSupervisorRequest]);

  const openRevisionFeedback = (
    nextFeedback: string,
    target: RevisionTarget = { kind: "plan" },
  ) => {
    setFeedback(nextFeedback);
    setRevisionTarget(target);
  };

  const openStepRevision = (
    step: PlanGenerationResult["steps"][number],
    metadata: ReturnType<typeof normalizeStepCriteria>,
    reviewAction: StepReviewAction | null,
    nextFeedback: string,
  ) => {
    openRevisionFeedback(nextFeedback, {
      kind: "step",
      stepId: step.step_id,
      title: step.title,
      summary: step.summary,
      linkedCriteria: metadata.linkedCriteria,
      rationale: metadata.rationale,
      reviewAction,
    });
  };

  const toggleStepDetails = (stepId: string) => {
    setExpandedStepIds((current) => {
      const next = new Set(current);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const handleProvocationAction = useProvocationActionResolver({
    onAddAcceptanceCriteria: () => {
      openRevisionFeedback(t("planning.approval.revision_add_criteria"));
    },
    onAddVerificationStep: () => {
      openRevisionFeedback(t("planning.approval.revision_add_verification"));
    },
    onSplitScope: () => {
      openRevisionFeedback(t("planning.approval.revision_split_scope"));
    },
    onContinueWithRisk: () => {
      openRevisionFeedback(t("planning.approval.revision_continue_risk"));
    },
  });
  const selectedStepReviewAction =
    revisionTarget?.kind === "step" && revisionTarget.reviewAction
      ? STEP_REVIEW_ACTIONS.find((action) => action.id === revisionTarget.reviewAction)
      : null;

  return (
    <div className="h-full overflow-y-auto bg-bg" data-testid="plan-draft-approval">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-5">
        <header className="flex items-start justify-between gap-4 border-b pb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-fg">{t("planning.approval.title")}</h2>
            <p className="mt-1 text-sm text-fg-muted">{plan.goal}</p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Button
              variant={revisionOpen ? "secondary" : "outline"}
              size="sm"
              onClick={() => openRevisionFeedback("", { kind: "plan" })}
              disabled={busy}
              data-testid="plan-draft-request-changes-toggle"
            >
              <RotateCcw />
              {t("planning.approval.request_plan_changes")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => onApprove(critiqueResolution)}
              disabled={busy || approveBlocked}
            >
              <Check />
              {t("planning.approval.approve")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDiscardOpen(true)}
              disabled={busy}
              data-testid="plan-draft-discard"
            >
              <Trash2 />
              {t("planning.approval.discard")}
            </Button>
          </div>
        </header>

        <ProvocationCardHost
          cards={provocationCards}
          context={{
            mode: provocation?.mode,
            stage: "instruct",
            projectId: provocation?.projectId,
            sessionId: provocation?.sessionId,
            featureId: plan.id,
          }}
          mode={provocation?.mode ?? "standard"}
          onAction={handleProvocationAction}
        />

        {tutorialEnabled ? (
          <div
            className="flex flex-wrap items-center gap-2 rounded-md border border-info/40 bg-info/5 p-3 text-sm"
            data-testid="plan-critique-rep"
          >
            <span className="text-fg">{t("planning.approval.critique_question")}</span>
            <div className="flex gap-2">
              <Button
                variant={critique === "none" ? "primary" : "ghost"}
                size="sm"
                data-testid="plan-critique-none"
                onClick={() => setCritique("none")}
              >
                {t("planning.approval.critique_none")}
              </Button>
              <Button
                variant={critique === "found" ? "danger" : "ghost"}
                size="sm"
                data-testid="plan-critique-found"
                onClick={() => setCritique("found")}
              >
                {t("planning.approval.critique_found")}
              </Button>
            </div>
            {critique === "found" ? (
              <span className="w-full text-[11px] text-fg-muted">
                {t("planning.approval.critique_found_hint")}
              </span>
            ) : null}
            {critique === "none" ? (
              <div className="w-full">
                <input
                  type="text"
                  value={critiqueNote}
                  onChange={(event) => setCritiqueNote(event.target.value)}
                  placeholder={t("planning.approval.critique_none_note_placeholder")}
                  aria-label={t("planning.approval.critique_none_note_placeholder")}
                  data-testid="plan-critique-none-note"
                  className="w-full rounded-md border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                />
                {!critiqueNoteValid ? (
                  <p className="mt-1 text-[11px] text-fg-muted">
                    {t("planning.approval.critique_none_note_hint")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {unresolved.length > 0 ? (
          <div className="flex gap-2 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm text-fg">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
            <div>
              <p className="font-semibold">{t("planning.approval.unresolved_warning")}</p>
              <ul className="mt-1 space-y-1 text-fg-muted">
                {unresolved.map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        <section className="space-y-5">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-fg">
              {t("planning.approval.step_dag")}
            </h3>
            <PlanDraftDependencyMap steps={draft.steps} />
          </section>

          {revisionOpen ? (
            <section
              className="rounded-md border bg-bg-panel2 p-3"
              data-testid="plan-draft-request-changes-panel"
              data-revision-target={revisionTarget?.kind ?? "plan"}
            >
              <h3 className="text-sm font-semibold text-fg">
                {revisionTarget?.kind === "step"
                  ? `${t("planning.approval.request_step_changes")}: ${revisionTarget.stepId}`
                  : t("planning.approval.request_plan_changes")}
              </h3>
              {revisionTarget?.kind === "step" ? (
                <div
                  className="mt-3 rounded-md border border-info/30 bg-info/5 p-3 text-xs"
                  data-testid="plan-draft-step-revision-context"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-fg">
                      {revisionTarget.stepId} · {revisionTarget.title}
                    </span>
                    {selectedStepReviewAction ? (
                      <span className="rounded-sm border border-border bg-bg px-2 py-0.5 font-semibold text-accent">
                        {t(selectedStepReviewAction.labelKey)}
                      </span>
                    ) : null}
                  </div>
                  {revisionTarget.linkedCriteria.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {revisionTarget.linkedCriteria.map((criterion) => (
                        <span
                          key={criterion.criterionId}
                          className="rounded-sm border border-border bg-bg px-2 py-1 text-fg"
                        >
                          <span className="font-semibold text-accent">{criterion.criterionId}</span>{" "}
                          {criterion.text}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {revisionTarget.rationale ? (
                    <p className="mt-2 text-fg-muted">{revisionTarget.rationale}</p>
                  ) : null}
                </div>
              ) : null}
              <textarea
                className="mt-2 min-h-24 w-full resize-none rounded-md border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                placeholder={t("planning.approval.request_changes_placeholder")}
                disabled={busy}
                data-testid="plan-draft-request-changes-input"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const trimmed = feedback.trim();
                    if (!trimmed) return;
                    onRequestRevision(
                      revisionTarget?.kind === "step"
                        ? buildStepRevisionFeedback(trimmed, revisionTarget)
                        : trimmed,
                    );
                    setFeedback("");
                    setRevisionTarget(null);
                  }}
                  disabled={busy || feedback.trim().length === 0}
                  data-testid="plan-draft-request-changes-submit"
                >
                  <RotateCcw />
                  {revisionTarget?.kind === "step"
                    ? t("planning.approval.request_step_changes")
                    : t("planning.approval.request_plan_changes")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRevisionTarget(null)}
                  disabled={busy}
                  data-testid="plan-draft-request-changes-cancel"
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </section>
          ) : null}

          <div className="space-y-5" data-testid="plan-draft-review-content">
            <section className="rounded-md border bg-bg-panel2 p-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRawDraftOpen((open) => !open)}
                data-testid="plan-draft-raw-toggle"
              >
                {rawDraftOpen
                  ? t("planning.approval.hide_raw_draft")
                  : t("planning.approval.show_raw_draft")}
              </Button>
              {rawDraftOpen ? (
                <div className="mt-3" data-testid="plan-draft-raw-markdown">
                  <MarkdownPreview markdown={markdown} />
                </div>
              ) : null}
            </section>
            <section className="rounded-md border bg-bg-panel2 p-3">
              <h3 className="text-sm font-semibold text-fg">
                {t("planning.approval.intent_surface_title")}
              </h3>
              <p className="mt-1 text-xs text-fg-muted">
                {t("planning.approval.intent_surface_description")}
              </p>
              <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase text-fg-muted">
                    {t("planning.approval.goal")}
                  </dt>
                  <dd className="mt-1 text-fg">{plan.goal}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-fg-muted">
                    {t("planning.approval.intent_summary")}
                  </dt>
                  <dd className="mt-1 text-fg">
                    {interview?.intent_summary ??
                      plan.intent_summary ??
                      t("planning.approval.none")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-fg-muted">
                    {t("planning.approval.acceptance_criteria")}
                  </dt>
                  <dd className="mt-1 text-fg">
                    {compactList(acceptanceCriteria, t("planning.approval.none"))}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-fg-muted">
                    {t("planning.approval.constraints")}
                  </dt>
                  <dd className="mt-1 text-fg">
                    {compactList(stringArray(plan.constraints), t("planning.approval.none"))}
                  </dd>
                </div>
                <div className="md:col-span-2">
                  <dt className="text-xs font-semibold uppercase text-fg-muted">
                    {t("planning.approval.non_goals")}
                  </dt>
                  <dd className="mt-1 text-fg">
                    {compactList(stringArray(plan.non_goals), t("planning.approval.none"))}
                  </dd>
                </div>
              </dl>
            </section>
            <section>
              <h3 className="text-sm font-semibold text-fg">
                {t("planning.approval.interview_context")}
              </h3>
              <div className="mt-2 rounded-md border bg-bg-panel2 p-3 text-sm text-fg-muted">
                <p>{interview?.intent_summary ?? plan.intent_summary ?? "-"}</p>
                <h4 className="mt-3 text-xs font-semibold uppercase text-fg">
                  {t("planning.approval.unresolved_questions")}
                </h4>
                <ul className="mt-1 space-y-1">
                  {(unresolved.length > 0 ? unresolved : [t("planning.approval.none")]).map(
                    (item) => (
                      <li key={item}>- {item}</li>
                    ),
                  )}
                </ul>
              </div>
            </section>
            <section>
              <h3 className="text-sm font-semibold text-fg">{t("planning.approval.steps")}</h3>
              <ol className="mt-2 space-y-3">
                {draft.steps.map((step) => {
                  const expectedFiles = stringArray(step.expected_files);
                  const dependencies = stringArray(step.dependencies);
                  const stepMetadata = normalizeStepCriteria(step.acceptance_criteria, {
                    linkedCriterionIds:
                      (step as unknown as Record<string, unknown>).linkedCriterionIds ??
                      (step as unknown as Record<string, unknown>).linked_criterion_ids,
                    rationale:
                      (step as unknown as Record<string, unknown>).rationale ??
                      (step as unknown as Record<string, unknown>).decomposition_rationale,
                  });
                  const verificationIncluded = hasStepVerification(step);
                  const verificationText = stepVerificationDetail(step);
                  const detailsOpen = expandedStepIds.has(step.step_id);
                  const hasDetails =
                    expectedFiles.length > 0 ||
                    Boolean(verificationText) ||
                    dependencies.length > 0 ||
                    Boolean(step.parallel_group);
                  return (
                    <li
                      key={step.id}
                      className="rounded-md border bg-bg-panel2 p-3"
                      data-testid="plan-draft-step"
                    >
                      <div className="flex flex-wrap items-start gap-2">
                        <p className="min-w-0 flex-1 text-sm font-semibold text-fg">
                          {step.step_id} · {step.title}
                        </p>
                        <span
                          className={
                            verificationIncluded
                              ? "shrink-0 rounded-sm border border-success/50 bg-success/10 px-2 py-0.5 text-[10.5px] font-semibold text-success"
                              : "shrink-0 rounded-sm border border-warn/50 bg-warn/10 px-2 py-0.5 text-[10.5px] font-semibold text-warn"
                          }
                          data-testid="plan-step-verification-indicator"
                          data-verification={verificationIncluded ? "included" : "missing"}
                        >
                          {verificationIncluded
                            ? t("planning.approval.step_verification_included")
                            : t("planning.approval.step_verification_none")}
                        </span>
                      </div>
                      {step.summary ? (
                        <p className="mt-1 text-sm text-fg-muted">
                          <span className="font-semibold text-fg">
                            {t("planning.approval.step_purpose")}:
                          </span>{" "}
                          {step.summary}
                        </p>
                      ) : null}
                      {stepMetadata.linkedCriteria.length > 0 || stepMetadata.rationale ? (
                        <div
                          className="mt-3 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs"
                          data-testid="plan-draft-step-criteria"
                        >
                          {stepMetadata.linkedCriteria.length > 0 ? (
                            <div className="space-y-1.5">
                              <p className="text-[10.5px] font-semibold uppercase text-fg-muted">
                                {t("prd.decomposition.linked_criteria")}
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {stepMetadata.linkedCriteria.map((criterion) => (
                                  <span
                                    key={criterion.criterionId}
                                    className="inline-flex items-center gap-1 rounded-sm border border-border bg-bg px-2 py-1 text-fg"
                                  >
                                    <span className="font-semibold text-accent">
                                      {criterion.criterionId}
                                    </span>
                                    <span>{criterion.text}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {stepMetadata.rationale ? (
                            <div
                              className={
                                stepMetadata.linkedCriteria.length > 0 ? "mt-3" : undefined
                              }
                            >
                              <p className="text-[10.5px] font-semibold uppercase text-fg-muted">
                                {t("prd.decomposition.rationale")}
                              </p>
                              <p className="mt-1 text-fg-muted">{stepMetadata.rationale}</p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div
                        className="mt-3 rounded-md border border-border/80 bg-bg/60 px-3 py-2"
                        data-testid="plan-draft-step-quick-actions"
                      >
                        <p className="text-[10.5px] font-semibold uppercase text-fg-muted">
                          {t("planning.approval.quick_review_label")}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {STEP_REVIEW_ACTIONS.map((action) => (
                            <Button
                              key={action.id}
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                openStepRevision(
                                  step,
                                  stepMetadata,
                                  action.id,
                                  t(action.feedbackKey),
                                )
                              }
                              disabled={busy}
                              data-testid={`plan-draft-step-quick-${action.id}`}
                            >
                              {t(action.labelKey)}
                            </Button>
                          ))}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openStepRevision(step, stepMetadata, null, "")}
                          disabled={busy}
                          data-testid="plan-draft-step-revision"
                        >
                          <RotateCcw />
                          {t("planning.approval.request_step_changes")}
                        </Button>
                        {hasDetails ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleStepDetails(step.step_id)}
                            data-testid="plan-draft-step-details-toggle"
                          >
                            {detailsOpen ? <ChevronUp /> : <ChevronDown />}
                            {detailsOpen
                              ? t("planning.approval.hide_step_details")
                              : t("planning.approval.show_step_details")}
                          </Button>
                        ) : null}
                      </div>
                      {detailsOpen ? (
                        <dl
                          className="mt-3 grid gap-2 border-t pt-3 text-xs text-fg-muted md:grid-cols-2"
                          data-testid="plan-draft-step-details"
                        >
                          {expectedFiles.length > 0 ? (
                            <div>
                              <dt className="font-semibold text-fg">
                                {t("planning.approval.step_expected_files")}
                              </dt>
                              <dd className="mt-0.5 break-words">
                                {compactList(expectedFiles, t("planning.approval.none"))}
                              </dd>
                            </div>
                          ) : null}
                          {verificationText ? (
                            <div>
                              <dt className="font-semibold text-fg">
                                {t("planning.approval.step_verification")}
                              </dt>
                              <dd className="mt-0.5 break-words">{verificationText}</dd>
                            </div>
                          ) : null}
                          {dependencies.length > 0 ? (
                            <div>
                              <dt className="font-semibold text-fg">
                                {t("planning.approval.step_dependencies")}
                              </dt>
                              <dd className="mt-0.5 break-words">
                                {compactList(dependencies, t("planning.approval.none"))}
                              </dd>
                            </div>
                          ) : null}
                          {step.parallel_group ? (
                            <div>
                              <dt className="font-semibold text-fg">
                                {t("planning.approval.step_parallel_group")}
                              </dt>
                              <dd className="mt-0.5 break-words">{step.parallel_group}</dd>
                            </div>
                          ) : null}
                        </dl>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        </section>
      </div>

      <Dialog
        open={confirmDiscardOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setConfirmDiscardOpen(false);
        }}
      >
        <DialogContent data-testid="plan-draft-discard-confirm" className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-danger" aria-hidden />
              {t("planning.approval.discard_confirm_title")}
            </DialogTitle>
            <DialogDescription>
              {t("planning.approval.discard_confirm_description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmDiscardOpen(false)}
              data-testid="plan-draft-discard-cancel"
            >
              <X className="h-4 w-4" />
              {t("planning.approval.discard_confirm_cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDiscardOpen(false);
                onDiscard();
              }}
              disabled={busy}
              data-testid="plan-draft-discard-confirm-button"
            >
              <Trash2 className="h-4 w-4" />
              {t("planning.approval.discard_confirm_button")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
