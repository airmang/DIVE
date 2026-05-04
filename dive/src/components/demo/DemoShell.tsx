import { useEffect } from "react";
import ShowcasePage from "../../pages/showcase";
import WorkmapDemoPage from "../../pages/workmap-demo";
import ChatDemoPage from "../../pages/chat-demo";
import PermissionDemoPage from "../../pages/permission-demo";
import SlideInDemoPage from "../../pages/slide-in-demo";
import ScenarioADemoPage from "../../pages/scenario-a-demo";
import ScenarioBDemoPage from "../../pages/scenario-b-demo";
import ToolGuardDemoPage from "../../pages/tool-guard-demo";
import ProvisioningDemoPage from "../../pages/provisioning-demo";
import ExportDemoPage from "../../pages/export-demo";
import TimelineDemoPage from "../../pages/timeline-demo";
import ToastDemoPage from "../../pages/toast-demo";
import PolishDemoPage from "../../pages/polish-demo";
import McpDemoPage from "../../pages/mcp-demo";
import Phase5IntegrationPage from "../../pages/phase5-integration";
import { setProjectSessionDemoFallback } from "../../stores/project-session";
import type { DemoRoute } from "../../lib/demo-routes";

interface DemoShellProps {
  route: DemoRoute;
}

export function DemoShell({ route }: DemoShellProps) {
  useEffect(() => {
    setProjectSessionDemoFallback(true);
    return () => setProjectSessionDemoFallback(false);
  }, []);

  if (route === "workmap-demo") return <WorkmapDemoPage />;
  if (route === "chat-demo") return <ChatDemoPage />;
  if (route === "permission-demo") return <PermissionDemoPage />;
  if (route === "slide-in-demo") return <SlideInDemoPage />;
  if (route === "scenario-a-demo") return <ScenarioADemoPage />;
  if (route === "scenario-b-demo") return <ScenarioBDemoPage />;
  if (route === "tool-guard-demo") return <ToolGuardDemoPage />;
  if (route === "provisioning-demo") return <ProvisioningDemoPage />;
  if (route === "timeline-demo") return <TimelineDemoPage />;
  if (route === "toast-demo") return <ToastDemoPage />;
  if (route === "polish-demo") return <PolishDemoPage />;
  if (route === "export-demo") return <ExportDemoPage />;
  if (route === "phase5-integration") return <Phase5IntegrationPage />;
  if (route === "mcp-demo") return <McpDemoPage />;
  return <ShowcasePage />;
}

export default DemoShell;
