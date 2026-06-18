// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { PermissionCard } from "./PermissionCard";
import type { PermissionCardData } from "./types";

function permissionCard(overrides: Partial<PermissionCardData> = {}): PermissionCardData {
  return {
    toolCallId: "tool-1",
    toolName: "edit_file",
    paramsPreview: "src/App.tsx",
    risk: "warn",
    diffPreview: null,
    args: { path: "src/App.tsx" },
    actionContext: {
      expectedFiles: ["src/App.tsx"],
      writeFiles: ["src/App.tsx"],
      readFiles: ["src/App.tsx"],
      diffPreviewPath: "src/App.tsx",
      checkpointAvailable: true,
    },
    ...overrides,
  };
}

describe("PermissionCard supervision presentation", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
  });

  afterEach(() => cleanup());

  it("collapses metadata by default and does not duplicate choices as bullets", () => {
    render(<PermissionCard card={permissionCard()} onApprove={vi.fn()} onDeny={vi.fn()} />);

    const details = screen.getByTestId("permission-secondary-details") as HTMLDetailsElement;
    expect(screen.getByTestId("permission-card").dataset.cardFamily).toBe("permission-card");
    expect(screen.getByTestId("permission-summary").dataset.defaultMetadata).toBe("collapsed");
    expect(details.open).toBe(false);
    expect(screen.queryByTestId("permission-choices")).toBeNull();
    expect(screen.queryByText("선택할 수 있는 행동")).toBeNull();
  });

  it("exposes accessible names for primary permission controls", () => {
    render(<PermissionCard card={permissionCard()} onApprove={vi.fn()} onDeny={vi.fn()} />);

    expect(screen.getByRole("button", { name: "이 변경 허용" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "거부" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "사유 추가" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "요청 수정" })).toBeTruthy();
  });

  it("renders Terminal Script full-script high-risk one-shot approval details", () => {
    useLocaleStore.setState({ locale: "en" });
    render(
      <PermissionCard
        card={permissionCard({
          toolName: "run_terminal_script",
          risk: "danger",
          paramsPreview: 'script: "pnpm test; pnpm build"',
          args: {
            script: "pnpm test; pnpm build",
            shell_family: "posix",
            reason: "Need shell sequencing for two verification checks.",
            expected_effect: "Runs tests and build without changing project files.",
            timeout_sec: 120,
            output_limit: 32768,
            risk_factors: ["shell_script", "multiple_commands", "one_shot_high_risk"],
          },
          actionContext: undefined,
        })}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />,
    );

    expect(screen.getByText("Run a Terminal Script")).toBeTruthy();
    expect(screen.getByTestId("command-explainer-command").textContent).toContain(
      "pnpm test; pnpm build",
    );
    expect(screen.getByTestId("terminal-script-shell-family").textContent).toContain("posix");
    expect(screen.getByTestId("terminal-script-timeout").textContent).toContain("120s");
    expect(screen.getByTestId("terminal-script-output-limit").textContent).toContain("32768 bytes");
    expect(screen.getByTestId("terminal-script-risk-factors").textContent).toContain(
      "multiple_commands",
    );
    expect(screen.getByTestId("terminal-script-reason").textContent).toContain(
      "Need shell sequencing",
    );
    expect(screen.getByTestId("terminal-script-expected-effect").textContent).toContain(
      "Runs tests and build",
    );
    expect(screen.getByTestId("terminal-script-one-shot").textContent).toContain(
      "never reused automatically",
    );
  });
});
