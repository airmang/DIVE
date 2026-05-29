import { lazy, Suspense } from "react";
import { useSlideInStore } from "../../stores/slideIn";

const SlideInPanel = lazy(() => import("../slide-in/SlideInPanel"));

export function ActionDock() {
  const isOpen = useSlideInStore((s) => s.isOpen);
  if (!isOpen) return null;
  return (
    <Suspense fallback={null}>
      <SlideInPanel />
    </Suspense>
  );
}
