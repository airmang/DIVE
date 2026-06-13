import { useEffect, useRef } from "react";
import { AlertCircle, CheckCircle2, Circle, Clock3, ExternalLink, FileCode, X } from "lucide-react";
import { Button } from "../ui/button";
import { LearningHint } from "../ui/learning-hint";
import { cn } from "../../lib/utils";
import { type RoadmapStep, type RoadmapStepStatus } from "../../features/roadmap";
import type { ChangedFile } from "../slide-in/types";
import { ApprovalJudgment, type ApprovalDecision } from "../workmap/ApprovalJudgment";
import type { VerifyLogView } from "../workmap/types";
import { useT } from "../../i18n";
import {
  ProvocationCardHost,
  deriveVerificationStatuses,
  generateProvocationCards,
  normalizeChangedFile,
  type ProvocationAction,
  type ProvocationContext,
  type ScaffoldMode,
  type VerificationStatusItem,
} from "../../features/provocation";

export interface StepDetailSlideInProps {
  open: boolean;
  step: RoadmapStep | null;
  toolCallCount: number;
  verifyLog: VerifyLogView | null;
  verifyState: "idle" | "running" | "error";
  verifyError: string | null;
  changedFiles: ChangedFile[];
  onOpenChange: (open: boolean) => void;
  onOpenCode: () => void;
  onOpenPreview?: () => void;
  onApprovalDecision: (decision: ApprovalDecision) => void;
  onGoToChat: () => void;
  provocation?: {
    enabled: boolean;
    mode: ScaffoldMode;
    projectId?: number | null;
    sessionId?: number | null;
  };
}

const STATUS_CLASS: Record<RoadmapStepStatus, string> = {
  planned: "border-border bg-bg-panel2 text-fg-muted",
  in_progress: "border-accent/60 bg-accent/10 text-accent",
  review: "border-warn/60 bg-warn/10 text-warn",
  done: "border-success/60 bg-success/10 text-success",
  shipped: "border-success/70 bg-success/15 text-success",
};

function statusIcon(status: RoadmapStepStatus) {
  if (status === "shipped" || status === "done") return <CheckCircle2 aria-hidden />;
  if (status === "review") return <Clock3 aria-hidden />;
  if (status === "in_progress") return <AlertCircle aria-hidden />;
  return <Circle aria-hidden />;
}

export function StepDetailSlideIn({
  open,
  step,
  toolCallCount,
  verifyLog,
  verifyState,
  verifyError,
  changedFiles,
  onOpenChange,
  onOpenCode,
  onOpenPreview,
  onApprovalDecision,
  onGoToChat,
  provocation,
}: StepDetailSlideInProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => closeBtnRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [open]);

  const status = step?.status ?? null;
  const isReview = status === "review";
  const hasChangedFiles = changedFiles.length > 0;
  const provocationContext: ProvocationContext | null =
    step && provocation?.enabled
      ? {
          mode: provocation.mode,
          stage: isReview ? "finalApproval" : "verify",
          projectId: provocation.projectId,
          sessionId: provocation.sessionId,
          taskId: step.id,
          goalText: [step.title, step.description].filter(Boolean).join("\n"),
          acceptanceCriteria: step.acceptanceCriteria ? [step.acceptanceCriteria] : [],
          planSteps: [
            {
              id: String(step.id),
              text: [step.title, step.description, step.assistSummary, step.testCommand]
                .filter(Boolean)
                .join(" "),
            },
          ],
          changedFiles: changedFiles.map((file) => normalizeChangedFile({ path: file.path })),
          approvalProvenance: step.approvalProvenance,
          verification: {
            aiClaimedDone: Boolean(verifyLog?.intent_match),
            automatedTestsPassed: verifyLog?.test_result === "pass",
            testResult: verifyLog?.test_result,
            externalTestRun: verifyLog ? verifyLog.test_result !== "skipped" : undefined,
            failedButAccepted:
              step.approvalProvenance?.verificationState === "failed_but_accepted",
            approvedWithRisk: Boolean(step.approvalProvenance?.riskAccepted),
            approvalProvenance: step.approvalProvenance,
          },
        }
      : null;
  const provocationCards = provocationContext ? generateProvocationCards(provocationContext) : [];
  const verificationStatuses = provocationContext
    ? deriveVerificationStatuses(provocationContext)
    : [];

  const handleProvocationAction = (action: ProvocationAction) => {
    if (action.kind === "open_diff") {
      onOpenCode();
      return;
    }
    if (action.kind === "open_preview" || action.kind === "run_app") {
      onOpenPreview?.();
      return;
    }
    if (action.kind === "ask_ai_for_rationale" || action.kind === "add_verification_step") {
      onGoToChat();
    }
  };

  return (
    <aside
      ref={panelRef}
      className={cn(
        "fixed right-0 top-0 z-50 flex h-full w-[520px] flex-col border-l bg-bg shadow-xl",
        "transition-transform duration-slide ease-out motion-reduce:duration-0",
        open ? "translate-x-0" : "translate-x-full pointer-events-none",
      )}
      role="dialog"
      aria-modal="false"
      aria-labelledby="step-detail-title"
      data-testid="step-detail-panel"
      data-open={open ? "true" : "false"}
      data-step-id={step?.id ?? ""}
      data-status={status ?? ""}
    >
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-muted">
            {t("roadmap.step_detail.title")}
            {step ? ` · ${t("roadmap.step_number", { position: step.position })}` : null}
          </div>
          <h2
            id="step-detail-title"
            className="mt-0.5 truncate text-sm font-bold text-fg"
            data-testid="step-detail-title"
          >
            {step?.title ?? ""}
          </h2>
          {status ? (
            <span
              className={cn(
                "mt-2 inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-semibold",
                STATUS_CLASS[status],
              )}
              data-testid="step-detail-status"
            >
              <span className="h-3 w-3">{statusIcon(status)}</span>
              {t(`roadmap.status_v2.${status}`)}
            </span>
          ) : null}
        </div>
        <Button
          ref={closeBtnRef}
          size="icon"
          variant="ghost"
          onClick={() => onOpenChange(false)}
          aria-label={t("roadmap.step_detail.close")}
          data-testid="step-detail-close"
        >
          <X />
        </Button>
      </header>

      {step ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <LearningHint className="rounded-md border border-info/40 bg-info/5 px-3 py-2 text-[11px]">
            {t("roadmap.step_detail.read_only_note")}
          </LearningHint>

          {verificationStatuses.length > 0 ? (
            <div
              className="mt-3 flex flex-wrap gap-1.5"
              data-testid="step-detail-verification-statuses"
            >
              {verificationStatuses.map((item) => (
                <VerificationStatusChip key={item.id} item={item} />
              ))}
            </div>
          ) : null}

          <ProvocationCardHost
            className="mt-3"
            cards={provocationCards}
            context={provocationContext ?? undefined}
            mode={provocation?.mode ?? "standard"}
            onAction={handleProvocationAction}
          />

          <div className="mt-3 flex flex-wrap gap-2">
            {isReview ? (
              <div className="flex flex-col gap-2">
                <LearningHint data-testid="trust-calibration-hint">
                  {t("roadmap.step_detail.trust_calibration_hint")}
                </LearningHint>
                <ApprovalJudgment
                  prompt={verifyLog ? t("roadmap.step_detail.approval_prompt") : undefined}
                  onDecide={onApprovalDecision}
                />
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={onGoToChat}
                data-testid="step-detail-open-chat"
              >
                <ExternalLink />
                {t("roadmap.step_detail.go_to_chat")}
              </Button>
            )}
            {hasChangedFiles ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onOpenCode}
                data-testid="step-detail-open-code"
              >
                <FileCode />
                {t("roadmap.step_detail.section_changed_files")}
              </Button>
            ) : null}
          </div>
          <LearningHint className="mt-2 text-[11px]">
            {t("roadmap.step_detail.go_to_chat_hint")}
          </LearningHint>

          {step.description ? (
            <Section title={t("roadmap.step_detail.section_goal")}>
              <p className="whitespace-pre-wrap text-sm text-fg" data-testid="step-detail-goal">
                {step.description}
              </p>
            </Section>
          ) : null}

          {step.acceptanceCriteria ? (
            <Section title={t("roadmap.step_detail.section_acceptance_criteria")}>
              <p
                className="whitespace-pre-wrap text-sm text-fg"
                data-testid="step-detail-acceptance"
              >
                {step.acceptanceCriteria}
              </p>
            </Section>
          ) : null}

          {step.assistSummary ? (
            <Section title={t("roadmap.step_detail.section_instruction")}>
              <p
                className="whitespace-pre-wrap text-sm text-fg"
                data-testid="step-detail-instruction"
              >
                {step.assistSummary}
              </p>
              {step.testCommand ? (
                <p className="mt-2 break-all font-mono text-[11px] text-fg-muted">
                  {step.testCommand}
                </p>
              ) : null}
            </Section>
          ) : null}

          <Section title={t("roadmap.step_detail.section_timeline")}>
            <ul className="space-y-1 text-[11px] text-fg-muted">
              <li>
                {t("roadmap.step_detail.section_instruction")}:{" "}
                <span className="text-fg">{toolCallCount > 0 ? `${toolCallCount}` : "—"}</span>
              </li>
              <li>
                {t("roadmap.step_detail.section_changed_files")}:{" "}
                <span className="text-fg">{changedFiles.length}</span>
              </li>
            </ul>
          </Section>

          {verifyLog || verifyState !== "idle" ? (
            <Section title={t("roadmap.step_detail.section_verification")}>
              <VerificationBlock
                verifyLog={verifyLog}
                verifyState={verifyState}
                verifyError={verifyError}
              />
            </Section>
          ) : null}

          {step.changeSummary ? (
            <Section title={t("roadmap.step_detail.section_changed_files")}>
              <p
                className="whitespace-pre-wrap text-sm text-fg"
                data-testid="step-detail-change-summary"
              >
                {step.changeSummary}
              </p>
            </Section>
          ) : null}

          {step.retrospective ? (
            <Section title={t("roadmap.step_detail.section_retrospective")}>
              <p
                className="whitespace-pre-wrap text-sm text-fg-muted"
                data-testid="step-detail-retrospective"
              >
                {step.retrospective}
              </p>
            </Section>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 py-8 text-center text-sm text-fg-muted">
          {t("roadmap.next_action_v2.pick_step")}
        </div>
      )}
    </aside>
  );
}

const VERIFY_STATUS_CLASS: Record<VerificationStatusItem["tone"], string> = {
  info: "border-info/50 bg-info/10 text-info",
  success: "border-success/60 bg-success/10 text-success",
  warn: "border-warn/60 bg-warn/10 text-warn",
  risk: "border-danger/60 bg-danger/10 text-danger",
};

function VerificationStatusChip({ item }: { item: VerificationStatusItem }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-semibold",
        VERIFY_STATUS_CLASS[item.tone],
      )}
      data-testid="verification-status-chip"
      data-status-id={item.id}
      data-evidence-backed={item.evidenceBacked ? "true" : "false"}
    >
      {item.label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-muted">
        {title}
      </div>
      <div className="mt-1 rounded-md border border-border bg-bg-panel2 px-3 py-2">{children}</div>
    </section>
  );
}

interface VerificationBlockProps {
  verifyLog: VerifyLogView | null;
  verifyState: "idle" | "running" | "error";
  verifyError: string | null;
}

function VerificationBlock({ verifyLog, verifyState, verifyError }: VerificationBlockProps) {
  const t = useT();
  if (verifyState === "running") {
    return <p className="text-xs text-fg-muted">…</p>;
  }
  if (verifyState === "error" && verifyError) {
    return (
      <p className="text-xs text-danger" data-testid="step-detail-verify-error">
        {verifyError}
      </p>
    );
  }
  if (!verifyLog) {
    return <p className="text-xs text-fg-muted">—</p>;
  }
  return (
    <div className="space-y-2 text-xs" data-testid="step-detail-verify-log">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-semibold",
            verifyLog.intent_match
              ? "border-info/60 bg-info/10 text-info"
              : "border-warn/60 bg-warn/10 text-warn",
          )}
          data-testid="step-detail-intent-match"
          data-intent-match={verifyLog.intent_match ? "true" : "false"}
        >
          {verifyLog.intent_match
            ? t("roadmap.step_detail.intent_match_true")
            : t("roadmap.step_detail.intent_match_false")}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-semibold",
            verifyLog.test_result === "pass"
              ? "border-success/60 bg-success/10 text-success"
              : verifyLog.test_result === "fail"
                ? "border-danger/60 bg-danger/10 text-danger"
                : "border-warn/60 bg-warn/10 text-warn",
          )}
          data-testid="step-detail-test-result"
          data-test-result={verifyLog.test_result}
        >
          {t(`roadmap.step_detail.test_result.${verifyLog.test_result}`)}
        </span>
      </div>
      {verifyLog.test_result === "skipped" ? (
        <p className="text-[10px] text-fg-muted" data-testid="step-detail-unverified-note">
          {t("roadmap.step_detail.unverified_note")}
        </p>
      ) : null}
      {verifyLog.test_command ? (
        <p className="break-all font-mono text-[11px] text-fg">{verifyLog.test_command}</p>
      ) : null}
      {verifyLog.details ? (
        <p className="whitespace-pre-wrap text-[11px] text-fg-muted">{verifyLog.details}</p>
      ) : null}
    </div>
  );
}

export default StepDetailSlideIn;
