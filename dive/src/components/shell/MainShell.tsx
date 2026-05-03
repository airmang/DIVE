import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatArea } from "./ChatArea";
import { WorkmapStrip } from "./WorkmapStrip";

/**
 * MainShell — DIVE 3-zone 레이아웃 루트.
 *
 * 명세 §5.1:
 *   ┌─────────────┬──────────────────────────────┐
 *   │  Sidebar    │  Chat Area                   │   row 1
 *   │  280px      │  flex-1                      │
 *   ├─────────────┴──────────────────────────────┤
 *   │  Workmap strip (전체 폭, 220/80 toggle)     │   row 2
 *   └─────────────────────────────────────────────┘
 *
 * grid-rows를 `[1fr_auto]`로 두고 워크맵 자체가 height를 제어 —
 * grid-template-rows 트랜지션의 브라우저 구현 불안정성을 회피 (NEXT §트러블슈팅).
 * workmap collapsed 상태는 로컬 useState — 세션 단위 DB 영속화는 작업 2-1/2-6에서.
 */
export function MainShell() {
  const [workmapCollapsed, setWorkmapCollapsed] = useState(false);

  return (
    <div className="h-screen w-screen grid grid-cols-[280px_1fr] grid-rows-[1fr_auto] overflow-hidden bg-bg text-fg">
      <Sidebar className="row-start-1 col-start-1 min-h-0" />
      <ChatArea className="row-start-1 col-start-2 min-h-0 min-w-0" />
      <WorkmapStrip
        className="row-start-2 col-span-2"
        collapsed={workmapCollapsed}
        onToggle={() => setWorkmapCollapsed((c) => !c)}
      />
    </div>
  );
}

export default MainShell;
