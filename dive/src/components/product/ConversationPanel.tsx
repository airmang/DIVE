import { ChatArea } from "../shell/ChatArea";
import type { ProductShellController } from "./useProductShellController";

interface ConversationPanelProps {
  conversation: ProductShellController["conversation"];
}

export function ConversationPanel({ conversation }: ConversationPanelProps) {
  return <ChatArea className="row-start-1 col-start-2 min-h-0 min-w-0" {...conversation} />;
}
