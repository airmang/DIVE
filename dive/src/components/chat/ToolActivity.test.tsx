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

  it("does not render quarantined keyword/rule cards and uses the write/edit read gate", () => {
    const approve = vi.fn();

    render(
      <ToolActivity
        call={pendingCall()}
        onApprove={approve}
        onDeny={vi.fn()}
        provocation={{
          enabled: true,
          mode: "work",
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
    expect(screen.getByTestId("permission-approval-requirement")).toBeTruthy();
    const approveButton = screen.getByTestId("card-approve") as HTMLButtonElement;
    expect(approveButton.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("permission-read-confirm-checkbox"));
    expect(approveButton.disabled).toBe(false);
    fireEvent.click(approveButton);

    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0][0]).toBe("tool-1");
    expect(approve.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        source: "permission_card.approval",
        readGateSatisfied: true,
        readGateMethod: "checkbox",
      }),
    );
  });

  it("does not add approval friction for safe read_file calls", () => {
    const approve = vi.fn();

    render(
      <ToolActivity
        call={pendingCall({
          toolName: "read_file",
          paramsPreview: "path: src/App.tsx",
          risk: "safe",
          diffPreview: null,
          args: { path: "src/App.tsx" },
        })}
        onApprove={approve}
        onDeny={vi.fn()}
        provocation={{
          enabled: true,
          mode: "work",
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

  it("gates a secret-flagged danger write even when no diff preview is available", () => {
    const approve = vi.fn();

    render(
      <ToolActivity
        call={pendingCall({
          toolName: "write_file",
          risk: "danger",
          diffPreview: null,
          paramsPreview: "path: .env",
          args: { path: ".env", content: "API_KEY=sk-live-abc123" },
          approvalWarnings: {
            secretFlagged: true,
            secretReasons: ["looks like an API key"],
            wholeFileOverwrite: null,
          },
        })}
        onApprove={approve}
        onDeny={vi.fn()}
      />,
    );

    // No diff means no diff-acknowledgment checkbox…
    expect(screen.queryByTestId("danger-diff-ack-checkbox")).toBeNull();
    // …but the read gate still fires with a checkbox-only confirm.
    expect(screen.getByTestId("permission-approval-requirement")).toBeTruthy();
    const approveButton = screen.getByTestId("card-approve") as HTMLButtonElement;
    expect(approveButton.disabled).toBe(true);

    fireEvent.click(screen.getByTestId("permission-read-confirm-checkbox"));
    expect(approveButton.disabled).toBe(false);

    fireEvent.click(approveButton);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0][0]).toBe("tool-1");
    expect(approve.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        source: "permission_card.approval",
        readGateSatisfied: true,
        readGateMethod: "checkbox",
        secretFlagged: true,
      }),
    );
  });

  it("gates a diff-less warn write behind the read-confirm checkbox", () => {
    const approve = vi.fn();

    render(
      <ToolActivity
        call={pendingCall({
          toolName: "write_file",
          risk: "warn",
          diffPreview: null,
          paramsPreview: "path: notes.md",
          args: { path: "notes.md", content: "hello" },
        })}
        onApprove={approve}
        onDeny={vi.fn()}
      />,
    );

    expect(screen.getByTestId("permission-approval-requirement")).toBeTruthy();
    const approveButton = screen.getByTestId("card-approve") as HTMLButtonElement;
    expect(approveButton.disabled).toBe(true);

    fireEvent.click(screen.getByTestId("permission-read-confirm-checkbox"));
    expect(approveButton.disabled).toBe(false);
  });

  it("gates any secret-flagged non-Safe tool, even a non-write command", () => {
    // Defense-in-depth: requiresReadGate also fires on secretFlagged for tools
    // that are not write_file/edit_file, using the checkbox-only fallback.
    const approve = vi.fn();

    render(
      <ToolActivity
        call={pendingCall({
          toolName: "run_process",
          risk: "danger",
          diffPreview: null,
          paramsPreview: 'command: "deploy --token=…"',
          args: { command: "deploy", args: ["--token=sk-live-xyz"] },
          approvalWarnings: {
            secretFlagged: true,
            secretReasons: ["argument looks like a secret token"],
            wholeFileOverwrite: null,
          },
        })}
        onApprove={approve}
        onDeny={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("danger-diff-ack-checkbox")).toBeNull();
    const approveButton = screen.getByTestId("card-approve") as HTMLButtonElement;
    expect(approveButton.disabled).toBe(true);

    fireEvent.click(screen.getByTestId("permission-read-confirm-checkbox"));
    expect(approveButton.disabled).toBe(false);
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
          mode: "work",
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

  it("shows Project Command approval labels for direct argv metadata", () => {
    useLocaleStore.setState({ locale: "en" });

    render(
      <ToolActivity
        call={pendingCall({
          toolName: "run_process",
          paramsPreview: 'command: "pnpm test -- src/App.test.ts"',
          risk: "danger",
          diffPreview: null,
          runtimeAction: "project_command",
          args: {
            command: "pnpm",
            args: ["test", "--", "src/App.test.ts"],
            timeout_sec: 60,
            reason: "Run the step verification command.",
            expected_effect: "Runs tests without changing project files.",
          },
        })}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />,
    );

    expect(screen.getByTestId("project-command-details")).toBeTruthy();
    expect(screen.getByTestId("project-command-executable").textContent).toContain("pnpm");
    expect(screen.getByTestId("project-command-args").textContent).toContain(
      "test -- src/App.test.ts",
    );
    expect(screen.getByTestId("project-command-timeout").textContent).toContain("60s");
    expect(screen.getByTestId("project-command-reason").textContent).toContain(
      "Run the step verification command.",
    );
    expect(screen.getByTestId("project-command-expected-effect").textContent).toContain(
      "Runs tests without changing project files.",
    );
  });

  it("renders Project Command result summaries with a distinct runtime label", () => {
    useLocaleStore.setState({ locale: "en" });

    render(
      <ToolActivity
        call={pendingCall({
          status: "approved",
          toolName: "run_process",
          paramsPreview: 'command: "pnpm test"',
          runtimeAction: "project_command",
          diffPreview: null,
          args: { command: "pnpm", args: ["test"], timeout_sec: 60 },
        })}
        result={{
          id: "tr-tool-1",
          kind: "tool_result",
          createdAt: 2,
          toolName: "run_process",
          success: true,
          summary: "exit 0 - tests passed",
          runtimeAction: "project_command",
          executionEvidence: {
            evidenceId: "project-command-tool-1-2",
            source: "project_command",
            status: "passed",
            summary: "exit 0 - tests passed",
            stdoutSummary: "ok",
            stderrSummary: "",
            exitCode: 0,
          },
          full: {
            commandLabel: "pnpm test",
            exitCode: 0,
            stdoutSummary: "ok",
          },
        }}
      />,
    );

    expect(screen.getByText("Project Command")).toBeTruthy();
    expect(screen.getByText("exit 0 - tests passed")).toBeTruthy();
  });

  it("renders rerouted preview-open commands as no-run Preview guidance", () => {
    useLocaleStore.setState({ locale: "en" });

    render(
      <ToolActivity
        call={pendingCall({
          status: "rerouted",
          toolName: "run_process",
          paramsPreview: 'command: "open index.html"',
          runtimeAction: "project_command",
          diffPreview: null,
          args: { command: "open", args: ["index.html"] },
          deniedReason: "DIVE did not run the command. Use Preview for this local result.",
          routingDecision: {
            decisionId: "route-1",
            inputKind: "project_command",
            outcome: "rerouted",
            reasonCode: "preview_open_shell_workaround",
          },
        })}
      />,
    );

    expect(screen.getByText("Rerouted")).toBeTruthy();
    expect(screen.getByText("Opened through Preview instead")).toBeTruthy();
    expect(
      screen.getByText("DIVE did not run the command. Use Preview for this local result."),
    ).toBeTruthy();
  });

  it("renders stale approvals as no-command-ran states", () => {
    useLocaleStore.setState({ locale: "en" });

    render(
      <ToolActivity
        call={pendingCall({
          status: "stale",
          toolName: "run_process",
          paramsPreview: 'command: "pnpm test"',
          runtimeAction: "project_command",
          diffPreview: null,
          deniedReason: "This approval request is no longer active. DIVE did not run the command.",
        })}
      />,
    );

    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText("No command ran")).toBeTruthy();
    expect(
      screen.getByText("This approval request is no longer active. DIVE did not run the command."),
    ).toBeTruthy();
  });
});
