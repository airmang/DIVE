import { Sidebar } from "../shell/Sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useT } from "../../i18n";
import { PlanDashboardPanel } from "./PlanDashboardPanel";
import { memo, useEffect, useState } from "react";
import { cn } from "../../lib/utils";

export const PROJECT_RAIL_TAB_REQUEST_EVENT = "dive:project-rail-tab-request";
export type ProjectRailTab = "workspace" | "dashboard";

// eslint-disable-next-line react-refresh/only-export-components
export function requestProjectRailTab(tab: ProjectRailTab) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PROJECT_RAIL_TAB_REQUEST_EVENT, { detail: { tab } }));
}

// S-069 P3: this propless child is rendered by ProductShellLayout, which
// re-renders on every streaming delta. `memo` lets it (and the PlanDashboardPanel
// subtree) skip those parent-driven re-renders; its own tab state and the
// project-rail-tab window event still drive its updates.
export const ProjectRail = memo(function ProjectRail() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<ProjectRailTab>("workspace");

  useEffect(() => {
    const handler = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: ProjectRailTab }>).detail?.tab;
      if (tab === "workspace" || tab === "dashboard") setActiveTab(tab);
    };
    window.addEventListener(PROJECT_RAIL_TAB_REQUEST_EVENT, handler);
    return () => window.removeEventListener(PROJECT_RAIL_TAB_REQUEST_EVENT, handler);
  }, []);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value === "dashboard" ? "dashboard" : "workspace")}
      className="flex h-full min-h-0 flex-col border-r bg-bg-panel"
      data-testid="project-rail"
    >
      <div className="shrink-0 border-b px-3 py-3">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="workspace">{t("sidebar.tab_workspace")}</TabsTrigger>
          <TabsTrigger value="dashboard">{t("sidebar.tab_dashboard")}</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent
        value="workspace"
        forceMount
        className={cn("m-0 min-h-0 flex-1 overflow-hidden", activeTab !== "workspace" && "hidden")}
      >
        <Sidebar className="h-full min-h-0 border-r-0" />
      </TabsContent>
      <TabsContent
        value="dashboard"
        forceMount
        className={cn("m-0 min-h-0 flex-1 overflow-hidden", activeTab !== "dashboard" && "hidden")}
      >
        <PlanDashboardPanel />
      </TabsContent>
    </Tabs>
  );
});
