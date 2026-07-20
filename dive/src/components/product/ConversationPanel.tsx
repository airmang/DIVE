import { ChatArea } from "../shell/ChatArea";
import type { ProductShellController } from "./useProductShellController";
import { InterviewSurface, PlanDraftSurface, PrdSurface } from "./ConversationSurfaces";

interface ConversationPanelProps {
  conversation: ProductShellController["conversation"];
}

export function ConversationPanel({ conversation }: ConversationPanelProps) {
  const { interview, prdSurface, planDraft, ...rest } = conversation;
  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col">
      <ChatArea
        className="h-full min-h-0 min-w-0"
        {...rest}
        interviewPanel={interview ? <InterviewSurface data={interview} /> : null}
        prdSurface={prdSurface ? <PrdSurface data={prdSurface} /> : null}
        planDraftApproval={planDraft ? <PlanDraftSurface data={planDraft} /> : null}
      />
    </div>
  );
}
