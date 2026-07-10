export interface ModelInfo {
  id: string;
  display_name: string;
  /** S-051 D2 point 1: pi-ai registry executability. `null`/`undefined` = unknown, no marking (fail open). */
  pi_executable?: boolean | null;
}

export function fallbackModels(providerKind: string): ModelInfo[] {
  if (providerKind === "anthropic") {
    return [
      { id: "claude-opus-4-7", display_name: "Claude Opus 4.7" },
      { id: "claude-sonnet-5", display_name: "Claude Sonnet 5" },
      { id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5" },
    ];
  }
  if (providerKind === "openrouter") {
    return [
      { id: "openai/gpt-5.4-mini", display_name: "OpenAI - GPT-5.4 Mini" },
      { id: "openai/gpt-5.4", display_name: "OpenAI - GPT-5.4" },
      {
        id: "anthropic/claude-sonnet-5",
        display_name: "Anthropic - Claude Sonnet 5",
      },
      {
        id: "google/gemini-3-flash-preview",
        display_name: "Google - Gemini 3 Flash Preview",
      },
      { id: "deepseek/deepseek-v4-flash", display_name: "DeepSeek - DeepSeek V4 Flash" },
    ];
  }
  if (providerKind === "opencode_zen" || providerKind === "opencode-zen") {
    return [
      { id: "big-pickle", display_name: "Big Pickle" },
      { id: "minimax-m2.5-free", display_name: "MiniMax M2.5 Free" },
      { id: "hy3-preview-free", display_name: "Hy3 Preview Free" },
    ];
  }
  if (providerKind === "codex") {
    return [
      { id: "gpt-5.5", display_name: "GPT-5.5" },
      { id: "gpt-5.4", display_name: "GPT-5.4" },
      { id: "gpt-5.4-mini", display_name: "GPT-5.4 Mini" },
      { id: "gpt-5.3-codex-spark", display_name: "GPT-5.3 Codex Spark" },
    ];
  }
  return [
    { id: "gpt-5.5", display_name: "GPT-5.5" },
    { id: "gpt-5.4", display_name: "GPT-5.4" },
    { id: "gpt-5.4-mini", display_name: "GPT-5.4 Mini" },
    { id: "gpt-5.3-codex", display_name: "GPT-5.3 Codex" },
  ];
}
