import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ProductShellController } from "./useProductShellController";
import { ActionDock } from "./ActionDock";
import { ConversationPanel } from "./ConversationPanel";
import { ProductModalHost } from "./ProductModalHost";
import { ProjectRail } from "./ProjectRail";
import { TopBar } from "./TopBar";
import { usePlanActivity, type StepSessionMappingRow } from "../../features/roadmap";
import { requestPlanDraftReview } from "../../features/planning";
import { useProjectSessionStore } from "../../stores/project-session";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";

const RoadmapRail = lazy(() =>
  import("./RoadmapRail").then((module) => ({ default: module.RoadmapRail })),
);
const StepDetailSlideIn = lazy(() =>
  import("./StepDetailSlideIn").then((module) => ({ default: module.StepDetailSlideIn })),
);
const RecoverySlideIn = lazy(() =>
  import("./RecoverySlideIn").then((module) => ({ default: module.RecoverySlideIn })),
);

interface ProductShellLayoutProps {
  shell: ProductShellController;
}

interface OpenPlanStepOptions {
  focus?: boolean;
  openDetail?: boolean;
}

const LEFT_RAIL_STORAGE_KEY = "dive:layout:left-rail-width";
const RIGHT_RAIL_STORAGE_KEY = "dive:layout:right-rail-width";
const LEFT_RAIL_DEFAULT = 280;
const RIGHT_RAIL_DEFAULT = 360;
const LEFT_RAIL_MIN = 220;
const LEFT_RAIL_MAX = 420;
const RIGHT_RAIL_MIN = 300;
const RIGHT_RAIL_MAX = 560;
const RAIL_KEY_STEP = 24;

function clampWidth(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function storedWidth(key: string, fallback: number, min: number, max: number) {
  if (typeof window === "undefined") return fallback;
  const raw = Number(window.localStorage.getItem(key) ?? "");
  return Number.isFinite(raw) ? clampWidth(raw, min, max) : fallback;
}

async function setCurrentCardForMapping(mapping: StepSessionMappingRow) {
  if (mapping.session_id === null || mapping.card_id === null) return;
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  if (!w?.__TAURI_INTERNALS__) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke<void>("workmap_set_current_card", {
    sessionId: mapping.session_id,
    cardId: mapping.card_id,
  });
}

export function ProductShellLayout({ shell }: ProductShellLayoutProps) {
  const t = useT();
  const currentProjectId = useProjectSessionStore((s) => s.currentProjectId);
  const selectSession = useProjectSessionStore((s) => s.selectSession);
  const loadAll = useProjectSessionStore((s) => s.loadAll);
  const planActivity = usePlanActivity(shell.planRoadmap.status?.plan_id ?? null, 5);
  const [leftRailWidth, setLeftRailWidth] = useState(() =>
    storedWidth(LEFT_RAIL_STORAGE_KEY, LEFT_RAIL_DEFAULT, LEFT_RAIL_MIN, LEFT_RAIL_MAX),
  );
  const [rightRailWidth, setRightRailWidth] = useState(() =>
    storedWidth(RIGHT_RAIL_STORAGE_KEY, RIGHT_RAIL_DEFAULT, RIGHT_RAIL_MIN, RIGHT_RAIL_MAX),
  );
  const rightPanelVisible =
    shell.roadmap.visible || shell.roadmap.showEmpty || shell.planRoadmap.hasPlan;
  const gridTemplateColumns = rightPanelVisible
    ? `${leftRailWidth}px minmax(0, 1fr) ${rightRailWidth}px`
    : `${leftRailWidth}px minmax(0, 1fr)`;
  const gridStyle = useMemo(() => ({ gridTemplateColumns }), [gridTemplateColumns]);
  useEffect(() => {
    window.localStorage.setItem(LEFT_RAIL_STORAGE_KEY, String(leftRailWidth));
  }, [leftRailWidth]);
  useEffect(() => {
    window.localStorage.setItem(RIGHT_RAIL_STORAGE_KEY, String(rightRailWidth));
  }, [rightRailWidth]);
  const handleOpenSession = (sessionId: number) => {
    selectSession(sessionId);
    void loadAll();
  };
  const handleReviewPlan = () => {
    if (currentProjectId !== null) requestPlanDraftReview(currentProjectId);
  };
  const handleOpenPlanStep = async (stepId: number, opts?: OpenPlanStepOptions) => {
    const mapping = await shell.planRoadmap.openStep(stepId);
    await planActivity.refresh();
    if (mapping.session_id !== null) {
      shell.roadmap.onPlanStepOpened(mapping, { autoRun: opts?.openDetail !== true });
      if (opts?.focus !== false) {
        selectSession(mapping.session_id);
      }
      await setCurrentCardForMapping(mapping);
      await loadAll();
      if (opts?.openDetail) {
        shell.stepDetail.onOpenChange(true);
      }
    }
    return mapping;
  };
  const startResize = (side: "left" | "right") => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftRailWidth : rightRailWidth;
    const handleMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (side === "left") {
        setLeftRailWidth(clampWidth(startWidth + delta, LEFT_RAIL_MIN, LEFT_RAIL_MAX));
      } else {
        setRightRailWidth(clampWidth(startWidth - delta, RIGHT_RAIL_MIN, RIGHT_RAIL_MAX));
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  const adjustRailWidth = (side: "left" | "right", direction: -1 | 1) => {
    if (side === "left") {
      setLeftRailWidth((width) =>
        clampWidth(width + direction * RAIL_KEY_STEP, LEFT_RAIL_MIN, LEFT_RAIL_MAX),
      );
      return;
    }
    setRightRailWidth((width) =>
      clampWidth(width - direction * RAIL_KEY_STEP, RIGHT_RAIL_MIN, RIGHT_RAIL_MAX),
    );
  };
  return (
    <div
      className="relative grid h-screen w-screen grid-rows-[auto_1fr] overflow-hidden bg-bg text-fg transition-[grid-template-columns] duration-200"
      style={gridStyle}
      data-testid="main-shell"
      data-roadmap-visible={rightPanelVisible ? "true" : "false"}
    >
      <TopBar
        projectName={shell.projectName}
        providerBanner={shell.providerBanner}
        recoveryCount={shell.recovery.checkpointCount}
        hasFailedStep={shell.recovery.hasFailedStep}
        onOpenRecovery={() => shell.recovery.onOpenChange(true)}
      />
      <div className="row-start-2 col-start-1 min-h-0">
        <ProjectRail />
      </div>
      <RailResizeHandle
        side="left"
        className="row-start-2 col-start-1 justify-self-end translate-x-1/2"
        value={leftRailWidth}
        min={LEFT_RAIL_MIN}
        max={LEFT_RAIL_MAX}
        label={t("a11y.resize_left_sidebar")}
        onPointerDown={startResize("left")}
        onAdjust={adjustRailWidth}
      />
      <div className="row-start-2 col-start-2 min-h-0">
        <ConversationPanel conversation={shell.conversation} />
      </div>
      {rightPanelVisible ? (
        <div className="row-start-2 col-start-3 min-h-0 flex flex-col overflow-hidden border-l bg-bg">
          <Suspense fallback={null}>
            <RoadmapRail
              projectName={shell.projectName}
              planRoadmap={shell.planRoadmap}
              fallbackRoadmap={shell.roadmap}
              onOpenPlanStep={handleOpenPlanStep}
              onOpenSession={handleOpenSession}
              onCreatePlan={shell.roadmap.onCreatePlan}
              onReviewPlan={handleReviewPlan}
            />
          </Suspense>
        </div>
      ) : null}
      {rightPanelVisible ? (
        <RailResizeHandle
          side="right"
          className="row-start-2 col-start-3 justify-self-start -translate-x-1/2"
          value={rightRailWidth}
          min={RIGHT_RAIL_MIN}
          max={RIGHT_RAIL_MAX}
          label={t("a11y.resize_right_sidebar")}
          onPointerDown={startResize("right")}
          onAdjust={adjustRailWidth}
        />
      ) : null}
      <ActionDock />
      <ProductModalHost modals={shell.modals} />
      {shell.stepDetail.open ? (
        <Suspense fallback={null}>
          <StepDetailSlideIn {...shell.stepDetail} />
        </Suspense>
      ) : null}
      {shell.recovery.open ? (
        <Suspense fallback={null}>
          <RecoverySlideIn
            open={shell.recovery.open}
            onOpenChange={shell.recovery.onOpenChange}
            recovery={shell.recovery.panel}
          />
        </Suspense>
      ) : null}
      <input
        type="hidden"
        data-testid="current-card-id"
        value={shell.hiddenState.currentCardId ?? ""}
      />
      <input
        type="hidden"
        data-testid="last-manual-checkpoint"
        value={shell.hiddenState.lastManualCheckpointLabel ?? ""}
      />
    </div>
  );
}

function RailResizeHandle({
  side,
  className,
  value,
  min,
  max,
  label,
  onPointerDown,
  onAdjust,
}: {
  side: "left" | "right";
  className?: string;
  value: number;
  min: number;
  max: number;
  label: string;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onAdjust: (side: "left" | "right", direction: -1 | 1) => void;
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      className={cn(
        "group z-30 flex h-full w-3 cursor-col-resize items-stretch justify-center outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        className,
      )}
      data-testid={`rail-resize-${side}`}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onAdjust(side, -1);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onAdjust(side, 1);
        }
      }}
    >
      <span className="my-2 w-px rounded-full bg-border transition-colors group-hover:bg-accent" />
    </div>
  );
}
