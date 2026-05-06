export interface ProjectBriefAnswer {
  questionId: string;
  question: string;
  answer: string;
}

export interface ProjectBrief {
  goal: string;
  answers: ProjectBriefAnswer[];
  createdAt: number;
}

export interface PlanDraftStep {
  title: string;
  summary: string;
  acceptanceCriteria: string[];
  instructionSeed: string;
}

export interface PlanDraft {
  goal: string;
  mvp: string;
  nonGoals: string[];
  steps: PlanDraftStep[];
  successCriteria: string[];
  brief: ProjectBrief;
}

export interface InterviewQuestion {
  id: string;
  question: string;
  choices: string[];
}
