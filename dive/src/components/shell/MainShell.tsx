import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatArea } from "./ChatArea";
import { WorkmapStrip } from "./WorkmapStrip";
import { SlideInPanel } from "../slide-in/SlideInPanel";
import { useSlideInStore } from "../../stores/slideIn";

export function MainShell() {
  const [workmapCollapsed, setWorkmapCollapsed] = useState(false);
  const openSlideIn = useSlideInStore((s) => s.open);

  return (
    <div className="relative h-screen w-screen grid grid-cols-[280px_1fr] grid-rows-[1fr_auto] overflow-hidden bg-bg text-fg">
      <Sidebar className="row-start-1 col-start-1 min-h-0" />
      <ChatArea
        className="row-start-1 col-start-2 min-h-0 min-w-0"
        onOpenSlidePanel={() => openSlideIn({ tab: "code" })}
      />
      <WorkmapStrip
        className="row-start-2 col-span-2"
        collapsed={workmapCollapsed}
        onToggle={() => setWorkmapCollapsed((c) => !c)}
      />
      <SlideInPanel />
    </div>
  );
}

export default MainShell;
