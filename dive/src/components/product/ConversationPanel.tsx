import { ChatArea } from "../shell/ChatArea";
import type { ProductShellController } from "./useProductShellController";
import { PlanDraftFloatingCard } from "./PlanDraftFloatingCard";

interface ConversationPanelProps {
  conversation: ProductShellController["conversation"];
  planDraftFloating: ProductShellController["planDraftFloating"];
}

export function ConversationPanel({ conversation, planDraftFloating }: ConversationPanelProps) {
  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col">
      <ChatArea className="h-full min-h-0 min-w-0" {...conversation} />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-3">
        <PlanDraftFloatingCard
          draft={planDraftFloating.draft}
          planAccepted={planDraftFloating.planAccepted}
          onOpenReview={planDraftFloating.onOpenReview}
          onAccept={planDraftFloating.onAccept}
          onRequestChanges={planDraftFloating.onRequestChanges}
        />
      </div>
    </div>
  );
}
