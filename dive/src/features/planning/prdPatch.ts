import { allocateCriterionId, appendDraftDirtyFields } from "./projectSpec";
import type {
  AcceptanceCriterion,
  LiveProjectSpecDraft,
  PrdPatch,
  PrdPatchOperation,
  PrdPatchValidationOutcome,
} from "./types";

export type PrdPatchReasonCode =
  | "unsupported_operation"
  | "text_too_large"
  | "secret_like_text"
  | "missing_text"
  | "criterion_not_found"
  | "too_many_operations";

export interface PrdPatchValidationResult {
  valid: boolean;
  reasonCodes: PrdPatchReasonCode[];
}

export interface ApplyPrdPatchResult {
  draft: LiveProjectSpecDraft;
  outcome: PrdPatchValidationOutcome;
  reasonCodes: PrdPatchReasonCode[];
  appliedFieldPaths: string[];
  heldFieldPaths: string[];
  criterionIdsAssigned: string[];
  studentEditedFieldsRespected: string[];
}

const MAX_OPERATION_COUNT = 20;
const MAX_TEXT_LENGTH = 1200;
const SECRET_RE =
  /(sk-[A-Za-z0-9_-]{3,}|(?:api[_-]?key|token|secret|authorization|password)\s*[:=]\s*[A-Za-z0-9_.-]{4,}|bearer\s+[A-Za-z0-9_.-]{4,})/i;

function pushUnique<T>(items: T[], value: T): void {
  if (!items.includes(value)) {
    items.push(value);
  }
}

function operationText(operation: Record<string, unknown>): string | null {
  const raw = operation.text ?? operation.value;
  return typeof raw === "string" ? raw.trim() : null;
}

function isSupportedOperation(operation: Record<string, unknown>): operation is PrdPatchOperation {
  return (
    operation.op === "set_goal" ||
    operation.op === "set_intent_summary" ||
    operation.op === "append_scope" ||
    operation.op === "append_non_goal" ||
    operation.op === "append_constraint" ||
    operation.op === "append_acceptance_criterion" ||
    operation.op === "revise_acceptance_criterion_text"
  );
}

function fieldPathForOperation(operation: PrdPatchOperation): string {
  switch (operation.op) {
    case "set_goal":
      return "goal";
    case "set_intent_summary":
      return "intentSummary";
    case "append_scope":
      return "scope";
    case "append_non_goal":
      return "nonGoals";
    case "append_constraint":
      return "constraints";
    case "append_acceptance_criterion":
      return "acceptanceCriteria";
    case "revise_acceptance_criterion_text":
      return `acceptanceCriteria.${operation.criterionId}.text`;
  }
}

function conflictsWithStudentEdit(fieldPath: string, studentEditedFields: string[]): string | null {
  const root = fieldPath.split(".")[0];
  return studentEditedFields.find((field) => field === fieldPath || field === root) ?? null;
}

function appendString(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

export function validatePrdPatch(
  patch: PrdPatch,
  draft: LiveProjectSpecDraft,
): PrdPatchValidationResult {
  const reasonCodes: PrdPatchReasonCode[] = [];
  if (!Array.isArray(patch.operations) || patch.operations.length > MAX_OPERATION_COUNT) {
    pushUnique(reasonCodes, "too_many_operations");
  }

  for (const rawOperation of patch.operations ?? []) {
    if (typeof rawOperation !== "object" || rawOperation === null) {
      pushUnique(reasonCodes, "unsupported_operation");
      continue;
    }
    const operation = rawOperation as Record<string, unknown>;
    if (!isSupportedOperation(operation)) {
      pushUnique(reasonCodes, "unsupported_operation");
      continue;
    }
    const text = operationText(operation);
    if (!text) {
      pushUnique(reasonCodes, "missing_text");
      continue;
    }
    if (text.length > MAX_TEXT_LENGTH) {
      pushUnique(reasonCodes, "text_too_large");
    }
    if (SECRET_RE.test(text)) {
      pushUnique(reasonCodes, "secret_like_text");
    }
    if (
      operation.op === "revise_acceptance_criterion_text" &&
      !draft.spec.acceptanceCriteria.some(
        (criterion) => criterion.criterionId === operation.criterionId,
      )
    ) {
      pushUnique(reasonCodes, "criterion_not_found");
    }
  }

  return {
    valid: reasonCodes.length === 0,
    reasonCodes,
  };
}

export function applyPrdPatch(draft: LiveProjectSpecDraft, patch: PrdPatch): ApplyPrdPatchResult {
  const validation = validatePrdPatch(patch, draft);
  if (!validation.valid) {
    return {
      draft,
      outcome: "rejected",
      reasonCodes: validation.reasonCodes,
      appliedFieldPaths: [],
      heldFieldPaths: [],
      criterionIdsAssigned: [],
      studentEditedFieldsRespected: [],
    };
  }

  let nextDraft: LiveProjectSpecDraft = {
    ...draft,
    spec: {
      ...draft.spec,
      scope: [...draft.spec.scope],
      nonGoals: [...draft.spec.nonGoals],
      constraints: [...draft.spec.constraints],
      acceptanceCriteria: draft.spec.acceptanceCriteria.map((criterion) => ({ ...criterion })),
    },
    lastPatchId: patch.patchId,
  };
  const appliedFieldPaths: string[] = [];
  const heldFieldPaths: string[] = [];
  const criterionIdsAssigned: string[] = [];
  const studentEditedFieldsRespected: string[] = [];

  for (const operation of patch.operations) {
    const fieldPath = fieldPathForOperation(operation);
    const conflict = conflictsWithStudentEdit(fieldPath, draft.studentEditedFields);
    if (conflict) {
      pushUnique(heldFieldPaths, fieldPath.split(".")[0]);
      pushUnique(studentEditedFieldsRespected, conflict);
      continue;
    }

    switch (operation.op) {
      case "set_goal":
        nextDraft.spec.goal = operation.value.trim();
        pushUnique(appliedFieldPaths, "goal");
        break;
      case "set_intent_summary":
        nextDraft.spec.intentSummary = operation.value.trim();
        pushUnique(appliedFieldPaths, "intentSummary");
        break;
      case "append_scope":
        nextDraft.spec.scope = appendString(nextDraft.spec.scope, operation.value.trim());
        pushUnique(appliedFieldPaths, "scope");
        break;
      case "append_non_goal":
        nextDraft.spec.nonGoals = appendString(nextDraft.spec.nonGoals, operation.value.trim());
        pushUnique(appliedFieldPaths, "nonGoals");
        break;
      case "append_constraint":
        nextDraft.spec.constraints = appendString(
          nextDraft.spec.constraints,
          operation.value.trim(),
        );
        pushUnique(appliedFieldPaths, "constraints");
        break;
      case "append_acceptance_criterion": {
        const criterion: AcceptanceCriterion = {
          criterionId: allocateCriterionId(nextDraft.spec.acceptanceCriteria),
          text: operation.text.trim(),
          source: "interview",
          status: "active",
          createdInVersion: nextDraft.spec.currentVersion ?? 1,
          retiredInVersion: null,
        };
        nextDraft.spec.acceptanceCriteria = [...nextDraft.spec.acceptanceCriteria, criterion];
        pushUnique(criterionIdsAssigned, criterion.criterionId);
        pushUnique(appliedFieldPaths, "acceptanceCriteria");
        break;
      }
      case "revise_acceptance_criterion_text":
        nextDraft.spec.acceptanceCriteria = nextDraft.spec.acceptanceCriteria.map((criterion) =>
          criterion.criterionId === operation.criterionId
            ? { ...criterion, text: operation.text.trim() }
            : criterion,
        );
        pushUnique(appliedFieldPaths, fieldPath);
        break;
    }
  }

  nextDraft = appendDraftDirtyFields(nextDraft, appliedFieldPaths);
  const outcome: PrdPatchValidationOutcome =
    heldFieldPaths.length > 0
      ? "held_for_student"
      : appliedFieldPaths.length > 0
        ? "applied"
        : "none";

  return {
    draft: nextDraft,
    outcome,
    reasonCodes: [],
    appliedFieldPaths,
    heldFieldPaths,
    criterionIdsAssigned,
    studentEditedFieldsRespected,
  };
}
