import { useMemo, useState } from "react";
import { AlertTriangle, History, LifeBuoy, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";

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

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "Unknown time";
  return new Date(ms).toLocaleString();
}

function checkpointTitle(item: RecoveryCheckpointItem): string {
  return item.label?.trim() || `${item.kind} checkpoint ${item.id}`;
}

function changedFilesCopy(files: string[]): string {
  if (files.length === 0) return "File details unavailable";
  const shown = files.slice(0, 2).join(", ");
  return files.length > 2 ? `${shown} and ${files.length - 2} more` : shown;
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
  const [confirmRestoreId, setConfirmRestoreId] = useState<number | null>(null);
  const sorted = useMemo(
    () => [...checkpoints].sort((a, b) => b.createdAt - a.createdAt),
    [checkpoints],
  );
  const latest = sorted[0] ?? null;
  const visible = sorted.slice(0, 3);
  const undoAvailable = sessionAvailable && sorted.length > 0;

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
            <h2 className="text-sm font-bold text-fg">Recovery & Undo</h2>
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            Save a safe point or undo to an earlier checkpoint if a step goes wrong.
          </p>
        </div>
        <Badge variant={undoAvailable ? "success" : "outline"}>
          {undoAvailable ? "Undo available" : "No undo yet"}
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
              <p className="font-semibold text-fg">This step needs recovery</p>
              <p className="mt-0.5 text-fg-muted">{failedStep.stepTitle}</p>
              <p className="mt-1 line-clamp-3 text-danger">{failedStep.reason}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={failedStep.onExplainError}>
              Explain error
            </Button>
            <Button size="sm" variant="outline" onClick={failedStep.onRetry}>
              Retry
            </Button>
            <Button size="sm" variant="outline" onClick={failedStep.onAdjustPlan}>
              Adjust plan
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!undoAvailable}
              onClick={() => latest && setConfirmRestoreId(latest.id)}
              data-testid="failed-step-undo"
            >
              Undo
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 rounded-lg border bg-bg/70 p-3 text-xs" data-testid="last-change-card">
        <div className="flex items-center gap-2 font-semibold text-fg">
          <History className="h-4 w-4 text-fg-muted" aria-hidden />
          Last change
        </div>
        {latest ? (
          <div className="mt-2 space-y-1 text-fg-muted">
            <p className="font-medium text-fg">{checkpointTitle(latest)}</p>
            <p>{formatTime(latest.createdAt)}</p>
            <p>{changedFilesCopy(latest.changedFiles)}</p>
          </div>
        ) : (
          <p className="mt-2 text-fg-muted">
            {sessionAvailable
              ? "No checkpoints found yet. Save a recovery point before risky work."
              : "Open a project session to enable recovery."}
          </p>
        )}
      </div>

      {error ? (
        <div
          className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn"
          data-testid="recovery-error"
        >
          Recovery is unavailable right now: <span className="text-fg">{error}</span>
        </div>
      ) : null}

      {confirmTarget ? (
        <div
          className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs"
          data-testid="restore-confirm-inline"
        >
          <p className="font-semibold text-danger">Restore this checkpoint?</p>
          <p className="mt-1 text-fg-muted">
            DIVE will ask the backend to restore {checkpointTitle(confirmTarget)}. The checkpoint
            system creates a pre-restore backup first, but files in your project will change.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmRestoreId(null)}>
              Cancel
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
              {restoringCheckpointId === confirmTarget.id ? "Restoring..." : "Restore checkpoint"}
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
          Save recovery point
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!sessionAvailable || loading}
          onClick={onRefresh}
          data-testid="recovery-refresh"
        >
          <RotateCcw className={cn(loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {visible.length > 0 ? (
        <ol className="mt-3 space-y-2" data-testid="recovery-checkpoint-list">
          {visible.map((item) => (
            <li key={item.id} className="rounded-md border bg-bg px-3 py-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{checkpointTitle(item)}</p>
                  <p className="mt-0.5 text-fg-muted">{formatTime(item.createdAt)}</p>
                  <p className="mt-0.5 truncate text-fg-subtle">
                    {changedFilesCopy(item.changedFiles)}
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
                  Undo
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
