// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "../../i18n";
import { PermissionSummary } from "./PermissionSummary";
import type { ToolExplanation } from "./explain";
import type { PermissionActionContext } from "./types";

function explanation(): ToolExplanation {
  return {
    actionTitle: "파일 변경",
    actionBody: "",
    files: [],
    command: null,
    commandWillChangeFiles: "yes",
    riskLabel: "변경",
    riskBody: "",
    choices: [],
    patchPreviewExpected: true,
  };
}

function actionContext(overrides: Partial<PermissionActionContext> = {}): PermissionActionContext {
  return {
    expectedFiles: [],
    readFiles: [],
    writeFiles: [],
    diffPreviewPath: null,
    checkpointAvailable: null,
    ...overrides,
  };
}

describe("PermissionSummary plan-vs-actual divergence (P1-18)", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
  });

  afterEach(() => cleanup());

  it("surfaces a visible warning when a write target is not in the approved plan", () => {
    render(
      <PermissionSummary
        toolName="write_file"
        risk="warn"
        explanation={explanation()}
        actionContext={actionContext({
          expectedFiles: ["src/a.ts"],
          writeFiles: ["src/a.ts", "src/off-plan.ts"],
        })}
      />,
    );

    const warning = screen.getByTestId("permission-divergence-warning");
    expect(warning).toBeTruthy();
    expect(warning.textContent).toContain("src/off-plan.ts");
  });

  it("stays silent when every write target is in the plan", () => {
    render(
      <PermissionSummary
        toolName="write_file"
        risk="warn"
        explanation={explanation()}
        actionContext={actionContext({
          expectedFiles: ["src/a.ts", "src/b.ts"],
          writeFiles: ["src/a.ts"],
        })}
      />,
    );

    expect(screen.queryByTestId("permission-divergence-warning")).toBeNull();
  });

  it("stays silent when there is no plan expectation to judge against", () => {
    render(
      <PermissionSummary
        toolName="write_file"
        risk="warn"
        explanation={explanation()}
        actionContext={actionContext({
          expectedFiles: [],
          writeFiles: ["src/anything.ts"],
        })}
      />,
    );

    expect(screen.queryByTestId("permission-divergence-warning")).toBeNull();
  });
});
