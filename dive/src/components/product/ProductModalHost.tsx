import { AiAssistDialog } from "../workmap/AiAssistDialog";
import { CardDetailPanel } from "../workmap/CardDetailPanel";
import { NewCardDialog } from "../workmap/NewCardDialog";
import { RetroDialog } from "../workmap/RetroDialog";
import { NewProjectDialog } from "../onboarding/NewProjectDialog";
import { OnboardingDialog } from "../onboarding/OnboardingDialog";
import { PlanInterviewPanel } from "./PlanInterviewPanel";
import { PlanReviewPanel } from "./PlanReviewPanel";
import type { ProductShellController } from "./useProductShellController";

interface ProductModalHostProps {
  modals: ProductShellController["modals"];
}

export function ProductModalHost({ modals }: ProductModalHostProps) {
  return (
    <>
      <PlanInterviewPanel {...modals.planInterview} />
      <PlanReviewPanel {...modals.planReview} />
      <NewCardDialog {...modals.newCard} />
      <AiAssistDialog {...modals.aiAssist} />
      <CardDetailPanel {...modals.cardDetail} />
      <OnboardingDialog {...modals.onboarding} />
      <NewProjectDialog {...modals.newProject} />
      <RetroDialog {...modals.retro} />
    </>
  );
}
