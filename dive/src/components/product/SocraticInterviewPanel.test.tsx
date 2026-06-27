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
});
