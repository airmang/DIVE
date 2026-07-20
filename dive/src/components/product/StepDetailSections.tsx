import { Clock3, ExternalLink, FileCode } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";
import { agencyToneClass, type AgencyStateItem } from "../../features/roadmap";
import {
  VERIFICATION_STATUS_LABEL_KEY,
  type VerificationStatusItem,
} from "../../features/provocation";
import type { VerifyLogView } from "../workmap/types";

export type CriterionEvidenceRef = "preview" | "app" | null;

export type VerificationFocusActionKind =
  | "open_preview"
  | "run_app"
  | "run_tests"
  | "open_diff"
  | "go_chat";

export interface VerificationFocusAction {
  kind: VerificationFocusActionKind;
  label: string;
  ariaLabel: string;
  disabled?: boolean;
  onClick: () => void;
}

const VERIFY_STATUS_CLASS: Record<VerificationStatusItem["tone"], string> = {
  info: "border-info/50 bg-info/10 text-info",
  success: "border-success/60 bg-success/10 text-success",
  warn: "border-warn/60 bg-warn/10 text-warn",
  risk: "border-danger/60 bg-danger/10 text-danger",
};

function VerificationStatusChip({ item }: { item: VerificationStatusItem }) {
  const t = useT();
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
      {t(VERIFICATION_STATUS_LABEL_KEY[item.id])}
    </span>
  );
}

function AgencyStateChip({ item }: { item: AgencyStateItem }) {
  const t = useT();
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
      {t(item.labelKey)}
    </span>
  );
}

function verificationActionIcon(kind: VerificationFocusActionKind) {
  if (kind === "open_diff") return <FileCode aria-hidden />;
  if (kind === "run_tests") return <Clock3 aria-hidden />;
  return <ExternalLink aria-hidden />;
}

export function VerificationFocusPanel({
  criterionText,
  verificationPlanText,
  action,
  verificationStatuses,
  agencyItems,
}: {
  criterionText: string;
  verificationPlanText: string | null;
  action: VerificationFocusAction | null;
  verificationStatuses: VerificationStatusItem[];
  agencyItems: AgencyStateItem[];
}) {
  const t = useT();
  const verificationStatusIds = new Set<string>(verificationStatuses.map((item) => item.id));
  const dedupedAgencyItems = agencyItems.filter((item) => !verificationStatusIds.has(item.id));
  return (
    <section
      className="mt-4 border-b border-border/70 pb-4"
      data-testid="step-detail-verification-focus"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
            {t("roadmap.step_detail.verify_focus_title")}
          </div>
          <p
            className="mt-2 text-lg font-semibold leading-snug text-fg"
            data-testid="step-detail-criterion-focal"
          >
            {criterionText}
          </p>
          {verificationPlanText ? (
            <p
              className="mt-1 break-words font-mono text-[11px] text-fg-muted"
              data-testid="step-detail-feasible-method"
            >
              {verificationPlanText}
            </p>
          ) : null}
        </div>
        {action ? (
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="min-h-10 px-3 text-sm"
            disabled={action.disabled}
            onClick={action.onClick}
            aria-label={action.ariaLabel}
            data-testid="step-detail-primary-verification-action"
            data-action-kind={action.kind}
          >
            {verificationActionIcon(action.kind)}
            {action.label}
          </Button>
        ) : null}
      </div>

      {verificationStatuses.length > 0 || dedupedAgencyItems.length > 0 ? (
        <div
          className="mt-3 flex flex-wrap gap-1.5 text-fg-muted"
          data-testid="step-detail-evidence-chips"
        >
          {verificationStatuses.map((item) => (
            <VerificationStatusChip key={item.id} item={item} />
          ))}
          {dedupedAgencyItems.map((item) => (
            <AgencyStateChip key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function CriterionConfirmPanel({
  hasAcceptanceCriteria,
  criterionEvidenceRef,
  previewOpened,
  appOpened,
  onConfirmPreview,
  onConfirmApp,
}: {
  hasAcceptanceCriteria: boolean;
  criterionEvidenceRef: CriterionEvidenceRef;
  previewOpened: boolean;
  appOpened: boolean;
  onConfirmPreview: () => void;
  onConfirmApp: () => void;
}) {
  const t = useT();
  if (!hasAcceptanceCriteria) return null;

  return (
    <div
      className="border-t border-border/70 pt-3 text-xs text-fg"
      data-testid="step-detail-criterion-confirm"
    >
      <p className="font-medium">{t("roadmap.step_detail.criterion_confirm_label")}</p>
      <p className="mt-0.5 text-[11px] text-fg-muted">
        {t("roadmap.step_detail.criterion_confirm_hint")}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant={criterionEvidenceRef === "preview" ? "primary" : "outline"}
          size="sm"
          disabled={!previewOpened}
          onClick={onConfirmPreview}
          aria-label={t("roadmap.step_detail.criterion_confirm_preview")}
          data-testid="step-detail-confirm-preview"
        >
          {t("roadmap.step_detail.criterion_confirm_preview")}
        </Button>
        <Button
          type="button"
          variant={criterionEvidenceRef === "app" ? "primary" : "outline"}
          size="sm"
          disabled={!appOpened}
          onClick={onConfirmApp}
          aria-label={t("roadmap.step_detail.criterion_confirm_app")}
          data-testid="step-detail-confirm-app"
        >
          {t("roadmap.step_detail.criterion_confirm_app")}
        </Button>
      </div>
      {criterionEvidenceRef ? (
        <p
          className="mt-2 text-[11px] font-medium text-success"
          data-testid="step-detail-criterion-evidence-ref"
        >
          {criterionEvidenceRef === "preview"
            ? t("roadmap.step_detail.criterion_confirm_preview_selected")
            : t("roadmap.step_detail.criterion_confirm_app_selected")}
        </p>
      ) : null}
    </div>
  );
}

export function ChangeEvidenceBundle({
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

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 border-t border-border/70 pt-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-muted">
        {title}
      </div>
      <div className="mt-1">{children}</div>
    </section>
  );
}

interface VerificationBlockProps {
  verifyLog: VerifyLogView | null;
  verifyState: "idle" | "running" | "error";
  verifyError: string | null;
}

export function VerificationBlock({ verifyLog, verifyState, verifyError }: VerificationBlockProps) {
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
