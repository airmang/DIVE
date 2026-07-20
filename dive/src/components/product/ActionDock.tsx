import { lazy, memo, Suspense } from "react";
import { useSlideInStore } from "../../stores/slideIn";

const SlideInPanel = lazy(() => import("../slide-in/SlideInPanel"));

// S-069 P3: this propless child is rendered by ProductShellLayout, which
// re-renders on every streaming delta. `memo` lets it (and the lazy SlideInPanel
// subtree) skip those parent-driven re-renders; its own `useSlideInStore`
// subscription still drives updates when the panel opens/closes.
export const ActionDock = memo(function ActionDock() {
  const isOpen = useSlideInStore((s) => s.isOpen);
  if (!isOpen) return null;
  return (
    <Suspense fallback={null}>
      <SlideInPanel />
    </Suspense>
  );
});
