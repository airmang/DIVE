// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { createLiveProjectSpecDraft } from "../../features/planning";
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
    await waitFor(() => expect(screen.getByTestId("chat-runtime-selector")).toBeTruthy());
  });

  it("requires a goal and at least one acceptance criterion before confirming the PRD", () => {
    const props = renderBoard();

    const primary = screen.getByTestId("prd-save-create-plan");
    const headerConfirm = screen.getByTestId("prd-confirm-header");
    expect(primary).toHaveProperty("disabled", true);
    expect(headerConfirm).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByTestId("prd-goal-input"), {
      target: { value: "Build a PRD-first planning flow" },
    });
    fireEvent.change(screen.getByTestId("prd-criterion-input-0"), {
      target: { value: "Saved PRD opens the final read view" },
    });

    expect(primary).toHaveProperty("disabled", false);
    expect(headerConfirm).toHaveProperty("disabled", false);

    fireEvent.click(headerConfirm);
    expect(props.onSavePrdAndCreatePlan).toHaveBeenCalledTimes(1);
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

  it("confirms instead of calling the LLM when a ready PRD receives a completion intent", () => {
    const onSubmitAnswer = vi.fn();
    const onSavePrdAndCreatePlan = vi.fn();
    renderBoard({
      draft: createLiveProjectSpecDraft(42, {
        goal: "Build a personal schedule app",
        acceptanceCriteria: ["Schedules and tasks appear in separate lists"],
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
