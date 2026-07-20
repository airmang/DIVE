// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import type { ProductShellController } from "./useProductShellController";
import { ProductShellLayout } from "./ProductShellLayout";

// Shared mount counter so the StepDetailSlideIn stub can report whether it was
// remounted (new id) or kept mounted (stable id) across open/close toggles.
const stepDetailMount = vi.hoisted(() => ({ seq: 0 }));

// Non-tested children are stubbed to null so the shell fixture stays minimal —
// this test only exercises ProductShellLayout's mount decision for StepDetail.
vi.mock("./TopBar", () => ({ TopBar: () => null }));
vi.mock("./ProjectRail", () => ({ ProjectRail: () => null }));
vi.mock("./ConversationPanel", () => ({ ConversationPanel: () => null }));
vi.mock("./ActionDock", () => ({ ActionDock: () => null }));
vi.mock("./ProductModalHost", () => ({ ProductModalHost: () => null }));
vi.mock("./RoadmapRail", () => ({ RoadmapRail: () => null }));
vi.mock("./RecoverySlideIn", () => ({ RecoverySlideIn: () => null }));
vi.mock("../../features/roadmap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../features/roadmap")>()),
  usePlanActivity: () => [],
}));

vi.mock("./StepDetailSlideIn", async () => {
  const React = await import("react");
  return {
    StepDetailSlideIn: (props: { open: boolean }) => {
      // useState initializer runs once per mount, so a remount yields a new id
      // while a kept-alive instance keeps the same id (state preserved).
      const [mountId] = React.useState(() => {
        stepDetailMount.seq += 1;
        return stepDetailMount.seq;
      });
      return React.createElement("div", {
        "data-testid": "step-detail-stub",
        "data-open": String(props.open),
        "data-mount-id": String(mountId),
      });
    },
  };
});

function makeShell(open: boolean): ProductShellController {
  return {
    projectName: "p",
    providerBanner: null,
    conversation: {},
    modals: {},
    roadmap: {
      visible: false,
      showEmpty: false,
      onCreatePlan: vi.fn(),
      onPlanStepOpened: vi.fn(),
    },
    planRoadmap: { hasPlan: false, status: null, openStep: vi.fn() },
    recovery: {
      open: false,
      onOpenChange: vi.fn(),
      panel: {},
      checkpointCount: 0,
      hasFailedStep: false,
    },
    stepDetail: { open, onOpenChange: vi.fn() },
    hiddenState: { currentCardId: null, lastManualCheckpointLabel: null },
  } as unknown as ProductShellController;
}

describe("ProductShellLayout StepDetail mount persistence (S-064 E2)", () => {
  beforeEach(() => {
    stepDetailMount.seq = 0;
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "ko" });
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the panel mounted after close so its review evidence is not discarded", async () => {
    const view = render(<ProductShellLayout shell={makeShell(true)} />);
    const opened = await screen.findByTestId("step-detail-stub");
    expect(opened.dataset.open).toBe("true");
    const firstMountId = opened.dataset.mountId;

    // Close: the panel used to be conditionally unmounted here, wiping local
    // review-evidence state. It must stay mounted (just hidden) instead.
    view.rerender(<ProductShellLayout shell={makeShell(false)} />);
    const closed = await screen.findByTestId("step-detail-stub");
    expect(closed.dataset.open).toBe("false");
    expect(closed.dataset.mountId).toBe(firstMountId);

    // Reopen: still the same instance — no remount, so the S-029 evidence held
    // in its local state survives a close/reopen round-trip.
    view.rerender(<ProductShellLayout shell={makeShell(true)} />);
    const reopened = await screen.findByTestId("step-detail-stub");
    expect(reopened.dataset.open).toBe("true");
    expect(reopened.dataset.mountId).toBe(firstMountId);
  });

  it("does not mount the panel until it is first opened (preserves lazy load)", () => {
    render(<ProductShellLayout shell={makeShell(false)} />);
    expect(screen.queryByTestId("step-detail-stub")).toBeNull();
  });
});
