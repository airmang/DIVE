import { describe, expect, it } from "vitest";
import { remainingInterviewDimensions } from "./remainingInterviewDimensions";
import type { InterviewAnswer } from "./types";

describe("remainingInterviewDimensions", () => {
  it("returns all six dimensions when answers are empty", () => {
    expect(remainingInterviewDimensions([])).toBe(6);
    expect(remainingInterviewDimensions([{ question: "Who is this for?", answer: "   " }])).toBe(6);
  });

  it("decrements as interview dimensions fill", () => {
    const answers: InterviewAnswer[] = [];

    answers.push({ question: "Who is this for?", answer: "Bakery owners" });
    expect(remainingInterviewDimensions(answers)).toBe(5);

    answers.push({ question: "What observable result means done?", answer: "The menu is ready." });
    expect(remainingInterviewDimensions(answers)).toBe(4);

    answers.push({
      question: "What is in scope for the first version?",
      answer: "Build the menu page.",
    });
    expect(remainingInterviewDimensions(answers)).toBe(3);

    answers.push({ question: "What is out of scope?", answer: "Do not add online payment." });
    expect(remainingInterviewDimensions(answers)).toBe(2);

    answers.push({
      question: "What are two acceptance criteria?",
      answer: "1. Mobile layout shows every menu item\n2. Saving a menu item shows a success toast",
    });
    expect(remainingInterviewDimensions(answers)).toBe(0);
  });
});
