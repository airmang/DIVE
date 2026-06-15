import { describe, expect, it } from "vitest";
import { createLiveProjectSpecDraft, markDraftStudentEdited } from "./projectSpec";
import { applyPrdPatch, validatePrdPatch } from "./prdPatch";
import type { PrdPatch } from "./types";

describe("PRD patch helpers", () => {
  it("rejects unsupported operations, oversized changes, and secret-bearing text", () => {
    const draft = createLiveProjectSpecDraft(1);
    const invalid = {
      patchId: "patch-invalid",
      sourceTurnId: "turn-1",
      rationale: "Try unsafe updates",
      operations: [
        { op: "delete_goal", value: "nope" },
        { op: "set_goal", value: "x".repeat(1201) },
        { op: "append_constraint", value: "api_key=sk-secret-token" },
      ],
    } as unknown as PrdPatch;

    expect(validatePrdPatch(invalid, draft).reasonCodes).toEqual([
      "unsupported_operation",
      "text_too_large",
      "secret_like_text",
    ]);
  });

  it("merges allowed operations, assigns criterion IDs, and reports changed fields", () => {
    const draft = createLiveProjectSpecDraft(12);
    const patch: PrdPatch = {
      patchId: "patch-1",
      sourceTurnId: "turn-1",
      rationale: "The student described a testable todo goal.",
      operations: [
        { op: "set_goal", value: "Build a todo app" },
        { op: "set_intent_summary", value: "Practice a small CRUD flow" },
        { op: "append_scope", value: "Task creation" },
        { op: "append_acceptance_criterion", text: "User can add a task" },
      ],
    };

    const result = applyPrdPatch(draft, patch);

    expect(result.outcome).toBe("applied");
    expect(result.appliedFieldPaths).toEqual([
      "goal",
      "intentSummary",
      "scope",
      "acceptanceCriteria",
    ]);
    expect(result.criterionIdsAssigned).toEqual(["AC-001"]);
    expect(result.draft.spec.goal).toBe("Build a todo app");
    expect(result.draft.spec.acceptanceCriteria[0]).toMatchObject({
      criterionId: "AC-001",
      source: "interview",
      status: "active",
      text: "User can add a task",
    });
    expect(result.draft.lastPatchId).toBe("patch-1");
  });

  it("holds conflicting operations when a student edited the field", () => {
    const draft = markDraftStudentEdited(
      createLiveProjectSpecDraft(3, { goal: "Student-owned goal" }),
      ["goal"],
    );
    const patch: PrdPatch = {
      patchId: "patch-conflict",
      sourceTurnId: "turn-2",
      rationale: null,
      operations: [
        { op: "set_goal", value: "LLM overwrite" },
        { op: "append_constraint", value: "No cloud storage" },
      ],
    };

    const result = applyPrdPatch(draft, patch);

    expect(result.outcome).toBe("held_for_student");
    expect(result.studentEditedFieldsRespected).toEqual(["goal"]);
    expect(result.heldFieldPaths).toEqual(["goal"]);
    expect(result.appliedFieldPaths).toEqual(["constraints"]);
    expect(result.draft.spec.goal).toBe("Student-owned goal");
    expect(result.draft.spec.constraints).toEqual(["No cloud storage"]);
  });

  it("revises existing acceptance criterion text by stable ID", () => {
    const seeded = applyPrdPatch(createLiveProjectSpecDraft(5), {
      patchId: "patch-seed",
      sourceTurnId: "turn-1",
      rationale: null,
      operations: [{ op: "append_acceptance_criterion", text: "Old wording" }],
    }).draft;

    const result = applyPrdPatch(seeded, {
      patchId: "patch-revise",
      sourceTurnId: "turn-2",
      rationale: null,
      operations: [
        {
          op: "revise_acceptance_criterion_text",
          criterionId: "AC-001",
          text: "User can add a task",
        },
      ],
    });

    expect(result.outcome).toBe("applied");
    expect(result.appliedFieldPaths).toEqual(["acceptanceCriteria.AC-001.text"]);
    expect(result.draft.spec.acceptanceCriteria[0].text).toBe("User can add a task");
  });
});
