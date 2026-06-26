// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { useLocaleStore } from "../../i18n";
import { WarnCard } from "./WarnCard";
import type { PermissionCardData } from "./types";

function card(): PermissionCardData {
  return {
    toolCallId: "tool-1",
    toolName: "edit_file",
    paramsPreview: "path: src/App.tsx",
    risk: "warn",
    diffPreview: {
      path: "src/App.tsx",
      before: "old",
      after: "new",
    },
    args: { path: "src/App.tsx", find: "old", replace: "new" },
  };
}

function ReadGateHarness({
  onApprove = vi.fn(),
}: {
  onApprove?: (toolCallId: string, modifiedArgs?: unknown) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <WarnCard
      card={card()}
      onApprove={onApprove}
      onDeny={vi.fn()}
      approvalRequirement={{
        required: true,
        satisfied: confirmed,
        message: "Read the diff first.",
        confirmLabel: "I read the change",
        confirmed,
        onConfirmChange: setConfirmed,
      }}
    />
  );
}

describe("WarnCard read gate", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
  });

  afterEach(() => cleanup());

  it("keeps Approve disabled until the read checkbox is ticked", () => {
    const approve = vi.fn();
    render(<ReadGateHarness onApprove={approve} />);

    const approveButton = screen.getByTestId("card-approve") as HTMLButtonElement;
    expect(approveButton.disabled).toBe(true);
    expect(screen.getByTestId("permission-approval-requirement").dataset.satisfied).toBe("false");

    fireEvent.click(screen.getByTestId("permission-read-confirm-checkbox"));

    expect(screen.getByTestId("permission-approval-requirement").dataset.satisfied).toBe("true");
    expect(approveButton.disabled).toBe(false);

    fireEvent.click(approveButton);
    expect(approve).toHaveBeenCalledWith("tool-1", undefined);
  });
});
