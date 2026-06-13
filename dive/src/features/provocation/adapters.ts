import type {
  ChangedFileCategory,
  ProvocationAssistantReport,
  ProvocationChangedFile,
  ProvocationContext,
  ProvocationPlanStep,
  ProvocationRetrySignal,
} from "./types";

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function normalizePlanStep(input: {
  id?: number | string;
  step_id?: string;
  title?: string | null;
  summary?: string | null;
  instruction_seed?: string | null;
  expected_files?: unknown;
  expectedFiles?: unknown;
  verification_kind?: string | null;
  verification_command?: string | null;
  verification_manual_check?: string | null;
}): ProvocationPlanStep {
  const verificationText = [
    input.verification_kind,
    input.verification_command,
    input.verification_manual_check,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    id: String(input.id ?? input.step_id ?? input.title ?? "step"),
    text: [input.step_id, input.title, input.summary, input.instruction_seed, verificationText]
      .filter(Boolean)
      .join(" "),
    kind: input.verification_kind ?? undefined,
    expectedFiles: stringArray(input.expected_files ?? input.expectedFiles),
  };
}

export function guessChangedFileCategory(path: string): ChangedFileCategory {
  const lower = path.toLowerCase();
  if (/(^|\/)package\.json$|(^|\/)(pnpm-lock|package-lock|yarn)\.lock$/.test(lower)) {
    return "dependency";
  }
  if (/(^|\/)\.env|config|tsconfig|vite|webpack|tailwind|eslint/.test(lower)) {
    return "config";
  }
  if (/(auth|oauth|permission|policy|security)/.test(lower)) return "auth";
  if (/(schema|migration|migrations|db|database)/.test(lower)) return "db";
  if (/(route|router|page)/.test(lower)) return "routing";
  if (/(\.test\.|\.spec\.)/.test(lower)) return "test";
  if (/\.(css|scss|tsx|jsx)$/.test(lower)) return "ui";
  if (/\.(ts|js|rs)$/.test(lower)) return "logic";
  return "unknown";
}

export function normalizeChangedFile(input: {
  path: string;
  changeType?: ProvocationChangedFile["changeType"];
  category?: ChangedFileCategory;
}): ProvocationChangedFile {
  return {
    path: input.path,
    changeType: input.changeType,
    category: input.category ?? guessChangedFileCategory(input.path),
  };
}

const ASSISTANT_COMPLETION_TERMS = [
  "완료했습니다",
  "완료됐습니다",
  "완료되었습니다",
  "다 했습니다",
  "수정했습니다",
  "수정 완료",
  "구현했습니다",
  "구현 완료",
  "해결했습니다",
  "반영했습니다",
  "done",
  "completed",
  "implemented",
  "fixed",
];

const ASSISTANT_COMPLETION_NEGATIONS = [
  "완료하지 않았",
  "완료되지 않았",
  "아직 완료",
  "수정하지 못",
  "구현하지 못",
  "해결하지 못",
  "not done",
  "not completed",
  "not implemented",
  "not fixed",
  "could not fix",
  "couldn't fix",
  "unable to fix",
];

const RETRY_REQUEST_PATTERNS = [
  "고쳐줘",
  "수정해줘",
  "다시 해줘",
  "다시 시도",
  "한번 더",
  "한 번 더",
  "재시도",
  "계속 해",
  "fix it",
  "try again",
  "retry",
  "regenerate",
];

const RECOVERY_OR_REPRO_PATTERNS = [
  "되돌",
  "롤백",
  "rollback",
  "revert",
  "재현",
  "repro",
  "로그 정리",
  "원인",
  "root cause",
];

const SCOPE_NARROWING_PATTERNS = [
  "범위 줄",
  "작게",
  "하나씩",
  "나눠",
  "분리",
  "split",
  "narrow",
  "smaller scope",
];

function lowercase(value: string): string {
  return value.trim().toLowerCase();
}

function includesAny(text: string, terms: string[]): boolean {
  const normalized = lowercase(text);
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function matchingRetryPhrases(text: string): string[] {
  const normalized = lowercase(text);
  return RETRY_REQUEST_PATTERNS.filter((term) => normalized.includes(term.toLowerCase()));
}

function normalizeFailureKey(value: string): string {
  return lowercase(value)
    .replace(/\d+/g, "#")
    .replace(/0x[0-9a-f]+/g, "0x#")
    .replace(/line #/g, "line #")
    .slice(0, 240);
}

export function detectAssistantSelfReportCompletion(text: string): boolean {
  const normalized = lowercase(text);
  if (!normalized) return false;
  if (includesAny(normalized, ASSISTANT_COMPLETION_NEGATIONS)) return false;
  return ASSISTANT_COMPLETION_TERMS.some((term) =>
    new RegExp(`(^|[^a-z가-힣])${escapeRegExp(term.toLowerCase())}([^a-z가-힣]|$)`, "i").test(
      normalized,
    ),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function assistantReportFromText(input: {
  text: string;
  messageId?: string;
  createdAt?: number | string;
}): ProvocationAssistantReport | null {
  if (!detectAssistantSelfReportCompletion(input.text)) return null;
  return {
    source: "assistant_message",
    messageId: input.messageId,
    createdAt: input.createdAt,
  };
}

export interface ProvocationConversationMessage {
  id: string;
  kind: "user" | "assistant" | "tool_result" | "error" | string;
  content?: string;
  message?: string;
  summary?: string;
  success?: boolean;
  streaming?: boolean;
  createdAt?: number;
}

export function assistantReportsFromConversation(
  messages: ProvocationConversationMessage[],
): ProvocationAssistantReport[] {
  return messages
    .filter((message) => message.kind === "assistant" && message.streaming !== true)
    .map((message) =>
      assistantReportFromText({
        text: message.content ?? "",
        messageId: message.id,
        createdAt: message.createdAt,
      }),
    )
    .filter((report): report is ProvocationAssistantReport => report !== null)
    .slice(-3);
}

export function retrySignalsFromConversation(
  messages: ProvocationConversationMessage[],
): ProvocationRetrySignal[] {
  const byError = new Map<string, ProvocationRetrySignal>();
  let currentErrorKey: string | null = null;

  for (const message of messages) {
    if (message.kind === "error") {
      const key = normalizeFailureKey(message.message ?? "");
      currentErrorKey = key || null;
      continue;
    }

    if (message.kind === "tool_result" && message.success === false) {
      const key = normalizeFailureKey(message.summary ?? "");
      currentErrorKey = key || null;
      continue;
    }

    if (message.kind !== "user" || !currentErrorKey) continue;

    const text = message.content ?? "";
    let signal = byError.get(currentErrorKey);
    if (!signal) {
      signal = {
        errorKey: currentErrorKey,
        retryCount: 0,
        retryPhrases: [],
      };
      byError.set(currentErrorKey, signal);
    }

    if (includesAny(text, RECOVERY_OR_REPRO_PATTERNS)) {
      signal.rollbackOrReproMentioned = true;
    }
    if (includesAny(text, SCOPE_NARROWING_PATTERNS)) {
      signal.scopeNarrowed = true;
    }

    const phrases = matchingRetryPhrases(text);
    if (phrases.length === 0) continue;

    signal.retryCount += 1;
    signal.retryPhrases = [...new Set([...signal.retryPhrases, ...phrases])];
    signal.lastUserMessageId = message.id;
  }

  return [...byError.values()].filter((signal) => signal.retryCount > 0);
}

export function createProvocationContext(
  input: Partial<ProvocationContext> & Pick<ProvocationContext, "mode" | "stage">,
): ProvocationContext {
  const assistantReports = input.assistantReports?.filter((item) => item.source);
  const verification =
    assistantReports && assistantReports.length > 0
      ? {
          ...input.verification,
          aiClaimedDone: input.verification?.aiClaimedDone ?? true,
        }
      : input.verification;

  return {
    ...input,
    verification,
    assistantReports,
    acceptanceCriteria: input.acceptanceCriteria?.filter((item) => item.trim().length > 0),
    planSteps: input.planSteps?.filter((item) => item.text.trim().length > 0),
    changedFiles: input.changedFiles?.filter((item) => item.path.trim().length > 0),
    retrySignals: input.retrySignals?.filter((item) => item.retryCount > 0),
  };
}
