// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import {
  createLiveProjectSpecDraft,
  quickIntakeInterviewAnswers,
  type ArchitectureDecision,
  type QuickIntakeInput,
} from "../../features/planning";
import { remainingInterviewDimensions } from "../../features/planning/remainingInterviewDimensions";
import { useProjectSessionStore } from "../../stores/project-session";
import { PrdAuthoringBoard, isPrdCompletionIntent } from "./PrdAuthoringBoard";

function renderBoard(overrides: Partial<Parameters<typeof PrdAuthoringBoard>[0]> = {}) {
  const props: Parameters<typeof PrdAuthoringBoard>[0] = {
    projectName: "DIVE",
    projectPath: "/tmp/dive",
    prdState: "draft",
    draft: createLiveProjectSpecDraft(42),
    busy: false,
    recentlyChangedFields: [],
    patchFeedback: null,
    onDraftChange: vi.fn(),
    onSubmitAnswer: vi.fn(),
    onSaveDraft: vi.fn(),
    onSavePrdAndCreatePlan: vi.fn(),
    onOpenHistory: vi.fn(),
    ...overrides,
  };
  render(<PrdAuthoringBoard {...props} />);
  return props;
}

describe("PrdAuthoringBoard", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
    useProjectSessionStore.setState({
      loaded: true,
      providers: [
        {
          id: 1,
          kind: "openai",
          auth_type: "api_key",
          base_url: null,
          is_connected: true,
          is_active: true,
          selected_model: "gpt-5.4",
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    useProjectSessionStore.setState({ loaded: false, providers: [] });
  });

  it("renders the board regions and keeps provider/model selection in the header", async () => {
    renderBoard();

    expect(screen.getByTestId("prd-authoring-board")).toBeTruthy();
    expect(screen.getByTestId("prd-board-header")).toBeTruthy();
    expect(screen.getByTestId("prd-interview-rail")).toBeTruthy();
    expect(screen.getByTestId("prd-live-canvas")).toBeTruthy();
    expect(screen.getByTestId("prd-bottom-action-bar")).toBeTruthy();
    expect(screen.queryByTestId("quick-intake-panel")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("chat-runtime-selector")).toBeTruthy());
  });

  it("glosses the jargon PRD field labels for a beginner (P1-11)", () => {
    renderBoard();

    expect(screen.getByText("Who uses it and why, in one sentence")).toBeTruthy();
    expect(screen.getByText("A condition you can check yourself to know it's done")).toBeTruthy();
  });

  it("keeps quick intake hidden behind the default-off flag", () => {
    renderBoard({ quickIntakeEnabled: false });

    expect(screen.queryByTestId("quick-intake-panel")).toBeNull();
    expect(screen.queryByTestId("quick-intake-toggle")).toBeNull();
  });

  it("maps concrete quick intake fields into the same PRD draft and interview dimensions", () => {
    const props = renderBoard({
      quickIntakeEnabled: true,
      onQuickIntakeSubmit: vi.fn(),
    });
    const input: QuickIntakeInput = {
      audience: "Bakery visitors browsing on phones",
      doneSignal: "A responsive bakery menu page shows categories, item names, and prices",
      inScope: "Static menu page; responsive layout; visible prices",
      outOfScope: "Online ordering; payment; admin editor",
      acceptanceCriterion1:
        "At 390px width, every menu category, item name, and price remains readable",
      acceptanceCriterion2:
        "Refreshing the page keeps all menu content visible without console errors",
    };

    fireEvent.click(screen.getByTestId("quick-intake-toggle"));
    for (const [key, value] of Object.entries(input) as Array<[keyof QuickIntakeInput, string]>) {
      fireEvent.change(screen.getByTestId(`quick-intake-${key}`), {
        target: { value },
      });
    }
    fireEvent.click(screen.getByTestId("quick-intake-submit"));

    expect(props.onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: expect.objectContaining({
          goal: input.doneSignal,
          intentSummary: `${input.audience} - ${input.doneSignal}`,
          scope: ["Static menu page", "responsive layout", "visible prices"],
          nonGoals: ["Online ordering", "payment", "admin editor"],
          acceptanceCriteria: expect.arrayContaining([
            expect.objectContaining({ text: input.acceptanceCriterion1 }),
            expect.objectContaining({ text: input.acceptanceCriterion2 }),
          ]),
        }),
      }),
    );
    expect(props.onQuickIntakeSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ spec: expect.objectContaining({ goal: input.doneSignal }) }),
      input,
    );
    expect(props.onSavePrdAndCreatePlan).not.toHaveBeenCalled();
    expect(remainingInterviewDimensions(quickIntakeInterviewAnswers(input))).toBe(0);
  });

  it("passes vague quick intake fields onward instead of marking a ready draft locally", () => {
    const props = renderBoard({
      quickIntakeEnabled: true,
      onQuickIntakeSubmit: vi.fn(),
    });
    const input: QuickIntakeInput = {
      audience: "users",
      doneSignal: "make it nice",
      inScope: "stuff",
      outOfScope: "nothing",
      acceptanceCriterion1: "looks good",
      acceptanceCriterion2: "works well",
    };

    fireEvent.click(screen.getByTestId("quick-intake-toggle"));
    for (const [key, value] of Object.entries(input) as Array<[keyof QuickIntakeInput, string]>) {
      fireEvent.change(screen.getByTestId(`quick-intake-${key}`), {
        target: { value },
      });
    }
    fireEvent.click(screen.getByTestId("quick-intake-submit"));

    expect(props.onQuickIntakeSubmit).toHaveBeenCalledTimes(1);
    expect(props.onSavePrdAndCreatePlan).not.toHaveBeenCalled();
    expect(screen.queryByTestId("plan-draft-approval")).toBeNull();
  });

  it("does not confirm a bare goal plus one criterion", () => {
    renderBoard();

    const primary = screen.getByTestId("prd-save-create-plan");
    const headerConfirm = screen.getByTestId("prd-confirm-header");
    expect(primary).toHaveProperty("disabled", true);
    expect(headerConfirm).toHaveProperty("disabled", true);

    // A bare goal and a single criterion is no longer concrete enough to confirm.
    fireEvent.change(screen.getByTestId("prd-goal-input"), {
      target: { value: "Build a PRD-first planning flow" },
    });
    fireEvent.change(screen.getByTestId("prd-criterion-input-0"), {
      target: { value: "Saved PRD opens the final read view" },
    });

    expect(primary).toHaveProperty("disabled", true);
    expect(headerConfirm).toHaveProperty("disabled", true);
  });

  it("confirms once the PRD is concrete and the architecture is decided", () => {
    const props = renderBoard({
      draft: createLiveProjectSpecDraft(42, {
        goal: "Build a PRD-first planning flow for students",
        intentSummary: "Students see and confirm the PRD before any plan is made",
        scope: ["Single PRD authoring board with a live draft"],
        nonGoals: ["No automatic plan generation without confirmation"],
        acceptanceCriteria: [
          "Saved PRD opens the final read view",
          "Confirm stays disabled until every required field is filled",
        ],
      }),
    });

    const primary = screen.getByTestId("prd-save-create-plan");
    const headerConfirm = screen.getByTestId("prd-confirm-header");
    // Every prose field is filled, but the tech stack is still unconfirmed, so
    // confirmation stays blocked (S-075 stack gate).
    expect(primary).toHaveProperty("disabled", true);
    expect(headerConfirm).toHaveProperty("disabled", true);

    // Write the stack: the PRD is now confirmable.
    fireEvent.change(screen.getByTestId("prd-architecture-stack-input"), {
      target: { value: "React + Vite" },
    });
    expect(primary).toHaveProperty("disabled", false);
    expect(headerConfirm).toHaveProperty("disabled", false);

    fireEvent.click(headerConfirm);
    expect(props.onSavePrdAndCreatePlan).toHaveBeenCalledTimes(1);
    const savedDraft = vi.mocked(props.onSavePrdAndCreatePlan).mock.calls[0][0];
    expect(savedDraft.spec.architecture).toMatchObject({
      stack: "React + Vite",
      decisionSource: "student_confirmed",
    });
  });

  // S-075 (014 theme 4, D-014-16): the architecture decision is one tech-stack
  // confirmation — AI cards fill the stack, the input is always editable, and
  // no project-kind picker exists (Constitution VII).
  describe("stack confirmation (S-075)", () => {
    function concreteDraft(architecture?: ArchitectureDecision | null) {
      return createLiveProjectSpecDraft(42, {
        goal: "Build a PRD-first planning flow for students",
        intentSummary: "Students see and confirm the PRD before any plan is made",
        scope: ["Single PRD authoring board with a live draft"],
        nonGoals: ["No automatic plan generation without confirmation"],
        acceptanceCriteria: [
          "Saved PRD opens the final read view",
          "Confirm stays disabled until every required field is filled",
        ],
        architecture: architecture ?? null,
      });
    }

    function latestDraft(props: ReturnType<typeof renderBoard>) {
      const calls = vi.mocked(props.onDraftChange).mock.calls;
      return calls[calls.length - 1][0];
    }

    it("renders the novice framing and no form controls", () => {
      renderBoard({ draft: concreteDraft() });

      const section = screen.getByTestId("prd-field-architecture");
      expect(section.textContent).toContain("How the AI plans to build it");
      expect(section.textContent).toContain("Nothing you build is restricted.");
      expect(section.querySelectorAll('[data-testid^="prd-architecture-form"]')).toHaveLength(0);
      expect(section.querySelectorAll("button")).toHaveLength(0);
      expect(screen.getByTestId("prd-architecture-stack-input")).toHaveProperty("disabled", false);
      expect(screen.getByTestId("prd-architecture-rationale-input")).toHaveProperty(
        "disabled",
        false,
      );
    });

    it("fills the stack from an AI card as a student-confirmed decision", () => {
      const props = renderBoard({
        draft: concreteDraft(),
        architectureProposals: {
          kind: "stack",
          options: [
            { value: "React + Vite", rationale: "A browser app — opens anywhere, no install" },
            { value: "Python + Flask", rationale: "A small web server the class can run" },
          ],
        },
      });

      const cards = screen.getByTestId("prd-architecture-stack-proposals");
      expect(
        within(cards).getByText("AI's proposal — tap to accept, or write your own"),
      ).toBeTruthy();
      expect(within(cards).getByText("A browser app — opens anywhere, no install")).toBeTruthy();
      expect(screen.getByTestId("prd-confirm-header")).toHaveProperty("disabled", true);

      fireEvent.click(screen.getByTestId("prd-architecture-stack-proposal-1"));

      expect(screen.getByTestId("prd-architecture-stack-input")).toHaveProperty(
        "value",
        "Python + Flask",
      );
      expect(latestDraft(props).spec.architecture).toMatchObject({
        stack: "Python + Flask",
        decisionSource: "student_confirmed",
      });
      expect(latestDraft(props).spec.architecture).not.toHaveProperty("forms");
      // The cards stay for this turn with the accepted one pressed (S-075
      // review nit), and confirmation is unblocked.
      expect(screen.getByTestId("prd-architecture-stack-proposals")).toBeTruthy();
      expect(
        screen.getByTestId("prd-architecture-stack-proposal-1").getAttribute("aria-pressed"),
      ).toBe("true");
      expect(
        screen.getByTestId("prd-architecture-stack-proposal-0").getAttribute("aria-pressed"),
      ).toBe("false");
      expect(screen.queryByTestId("prd-architecture-no-proposal")).toBeNull();
      expect(screen.getByTestId("prd-confirm-header")).toHaveProperty("disabled", false);
    });

    it("lets the student switch to the other card, marking the replacement as student_changed", () => {
      const props = renderBoard({
        draft: concreteDraft(),
        architectureProposals: {
          kind: "stack",
          options: [
            { value: "React + Vite", rationale: "A browser app" },
            { value: "Python + Flask", rationale: "A small web server" },
          ],
        },
      });

      fireEvent.click(screen.getByTestId("prd-architecture-stack-proposal-0"));
      expect(latestDraft(props).spec.architecture).toMatchObject({
        stack: "React + Vite",
        decisionSource: "student_confirmed",
      });

      fireEvent.click(screen.getByTestId("prd-architecture-stack-proposal-1"));
      expect(screen.getByTestId("prd-architecture-stack-input")).toHaveProperty(
        "value",
        "Python + Flask",
      );
      expect(latestDraft(props).spec.architecture).toMatchObject({
        stack: "Python + Flask",
        decisionSource: "student_changed",
      });
      expect(
        screen.getByTestId("prd-architecture-stack-proposal-1").getAttribute("aria-pressed"),
      ).toBe("true");
      expect(
        screen.getByTestId("prd-architecture-stack-proposal-0").getAttribute("aria-pressed"),
      ).toBe("false");
    });

    it("says there is no proposal yet only while no cards exist and nothing is typed", () => {
      renderBoard({ draft: concreteDraft() });
      expect(screen.getByTestId("prd-architecture-no-proposal").textContent).toBe(
        "No proposal yet — keep the conversation going and the AI will propose one, or write your own.",
      );

      // Typing a stack removes the line.
      fireEvent.change(screen.getByTestId("prd-architecture-stack-input"), {
        target: { value: "Rust" },
      });
      expect(screen.queryByTestId("prd-architecture-no-proposal")).toBeNull();

      // Cards present: the line is not shown even with a blank stack.
      cleanup();
      renderBoard({
        draft: concreteDraft(),
        architectureProposals: {
          kind: "stack",
          options: [{ value: "React + Vite", rationale: "A browser app" }],
        },
      });
      expect(screen.queryByTestId("prd-architecture-no-proposal")).toBeNull();
      expect(screen.getByTestId("prd-architecture-stack-proposals")).toBeTruthy();
    });

    it("treats a draft restored under the same draftId as the in-place stack (S-075 review P2)", () => {
      const onDraftChange = vi.fn();
      const baseProps: Parameters<typeof PrdAuthoringBoard>[0] = {
        projectName: "DIVE",
        projectPath: "/tmp/dive",
        prdState: "draft",
        draft: concreteDraft(),
        busy: false,
        recentlyChangedFields: [],
        patchFeedback: null,
        onDraftChange,
        onSubmitAnswer: vi.fn(),
        onSaveDraft: vi.fn(),
        onSavePrdAndCreatePlan: vi.fn(),
        onOpenHistory: vi.fn(),
      };
      const { rerender } = render(<PrdAuthoringBoard {...baseProps} />);
      expect(screen.getByTestId("prd-architecture-stack-input")).toHaveProperty("value", "");

      // The async reopen path delivers a restored draft: a different object,
      // the SAME draftId, carrying the stack the student confirmed earlier.
      const restored = concreteDraft({
        stack: "React + Vite",
        rationale: null,
        decisionSource: "student_confirmed",
        decidedInVersion: 1,
      });
      expect(restored.draftId).toBe(baseProps.draft.draftId);
      rerender(<PrdAuthoringBoard {...baseProps} draft={restored} />);
      expect(screen.getByTestId("prd-architecture-stack-input")).toHaveProperty(
        "value",
        "React + Vite",
      );

      fireEvent.change(screen.getByTestId("prd-architecture-stack-input"), {
        target: { value: "React + Vite + TypeScript" },
      });
      const calls = onDraftChange.mock.calls;
      expect(calls[calls.length - 1][0].spec.architecture).toMatchObject({
        stack: "React + Vite + TypeScript",
        decisionSource: "student_changed",
      });
    });

    it("keeps the committed stack through clear-then-retype (S-075 review P2)", () => {
      const props = renderBoard({ draft: concreteDraft() });
      const input = screen.getByTestId("prd-architecture-stack-input");

      fireEvent.change(input, { target: { value: "React + Vite" } });
      fireEvent.blur(input);
      expect(latestDraft(props).spec.architecture).toMatchObject({
        stack: "React + Vite",
        decisionSource: "student_confirmed",
      });

      // Clearing and leaving the field must not forget what was confirmed.
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.blur(input);
      fireEvent.change(input, { target: { value: "Svelte" } });
      expect(latestDraft(props).spec.architecture).toMatchObject({
        stack: "Svelte",
        decisionSource: "student_changed",
      });

      // Typing the confirmed stack back verbatim restores its source.
      fireEvent.change(input, { target: { value: "React + Vite" } });
      expect(latestDraft(props).spec.architecture).toMatchObject({
        stack: "React + Vite",
        decisionSource: "student_confirmed",
      });
    });

    it("marks an edit after accepting a card as student_changed", () => {
      const props = renderBoard({
        draft: concreteDraft(),
        architectureProposals: {
          kind: "stack",
          options: [{ value: "React + Vite", rationale: "A browser app" }],
        },
      });

      fireEvent.click(screen.getByTestId("prd-architecture-stack-proposal-0"));
      fireEvent.change(screen.getByTestId("prd-architecture-stack-input"), {
        target: { value: "React + Vite + TypeScript" },
      });

      expect(latestDraft(props).spec.architecture).toMatchObject({
        stack: "React + Vite + TypeScript",
        decisionSource: "student_changed",
      });
    });

    it("keeps a freshly typed stack student_confirmed until it is edited later", () => {
      const props = renderBoard({ draft: concreteDraft() });
      const input = screen.getByTestId("prd-architecture-stack-input");

      // Typing the first stack character by character is one typed stack.
      fireEvent.change(input, { target: { value: "R" } });
      fireEvent.change(input, { target: { value: "Ru" } });
      fireEvent.change(input, { target: { value: "Rust" } });
      expect(latestDraft(props).spec.architecture).toMatchObject({
        stack: "Rust",
        decisionSource: "student_confirmed",
      });

      // Leaving the field and coming back to edit it is a change.
      fireEvent.blur(input);
      fireEvent.change(input, { target: { value: "Rust + Tauri" } });
      expect(latestDraft(props).spec.architecture).toMatchObject({
        stack: "Rust + Tauri",
        decisionSource: "student_changed",
      });
    });

    it("marks editing a stack restored with the draft as student_changed", () => {
      const props = renderBoard({
        draft: concreteDraft({
          stack: "React + Vite",
          rationale: null,
          decisionSource: "student_confirmed",
          decidedInVersion: 1,
        }),
      });

      fireEvent.change(screen.getByTestId("prd-architecture-stack-input"), {
        target: { value: "Svelte" },
      });
      expect(latestDraft(props).spec.architecture).toMatchObject({
        stack: "Svelte",
        decisionSource: "student_changed",
      });
    });

    it("keeps the rationale optional and writable without a stack", () => {
      const props = renderBoard({ draft: concreteDraft() });

      fireEvent.change(screen.getByTestId("prd-architecture-rationale-input"), {
        target: { value: "Because the class already knows Python" },
      });
      expect(latestDraft(props).spec.architecture).toMatchObject({
        stack: null,
        rationale: "Because the class already knows Python",
      });
      expect(screen.getByTestId("prd-confirm-header")).toHaveProperty("disabled", true);
    });
  });

  it("renders AI stack proposals as cards and fills the stack on pick (S-047)", () => {
    renderBoard({
      draft: createLiveProjectSpecDraft(42, {
        goal: "Build a personal schedule app for students",
        architecture: {
          stack: null,
          rationale: null,
          decisionSource: "student_confirmed",
          decidedInVersion: 1,
        },
      }),
      architectureProposals: {
        kind: "stack",
        options: [{ value: "React + Vite", rationale: "Beginner-friendly web stack" }],
      },
    });

    const cards = screen.getByTestId("prd-architecture-stack-proposals");
    expect(within(cards).getByText("React + Vite")).toBeTruthy();

    fireEvent.click(screen.getByTestId("prd-architecture-stack-proposal-0"));
    expect(screen.getByTestId("prd-architecture-stack-input")).toHaveProperty(
      "value",
      "React + Vite",
    );
    // The cards stay for this turn (they clear on the next turn), with the
    // chosen one shown pressed (S-075 review nit).
    expect(
      screen.getByTestId("prd-architecture-stack-proposal-0").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("highlights fields changed by an applied interview-turn patch", () => {
    renderBoard({
      draft: createLiveProjectSpecDraft(42, {
        goal: "Build a PRD board",
        acceptanceCriteria: ["Canvas updates live"],
      }),
      recentlyChangedFields: ["goal", "acceptanceCriteria"],
      patchFeedback: {
        validationOutcome: "applied",
        appliedFieldPaths: ["goal", "acceptanceCriteria"],
        rejectedReasons: [],
      },
    });

    expect(screen.getByTestId("prd-field-goal").dataset.changed).toBe("true");
    expect(screen.getByTestId("prd-field-acceptanceCriteria").dataset.changed).toBe("true");
    expect(screen.getByTestId("prd-patch-feedback").dataset.outcome).toBe("applied");
  });

  it("protects direct student edits when a later patch conflicts with the field", () => {
    const props = renderBoard({
      draft: createLiveProjectSpecDraft(42, {
        goal: "Student-owned goal",
        studentEditedFields: ["goal"],
      }),
      patchFeedback: {
        validationOutcome: "held_for_student",
        appliedFieldPaths: [],
        rejectedReasons: ["student_edit_conflict"],
      },
    });

    expect(screen.getByTestId("prd-goal-input")).toHaveProperty("value", "Student-owned goal");
    expect(screen.getByTestId("prd-patch-feedback").dataset.outcome).toBe("held_for_student");

    fireEvent.change(screen.getByTestId("prd-goal-input"), {
      target: { value: "Student goal stays authoritative" },
    });
    expect(props.onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        studentEditedFields: expect.arrayContaining(["goal"]),
      }),
    );
  });

  it("renders the honest net-zero framing for a genuine none outcome (S-053 D2)", () => {
    renderBoard({
      patchFeedback: {
        validationOutcome: "none",
        appliedFieldPaths: [],
        rejectedReasons: [],
      },
    });

    expect(screen.getByTestId("prd-patch-feedback").dataset.outcome).toBe("none");
    expect(
      screen.getByText("That answer did not change anything in the PRD this time."),
    ).toBeTruthy();
    expect(screen.queryByTestId("prd-restructure-retry")).toBeNull();
  });

  it("renders the actual rejection reasons for a policy-rejected patch (S-053 D2)", () => {
    renderBoard({
      patchFeedback: {
        validationOutcome: "rejected",
        appliedFieldPaths: [],
        rejectedReasons: ["too_many_operations", "secret_like_text"],
      },
    });

    const feedback = screen.getByTestId("prd-patch-feedback");
    expect(feedback.dataset.outcome).toBe("rejected");
    expect(screen.getByTestId("prd-rejected-reason-too_many_operations")).toBeTruthy();
    expect(screen.getByTestId("prd-rejected-reason-secret_like_text")).toBeTruthy();
    expect(within(feedback).getByText("Too many changes were proposed at once.")).toBeTruthy();
    expect(
      within(feedback).getByText("The text looked like it might contain a password or key."),
    ).toBeTruthy();
    expect(screen.queryByTestId("prd-restructure-retry")).toBeNull();
  });

  it("falls back to an honest unknown-reason line for an unmapped rejection code (S-053 D2)", () => {
    renderBoard({
      patchFeedback: {
        validationOutcome: "rejected",
        appliedFieldPaths: [],
        rejectedReasons: ["some_future_reason_code"],
      },
    });

    expect(screen.getByTestId("prd-rejected-reason-some_future_reason_code")).toBeTruthy();
    expect(screen.getByText("It was not applied for another reason.")).toBeTruthy();
  });

  it(
    "shows a not_structured retry that re-sends the same answer + context without a " +
      "duplicate student bubble, and disables while busy (S-053 D2)",
    async () => {
      const onSubmitAnswer = vi.fn().mockResolvedValue({ assistantMessage: "raw model text" });
      const baseProps: Parameters<typeof PrdAuthoringBoard>[0] = {
        projectName: "DIVE",
        projectPath: "/tmp/dive",
        prdState: "draft",
        draft: createLiveProjectSpecDraft(42),
        busy: false,
        recentlyChangedFields: [],
        patchFeedback: null,
        onDraftChange: vi.fn(),
        onSubmitAnswer,
        onSaveDraft: vi.fn(),
        onSavePrdAndCreatePlan: vi.fn(),
        onOpenHistory: vi.fn(),
      };
      const { rerender } = render(<PrdAuthoringBoard {...baseProps} />);
      const rail = screen.getByTestId("prd-interview-rail");
      const answerText = "It should let students undo an accidental delete.";

      fireEvent.change(within(rail).getByTestId("prd-interview-input"), {
        target: { value: answerText },
      });
      fireEvent.click(within(rail).getByTestId("prd-interview-send"));

      await waitFor(() => expect(onSubmitAnswer).toHaveBeenCalledTimes(1));
      const [firstAnswer, firstContext] = onSubmitAnswer.mock.calls[0] as [string, unknown];
      expect(firstAnswer).toBe(answerText);

      // The parent (useProductShellController) reflects the turn result back as
      // a patchFeedback prop update — simulate that.
      const notStructuredFeedback = {
        validationOutcome: "not_structured" as const,
        appliedFieldPaths: [],
        rejectedReasons: [],
      };
      rerender(<PrdAuthoringBoard {...baseProps} patchFeedback={notStructuredFeedback} />);

      expect(screen.getByTestId("prd-patch-feedback").dataset.outcome).toBe("not_structured");
      const retryButton = screen.getByTestId("prd-restructure-retry");
      expect(retryButton).toBeTruthy();

      fireEvent.click(retryButton);

      await waitFor(() => expect(onSubmitAnswer).toHaveBeenCalledTimes(2));
      // Same answer, same conversation context as the original attempt — not a
      // fresh context that would now include the model's own unstructured reply.
      expect(onSubmitAnswer.mock.calls[1]).toEqual([firstAnswer, firstContext]);
      // No duplicate student bubble: the answer appears exactly once.
      expect(screen.getAllByText(answerText)).toHaveLength(1);

      rerender(<PrdAuthoringBoard {...baseProps} busy patchFeedback={notStructuredFeedback} />);
      expect(screen.getByTestId("prd-restructure-retry")).toHaveProperty("disabled", true);
    },
  );

  it("submits short interview answers from the rail", () => {
    const props = renderBoard();
    const rail = screen.getByTestId("prd-interview-rail");

    fireEvent.change(within(rail).getByTestId("prd-interview-input"), {
      target: { value: "Users need to see the PRD before plan creation." },
    });
    fireEvent.click(within(rail).getByTestId("prd-interview-send"));

    expect(props.onSubmitAnswer).toHaveBeenCalledWith(
      "Users need to see the PRD before plan creation.",
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant" }),
        {
          role: "student",
          text: "Users need to see the PRD before plan creation.",
        },
      ]),
    );
  });

  // S-073 (D-014-07): the interview rail is a chat composer — Enter sends,
  // Shift+Enter is a newline, and an IME-composing Enter never sends.
  describe("interview rail Enter-to-send (S-073)", () => {
    it("submits the trimmed answer on a plain Enter and shows the hint line", () => {
      const props = renderBoard();
      const rail = screen.getByTestId("prd-interview-rail");
      const input = within(rail).getByTestId("prd-interview-input");

      expect(within(rail).getByTestId("prd-interview-enter-hint").textContent).toContain(
        "Enter to send",
      );

      fireEvent.change(input, { target: { value: "  Teachers need a quick handoff list.  " } });
      // dispatchEvent returns false when the handler called preventDefault —
      // the send must swallow the Enter so no newline lands in the textarea.
      expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);

      expect(props.onSubmitAnswer).toHaveBeenCalledTimes(1);
      expect(vi.mocked(props.onSubmitAnswer).mock.calls[0][0]).toBe(
        "Teachers need a quick handoff list.",
      );
      expect(input).toHaveProperty("value", "");
    });

    it("does not submit on Shift+Enter (newline) or while an IME composition is open", () => {
      const props = renderBoard();
      const rail = screen.getByTestId("prd-interview-rail");
      const input = within(rail).getByTestId("prd-interview-input");

      fireEvent.change(input, { target: { value: "첫 줄" } });
      // Shift+Enter keeps its default (the newline): dispatchEvent returns true
      // only when nothing called preventDefault.
      expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true);
      expect(props.onSubmitAnswer).not.toHaveBeenCalled();

      fireEvent.keyDown(input, { key: "Enter", isComposing: true });
      expect(props.onSubmitAnswer).not.toHaveBeenCalled();

      // Legacy IME placeholder: the key IS "Enter"; only keyCode says composing.
      fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
      expect(props.onSubmitAnswer).not.toHaveBeenCalled();
      expect(input).toHaveProperty("value", "첫 줄");
    });

    it("does not submit an empty answer on Enter", () => {
      const props = renderBoard();
      const input = within(screen.getByTestId("prd-interview-rail")).getByTestId(
        "prd-interview-input",
      );

      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(props.onSubmitAnswer).not.toHaveBeenCalled();
    });
  });

  // S-073 (D-014-08): the gate is unchanged; what changes is that a student can
  // see how many requirements remain and jump to the first missing field.
  describe("confirm-gate legibility (S-073)", () => {
    interface ScrollStub {
      calls: Array<{ target: Element; options: unknown }>;
      restore: () => void;
    }

    // jsdom has no Element.prototype.scrollIntoView; install one that records
    // the receiver so the test can assert *which* container was scrolled.
    function stubScrollIntoView(): ScrollStub {
      const proto = Element.prototype as unknown as { scrollIntoView?: unknown };
      const original = proto.scrollIntoView;
      const calls: ScrollStub["calls"] = [];
      proto.scrollIntoView = function (this: Element, options: unknown) {
        calls.push({ target: this, options });
      };
      return {
        calls,
        restore: () => {
          if (original === undefined) delete proto.scrollIntoView;
          else proto.scrollIntoView = original;
        },
      };
    }

    function confirmableDraft() {
      return createLiveProjectSpecDraft(42, {
        goal: "Build a PRD-first planning flow for students",
        intentSummary: "Students see and confirm the PRD before any plan is made",
        scope: ["Single PRD authoring board with a live draft"],
        nonGoals: ["No automatic plan generation without confirmation"],
        acceptanceCriteria: [
          "Saved PRD opens the final read view",
          "Confirm stays disabled until every required field is filled",
        ],
        architecture: {
          stack: "React + Vite",
          rationale: null,
          decisionSource: "student_confirmed",
          decidedInVersion: 1,
        },
      });
    }

    it("shows the remaining count and points both confirm buttons at the footer hint", () => {
      renderBoard();

      const chip = screen.getByTestId("prd-confirm-remaining");
      // A blank draft misses goal, intent, scope, non-goals, 2 criteria, and the
      // tech stack (S-075: the stack is the whole architecture decision) — 6.
      expect(chip.dataset.count).toBe("6");
      expect(chip.textContent).toBe("6 to go before confirming");
      expect(chip).toHaveProperty("disabled", false);
      expect(chip.getAttribute("title")).toContain("The goal is still empty.");
      expect(chip.getAttribute("title")).toContain(
        "Confirm the tech stack the AI proposed, or write your own.",
      );
      expect(chip.getAttribute("aria-describedby")).toBe("prd-validation-hint");
      // S-074 review (E): the short count is the live region, not the footer.
      expect(chip.querySelector('[aria-live="polite"]')?.textContent).toBe(
        "6 to go before confirming",
      );

      const hint = screen.getByTestId("prd-validation-hint");
      expect(hint.id).toBe("prd-validation-hint");
      expect(hint.getAttribute("role")).toBeNull();
      // Same six sentences: one per line in the tooltip, " / "-joined in the footer.
      expect(chip.getAttribute("title")?.split("\n")).toEqual(hint.textContent?.split(" / "));
      expect(chip.getAttribute("title")?.split("\n")).toHaveLength(6);

      expect(screen.getByTestId("prd-confirm-header").getAttribute("aria-describedby")).toBe(
        "prd-validation-hint",
      );
      expect(screen.getByTestId("prd-save-create-plan").getAttribute("aria-describedby")).toBe(
        "prd-validation-hint",
      );
    });

    it("renders the Korean count copy under the Korean locale", () => {
      useLocaleStore.setState({ locale: "ko" });
      renderBoard();

      expect(screen.getByTestId("prd-confirm-remaining").textContent).toBe("확정까지 6개 남음");
    });

    it("scrolls to and focuses the first missing field when the chip is clicked", () => {
      const scroll = stubScrollIntoView();
      try {
        renderBoard({
          draft: createLiveProjectSpecDraft(42, {
            goal: "Build a PRD-first planning flow for students",
            intentSummary: "Students see and confirm the PRD before any plan is made",
          }),
        });

        const chip = screen.getByTestId("prd-confirm-remaining");
        // Goal + intent are done: scope, non-goals, criteria, stack remain.
        expect(chip.dataset.count).toBe("4");

        fireEvent.click(chip);

        expect(scroll.calls).toHaveLength(1);
        expect(scroll.calls[0].target).toBe(screen.getByTestId("prd-field-scope"));
        expect(scroll.calls[0].options).toEqual({ block: "center", behavior: "smooth" });
        expect(document.activeElement).toBe(screen.getByTestId("prd-scope-input"));
      } finally {
        scroll.restore();
      }
    });

    it("targets the goal field first on a blank draft", () => {
      const scroll = stubScrollIntoView();
      try {
        renderBoard();
        fireEvent.click(screen.getByTestId("prd-confirm-remaining"));

        expect(scroll.calls[0]?.target).toBe(screen.getByTestId("prd-field-goal"));
        expect(document.activeElement).toBe(screen.getByTestId("prd-goal-input"));
      } finally {
        scroll.restore();
      }
    });

    it("focuses the stack input when only the architecture stack is missing", () => {
      const scroll = stubScrollIntoView();
      try {
        renderBoard({
          draft: createLiveProjectSpecDraft(42, {
            goal: "Build a PRD-first planning flow for students",
            intentSummary: "Students see and confirm the PRD before any plan is made",
            scope: ["Single PRD authoring board with a live draft"],
            nonGoals: ["No automatic plan generation without confirmation"],
            acceptanceCriteria: [
              "Saved PRD opens the final read view",
              "Confirm stays disabled until every required field is filled",
            ],
            architecture: {
              stack: null,
              rationale: null,
              decisionSource: "student_confirmed",
              decidedInVersion: 1,
            },
          }),
        });

        const chip = screen.getByTestId("prd-confirm-remaining");
        expect(chip.dataset.count).toBe("1");
        expect(chip.getAttribute("title")).toBe(
          "Confirm the tech stack the AI proposed, or write your own.",
        );

        fireEvent.click(chip);

        expect(scroll.calls[0]?.target).toBe(screen.getByTestId("prd-field-architecture"));
        expect(document.activeElement).toBe(screen.getByTestId("prd-architecture-stack-input"));
      } finally {
        scroll.restore();
      }
    });

    it("survives a missing scrollIntoView (jsdom) and still focuses the field", () => {
      renderBoard();
      fireEvent.click(screen.getByTestId("prd-confirm-remaining"));

      expect(document.activeElement).toBe(screen.getByTestId("prd-goal-input"));
    });

    it("hides the chip and drops aria-describedby once the PRD is confirmable", () => {
      renderBoard({
        draft: createLiveProjectSpecDraft(42, {
          goal: "Build a PRD-first planning flow for students",
          intentSummary: "Students see and confirm the PRD before any plan is made",
          scope: ["Single PRD authoring board with a live draft"],
          nonGoals: ["No automatic plan generation without confirmation"],
          acceptanceCriteria: [
            "Saved PRD opens the final read view",
            "Confirm stays disabled until every required field is filled",
          ],
          architecture: {
            stack: "React + Vite",
            rationale: null,
            decisionSource: "student_confirmed",
            decidedInVersion: 1,
          },
        }),
      });

      expect(screen.queryByTestId("prd-confirm-remaining")).toBeNull();
      expect(screen.getByTestId("prd-validation-hint").textContent).toBe(
        "Ready to confirm the PRD.",
      );
      expect(screen.getByTestId("prd-confirm-header").getAttribute("aria-describedby")).toBeNull();
      expect(
        screen.getByTestId("prd-save-create-plan").getAttribute("aria-describedby"),
      ).toBeNull();
    });

    it("counts the stack as the one remaining gap and clears the chip once it is written (S-075)", () => {
      const scroll = stubScrollIntoView();
      try {
        renderBoard({
          draft: createLiveProjectSpecDraft(42, {
            goal: "Build a PRD-first planning flow for students",
            intentSummary: "Students see and confirm the PRD before any plan is made",
            scope: ["Single PRD authoring board with a live draft"],
            nonGoals: ["No automatic plan generation without confirmation"],
            acceptanceCriteria: [
              "Saved PRD opens the final read view",
              "Confirm stays disabled until every required field is filled",
            ],
          }),
        });

        const chip = screen.getByTestId("prd-confirm-remaining");
        expect(chip.dataset.count).toBe("1");
        expect(chip.textContent).toBe("1 to go before confirming");

        fireEvent.click(chip);
        expect(scroll.calls[0]?.target).toBe(screen.getByTestId("prd-field-architecture"));
        expect(document.activeElement).toBe(screen.getByTestId("prd-architecture-stack-input"));

        fireEvent.change(screen.getByTestId("prd-architecture-stack-input"), {
          target: { value: "React + Vite" },
        });
        expect(screen.queryByTestId("prd-confirm-remaining")).toBeNull();
      } finally {
        scroll.restore();
      }
    });

    it("describes a valid-but-busy PRD with a wait tooltip, not the ready hint (S-074 review C)", () => {
      renderBoard({ draft: confirmableDraft(), busy: true });

      const header = screen.getByTestId("prd-confirm-header");
      const footer = screen.getByTestId("prd-save-create-plan");
      expect(header).toHaveProperty("disabled", true);
      expect(footer).toHaveProperty("disabled", true);
      // The gate is satisfied, so nothing points at "ready to confirm"...
      expect(header.getAttribute("aria-describedby")).toBeNull();
      expect(footer.getAttribute("aria-describedby")).toBeNull();
      expect(screen.queryByTestId("prd-confirm-remaining")).toBeNull();
      // ...and the buttons explain the wait instead.
      expect(header.getAttribute("title")).toBe("Please wait while the AI finishes this turn");
      expect(footer.getAttribute("title")).toBe("Please wait while the AI finishes this turn");
    });

    it("keeps the gate description and no wait tooltip while busy but still invalid", () => {
      renderBoard({ busy: true });

      const header = screen.getByTestId("prd-confirm-header");
      expect(header).toHaveProperty("disabled", true);
      expect(header.getAttribute("aria-describedby")).toBe("prd-validation-hint");
      expect(header.getAttribute("title")).toBeNull();
      expect(screen.getByTestId("prd-confirm-remaining")).toBeTruthy();
    });
  });

  // S-074 review (A): since S-073 the interview can retire a criterion. A
  // retired one must not look like — or edit like — an active row, and must
  // never count toward the two-criteria gate.
  describe("retired acceptance criteria (S-074 review A)", () => {
    const active = (criterionId: string, text: string) => ({
      criterionId,
      text,
      source: "interview" as const,
      status: "active" as const,
      createdInVersion: 1,
      retiredInVersion: null,
    });
    const retired = (criterionId: string, text: string) => ({
      criterionId,
      text,
      source: "interview" as const,
      status: "retired" as const,
      createdInVersion: 1,
      retiredInVersion: 2,
    });
    function draftWithCriteria(criteria: unknown[]) {
      return createLiveProjectSpecDraft(42, {
        goal: "Build a PRD-first planning flow for students",
        intentSummary: "Students see and confirm the PRD before any plan is made",
        scope: ["Single PRD authoring board with a live draft"],
        nonGoals: ["No automatic plan generation without confirmation"],
        acceptanceCriteria: criteria,
        architecture: {
          stack: "React + Vite",
          rationale: null,
          decisionSource: "student_confirmed",
          decidedInVersion: 1,
        },
      });
    }
    function latestDraft(props: ReturnType<typeof renderBoard>) {
      const calls = vi.mocked(props.onDraftChange).mock.calls;
      return calls[calls.length - 1][0];
    }

    it("renders retired criteria read-only below the rows and leaves them out of the gate", () => {
      renderBoard({
        draft: draftWithCriteria([
          active("AC-001", "Saved PRD opens the final read view"),
          retired("AC-002", "Old criterion that no longer applies"),
        ]),
      });

      // Editable rows: the one active criterion plus the trailing placeholder.
      expect(screen.getByTestId("prd-criterion-input-0")).toHaveProperty(
        "value",
        "Saved PRD opens the final read view",
      );
      expect(screen.getByTestId("prd-criterion-input-1")).toHaveProperty("value", "");
      expect(screen.queryByTestId("prd-criterion-input-2")).toBeNull();
      expect(screen.queryByDisplayValue("Old criterion that no longer applies")).toBeNull();

      const retiredList = screen.getByTestId("prd-retired-criteria");
      expect(within(retiredList).getByText("Retired done criteria")).toBeTruthy();
      expect(within(retiredList).getByText("AC-002")).toBeTruthy();
      expect(
        within(retiredList).getByText("Old criterion that no longer applies").className,
      ).toContain("line-through");

      // One active criterion: the gate still wants a second one.
      const chip = screen.getByTestId("prd-confirm-remaining");
      expect(chip.dataset.count).toBe("1");
      expect(chip.getAttribute("title")).toBe(
        "Add at least two concrete, checkable done criteria.",
      );
      expect(screen.getByTestId("prd-confirm-header")).toHaveProperty("disabled", true);
    });

    it("restores a retired criterion through the student-edit path and satisfies the gate", () => {
      const props = renderBoard({
        draft: draftWithCriteria([
          active("AC-001", "Saved PRD opens the final read view"),
          retired("AC-002", "Old criterion that no longer applies"),
        ]),
      });

      fireEvent.click(screen.getByTestId("prd-restore-criterion-AC-002"));

      const last = latestDraft(props);
      expect(last.spec.acceptanceCriteria[1]).toMatchObject({
        criterionId: "AC-002",
        text: "Old criterion that no longer applies",
        status: "active",
        retiredInVersion: null,
      });
      expect(last.studentEditedFields).toContain("acceptanceCriteria");
      // Now an editable row, no longer listed as retired, and the gate is met.
      expect(screen.getByTestId("prd-criterion-input-1")).toHaveProperty(
        "value",
        "Old criterion that no longer applies",
      );
      expect(screen.queryByTestId("prd-retired-criteria")).toBeNull();
      expect(screen.queryByTestId("prd-confirm-remaining")).toBeNull();
      expect(screen.getByTestId("prd-confirm-header")).toHaveProperty("disabled", false);
    });

    it("edits the right criterion when a retired one sits between active rows", () => {
      const props = renderBoard({
        draft: draftWithCriteria([
          active("AC-001", "First criterion"),
          retired("AC-002", "Retired middle criterion"),
          active("AC-003", "Third criterion"),
        ]),
      });

      // Display row 1 is AC-003: the retired AC-002 is skipped, not shifted onto.
      const row1 = screen.getByTestId("prd-criterion-input-1");
      expect(row1.getAttribute("data-criterion-id")).toBe("AC-003");
      fireEvent.change(row1, { target: { value: "Third criterion, revised" } });

      expect(
        latestDraft(props).spec.acceptanceCriteria.map((criterion) => [
          criterion.criterionId,
          criterion.text,
          criterion.status,
        ]),
      ).toEqual([
        ["AC-001", "First criterion", "active"],
        ["AC-002", "Retired middle criterion", "retired"],
        ["AC-003", "Third criterion, revised", "active"],
      ]);
      // The trailing placeholder is keyed by the next free id, past the retired one.
      expect(screen.getByTestId("prd-criterion-input-2").getAttribute("data-criterion-id")).toBe(
        "AC-004",
      );
    });

    it("allocates an id on the first text typed into a button-added blank row", () => {
      const props = renderBoard({
        draft: draftWithCriteria([active("AC-001", "First criterion")]),
      });

      fireEvent.click(screen.getByTestId("prd-add-criterion"));
      const blank = screen.getByTestId("prd-criterion-input-1") as HTMLInputElement;
      expect(latestDraft(props).spec.acceptanceCriteria[1].criterionId).toBe("");
      expect(blank.getAttribute("data-criterion-id")).toBe("AC-002");

      blank.focus();
      fireEvent.change(blank, { target: { value: "S" } });
      fireEvent.change(blank, { target: { value: "Se" } });

      expect(latestDraft(props).spec.acceptanceCriteria[1].criterionId).toBe("AC-002");
      // Same node, never remounted: the pre-allocated key matched the real id.
      expect(screen.getByTestId("prd-criterion-input-1")).toBe(blank);
      expect(document.activeElement).toBe(blank);
    });
  });

  // S-074 review (B): a held turn may still have applied some ops; the copy
  // must not imply nothing landed.
  describe("held_for_student copy (S-074 review B)", () => {
    const held = (appliedFieldPaths: string[]) => ({
      validationOutcome: "held_for_student" as const,
      appliedFieldPaths,
      rejectedReasons: ["student_edit_conflict"],
    });

    it("says the suggestion was held when nothing was applied", () => {
      renderBoard({ patchFeedback: held([]) });

      expect(screen.getByTestId("prd-patch-feedback").textContent).toBe(
        "Student-edited fields stayed intact; the new suggestion was held separately.",
      );
    });

    it("says some changes were applied when the turn was only partly held", () => {
      renderBoard({ patchFeedback: held(["scope"]) });

      expect(screen.getByTestId("prd-patch-feedback").textContent).toBe(
        "Some changes were applied; the parts that overlapped a field you edited yourself were held.",
      );
    });
  });

  it("offers an Add-criterion button and a trailing empty row for manual authoring", () => {
    const props = renderBoard({
      draft: createLiveProjectSpecDraft(42, {
        goal: "Build a simple to-do list",
        acceptanceCriteria: ["Adding an item shows it in the list immediately"],
      }),
    });

    // The single AI criterion plus a trailing empty row the student can type into.
    expect(screen.getByTestId("prd-criterion-input-0")).toHaveProperty(
      "value",
      "Adding an item shows it in the list immediately",
    );
    const trailing = screen.getByTestId("prd-criterion-input-1");
    expect(trailing).toHaveProperty("value", "");
    expect(screen.getByTestId("prd-add-criterion")).toBeTruthy();

    // Typing in the trailing row authors a second criterion by hand (P1-30).
    fireEvent.change(trailing, {
      target: { value: "Deleting an item removes it from the list" },
    });
    const draftCalls = (props.onDraftChange as ReturnType<typeof vi.fn>).mock.calls;
    const lastDraft = draftCalls[draftCalls.length - 1]?.[0];
    expect(lastDraft.spec.acceptanceCriteria).toHaveLength(2);
    expect(lastDraft.spec.acceptanceCriteria[1].text).toBe(
      "Deleting an item removes it from the list",
    );
  });

  it("keeps focus and lands every character when typing into a brand-new criterion (round-2)", () => {
    // A fresh draft renders a single empty acceptance-criterion row whose id is
    // not yet allocated, so its React key falls back to the array index. The
    // first keystroke allocates "AC-001"; if that flips the row key, React
    // remounts the input and drops focus after one character.
    renderBoard({
      draft: createLiveProjectSpecDraft(42, { acceptanceCriteria: [] }),
    });

    const input = screen.getByTestId("prd-criterion-input-0") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    // Type character-by-character into the SAME node we focused. An atomic
    // fireEvent.change that re-queries each time would mask the remount; holding
    // the original reference is what surfaces the lost-focus drop.
    const text = "할 일 목록";
    let typed = "";
    for (const ch of text) {
      typed += ch;
      fireEvent.change(input, { target: { value: typed } });
    }

    const liveInput = screen.getByTestId("prd-criterion-input-0") as HTMLInputElement;
    expect(liveInput).toBe(input); // never remounted
    expect(liveInput.value).toBe(text); // every character landed
    expect(document.activeElement).toBe(input); // focus retained through typing
  });

  it("renders a factual reply on a patch-only turn instead of deleting the bubble (P1-12)", async () => {
    const onSubmitAnswer = vi.fn().mockResolvedValue({ appliedChange: true });
    renderBoard({ onSubmitAnswer });
    const rail = screen.getByTestId("prd-interview-rail");

    fireEvent.change(within(rail).getByTestId("prd-interview-input"), {
      target: { value: "It should keep items after a refresh" },
    });
    fireEvent.click(within(rail).getByTestId("prd-interview-send"));

    await waitFor(() =>
      expect(screen.getByText("I've folded that into the PRD draft.")).toBeTruthy(),
    );
  });

  it("shows a non-blocking PRD intent-check card once the PRD is confirmable", () => {
    renderBoard({
      draft: createLiveProjectSpecDraft(42, {
        goal: "Build a PRD-first planning flow for students",
        intentSummary: "Students see and confirm the PRD before any plan is made",
        scope: ["Single PRD authoring board with a live draft"],
        nonGoals: ["No automatic plan generation without confirmation"],
        acceptanceCriteria: [
          "Saved PRD opens the final read view",
          "Confirm stays disabled until every required field is filled",
        ],
        architecture: {
          stack: "React + Vite",
          rationale: null,
          decisionSource: "student_confirmed",
          decidedInVersion: 1,
        },
      }),
    });

    // The reflective card appears once the PRD is concrete...
    expect(screen.getByTestId("prd-intent-check")).toBeTruthy();
    // ...but it does not block confirmation (the field gate already does that).
    expect(screen.getByTestId("prd-confirm-header")).toHaveProperty("disabled", false);
  });

  it("hides the PRD intent-check card while the PRD is not yet confirmable", () => {
    renderBoard();
    expect(screen.queryByTestId("prd-intent-check")).toBeNull();
  });

  // S-053 D3: the intent-check card's framing follows draft.fieldProvenance,
  // not validation.valid alone — a fully hand-typed PRD must not claim "AI
  // summarized this" (P1-03).
  describe("intent-check card provenance framing (S-053 D3)", () => {
    function confirmableDraft(fieldProvenance: Record<string, "student" | "ai_patch">) {
      return createLiveProjectSpecDraft(42, {
        goal: "Build a PRD-first planning flow for students",
        intentSummary: "Students see and confirm the PRD before any plan is made",
        scope: ["Single PRD authoring board with a live draft"],
        nonGoals: ["No automatic plan generation without confirmation"],
        acceptanceCriteria: [
          "Saved PRD opens the final read view",
          "Confirm stays disabled until every required field is filled",
        ],
        architecture: {
          stack: "React + Vite",
          rationale: null,
          decisionSource: "student_confirmed",
          decidedInVersion: 1,
        },
        fieldProvenance,
      });
    }

    it("shows the legacy AI-summary framing when field_provenance is empty (pre-existing drafts)", () => {
      renderBoard({ draft: confirmableDraft({}) });

      expect(screen.getByText("Did the AI capture what you meant?")).toBeTruthy();
    });

    it("shows the same AI-summary framing when every stamped field is ai_patch", () => {
      renderBoard({
        draft: confirmableDraft({ goal: "ai_patch", intentSummary: "ai_patch" }),
      });

      expect(screen.getByText("Did the AI capture what you meant?")).toBeTruthy();
    });

    it("shows a neutral student-authored framing with no AI attribution when every field is student", () => {
      renderBoard({
        draft: confirmableDraft({
          goal: "student",
          intentSummary: "student",
          scope: "student",
          nonGoals: "student",
        }),
      });

      expect(screen.getByText("You wrote this PRD yourself")).toBeTruthy();
      expect(screen.queryByText("Did the AI capture what you meant?")).toBeNull();
    });

    it("names the student-written fields in the mixed framing", () => {
      renderBoard({
        draft: confirmableDraft({ goal: "student", scope: "ai_patch" }),
      });

      expect(screen.getByText("You and the AI shaped this PRD together")).toBeTruthy();
      expect(
        screen.getByText(
          "The AI summarized part of this PRD, and you wrote the rest yourself: Goal. Check that every part matches your real intent.",
        ),
      ).toBeTruthy();
    });
  });

  it("confirms instead of calling the LLM when a ready PRD receives a completion intent", () => {
    const onSubmitAnswer = vi.fn();
    const onSavePrdAndCreatePlan = vi.fn();
    renderBoard({
      draft: createLiveProjectSpecDraft(42, {
        goal: "Build a personal schedule app for commuters",
        intentSummary: "Commuters add tasks and see today's schedule at a glance",
        scope: ["Single-page schedule with add and list"],
        nonGoals: ["No calendar sync or accounts"],
        acceptanceCriteria: [
          "Schedules and tasks appear in separate lists",
          "Adding a task shows it in today's list",
        ],
        architecture: {
          stack: "React + Vite",
          rationale: null,
          decisionSource: "student_confirmed",
          decidedInVersion: 1,
        },
      }),
      onSubmitAnswer,
      onSavePrdAndCreatePlan,
    });
    const rail = screen.getByTestId("prd-interview-rail");

    fireEvent.change(within(rail).getByTestId("prd-interview-input"), {
      target: { value: "아냐 이 정도면 돼" },
    });
    fireEvent.click(within(rail).getByTestId("prd-interview-send"));

    expect(onSubmitAnswer).not.toHaveBeenCalled();
    expect(onSavePrdAndCreatePlan).toHaveBeenCalledTimes(1);
  });

  it("keeps completion intent detection narrow enough for done-state content", () => {
    expect(isPrdCompletionIntent("아냐 이 정도면 돼")).toBe(true);
    expect(isPrdCompletionIntent("save it")).toBe(true);
    expect(isPrdCompletionIntent("Users can mark a task done")).toBe(false);
    expect(isPrdCompletionIntent("일정 저장 기능이 필요해")).toBe(false);
  });

  it("does not submit the same interview answer twice while the first turn is pending", async () => {
    let resolveTurn: (value: { assistantMessage: string }) => void = () => {};
    const onSubmitAnswer = vi.fn(
      () =>
        new Promise<{ assistantMessage: string }>((resolve) => {
          resolveTurn = resolve;
        }),
    );
    renderBoard({ onSubmitAnswer });
    const rail = screen.getByTestId("prd-interview-rail");

    fireEvent.change(within(rail).getByTestId("prd-interview-input"), {
      target: { value: "Teachers need to see missing submissions quickly." },
    });
    const send = within(rail).getByTestId("prd-interview-send");
    fireEvent.click(send);
    fireEvent.click(send);

    expect(onSubmitAnswer).toHaveBeenCalledTimes(1);

    resolveTurn({ assistantMessage: "반영했어요. 다음으로 첫 화면에서 보여야 할 상태를 볼게요." });
    expect(
      await screen.findByText("반영했어요. 다음으로 첫 화면에서 보여야 할 상태를 볼게요."),
    ).toBeTruthy();
  });

  it("shows the assistant interview response as part of the PRD conversation", async () => {
    renderBoard({
      onSubmitAnswer: vi.fn().mockResolvedValue({
        assistantMessage:
          "I captured the goal and added a done state to the PRD draft. Who will use it first?",
      }),
    });
    const rail = screen.getByTestId("prd-interview-rail");

    fireEvent.change(within(rail).getByTestId("prd-interview-input"), {
      target: { value: "Teachers need a quick handoff checklist." },
    });
    fireEvent.click(within(rail).getByTestId("prd-interview-send"));

    expect(await screen.findByText("Teachers need a quick handoff checklist.")).toBeTruthy();
    expect(
      await screen.findByText(
        "I captured the goal and added a done state to the PRD draft. Who will use it first?",
      ),
    ).toBeTruthy();
  });

  it("does not fabricate a generic assistant response when the turn returns no message", async () => {
    renderBoard({
      onSubmitAnswer: vi.fn().mockResolvedValue(undefined),
    });
    const rail = screen.getByTestId("prd-interview-rail");

    fireEvent.change(within(rail).getByTestId("prd-interview-input"), {
      target: { value: "Teachers need a quick handoff checklist." },
    });
    fireEvent.click(within(rail).getByTestId("prd-interview-send"));

    expect(await screen.findByText("Teachers need a quick handoff checklist.")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText(/I reflected that in the PRD draft/)).toBeNull();
      expect(screen.queryByText(/Got it\. I am folding that into the PRD draft/)).toBeNull();
    });
  });

  it("restores the in-progress interview conversation when the board remounts", async () => {
    const draft = createLiveProjectSpecDraft(42, { draftId: "draft-restored" });
    renderBoard({
      draft,
      onSubmitAnswer: vi.fn().mockResolvedValue({
        assistantMessage: "좋아요. 먼저 누가 이걸 쓰는지 조금 더 좁혀볼게요.",
      }),
    });
    const rail = screen.getByTestId("prd-interview-rail");

    fireEvent.change(within(rail).getByTestId("prd-interview-input"), {
      target: { value: "사용자 제출물을 빨리 확인하고 싶어요." },
    });
    fireEvent.click(within(rail).getByTestId("prd-interview-send"));

    expect(await screen.findByText("사용자 제출물을 빨리 확인하고 싶어요.")).toBeTruthy();
    expect(
      await screen.findByText("좋아요. 먼저 누가 이걸 쓰는지 조금 더 좁혀볼게요."),
    ).toBeTruthy();

    cleanup();
    renderBoard({ draft });

    expect(screen.getByText("사용자 제출물을 빨리 확인하고 싶어요.")).toBeTruthy();
    expect(screen.getByText("좋아요. 먼저 누가 이걸 쓰는지 조금 더 좁혀볼게요.")).toBeTruthy();
  });

  it("keeps interview conversation isolated across projects even when draft ids match", async () => {
    const sharedDraftId = "shared-draft";
    renderBoard({
      draft: createLiveProjectSpecDraft(42, { draftId: sharedDraftId }),
      onSubmitAnswer: vi.fn().mockResolvedValue({
        assistantMessage: "I stored the first project's PRD context.",
      }),
    });
    const rail = screen.getByTestId("prd-interview-rail");

    fireEvent.change(within(rail).getByTestId("prd-interview-input"), {
      target: { value: "First project conversation" },
    });
    fireEvent.click(within(rail).getByTestId("prd-interview-send"));

    expect(await screen.findByText("First project conversation")).toBeTruthy();
    expect(await screen.findByText("I stored the first project's PRD context.")).toBeTruthy();

    cleanup();
    renderBoard({
      draft: createLiveProjectSpecDraft(84, { draftId: sharedDraftId }),
    });

    expect(screen.queryByText("First project conversation")).toBeNull();
    expect(screen.queryByText("I stored the first project's PRD context.")).toBeNull();
  });

  it("frames PRD fields as conversation-filled rather than user-authored form prompts", () => {
    renderBoard();

    expect(screen.getByTestId("prd-goal-input")).toHaveProperty(
      "placeholder",
      "The goal will appear here as the conversation clarifies.",
    );
    expect(screen.getByTestId("prd-intent-input")).toHaveProperty(
      "placeholder",
      "The user's intent will be summarized here as it emerges.",
    );
    expect(screen.getByTestId("prd-scope-input")).toHaveProperty(
      "placeholder",
      "In-scope work gathered from the conversation will appear here.",
    );
  });
});
