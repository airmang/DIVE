import { describe, expect, it } from "vitest";
import { filterInterviewNoise, INTERVIEW_SUBMIT_MARKER } from "./filterInterviewNoise";
import type { ChatMessage } from "./types";

const createdAt = 1_717_977_600_000;

function user(id: string, content: string): ChatMessage {
  return { id, kind: "user", createdAt, content };
}

function assistant(id: string, content: string, streaming = false): ChatMessage {
  return { id, kind: "assistant", createdAt, content, streaming };
}

function reasoning(id: string): ChatMessage {
  return {
    id,
    kind: "reasoning",
    createdAt,
    text: "모델이 계획 초안을 구성하는 중",
    toolCallId: "interview-submit",
  };
}

function system(id: string, content: string): ChatMessage {
  return { id, kind: "system", createdAt, content };
}

function visibleIds(messages: ChatMessage[]): string[] {
  return filterInterviewNoise(messages).map((message) => message.id);
}

function planDraftJson(): string {
  return JSON.stringify({
    intent_summary: "사용자는 면접 답변을 바탕으로 학습 계획 생성을 원한다.",
    plan_input: {
      steps: [{ title: "문제 정의", goal: "핵심 목표를 정리한다." }],
    },
  });
}

describe("filterInterviewNoise", () => {
  it("hides the interview submit marker and assistant plan JSON on the button path", () => {
    const messages = [
      user("submit", `${INTERVIEW_SUBMIT_MARKER} 인터뷰 답변으로 계획을 생성해 주세요.`),
      assistant("plan-json", planDraftJson()),
      assistant("visible", "계획 카드가 생성되었습니다."),
    ];

    expect(visibleIds(messages)).toEqual(["visible"]);
  });

  it("hides structurally detected plan draft JSON after conversational acceptance", () => {
    const accepted = user("accept", "네, 이대로 계획을 만들어 주세요.");
    const visible = assistant("visible", "좋습니다. 다음 단계로 넘어가겠습니다.");

    expect(visibleIds([accepted, assistant("plan-json", planDraftJson()), visible])).toEqual([
      "accept",
      "visible",
    ]);

    expect(
      visibleIds([
        accepted,
        assistant("fenced-plan-json", `\`\`\`json\n${planDraftJson()}\n\`\`\``),
        visible,
      ]),
    ).toEqual(["accept", "visible"]);
  });

  it("hides streaming plan draft JSON using the plan_input prefix heuristic", () => {
    const messages = [
      assistant("streaming-plan-json", '{"intent_summary":"학습 계획 생성","plan_input"', true),
      assistant("visible", "완료되었습니다."),
    ];

    expect(visibleIds(messages)).toEqual(["visible"]);
  });

  it("keeps normal JSON and Socratic Q&A while hiding reasoning after a submit marker", () => {
    const messages = [
      user("question", "가장 중요한 제약은 무엇인가요?"),
      assistant("answer", "시간과 예산 제약을 먼저 확인해 보겠습니다."),
      assistant(
        "plain-json",
        JSON.stringify({ intent_summary: "요약", plan_input: { title: "steps 없음" } }),
      ),
      user("submit", `${INTERVIEW_SUBMIT_MARKER} 최종 계획을 만들어 주세요.`),
      reasoning("submit-reasoning"),
      system("system", "세션이 동기화되었습니다."),
    ];

    expect(visibleIds(messages)).toEqual(["question", "answer", "plain-json", "system"]);
  });
});
