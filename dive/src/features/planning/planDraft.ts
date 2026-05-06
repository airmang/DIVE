import type { InterviewQuestion, PlanDraft, ProjectBrief, ProjectBriefAnswer } from "./types";

export const PLAN_INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    id: "product_shape",
    question: "What are you trying to build first?",
    choices: ["Web app", "Desktop app", "Script or tool", "Not sure"],
  },
  {
    id: "mvp_focus",
    question: "What should the first version prove?",
    choices: ["User can add and see data", "Data is saved", "It looks polished", "Not sure"],
  },
  {
    id: "risk_level",
    question: "How cautious should the agent be?",
    choices: ["Tiny safe steps", "Balanced MVP", "Explore options first", "Not sure"],
  },
];

function cleanGoal(goal: string) {
  return goal.trim().replace(/\s+/g, " ");
}

export function createProjectBrief(goal: string, answers: Record<string, string>): ProjectBrief {
  const normalizedGoal = cleanGoal(goal);
  const briefAnswers: ProjectBriefAnswer[] = PLAN_INTERVIEW_QUESTIONS.map((question) => ({
    questionId: question.id,
    question: question.question,
    answer: answers[question.id] ?? "Not sure",
  }));

  return {
    goal: normalizedGoal,
    answers: briefAnswers,
    createdAt: Date.now(),
  };
}

function answerFor(brief: ProjectBrief, questionId: string) {
  return brief.answers.find((answer) => answer.questionId === questionId)?.answer ?? "Not sure";
}

function mvpFor(brief: ProjectBrief) {
  const shape = answerFor(brief, "product_shape");
  const focus = answerFor(brief, "mvp_focus");
  if (shape === "Script or tool") {
    return `A small working tool for: ${brief.goal}. It should prove that ${focus.toLowerCase()}.`;
  }
  if (shape === "Desktop app") {
    return `A minimal desktop experience for: ${brief.goal}. It should prove that ${focus.toLowerCase()}.`;
  }
  if (shape === "Web app") {
    return `A minimal app screen for: ${brief.goal}. It should prove that ${focus.toLowerCase()}.`;
  }
  return `A minimal, safe first version of: ${brief.goal}. It should prove the core behavior before polish.`;
}

function safetyInstruction(brief: ProjectBrief) {
  const risk = answerFor(brief, "risk_level");
  if (risk === "Tiny safe steps") return "Keep this step very small and ask before risky changes.";
  if (risk === "Explore options first")
    return "Compare the simplest options before changing files.";
  if (risk === "Balanced MVP") return "Prefer the smallest useful MVP change and verify it.";
  return "Make the smallest reversible change that moves the goal forward.";
}

export function buildPlanDraft(brief: ProjectBrief): PlanDraft {
  const safety = safetyInstruction(brief);
  const mvp = mvpFor(brief);

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
