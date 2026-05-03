import { useEffect, useState } from "react";
import MainShell from "./components/shell/MainShell";
import ShowcasePage from "./pages/showcase";
import WorkmapDemoPage from "./pages/workmap-demo";
import ChatDemoPage from "./pages/chat-demo";
import PermissionDemoPage from "./pages/permission-demo";
import SlideInDemoPage from "./pages/slide-in-demo";
import ScenarioADemoPage from "./pages/scenario-a-demo";

type Route = "main" | "showcase" | "workmap" | "chat" | "permission" | "slide-in" | "scenario-a";

function resolveRoute(): Route {
  if (typeof window === "undefined") return "main";
  const params = new URLSearchParams(window.location.search);
  const demo = params.get("demo");
  if (demo === "workmap") return "workmap";
  if (demo === "showcase") return "showcase";
  if (demo === "chat") return "chat";
  if (demo === "permission") return "permission";
  if (demo === "slide-in") return "slide-in";
  if (demo === "scenario-a") return "scenario-a";
  return "main";
}

function App() {
  const [route, setRoute] = useState<Route>(() => resolveRoute());

  useEffect(() => {
    const handler = () => setRoute(resolveRoute());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  if (route === "workmap") return <WorkmapDemoPage />;
  if (route === "showcase") return <ShowcasePage />;
  if (route === "chat") return <ChatDemoPage />;
  if (route === "permission") return <PermissionDemoPage />;
  if (route === "slide-in") return <SlideInDemoPage />;
  if (route === "scenario-a") return <ScenarioADemoPage />;
  return <MainShell />;
}

export default App;
