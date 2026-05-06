import { useEffect } from "react";
import ShowcasePage from "../../pages/showcase";
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
import { resolveDemoRouteValue } from "../../lib/demo-routes";

interface DemoShellProps {
  route: string;
}

export function DemoShell({ route }: DemoShellProps) {
  const demoRoute = resolveDemoRouteValue(route) ?? "showcase";

  useEffect(() => {
    setProjectSessionDemoFallback(true);
    return () => setProjectSessionDemoFallback(false);
  }, []);

  if (demoRoute === "chat-demo") return <ChatDemoPage />;
  if (demoRoute === "permission-demo") return <PermissionDemoPage />;
  if (demoRoute === "slide-in-demo") return <SlideInDemoPage />;
  if (demoRoute === "scenario-a-demo") return <ScenarioADemoPage />;
  if (demoRoute === "scenario-b-demo") return <ScenarioBDemoPage />;
  if (demoRoute === "tool-guard-demo") return <ToolGuardDemoPage />;
  if (demoRoute === "provisioning-demo") return <ProvisioningDemoPage />;
  if (demoRoute === "timeline-demo") return <TimelineDemoPage />;
  if (demoRoute === "toast-demo") return <ToastDemoPage />;
  if (demoRoute === "polish-demo") return <PolishDemoPage />;
  if (demoRoute === "export-demo") return <ExportDemoPage />;
  if (demoRoute === "phase5-integration") return <Phase5IntegrationPage />;
  if (demoRoute === "mcp-demo") return <McpDemoPage />;
  return <ShowcasePage />;
}

export default DemoShell;
