import { useEffect, useMemo, useState } from "react";
import { useToast } from "../toast/toast-context";
import { useProjectSessionStore } from "../../stores/project-session";
import { loadTauri } from "../../lib/tauri";
import { useT } from "../../i18n";
import { fallbackModels, type ModelInfo } from "./providerModels";

interface Props {
  providerId: number;
  providerKind: string;
  selectedModel?: string | null;
  onModelSaved?: () => void | Promise<void>;
}

export function ProviderModelSelector({
  providerId,
  providerKind,
  selectedModel,
  onModelSaved,
}: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState(selectedModel ?? "");
  const [filter, setFilter] = useState("");
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

  // The live catalog (e.g. OpenRouter) can be long; show a search box past a
  // small threshold so beginners are not faced with a wall of options.
  const showFilter = options.length > 8;

  const visibleOptions = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return options;
    return options.filter(
      (model) =>
        model.id.toLowerCase().includes(query) || model.display_name.toLowerCase().includes(query),
    );
  }, [options, filter]);

  // Keep the currently-selected model rendered even when it is filtered out, so
  // the native <select> never shows a blank value.
  const renderedOptions = useMemo(() => {
    if (!selected || visibleOptions.some((model) => model.id === selected)) {
      return visibleOptions;
    }
    const current = options.find((model) => model.id === selected);
    return current ? [current, ...visibleOptions] : visibleOptions;
  }, [visibleOptions, options, selected]);

  // S-051 D2 point 1: when the backend has annotated the catalog against the
  // pinned pi-ai registry, group executable models ahead of the rest and
  // mark the ones the sidecar can't run. `pi_executable` is only ever
  // uniformly `null`/`undefined` (no annotation available — e.g. the
  // provider has no confirmed Pi mapping, or the registry hasn't answered)
  // or a real boolean per model; either way this must never hide options or
  // change behavior when nothing is annotated (fail open).
  const hasExecutableData = useMemo(
    () => options.some((model) => typeof model.pi_executable === "boolean"),
    [options],
  );
  const recommendedOptions = useMemo(
    () =>
      hasExecutableData ? renderedOptions.filter((model) => model.pi_executable === true) : [],
    [renderedOptions, hasExecutableData],
  );
  const otherOptions = useMemo(
    () =>
      hasExecutableData
        ? renderedOptions.filter((model) => model.pi_executable !== true)
        : renderedOptions,
    [renderedOptions, hasExecutableData],
  );
  const selectedModelInfo = useMemo(
    () => options.find((model) => model.id === selected),
    [options, selected],
  );
  const showUnsupportedHint = hasExecutableData && selectedModelInfo?.pi_executable === false;

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
      <div className="min-w-0">
        {showFilter ? (
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("settings.model_filter_placeholder")}
            aria-label={t("settings.model_filter_placeholder")}
            className="mb-1 w-full min-w-0 rounded-md border bg-bg px-2 py-1 text-xs"
            data-testid="provider-model-filter"
          />
        ) : null}
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
          {hasExecutableData ? (
            <>
              {recommendedOptions.length > 0 ? (
                <optgroup label={t("settings.model_group_pi_verified")}>
                  {recommendedOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.display_name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {otherOptions.length > 0 ? (
                <optgroup label={t("settings.model_group_other")}>
                  {otherOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.pi_executable === false
                        ? `${model.display_name} ${t("settings.model_pi_unsupported_marker")}`
                        : model.display_name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </>
          ) : (
            renderedOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.display_name}
              </option>
            ))
          )}
        </select>
        {showFilter && visibleOptions.length === 0 ? (
          <p className="mt-1 text-[10px] text-fg-muted">{t("settings.model_filter_no_match")}</p>
        ) : null}
        {showUnsupportedHint ? (
          <p className="mt-1 text-[10px] text-warn" data-testid="provider-model-unsupported-hint">
            {recommendedOptions[0]
              ? t("settings.model_pi_unsupported_hint", {
                  model: recommendedOptions[0].display_name,
                })
              : t("settings.model_pi_unsupported_hint_generic")}
          </p>
        ) : null}
      </div>
      {saving ? (
        <span className="col-start-2 text-[10px] text-fg-muted">{t("settings.model_saving")}</span>
      ) : null}
    </div>
  );
}

export default ProviderModelSelector;
