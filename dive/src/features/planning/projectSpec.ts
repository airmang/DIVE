import type {
  AcceptanceCriterion,
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

interface CreateLiveProjectSpecDraftOverrides extends Partial<ProjectSpecDraft> {
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
