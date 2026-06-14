/**
 * Provider / model display formatting — single source of truth.
 *
 * Used by the sidebar AND the chat cockpit so the active AI is labeled
 * consistently wherever it surfaces. Keep raw `kind` strings (backend
 * `ProviderKind`) mapping here; UI components import these helpers.
 */

export const MODEL_LABELS: Record<string, string> = {
  "big-pickle": "Big Pickle",
  "minimax-m2.5-free": "MiniMax M2.5 Free",
  "hy3-preview-free": "Hy3 Preview Free",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4 Mini",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-5.3-codex-spark": "GPT-5.3 Codex Spark",
  "gpt-5.2": "GPT-5.2",
};

export function providerDisplayName(kind: string): string {
  if (kind === "opencode_zen" || kind === "opencode-zen") return "opencode zen";
  if (kind === "openrouter") return "OpenRouter";
  if (kind === "openai") return "OpenAI";
  if (kind === "anthropic") return "Anthropic";
  if (kind === "codex") return "Codex";
  if (kind === "custom-openai" || kind === "custom_openai") return "Custom";
  return kind;
}

export function modelDisplayName(model: string | null | undefined): string | null {
  if (!model) return null;
  return MODEL_LABELS[model] ?? model;
}

interface ConnectableProvider {
  kind: string;
  is_connected: boolean;
  is_active?: boolean;
  selected_model?: string | null;
}

export function findConnectedProvider<T extends ConnectableProvider>(
  providers: readonly T[],
): T | undefined {
  return (
    providers.find((p) => p.is_connected && p.is_active) ?? providers.find((p) => p.is_connected)
  );
}

/**
 * Compact label for the chat cockpit chip: "Anthropic · claude-…" when a model
 * is known, the provider name alone when not, or `null` when nothing connected
 * (callers decide the disconnected copy).
 */
export function cockpitProviderLabel(providers: readonly ConnectableProvider[]): string | null {
  const connected = findConnectedProvider(providers);
  if (!connected) return null;
  const provider = providerDisplayName(connected.kind);
  const model = modelDisplayName(connected.selected_model);
  return model ? `${provider} · ${model}` : provider;
}
