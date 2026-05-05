import type { DiveStage } from "./ambiguity";

export interface PromptTemplate {
  id: string;
  title: string;
  body: string;
  stages: DiveStage[];
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "d-decompose",
    title: "목표를 단계로 나누기",
    body: "[기능]을 만들고 싶어. 초심자가 따라갈 수 있는 로드맵 단계 3~5개로 나눠줘.",
    stages: ["D"],
  },
  {
    id: "d-overview",
    title: "큰 그림 먼저",
    body: "이 프로젝트의 큰 그림을 먼저 잡아줘. 핵심 화면과 데이터 흐름을 요약해줘.",
    stages: ["D"],
  },
  {
    id: "i-focus-card",
    title: "현재 단계만 작업",
    body: "[현재 단계]만 작업해줘. 다른 부분은 건드리지 마.",
    stages: ["I"],
  },
  {
    id: "i-io-first",
    title: "입·출력 예시 먼저",
    body: "이 부분의 입력과 출력 예시를 먼저 알려줘. 그다음에 구현을 시작하자.",
    stages: ["I"],
  },
  {
    id: "v-verify-how",
    title: "검증 방법 물어보기",
    body: "이 단계의 동작을 어떻게 검증할 수 있어? 테스트 케이스 3개로 알려줘.",
    stages: ["V"],
  },
  {
    id: "v-edge-cases",
    title: "엣지 케이스 확인",
    body: "예외 상황(빈 입력, 잘못된 타입, 네트워크 오류)에 대한 처리가 있는지 확인해줘.",
    stages: ["V"],
  },
  {
    id: "e-integration-review",
    title: "통합 시 문제점 점검",
    body: "전체 코드를 검토하고 통합 시 문제될 부분을 알려줘.",
    stages: ["E"],
  },
  {
    id: "e-refactor-chances",
    title: "리팩토링 기회",
    body: "이 코드에서 중복·가독성·성능 개선 여지를 찾아줘.",
    stages: ["E"],
  },
];

export function templatesForStage(stage: DiveStage): PromptTemplate[] {
  return PROMPT_TEMPLATES.filter((t) => t.stages.includes(stage));
}
