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
  DiffReadyReviewAssessmentContract,
  DiffReadySupervisorEvaluationRequest,
  PlanDraftReviewAssessmentContract,
  PlanDraftSupervisorEvaluationRequest,
  RetryLoopReviewAssessmentContract,
  RetryLoopSupervisorEvaluationRequest,
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
import { useLocaleStore } from "../../i18n";

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
  linkedCriterionIds?: unknown;
  linked_criterion_ids?: unknown;
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
    linkedCriterionIds: stringArray(input.linked_criterion_ids ?? input.linkedCriterionIds),
    verificationCommand: input.verification_command ?? null,
    verificationManualCheck: input.verification_manual_check ?? null,
    dependencies: stringArray(input.dependencies),
    parallelGroup: input.parallel_group ?? null,
  };
}

export function guessChangedFileCategory(path: string): ChangedFileCategory {
  const lower = path.toLowerCase();
  if (
    /(\.pem|\.key)$/.test(lower) ||
    /(^|\/)(id_rsa|credentials|\.npmrc|\.netrc)($|[./_-])/.test(lower)
  ) {
    return "secret";
  }
  if (/(^|\/)\.github\/workflows\//.test(lower)) return "ci";
  if (/(^|\/)(\.gitlab-ci(\.ya?ml)?|dockerfile|makefile)$/.test(lower)) return "ci";
  if (
    /(^|\/)package\.json$|(^|\/)(pnpm-lock\.ya?ml|package-lock\.json|yarn\.lock|cargo\.lock|poetry\.lock|gemfile\.lock|go\.sum|requirements\.txt)$/.test(
      lower,
    )
  ) {
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

function uniqueNonEmptyStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function nonEmptyStringArray(value: unknown): string[] {
  return uniqueNonEmptyStrings(stringArray(value));
}

export function highRiskFilesFromDiffScopeCard(
  card: Pick<ProvocationCard, "type" | "metadata">,
): string[] {
  if (card.type !== "diff_scope_drift" && card.type !== "diff_scope_review") return [];

  const metadata = recordValue(card.metadata);
  const assessmentSummary = recordValue(metadata.assessmentSummary);
  const diffReadyAssessment = recordValue(metadata.diffReadyAssessment);
  const nestedHighRiskFiles = uniqueNonEmptyStrings([
    ...nonEmptyStringArray(assessmentSummary.highRiskFiles),
    ...nonEmptyStringArray(diffReadyAssessment.highRiskFiles),
  ]);
  if (nestedHighRiskFiles.length > 0) return nestedHighRiskFiles;

  const flatHighRiskFiles = nonEmptyStringArray(metadata.highRiskFiles);
  if (flatHighRiskFiles.length > 0) return flatHighRiskFiles;
  return metadata.highRisk === true ? nonEmptyStringArray(metadata.changedFiles) : [];
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

export function normalizeFailureFingerprint(value: string): string {
  return normalizeFailureKey(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function localHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compactText(value: string, limit = 160): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
}

function compactArray<T>(items: T[], limit = 6): T[] {
  return items.slice(0, limit);
}

function evidenceRef(input: {
  id: string;
  source: SupervisorEvidenceRefContract["source"];
  kind: string;
  label: string;
  valueSummary: unknown;
  verificationEvidence?: boolean;
}): SupervisorEvidenceRefContract {
  return {
    id: input.id,
    source: input.source,
    kind: input.kind,
    label: compactText(input.label, 80),
    valueSummary: input.valueSummary,
    verificationEvidence: input.verificationEvidence ?? false,
  };
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
        testCommand: null,
        testExitCode: null,
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

function hasVerificationPlan(step: ProvocationPlanStep): boolean {
  const kind = step.kind?.trim().toLowerCase();
  return Boolean(
    step.verificationCommand?.trim() ||
    step.verificationManualCheck?.trim() ||
    (kind && kind !== "none"),
  );
}

function broadPlanStep(step: ProvocationPlanStep): boolean {
  const text = step.text.toLowerCase();
  const expectedFileCount = step.expectedFiles?.length ?? 0;
  return (
    expectedFileCount >= 4 ||
    /\b(and|also|entire|all|everything)\b/.test(text) ||
    /(전체|모두|그리고|또한|한번에|한 번에)/.test(text)
  );
}

export function buildPlanDraftReviewAssessment(input: {
  planSteps: ProvocationPlanStep[];
  acceptanceCriteria: string[];
  unresolvedQuestions?: string[];
}): PlanDraftReviewAssessmentContract {
  const unverifiedStepIds = compactArray(
    input.planSteps.filter((step) => !hasVerificationPlan(step)).map((step) => step.id),
  );
  const unlinkedStepIds = compactArray(
    input.planSteps
      .filter((step) => input.acceptanceCriteria.length > 0 && !step.linkedCriterionIds?.length)
      .map((step) => step.id),
  );
  const broadStepIds = compactArray(input.planSteps.filter(broadPlanStep).map((step) => step.id));
  const unresolved = compactArray(input.unresolvedQuestions ?? []);
  const reasonCodes: string[] = [];
  if (unverifiedStepIds.length > 0) reasonCodes.push("missing_verification");
  if (unlinkedStepIds.length > 0) reasonCodes.push("unlinked_criteria");
  if (broadStepIds.length > 0) reasonCodes.push("broad_step");
  if (unresolved.length > 0) reasonCodes.push("unresolved_question");

  const evidenceRefs = [
    "plan.goal",
    "plan.criteria",
    "plan.step_count",
    ...unverifiedStepIds.map((id) => `plan.step.${id}.verification`),
    ...unlinkedStepIds.map((id) => `plan.step.${id}.criteria`),
    ...broadStepIds.map((id) => `plan.step.${id}.scope`),
    ...unresolved.map((_, index) => `plan.unresolved.${index}`),
  ];

  return {
    eligible: reasonCodes.length > 0 && input.planSteps.length > 0,
    reasonCodes,
    evidenceRefs: compactArray([...new Set(evidenceRefs)], 16),
    stepCount: input.planSteps.length,
    criteriaCount: input.acceptanceCriteria.length,
    unverifiedStepIds,
    unlinkedStepIds,
  };
}

export function buildPlanDraftEvidenceRefs(input: {
  goalSummary: string;
  acceptanceCriteria: string[];
  planSteps: ProvocationPlanStep[];
  unresolvedQuestions?: string[];
  assessment: PlanDraftReviewAssessmentContract;
}): SupervisorEvidenceRefContract[] {
  const refs: SupervisorEvidenceRefContract[] = [
    evidenceRef({
      id: "plan.goal",
      source: "goal",
      kind: "plan_goal",
      label: "Plan goal",
      valueSummary: compactText(input.goalSummary),
    }),
    evidenceRef({
      id: "plan.criteria",
      source: "plan",
      kind: "acceptance_criteria",
      label: "Acceptance criteria",
      valueSummary: {
        count: input.acceptanceCriteria.length,
        items: compactArray(
          input.acceptanceCriteria.map((item) => compactText(item, 80)),
          6,
        ),
      },
    }),
    evidenceRef({
      id: "plan.step_count",
      source: "plan",
      kind: "plan_step",
      label: "Plan steps",
      valueSummary: { count: input.planSteps.length },
    }),
  ];
  const stepById = new Map(input.planSteps.map((step) => [step.id, step]));
  for (const stepId of input.assessment.unverifiedStepIds) {
    const step = stepById.get(stepId);
    refs.push(
      evidenceRef({
        id: `plan.step.${stepId}.verification`,
        source: "plan",
        kind: "verification_coverage",
        label: `Missing verification for ${stepId}`,
        valueSummary: {
          stepId,
          text: compactText(step?.text ?? stepId),
          verificationCommand: step?.verificationCommand ?? null,
          verificationManualCheck: step?.verificationManualCheck ?? null,
        },
      }),
    );
  }
  for (const stepId of input.assessment.unlinkedStepIds) {
    const step = stepById.get(stepId);
    refs.push(
      evidenceRef({
        id: `plan.step.${stepId}.criteria`,
        source: "plan",
        kind: "criterion_linkage",
        label: `Missing criterion link for ${stepId}`,
        valueSummary: {
          stepId,
          text: compactText(step?.text ?? stepId),
          linkedCriterionIds: step?.linkedCriterionIds ?? [],
        },
      }),
    );
  }
  for (const step of input.planSteps.filter(broadPlanStep).slice(0, 6)) {
    refs.push(
      evidenceRef({
        id: `plan.step.${step.id}.scope`,
        source: "plan",
        kind: "broad_step",
        label: `Broad step ${step.id}`,
        valueSummary: {
          stepId: step.id,
          text: compactText(step.text),
          expectedFileCount: step.expectedFiles?.length ?? 0,
        },
      }),
    );
  }
  for (const [index, question] of (input.unresolvedQuestions ?? []).slice(0, 6).entries()) {
    refs.push(
      evidenceRef({
        id: `plan.unresolved.${index}`,
        source: "history",
        kind: "unresolved_question",
        label: `Unresolved question ${index + 1}`,
        valueSummary: compactText(question),
      }),
    );
  }
  const allowed = new Set(input.assessment.evidenceRefs);
  return refs.filter((ref) => allowed.has(ref.id));
}

export function createPlanDraftSupervisorRequest(input: {
  sessionId: number;
  projectId?: number | null;
  planId: number;
  artifactRef?: SupervisorArtifactRef;
  sourceUiMode?: SupervisorSourceUiMode;
  locale?: string;
  goalSummary: string;
  acceptanceCriteria: string[];
  planSteps: ProvocationPlanStep[];
  unresolvedQuestions?: string[];
  uiState?: PlanDraftSupervisorEvaluationRequest["uiState"];
}): PlanDraftSupervisorEvaluationRequest {
  const sourceUiMode = input.sourceUiMode ?? "standard";
  const assessment = buildPlanDraftReviewAssessment({
    planSteps: input.planSteps,
    acceptanceCriteria: input.acceptanceCriteria,
    unresolvedQuestions: input.unresolvedQuestions,
  });
  const evidenceRefs = buildPlanDraftEvidenceRefs({
    goalSummary: input.goalSummary,
    acceptanceCriteria: input.acceptanceCriteria,
    planSteps: input.planSteps,
    unresolvedQuestions: input.unresolvedQuestions,
    assessment,
  });
  const artifactRef =
    input.artifactRef ??
    ({
      kind: "plan_draft",
      id: `plan-${input.planId}:draft`,
      label: "Plan draft",
    } satisfies SupervisorArtifactRef);
  const uiState =
    input.uiState ??
    ({
      goalSummary: input.goalSummary,
      planSummary: {
        stepCount: input.planSteps.length,
        activeStep: null,
      },
      verification: {
        aiClaimedDone: false,
        diffReviewed: false,
        appLaunched: false,
        previewChecked: false,
        automatedTestsPassed: false,
        testResult: null,
        testCommand: null,
        testExitCode: null,
        acceptanceCriterionConfirmed: false,
        manualChecks: [],
      },
      feasibility: {
        runnable: false,
        previewable: false,
        hasTests: input.planSteps.some((step) => Boolean(step.verificationCommand?.trim())),
        diffAvailable: false,
      },
    } satisfies PlanDraftSupervisorEvaluationRequest["uiState"]);
  const contextBasis = {
    event: "plan_drafted",
    artifactRef,
    goalSummary: input.goalSummary,
    planId: input.planId,
    assessment,
  };
  return {
    sessionId: input.sessionId,
    event: "plan_drafted",
    artifactRef,
    sourceUiMode,
    mode: normalizeSupervisorRenderMode(sourceUiMode),
    locale: input.locale,
    projectId: input.projectId ?? undefined,
    planId: input.planId,
    contextHash: localHash(contextBasis),
    evidenceHash: localHash(evidenceRefs),
    uiState,
    allowedActionIds: [
      "add_verification_step",
      "link_criterion",
      "split_scope",
      "edit_prd",
      "dismiss_review",
    ],
    evidenceRefs,
    planDraftAssessment: assessment,
  };
}

function pathMatchesExpected(path: string, expectedFiles: string[]): boolean {
  const normalized = path.trim().toLowerCase();
  return expectedFiles.some((expected) => {
    const candidate = expected.trim().toLowerCase();
    if (!candidate) return false;
    if (candidate.includes("*")) {
      const prefix = candidate.split("*")[0] ?? "";
      return prefix.length > 0 && normalized.startsWith(prefix);
    }
    return (
      normalized === candidate ||
      normalized.endsWith(`/${candidate}`) ||
      normalized.startsWith(`${candidate}/`)
    );
  });
}

function isHighRiskFile(file: ProvocationChangedFile): boolean {
  const category = file.category ?? guessChangedFileCategory(file.path);
  return ["auth", "config", "db", "dependency", "routing", "ci", "secret"].includes(category);
}

export function buildDiffReadyReviewAssessment(input: {
  changedFiles: ProvocationChangedFile[];
  expectedFiles: string[];
  diffViewed?: boolean;
}): DiffReadyReviewAssessmentContract {
  const changedFiles = input.changedFiles.filter((file) => file.path.trim().length > 0);
  const expectedFiles = input.expectedFiles.filter((path) => path.trim().length > 0);
  const unexpectedFiles = compactArray(
    changedFiles
      .filter((file) => expectedFiles.length > 0 && !pathMatchesExpected(file.path, expectedFiles))
      .map((file) => file.path),
  );
  const highRiskFiles = compactArray(
    changedFiles
      .filter(
        (file) =>
          isHighRiskFile(file) &&
          (expectedFiles.length === 0 || !pathMatchesExpected(file.path, expectedFiles)),
      )
      .map((file) => file.path),
  );
  const reasonCodes: string[] = [];
  if (unexpectedFiles.length > 0) reasonCodes.push("outside_expected_files");
  if (highRiskFiles.length > 0) reasonCodes.push("high_risk_area");
  const evidenceRefs = [
    "diff.changed_files",
    "diff.expected_files",
    "step.scope",
    "diff.viewed",
    ...(unexpectedFiles.length > 0 ? ["diff.unexpected_files"] : []),
    ...(highRiskFiles.length > 0 ? ["diff.high_risk_files"] : []),
  ];

  return {
    eligible: changedFiles.length > 0 && reasonCodes.length > 0,
    reasonCodes,
    evidenceRefs,
    changedFileCount: changedFiles.length,
    unexpectedFiles,
    highRiskFiles,
    diffViewed: Boolean(input.diffViewed),
  };
}

export function buildDiffReadyEvidenceRefs(input: {
  goalSummary: string;
  stepSummary: string;
  changedFiles: ProvocationChangedFile[];
  expectedFiles: string[];
  assessment: DiffReadyReviewAssessmentContract;
}): SupervisorEvidenceRefContract[] {
  const refs = [
    evidenceRef({
      id: "diff.changed_files",
      source: "diff",
      kind: "changed_file",
      label: "Changed files",
      valueSummary: {
        totalCount: input.changedFiles.length,
        paths: compactArray(
          input.changedFiles.map((file) => file.path),
          8,
        ),
      },
    }),
    evidenceRef({
      id: "diff.expected_files",
      source: "plan",
      kind: "expected_file",
      label: "Expected files",
      valueSummary: {
        totalCount: input.expectedFiles.length,
        paths: compactArray(input.expectedFiles, 8),
      },
    }),
    evidenceRef({
      id: "step.scope",
      source: "plan",
      kind: "step_scope",
      label: "Step scope",
      valueSummary: {
        goal: compactText(input.goalSummary, 120),
        step: compactText(input.stepSummary, 160),
      },
    }),
    evidenceRef({
      id: "diff.viewed",
      source: "ui_observation",
      kind: "diff_view",
      label: "Diff viewed",
      valueSummary: { viewed: input.assessment.diffViewed },
    }),
    evidenceRef({
      id: "diff.unexpected_files",
      source: "diff",
      kind: "changed_file",
      label: "Unexpected files",
      valueSummary: {
        totalCount: input.assessment.unexpectedFiles.length,
        paths: input.assessment.unexpectedFiles,
      },
    }),
    evidenceRef({
      id: "diff.high_risk_files",
      source: "diff",
      kind: "changed_file",
      label: "High-risk files",
      valueSummary: {
        totalCount: input.assessment.highRiskFiles.length,
        paths: input.assessment.highRiskFiles,
      },
    }),
  ];
  const allowed = new Set(input.assessment.evidenceRefs);
  return refs.filter((ref) => allowed.has(ref.id));
}

export function createDiffReadySupervisorRequest(input: {
  sessionId: number;
  projectId?: number | null;
  planId?: number | null;
  stepId: number | string;
  stepTitle: string;
  sourceUiMode?: SupervisorSourceUiMode;
  locale?: string;
  goalSummary: string;
  stepSummary: string;
  changedFiles: ProvocationChangedFile[];
  expectedFiles: string[];
  diffViewed?: boolean;
  uiState: DiffReadySupervisorEvaluationRequest["uiState"];
}): DiffReadySupervisorEvaluationRequest {
  const sourceUiMode = input.sourceUiMode ?? "standard";
  const assessment = buildDiffReadyReviewAssessment({
    changedFiles: input.changedFiles,
    expectedFiles: input.expectedFiles,
    diffViewed: input.diffViewed,
  });
  const evidenceRefs = buildDiffReadyEvidenceRefs({
    goalSummary: input.goalSummary,
    stepSummary: input.stepSummary,
    changedFiles: input.changedFiles,
    expectedFiles: input.expectedFiles,
    assessment,
  });
  const artifactRef = {
    kind: "diff",
    id: `step-${input.stepId}:diff`,
    label: input.stepTitle || "Changed work",
  } satisfies SupervisorArtifactRef;
  const contextBasis = {
    event: "diff_ready",
    artifactRef,
    goalSummary: input.goalSummary,
    stepSummary: input.stepSummary,
    assessment,
  };
  return {
    sessionId: input.sessionId,
    event: "diff_ready",
    artifactRef,
    sourceUiMode,
    mode: normalizeSupervisorRenderMode(sourceUiMode),
    locale: input.locale,
    projectId: input.projectId ?? undefined,
    planId: input.planId ?? undefined,
    contextHash: localHash(contextBasis),
    evidenceHash: localHash(evidenceRefs),
    uiState: input.uiState,
    allowedActionIds: [
      "open_diff",
      "ask_ai_for_rationale",
      "revert_unrelated_changes",
      "run_tests",
      "dismiss_review",
    ],
    evidenceRefs,
    diffReadyAssessment: assessment,
  };
}

export function buildRetryLoopReviewAssessment(input: {
  failureFingerprint: string;
  failureCount: number;
  lastFailureAt: number | string;
  recoveryAvailable: boolean;
  lastActionSummary?: string | null;
}): RetryLoopReviewAssessmentContract {
  const failureFingerprint = input.failureFingerprint.trim();
  const reasonCodes: string[] = [];
  if (failureFingerprint && input.failureCount >= 2) {
    reasonCodes.push("same_failure_repeated");
  }
  if (!input.recoveryAvailable) {
    reasonCodes.push("recovery_unavailable");
  }
  const evidenceRefs = [
    "failure.fingerprint",
    "failure.count",
    "failure.last",
    "recovery.state",
    ...(input.lastActionSummary?.trim() ? ["failure.last_action"] : []),
  ];

  return {
    eligible: failureFingerprint.length > 0 && input.failureCount >= 2,
    reasonCodes,
    evidenceRefs,
    failureFingerprint,
    failureCount: Math.max(0, input.failureCount),
    lastFailureAt: input.lastFailureAt,
    lastActionSummary: input.lastActionSummary?.trim() || null,
    recoveryAvailable: input.recoveryAvailable,
  };
}

export function buildRetryLoopEvidenceRefs(input: {
  failureSummary: string;
  assessment: RetryLoopReviewAssessmentContract;
}): SupervisorEvidenceRefContract[] {
  const refs = [
    evidenceRef({
      id: "failure.fingerprint",
      source: "terminal",
      kind: "failure_summary",
      label: "Failure fingerprint",
      valueSummary: {
        fingerprint: input.assessment.failureFingerprint,
      },
    }),
    evidenceRef({
      id: "failure.count",
      source: "verification",
      kind: "retry_loop_assessment",
      label: "Repeated failure count",
      valueSummary: {
        count: input.assessment.failureCount,
      },
    }),
    evidenceRef({
      id: "failure.last",
      source: "verification",
      kind: "failure_summary",
      label: "Last failure",
      valueSummary: {
        occurredAt: input.assessment.lastFailureAt,
        summaryHash: localHash(compactText(input.failureSummary, 120)),
      },
    }),
    evidenceRef({
      id: "recovery.state",
      source: "ui_observation",
      kind: "recovery_state",
      label: "Recovery state",
      valueSummary: {
        recoveryAvailable: input.assessment.recoveryAvailable,
      },
    }),
    evidenceRef({
      id: "failure.last_action",
      source: "history",
      kind: "failure_summary",
      label: "Last action summary",
      valueSummary: compactText(input.assessment.lastActionSummary ?? "", 120),
    }),
  ];
  const allowed = new Set(input.assessment.evidenceRefs);
  return refs.filter((ref) => allowed.has(ref.id));
}

export function createRetryLoopSupervisorRequest(input: {
  sessionId: number;
  projectId?: number | null;
  planId?: number | null;
  stepId: number | string;
  stepTitle: string;
  sourceUiMode?: SupervisorSourceUiMode;
  locale?: string;
  goalSummary: string;
  stepSummary: string;
  failureSummary: string;
  failureCount: number;
  lastFailureAt: number | string;
  recoveryAvailable: boolean;
  lastActionSummary?: string | null;
  uiState: RetryLoopSupervisorEvaluationRequest["uiState"];
}): RetryLoopSupervisorEvaluationRequest {
  const sourceUiMode = input.sourceUiMode ?? "standard";
  const assessment = buildRetryLoopReviewAssessment({
    failureFingerprint: normalizeFailureFingerprint(input.failureSummary),
    failureCount: input.failureCount,
    lastFailureAt: input.lastFailureAt,
    recoveryAvailable: input.recoveryAvailable,
    lastActionSummary: input.lastActionSummary,
  });
  const evidenceRefs = buildRetryLoopEvidenceRefs({
    failureSummary: input.failureSummary,
    assessment,
  });
  const artifactRef = {
    kind: "failure",
    id: `step-${input.stepId}:failure:${assessment.failureFingerprint || "unknown"}`,
    label: input.stepTitle || "Repeated failure",
  } satisfies SupervisorArtifactRef;
  const contextBasis = {
    event: "retry_loop",
    artifactRef,
    goalSummary: input.goalSummary,
    stepSummary: input.stepSummary,
    assessment,
  };
  const allowedActionIds: SupervisorAllowedActionId[] = [
    "create_repro_steps",
    ...(input.recoveryAvailable ? (["rollback_last_change"] as const) : []),
    ...(input.uiState.feasibility.diffAvailable ? (["open_diff"] as const) : []),
    ...(input.uiState.feasibility.hasTests ? (["run_tests"] as const) : []),
    "split_scope",
    "dismiss_review",
  ];

  return {
    sessionId: input.sessionId,
    event: "retry_loop",
    artifactRef,
    sourceUiMode,
    mode: normalizeSupervisorRenderMode(sourceUiMode),
    locale: input.locale,
    projectId: input.projectId ?? undefined,
    planId: input.planId ?? undefined,
    contextHash: localHash(contextBasis),
    evidenceHash: localHash(evidenceRefs),
    uiState: input.uiState,
    allowedActionIds,
    evidenceRefs,
    retryLoopAssessment: assessment,
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

const PLAN_DRAFT_ACTIONS: ReadonlySet<SupervisorAllowedActionId> = new Set([
  "add_verification_step",
  "link_criterion",
  "split_scope",
  "edit_prd",
  "dismiss_review",
]);

const DIFF_READY_ACTIONS: ReadonlySet<SupervisorAllowedActionId> = new Set([
  "open_diff",
  "ask_ai_for_rationale",
  "revert_unrelated_changes",
  "run_tests",
  "dismiss_review",
]);

const RETRY_LOOP_ACTIONS: ReadonlySet<SupervisorAllowedActionId> = new Set([
  "create_repro_steps",
  "rollback_last_change",
  "open_diff",
  "run_tests",
  "split_scope",
  "dismiss_review",
]);

const EVENT_ACTIONS: Partial<
  Record<AnySupervisorEvaluationRequest["event"], ReadonlySet<SupervisorAllowedActionId>>
> = {
  scope_expansion: SCOPE_EXPANSION_ACTIONS,
  plan_drafted: PLAN_DRAFT_ACTIONS,
  diff_ready: DIFF_READY_ACTIONS,
  retry_loop: RETRY_LOOP_ACTIONS,
};

const EVENT_CARD_TYPES: Partial<Record<AnySupervisorEvaluationRequest["event"], string>> = {
  scope_expansion: "scope_expansion",
  plan_drafted: "plan_draft_review",
  diff_ready: "diff_scope_review",
  retry_loop: "retry_loop_review",
};

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
    supervisorEvaluationId:
      stringField(recordValue(value.metadata), "supervisorEvaluationId") ?? evaluationId,
  };

  if (request && request.event !== "verify_entered") {
    metadata.supervisorEvent ??= request.event;
    metadata.projectId ??= request.projectId;
    metadata.planId ??= request.planId;
    metadata.artifactRef ??= request.artifactRef;
    metadata.contextHash ??= request.contextHash;
    metadata.evidenceHash ??= request.evidenceHash;
    if (request.event === "scope_expansion") {
      metadata.scopeExpansion ??= request.scopeExpansion;
    } else if (request.event === "plan_drafted") {
      metadata.planDraftAssessment ??= request.planDraftAssessment;
    } else if (request.event === "diff_ready") {
      metadata.diffReadyAssessment ??= request.diffReadyAssessment;
    } else if (request.event === "retry_loop") {
      metadata.retryLoopAssessment ??= request.retryLoopAssessment;
    }
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

function normalizeExpandedShownResponse(
  raw: Record<string, unknown>,
  evaluationId: string,
  request: Exclude<AnySupervisorEvaluationRequest, { event: "verify_entered" }>,
): SupervisorEvaluationResponse {
  const card = normalizeCard(raw.card, evaluationId, request);
  const expectedType = EVENT_CARD_TYPES[request.event];
  if (!card || card.type !== expectedType) {
    return {
      status: "dropped",
      evaluationId,
      dropReason: "disallowed_concern",
    };
  }

  const eventAllowed = EVENT_ACTIONS[request.event];
  const allowed = new Set(
    request.allowedActionIds.filter((actionId) => eventAllowed?.has(actionId)),
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
    if (request && request.event !== "verify_entered") {
      return normalizeExpandedShownResponse(raw, evaluationId, request);
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
  // Thread the active UI locale so the backend supervisor (LLM question +
  // locale-aware card titles/messages) responds in the user's language.
  const requestWithLocale = {
    ...request,
    locale: request.locale ?? useLocaleStore.getState().locale,
  };
  const response = await api.invoke<unknown>("provocation_agent_evaluate", {
    request: requestWithLocale,
  });
  return normalizeSupervisorEvaluationResponse(response, request);
}
