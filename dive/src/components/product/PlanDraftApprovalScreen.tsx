import { AlertTriangle, Check, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "../../i18n";
import type { InterviewRow, PlanGenerationResult } from "../../features/planning";
import { useTutorialEnabled } from "../../stores/ui-preferences";
import { Button } from "../ui/button";
import { PlanDraftDependencyMap } from "./PlanDraftDependencyMap";

interface PlanDraftApprovalScreenProps {
  draft: PlanGenerationResult;
  interview: InterviewRow | null;
  busy?: boolean;
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
  addList("Acceptance criteria", stringArray(plan.acceptance_criteria));
  lines.push("### Steps");
  for (const step of draft.steps) {
    lines.push(`- ${step.step_id}: ${step.title}`);
    if (step.summary) lines.push(`  - ${step.summary}`);
    for (const criterion of stringArray(step.acceptance_criteria)) {
      lines.push(`  - Acceptance: ${criterion}`);
    }
  }
  return lines.join("\n");
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
  onApprove,
  onRequestRevision,
  onDiscard,
}: PlanDraftApprovalScreenProps) {
  const t = useT();
  const tutorialEnabled = useTutorialEnabled();
  const [feedback, setFeedback] = useState("");
  const [critique, setCritique] = useState<"unset" | "none" | "found">("unset");
  const unresolved = stringArray(interview?.unresolved_questions);
  const markdown = useMemo(() => buildPlanMarkdown(draft), [draft]);
  const plan = draft.plan;
  const approveBlocked = tutorialEnabled && critique !== "none";

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
            <Button variant="outline" size="sm" onClick={onDiscard} disabled={busy}>
              <Trash2 />
              {t("planning.approval.discard")}
            </Button>
          </div>
        </header>

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
                {draft.steps.map((step) => (
                  <li key={step.id} className="rounded-md border bg-bg-panel2 p-3">
                    <p className="text-sm font-semibold text-fg">
                      {step.step_id} · {step.title}
                    </p>
                    {step.summary ? (
                      <p className="mt-1 text-sm text-fg-muted">{step.summary}</p>
                    ) : null}
                  </li>
                ))}
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
    </div>
  );
}
