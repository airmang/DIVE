import type {
  AcceptanceCriterion,
  AcceptanceCriterionInput,
  AcceptanceCriterionSource,
  LiveProjectSpecDraft,
  ProjectSpecDraft,
  ProvenanceSource,
} from "./types";

export const DEFAULT_PROJECT_SPEC_VERSION = 1;
export const ACCEPTANCE_CRITERION_ID_PREFIX = "AC";

// S-053 D3: the only field paths markDraftStudentEdited stamps into
// fieldProvenance. acceptanceCriteria (own per-criterion `source`) and
// architecture (own `decisionSource`) are deliberately excluded — see the
// ProvenanceSource doc comment in types.ts for the boundary.
const PROVENANCE_TRACKED_FIELDS = new Set([
  "goal",
  "intentSummary",
  "scope",
  "nonGoals",
  "constraints",
]);

function fieldPathRoot(path: string): string {
  return path.split(".")[0] ?? path;
}

export type MinimalProjectSpecReasonCode = "missing_goal" | "missing_acceptance_criterion";
export type ConfirmableProjectSpecReasonCode =
  | MinimalProjectSpecReasonCode
  | "vague_goal"
  | "missing_intent_summary"
  | "missing_scope"
  | "missing_non_goals"
  | "insufficient_acceptance_criteria"
  // S-047 (010 theme 7): architecture is a two-stage decision — the student picks
  // a form first, then decides a stack. Both are part of the confirmable bar so a
  // PRD cannot be saved with the shape left implicit. Mirrors the Rust
  // confirmable_draft_gaps() ordering (form gap, then stack gap).
  | "missing_architecture_form"
  | "missing_architecture_stack";

export interface MinimalProjectSpecValidation {
  valid: boolean;
  reasonCodes: MinimalProjectSpecReasonCode[];
}

export interface ConfirmableProjectSpecValidation {
  valid: boolean;
  reasonCodes: ConfirmableProjectSpecReasonCode[];
}

interface AdaptAcceptanceCriteriaOptions {
  version?: number;
  source?: AcceptanceCriterionSource;
}

interface CreateLiveProjectSpecDraftOverrides extends Omit<
  Partial<ProjectSpecDraft>,
  "acceptanceCriteria"
> {
  acceptanceCriteria?: unknown;
  draftId?: string;
  baseVersion?: number | null;
  dirtyFields?: string[];
  studentEditedFields?: string[];
  lastPatchId?: string | null;
  fieldProvenance?: Record<string, ProvenanceSource>;
  updatedAt?: number;
}

function compactUnique(values: string[]): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (value.length > 0 && !out.includes(value)) {
      out.push(value);
    }
  }
  return out;
}

function isCriterionSource(value: unknown): value is AcceptanceCriterionSource {
  return (
    value === "interview" ||
    value === "student_edit" ||
    value === "plan_mutation" ||
    value === "migration"
  );
}

export function isValidCriterionId(
  criterionId: string,
  prefix = ACCEPTANCE_CRITERION_ID_PREFIX,
): boolean {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const match = criterionId.trim().match(pattern);
  return match ? Number.parseInt(match[1], 10) > 0 : false;
}

function isAcceptanceCriterionShape(value: unknown): value is AcceptanceCriterion {
  if (typeof value !== "object" || value === null) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.criterionId === "string" &&
    source.criterionId.trim().length > 0 &&
    typeof source.text === "string" &&
    source.text.trim().length > 0 &&
    isCriterionSource(source.source) &&
    (source.status === "active" || source.status === "retired") &&
    typeof source.createdInVersion === "number" &&
    Number.isFinite(source.createdInVersion) &&
    (source.retiredInVersion === null ||
      (typeof source.retiredInVersion === "number" && Number.isFinite(source.retiredInVersion)))
  );
}

function isAcceptanceCriterion(value: unknown): value is AcceptanceCriterion {
  return isAcceptanceCriterionShape(value) && isValidCriterionId(value.criterionId);
}

export function allocateCriterionId(
  criteria: AcceptanceCriterion[],
  prefix = ACCEPTANCE_CRITERION_ID_PREFIX,
): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const max = criteria.reduce((current, criterion) => {
    const match = criterion.criterionId.match(pattern);
    if (!match) return current;
    return Math.max(current, Number.parseInt(match[1], 10));
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export function adaptAcceptanceCriteria(
  value: unknown,
  options: AdaptAcceptanceCriteriaOptions = {},
): AcceptanceCriterion[] {
  if (!Array.isArray(value)) return [];
  const version = options.version ?? DEFAULT_PROJECT_SPEC_VERSION;
  const source = options.source ?? "migration";
  const criteria: AcceptanceCriterion[] = [];

  for (const item of value) {
    if (isAcceptanceCriterion(item)) {
      criteria.push({ ...item, text: item.text.trim(), criterionId: item.criterionId.trim() });
      continue;
    }
    if (isAcceptanceCriterionShape(item)) {
      const criterionId = item.criterionId.trim();
      criteria.push({
        ...item,
        text: item.text.trim(),
        criterionId:
          isValidCriterionId(criterionId) &&
          !criteria.some((criterion) => criterion.criterionId === criterionId)
            ? criterionId
            : allocateCriterionId(criteria),
      });
      continue;
    }
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text) continue;
    criteria.push({
      criterionId: allocateCriterionId(criteria),
      text,
      source,
      status: "active",
      createdInVersion: version,
      retiredInVersion: null,
    });
  }

  return criteria;
}

export interface LinkedCriterionView {
  criterionId: string;
  text: string;
}

export interface StepCriteriaMetadata {
  criteria: AcceptanceCriterion[];
  linkedCriterionIds: string[];
  linkedCriteria: LinkedCriterionView[];
  rationale: string | null;
  riskNotes: string[];
}

interface NormalizeStepCriteriaOptions {
  linkedCriterionIds?: unknown;
  rationale?: unknown;
  riskNotes?: unknown;
  version?: number;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function valueObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstArray(value: unknown, keys: string[]): unknown {
  const object = valueObject(value);
  if (!object) return value;
  for (const key of keys) {
    const candidate = object[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return value;
}

function collectCriterionIds(criteria: AcceptanceCriterion[]): string[] {
  return compactUnique(criteria.map((criterion) => criterion.criterionId));
}

function linkedCriteriaFor(
  criteria: AcceptanceCriterion[],
  linkedCriterionIds: string[],
): LinkedCriterionView[] {
  const byId = new Map(criteria.map((criterion) => [criterion.criterionId, criterion]));
  return linkedCriterionIds.map((criterionId) => {
    const criterion = byId.get(criterionId);
    return {
      criterionId,
      text: criterion?.text ?? criterionId,
    };
  });
}

export function normalizeStepCriteria(
  value: unknown,
  options: NormalizeStepCriteriaOptions = {},
): StepCriteriaMetadata {
  const object = valueObject(value);
  const criteriaSource = firstArray(value, [
    "criteria",
    "acceptanceCriteria",
    "acceptance_criteria",
  ]);
  const criteria = adaptAcceptanceCriteria(criteriaSource, {
    version: options.version,
    source: "migration",
  });
  const linkedCriterionIds = compactUnique([
    ...stringArray(options.linkedCriterionIds),
    ...stringArray(object?.linkedCriterionIds),
    ...stringArray(object?.linked_criterion_ids),
    ...collectCriterionIds(criteria),
  ]);
  const rationale =
    optionalString(options.rationale) ??
    optionalString(object?.rationale) ??
    optionalString(object?.decompositionRationale) ??
    optionalString(object?.decomposition_rationale) ??
    (Array.isArray(value)
      ? (value
          .map((item) => optionalString(valueObject(item)?.rationale))
          .find((item): item is string => Boolean(item)) ?? null)
      : null);
  const riskNotes = compactUnique([
    ...stringArray(options.riskNotes),
    ...stringArray(object?.riskNotes),
    ...stringArray(object?.risk_notes),
  ]);

  return {
    criteria,
    linkedCriterionIds,
    linkedCriteria: linkedCriteriaFor(criteria, linkedCriterionIds),
    rationale,
    riskNotes,
  };
}

export function criterionTexts(value: unknown): string[] {
  return adaptAcceptanceCriteria(value).map((criterion) => criterion.text);
}

export function criterionInputsToCriteria(
  value: AcceptanceCriterionInput[],
): AcceptanceCriterion[] {
  return adaptAcceptanceCriteria(value);
}

export function createLiveProjectSpecDraft(
  projectId: number,
  overrides: CreateLiveProjectSpecDraftOverrides = {},
): LiveProjectSpecDraft {
  const now = overrides.updatedAt ?? Date.now();
  const spec: ProjectSpecDraft = {
    projectSpecId: overrides.projectSpecId,
    projectId,
    currentVersion: overrides.currentVersion,
    goal: overrides.goal ?? "",
    intentSummary: overrides.intentSummary ?? null,
    scope: compactUnique(overrides.scope ?? []),
    nonGoals: compactUnique(overrides.nonGoals ?? []),
    constraints: compactUnique(overrides.constraints ?? []),
    acceptanceCriteria: adaptAcceptanceCriteria(overrides.acceptanceCriteria ?? [], {
      version: overrides.currentVersion ?? DEFAULT_PROJECT_SPEC_VERSION,
    }),
    architecture: overrides.architecture ?? null,
    status: overrides.status ?? "draft",
  };

  return {
    draftId: overrides.draftId ?? `prd-draft-${projectId}`,
    projectId,
    baseVersion: overrides.baseVersion ?? null,
    spec,
    dirtyFields: compactUnique(overrides.dirtyFields ?? []),
    studentEditedFields: compactUnique(overrides.studentEditedFields ?? []),
    lastPatchId: overrides.lastPatchId ?? null,
    fieldProvenance: overrides.fieldProvenance ?? {},
    updatedAt: now,
  };
}

export function validateMinimalProjectSpec(
  spec: Pick<ProjectSpecDraft, "goal" | "acceptanceCriteria">,
): MinimalProjectSpecValidation {
  const reasonCodes: MinimalProjectSpecReasonCode[] = [];
  if (!spec.goal.trim()) {
    reasonCodes.push("missing_goal");
  }
  const hasActiveCriterion = spec.acceptanceCriteria.some(
    (criterion) => criterion.status === "active" && criterion.text.trim().length > 0,
  );
  if (!hasActiveCriterion) {
    reasonCodes.push("missing_acceptance_criterion");
  }
  return {
    valid: reasonCodes.length === 0,
    reasonCodes,
  };
}

// A confirmable PRD must be concrete, not merely non-empty. These thresholds are
// deliberately modest backstops; the interview prompt is the primary driver of
// specificity. They exist so a one-line vague answer cannot be confirmed.
const MIN_GOAL_LENGTH = 10;
const MIN_INTENT_LENGTH = 8;
const MIN_LIST_ITEM_LENGTH = 4;
const MIN_CRITERION_LENGTH = 6;
const MIN_ACCEPTANCE_CRITERIA = 2;
const VAGUE_GOAL_TERMS = [
  "대충",
  "적당히",
  "알아서",
  "아무거나",
  "뭔가",
  "그냥 만들",
  "그냥 해",
  "something",
  "whatever",
  "anything",
];

function isSubstantiveText(value: string | null | undefined, min: number): boolean {
  return typeof value === "string" && value.trim().length >= min;
}

function isVagueGoal(goal: string): boolean {
  const trimmed = goal.trim();
  if (trimmed.length < MIN_GOAL_LENGTH) return true;
  // Short goals dominated by filler words ("대충 만들어줘", "just do something").
  const lower = trimmed.toLowerCase();
  return trimmed.length < 24 && VAGUE_GOAL_TERMS.some((term) => lower.includes(term.toLowerCase()));
}

function substantiveListCount(values: string[]): number {
  return values.filter((value) => value.trim().length >= MIN_LIST_ITEM_LENGTH).length;
}

function substantiveActiveCriteriaCount(criteria: AcceptanceCriterion[]): number {
  return criteria.filter(
    (criterion) =>
      criterion.status === "active" && criterion.text.trim().length >= MIN_CRITERION_LENGTH,
  ).length;
}

export function validateConfirmableProjectSpec(
  spec: Pick<
    ProjectSpecDraft,
    "goal" | "intentSummary" | "scope" | "nonGoals" | "acceptanceCriteria" | "architecture"
  >,
): ConfirmableProjectSpecValidation {
  const reasonCodes: ConfirmableProjectSpecReasonCode[] = [];

  const goal = spec.goal.trim();
  if (!goal) {
    reasonCodes.push("missing_goal");
  } else if (isVagueGoal(goal)) {
    reasonCodes.push("vague_goal");
  }

  if (!isSubstantiveText(spec.intentSummary, MIN_INTENT_LENGTH)) {
    reasonCodes.push("missing_intent_summary");
  }

  if (substantiveListCount(spec.scope) < 1) {
    reasonCodes.push("missing_scope");
  }

  if (substantiveListCount(spec.nonGoals) < 1) {
    reasonCodes.push("missing_non_goals");
  }

  if (substantiveActiveCriteriaCount(spec.acceptanceCriteria) < MIN_ACCEPTANCE_CRITERIA) {
    reasonCodes.push("insufficient_acceptance_criteria");
  }

  // Two-stage architecture gate (mirrors Rust confirmable_draft_gaps): a null
  // architecture still needs a form; a decided form still needs a stack.
  const architecture = spec.architecture ?? null;
  if (!architecture) {
    reasonCodes.push("missing_architecture_form");
  } else if (!isSubstantiveText(architecture.stack, 1)) {
    reasonCodes.push("missing_architecture_stack");
  }

  return {
    valid: reasonCodes.length === 0,
    reasonCodes,
  };
}

export function markDraftStudentEdited(
  draft: LiveProjectSpecDraft,
  fieldPaths: string[],
): LiveProjectSpecDraft {
  const normalized = compactUnique(fieldPaths);
  // S-053 D3: stamp `student` provenance for the tracked scalar/list fields
  // this edit touched. acceptanceCriteria and architecture edits also flow
  // through here (PrdAuthoringBoard.updateDraft is the single write path) but
  // are intentionally NOT stamped into this map — see PROVENANCE_TRACKED_FIELDS.
  const fieldProvenance = { ...draft.fieldProvenance };
  for (const path of normalized) {
    const root = fieldPathRoot(path);
    if (PROVENANCE_TRACKED_FIELDS.has(root)) {
      fieldProvenance[root] = "student";
    }
  }
  return {
    ...draft,
    dirtyFields: compactUnique([...draft.dirtyFields, ...normalized]),
    studentEditedFields: compactUnique([...draft.studentEditedFields, ...normalized]),
    fieldProvenance,
    updatedAt: Date.now(),
  };
}

// S-053 D3: which of the three intent-check framings applies, derived purely
// from the draft's field_provenance map (never the LLM). Field paths outside
// PROVENANCE_TRACKED_FIELDS never appear as keys, so this only ever looks at
// the five scalar/list fields.
export type PrdIntentCheckFraming = "ai" | "student" | "mixed";

export function prdIntentCheckFraming(
  fieldProvenance: Record<string, ProvenanceSource> | undefined,
): PrdIntentCheckFraming {
  const sources = Object.values(fieldProvenance ?? {});
  // Legacy fallback (design D3): a draft that predates this field, or one
  // authored entirely through a future untracked write path, has an empty
  // map. (Quick Intake is NOT such a path — applyQuickIntakeToDraft routes
  // through markDraftStudentEdited and stamps `student`.) Reuse the existing
  // "AI summarized this" framing unchanged rather than invent a fourth copy
  // variant for a case indistinguishable from the legacy one.
  if (sources.length === 0) return "ai";
  const allStudent = sources.every((source) => source === "student");
  if (allStudent) return "student";
  const allAi = sources.every(
    (source) => source === "ai_patch" || source === "ai_suggestion_accepted",
  );
  if (allAi) return "ai";
  return "mixed";
}

/** Field paths (map keys) the student wrote by hand — used to name them in the
 *  mixed intent-check framing. */
export function studentAuthoredFieldPaths(
  fieldProvenance: Record<string, ProvenanceSource> | undefined,
): string[] {
  return Object.entries(fieldProvenance ?? {})
    .filter(([, source]) => source === "student")
    .map(([field]) => field);
}

export function appendDraftDirtyFields(
  draft: LiveProjectSpecDraft,
  fieldPaths: string[],
): LiveProjectSpecDraft {
  return {
    ...draft,
    dirtyFields: compactUnique([...draft.dirtyFields, ...fieldPaths]),
    updatedAt: Date.now(),
  };
}
