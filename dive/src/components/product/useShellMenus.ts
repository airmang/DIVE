import { useCallback } from "react";
import type { ToastContextValue } from "../toast/toast-context";
import { refreshMenuRecents, useMenuEvents } from "../../lib/menu-events";
import { pickFolder } from "../../lib/tauri-dialog";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { downloadSessionExport } from "./productShellControllerLogic";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The route-switching callbacks that rewrite the URL query and dispatch a
 * synthetic popstate. Kept as a standalone hook so it can be created early —
 * `openSettingsRoute` is consumed across the whole shell controller (provider
 * setup, PRD save, model-not-found toast, ...).
 */
export function useShellNavigation() {
  const openSettingsRoute = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    url.searchParams.set("route", "settings");
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  const openPromptHelperRoute = import.meta.env.DEV
    ? () => {
        const url = new URL(window.location.href);
        url.searchParams.delete("demo");
        url.searchParams.set("route", "prompt-helper");
        window.history.pushState({}, "", url.toString());
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    : undefined;

  const openUserGuideRoute = useCallback((doc: "index" | "troubleshooting") => {
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    url.searchParams.set("route", "user-guide");
    if (doc === "troubleshooting") {
      url.searchParams.set("doc", "troubleshooting");
    } else {
      url.searchParams.delete("doc");
    }
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  return { openSettingsRoute, openPromptHelperRoute, openUserGuideRoute };
}

/**
 * Owns the native menu-bar wiring: the open-project folder picker, the session
 * JSONL export, and the `useMenuEvents` subscription. Extracted verbatim from
 * `useProductShellController` and called at its original position so the
 * subscription registers in the same effect order.
 */
export function useShellMenus(input: {
  setNewProjectOpen: (open: boolean) => void;
  openProject: (path: string) => Promise<unknown>;
  selectProject: (projectId: number) => Promise<unknown>;
  openSettingsRoute: () => void;
  toggleTheme: () => void;
  openUserGuideRoute: (doc: "index" | "troubleshooting") => void;
  currentSessionId: number | null;
  currentSessionTitle: string | null;
  toast: ToastContextValue["toast"];
  t: Translate;
}) {
  const {
    setNewProjectOpen,
    openProject,
    selectProject,
    openSettingsRoute,
    toggleTheme,
    openUserGuideRoute,
    currentSessionId,
    currentSessionTitle,
    toast,
    t,
  } = input;

  const handleOpenProject = useCallback(async () => {
    const picked = await pickFolder({ title: t("project.open_pick_title") });
    if (!picked) return;
    try {
      await openProject(picked);
    } catch (err) {
      toast({
        variant: "error",
        title: t("toast.project_open_failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [openProject, toast, t]);

  const handleExportSession = useCallback(async () => {
    if (currentSessionId === null) {
      toast({
        variant: "error",
        title: t("toast.export_no_session_title"),
        description: t("toast.export_no_session_description"),
      });
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const jsonl = await invoke<string>("export_session", { sessionId: currentSessionId });
      downloadSessionExport(currentSessionId, currentSessionTitle, jsonl);
      toast({
        variant: "success",
        title: t("toast.export_success_title"),
        description: t("toast.export_success_description"),
      });
    } catch (err) {
      toast({
        variant: "error",
        title: t("toast.export_failed_title"),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [currentSessionId, currentSessionTitle, t, toast]);

  useMenuEvents({
    "menu:new-project": () => setNewProjectOpen(true),
    "menu:open-project": () => void handleOpenProject(),
    "menu:open-recent": (payload) => {
      const projectId = (payload as { project_id?: number } | undefined)?.project_id;
      if (typeof projectId !== "number") return;
      void selectProject(projectId).then(() => refreshMenuRecents());
    },
    "menu:export-session": () => void handleExportSession(),
    "menu:settings": openSettingsRoute,
    "menu:toggle-theme": () => toggleTheme(),
    "menu:help-tutorial": () => {
      const { tutorialEnabled, setTutorialEnabled } = useUiPreferencesStore.getState();
      const nextEnabled = !tutorialEnabled;
      setTutorialEnabled(nextEnabled);
      toast({
        variant: "info",
        title: nextEnabled ? t("toast.tutorial_on") : t("toast.tutorial_off"),
        description: t("toast.tutorial_description"),
      });
    },
    "menu:help-docs": () => {
      openUserGuideRoute("index");
    },
    "menu:help-issue": () => {
      openUserGuideRoute("troubleshooting");
      toast({
        variant: "info",
        title: t("toast.issue_guidance_title"),
        description: t("toast.issue_guidance_description"),
      });
    },
    "menu:help-about": () =>
      toast({
        variant: "info",
        title: t("toast.about_title"),
        description: t("toast.about_description"),
      }),
  });
}
