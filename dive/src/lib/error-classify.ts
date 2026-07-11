export type ClassifiedErrorKind =
  | "auth"
  | "rate_limit"
  | "network"
  | "assistant_length"
  | "tool_blocked"
  | "verify_fail"
  | "unknown";

export interface ClassifiedError {
  kind: ClassifiedErrorKind;
  titleKey: string;
  bodyKey: string;
  hintsKey: string;
  retryable: boolean;
  rawMessage: string;
}

function rawMessage(input: unknown): string {
  if (input instanceof Error) return input.message;
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

export function classifyError(input: unknown): ClassifiedError {
  const raw = rawMessage(input);
  const lower = raw.toLowerCase();
  let kind: ClassifiedErrorKind = "unknown";
  let retryable = false;

  if (/\b(401|403)\b/.test(lower) || lower.includes("unauthorized") || lower.includes("auth")) {
    kind = "auth";
  } else if (lower.includes("assistant_length") || lower.includes("output limit")) {
    kind = "assistant_length";
    retryable = true;
  } else if (
    /\b(429)\b/.test(lower) ||
    lower.includes("rate limit") ||
    lower.includes("quota") ||
    lower.includes("freeusagelimiterror")
  ) {
    kind = "rate_limit";
    retryable = true;
  } else if (
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("econnreset")
  ) {
    kind = "network";
    retryable = true;
  } else if (
    lower.includes("blocked") ||
    lower.includes("path denied") ||
    lower.includes("policy denies") ||
    lower.includes("permission")
  ) {
    kind = "tool_blocked";
  } else if (lower.includes("verify") || lower.includes("검증")) {
    kind = "verify_fail";
    retryable = true;
  }

  return {
    kind,
    titleKey: `error.${kind}.title`,
    bodyKey: `error.${kind}.body`,
    hintsKey: `error.${kind}.hints`,
    retryable,
    rawMessage: raw,
  };
}

export type ProjectCreateErrorKind = "unsafe_path" | "permission" | "canonicalize" | "generic";

export interface ClassifiedProjectCreateError {
  kind: ProjectCreateErrorKind;
  titleKey: string;
  bodyKey: string;
  rawMessage: string;
}

/**
 * Map the raw Rust `project_create` errors (project.rs) to a deterministic,
 * localizable kind so a beginner sees plain Korean instead of an English Rust
 * string (P1-06). Always resolves to a kind (`generic` fallback) so the UI never
 * shows the raw message.
 */
export function classifyProjectCreateError(input: unknown): ClassifiedProjectCreateError {
  const lower = rawMessage(input).toLowerCase();
  let kind: ProjectCreateErrorKind = "generic";
  if (lower.includes("unsafe project path") || lower.includes("must be absolute")) {
    kind = "unsafe_path";
  } else if (lower.includes("permission") || lower.includes("denied") || lower.includes("eacces")) {
    kind = "permission";
  } else if (
    lower.includes("canonicalize") ||
    lower.includes("no such file") ||
    lower.includes("not found")
  ) {
    kind = "canonicalize";
  }
  return {
    kind,
    titleKey: `error.project_create.${kind}.title`,
    bodyKey: `error.project_create.${kind}.body`,
    rawMessage: rawMessage(input),
  };
}

export interface SidecarModelNotFoundMatch {
  provider: string;
  model: string;
}

const SIDECAR_MODEL_NOT_FOUND_RE = /model not found: ([^/\s]+)\/(.+)$/;

/**
 * Detects the pinned pi-ai sidecar's own error template — `model not found:
 * ${provider}/${modelId}` (`dive/pi-sidecar/src/index.mjs:166`) — inside a
 * chat error message. `run_supervised_turn` (`pi_sidecar.rs`) wraps that
 * string unmodified as `pi sidecar error: {message}`, so it survives to the
 * frontend as a `chat_send` failure even though preflight already let the
 * turn start (registry drift or a future race, S-051 D3). Used to surface a
 * named cause + switch-model CTA instead of a generic/silent failure.
 */
export function matchSidecarModelNotFoundError(input: unknown): SidecarModelNotFoundMatch | null {
  const raw = rawMessage(input);
  const match = SIDECAR_MODEL_NOT_FOUND_RE.exec(raw);
  if (!match) return null;
  return { provider: match[1], model: match[2].trim() };
}
