import { useEffect, useMemo, useState } from "react";
import { useToast } from "../toast/toast-context";
import { useProjectSessionStore } from "../../stores/project-session";
import { useT } from "../../i18n";
import { fallbackModels, type ModelInfo } from "./providerModels";

interface Props {
  providerId: number;
  providerKind: string;
  selectedModel?: string | null;
  onModelSaved?: () => void | Promise<void>;
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

export function ProviderModelSelector({
  providerId,
  providerKind,
  selectedModel,
  onModelSaved,
}: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState(selectedModel ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const loadAll = useProjectSessionStore((s) => s.loadAll);
  const { toast } = useToast();
  const t = useT();

  useEffect(() => {
    setSelected(selectedModel ?? "");
  }, [selectedModel]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const api = await loadTauri();
        const list = api
          ? await api.invoke<ModelInfo[]>("provider_list_models", { providerId })
          : fallbackModels(providerKind);
        if (!cancelled) setModels(list.length > 0 ? list : fallbackModels(providerKind));
      } catch (err) {
        console.warn("provider_list_models failed:", err);
        if (!cancelled) setModels(fallbackModels(providerKind));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providerId, providerKind]);

  const options = useMemo(() => {
    return models;
  }, [models]);

  useEffect(() => {
    if (options.length === 0) return;
    if (selected && options.some((model) => model.id === selected)) return;
    setSelected(options[0]?.id ?? "");
  }, [options, selected]);

  const handleChange = async (modelId: string) => {
    setSelected(modelId);
    setSaving(true);
    try {
      const api = await loadTauri();
      if (api) await api.invoke<void>("provider_set_model", { providerId, modelId });
      await loadAll();
      await onModelSaved?.();
      toast({
        variant: "success",
        title: t("settings.model_saved_title"),
        description: t("settings.model_saved_description"),
      });
    } catch (err) {
      toast({
        variant: "error",
        title: t("settings.model_save_failed_title"),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-xs text-fg-muted">{t("settings.model_loading")}</div>;
  if (options.length === 0)
    return <div className="text-xs text-fg-muted">{t("settings.model_empty")}</div>;

  return (
    <div
      className="grid grid-cols-[minmax(3.5rem,auto)_minmax(0,1fr)] items-center gap-2"
      data-testid="provider-model-selector"
    >
      <label
        className="min-w-0 text-xs text-fg-muted"
        htmlFor={`model-${providerKind}-${providerId}`}
      >
        {t("settings.model_label")}
      </label>
      <select
        id={`model-${providerKind}-${providerId}`}
        value={selected}
        onChange={(e) => void handleChange(e.target.value)}
        disabled={saving}
        aria-label={t("settings.model_select_aria")}
        className="w-full min-w-0 rounded-md border bg-bg px-2 py-1 text-sm"
        data-testid="provider-model-select"
        data-provider-kind={providerKind}
      >
        {options.map((model) => (
          <option key={model.id} value={model.id}>
            {model.display_name}
          </option>
        ))}
      </select>
      {saving ? (
        <span className="col-start-2 text-[10px] text-fg-muted">{t("settings.model_saving")}</span>
      ) : null}
    </div>
  );
}

export default ProviderModelSelector;
