import { describe, expect, it } from "vitest";
import type { ProjectSpec } from "../../features/planning";
import { buildPrdPlanGenerationPrompt } from "./productShellControllerLogic";

// S-075 (014 theme 4, D-014-16): the planner's architecture context is the
// confirmed tech stack and nothing else — no project-kind classification, no
// form scaffolding (Constitution VII).
describe("buildPrdPlanGenerationPrompt architecture context (S-075)", () => {
  function projectSpec(architecture: ProjectSpec["architecture"]): ProjectSpec {
    return {
      projectSpecId: "prd-1",
      projectId: 1,
      currentVersion: 1,
      goal: "Build a study bot",
      intentSummary: "Students ask the bot for a schedule",
      scope: ["Answer schedule questions"],
      nonGoals: ["No grading"],
      constraints: [],
      acceptanceCriteria: [
        {
          criterionId: "AC-001",
          text: "The bot replies with today's schedule",
          source: "student_edit",
          status: "active",
          createdInVersion: 1,
          retiredInVersion: null,
        },
      ],
      architecture,
      fieldProvenance: {},
      status: "draft",
      createdAt: 1,
      updatedAt: 1,
    };
  }

  function savedPrdJson(prompt: string): { architecture?: unknown } {
    const marker = "Saved PRD JSON:\n";
    return JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length)) as {
      architecture?: unknown;
    };
  }

  it("passes only the stack as decomposition context and binds the directive to it", () => {
    const prompt = buildPrdPlanGenerationPrompt(
      projectSpec({
        stack: "Python + discord.py",
        rationale: "A bot that answers in the class Discord",
        decisionSource: "student_confirmed",
        decidedInVersion: 1,
      }),
    );

    expect(savedPrdJson(prompt).architecture).toEqual({ stack: "Python + discord.py" });
    expect(prompt).toContain(
      "The PRD includes the student's confirmed tech stack. Decompose using that stack — do not switch to a different framework or stack.",
    );
    expect(prompt).not.toContain("form-specific");
    expect(prompt).not.toContain("forms");
    expect(prompt.toLowerCase()).not.toContain("avoid");
  });

  it("omits the architecture context and directive when none is decided", () => {
    const prompt = buildPrdPlanGenerationPrompt(projectSpec(null));

    expect(savedPrdJson(prompt).architecture).toBeUndefined();
    expect(prompt).not.toContain("confirmed tech stack");
  });
});
