import { shouldShowProvocationCardInMode, sortProvocationCards } from "./priority";
import { hasAiSelfReport, hasObservedVerificationEvidence } from "./verificationStatus";
import type {
  ChangedFileCategory,
  DiveStage,
  ProvocationAction,
  ProvocationCard,
  ProvocationChangedFile,
  ProvocationContext,
  ProvocationEvidence,
  ProvocationPlanStep,
  ProvocationSeverity,
} from "./types";

const DEFAULT_CREATED_AT = "1970-01-01T00:00:00.000Z";

const FEATURE_KEYWORDS = [
  "로그인",
  "로그아웃",
  "회원가입",
  "관리자",
  "대시보드",
  "결제",
  "권한",
  "프로필",
  "검색",
  "필터",
  "업로드",
  "알림",
  "온보딩",
  "api",
  "db",
  "database",
  "데이터베이스",
  "배포",
  "deploy",
  "auth",
  "admin",
  "dashboard",
  "payment",
  "routing",
  "settings",
  "export",
  "preview",
];

const SCOPE_CONNECTORS = [
  "그리고",
  "또",
  "또한",
  "추가로",
  "게다가",
  "및",
  "as well as",
  "and also",
  "also add",
];

const SCOPE_EXPANSION_TERMS = [
  "까지",
  "한번에",
  "한 번에",
  "전체",
  "모두",
  "전부",
  "다 같이",
  "all at once",
  "entire",
  "whole",
  "everything",
];

const SMALL_SINGLE_SCOPE_GUARDS = [
  "문구만",
  "텍스트만",
  "라벨만",
  "색상만",
  "버튼만",
  "오타",
  "typo",
  "copy only",
  "label only",
  "text only",
];

const VAGUE_GOAL_TERMS = [
  "좋게",
  "예쁘게",
  "잘 되게",
  "알아서",
  "완성해줘",
  "개선해줘",
  "고쳐줘",
  "대충",
  "better",
  "nice",
  "polish",
  "improve",
  "finish it",
  "make it work",
];

const VERIFICATION_TERMS = [
  "검증",
  "확인",
  "테스트",
  "실행",
  "미리보기",
  "프리뷰",
  "비교",
  "재현",
  "test",
  "run",
  "preview",
  "verify",
  "check",
  "assert",
  "compare",
  "repro",
];

const HIGH_RISK_PATH_PATTERNS = [
  /(^|\/)package\.json$/i,
  /(^|\/)(pnpm-lock|package-lock|yarn)\.lock$/i,
  /(^|\/)\.env($|\.)/i,
  /(^|\/)(vite|webpack|rollup|eslint|tsconfig|tailwind|postcss)\.[cm]?[jt]s$/i,
  /(^|\/)(schema|migration|migrations|db|database)(\/|\.|$)/i,
  /(^|\/)(auth|oauth|permission|policy|security)(\/|\.|$)/i,
  /(^|\/)(route|routes|router|routing)(\/|\.|$)/i,
];

const GOAL_CATEGORY_TERMS: Record<ChangedFileCategory, string[]> = {
  ui: ["ui", "화면", "버튼", "스타일", "텍스트", "레이아웃", "css", "component"],
  logic: ["logic", "로직", "동작", "behavior", "state"],
  config: ["config", "설정", "환경", "빌드", "vite", "tsconfig"],
  dependency: ["dependency", "dependencies", "의존성", "패키지", "package"],
  auth: ["auth", "login", "oauth", "로그인", "인증"],
  db: ["db", "database", "데이터베이스", "schema", "migration"],
  test: ["test", "테스트", "spec", "검증"],
  routing: ["route", "routing", "라우팅", "페이지"],
  unknown: [],
};

function normalizedText(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function combinedTaskText(context: ProvocationContext): string {
  return [context.goalText, context.currentFeatureTitle, context.promptDraft]
    .map((item) => item?.trim())
    .filter(Boolean)
    .join("\n");
}

function countTermHits(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.filter((term) => lower.includes(term.toLowerCase())).length;
}

function termHits(text: string, terms: string[]): string[] {
  const lower = text.toLowerCase();
  return terms.filter((term) => lower.includes(term.toLowerCase()));
}

function separatorCount(text: string): number {
  const listSeparators = text.match(/[,;/、]/g)?.length ?? 0;
  const nonEmptyLines = text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  return listSeparators + Math.max(0, nonEmptyLines - 1);
}

function bulletCount(text: string): number {
  return text.split(/\r?\n/).filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+\S+/.test(line)).length;
}

function criteriaPresent(criteria: string[] | undefined): boolean {
  return Boolean(criteria?.some((item) => item.trim().length > 0));
}

function idFor(type: ProvocationCard["type"], context: ProvocationContext): string {
  const task = context.taskId ?? context.featureId ?? "context";
  return `${type}:${context.stage}:${task}`;
}

function card({
  context,
  type,
  severity,
  stage,
  title,
  prompt,
  message,
  evidence,
  actions,
  primaryActionId,
  guided,
  metadata,
}: {
  context: ProvocationContext;
  type: ProvocationCard["type"];
  severity: ProvocationSeverity;
  stage?: DiveStage;
  title: string;
  prompt?: string;
  message: string;
  evidence: ProvocationEvidence[];
  actions: ProvocationAction[];
  primaryActionId?: string;
  guided: string;
  metadata?: Record<string, unknown>;
}): ProvocationCard {
  return {
    id: idFor(type, context),
    type,
    stage: stage ?? context.stage,
    severity,
    title,
    prompt,
    message,
    evidence,
    actions,
    primaryActionId,
    modeCopy: {
      guided,
    },
    metadata,
    createdAt: DEFAULT_CREATED_AT,
  };
}

function action(
  id: string,
  label: string,
  kind: ProvocationAction["kind"],
  requiresReason = false,
  reasonPrompt?: string,
) {
  const base = { id, label, kind, requiresReason };
  return reasonPrompt ? { ...base, reasonPrompt } : base;
}

function hasVerificationStep(steps: ProvocationPlanStep[] | undefined): boolean {
  return Boolean(
    steps?.some((step) => {
      const explicitVerification = [
        step.kind,
        step.verificationCommand,
        step.verificationManualCheck,
      ]
        .map((item) => item?.trim())
        .filter((item): item is string => Boolean(item && item !== "none"));
      if (explicitVerification.length > 0) return true;
      const haystack = step.text.toLowerCase();
      return VERIFICATION_TERMS.some((term) => haystack.includes(term.toLowerCase()));
    }),
  );
}

function categorizePath(path: string): ChangedFileCategory {
  const lower = path.toLowerCase();
  if (HIGH_RISK_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    if (/(package|lock)/i.test(path)) return "dependency";
    if (/(auth|oauth|permission|policy|security)/i.test(path)) return "auth";
    if (/(schema|migration|db|database)/i.test(path)) return "db";
    return "config";
  }
  if (/(route|router|page)/.test(lower)) return "routing";
  if (/(\.test\.|\.spec\.)/.test(lower)) return "test";
  if (/\.(css|scss|tsx|jsx)$/.test(lower)) return "ui";
  if (/\.(ts|js|rs)$/.test(lower)) return "logic";
  return "unknown";
}

function highRiskFile(file: ProvocationChangedFile): boolean {
  return Boolean(
    file.changeType === "deleted" ||
    file.category === "dependency" ||
    file.category === "config" ||
    file.category === "auth" ||
    file.category === "db" ||
    file.category === "routing" ||
    HIGH_RISK_PATH_PATTERNS.some((pattern) => pattern.test(file.path)),
  );
}

function pathMatchesTarget(
  file: ProvocationChangedFile,
  targetFiles: string[] | undefined,
): boolean {
  if (!targetFiles || targetFiles.length === 0) return false;
  return targetFiles.some((target) => {
    const normalizedTarget = target.trim();
    if (!normalizedTarget) return false;
    return file.path === normalizedTarget || file.path.endsWith(`/${normalizedTarget}`);
  });
}

function categoryMatchesGoal(file: ProvocationChangedFile, goal: string): boolean {
  const category = file.category ?? categorizePath(file.path);
  const terms = GOAL_CATEGORY_TERMS[category] ?? [];
  return terms.some((term) => goal.includes(term.toLowerCase()));
}

function unrelatedChangedFiles(context: ProvocationContext): ProvocationChangedFile[] {
  const goal = normalizedText(combinedTaskText(context));
  return (context.changedFiles ?? []).filter((file) => {
    if (pathMatchesTarget(file, context.targetFiles)) return false;
    if (categoryMatchesGoal(file, goal)) return false;
    return highRiskFile(file);
  });
}

function compactFileList(files: ProvocationChangedFile[]): string {
  return files
    .slice(0, 3)
    .map((file) => file.path)
    .join(", ");
}

function normalizedErrorKey(error: { message: string; normalizedMessage?: string }): string {
  return (error.normalizedMessage ?? error.message).trim().toLowerCase().slice(0, 240);
}

function expectedFileCount(context: ProvocationContext): number {
  const files = new Set<string>();
  for (const file of context.targetFiles ?? []) {
    const trimmed = file.trim();
    if (trimmed) files.add(trimmed);
  }
  for (const step of context.planSteps ?? []) {
    for (const file of step.expectedFiles ?? []) {
      const trimmed = file.trim();
      if (trimmed) files.add(trimmed);
    }
  }
  return files.size;
}

export function oversizedScopeRule(context: ProvocationContext): ProvocationCard | null {
  const text = combinedTaskText(context);
  if (!text.trim()) return null;

  const featureHits = termHits(text, FEATURE_KEYWORDS);
  const features = featureHits.length;
  const connectors = countTermHits(text, SCOPE_CONNECTORS);
  const separators = separatorCount(text);
  const expansions = countTermHits(text, SCOPE_EXPANSION_TERMS);
  const smallSingleScope = countTermHits(text, SMALL_SINGLE_SCOPE_GUARDS) > 0;
  const bullets = bulletCount(text);
  const planSteps = context.planSteps?.length ?? 0;
  const expectedFiles = expectedFileCount(context);
  const multiScopeSignal = connectors + separators + expansions;

  if (smallSingleScope && features <= 1 && bullets <= 1 && planSteps <= 2 && expectedFiles <= 2) {
    return null;
  }

  if (
    bullets <= 3 &&
    planSteps < 7 &&
    expectedFiles < 7 &&
    features < 4 &&
    !(features >= 3 && multiScopeSignal >= 1) &&
    !(features >= 2 && expansions >= 1 && multiScopeSignal >= 2)
  ) {
    return null;
  }

  const evidence: ProvocationEvidence[] = [];
  if (features >= 3) {
    evidence.push({
      source: "prompt",
      label: "여러 기능 신호",
      value: `${features}개`,
    });
  }
  if (connectors >= 1) {
    evidence.push({ source: "prompt", label: "연결어", value: `${connectors}개` });
  }
  if (separators >= 1) {
    evidence.push({ source: "prompt", label: "나열 구분자", value: `${separators}개` });
  }
  if (expansions >= 1) {
    evidence.push({ source: "prompt", label: "범위 확장 표현", value: `${expansions}개` });
  }
  if (bullets > 3) {
    evidence.push({ source: "prompt", label: "기능 bullet", value: `${bullets}개` });
  }
  if (planSteps >= 7) {
    evidence.push({ source: "plan", label: "단일 작업 아래 plan step", value: `${planSteps}개` });
  }
  if (expectedFiles >= 7) {
    evidence.push({ source: "plan", label: "예상 파일", value: `${expectedFiles}개` });
  }

  return card({
    context,
    type: "oversized_scope",
    severity: "caution",
    title: "작업 범위가 너무 큽니다",
    prompt: "이걸 한 번에 AI에게 맡기는 게 맞나요?",
    message:
      "이 요청은 기능 하나가 아니라 여러 작업을 한 번에 맡기는 형태입니다. 실패하면 어디서 잘못됐는지 추적하기 어렵습니다.",
    evidence,
    guided: "범위를 작게 나누면 AI 결과를 파일, 동작, 검증 기준별로 확인하기 쉬워집니다.",
    actions: [
      action("split", "기능으로 나누기", "split_scope"),
      action("first", "첫 기능만 요청하기", "split_scope"),
      action("continue", "그대로 진행", "continue_with_risk"),
    ],
    primaryActionId: "split",
  });
}

export function missingAcceptanceCriteriaRule(context: ProvocationContext): ProvocationCard | null {
  const text = combinedTaskText(context);
  if (!text.trim() || criteriaPresent(context.acceptanceCriteria)) return null;

  const vagueHits = countTermHits(text, VAGUE_GOAL_TERMS);
  const evidence: ProvocationEvidence[] = [{ source: "goal", label: "완료 기준", value: "없음" }];
  if (vagueHits > 0) {
    evidence.push({ source: "goal", label: "모호한 표현", value: `${vagueHits}개` });
  }

  return card({
    context,
    type: "missing_acceptance_criteria",
    severity: "caution",
    title: "완료 기준이 없습니다",
    message: "나중에 AI 결과를 검증하려면, 무엇이 보이면 끝난 것인지 먼저 정해야 합니다.",
    prompt: "이 기능이 끝났다고 무엇을 보면 알 수 있나요?",
    evidence,
    guided:
      "완료 기준은 AI가 만든 결과를 사용자 눈으로 확인할 수 있는 관찰 가능한 문장이어야 합니다.",
    actions: [
      action("add", "완료 기준 추가", "add_acceptance_criteria"),
      action("example", "예시 입력/출력 추가", "add_acceptance_criteria"),
      action("continue", "그대로 진행", "continue_with_risk"),
    ],
    primaryActionId: "add",
  });
}

export function missingVerificationStepRule(context: ProvocationContext): ProvocationCard | null {
  const steps = context.planSteps ?? [];
  if (steps.length === 0 || hasVerificationStep(steps)) return null;

  return card({
    context,
    type: "missing_verification_step",
    severity: "caution",
    title: "검증 단계가 빠졌습니다",
    message: "이 계획에는 만드는 단계는 있지만, 틀렸음을 확인하는 단계가 없습니다.",
    prompt: "이 계획이 틀렸는지 무엇으로 확인할 건가요?",
    evidence: [
      { source: "plan", label: "plan step", value: `${steps.length}개` },
      { source: "plan", label: "검증/실행/테스트 단계", value: "없음" },
    ],
    guided: "AI가 만든 뒤 무엇을 실행하거나 비교해야 하는지 계획에 있어야 승인 판단이 쉬워집니다.",
    actions: [
      action("add", "검증 단계 추가", "add_verification_step"),
      action("test", "테스트/프리뷰 확인 추가", "add_verification_step"),
      action("continue", "그대로 승인", "continue_with_risk"),
    ],
    primaryActionId: "add",
  });
}

export function diffScopeDriftRule(context: ProvocationContext): ProvocationCard | null {
  const files = context.changedFiles ?? [];
  if (files.length === 0) return null;

  const unrelated = unrelatedChangedFiles(context);
  if (unrelated.length === 0) return null;

  const highRisk = unrelated.some(highRiskFile);

  return card({
    context,
    type: "diff_scope_drift",
    severity: highRisk ? "risk" : "caution",
    title: "목표 밖 변경이 섞였을 수 있습니다",
    prompt: "이 변경이 지금 목표에 정말 필요한가요? 직접 보고 판단해 주세요.",
    message:
      "현재 목표와 직접 관련 없어 보이는 파일이 함께 바뀌었습니다. 이 변경이 꼭 필요한지 확인하세요.",
    evidence: [
      { source: "diff", label: "관련 확인 필요 파일", value: compactFileList(unrelated) },
      { source: "goal", label: "목표/대상 파일과 직접 연결", value: "확인되지 않음" },
    ],
    guided:
      "목표 밖 파일이 바뀌면 작동은 되어 보여도 설정, 인증, 데이터, 의존성 쪽 부작용이 생길 수 있습니다.",
    actions: [
      action("diff", "파일별 Diff 보기", "open_diff"),
      action("rationale", "AI에게 변경 이유 묻기", "ask_ai_for_rationale"),
      action("revert", "관련 없는 변경 되돌리기", "revert_unrelated_changes"),
      action(
        "risk",
        "위험 감수하고 수용",
        "continue_with_risk",
        true,
        "이 목표 밖 변경을 수용하는 이유는 무엇인가요?",
      ),
    ],
    primaryActionId: "diff",
    metadata: {
      highRisk,
      changedFileCount: unrelated.length,
      changedFiles: unrelated.map((file) => file.path),
      highRiskFiles: unrelated.filter(highRiskFile).map((file) => file.path),
    },
  });
}

export function aiSelfReportOnlyRule(context: ProvocationContext): ProvocationCard | null {
  if (!hasAiSelfReport(context) || hasObservedVerificationEvidence(context)) {
    return null;
  }

  const assistantReportCount =
    context.assistantReports?.filter((item) => item.source === "assistant_message").length ?? 0;

  return card({
    context,
    type: "ai_self_report_only",
    severity: "risk",
    title: "AI의 완료 보고만 있습니다",
    prompt: "AI는 완료라고 했습니다. 당신은 무엇을 보고 확인했나요?",
    message: "AI의 '완료했습니다'는 검증 증거가 아닙니다. 지금 확인된 것은 AI의 주장뿐입니다.",
    evidence: [
      {
        source: "agent",
        label: "AI 완료 보고",
        value: assistantReportCount > 0 ? `assistant 메시지 ${assistantReportCount}개` : "있음",
      },
      { source: "verification", label: "Diff/실행/프리뷰/테스트 증거", value: "없음" },
    ],
    guided:
      "검증은 AI의 말이 아니라 사용자가 본 diff, 실행 결과, 프리뷰, 테스트 같은 외부 증거로 구분해야 합니다.",
    actions: [
      action("run", "앱 실행", "run_app"),
      action("preview", "프리뷰 확인", "open_preview"),
      action("test", "테스트 실행", "run_tests"),
      action(
        "risk",
        "미검증 상태로 승인",
        "continue_with_risk",
        true,
        "무엇을 근거로 미검증 상태를 수용하나요?",
      ),
    ],
    primaryActionId: "run",
  });
}

export function regenerationLoopRule(context: ProvocationContext): ProvocationCard | null {
  const retryCount = context.retryCountForCurrentError ?? 0;
  const errors = context.recentErrors ?? [];
  const retrySignals = (context.retrySignals ?? []).filter(
    (signal) => signal.retryCount >= 2 && !signal.rollbackOrReproMentioned && !signal.scopeNarrowed,
  );
  const counts = new Map<string, number>();
  for (const error of errors) {
    const key = normalizedErrorKey(error);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeatedErrorCount = Math.max(0, ...counts.values());
  const conversationRetryCount = Math.max(0, ...retrySignals.map((signal) => signal.retryCount));

  if (retryCount < 3 && repeatedErrorCount < 3 && conversationRetryCount < 2) return null;

  const evidence: ProvocationEvidence[] = [];
  if (retryCount >= 3) {
    evidence.push({ source: "history", label: "같은 실패 재시도", value: `${retryCount}회` });
  }
  if (conversationRetryCount >= 2) {
    evidence.push({
      source: "history",
      label: "같은 오류 후 반복 요청",
      value: `${conversationRetryCount}회`,
    });
  }
  if (repeatedErrorCount >= 3) {
    evidence.push({ source: "terminal", label: "반복 오류", value: `${repeatedErrorCount}회` });
  }

  return card({
    context,
    type: "regeneration_loop",
    severity: "risk",
    title: "재생성 반복 상태입니다",
    prompt: "지금은 더 고칠 때인가요, 마지막 변경을 되돌릴 때인가요?",
    message:
      "지금은 계속 '고쳐줘'를 반복할 때가 아니라, 오류를 좁히거나 마지막 변경을 되돌릴 때입니다.",
    evidence,
    guided:
      "같은 오류가 반복될 때는 새 코드를 더 만들기보다 재현 조건과 마지막 변경을 좁히는 편이 안전합니다.",
    actions: [
      action("rollback", "마지막 변경 되돌리기", "rollback_last_change"),
      action("repro", "에러 로그 요약 / 재현 단계 만들기", "create_repro_steps"),
      action("split", "범위 줄이기 / 계획 조정", "split_scope"),
      action("retry", "AI 재시도", "retry_with_ai"),
    ],
    primaryActionId: "rollback",
    metadata: {
      retrySignalCount: retrySignals.length,
      repeatedErrorCount,
      conversationRetryCount,
    },
  });
}

export const PROVOCATION_RULES = [
  diffScopeDriftRule,
  aiSelfReportOnlyRule,
  regenerationLoopRule,
  missingVerificationStepRule,
  missingAcceptanceCriteriaRule,
  oversizedScopeRule,
] as const;

// Internal quarantine only. Shipped add-step scope-expansion cards come from
// the SupervisorAgent path, not frontend rule-card generation.
export function isQuarantinedRuleCardGenerationEnabled(): boolean {
  return (
    import.meta.env.DEV === true &&
    import.meta.env.VITE_DIVE_INTERNAL_PROVOCATION_RULE_CARDS === "true"
  );
}

function hasRetryEvidence(context: ProvocationContext): boolean {
  return Boolean(
    context.retryCountForCurrentError ||
    context.recentErrors?.length ||
    context.retrySignals?.some((signal) => signal.retryCount > 0),
  );
}

function cardEligibleForStage(card: ProvocationCard, context: ProvocationContext): boolean {
  switch (card.type) {
    case "oversized_scope":
      return context.stage === "decompose" || context.stage === "instruct";
    case "scope_expansion":
      return false;
    case "missing_acceptance_criteria":
      return context.stage === "decompose" || context.stage === "instruct";
    case "missing_verification_step":
      return context.stage === "instruct";
    case "diff_scope_drift":
      return (
        (context.stage === "execute" ||
          context.stage === "verify" ||
          context.stage === "finalApproval") &&
        Boolean(context.changedFiles?.length)
      );
    case "ai_self_report_only":
      return context.stage === "verify" || context.stage === "finalApproval";
    case "regeneration_loop":
      return (
        (context.stage === "execute" || context.stage === "verify") && hasRetryEvidence(context)
      );
  }
}

export function generateQuarantinedRuleProvocationCards(
  context: ProvocationContext,
): ProvocationCard[] {
  const cards = PROVOCATION_RULES.map((rule) => rule(context)).filter(
    (candidate): candidate is ProvocationCard => candidate !== null,
  );
  const eligible = cards.filter((candidate) => cardEligibleForStage(candidate, context));
  const visible = eligible.filter((candidate) =>
    shouldShowProvocationCardInMode(candidate, context.mode),
  );
  return sortProvocationCards(visible);
}

export function generateProvocationCards(context: ProvocationContext): ProvocationCard[] {
  if (!isQuarantinedRuleCardGenerationEnabled()) return [];
  return generateQuarantinedRuleProvocationCards(context);
}
