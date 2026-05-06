import type { InterviewQuestion, PlanDraft, ProjectBrief, ProjectBriefAnswer } from "./types";
import type { Locale } from "../../i18n";

export const PLAN_INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    id: "product_shape",
    question: "planning.questions.product_shape",
    choices: ["web_app", "desktop_app", "script_or_tool", "not_sure"],
  },
  {
    id: "mvp_focus",
    question: "planning.questions.mvp_focus",
    choices: ["user_can_add_and_see_data", "data_is_saved", "looks_polished", "not_sure"],
  },
  {
    id: "risk_level",
    question: "planning.questions.risk_level",
    choices: ["tiny_safe_steps", "balanced_mvp", "explore_options_first", "not_sure"],
  },
];

const COPY = {
  en: {
    questions: {
      product_shape: "What are you trying to build first?",
      mvp_focus: "What should the first version prove?",
      risk_level: "How cautious should the agent be?",
    },
    choices: {
      web_app: "Web app",
      desktop_app: "Desktop app",
      script_or_tool: "Script or tool",
      user_can_add_and_see_data: "User can add and see data",
      data_is_saved: "Data is saved",
      looks_polished: "It looks polished",
      tiny_safe_steps: "Tiny safe steps",
      balanced_mvp: "Balanced MVP",
      explore_options_first: "Explore options first",
      not_sure: "Not sure",
    },
  },
  ko: {
    questions: {
      product_shape: "먼저 무엇을 만들고 싶나요?",
      mvp_focus: "첫 버전에서 무엇을 확인하면 좋을까요?",
      risk_level: "에이전트가 얼마나 조심스럽게 움직이면 좋을까요?",
    },
    choices: {
      web_app: "웹 앱",
      desktop_app: "데스크톱 앱",
      script_or_tool: "스크립트 또는 도구",
      user_can_add_and_see_data: "사용자가 데이터를 추가하고 볼 수 있음",
      data_is_saved: "데이터가 저장됨",
      looks_polished: "보기 좋게 다듬어짐",
      tiny_safe_steps: "아주 작은 안전 단계",
      balanced_mvp: "균형 잡힌 MVP",
      explore_options_first: "선택지 먼저 비교",
      not_sure: "잘 모르겠음",
    },
  },
} as const;

function cleanGoal(goal: string) {
  return goal.trim().replace(/\s+/g, " ");
}

function questionCopy(locale: Locale, questionId: string): string {
  return COPY[locale].questions[questionId as keyof (typeof COPY)[Locale]["questions"]];
}

function choiceCopy(locale: Locale, choiceId: string): string {
  return COPY[locale].choices[choiceId as keyof (typeof COPY)[Locale]["choices"]];
}

export function createProjectBrief(
  goal: string,
  answers: Record<string, string>,
  locale: Locale = "en",
): ProjectBrief {
  const normalizedGoal = cleanGoal(goal);
  const briefAnswers: ProjectBriefAnswer[] = PLAN_INTERVIEW_QUESTIONS.map((question) => ({
    questionId: question.id,
    question: questionCopy(locale, question.id),
    answer: choiceCopy(locale, answers[question.id] ?? "not_sure"),
    answerId: answers[question.id] ?? "not_sure",
  }));

  return {
    goal: normalizedGoal,
    answers: briefAnswers,
    createdAt: Date.now(),
  };
}

function answerFor(brief: ProjectBrief, questionId: string) {
  return brief.answers.find((answer) => answer.questionId === questionId)?.answerId ?? "not_sure";
}

function focusPhrase(locale: Locale, focus: string) {
  if (locale === "ko") {
    if (focus === "user_can_add_and_see_data") return "사용자가 데이터를 추가하고 볼 수 있음";
    if (focus === "data_is_saved") return "데이터가 저장됨";
    if (focus === "looks_polished") return "보기 좋게 다듬어짐";
    return "핵심 동작이 먼저 확인됨";
  }
  if (focus === "user_can_add_and_see_data") return "user can add and see data";
  if (focus === "data_is_saved") return "data is saved";
  if (focus === "looks_polished") return "it looks polished";
  return "the core behavior works first";
}

function mvpFor(brief: ProjectBrief, locale: Locale) {
  const shape = answerFor(brief, "product_shape");
  const focus = focusPhrase(locale, answerFor(brief, "mvp_focus"));
  if (locale === "ko") {
    if (shape === "script_or_tool") {
      return `${brief.goal}을 위한 작게 동작하는 도구입니다. 첫 버전에서는 ${focus}을 확인합니다.`;
    }
    if (shape === "desktop_app") {
      return `${brief.goal}을 위한 최소 데스크톱 경험입니다. 첫 버전에서는 ${focus}을 확인합니다.`;
    }
    if (shape === "web_app") {
      return `${brief.goal}을 위한 최소 앱 화면입니다. 첫 버전에서는 ${focus}을 확인합니다.`;
    }
    return `${brief.goal}의 핵심 동작을 안전하게 확인하는 최소 첫 버전입니다.`;
  }
  if (shape === "script_or_tool")
    return `A small working tool for: ${brief.goal}. It should prove that ${focus}.`;
  if (shape === "desktop_app")
    return `A minimal desktop experience for: ${brief.goal}. It should prove that ${focus}.`;
  if (shape === "web_app")
    return `A minimal app screen for: ${brief.goal}. It should prove that ${focus}.`;
  return `A minimal, safe first version of: ${brief.goal}. It should prove the core behavior before polish.`;
}

function safetyInstruction(brief: ProjectBrief, locale: Locale) {
  const risk = answerFor(brief, "risk_level");
  if (locale === "ko") {
    if (risk === "tiny_safe_steps")
      return "이 단계를 아주 작게 유지하고 위험한 변경 전에는 먼저 물어보세요.";
    if (risk === "explore_options_first") return "파일을 바꾸기 전에 가장 단순한 선택지를 비교하세요.";
    if (risk === "balanced_mvp") return "가장 작은 유용한 MVP 변경을 우선하고 검증하세요.";
    return "목표에 가까워지는 가장 작고 되돌릴 수 있는 변경을 하세요.";
  }
  if (risk === "tiny_safe_steps") return "Keep this step very small and ask before risky changes.";
  if (risk === "explore_options_first") return "Compare the simplest options before changing files.";
  if (risk === "balanced_mvp") return "Prefer the smallest useful MVP change and verify it.";
  return "Make the smallest reversible change that moves the goal forward.";
}

export function buildPlanDraft(brief: ProjectBrief, locale: Locale = "en"): PlanDraft {
  const safety = safetyInstruction(brief, locale);
  const mvp = mvpFor(brief, locale);

  if (locale === "ko") {
    return {
      goal: brief.goal,
      mvp,
      nonGoals: [
        "관련 없는 화면을 다시 설계하지 않습니다.",
        "사용자 승인 없이 새 의존성을 추가하지 않습니다.",
        "단계가 명시적으로 요구하지 않으면 백엔드나 파일시스템 동작을 바꾸지 않습니다.",
      ],
      steps: [
        {
          title: "가장 작은 유용한 버전 확인",
          summary: `목표를 작은 MVP로 정리합니다: ${mvp}`,
          acceptanceCriteria: [
            "대상 사용자와 첫 번째 유용한 결과가 명확합니다.",
            "구현 전에 열린 질문이 정리됩니다.",
          ],
          instructionSeed: `${safety} 다음 목표의 가장 작은 유용한 버전을 명확히 하세요: ${brief.goal}`,
        },
        {
          title: "첫 번째 보이는 경로 구현",
          summary: "MVP에 필요한 UI 또는 코드 경로만 구현합니다.",
          acceptanceCriteria: [
            "주요 성공 경로가 처음부터 끝까지 동작합니다.",
            "관련 없는 파일이나 기능은 변경하지 않습니다.",
          ],
          instructionSeed: `${safety} 다음 목표의 첫 번째 보이는 경로를 구현하세요: ${brief.goal}`,
        },
        {
          title: "결과 검증 및 설명",
          summary: "가장 작은 유용한 검증을 실행하고 변경 내용을 설명합니다.",
          acceptanceCriteria: [
            "관련 검증이 통과하거나 실패 이유가 명확히 설명됩니다.",
            "사용자가 무엇이 바뀌었고 무엇이 남았는지 볼 수 있습니다.",
          ],
          instructionSeed: `${safety} MVP를 검증하고 결과를 요약하세요: ${brief.goal}`,
        },
      ],
      successCriteria: [
        "초심자가 결과를 한 문장으로 설명할 수 있습니다.",
        "MVP를 구체적인 명령이나 수동 smoke test로 확인할 수 있습니다.",
        "첫 버전이 동작한 뒤 다음 단계가 명확합니다.",
      ],
      brief,
    };
  }

  return {
    goal: brief.goal,
    mvp,
    nonGoals: [
      "Do not redesign unrelated screens.",
      "Do not add new dependencies unless the user approves.",
      "Do not change backend or filesystem behavior unless the step explicitly requires it.",
    ],
    steps: [
      {
        title: "Confirm the smallest useful version",
        summary: `Turn the goal into a tiny MVP: ${mvp}`,
        acceptanceCriteria: [
          "The target user and first useful outcome are clear.",
          "Open questions are listed before implementation.",
        ],
        instructionSeed: `${safety} Clarify the smallest useful version of: ${brief.goal}`,
      },
      {
        title: "Implement the first visible path",
        summary: "Build only the UI or code path needed for the MVP.",
        acceptanceCriteria: [
          "The main happy path works end-to-end.",
          "No unrelated files or features are changed.",
        ],
        instructionSeed: `${safety} Implement the first visible path for: ${brief.goal}`,
      },
      {
        title: "Check and explain the result",
        summary: "Run the smallest useful checks and explain what changed.",
        acceptanceCriteria: [
          "Relevant checks pass or failures are clearly explained.",
          "The user can see what changed and what remains.",
        ],
        instructionSeed: `${safety} Verify the MVP and summarize the result for: ${brief.goal}`,
      },
    ],
    successCriteria: [
      "A beginner can describe the outcome in one sentence.",
      "The MVP can be checked with a concrete command or manual smoke test.",
      "The next step is obvious after the first version works.",
    ],
    brief,
  };
}
