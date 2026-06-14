// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolActivity } from "./ToolActivity";
import type { ToolCallMessageData } from "./types";
import { useLocaleStore } from "../../i18n";

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
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
  });

  afterEach(() => cleanup());

  it("does not render quarantined keyword/rule cards or add approval friction by default", () => {
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

    expect(screen.queryByTestId("provocation-card")).toBeNull();
    expect(screen.queryByTestId("permission-approval-requirement")).toBeNull();
    const approveButton = screen.getByTestId("card-approve") as HTMLButtonElement;
    expect(approveButton.disabled).toBe(false);
    fireEvent.click(approveButton);

    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0][0]).toBe("tool-1");
    expect(approve.mock.calls[0][2]).toBeUndefined();
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

  it("requires diff acknowledgment before approving a high-risk diff", () => {
    render(
      <ToolActivity call={pendingCall({ risk: "danger" })} onApprove={vi.fn()} onDeny={vi.fn()} />,
    );

    const approveButton = screen.getByTestId("card-approve") as HTMLButtonElement;
    expect(approveButton.disabled).toBe(true);

    const checkbox = screen.getByTestId("danger-diff-ack-checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);

    expect(checkbox.checked).toBe(true);
    expect(approveButton.disabled).toBe(false);
  });

  it("shows the pre-run action context from the active plan step", () => {
    render(
      <ToolActivity
        call={pendingCall()}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        provocation={{
          enabled: true,
          mode: "standard",
          projectId: 1,
          sessionId: 2,
          goalText: "버튼 문구만 바꿔줘",
          targetFiles: ["src/App.tsx"],
          changedFiles: [{ path: "src/App.tsx", category: "ui", changeType: "modified" }],
          checkpointAvailable: true,
        }}
      />,
    );

    expect(screen.getByTestId("permission-action-context")).toBeTruthy();
    expect(screen.getByTestId("permission-expected-files").textContent).toContain("src/App.tsx");
    expect(screen.getByTestId("permission-write-files").textContent).toContain("src/App.tsx");
    expect(screen.getByTestId("permission-diff-path").textContent).toContain("src/App.tsx");
    expect(screen.getByTestId("permission-checkpoint-availability").textContent).toContain(
      "체크포인트 있음",
    );
  });
});
