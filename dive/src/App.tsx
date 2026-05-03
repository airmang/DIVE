import { useEffect, useState } from "react";
import MainShell from "./components/shell/MainShell";
import ShowcasePage from "./pages/showcase";
import WorkmapDemoPage from "./pages/workmap-demo";

type Route = "main" | "showcase" | "workmap";

function resolveRoute(): Route {
  if (typeof window === "undefined") return "main";
  const params = new URLSearchParams(window.location.search);
  const demo = params.get("demo");
  if (demo === "workmap") return "workmap";
  if (demo === "showcase") return "showcase";
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
  return <MainShell />;
}

export default App;
