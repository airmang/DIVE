import { useEffect, useMemo, useState } from "react";
import { useToast } from "../toast/toast-context";

interface ModelInfo {
  id: string;
  display_name: string;
}

interface Props {
  providerId: number;
  providerKind: string;
  selectedModel?: string | null;
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

function fallbackModels(providerKind: string): ModelInfo[] {
  if (providerKind === "anthropic") {
    return [
      { id: "claude-opus-4-7", display_name: "Claude Opus 4.7" },
      { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5" },
    ];
  }
  if (providerKind === "openrouter") {
    return [
      { id: "openai/gpt-5.5", display_name: "OpenAI · GPT-5.5" },
      { id: "openai/gpt-5.3-codex", display_name: "OpenAI · GPT-5.3 Codex" },
      { id: "openai/gpt-5.4", display_name: "OpenAI · GPT-5.4" },
      { id: "openai/gpt-5.4-mini", display_name: "OpenAI · GPT-5.4 Mini" },
    ];
  }
  if (providerKind === "opencode_zen" || providerKind === "opencode-zen") {
    return [
      { id: "gpt-5-nano", display_name: "GPT-5 Nano" },
      { id: "kimi-k2", display_name: "Kimi K2" },
      { id: "qwen3-coder", display_name: "Qwen3 Coder" },
      { id: "glm-4.6", display_name: "GLM-4.6" },
      { id: "gpt-oss-120b", display_name: "GPT OSS 120B" },
    ];
  }
  return [
    { id: "gpt-5.5", display_name: "GPT-5.5" },
    { id: "gpt-5.5-codex", display_name: "GPT-5.5 Codex" },
    { id: "gpt-5.4", display_name: "GPT-5.4" },
    { id: "gpt-5.4-mini", display_name: "GPT-5.4 Mini" },
  ];
}

export function ProviderModelSelector({ providerId, providerKind, selectedModel }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState(selectedModel ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

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
    if (!selected || models.some((model) => model.id === selected)) return models;
    return [{ id: selected, display_name: `${selected} (저장됨)` }, ...models];
  }, [models, selected]);

  useEffect(() => {
    if (selected || options.length === 0) return;
    setSelected(options[0]?.id ?? "");
  }, [options, selected]);

  const handleChange = async (modelId: string) => {
    setSelected(modelId);
    setSaving(true);
    try {
      const api = await loadTauri();
      if (api) await api.invoke<void>("provider_set_model", { providerId, modelId });
      toast({
        variant: "success",
        title: "모델 설정 저장됨",
        description: "다음 요청부터 선택한 모델이 적용됩니다.",
      });
    } catch (err) {
      toast({
        variant: "error",
        title: "모델 설정 저장 실패",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-xs text-fg-muted">모델 로드 중…</div>;
  if (options.length === 0)
    return <div className="text-xs text-fg-muted">사용 가능한 모델 없음</div>;

  return (
    <div className="flex items-center gap-2" data-testid="provider-model-selector">
      <label className="text-xs text-fg-muted" htmlFor={`model-${providerKind}-${providerId}`}>
        모델
      </label>
      <select
        id={`model-${providerKind}-${providerId}`}
        value={selected}
        onChange={(e) => void handleChange(e.target.value)}
        disabled={saving}
        className="min-w-0 flex-1 rounded-md border bg-bg px-2 py-1 text-sm"
        data-testid="provider-model-select"
        data-provider-kind={providerKind}
      >
        {options.map((model) => (
          <option key={model.id} value={model.id}>
            {model.display_name}
          </option>
        ))}
      </select>
      {saving ? <span className="text-[10px] text-fg-muted">저장 중…</span> : null}
    </div>
  );
}

export default ProviderModelSelector;
