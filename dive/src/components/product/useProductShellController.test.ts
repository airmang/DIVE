import { describe, expect, it } from "vitest";
import {
  buildPrdPlanGenerationPrompt,
  draftFromProjectSpec,
  modelNotFoundToastArgs,
  restorePrdDraftIfCurrent,
  runtimeSetupActionLabel,
  shouldShowEmptyPlanRail,
  shouldUsePrdReferenceSurface,
} from "./useProductShellController";
import { createLiveProjectSpecDraft, type ProjectSpec } from "../../features/planning";

// Mirrors en.json's key→copy for the keys these functions touch, so
// assertions read like real UI copy instead of raw i18n keys.
function fakeTranslate(key: string, values?: Record<string, string | number>): string {
  const table: Record<string, string> = {
    "sidebar.new_project": "New project",
    "runtime.capability.setup_action": "Open provider setup",
    "runtime.capability.switch_model_action": "Switch to a compatible model",
    "runtime.model_not_found.toast_title": "This model can't run",
    "runtime.model_not_found.toast_description":
      "{{provider}}/{{model}} is not supported by the supervised Pi runtime.",
  };
  const template = table[key] ?? key;
  if (!values) return template;
  return Object.entries(values).reduce(
    (out, [name, value]) => out.split(`{{${name}}}`).join(String(value)),
    template,
  );
}

function projectSpec(): ProjectSpec {
  return {
    projectSpecId: "prd-1",
    projectId: 1,
    currentVersion: 1,
    goal: "Build a personal schedule app",
    intentSummary: "A single user separates schedules from todos.",
    scope: ["Schedule list", "Todo list"],
    nonGoals: ["Team calendar"],
    constraints: ["Local-first data"],
    acceptanceCriteria: [
      {
        criterionId: "AC-001",
        text: "Schedules and todos appear in separate lists",
        source: "interview",
        status: "active",
        createdInVersion: 1,
        retiredInVersion: null,
      },
      {
        criterionId: "AC-002",
        text: "Archived criterion should not drive the new plan",
        source: "interview",
        status: "retired",
        createdInVersion: 1,
        retiredInVersion: 1,
      },
    ],
    architecture: null,
    status: "draft",
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("shouldShowEmptyPlanRail", () => {
  it("keeps the empty plan rail closed until the PRD is confirmed", () => {
    const base = {
      currentProjectId: 1,
      planAccepted: false,
      roadmapStepCount: 0,
      prdReadiness: "draft" as const,
      prdMode: "authoring" as const,
    };

    expect(shouldShowEmptyPlanRail(base)).toBe(false);
    expect(
      shouldShowEmptyPlanRail({
        ...base,
        prdReadiness: "minimal",
        prdMode: "authoring",
      }),
    ).toBe(false);
    expect(
      shouldShowEmptyPlanRail({
        ...base,
        prdReadiness: "minimal",
        prdMode: "read",
      }),
    ).toBe(true);
  });

  it("does not show the empty rail when a plan or roadmap already exists", () => {
    expect(
      shouldShowEmptyPlanRail({
        currentProjectId: 1,
        planAccepted: true,
        roadmapStepCount: 0,
        prdReadiness: "minimal",
        prdMode: "read",
      }),
    ).toBe(false);
    expect(
      shouldShowEmptyPlanRail({
        currentProjectId: 1,
        planAccepted: false,
        roadmapStepCount: 2,
        prdReadiness: "minimal",
        prdMode: "read",
      }),
    ).toBe(false);
  });
});

describe("shouldUsePrdReferenceSurface", () => {
  it("keeps the saved PRD full-screen only before a plan exists", () => {
    expect(
      shouldUsePrdReferenceSurface({
        prdMode: "read",
        hasPlan: false,
        roadmapStepCount: 0,
      }),
    ).toBe(false);
  });

  it("collapses the saved PRD once a plan or active step exists", () => {
    expect(
      shouldUsePrdReferenceSurface({
        prdMode: "read",
        hasPlan: true,
        roadmapStepCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldUsePrdReferenceSurface({
        prdMode: "read",
        hasPlan: false,
        roadmapStepCount: 2,
      }),
    ).toBe(true);
    expect(
      shouldUsePrdReferenceSurface({
        prdMode: "read",
        hasPlan: false,
        roadmapStepCount: 0,
        activePlanStepIdForChat: 11,
      }),
    ).toBe(true);
  });

  it("does not collapse PRD authoring edits into the chat surface", () => {
    expect(
      shouldUsePrdReferenceSurface({
        prdMode: "authoring",
        hasPlan: true,
        roadmapStepCount: 2,
      }),
    ).toBe(false);
  });
});

describe("buildPrdPlanGenerationPrompt", () => {
  it("asks the model to generate a traceable plan from the saved PRD", () => {
    const prompt = buildPrdPlanGenerationPrompt(projectSpec());

    expect(prompt).toContain("[PRD_PLAN_GENERATION]");
    expect(prompt).toContain("Build a personal schedule app");
    expect(prompt).toContain("AC-001");
    expect(prompt).not.toContain("AC-002");
    expect(prompt).toContain("Every step must link to at least one saved PRD criterion ID");
    expect(prompt).toContain("Do not include Markdown fences or prose");
  });

  it("threads the decided architecture into decomposition context when present", () => {
    const withArchitecture: ProjectSpec = {
      ...projectSpec(),
      architecture: {
        form: "web_app",
        formOtherLabel: null,
        stack: "React + Vite",
        rationale: null,
        decisionSource: "student_confirmed",
        decidedInVersion: 1,
      },
    };
    const prompt = buildPrdPlanGenerationPrompt(withArchitecture);

    expect(prompt).toContain("React + Vite");
    expect(prompt).toContain("do not switch to a different framework or stack");
  });

  it("adds deterministic form-specific scaffolding for the decided form", () => {
    const withArchitecture: ProjectSpec = {
      ...projectSpec(),
      architecture: {
        form: "static_page",
        formOtherLabel: null,
        stack: "HTML + CSS + JavaScript",
        rationale: null,
        decisionSource: "student_confirmed",
        decidedInVersion: 1,
      },
    };
    const prompt = buildPrdPlanGenerationPrompt(withArchitecture);

    expect(prompt).toContain("DIVE form-specific step scaffolding:");
    expect(prompt).toContain("For static_page, steps should be static HTML/CSS/JS");
    expect(prompt).toContain("avoid server, database, or backend-auth steps");
  });

  it("omits the architecture directive when none is decided", () => {
    const prompt = buildPrdPlanGenerationPrompt(projectSpec());
    expect(prompt).not.toContain("do not switch to a different framework or stack");
    expect(prompt).not.toContain("DIVE form-specific step scaffolding");
  });
});

describe("draftFromProjectSpec", () => {
  it("carries the decided architecture into the editable draft (edit→reopen)", () => {
    const saved: ProjectSpec = {
      ...projectSpec(),
      architecture: {
        form: "static_page",
        formOtherLabel: null,
        stack: "HTML + CSS",
        rationale: "No build step keeps it simple.",
        decisionSource: "student_confirmed",
        decidedInVersion: 2,
      },
    };

    const draft = draftFromProjectSpec(saved);

    // Regression guard: the read-view Edit button rebuilds the draft here with no
    // backend refetch, so dropping architecture would permanently lose it on save.
    expect(draft.spec.architecture).toEqual(saved.architecture);
  });

  it("keeps architecture null when the saved PRD never decided one", () => {
    const draft = draftFromProjectSpec(projectSpec());
    expect(draft.spec.architecture).toBeNull();
  });
});

describe("restorePrdDraftIfCurrent", () => {
  it("applies a restored draft only when the same project and draft are still active", () => {
    const currentDraft = createLiveProjectSpecDraft(7, {
      draftId: "draft-7",
      updatedAt: 100,
    });
    const restoredDraft = createLiveProjectSpecDraft(7, {
      draftId: "draft-7",
      goal: "Restored goal",
      updatedAt: 80,
    });

    expect(
      restorePrdDraftIfCurrent({
        currentDraft,
        restoredDraft,
        requestedProjectId: 7,
        requestedDraftId: "draft-7",
        requestedDraftUpdatedAt: 100,
      }),
    ).toEqual(restoredDraft);
  });

  it("ignores a restored draft after the active project has changed", () => {
    const currentDraft = createLiveProjectSpecDraft(8, { draftId: "draft-8" });
    const restoredDraft = createLiveProjectSpecDraft(7, {
      draftId: "draft-7",
      goal: "Old project draft",
    });

    expect(
      restorePrdDraftIfCurrent({
        currentDraft,
        restoredDraft,
        requestedProjectId: 7,
        requestedDraftId: "draft-7",
        requestedDraftUpdatedAt: currentDraft.updatedAt,
      }),
    ).toEqual(currentDraft);
  });

  it("ignores a restored draft when the current draft changed after restore began", () => {
    const currentDraft = createLiveProjectSpecDraft(7, {
      draftId: "draft-7",
      goal: "Interview-applied goal",
      updatedAt: 150,
    });
    const restoredDraft = createLiveProjectSpecDraft(7, {
      draftId: "draft-7",
      goal: "Older restored goal",
      updatedAt: 80,
    });

    expect(
      restorePrdDraftIfCurrent({
        currentDraft,
        restoredDraft,
        requestedProjectId: 7,
        requestedDraftId: "draft-7",
        requestedDraftUpdatedAt: 100,
      }),
    ).toEqual(currentDraft);
  });

  it("ignores a restored draft after authoring state has already been cleared", () => {
    const restoredDraft = createLiveProjectSpecDraft(7, {
      draftId: "draft-7",
      goal: "Old project draft",
    });

    expect(
      restorePrdDraftIfCurrent({
        currentDraft: null,
        restoredDraft,
        requestedProjectId: 7,
        requestedDraftId: "draft-7",
        requestedDraftUpdatedAt: 100,
      }),
    ).toBeNull();
  });
});

// S-051 P2 D2.2/D3: the runtime-unavailable CTA label + the run-time
// model-not-found toast copy.
describe("runtimeSetupActionLabel", () => {
  it("labels open_project with the new-project action", () => {
    expect(runtimeSetupActionLabel("open_project", fakeTranslate)).toBe("New project");
  });

  it("hides the button for the interim retry_runtime action", () => {
    expect(runtimeSetupActionLabel("retry_runtime", fakeTranslate)).toBeUndefined();
  });

  it("gives switch_model a dedicated compatible-model label (S-051 D2 point 2)", () => {
    expect(runtimeSetupActionLabel("switch_model", fakeTranslate)).toBe(
      "Switch to a compatible model",
    );
  });

  it("falls back to the generic open-provider-setup label for other/unset actions", () => {
    expect(runtimeSetupActionLabel("configure_provider", fakeTranslate)).toBe(
      "Open provider setup",
    );
    expect(runtimeSetupActionLabel(null, fakeTranslate)).toBe("Open provider setup");
    expect(runtimeSetupActionLabel(undefined, fakeTranslate)).toBe("Open provider setup");
  });
});

describe("modelNotFoundToastArgs", () => {
  it("returns null when there is no chat error", () => {
    expect(modelNotFoundToastArgs(null, fakeTranslate)).toBeNull();
    expect(modelNotFoundToastArgs(undefined, fakeTranslate)).toBeNull();
  });

  it("returns null for an unrelated chat error (does not misfire)", () => {
    expect(
      modelNotFoundToastArgs("pi sidecar error: rate limit exceeded", fakeTranslate),
    ).toBeNull();
  });

  it("names the provider/model and points at the switch action for a sidecar model-not-found error", () => {
    const args = modelNotFoundToastArgs(
      "pi sidecar error: model not found: openrouter/anthropic/claude-sonnet-5",
      fakeTranslate,
    );
    expect(args).toEqual({
      title: "This model can't run",
      description:
        "openrouter/anthropic/claude-sonnet-5 is not supported by the supervised Pi runtime.",
      actionLabel: "Switch to a compatible model",
    });
  });
});
