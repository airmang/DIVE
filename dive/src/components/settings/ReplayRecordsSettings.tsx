import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { useT } from "../../i18n";
import { loadTauri } from "../../lib/tauri";

/** Mirrors `ReplaySettingsDto` in `src-tauri/src/ipc/replay.rs`. */
export interface ReplaySettings {
  captureEnabled: boolean;
  recordCount: number;
}

/**
 * Spec 015 FR-021 / D-015-02 — the local replay corpus switch (default ON)
 * and a clear button. The backend owns the preference because it decides
 * whether to capture; this control only reads and writes it. Hidden outside
 * the desktop app, where there is no local corpus.
 */
export function ReplayRecordsSettings() {
  const t = useT();
  const [settings, setSettings] = useState<ReplaySettings | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const api = await loadTauri();
      if (!api) {
        if (!cancelled) setAvailable(false);
        return;
      }
      try {
        const next = await api.invoke<ReplaySettings>("replay_settings_get");
        if (!cancelled) setSettings(next);
      } catch (err) {
        console.warn("replay_settings_get failed:", err);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (command: string, args?: Record<string, unknown>) => {
    const api = await loadTauri();
    if (!api) return;
    setBusy(true);
    try {
      setSettings(await api.invoke<ReplaySettings>(command, args));
      setFailed(false);
    } catch (err) {
      console.warn(`${command} failed:`, err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const clearRecords = () => {
    if (!settings) return;
    if (!window.confirm(t("settings.replay_clear_confirm", { count: settings.recordCount }))) {
      return;
    }
    void run("replay_records_clear");
  };

  if (!available) return null;

  return (
    <details className="rounded-md border bg-bg-panel px-3 py-3" data-testid="settings-replay">
      <summary className="cursor-pointer text-sm font-semibold text-fg">
        {t("settings.replay_title")}
      </summary>
      <p className="mt-2 text-xs text-fg-muted">{t("settings.replay_description")}</p>
      {failed ? (
        <p className="mt-2 text-xs text-warn" data-testid="settings-replay-error">
          {t("settings.replay_load_failed")}
        </p>
      ) : null}
      {settings ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-bg px-3 py-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={settings.captureEnabled}
              disabled={busy}
              onChange={(e) =>
                void run("replay_settings_set", { captureEnabled: e.target.checked })
              }
              data-testid="settings-replay-capture-toggle"
            />
            {t("settings.replay_capture_label")}
          </label>
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-muted" data-testid="settings-replay-count">
              {t("settings.replay_count", { count: settings.recordCount })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || settings.recordCount === 0}
              onClick={clearRecords}
              data-testid="settings-replay-clear"
            >
              {t("settings.replay_clear")}
            </Button>
          </div>
        </div>
      ) : null}
    </details>
  );
}

export default ReplayRecordsSettings;
