import { describe, expect, it } from "vitest";
import type { AcceptanceCriterion } from "./types";
import {
  adaptAcceptanceCriteria,
  allocateCriterionId,
  createLiveProjectSpecDraft,
  markDraftStudentEdited,
  validateMinimalProjectSpec,
  validateConfirmableProjectSpec,
} from "./projectSpec";

describe("project spec helpers", () => {
  it("adapts legacy string acceptance criteria into stable migration objects", () => {
    const criteria = adaptAcceptanceCriteria(
      ["User can create a task", "  ", "User can mark a task done"],
      { version: 3 },
    );

    expect(criteria).toEqual([
      {
        criterionId: "AC-001",
        text: "User can create a task",
        source: "migration",
        status: "active",
        createdInVersion: 3,
        retiredInVersion: null,
      },
      {
        criterionId: "AC-002",
        text: "User can mark a task done",
        source: "migration",
        status: "active",
        createdInVersion: 3,
        retiredInVersion: null,
      },
    ]);
  });

  it("preserves object-form criteria and allocates the next criterion id", () => {
    const existing: AcceptanceCriterion[] = [
      {
        criterionId: "AC-002",
        text: "Two",
        source: "interview",
        status: "active",
        createdInVersion: 1,
        retiredInVersion: null,
      },
      {
        criterionId: "AC-010",
        text: "Retired ten",
        source: "student_edit",
        status: "retired",
        createdInVersion: 1,
        retiredInVersion: 2,
      },
    ];

    expect(adaptAcceptanceCriteria(existing)).toEqual(existing);
    expect(allocateCriterionId(existing)).toBe("AC-011");
  });

  it("reassigns invalid AC-000 criterion ids instead of preserving them", () => {
    const criteria = adaptAcceptanceCriteria([
      {
        criterionId: "AC-000",
        text: "Zero should not be persisted",
        source: "interview",
        status: "active",
        createdInVersion: 1,
        retiredInVersion: null,
      },
    ]);

    expect(criteria[0].criterionId).toBe("AC-001");
  });

  it("validates only minimal PRDs with a goal and an active criterion", () => {
    const draft = createLiveProjectSpecDraft(42);
    expect(validateMinimalProjectSpec(draft.spec)).toEqual({
      valid: false,
      reasonCodes: ["missing_goal", "missing_acceptance_criterion"],
    });

    const withGoal = {
      ...draft.spec,
      goal: "Build a focused todo app",
      acceptanceCriteria: adaptAcceptanceCriteria(["Can add a task"]),
    };
    expect(validateMinimalProjectSpec(withGoal)).toEqual({
      valid: true,
      reasonCodes: [],
    });
  });

  it("allows a minimal goal and criterion PRD to be confirmed", () => {
    const draft = createLiveProjectSpecDraft(42, {
      goal: "Build a focused todo app",
      acceptanceCriteria: ["Can add a task"],
    });

    expect(validateConfirmableProjectSpec(draft.spec)).toEqual({
      valid: true,
      reasonCodes: [],
    });
  });

  it("tracks student-edited draft fields without duplicating dirty paths", () => {
    const draft = createLiveProjectSpecDraft(7, {
      draftId: "draft-prd-7",
      goal: "Initial goal",
    });

    const edited = markDraftStudentEdited(draft, ["goal", "goal", "scope"]);

    expect(edited.draftId).toBe("draft-prd-7");
    expect(edited.dirtyFields).toEqual(["goal", "scope"]);
    expect(edited.studentEditedFields).toEqual(["goal", "scope"]);
    expect(edited.updatedAt).toBeGreaterThanOrEqual(draft.updatedAt);
  });
});
