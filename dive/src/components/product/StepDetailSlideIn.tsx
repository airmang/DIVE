import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Circle, Clock3, ExternalLink, FileCode, X } from "lucide-react";
import { Button } from "../ui/button";
import { LearningHint } from "../ui/learning-hint";
import { cn } from "../../lib/utils";
import {
  agencyToneClass,
  deriveAgencyStateView,
  type AgencyStateItem,
  type RoadmapStep,
  type RoadmapStepStatus,
} from "../../features/roadmap";
import type { ChangedFile } from "../slide-in/types";
import type { ApprovalDecision } from "../workmap/ApprovalJudgment";
import type { VerifyLogView } from "../workmap/types";
import { useT } from "../../i18n";
import { useChatComposerStore } from "../../stores/chatComposer";
import { DecisionGate } from "./DecisionGate";
import {
  ProvocationCardHost,
  deriveVerificationStatuses,
  generateProvocationCards,
  normalizeChangedFile,
  type ProvocationCard,
  type ProvocationContext,
  type ScaffoldMode,
  type VerificationStatusItem,
  useProvocationActionResolver,
} from "../../features/provocation";

export interface StepDetailSlideInProps {
  open: boolean;
  step: RoadmapStep | null;
  toolCallCount: number;
  verifyLog: VerifyLogView | null;
  verifyState: "idle" | "running" | "error";
  verifyError: string | null;
  changedFiles: ChangedFile[];
  planContext?: {
    expectedFiles: string[];
    verificationCommand?: string | null;
    verificationManualCheck?: string | null;
    verificationKind?: string | null;
    dependencies?: string[];
    parallelGroup?: string | null;
    purpose?: string | null;
  };
  onOpenChange: (open: boolean) => void;
  onOpenCode: () => void;
  onOpenPreview?: () => void;
  onOpenRecovery: () => void;
  onVerifyFirst: () => void;
  onApprovalDecision: (decision: ApprovalDecision) => void;
  onGoToChat: () => void;
  rollbackAvailable: boolean;
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

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function metadataStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function highRiskFilesFromCards(cards: ProvocationCard[]): string[] {
  return uniqueStrings(
    cards
      .filter((card) => card.type === "diff_scope_drift" && card.severity === "risk")
      .flatMap((card) => metadataStringArray(card.metadata?.highRiskFiles)),
  );
}

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
  planContext,
  onOpenChange,
  onOpenCode,
  onOpenPreview,
  onOpenRecovery,
  onVerifyFirst,
  onApprovalDecision,
  onGoToChat,
  rollbackAvailable,
  provocation,
}: StepDetailSlideInProps) {
  const t = useT();
  const pushComposerSeed = useChatComposerStore((s) => s.pushSeed);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [diffViewedStepIds, setDiffViewedStepIds] = useState<Set<number>>(() => new Set());
  const [criterionConfirmed, setCriterionConfirmed] = useState(false);
  const [previewObservedStepIds, setPreviewObservedStepIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [appLaunchedStepIds, setAppLaunchedStepIds] = useState<Set<number>>(() => new Set());

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

  useEffect(() => {
    setCriterionConfirmed(false);
  }, [step?.id]);

  const status = step?.status ?? null;
  const isReview = status === "review";
  const hasChangedFiles = changedFiles.length > 0;
  const diffViewed = step ? diffViewedStepIds.has(step.id) : false;
  const previewObserved = step ? previewObservedStepIds.has(step.id) : false;
  const appLaunched = step ? appLaunchedStepIds.has(step.id) : false;
  const expectedFiles = useMemo(
    () => uniqueStrings(planContext?.expectedFiles ?? []),
    [planContext?.expectedFiles],
  );
  const actualChangedFiles = useMemo(
    () => uniqueStrings(changedFiles.map((file) => file.path)),
    [changedFiles],
  );
  const verificationPlanText =
    planContext?.verificationCommand?.trim() ||
    planContext?.verificationManualCheck?.trim() ||
    planContext?.verificationKind?.trim() ||
    null;
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
              text: [
                step.title,
                step.description,
                step.assistSummary,
                step.testCommand,
                planContext?.purpose,
                verificationPlanText,
              ]
                .filter(Boolean)
                .join(" "),
              expectedFiles,
              verificationCommand: planContext?.verificationCommand ?? step.testCommand,
              verificationManualCheck: planContext?.verificationManualCheck ?? null,
              kind: planContext?.verificationKind ?? undefined,
              dependencies: planContext?.dependencies ?? [],
              parallelGroup: planContext?.parallelGroup ?? null,
            },
          ],
          changedFiles: changedFiles.map((file) => normalizeChangedFile({ path: file.path })),
          targetFiles: expectedFiles,
          approvalProvenance: step.approvalProvenance,
          verification: {
            aiClaimedDone: Boolean(verifyLog?.intent_match),
            diffReviewed: diffViewed,
            appLaunched,
            previewChecked: previewObserved,
            automatedTestsPassed: verifyLog?.test_result === "pass",
            testResult: verifyLog?.test_result,
            externalTestRun: verifyLog ? verifyLog.test_result !== "skipped" : undefined,
            failedButAccepted: step.approvalProvenance?.verificationState === "failed_but_accepted",
            approvedWithRisk: Boolean(step.approvalProvenance?.riskAccepted),
            approvalProvenance: step.approvalProvenance,
          },
          userHasViewedDiff: diffViewed,
          userHasViewedPreview: previewObserved,
        }
      : null;
  const provocationCards = provocationContext ? generateProvocationCards(provocationContext) : [];
  const unexpectedHighRiskFiles = highRiskFilesFromCards(provocationCards);
  const verificationStatuses = provocationContext
    ? deriveVerificationStatuses(provocationContext)
    : [];
  const agencyState = step
    ? deriveAgencyStateView({
        goalText: [step.title, step.description].filter(Boolean).join("\n"),
        acceptanceCriteria: step.acceptanceCriteria,
        status,
        changedFiles,
        diffViewed,
        verifyLog,
        approvalProvenance: step.approvalProvenance,
        running: verifyState === "running",
        acceptanceCriterionConfirmed: criterionConfirmed,
      })
    : null;

  const handleOpenCode = () => {
    if (step) {
      setDiffViewedStepIds((current) => {
        if (current.has(step.id)) return current;
        const next = new Set(current);
        next.add(step.id);
        return next;
      });
    }
    onOpenCode();
  };

  const handleOpenPreview = () => {
    if (step) {
      setPreviewObservedStepIds((current) => new Set(current).add(step.id));
    }
    onOpenPreview?.();
  };

  const handleRunApp = () => {
    if (step) {
      setAppLaunchedStepIds((current) => new Set(current).add(step.id));
    }
    onOpenPreview?.();
  };

  const handleProvocationAction = useProvocationActionResolver({
    pushComposerSeed,
    onGoToChat,
    onOpenDiff: handleOpenCode,
    onOpenPreview: handleOpenPreview,
    onRunApp: handleRunApp,
    onRunTests: onVerifyFirst,
    onOpenRecovery,
    onContinueWithRisk: (reason) =>
      onApprovalDecision({
        outcome: "approved_with_concern",
        note: reason?.trim() || null,
      }),
  });

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

          {agencyState && agencyState.items.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5" data-testid="step-detail-agency-states">
              {agencyState.items.map((item) => (
                <AgencyStateChip key={item.id} item={item} />
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
              <DecisionGate
                verificationStatuses={verificationStatuses}
                agencyState={agencyState}
                provocationCards={provocationCards}
                verifyLog={verifyLog}
                rollbackAvailable={rollbackAvailable}
                acceptanceCriterionConfirmed={criterionConfirmed}
                verifyRunning={verifyState === "running"}
                onApprove={() => onApprovalDecision({ outcome: "approved", note: null })}
                onAcceptRisk={(reason) =>
                  onApprovalDecision({ outcome: "approved_with_concern", note: reason })
                }
                onRequestChanges={() =>
                  onApprovalDecision({ outcome: "revision_requested", note: null })
                }
                onVerifyFirst={onVerifyFirst}
                onRevert={onOpenRecovery}
                onStop={(note) => onApprovalDecision({ outcome: "revision_requested", note })}
              />
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
                onClick={handleOpenCode}
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

          {expectedFiles.length > 0 ||
          actualChangedFiles.length > 0 ||
          verificationStatuses.length > 0 ||
          isReview ? (
            <Section title={t("roadmap.step_detail.section_change_bundle")}>
              <ChangeEvidenceBundle
                expectedFiles={expectedFiles}
                actualChangedFiles={actualChangedFiles}
                unexpectedHighRiskFiles={unexpectedHighRiskFiles}
                verificationStatuses={verificationStatuses}
                rollbackAvailable={rollbackAvailable}
                diffViewed={diffViewed}
                verificationPlanText={verificationPlanText}
              />
            </Section>
          ) : null}

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
              <label
                className="mt-3 flex items-start gap-2 rounded-sm border border-border bg-bg/60 px-2 py-2 text-xs text-fg"
                data-testid="step-detail-criterion-confirm"
              >
                <input
                  type="checkbox"
                  checked={criterionConfirmed}
                  onChange={(event) => setCriterionConfirmed(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="step-detail-criterion-confirm-checkbox"
                />
                <span className="min-w-0">
                  <span className="block font-medium">
                    {t("roadmap.step_detail.criterion_confirm_label")}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-fg-muted">
                    {t("roadmap.step_detail.criterion_confirm_hint")}
                  </span>
                </span>
              </label>
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

function AgencyStateChip({ item }: { item: AgencyStateItem }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-semibold",
        agencyToneClass(item.tone),
      )}
      data-testid="agency-state-chip"
      data-agency-state={item.id}
      data-agency-component={item.component}
      data-evidence-backed={item.evidenceBacked ? "true" : "false"}
    >
      {item.label}
    </span>
  );
}

function ChangeEvidenceBundle({
  expectedFiles,
  actualChangedFiles,
  unexpectedHighRiskFiles,
  verificationStatuses,
  rollbackAvailable,
  diffViewed,
  verificationPlanText,
}: {
  expectedFiles: string[];
  actualChangedFiles: string[];
  unexpectedHighRiskFiles: string[];
  verificationStatuses: VerificationStatusItem[];
  rollbackAvailable: boolean;
  diffViewed: boolean;
  verificationPlanText: string | null;
}) {
  const t = useT();
  return (
    <div className="space-y-3 text-xs" data-testid="step-detail-change-bundle">
      <div className="grid gap-2 sm:grid-cols-2">
        <BundleList
          testId="step-detail-expected-files"
          title={t("roadmap.step_detail.bundle_expected_files")}
          items={expectedFiles}
          empty={t("roadmap.step_detail.bundle_none")}
        />
        <BundleList
          testId="step-detail-actual-files"
          title={t("roadmap.step_detail.bundle_actual_files")}
          items={actualChangedFiles}
          empty={t("roadmap.step_detail.bundle_none")}
        />
      </div>
      <div
        className={cn(
          "rounded-sm border px-2 py-2",
          unexpectedHighRiskFiles.length > 0
            ? "border-danger/50 bg-danger/5 text-danger"
            : "border-border bg-bg/60 text-fg-muted",
        )}
        data-testid="step-detail-unexpected-high-risk-files"
        data-count={unexpectedHighRiskFiles.length}
      >
        <p className="font-semibold text-fg">
          {t("roadmap.step_detail.bundle_unexpected_high_risk")}
        </p>
        <p className="mt-1 break-words font-mono">
          {unexpectedHighRiskFiles.length > 0
            ? compactBundleItems(unexpectedHighRiskFiles)
            : t("roadmap.step_detail.bundle_none")}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-sm border bg-bg/60 px-2 py-2" data-testid="step-detail-diff-viewed">
          <p className="font-semibold text-fg">{t("roadmap.step_detail.bundle_diff_review")}</p>
          <p className="mt-1 text-fg-muted">
            {diffViewed
              ? t("roadmap.step_detail.bundle_diff_reviewed")
              : t("roadmap.step_detail.bundle_diff_not_reviewed")}
          </p>
        </div>
        <div
          className="rounded-sm border bg-bg/60 px-2 py-2"
          data-testid="step-detail-rollback-availability"
        >
          <p className="font-semibold text-fg">{t("roadmap.step_detail.bundle_rollback")}</p>
          <p className="mt-1 text-fg-muted">
            {rollbackAvailable
              ? t("roadmap.step_detail.bundle_rollback_available")
              : t("roadmap.step_detail.bundle_rollback_unavailable")}
          </p>
        </div>
      </div>
      <div className="rounded-sm border bg-bg/60 px-2 py-2">
        <p className="font-semibold text-fg">{t("roadmap.step_detail.bundle_verification")}</p>
        {verificationPlanText ? (
          <p className="mt-1 break-words font-mono text-[11px] text-fg-muted">
            {verificationPlanText}
          </p>
        ) : null}
        {verificationStatuses.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {verificationStatuses.map((item) => (
              <VerificationStatusChip key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <p className="mt-1 text-fg-muted">
            {t("roadmap.step_detail.bundle_verification_missing")}
          </p>
        )}
      </div>
    </div>
  );
}

function BundleList({
  title,
  items,
  empty,
  testId,
}: {
  title: string;
  items: string[];
  empty: string;
  testId: string;
}) {
  return (
    <div className="rounded-sm border bg-bg/60 px-2 py-2" data-testid={testId}>
      <p className="font-semibold text-fg">{title}</p>
      <p className="mt-1 break-words font-mono text-fg-muted">
        {items.length > 0 ? compactBundleItems(items) : empty}
      </p>
    </div>
  );
}

function compactBundleItems(items: string[]): string {
  if (items.length <= 4) return items.join(", ");
  return `${items.slice(0, 4).join(", ")} +${items.length - 4}`;
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
