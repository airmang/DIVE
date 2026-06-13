import type {
  ProvocationAction,
  ProvocationCard,
  ProvocationContext,
  ProvocationEvidence,
  ProvocationVerification,
  ScaffoldMode,
} from "./types";
import { deriveVerificationStatuses, summarizeVerificationEvidence } from "./verificationStatus";

export type ProvocationLogEventType =
  | "provocation.card_shown"
  | "provocation.action_clicked"
  | "provocation.dismissed"
  | "provocation.marked_irrelevant"
  | "provocation.continued_with_risk";

export interface ProvocationLogInput {
  eventType: ProvocationLogEventType;
  card: ProvocationCard;
  context?: Partial<ProvocationContext>;
  mode: ScaffoldMode;
  action?: ProvocationAction;
  reason?: string | null;
}

type SafeEvidenceValue =
  | null
  | { kind: "short_text"; text: string }
  | { kind: "path"; path: string }
  | { kind: "paths"; paths: string[]; totalCount: number }
  | { kind: "count"; count: number; unit: string | null }
  | {
      kind: "summary";
      charCount: number;
      lineCount: number;
      wordCount: number;
      reason: "long_text" | "multiline" | "code_like";
    };

interface SafeEvidenceItem {
  label: string;
  source: ProvocationEvidence["source"];
  value: SafeEvidenceValue;
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

function eventId(): string {
  return `prov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function compactTextStats(text: string) {
  return {
    charCount: text.length,
    lineCount: text.split(/\r?\n/).filter((line) => line.trim().length > 0).length || 1,
    wordCount: text.split(/\s+/).filter((token) => token.length > 0).length,
  };
}

function looksLikePath(value: string): boolean {
  return (
    /[\\/]/.test(value) ||
    /\.(rs|ts|tsx|js|jsx|py|go|java|c|cpp|h|json|toml|md|html|css|scss|svg)$/i.test(value) ||
    /^(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|cargo\.toml|cargo\.lock)$/i.test(
      value,
    )
  );
}

function parsePathList(value: string): string[] {
  const parts = value
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1 || parts.length > 12) return [];
  return parts.every(looksLikePath) ? parts : [];
}

function looksCodeLike(value: string): boolean {
  return (
    /```/.test(value) ||
    /\b(import|export|function|const|let|class|interface|type|fn|impl|pub)\b/.test(value) ||
    /[{};]\s*$/.test(value) ||
    /=>|<\/?[a-z][\w-]*[\s>]/i.test(value)
  );
}

function summarizeEvidenceValue(evidence: ProvocationEvidence): SafeEvidenceValue {
  const value = evidence.value?.trim();
  if (!value) return null;

  const countMatch = value.match(/^(\d+)\s*(개|회|건|files?|items?)?$/i);
  if (countMatch) {
    return {
      kind: "count",
      count: Number(countMatch[1]),
      unit: countMatch[2] ?? null,
    };
  }

  const stats = compactTextStats(value);
  if (looksCodeLike(value)) {
    return {
      kind: "summary",
      ...stats,
      reason: "code_like",
    };
  }

  const pathList = parsePathList(value);
  if (pathList.length > 0) {
    return {
      kind: "paths",
      paths: pathList,
      totalCount: pathList.length,
    };
  }

  if (looksLikePath(value)) {
    return {
      kind: "path",
      path: value,
    };
  }

  if (value.length > 96 || stats.lineCount > 1) {
    return {
      kind: "summary",
      ...stats,
      reason: stats.lineCount > 1 ? "multiline" : "long_text",
    };
  }

  return {
    kind: "short_text",
    text: value,
  };
}

function summarizeEvidence(evidence: ProvocationEvidence[]): SafeEvidenceItem[] {
  return evidence.map((item) => ({
    label: item.label,
    source: item.source,
    value: summarizeEvidenceValue(item),
  }));
}

function contextForVerification(
  card: ProvocationCard,
  context: Partial<ProvocationContext> | undefined,
  mode: ScaffoldMode,
): ProvocationContext {
  return {
    ...context,
    mode,
    stage: context?.stage ?? card.stage,
  } as ProvocationContext;
}

function verificationStateFromSummary(
  verification: ProvocationVerification | undefined,
  concreteEvidence: boolean,
  riskAccepted: boolean,
  statusCount: number,
) {
  if (verification?.failedButAccepted || verification?.testResult === "fail") {
    return "failed_but_accepted";
  }
  if (riskAccepted) return "unverified_risk_accepted";
  if (concreteEvidence) return "verified_with_evidence";
  if (statusCount > 0) return "unverified";
  return "unknown";
}

function summarizeVerification(
  card: ProvocationCard,
  context: Partial<ProvocationContext> | undefined,
  mode: ScaffoldMode,
) {
  const fullContext = contextForVerification(card, context, mode);
  const verification = fullContext.verification;
  const provenance = fullContext.approvalProvenance ?? verification?.approvalProvenance ?? null;
  const statuses = deriveVerificationStatuses(fullContext);
  const evidenceSummary = provenance?.evidenceSummary ?? summarizeVerificationEvidence(fullContext);
  const riskAccepted =
    provenance?.riskAccepted ??
    Boolean(verification?.approvedWithRisk || verification?.failedButAccepted);

  if (!verification && !provenance && statuses.length === 0) return null;

  return {
    schemaVersion: 1,
    verificationState:
      provenance?.verificationState ??
      verificationStateFromSummary(
        verification,
        evidenceSummary.concreteEvidence,
        riskAccepted,
        statuses.length,
      ),
    statusIds: statuses.map((item) => item.id),
    evidenceSummary,
    riskAccepted,
  };
}

function syntheticActionForEvent(eventType: ProvocationLogEventType): ProvocationAction | null {
  if (eventType === "provocation.dismissed") {
    return { id: "dismiss", kind: "dismiss", label: "검토 카드 닫기" };
  }
  if (eventType === "provocation.marked_irrelevant") {
    return { id: "mark_irrelevant", kind: "mark_irrelevant", label: "관련 없음으로 표시" };
  }
  return null;
}

export function buildProvocationLogPayload(input: ProvocationLogInput) {
  const { card, context, mode, action, reason } = input;
  const selectedAction = action ?? syntheticActionForEvent(input.eventType);
  const trimmedReason = reason?.trim() || null;
  const reasonStats = trimmedReason ? compactTextStats(trimmedReason) : null;
  const evidence = summarizeEvidence(card.evidence);
  const verificationStatus = summarizeVerification(card, context, mode);
  const riskAccepted =
    selectedAction?.kind === "continue_with_risk" && Boolean(trimmedReason)
      ? true
      : Boolean(verificationStatus?.riskAccepted);

  return {
    schemaVersion: 1,
    eventId: eventId(),
    timestamp: new Date().toISOString(),
    lifecycleEvent: input.eventType.replace("provocation.", ""),
    projectId: context?.projectId ?? null,
    sessionId: context?.sessionId ?? null,
    featureId: context?.featureId ?? null,
    taskId: context?.taskId ?? null,
    toolCallId: context?.toolCallId ?? null,
    toolName: context?.toolName ?? null,
    cardId: card.id,
    cardType: card.type,
    stage: card.stage,
    severity: card.severity,
    mode,
    evidence,
    evidenceSummary: {
      schemaVersion: 1,
      count: evidence.length,
      labels: evidence.map((item) => item.label),
      sources: [...new Set(evidence.map((item) => item.source))],
    },
    selectedAction: selectedAction
      ? {
          id: selectedAction.id,
          kind: selectedAction.kind,
          label: selectedAction.label,
          requiresReason: Boolean(selectedAction.requiresReason),
        }
      : null,
    reasonRequired: Boolean(selectedAction?.requiresReason),
    reasonPresent: Boolean(trimmedReason),
    reason: trimmedReason,
    requiredReason: {
      required: Boolean(selectedAction?.requiresReason),
      provided: Boolean(trimmedReason),
      reason: trimmedReason,
      metrics: reasonStats,
    },
    verificationStatus,
    riskAccepted,
  };
}

export async function logProvocationEvent(input: ProvocationLogInput): Promise<void> {
  const payload = buildProvocationLogPayload(input);
  const api = await loadTauri();
  if (!api) {
    if (import.meta.env.DEV) {
      console.debug("[provocation]", input.eventType, payload);
    }
    return;
  }
  await api.invoke<void>("provocation_log_event", {
    sessionId: typeof input.context?.sessionId === "number" ? input.context.sessionId : null,
    eventType: input.eventType,
    payload,
  });
}
