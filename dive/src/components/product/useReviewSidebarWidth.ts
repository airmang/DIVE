import { useEffect, useState, type RefObject } from "react";

const REVIEW_SIDEBAR_WIDTH_STORAGE_KEY = "dive.review-sidebar.width";
const REVIEW_SIDEBAR_DEFAULT_WIDTH = 520;
export const REVIEW_SIDEBAR_MIN_WIDTH = 380;
const REVIEW_SIDEBAR_MAX_WIDTH = 900;
const REVIEW_SIDEBAR_VIEWPORT_RATIO = 0.8;
const REVIEW_SIDEBAR_KEYBOARD_STEP = 16;

function reviewSidebarMaxWidth(): number {
  if (typeof window === "undefined") return REVIEW_SIDEBAR_MAX_WIDTH;
  return Math.min(
    REVIEW_SIDEBAR_MAX_WIDTH,
    Math.floor(window.innerWidth * REVIEW_SIDEBAR_VIEWPORT_RATIO),
  );
}

function clampReviewSidebarWidth(width: number, maxWidth = reviewSidebarMaxWidth()): number {
  if (!Number.isFinite(width)) return REVIEW_SIDEBAR_DEFAULT_WIDTH;
  return Math.min(maxWidth, Math.max(REVIEW_SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function readStoredReviewSidebarWidth(): number | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(REVIEW_SIDEBAR_WIDTH_STORAGE_KEY);
  if (!stored) return null;
  const parsed = Number.parseInt(stored, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function persistReviewSidebarWidth(width: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REVIEW_SIDEBAR_WIDTH_STORAGE_KEY, String(width));
}

/**
 * Owns the review slide-in's user-resizable width: it persists to localStorage,
 * clamps to the viewport, and exposes pointer + keyboard resize handlers.
 * Extracted verbatim from StepDetailSlideIn.
 */
export function useReviewSidebarWidth(open: boolean, panelRef: RefObject<HTMLDivElement | null>) {
  const [maxWidth, setMaxWidth] = useState(() => reviewSidebarMaxWidth());
  const [width, setWidth] = useState(() =>
    clampReviewSidebarWidth(REVIEW_SIDEBAR_DEFAULT_WIDTH, reviewSidebarMaxWidth()),
  );

  const applyWidth = (nextWidth: number) => {
    const nextMaxWidth = reviewSidebarMaxWidth();
    const clamped = clampReviewSidebarWidth(nextWidth, nextMaxWidth);
    setMaxWidth(nextMaxWidth);
    setWidth(clamped);
    persistReviewSidebarWidth(clamped);
  };

  useEffect(() => {
    if (!open) return;
    const nextMaxWidth = reviewSidebarMaxWidth();
    const stored = readStoredReviewSidebarWidth();
    setMaxWidth(nextMaxWidth);
    setWidth(clampReviewSidebarWidth(stored ?? REVIEW_SIDEBAR_DEFAULT_WIDTH, nextMaxWidth));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleResize = () => {
      const nextMaxWidth = reviewSidebarMaxWidth();
      setMaxWidth(nextMaxWidth);
      setWidth((current) => {
        const clamped = clampReviewSidebarWidth(current, nextMaxWidth);
        if (clamped !== current) persistReviewSidebarWidth(clamped);
        return clamped;
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [open]);

  const widthFromClientX = (clientX: number): number => {
    const panelRight = panelRef.current?.getBoundingClientRect().right ?? 0;
    const rightEdge = panelRight > 0 ? panelRight : window.innerWidth;
    return rightEdge - clientX;
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    applyWidth(widthFromClientX(event.clientX));
    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      applyWidth(widthFromClientX(moveEvent.clientX));
    };
    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const resetWidth = () => applyWidth(REVIEW_SIDEBAR_DEFAULT_WIDTH);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      applyWidth(width - REVIEW_SIDEBAR_KEYBOARD_STEP);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      applyWidth(width + REVIEW_SIDEBAR_KEYBOARD_STEP);
    }
  };

  return {
    width,
    maxWidth,
    handleMouseDown,
    handleKeyDown,
    resetWidth,
  };
}
