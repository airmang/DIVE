export type ClassifiedErrorKind =
  | "auth"
  | "rate_limit"
  | "network"
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
  } else if (/\b(429)\b/.test(lower) || lower.includes("rate limit") || lower.includes("quota")) {
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
