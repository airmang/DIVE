import type {
  AcceptanceCriterion,
  AcceptanceCriterionInput,
  AcceptanceCriterionSource,
  LiveProjectSpecDraft,
  ProjectSpecDraft,
} from "./types";

export const DEFAULT_PROJECT_SPEC_VERSION = 1;
export const ACCEPTANCE_CRITERION_ID_PREFIX = "AC";

export type MinimalProjectSpecReasonCode = "missing_goal" | "missing_acceptance_criterion";

export interface MinimalProjectSpecValidation {
  valid: boolean;
  reasonCodes: MinimalProjectSpecReasonCode[];
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

function isAcceptanceCriterion(value: unknown): value is AcceptanceCriterion {
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

export function markDraftStudentEdited(
  draft: LiveProjectSpecDraft,
  fieldPaths: string[],
): LiveProjectSpecDraft {
  const normalized = compactUnique(fieldPaths);
  return {
    ...draft,
    dirtyFields: compactUnique([...draft.dirtyFields, ...normalized]),
    studentEditedFields: compactUnique([...draft.studentEditedFields, ...normalized]),
    updatedAt: Date.now(),
  };
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
