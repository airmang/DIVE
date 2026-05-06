import { ChatArea } from "../shell/ChatArea";
import type { ProductShellController } from "./useProductShellController";

interface ConversationPanelProps {
  conversation: ProductShellController["conversation"];
}

export function ConversationPanel({ conversation }: ConversationPanelProps) {
  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col">
      <ChatArea className="h-full min-h-0 min-w-0" {...conversation} />
    </div>
  );
}
