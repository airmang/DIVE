import { useEffect, useMemo, useState } from "react";
import { useToast } from "../toast/toast-context";
import { fallbackModels, type ModelInfo } from "../settings/providerModels";
import { useProjectSessionStore, type ProviderSummary } from "../../stores/project-session";
import { modelDisplayName, providerDisplayName } from "../../lib/provider-format";
import { useT } from "../../i18n";

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

function activeProvider(providers: ProviderSummary[]) {
  return (
    providers.find((provider) => provider.is_connected && provider.is_active) ??
    providers.find((provider) => provider.is_connected) ??
    null
  );
}

export function RuntimeModelSelector({
  busyLabel,
  fallbackLabel,
  disabled = false,
  onBusyChange,
}: {
  busyLabel?: string;
  fallbackLabel?: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const loaded = useProjectSessionStore((s) => s.loaded);
  const providers = useProjectSessionStore((s) => s.providers);
  const loadAll = useProjectSessionStore((s) => s.loadAll);
  const connectedProviders = useMemo(
    () => providers.filter((provider) => provider.is_connected),
    [providers],
  );
  const currentProvider = activeProvider(providers);
  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(
    currentProvider?.id ?? null,
  );
  const selectedProvider =
    connectedProviders.find((provider) => provider.id === selectedProviderId) ??
    currentProvider ??
    null;
  const selectedRuntimeProviderId = selectedProvider?.id ?? null;
  const selectedProviderKind = selectedProvider?.kind ?? null;
  const selectedProviderModel = selectedProvider?.selected_model ?? "";
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState(selectedProviderModel);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loaded) void loadAll().catch(() => undefined);
  }, [loadAll, loaded]);

  useEffect(() => {
    setSelectedProviderId(currentProvider?.id ?? null);
  }, [currentProvider?.id]);

  useEffect(() => {
    setSelectedModel(selectedProviderModel);
  }, [selectedProviderModel]);

  useEffect(() => {
    let cancelled = false;
    if (selectedRuntimeProviderId === null || !selectedProviderKind) {
      setModels([]);
      return;
    }
    void (async () => {
      setLoadingModels(true);
      try {
        const api = await loadTauri();
        const list = api
          ? await api.invoke<ModelInfo[]>("provider_list_models", {
              providerId: selectedRuntimeProviderId,
            })
          : fallbackModels(selectedProviderKind);
        if (!cancelled) {
          setModels(list.length > 0 ? list : fallbackModels(selectedProviderKind));
        }
      } catch (err) {
        console.warn("provider_list_models failed:", err);
        if (!cancelled) setModels(fallbackModels(selectedProviderKind));
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProviderKind, selectedRuntimeProviderId]);

  useEffect(() => {
    if (models.length === 0) return;
    if (selectedModel && models.some((model) => model.id === selectedModel)) return;
    setSelectedModel(models[0]?.id ?? "");
  }, [models, selectedModel]);

  const saveRuntime = async (provider: ProviderSummary, modelId?: string) => {
    setSaving(true);
    onBusyChange?.(true);
    try {
      const api = await loadTauri();
      if (api && modelId) {
        await api.invoke<void>("provider_set_model", {
          providerId: provider.id,
          modelId,
        });
      }
      if (api) {
        await api.invoke<void>("provider_select_runtime", {
          providerId: provider.id,
        });
      }
      await loadAll();
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
      onBusyChange?.(false);
    }
  };

  if (busyLabel) {
    return (
      <div
        className="rounded-md border bg-bg-panel px-2 py-1 text-xs text-fg-muted"
        aria-label={t("chat.input.model_select_aria")}
        data-testid="chat-model-label"
      >
        {busyLabel}
      </div>
    );
  }

  if (!selectedProvider || connectedProviders.length === 0) {
    return (
      <div
        className="rounded-md border bg-bg-panel px-2 py-1 text-xs text-fg-muted"
        aria-label={t("chat.input.model_select_aria")}
        data-testid="chat-model-label"
      >
        {fallbackLabel ?? t("chat.input.model_disconnected_label")}
      </div>
    );
  }

  const controlDisabled = disabled || saving;
  const modelOptions = models.length > 0 ? models : fallbackModels(selectedProvider.kind);

  return (
    <div className="flex min-w-0 items-center gap-1" data-testid="chat-runtime-selector">
      {connectedProviders.length > 1 ? (
        <select
          value={selectedProvider.id}
          disabled={controlDisabled}
          onChange={(event) => {
            const next = connectedProviders.find(
              (provider) => provider.id === Number(event.target.value),
            );
            if (!next) return;
            setSelectedProviderId(next.id);
            void saveRuntime(next);
          }}
          aria-label={t("onboarding.provider_label")}
          className="max-w-[8.5rem] rounded-md border bg-bg-panel px-2 py-1 text-xs text-fg"
          data-testid="chat-provider-select"
        >
          {connectedProviders.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {providerDisplayName(provider.kind)}
            </option>
          ))}
        </select>
      ) : (
        <div
          className="max-w-[8.5rem] truncate rounded-md border bg-bg-panel px-2 py-1 text-xs text-fg-muted"
          data-testid="chat-provider-label"
          title={providerDisplayName(selectedProvider.kind)}
        >
          {providerDisplayName(selectedProvider.kind)}
        </div>
      )}
      <select
        value={selectedModel}
        disabled={controlDisabled || loadingModels}
        onChange={(event) => {
          const modelId = event.target.value;
          setSelectedModel(modelId);
          void saveRuntime(selectedProvider, modelId);
        }}
        aria-label={t("chat.input.model_select_aria")}
        className="max-w-[11rem] rounded-md border bg-bg-panel px-2 py-1 text-xs text-fg"
        data-testid="chat-model-select"
        title={modelDisplayName(selectedModel) ?? selectedModel}
      >
        {modelOptions.map((model) => (
          <option key={model.id} value={model.id}>
            {model.display_name}
          </option>
        ))}
      </select>
    </div>
  );
}

export default RuntimeModelSelector;
