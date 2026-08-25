// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import type { InterviewAnswer } from "../../features/planning";
import { SocraticInterviewPanel } from "./SocraticInterviewPanel";

function renderPanel(overrides: Partial<Parameters<typeof SocraticInterviewPanel>[0]> = {}) {
  const props: Parameters<typeof SocraticInterviewPanel>[0] = {
    started: true,
    answers: [],
    unresolvedQuestionCount: 0,
    loading: false,
    disabled: false,
    onSubmitGoal: vi.fn(),
    onSubmitAnswer: vi.fn(),
    onComplete: vi.fn(),
    ...overrides,
  };
  render(<SocraticInterviewPanel {...props} />);
  return props;
}

describe("SocraticInterviewPanel", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
  });

  afterEach(() => cleanup());

  it("shows the remaining quick-question count from interview answers", () => {
    const partialAnswers: InterviewAnswer[] = [
      { question: "Who is this for?", answer: "Students using the app" },
      { question: "What is in scope?", answer: "Build the first version dashboard" },
    ];
    const completeAnswers: InterviewAnswer[] = [
      ...partialAnswers,
      { question: "What means done?", answer: "It is complete when a saved item is visible." },
      { question: "What is out of scope?", answer: "Exclude team sharing for now." },
      {
        question: "Acceptance criteria",
        answer: "- Must show saved items\n- Must show an error state",
      },
    ];

    const { rerender } = render(
      <SocraticInterviewPanel
        started
        answers={partialAnswers}
        onSubmitGoal={vi.fn()}
        onSubmitAnswer={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByTestId("interview-remaining-questions").dataset.count).toBe("4");
    expect(screen.getByText("4 more quick questions")).toBeTruthy();

    rerender(
      <SocraticInterviewPanel
        started
        answers={completeAnswers}
        onSubmitGoal={vi.fn()}
        onSubmitAnswer={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByTestId("interview-remaining-questions").dataset.count).toBe("0");
    expect(screen.getByText("Almost done")).toBeTruthy();
  });

  it("keeps vague-answer hints advisory and leaves submit enabled", () => {
    const props = renderPanel();
    const input = screen.getByTestId("interview-input");
    const send = screen.getByTestId("interview-send") as HTMLButtonElement;

    fireEvent.change(input, {
      target: { value: "whatever you think is best for the layout, up to you" },
    });

    expect(screen.getByTestId("interview-vague-hint")).toBeTruthy();
    expect(send.disabled).toBe(false);

    fireEvent.click(send);

    expect(props.onSubmitAnswer).toHaveBeenCalledWith(
      "whatever you think is best for the layout, up to you",
    );
  });

  // S-073 (D-014-07): the panel is a chat composer — Enter sends, Shift+Enter
  // is a newline, IME composition never sends, Cmd/Ctrl+Enter still works.
  describe("Enter-to-send (S-073)", () => {
    it("submits the trimmed answer on a plain Enter and shows the hint line", () => {
      const props = renderPanel();
      const input = screen.getByTestId("interview-input");

      expect(screen.getByTestId("interview-enter-hint").textContent).toContain("Enter to send");

      fireEvent.change(input, { target: { value: "  Students using the app  " } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(props.onSubmitAnswer).toHaveBeenCalledWith("Students using the app");
      expect(props.onSubmitGoal).not.toHaveBeenCalled();
      expect(input).toHaveProperty("value", "");
    });

    it("submits the goal on Enter before the interview has started", () => {
      const props = renderPanel({ started: false });
      const input = screen.getByTestId("interview-input");

      fireEvent.change(input, { target: { value: "Build a bakery menu page" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(props.onSubmitGoal).toHaveBeenCalledWith("Build a bakery menu page");
      expect(props.onSubmitAnswer).not.toHaveBeenCalled();
    });

    it("does not submit on Shift+Enter or during an IME composition", () => {
      const props = renderPanel();
      const input = screen.getByTestId("interview-input");

      fireEvent.change(input, { target: { value: "학생들이 씁니다" } });
      // Shift+Enter keeps its default (the newline): dispatchEvent returns true
      // only when nothing called preventDefault.
      expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true);
      fireEvent.keyDown(input, { key: "Enter", isComposing: true });
      // Legacy IME placeholder: the key IS "Enter"; only keyCode says composing.
      fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });

      expect(props.onSubmitAnswer).not.toHaveBeenCalled();
      expect(input).toHaveProperty("value", "학생들이 씁니다");

      // And the plain Enter that does send swallows its default.
      expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
      expect(props.onSubmitAnswer).toHaveBeenCalledWith("학생들이 씁니다");
    });

    it("keeps Cmd/Ctrl+Enter as a send gesture", () => {
      const props = renderPanel();
      const input = screen.getByTestId("interview-input");

      fireEvent.change(input, { target: { value: "Teachers review submissions" } });
      fireEvent.keyDown(input, { key: "Enter", metaKey: true });
      expect(props.onSubmitAnswer).toHaveBeenCalledTimes(1);

      fireEvent.change(input, { target: { value: "Parents get a weekly digest" } });
      fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
      expect(props.onSubmitAnswer).toHaveBeenCalledTimes(2);
      expect(props.onSubmitAnswer).toHaveBeenLastCalledWith("Parents get a weekly digest");
    });

    it("ignores Enter while loading or disabled", () => {
      // Type first (while enabled), then flip the flags: an empty textarea
      // would be ignored for the wrong reason.
      const onSubmitAnswer = vi.fn();
      const base = {
        started: true,
        onSubmitGoal: vi.fn(),
        onSubmitAnswer,
        onComplete: vi.fn(),
      };
      const { rerender } = render(<SocraticInterviewPanel {...base} />);
      const input = screen.getByTestId("interview-input");
      fireEvent.change(input, { target: { value: "Students using the app" } });

      rerender(<SocraticInterviewPanel {...base} loading />);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onSubmitAnswer).not.toHaveBeenCalled();

      rerender(<SocraticInterviewPanel {...base} disabled />);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onSubmitAnswer).not.toHaveBeenCalled();
      expect(input).toHaveProperty("value", "Students using the app");

      // Sanity: with neither flag the very same Enter sends.
      rerender(<SocraticInterviewPanel {...base} />);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onSubmitAnswer).toHaveBeenCalledWith("Students using the app");
    });
  });
});
