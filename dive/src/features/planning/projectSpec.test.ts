import { describe, expect, it } from "vitest";
import type { AcceptanceCriterion } from "./types";
import {
  adaptAcceptanceCriteria,
  allocateCriterionId,
  createLiveProjectSpecDraft,
  liveDraftWithNormalizedArchitecture,
  markDraftStudentEdited,
  normalizeArchitectureDecision,
  prdIntentCheckFraming,
  studentAuthoredFieldPaths,
  validateMinimalProjectSpec,
  validateConfirmableProjectSpec,
  withNormalizedArchitecture,
} from "./projectSpec";
import type { ArchitectureDecision } from "./types";

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

  it("reassigns a repeated valid criterion id instead of letting it pass through as a duplicate", () => {
    const criteria = adaptAcceptanceCriteria([
      {
        criterionId: "AC-001",
        text: "First",
        source: "interview",
        status: "active",
        createdInVersion: 1,
        retiredInVersion: null,
      },
      {
        criterionId: "AC-001",
        text: "Duplicate of first",
        source: "interview",
        status: "active",
        createdInVersion: 1,
        retiredInVersion: null,
      },
    ]);

    expect(criteria).toHaveLength(2);
    expect(criteria[0].criterionId).toBe("AC-001");
    expect(criteria[1].criterionId).not.toBe("AC-001");
    expect(new Set(criteria.map((c) => c.criterionId)).size).toBe(2);
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

  it("does not confirm a vague PRD with only a goal and one criterion", () => {
    const draft = createLiveProjectSpecDraft(42, {
      goal: "Build a focused todo app",
      acceptanceCriteria: ["Can add a task"],
    });

    expect(validateConfirmableProjectSpec(draft.spec)).toEqual({
      valid: false,
      reasonCodes: [
        "missing_intent_summary",
        "missing_scope",
        "missing_non_goals",
        "insufficient_acceptance_criteria",
        "missing_architecture_stack",
      ],
    });
  });

  it("confirms a fully specified, concrete PRD", () => {
    const draft = createLiveProjectSpecDraft(42, {
      goal: "Build a focused todo app for students",
      intentSummary: "Students track daily tasks and see what is still left",
      scope: ["Single-page todo list with add and complete"],
      nonGoals: ["No accounts or login"],
      acceptanceCriteria: ["Can add a task", "Completed tasks show a checkmark"],
      architecture: {
        stack: "React + Vite",
        rationale: null,
        decisionSource: "student_confirmed",
        decidedInVersion: 1,
      },
    });

    expect(validateConfirmableProjectSpec(draft.spec)).toEqual({
      valid: true,
      reasonCodes: [],
    });
  });

  // S-075 (014 theme 4, D-014-16): the architecture gate is one confirmed tech
  // stack — no project-kind classification (Constitution VII).
  it("requires a confirmed tech stack before confirming", () => {
    const draft = createLiveProjectSpecDraft(42, {
      goal: "Build a focused todo app for students",
      intentSummary: "Students track daily tasks and see what is still left",
      scope: ["Single-page todo list with add and complete"],
      nonGoals: ["No accounts or login"],
      acceptanceCriteria: ["Can add a task", "Completed tasks show a checkmark"],
    });

    // No architecture decided yet: the stack gap is what blocks confirmation.
    expect(validateConfirmableProjectSpec(draft.spec)).toEqual({
      valid: false,
      reasonCodes: ["missing_architecture_stack"],
    });

    // A decision row with a blank stack is still undecided.
    const blankStack = {
      ...draft.spec,
      architecture: {
        stack: "   ",
        rationale: null,
        decisionSource: "student_confirmed" as const,
        decidedInVersion: 1,
      },
    };
    expect(validateConfirmableProjectSpec(blankStack)).toEqual({
      valid: false,
      reasonCodes: ["missing_architecture_stack"],
    });

    // Stack confirmed (accepted or typed): the PRD is now confirmable.
    const withStack = {
      ...blankStack,
      architecture: { ...blankStack.architecture, stack: "React + Vite" },
    };
    expect(validateConfirmableProjectSpec(withStack)).toEqual({
      valid: true,
      reasonCodes: [],
    });
  });

  it("flags a vague goal that hides behind filler words", () => {
    const draft = createLiveProjectSpecDraft(42, {
      goal: "just do something",
      intentSummary: "Students track daily tasks and see what is still left",
      scope: ["Single-page todo list with add and complete"],
      nonGoals: ["No accounts or login"],
      acceptanceCriteria: ["Can add a task", "Completed tasks show a checkmark"],
      architecture: {
        stack: "React + Vite",
        rationale: null,
        decisionSource: "student_confirmed",
        decidedInVersion: 1,
      },
    });

    expect(validateConfirmableProjectSpec(draft.spec)).toEqual({
      valid: false,
      reasonCodes: ["vague_goal"],
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

  it("stamps student provenance on the five scalar/list fields only (S-053 D3)", () => {
    const draft = createLiveProjectSpecDraft(7, { draftId: "draft-prd-7" });

    const edited = markDraftStudentEdited(draft, [
      "goal",
      "intentSummary",
      "scope",
      "nonGoals",
      "constraints",
      // acceptanceCriteria has its own per-criterion `source`; architecture has
      // its own `decisionSource` — both are excluded from this map by design.
      "acceptanceCriteria",
      "architecture",
    ]);

    expect(edited.fieldProvenance).toEqual({
      goal: "student",
      intentSummary: "student",
      scope: "student",
      nonGoals: "student",
      constraints: "student",
    });
  });

  it("re-stamps a field student on a later edit, overriding any prior source", () => {
    const draft = createLiveProjectSpecDraft(7, {
      draftId: "draft-prd-7",
      fieldProvenance: { goal: "ai_patch" },
    });

    const edited = markDraftStudentEdited(draft, ["goal"]);

    expect(edited.fieldProvenance.goal).toBe("student");
  });

  it("stamps a nested acceptance-criterion field path by its root, not the full path", () => {
    const draft = createLiveProjectSpecDraft(7, { draftId: "draft-prd-7" });

    const edited = markDraftStudentEdited(draft, ["acceptanceCriteria.AC-001.text"]);

    // The root ("acceptanceCriteria") is excluded from the map, same as the
    // bare "acceptanceCriteria" path.
    expect(edited.fieldProvenance).toEqual({});
  });
});

describe("prdIntentCheckFraming", () => {
  it("falls back to the legacy 'ai' framing when the map is empty", () => {
    expect(prdIntentCheckFraming(undefined)).toBe("ai");
    expect(prdIntentCheckFraming({})).toBe("ai");
  });

  it("returns 'ai' when every stamped field is ai_patch or ai_suggestion_accepted", () => {
    expect(prdIntentCheckFraming({ goal: "ai_patch", scope: "ai_suggestion_accepted" })).toBe("ai");
  });

  it("returns 'student' when every stamped field is student", () => {
    expect(prdIntentCheckFraming({ goal: "student", scope: "student" })).toBe("student");
  });

  it("returns 'mixed' when sources disagree", () => {
    expect(prdIntentCheckFraming({ goal: "student", scope: "ai_patch" })).toBe("mixed");
  });
});

describe("studentAuthoredFieldPaths", () => {
  it("returns only the fields stamped student, in map order", () => {
    expect(
      studentAuthoredFieldPaths({
        goal: "student",
        scope: "ai_patch",
        constraints: "student",
      }),
    ).toEqual(["goal", "constraints"]);
  });

  it("returns an empty list for an empty or undefined map", () => {
    expect(studentAuthoredFieldPaths(undefined)).toEqual([]);
    expect(studentAuthoredFieldPaths({})).toEqual([]);
  });
});

// S-075 (D-014-16): legacy S-047/S-072 payloads carry `form` / `forms` /
// `formOtherLabel`; the client mirror of the Rust load strips them and keeps
// the stack-only decision.
describe("normalizeArchitectureDecision", () => {
  it("strips a legacy single form and keeps the stack fields", () => {
    expect(
      normalizeArchitectureDecision({
        form: "web_app",
        stack: "React + Vite",
        rationale: "Runs in the browser",
        decisionSource: "student_confirmed",
        decidedInVersion: 3,
      }),
    ).toEqual({
      stack: "React + Vite",
      rationale: "Runs in the browser",
      decisionSource: "student_confirmed",
      decidedInVersion: 3,
    });
  });

  it("strips legacy forms and formOtherLabel keys", () => {
    const normalized = normalizeArchitectureDecision({
      stack: "React + Express",
      rationale: null,
      decisionSource: "student_changed",
      decidedInVersion: 2,
    });
    expect(normalized).toEqual({
      stack: "React + Express",
      rationale: null,
      decisionSource: "student_changed",
      decidedInVersion: 2,
    });
    expect(normalized).not.toHaveProperty("forms");
    expect(normalized).not.toHaveProperty("formOtherLabel");
  });

  it("defaults an unknown source to migration and a missing version to 1", () => {
    expect(
      normalizeArchitectureDecision({
        stack: "Python",
        decisionSource: "bogus",
      }),
    ).toEqual({
      stack: "Python",
      rationale: null,
      decisionSource: "migration",
      decidedInVersion: 1,
    });
  });

  it("returns null for null or non-object input", () => {
    expect(normalizeArchitectureDecision(null)).toBeNull();
    expect(normalizeArchitectureDecision(undefined)).toBeNull();
    expect(normalizeArchitectureDecision("React")).toBeNull();
  });

  it("normalizes through the spec and live-draft helpers", () => {
    const draft = createLiveProjectSpecDraft(42, { goal: "Build a bot" });
    const legacyDraft = {
      ...draft,
      spec: {
        ...draft.spec,
        architecture: {
          form: "static_page",
          stack: "HTML",
          decisionSource: "student_confirmed",
          decidedInVersion: 1,
        } as unknown as ArchitectureDecision,
      },
    };
    const normalized = liveDraftWithNormalizedArchitecture(legacyDraft).spec.architecture;
    expect(normalized?.stack).toBe("HTML");
    expect(normalized).not.toHaveProperty("form");
    expect(withNormalizedArchitecture({ architecture: null }).architecture).toBeNull();
  });
});
