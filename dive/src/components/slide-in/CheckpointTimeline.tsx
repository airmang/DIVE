import { useEffect, useState } from "react";
import { useT } from "../../i18n";

export interface TimelineItem {
  id: number;
  session_id: number;
  card_id: number | null;
  git_sha: string;
  kind: string;
  label: string | null;
  created_at: number;
  file_changes?: number;
  changed_files?: string[];
  stats?: {
    added: number;
    removed: number;
    modified: number;
  };
}

interface Props {
  sessionId: number | null;
  currentCheckpointId?: number | null;
  onRestore?: (id: number) => void;
  mockItems?: TimelineItem[];
}

type TauriApi = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
};

async function loadTauri(): Promise<TauriApi | null> {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  if (!w?.__TAURI_INTERNALS__) return null;
  const core = await import("@tauri-apps/api/core");
  return { invoke: core.invoke as TauriApi["invoke"] };
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dotClassFor(kind: string, active: boolean): string {
  const base =
    "h-[26px] w-[26px] rounded-full border-2 flex-shrink-0 transition-shadow grid place-items-center text-[10px] font-bold leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
  if (active)
    return `${base} bg-accent border-accent shadow-[0_0_8px_var(--tw-shadow-color)] shadow-accent`;
  switch (kind) {
    case "init":
      return `${base} bg-transparent border-fg-muted`;
    case "auto":
      return `${base} bg-success border-success`;
    case "manual":
      return `${base} bg-accent border-accent`;
    default:
      return `${base} bg-bg-panel2 border-fg-muted`;
  }
}

function changedFileCount(item: TimelineItem): number {
  return item.file_changes ?? item.changed_files?.length ?? 0;
}

type T = ReturnType<typeof useT>;

function checkpointKindLabel(kind: string, t: T): string {
  switch (kind) {
    case "init":
      return t("slide_in.checkpoint.kind_init");
    case "auto":
      return t("slide_in.checkpoint.kind_auto");
    case "manual":
      return t("slide_in.checkpoint.kind_manual");
    case "auto-pre-restore":
      return t("slide_in.checkpoint.kind_pre_restore");
    default:
      return t("slide_in.checkpoint.kind_other", { kind });
  }
}

function checkpointKindGlyph(kind: string): string {
  switch (kind) {
    case "init":
      return "I";
    case "auto":
      return "A";
    case "manual":
      return "M";
    case "auto-pre-restore":
      return "R";
    default:
      return "C";
  }
}

function changedFilePreview(files: string[] | undefined, t: T): string {
  if (!files?.length) return t("slide_in.checkpoint.changed_files_empty");
  const shown = files.slice(0, 6);
  const suffix =
    files.length > shown.length
      ? t("slide_in.checkpoint.changed_files_more", { count: files.length - shown.length })
      : "";
  return `${shown.join(", ")}${suffix}`;
}

export function CheckpointTimeline({
  sessionId,
  currentCheckpointId = null,
  onRestore,
  mockItems,
}: Props) {
  const t = useT();
  const [items, setItems] = useState<TimelineItem[]>(mockItems ?? []);
  const [openCheckpointId, setOpenCheckpointId] = useState<number | null>(null);

  useEffect(() => {
    if (mockItems) {
      setItems(mockItems);
      return;
    }
    if (sessionId === null) {
      setItems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const api = await loadTauri();
      if (api) {
        try {
          const rows = await api.invoke<TimelineItem[]>("checkpoint_timeline", {
            sessionId,
          });
          if (!cancelled) setItems(rows);
          return;
        } catch (err) {
          console.warn("checkpoint_timeline failed:", err);
        }
      }
      if (!cancelled) setItems([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, mockItems]);

  if (sessionId === null || items.length === 0) {
    return (
      <div
        className="flex h-12 items-center justify-center px-4 text-[11px] text-fg-muted"
        data-testid="checkpoint-timeline"
        data-empty="true"
      >
        {t("slide_in.checkpoint.empty")}
      </div>
    );
  }

  return (
    <div
      className="relative flex h-16 w-full items-center gap-4 overflow-x-auto border-t bg-bg-panel px-4 py-2"
      data-testid="checkpoint-timeline"
      data-count={items.length}
    >
      <div
        className="pointer-events-none absolute left-4 right-4 top-1/2 h-px bg-border"
        aria-hidden
      />
      {items.map((item) => {
        const active = currentCheckpointId === item.id;
        const openThis = openCheckpointId === item.id;
        const fileCount = changedFileCount(item);
        const kindLabel = checkpointKindLabel(item.kind, t);
        const tooltipId = `checkpoint-tooltip-${item.id}`;
        return (
          <div
            key={item.id}
            className="relative z-10"
            onMouseEnter={() => setOpenCheckpointId(item.id)}
            onMouseLeave={() => setOpenCheckpointId(null)}
            onFocus={() => setOpenCheckpointId(item.id)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setOpenCheckpointId(null);
              }
            }}
          >
            <button
              type="button"
              className={dotClassFor(item.kind, active)}
              onClick={() => setOpenCheckpointId(item.id)}
              data-testid="timeline-dot"
              data-kind={item.kind}
              data-checkpoint-id={item.id}
              data-active={active ? "true" : "false"}
              aria-describedby={openThis ? tooltipId : undefined}
              aria-expanded={openThis}
              aria-label={t("slide_in.checkpoint.dot_aria", {
                label: item.label ?? item.git_sha.slice(0, 7),
                kind: kindLabel,
                current: active ? t("slide_in.checkpoint.current_suffix") : "",
              })}
            >
              <span aria-hidden>{checkpointKindGlyph(item.kind)}</span>
            </button>
            {openThis ? (
              <div
                id={tooltipId}
                className="absolute left-1/2 top-full z-20 mt-1 w-56 -translate-x-1/2 rounded-md border bg-bg-panel p-2 text-[11px] shadow-lg"
                data-testid="timeline-tooltip"
                role="tooltip"
              >
                <div className="font-medium text-fg">
                  {item.label ?? `${kindLabel} · ${item.git_sha.slice(0, 7)}`}
                </div>
                <div className="text-fg-muted">
                  {formatTime(item.created_at)} · {kindLabel}
                </div>
                <div className="mt-1 text-fg-muted" data-testid="timeline-file-changes">
                  {t("slide_in.checkpoint.file_changes", { count: fileCount })}
                  {item.stats
                    ? ` · +${item.stats.added} / ~${item.stats.modified} / -${item.stats.removed}`
                    : ""}
                </div>
                <div className="mt-0.5 break-words text-fg-subtle" data-testid="timeline-file-list">
                  {changedFilePreview(item.changed_files, t)}
                </div>
                {onRestore ? (
                  <button
                    type="button"
                    className="mt-1 w-full rounded bg-accent px-2 py-1 text-[10px] font-semibold text-fg hover:opacity-90"
                    onClick={() => onRestore(item.id)}
                    data-testid="timeline-restore"
                    data-checkpoint-id={item.id}
                  >
                    {t("slide_in.checkpoint.restore")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default CheckpointTimeline;
