import { describe, expect, it } from "vitest";
import type { ProjectSpec } from "../../features/planning";
import {
  PLAN_SCAFFOLDING_NOT_LIMITS_LINE,
  buildPrdPlanGenerationPrompt,
  planScaffoldingForForms,
} from "./productShellControllerLogic";

// S-072 (014 theme 1, Constitution VII / D-014-04): planner scaffolding is an
// additive union of positive coverage lines per chosen form plus a fixed
// "not limits" closing line. No "avoid …" clause anywhere.
describe("planScaffoldingForForms", () => {
  it("returns null when no form is chosen", () => {
    expect(planScaffoldingForForms([])).toBeNull();
    expect(planScaffoldingForForms([], "anything")).toBeNull();
  });

  it("unions one positive line per form and closes with the not-limits line", () => {
    const text = planScaffoldingForForms(["web_app", "api_service"]);
    expect(text).not.toBeNull();
    const lines = text!.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("For a web app, cover the browser UI screens/components");
    expect(lines[0]).toContain("plus any server, database, or API work the app needs");
    expect(lines[1]).toContain("For an API service, cover endpoints, request/response schemas");
    expect(lines[2]).toBe(PLAN_SCAFFOLDING_NOT_LIMITS_LINE);
    expect(lines[2]).toContain("planning hints, not limits");
    expect(lines[2]).toContain("never drop a step because it does not match a form");
  });

  it("never emits an avoid clause for any form", () => {
    const text = planScaffoldingForForms(
      ["web_app", "static_page", "cli_tool", "desktop_app", "api_service", "other"],
      "Discord bot",
    );
    expect(text!.toLowerCase()).not.toContain("avoid");
    expect(text!.split("\n")).toHaveLength(7);
  });

  it("dedupes repeated forms preserving pick order", () => {
    const text = planScaffoldingForForms(["cli_tool", "web_app", "cli_tool"]);
    const lines = text!.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("For a CLI tool");
    expect(lines[1]).toContain("For a web app");
  });

  it("quotes the student's own label for other, and copes without one", () => {
    expect(planScaffoldingForForms(["other"], "  Discord bot  ")).toContain(
      'For the form the student described in their own words ("Discord bot"), plan for exactly that.',
    );
    const unlabeled = planScaffoldingForForms(["other"], null)!;
    expect(unlabeled).toContain(
      "For the form the student described in their own words, plan for exactly that.",
    );
    expect(unlabeled).not.toContain('("');
  });
});

describe("buildPrdPlanGenerationPrompt architecture context (S-072)", () => {
  function projectSpec(): ProjectSpec {
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
      architecture: {
        forms: ["web_app", "other"],
        formOtherLabel: "Discord bot",
        stack: "Python + discord.py",
        rationale: null,
        decisionSource: "student_confirmed",
        decidedInVersion: 1,
      },
      fieldProvenance: {},
      status: "draft",
      createdAt: 1,
      updatedAt: 1,
    };
  }

  it("passes every form plus student labels and the stack as decomposition context", () => {
    const prompt = buildPrdPlanGenerationPrompt(projectSpec());
    const json = prompt.slice(prompt.indexOf("Saved PRD JSON:\n") + "Saved PRD JSON:\n".length);
    const prd = JSON.parse(json) as {
      architecture: { forms: string[]; formLabels: string[]; stack: string };
    };
    expect(prd.architecture).toEqual({
      forms: ["web_app", "other"],
      formLabels: ["web_app", "Discord bot"],
      stack: "Python + discord.py",
    });
    expect(prompt).toContain("confirmed architecture (forms + tech stack)");
    expect(prompt).toContain('("Discord bot")');
    expect(prompt).toContain(PLAN_SCAFFOLDING_NOT_LIMITS_LINE);
    expect(prompt.toLowerCase()).not.toContain("avoid");
  });
});
