// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolActivity } from "./ToolActivity";
import type { ToolCallMessageData } from "./types";

function pendingCall(overrides: Partial<ToolCallMessageData> = {}): ToolCallMessageData {
  return {
    id: "tool-1",
    kind: "tool_call",
    createdAt: 1,
    toolName: "edit_file",
    paramsPreview: "path: src/App.tsx",
    status: "pending",
    risk: "warn",
    diffPreview: {
      path: "src/App.tsx",
      before: "old",
      after: "new",
    },
    args: { path: "src/App.tsx", find: "old", replace: "new" },
    ...overrides,
  };
}

describe("ToolActivity provocation permission gate", () => {
  afterEach(() => cleanup());

  it("requires a reason before approving high-risk changed files outside a UI-only target", () => {
    const approve = vi.fn();

    render(
      <ToolActivity
        call={pendingCall()}
        onApprove={approve}
        onDeny={vi.fn()}
        provocation={{
          enabled: true,
          mode: "standard",
          projectId: 1,
          sessionId: 2,
          goalText: "버튼 문구만 바꿔줘",
          targetFiles: ["src/App.tsx"],
          changedFiles: [
            { path: "src/App.tsx", category: "ui", changeType: "modified" },
            { path: "package.json", category: "dependency", changeType: "modified" },
          ],
        }}
      />,
    );

    expect(screen.getByTestId("provocation-card").dataset.severity).toBe("risk");
    expect(screen.getByTestId("permission-approval-requirement").dataset.satisfied).toBe("false");
    expect((screen.getByTestId("card-approve") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText("위험 감수하고 수용"));
    fireEvent.change(screen.getByTestId("provocation-risk-reason"), {
      target: { value: "package metadata change is intentional" },
    });
    fireEvent.click(screen.getByTestId("provocation-risk-submit"));

    expect(screen.getByTestId("permission-approval-requirement").dataset.satisfied).toBe("true");
    const approveButton = screen.getByTestId("card-approve") as HTMLButtonElement;
    expect(approveButton.disabled).toBe(false);
    fireEvent.click(approveButton);

    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0][0]).toBe("tool-1");
    expect(approve.mock.calls[0][2]).toMatchObject({
      source: "provocation.continue_with_risk",
      riskReason: "package metadata change is intentional",
      highRiskFiles: ["package.json"],
    });
  });

  it("does not add approval friction for a non-high-risk UI-only edit", () => {
    const approve = vi.fn();

    render(
      <ToolActivity
        call={pendingCall()}
        onApprove={approve}
        onDeny={vi.fn()}
        provocation={{
          enabled: true,
          mode: "standard",
          projectId: 1,
          sessionId: 2,
          goalText: "버튼 문구만 바꿔줘",
          targetFiles: ["src/App.tsx"],
          planSteps: [{ id: "ui-copy", text: "버튼 문구를 바꾸고 미리보기로 확인한다" }],
          changedFiles: [{ path: "src/App.tsx", category: "ui", changeType: "modified" }],
        }}
      />,
    );

    expect(screen.queryByTestId("permission-approval-requirement")).toBeNull();

    const approveButton = screen.getByTestId("card-approve") as HTMLButtonElement;
    expect(approveButton.disabled).toBe(false);
    fireEvent.click(approveButton);

    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0][0]).toBe("tool-1");
    expect(approve.mock.calls[0][2]).toBeUndefined();
  });
});
