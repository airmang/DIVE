import { useMemo, useState } from "react";
import { AlertTriangle, History, LifeBuoy, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import { useLocale, useT } from "../../i18n";

export interface RecoveryCheckpointItem {
  id: number;
  label: string | null;
  kind: string;
  createdAt: number;
  changedFiles: string[];
}

export interface FailedStepRecovery {
  stepTitle: string;
  reason: string;
  onExplainError: () => void;
  onRetry: () => void;
  onAdjustPlan: () => void;
}

export interface RecoveryPanelProps {
  sessionAvailable: boolean;
  checkpoints: RecoveryCheckpointItem[];
  loading: boolean;
  error: string | null;
  restoringCheckpointId: number | null;
  failedStep: FailedStepRecovery | null;
  onRefresh: () => void;
  onCreateCheckpoint: () => void;
  onRestoreCheckpoint: (checkpointId: number) => void;
}

function formatTime(ms: number, locale: string): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleString(locale);
}

function localizedCheckpointKind(kind: string, t: ReturnType<typeof useT>): string {
  switch (kind) {
    case "init":
      return t("slide_in.checkpoint.kind_init");
    case "auto":
      return t("slide_in.checkpoint.kind_auto");
    case "manual":
      return t("slide_in.checkpoint.kind_manual");
    case "auto-pre-restore":
      return t("slide_in.checkpoint.kind_pre_restore");
    case "auto-pre-edit":
      return t("slide_in.checkpoint.kind_pre_edit");
    default:
      return t("slide_in.checkpoint.kind_other", { kind });
  }
}

function checkpointTitle(item: RecoveryCheckpointItem, t: ReturnType<typeof useT>): string {
  return (
    item.label?.trim() ||
    t("recovery.checkpoint_title", { kind: localizedCheckpointKind(item.kind, t), id: item.id })
  );
}

function changedFilesCopy(files: string[], t: ReturnType<typeof useT>): string {
  if (files.length === 0) return t("recovery.file_details_unavailable");
  const shown = files.slice(0, 2).join(", ");
  return files.length > 2
    ? t("recovery.changed_files_more", { files: shown, count: files.length - 2 })
    : shown;
}

export function RecoveryPanel({
  sessionAvailable,
  checkpoints,
  loading,
  error,
  restoringCheckpointId,
  failedStep,
  onRefresh,
  onCreateCheckpoint,
  onRestoreCheckpoint,
}: RecoveryPanelProps) {
  const t = useT();
  const locale = useLocale();
  const [confirmRestoreId, setConfirmRestoreId] = useState<number | null>(null);
  const sorted = useMemo(
    () => [...checkpoints].sort((a, b) => b.createdAt - a.createdAt),
    [checkpoints],
  );
  const latest = sorted[0] ?? null;
  const visible = sorted.slice(0, 3);
  const undoAvailable = sessionAvailable && sorted.length > 0;
  // S-032: the most recent pre-edit anchor is the "before your last edit"
  // restore point — mark it so a user recovering from a failure can identify it.
  const latestPreEditAnchorId = useMemo(
    () => sorted.find((item) => item.kind === "auto-pre-edit")?.id ?? null,
    [sorted],
  );

  const confirmTarget = sorted.find((item) => item.id === confirmRestoreId) ?? null;

  return (
    <section
      className="shrink-0 border-b bg-bg-panel px-4 py-4"
      data-testid="recovery-panel"
      data-undo-available={undoAvailable ? "true" : "false"}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 text-accent" aria-hidden />
            <h2 className="text-sm font-bold text-fg">{t("recovery.title")}</h2>
          </div>
          <p className="mt-1 text-xs text-fg-muted">{t("recovery.description")}</p>
        </div>
        <Badge variant={undoAvailable ? "success" : "outline"}>
          {undoAvailable ? t("recovery.undo_available") : t("recovery.no_undo_yet")}
        </Badge>
      </div>

      {failedStep ? (
        <div
          className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs"
          data-testid="failed-step-recovery"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-fg">{t("recovery.failed_title")}</p>
              <p className="mt-0.5 text-fg-muted">{failedStep.stepTitle}</p>
              <p className="mt-1 line-clamp-3 text-danger">{failedStep.reason}</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2" data-testid="failed-step-actions">
            <Button
              size="sm"
              variant={undoAvailable ? "danger" : "outline"}
              disabled={!undoAvailable}
              onClick={() => latest && setConfirmRestoreId(latest.id)}
              data-testid="failed-step-undo"
            >
              {undoAvailable ? t("recovery.undo_last_change") : t("recovery.rollback_unavailable")}
            </Button>
            <Button size="sm" variant="outline" onClick={failedStep.onExplainError}>
              {t("recovery.explain_error")}
            </Button>
            <Button size="sm" variant="outline" onClick={failedStep.onAdjustPlan}>
              {t("recovery.adjust_plan")}
            </Button>
            <Button size="sm" variant="outline" onClick={failedStep.onRetry}>
              {t("recovery.retry_ai")}
            </Button>
          </div>
          {!undoAvailable ? (
            <p className="mt-2 text-[11px] text-fg-muted" data-testid="failed-step-no-undo">
              {t("recovery.rollback_unavailable_body")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 rounded-lg border bg-bg/70 p-3 text-xs" data-testid="last-change-card">
        <div className="flex items-center gap-2 font-semibold text-fg">
          <History className="h-4 w-4 text-fg-muted" aria-hidden />
          {t("recovery.last_change")}
        </div>
        {latest ? (
          <div className="mt-2 space-y-1 text-fg-muted">
            <p className="font-medium text-fg">{checkpointTitle(latest, t)}</p>
            <p>{formatTime(latest.createdAt, locale)}</p>
            <p>{changedFilesCopy(latest.changedFiles, t)}</p>
          </div>
        ) : (
          <p className="mt-2 text-fg-muted">
            {sessionAvailable ? t("recovery.no_checkpoints") : t("recovery.open_session")}
          </p>
        )}
      </div>

      {error ? (
        <div
          className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn"
          data-testid="recovery-error"
        >
          {t("recovery.unavailable")} <span className="text-fg">{error}</span>
        </div>
      ) : null}

      {confirmTarget ? (
        <div
          className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs"
          data-testid="restore-confirm-inline"
        >
          <p className="font-semibold text-danger">{t("recovery.restore_confirm_title")}</p>
          <p className="mt-1 text-fg-muted">
            {t("recovery.restore_confirm_body", { checkpoint: checkpointTitle(confirmTarget, t) })}
          </p>
          <p
            className="mt-2 rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-[11px] text-warn"
            data-testid="restore-files-only-note"
          >
            {t("recovery.restore_files_only_note")}
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmRestoreId(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={restoringCheckpointId === confirmTarget.id}
              onClick={() => {
                onRestoreCheckpoint(confirmTarget.id);
                setConfirmRestoreId(null);
              }}
              data-testid="restore-confirm-inline-action"
            >
              {restoringCheckpointId === confirmTarget.id
                ? t("recovery.restoring")
                : t("recovery.restore_checkpoint")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={!sessionAvailable}
          onClick={onCreateCheckpoint}
          data-testid="recovery-save-point"
        >
          <ShieldCheck />
          {t("recovery.save_point")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!sessionAvailable || loading}
          onClick={onRefresh}
          data-testid="recovery-refresh"
        >
          <RotateCcw className={cn(loading && "animate-spin")} />
          {t("recovery.refresh")}
        </Button>
      </div>

      {visible.length > 0 ? (
        <>
          <div
            className="mt-3 flex items-baseline justify-between text-[11px] text-fg-muted"
            data-testid="recovery-checkpoint-count"
          >
            <span className="font-semibold text-fg">
              {t("recovery.checkpoint_count", { count: sorted.length })}
            </span>
            {sorted.length > visible.length ? (
              <span>
                {t("recovery.checkpoint_count_showing_latest", { count: visible.length })}
              </span>
            ) : null}
          </div>
          <ol className="mt-2 space-y-2" data-testid="recovery-checkpoint-list">
            {visible.map((item) => (
              <li key={item.id} className="rounded-md border bg-bg px-3 py-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{checkpointTitle(item, t)}</p>
                    {item.id === latestPreEditAnchorId ? (
                      <Badge variant="warn" className="mt-1" data-testid="pre-edit-anchor-marker">
                        {t("recovery.pre_edit_anchor_marker")}
                      </Badge>
                    ) : null}
                    <p className="mt-0.5 text-fg-muted">{formatTime(item.createdAt, locale)}</p>
                    <p className="mt-0.5 truncate text-fg-subtle">
                      {changedFilesCopy(item.changedFiles, t)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={restoringCheckpointId === item.id}
                    onClick={() => setConfirmRestoreId(item.id)}
                    data-testid="recovery-restore"
                    data-checkpoint-id={item.id}
                  >
                    {t("recovery.undo")}
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}
