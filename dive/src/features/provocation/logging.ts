import type {
  ProvocationAction,
  ProvocationCard,
  ProvocationContext,
  ProvocationVerification,
  ScaffoldMode,
} from "./types";

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

function summarizeVerification(verification: ProvocationVerification | undefined) {
  if (!verification) return null;
  return {
    aiClaimedDone: Boolean(verification.aiClaimedDone),
    diffReviewed: Boolean(verification.diffReviewed),
    appLaunched: Boolean(verification.appLaunched),
    previewChecked: Boolean(verification.previewChecked),
    manualCheckCount: verification.manualChecks?.filter((item) => item.trim().length > 0).length ?? 0,
    automatedTestsPassed: Boolean(verification.automatedTestsPassed),
    externalTestRun: verification.externalTestRun ?? null,
    failedButAccepted: Boolean(verification.failedButAccepted),
    approvedWithRisk: Boolean(verification.approvedWithRisk),
  };
}

export function buildProvocationLogPayload(input: ProvocationLogInput) {
  const { card, context, mode, action, reason } = input;
  return {
    eventId: eventId(),
    timestamp: new Date().toISOString(),
    projectId: context?.projectId ?? null,
    sessionId: context?.sessionId ?? null,
    featureId: context?.featureId ?? null,
    taskId: context?.taskId ?? null,
    cardId: card.id,
    cardType: card.type,
    stage: card.stage,
    severity: card.severity,
    mode,
    evidence: card.evidence.map((item) => ({
      label: item.label,
      value: item.value ?? null,
      source: item.source,
    })),
    selectedAction: action
      ? {
          id: action.id,
          kind: action.kind,
          label: action.label,
          requiresReason: Boolean(action.requiresReason),
        }
      : null,
    reason: reason?.trim() || null,
    verificationStatus: summarizeVerification(context?.verification),
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
    sessionId:
      typeof input.context?.sessionId === "number" ? input.context.sessionId : null,
    eventType: input.eventType,
    payload,
  });
}
