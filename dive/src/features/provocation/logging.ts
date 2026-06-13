import type {
  ProvocationAction,
  ProvocationCard,
  ProvocationContext,
  ProvocationEvidence,
  ProvocationActionKind,
  ProvocationVerification,
  ScaffoldMode,
} from "./types";
import { deriveVerificationStatuses, summarizeVerificationEvidence } from "./verificationStatus";

type AgencyComponent = "intent" | "plan" | "action" | "diff" | "verify" | "decision" | "rollback";

type AgencyState =
  | "intent_needed"
  | "plan_review_needed"
  | "approval_required"
  | "running"
  | "diff_review_needed"
  | "verification_needed"
  | "verified_with_evidence"
  | "ai_self_report_only"
  | "verification_failed"
  | "rollback_available"
  | "approved_with_risk";

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

const CARD_AGENCY_COMPONENT: Record<ProvocationCard["type"], AgencyComponent> = {
  oversized_scope: "intent",
  missing_acceptance_criteria: "intent",
  missing_verification_step: "plan",
  diff_scope_drift: "diff",
  ai_self_report_only: "verify",
  regeneration_loop: "rollback",
};

const CARD_AGENCY_STATE: Record<ProvocationCard["type"], AgencyState> = {
  oversized_scope: "intent_needed",
  missing_acceptance_criteria: "intent_needed",
  missing_verification_step: "verification_needed",
  diff_scope_drift: "diff_review_needed",
  ai_self_report_only: "ai_self_report_only",
  regeneration_loop: "verification_failed",
};

const ACTION_AGENCY_COMPONENT: Partial<Record<ProvocationActionKind, AgencyComponent>> = {
  add_acceptance_criteria: "intent",
  split_scope: "intent",
  add_verification_step: "plan",
  open_diff: "diff",
  ask_ai_for_rationale: "action",
  revert_unrelated_changes: "rollback",
  run_app: "verify",
  run_tests: "verify",
  open_preview: "verify",
  create_repro_steps: "rollback",
  rollback_last_change: "rollback",
  retry_with_ai: "rollback",
  continue_with_risk: "decision",
};

function agencyComponentFor(card: ProvocationCard, action: ProvocationAction | null): AgencyComponent {
  return (action ? ACTION_AGENCY_COMPONENT[action.kind] : null) ?? CARD_AGENCY_COMPONENT[card.type];
}

function agencyStateFor(
  card: ProvocationCard,
  verificationStatus: ReturnType<typeof summarizeVerification>,
  riskAccepted: boolean,
): AgencyState {
  if (verificationStatus?.verificationState === "verified_with_evidence") {
    return "verified_with_evidence";
  }
  if (verificationStatus?.verificationState === "failed_but_accepted") {
    return "verification_failed";
  }
  if (riskAccepted || verificationStatus?.verificationState === "unverified_risk_accepted") {
    return "approved_with_risk";
  }
  return CARD_AGENCY_STATE[card.type];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function affectedFilesFor(card: ProvocationCard, context: Partial<ProvocationContext> | undefined) {
  const metadata = card.metadata ?? {};
  const changedFiles = [
    ...new Set([
      ...stringList(metadata.changedFiles),
      ...(context?.changedFiles?.map((file) => file.path).filter(Boolean) ?? []),
    ]),
  ];
  const targetFiles = [
    ...new Set([...stringList(metadata.targetFiles), ...(context?.targetFiles ?? [])]),
  ];
  const highRiskFiles = stringList(metadata.highRiskFiles);

  if (changedFiles.length === 0 && targetFiles.length === 0 && highRiskFiles.length === 0) {
    return null;
  }

  return {
    changedFiles,
    targetFiles,
    highRiskFiles,
  };
}

function affectedCommandsFor(card: ProvocationCard, context: Partial<ProvocationContext> | undefined) {
  const commands = stringList(card.metadata?.affectedCommands);
  if (commands.length > 0) {
    return commands.map((command) => ({
      kind: "command",
      redacted: true,
      charCount: command.length,
    }));
  }
  if (context?.verification?.externalTestRun !== undefined || context?.verification?.testResult) {
    return [{ kind: "verification", redacted: true }];
  }
  return [];
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
  const agencyComponent = agencyComponentFor(card, selectedAction);
  const agencyState = agencyStateFor(card, verificationStatus, riskAccepted);

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
    agencyComponent,
    agencyState,
    riskLevel: card.severity,
    affectedFiles: affectedFilesFor(card, context),
    affectedCommands: affectedCommandsFor(card, context),
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
    decision: selectedAction
      ? {
          event: input.eventType.replace("provocation.", ""),
          actionKind: selectedAction.kind,
          actionId: selectedAction.id,
        }
      : {
          event: input.eventType.replace("provocation.", ""),
          actionKind: null,
          actionId: null,
        },
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
