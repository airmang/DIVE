import { Sidebar } from "../shell/Sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useT } from "../../i18n";
import { PlanDashboardPanel } from "./PlanDashboardPanel";

export function ProjectRail() {
  const t = useT();
  return (
    <Tabs
      defaultValue="workspace"
      className="flex h-full min-h-0 flex-col border-r bg-bg-panel"
      data-testid="project-rail"
    >
      <div className="shrink-0 border-b px-3 py-3">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="workspace">{t("sidebar.tab_workspace")}</TabsTrigger>
          <TabsTrigger value="dashboard">{t("sidebar.tab_dashboard")}</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="workspace" className="m-0 min-h-0 flex-1 overflow-hidden">
        <Sidebar className="h-full min-h-0 border-r-0" />
      </TabsContent>
      <TabsContent value="dashboard" className="m-0 min-h-0 flex-1 overflow-hidden">
        <PlanDashboardPanel />
      </TabsContent>
    </Tabs>
  );
}
