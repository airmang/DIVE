import { AlertTriangle, Check, RotateCcw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "../../i18n";
import type { InterviewRow, PlanGenerationResult } from "../../features/planning";
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
  normalizePlanStep,
  type ScaffoldMode,
  useProvocationActionResolver,
} from "../../features/provocation";
import { generateProvocationCards } from "../../features/provocation/rules";

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
  onApprove: () => void;
  onRequestRevision: (feedback: string) => void;
  onDiscard: () => void;
}

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
  const [critique, setCritique] = useState<"unset" | "none" | "found">("unset");
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const unresolved = stringArray(interview?.unresolved_questions);
  const markdown = useMemo(() => buildPlanMarkdown(draft), [draft]);
  const plan = draft.plan;
  const approveBlocked = tutorialEnabled && critique !== "none";
  const provocationCards = useMemo(() => {
    if (!provocation?.enabled) return [];
    return generateProvocationCards({
      mode: provocation.mode,
      stage: "instruct",
      projectId: provocation.projectId,
      sessionId: provocation.sessionId,
      featureId: plan.id,
      goalText: plan.goal,
      acceptanceCriteria: stringArray(plan.acceptance_criteria),
      planSteps: draft.steps.map(normalizePlanStep),
    });
  }, [draft.steps, plan.acceptance_criteria, plan.goal, plan.id, provocation]);

  const handleProvocationAction = useProvocationActionResolver({
    onAddAcceptanceCriteria: () => {
      setFeedback(
        "완료 기준을 계획에 추가해 주세요. 예: 사용자가 무엇을 보면 끝났다고 판단할 수 있는지 2~3개로 적어 주세요.",
      );
    },
    onAddVerificationStep: () => {
      setFeedback(
        "검증 단계가 필요합니다. 실행/프리뷰/테스트 중 무엇으로 확인할지 계획에 추가해 주세요.",
      );
    },
    onSplitScope: () => {
      setFeedback(
        "범위를 더 작게 나눠 주세요. 첫 번째 기능 하나만 승인 가능한 계획으로 다시 작성해 주세요.",
      );
    },
    onContinueWithRisk: () => {
      setFeedback(
        "남은 위험을 알고 진행하려면, 변경 요청란에 왜 그대로 진행해도 되는지 짧게 남겨 주세요.",
      );
    },
  });

  return (
    <div className="h-full overflow-y-auto bg-bg" data-testid="plan-draft-approval">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-5">
        <header className="flex items-start justify-between gap-4 border-b pb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-fg">{t("planning.approval.title")}</h2>
            <p className="mt-1 text-sm text-fg-muted">{plan.goal}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={onApprove}
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
            <span className="text-fg">이 계획에 빠진 단계가 있나요?</span>
            <div className="flex gap-2">
              <Button
                variant={critique === "none" ? "primary" : "ghost"}
                size="sm"
                data-testid="plan-critique-none"
                onClick={() => setCritique("none")}
              >
                없음 — 승인 가능
              </Button>
              <Button
                variant={critique === "found" ? "danger" : "ghost"}
                size="sm"
                data-testid="plan-critique-found"
                onClick={() => setCritique("found")}
              >
                있음 — 변경 요청
              </Button>
            </div>
            {critique === "found" ? (
              <span className="w-full text-[11px] text-fg-muted">
                오른쪽 "변경 요청"란에 빠진 단계를 적어 수정을 요청하세요.
              </span>
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

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-5">
            <MarkdownPreview markdown={markdown} />
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
                    {compactList(
                      criterionTexts(plan.acceptance_criteria),
                      t("planning.approval.none"),
                    )}
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
                  const verificationText =
                    step.verification_command?.trim() ||
                    step.verification_manual_check?.trim() ||
                    step.verification_kind?.trim() ||
                    t("planning.approval.step_verification_missing");
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
                          ) : null}
                          {stepMetadata.rationale ? (
                            <p className="mt-2 text-fg-muted">{stepMetadata.rationale}</p>
                          ) : null}
                        </div>
                      ) : null}
                      <dl className="mt-3 grid gap-2 text-xs text-fg-muted md:grid-cols-2">
                        <div>
                          <dt className="font-semibold text-fg">
                            {t("planning.approval.step_expected_files")}
                          </dt>
                          <dd className="mt-0.5 break-words">
                            {compactList(expectedFiles, t("planning.approval.none"))}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-fg">
                            {t("planning.approval.step_verification")}
                          </dt>
                          <dd className="mt-0.5 break-words">{verificationText}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-fg">
                            {t("planning.approval.step_dependencies")}
                          </dt>
                          <dd className="mt-0.5 break-words">
                            {compactList(dependencies, t("planning.approval.none"))}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-fg">
                            {t("planning.approval.step_parallel_group")}
                          </dt>
                          <dd className="mt-0.5 break-words">
                            {step.parallel_group ?? t("planning.approval.none")}
                          </dd>
                        </div>
                      </dl>
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
          <aside className="space-y-4">
            <section>
              <h3 className="mb-2 text-sm font-semibold text-fg">
                {t("planning.approval.step_dag")}
              </h3>
              <PlanDraftDependencyMap steps={draft.steps} />
            </section>
            <section className="rounded-md border bg-bg-panel2 p-3">
              <h3 className="text-sm font-semibold text-fg">
                {t("planning.approval.request_changes")}
              </h3>
              <textarea
                className="mt-2 min-h-24 w-full resize-none rounded-md border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                placeholder={t("planning.approval.request_changes_placeholder")}
                disabled={busy}
              />
              <Button
                className="mt-2"
                variant="outline"
                size="sm"
                onClick={() => {
                  const trimmed = feedback.trim();
                  if (!trimmed) return;
                  onRequestRevision(trimmed);
                  setFeedback("");
                }}
                disabled={busy || feedback.trim().length === 0}
              >
                <RotateCcw />
                {t("planning.approval.request_changes")}
              </Button>
            </section>
          </aside>
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
