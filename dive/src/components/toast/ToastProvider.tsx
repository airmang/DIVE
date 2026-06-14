import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, XCircle } from "lucide-react";
import { ToastContext, type Toast, type ToastVariant } from "./toast-context";
import { useT } from "../../i18n";

const MAX_TOASTS = 3;
const AUTO_DISMISS_MS = 5000;

function makeId() {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const t = useT();

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = makeId();
      setToasts((prev) => {
        const next = [...prev, { ...t, id }];
        return next.slice(Math.max(0, next.length - MAX_TOASTS));
      });
      const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const current = timers.current;
    return () => {
      current.forEach((t) => clearTimeout(t));
      current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2"
        data-testid="toast-stack"
        data-count={toasts.length}
        role="region"
        aria-label={t("common.notifications")}
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toastItem) => (
          <ToastCard
            key={toastItem.id}
            toast={toastItem}
            dismissLabel={t("common.dismiss_toast")}
            onDismiss={() => dismiss(toastItem.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({
  toast,
  dismissLabel,
  onDismiss,
}: {
  toast: Toast;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  const Icon = iconFor(toast.variant);
  return (
    <div
      role="status"
      className={`pointer-events-auto flex w-80 items-start gap-2 rounded-md border bg-bg-panel p-3 shadow-lg ${borderFor(toast.variant)}`}
      data-testid="toast"
      data-variant={toast.variant}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColorFor(toast.variant)}`} aria-hidden />
      <div className="flex-1">
        <div className="text-sm font-semibold text-fg">{toast.title}</div>
        {toast.description ? (
          <div className="mt-0.5 text-xs text-fg-muted">{toast.description}</div>
        ) : null}
        {toast.actionLabel && toast.onAction ? (
          <button
            type="button"
            onClick={() => {
              toast.onAction?.();
              onDismiss();
            }}
            data-testid="toast-action"
            className="mt-2 text-xs font-medium text-accent hover:underline"
          >
            {toast.actionLabel}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        data-testid="toast-dismiss"
        aria-label={dismissLabel}
        className="rounded p-0.5 text-fg-muted hover:bg-bg-panel2"
      >
        <XCircle className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function iconFor(v: ToastVariant) {
  if (v === "success") return CheckCircle2;
  if (v === "error") return XCircle;
  if (v === "warn") return AlertCircle;
  return Info;
}

function iconColorFor(v: ToastVariant): string {
  if (v === "success") return "text-success";
  if (v === "error") return "text-danger";
  if (v === "warn") return "text-warn";
  return "text-info";
}

function borderFor(v: ToastVariant): string {
  if (v === "success") return "border-success/40";
  if (v === "error") return "border-danger/40";
  if (v === "warn") return "border-warn/40";
  return "border-info/40";
}
