import type { InterviewQuestion, PlanDraft, ProjectBrief, ProjectBriefAnswer } from "./types";
import type { Locale } from "../../i18n";
import { translate } from "../../i18n";

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

const NON_GOAL_IDS = ["unrelated_screens", "new_dependencies", "backend_or_fs"] as const;
const SUCCESS_IDS = ["beginner_describes", "mvp_check_command", "next_step_obvious"] as const;
const STEP_ACCEPTANCE_IDS = {
  1: ["target_user_clear", "open_questions_listed"],
  2: ["happy_path_works", "unrelated_untouched"],
  3: ["checks_pass_or_explained", "user_sees_diff"],
} as const;

function cleanGoal(goal: string) {
  return goal.trim().replace(/\s+/g, " ");
}

function questionCopy(locale: Locale, questionId: string): string {
  return translate(locale, `planning.questions.${questionId}`);
}

function choiceCopy(locale: Locale, choiceId: string): string {
  return translate(locale, `planning.choices.${choiceId}`);
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
  return translate(locale, `planning.draft.focus.${focus}`);
}

function mvpFor(brief: ProjectBrief, locale: Locale) {
  const shape = answerFor(brief, "product_shape");
  const focus = focusPhrase(locale, answerFor(brief, "mvp_focus"));
  return translate(locale, `planning.draft.mvp.${shape}`, { goal: brief.goal, focus });
}

function safetyInstruction(brief: ProjectBrief, locale: Locale) {
  const risk = answerFor(brief, "risk_level");
  return translate(locale, `planning.draft.safety.${risk}`);
}

export function buildPlanDraft(brief: ProjectBrief, locale: Locale = "en"): PlanDraft {
  const safety = safetyInstruction(brief, locale);
  const mvp = mvpFor(brief, locale);

  const buildStep = (index: 1 | 2 | 3) => {
    const base = `planning.draft.steps.${index}`;
    return {
      title: translate(locale, `${base}.title`),
      summary: translate(locale, `${base}.summary`, { mvp }),
      acceptanceCriteria: STEP_ACCEPTANCE_IDS[index].map((id) =>
        translate(locale, `${base}.acceptance.${id}`),
      ),
      instructionSeed: translate(locale, `${base}.instruction_seed`, {
        safety,
        goal: brief.goal,
      }),
    };
  };

  return {
    goal: brief.goal,
    mvp,
    nonGoals: NON_GOAL_IDS.map((id) => translate(locale, `planning.draft.non_goals.${id}`)),
    steps: [buildStep(1), buildStep(2), buildStep(3)],
    successCriteria: SUCCESS_IDS.map((id) =>
      translate(locale, `planning.draft.success_criteria.${id}`),
    ),
    brief,
  };
}
