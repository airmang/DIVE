import type {
  ChangedFileCategory,
  ProvocationAction,
  ProvocationCard,
  ProvocationEvidence,
  ProvocationAssistantReport,
  ProvocationChangedFile,
  ProvocationContext,
  ProvocationPlanStep,
  ProvocationRetrySignal,
  AnySupervisorEvaluationRequest,
  ScopeExpansionAssessmentContract,
  ScopeExpansionSupervisorEvaluationRequest,
  SupervisorArtifactRef,
  SupervisorEvidenceRefContract,
  SupervisorEvaluationResponse,
  SupervisorAllowedActionId,
  SupervisorDropReason,
  SupervisorMode,
  SupervisorSourceUiMode,
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
  dependencies?: unknown;
  parallel_group?: string | number | null;
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
    verificationCommand: input.verification_command ?? null,
    verificationManualCheck: input.verification_manual_check ?? null,
    dependencies: stringArray(input.dependencies),
    parallelGroup: input.parallel_group ?? null,
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

function localEvaluationId(): string {
  return `supervisor-local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeSupervisorRenderMode(mode: SupervisorSourceUiMode): SupervisorMode {
  return mode === "guided" ? "guided" : "work";
}

export function createScopeExpansionSupervisorRequest(input: {
  sessionId: number;
  projectId: number;
  planId: number;
  artifactRef: SupervisorArtifactRef;
  sourceUiMode?: SupervisorSourceUiMode;
  locale?: string;
  contextHash: string;
  evidenceHash: string;
  allowedActionIds?: SupervisorAllowedActionId[];
  evidenceRefs: SupervisorEvidenceRefContract[];
  scopeExpansion: ScopeExpansionAssessmentContract;
  uiState?: ScopeExpansionSupervisorEvaluationRequest["uiState"];
}): ScopeExpansionSupervisorEvaluationRequest {
  const sourceUiMode = input.sourceUiMode ?? "standard";
  return {
    sessionId: input.sessionId,
    event: "scope_expansion",
    artifactRef: input.artifactRef,
    sourceUiMode,
    mode: normalizeSupervisorRenderMode(sourceUiMode),
    locale: input.locale,
    projectId: input.projectId,
    planId: input.planId,
    contextHash: input.contextHash,
    evidenceHash: input.evidenceHash,
    uiState: input.uiState ?? {
      goalSummary: undefined,
      planSummary: { stepCount: 0, activeStep: null },
      verification: {
        aiClaimedDone: false,
        diffReviewed: false,
        appLaunched: false,
        previewChecked: false,
        automatedTestsPassed: false,
        testResult: null,
        acceptanceCriterionConfirmed: false,
        manualChecks: [],
      },
      feasibility: {
        runnable: false,
        previewable: false,
        hasTests: false,
        diffAvailable: false,
      },
    },
    allowedActionIds: input.allowedActionIds ?? [
      "link_criterion",
      "split_scope",
      "edit_prd",
      "dismiss_review",
    ],
    evidenceRefs: input.evidenceRefs,
    scopeExpansion: input.scopeExpansion,
  };
}

const SUPERVISOR_DROP_REASONS: ReadonlySet<string> = new Set<SupervisorDropReason>([
  "provoke_false",
  "runtime_unavailable",
  "timeout",
  "sidecar_error",
  "parse_error",
  "schema_version_unsupported",
  "invalid_mode",
  "missing_evidence",
  "unknown_evidence_ref",
  "not_question",
  "unknown_action",
  "disallowed_concern",
  "duplicate",
  "cooldown",
  "ambiguous_decision",
  "context_too_large",
  "content_too_long",
]);

const SCOPE_EXPANSION_ACTIONS: ReadonlySet<SupervisorAllowedActionId> = new Set([
  "link_criterion",
  "split_scope",
  "edit_prd",
  "dismiss_review",
]);

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeDropReason(value: unknown, fallback: SupervisorDropReason): SupervisorDropReason {
  return typeof value === "string" && SUPERVISOR_DROP_REASONS.has(value)
    ? (value as SupervisorDropReason)
    : fallback;
}

function normalizeEvidenceRef(input: unknown): ProvocationEvidence | null {
  const value = recordValue(input);
  const source = stringField(value, "source");
  const label = stringField(value, "label");
  if (!source || !label) return null;
  return {
    refId: stringOrNull(value.refId ?? value.ref_id) ?? undefined,
    source: source as ProvocationEvidence["source"],
    label,
    value: stringOrNull(value.value) ?? undefined,
    kind: stringOrNull(value.kind) ?? undefined,
    verificationEvidence: booleanOrUndefined(
      value.verificationEvidence ?? value.verification_evidence,
    ),
  };
}

function normalizeAction(input: unknown): ProvocationAction | null {
  const value = recordValue(input);
  const id = stringField(value, "id");
  const kind = stringField(value, "kind");
  const label = stringField(value, "label");
  if (!id || !kind || !label) return null;
  return {
    id,
    kind: kind as ProvocationAction["kind"],
    label,
    requiresReason: booleanOrUndefined(value.requiresReason ?? value.requires_reason),
    reasonPrompt: stringOrNull(value.reasonPrompt ?? value.reason_prompt) ?? undefined,
    disabledReason: stringOrNull(value.disabledReason ?? value.disabled_reason) ?? undefined,
    todoId: stringOrNull(value.todoId ?? value.todo_id) ?? undefined,
  };
}

function normalizeCard(
  input: unknown,
  evaluationId: string,
  request?: AnySupervisorEvaluationRequest,
): ProvocationCard | null {
  const value = recordValue(input);
  const type = stringField(value, "type", "cardType", "card_type");
  const stage = stringField(value, "stage");
  const severity = stringField(value, "severity");
  const title = stringField(value, "title");
  const message = stringField(value, "message");
  if (!type || !stage || !severity || !title || !message) return null;

  const actions = Array.isArray(value.actions)
    ? value.actions.map(normalizeAction).filter((action): action is ProvocationAction => !!action)
    : [];
  const evidence = Array.isArray(value.evidence)
    ? value.evidence
        .map(normalizeEvidenceRef)
        .filter((item): item is ProvocationEvidence => item !== null)
    : [];
  const metadata: Record<string, unknown> = {
    ...recordValue(value.metadata),
    supervisorEvaluationId: stringField(recordValue(value.metadata), "supervisorEvaluationId")
      ?? evaluationId,
  };

  if (request?.event === "scope_expansion") {
    metadata.supervisorEvent ??= "scope_expansion";
    metadata.projectId ??= request.projectId;
    metadata.planId ??= request.planId;
    metadata.artifactRef ??= request.artifactRef;
    metadata.contextHash ??= request.contextHash;
    metadata.evidenceHash ??= request.evidenceHash;
    metadata.scopeExpansion ??= request.scopeExpansion;
  }

  return {
    id: stringField(value, "id") ?? `${type}:${evaluationId}`,
    type: type as ProvocationCard["type"],
    stage: stage as ProvocationCard["stage"],
    severity: severity as ProvocationCard["severity"],
    title,
    prompt: stringOrNull(value.prompt) ?? undefined,
    message,
    evidence,
    actions,
    primaryActionId: stringOrNull(value.primaryActionId ?? value.primary_action_id) ?? undefined,
    modeCopy: recordValue(value.modeCopy ?? value.mode_copy) as ProvocationCard["modeCopy"],
    metadata,
    createdAt: stringField(value, "createdAt", "created_at") ?? new Date().toISOString(),
  };
}

function normalizeScopeExpansionShownResponse(
  raw: Record<string, unknown>,
  evaluationId: string,
  request: ScopeExpansionSupervisorEvaluationRequest,
): SupervisorEvaluationResponse {
  const card = normalizeCard(raw.card, evaluationId, request);
  if (!card || card.type !== "scope_expansion") {
    return {
      status: "dropped",
      evaluationId,
      dropReason: "disallowed_concern",
    };
  }

  const allowed = new Set(
    request.allowedActionIds.filter((actionId) => SCOPE_EXPANSION_ACTIONS.has(actionId)),
  );
  const actions = card.actions.filter((action) =>
    allowed.has(action.kind as SupervisorAllowedActionId),
  );
  if (actions.length === 0) {
    return {
      status: "dropped",
      evaluationId,
      dropReason: "unknown_action",
    };
  }

  const primaryActionId = actions.some((action) => action.id === card.primaryActionId)
    ? card.primaryActionId
    : actions[0]?.id;

  return {
    status: "shown",
    evaluationId,
    card: {
      ...card,
      actions,
      primaryActionId,
    },
  };
}

export function normalizeSupervisorEvaluationResponse(
  rawResponse: unknown,
  request?: AnySupervisorEvaluationRequest,
): SupervisorEvaluationResponse {
  const raw = recordValue(rawResponse);
  const evaluationId = stringField(raw, "evaluationId", "evaluation_id") ?? localEvaluationId();
  const status = stringField(raw, "status");

  if (status === "shown") {
    if (request?.event === "scope_expansion") {
      return normalizeScopeExpansionShownResponse(raw, evaluationId, request);
    }
    const card = normalizeCard(raw.card, evaluationId, request);
    return card
      ? { status: "shown", evaluationId, card }
      : { status: "dropped", evaluationId, dropReason: "parse_error" };
  }

  if (status === "none" || status === "dropped") {
    return {
      status,
      evaluationId,
      dropReason: normalizeDropReason(raw.dropReason ?? raw.drop_reason, "provoke_false"),
    };
  }

  return {
    status: "dropped",
    evaluationId,
    dropReason: "parse_error",
  };
}

export async function evaluateProvocationSupervisor(
  request: AnySupervisorEvaluationRequest,
): Promise<SupervisorEvaluationResponse> {
  const api = await loadTauri();
  if (!api) {
    return {
      status: "dropped",
      evaluationId: localEvaluationId(),
      dropReason: "runtime_unavailable",
    };
  }
  const response = await api.invoke<unknown>("provocation_agent_evaluate", { request });
  return normalizeSupervisorEvaluationResponse(response, request);
}
