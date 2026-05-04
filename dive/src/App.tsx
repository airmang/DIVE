import { lazy, Suspense, useEffect, useState } from "react";
import MainShell from "./components/shell/MainShell";
import SettingsPage from "./pages/settings";
import PromptHelperDemoPage from "./pages/prompt-helper-demo";
import { Rc1MigrationDialog } from "./components/rc1/Rc1MigrationDialog";
import {
  acknowledgeRc1Migration,
  runRc1Migration,
  type Rc1MigrationResult,
} from "./lib/rc1-migration";

type ProductRoute = "main" | "settings" | "prompt-helper";
type DemoRoute = string;

type ResolvedRoute = { kind: "product"; route: ProductRoute } | { kind: "demo"; route: DemoRoute };

const DevDemoShell = import.meta.env.DEV
  ? lazy(() => import("./components/demo/DemoShell"))
  : null;

function resolveRoute(
  search = typeof window === "undefined" ? "" : window.location.search,
): ResolvedRoute {
  const params = new URLSearchParams(search);
  const productRoute = params.get("route");
  if (productRoute === "settings" || productRoute === "prompt-helper") {
    return { kind: "product", route: productRoute };
  }

  const demo = params.get("demo");
  if (demo === "settings" || demo === "prompt-helper") {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("demo");
      url.searchParams.set("route", demo);
      window.history.replaceState({}, "", url.toString());
      console.warn("Deprecated demo URL, use ?route=...");
    }
    return { kind: "product", route: demo };
  }

  if (import.meta.env.DEV && demo) {
    return { kind: "demo", route: demo };
  }

  return { kind: "product", route: "main" };
}

function App() {
  const [route, setRoute] = useState<ResolvedRoute>(() => resolveRoute());
  const [rc1Migration, setRc1Migration] = useState<Rc1MigrationResult | null>(() => {
    const result = runRc1Migration();
    return result.needed ? result : null;
  });

  useEffect(() => {
    const handler = () => setRoute(resolveRoute());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const acknowledge = () => {
    acknowledgeRc1Migration();
    setRc1Migration(null);
  };

  let content;
  if (route.kind === "demo" && import.meta.env.DEV && DevDemoShell) {
    content = (
      <Suspense fallback={<MainShell />}>
        <DevDemoShell route={route.route} />
      </Suspense>
    );
  } else if (route.kind === "product" && route.route === "settings") {
    content = <SettingsPage />;
  } else if (route.kind === "product" && route.route === "prompt-helper") {
    content = <PromptHelperDemoPage />;
  } else {
    content = <MainShell />;
  }

  if (rc1Migration !== null) {
    return (
      <div className="min-h-screen bg-bg text-fg" data-testid="rc1-migration-shell">
        <Rc1MigrationDialog open result={rc1Migration} onAcknowledge={acknowledge} />
      </div>
    );
  }

  return content;
}

export default App;
