import { lazy, Suspense, useEffect, useState } from "react";
import MainShell from "./components/shell/MainShell";
import {
  acknowledgeRc1Migration,
  runRc1Migration,
  type Rc1MigrationResult,
} from "./lib/rc1-migration";
import { resolveDemoRouteValue, type RecognizedDemoRoute } from "./lib/dev-demo";
import { useLocale } from "./i18n";
import { applyDocumentLang } from "./lib/document-lang";
import { syncNativeMenuLocale } from "./lib/menu-events";
import { useProjectSessionStore } from "./stores/project-session";

type ProductRoute = "main" | "settings" | "prompt-helper" | "user-guide";

type ResolvedRoute =
  | { kind: "product"; route: ProductRoute }
  | { kind: "demo"; route: RecognizedDemoRoute }
  | { kind: "internal"; route: "diagnostics-survey" };

const DevDemoShell = import.meta.env.DEV ? lazy(() => import("./components/demo/DemoShell")) : null;
const ResearchSurveyPage = lazy(() => import("./pages/research-survey"));
const DevPromptHelperDemoPage = import.meta.env.DEV
  ? lazy(() => import("./pages/prompt-helper-demo"))
  : null;
const SettingsPage = lazy(() => import("./pages/settings"));
const UserGuidePage = lazy(() => import("./pages/user-guide"));
const Rc1MigrationDialog = lazy(() => import("./components/rc1/Rc1MigrationDialog"));

function Rc1MigrationFallback({
  result,
  onAcknowledge,
}: {
  result: Rc1MigrationResult;
  onAcknowledge: () => void;
}) {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-bg px-6 text-fg"
      data-testid="rc1-migration-fallback"
    >
      <div className="w-full max-w-lg rounded-md border bg-bg-panel p-5 shadow-soft">
        <h1 className="text-base font-semibold">DIVE 데이터 전환 준비 중</h1>
        <p className="mt-2 text-sm text-fg-muted">
          이전 데모 저장소를 정리하고 실제 저장 방식으로 시작합니다.
        </p>
        <p className="mt-3 text-xs text-fg-muted" data-testid="rc1-fallback-removed-count">
          정리 대상: {result.removedKeys.length}개
        </p>
        <button
          type="button"
          className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-fg"
          onClick={onAcknowledge}
          data-testid="rc1-migration-fallback-confirm"
        >
          확인하고 계속
        </button>
      </div>
    </div>
  );
}

function resolveRoute(
  search = typeof window === "undefined" ? "" : window.location.search,
): ResolvedRoute {
  const params = new URLSearchParams(search);
  const productRoute = params.get("route");
  if (productRoute === "settings") {
    return { kind: "product", route: "settings" };
  }
  if (import.meta.env.DEV && productRoute === "prompt-helper") {
    return { kind: "product", route: "prompt-helper" };
  }
  if (productRoute === "user-guide") {
    return { kind: "product", route: "user-guide" };
  }

  const internalRoute = params.get("internal");
  if (internalRoute === "diagnostics-survey") {
    return { kind: "internal", route: "diagnostics-survey" };
  }

  const demo = params.get("demo");
  if (demo === "settings" || (import.meta.env.DEV && demo === "prompt-helper")) {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("demo");
      url.searchParams.set("route", demo);
      window.history.replaceState({}, "", url.toString());
      console.warn("Deprecated demo URL, use ?route=...");
    }
    return { kind: "product", route: demo };
  }

  if (import.meta.env.DEV) {
    const resolvedDemo = resolveDemoRouteValue(demo);
    if (resolvedDemo) return { kind: "demo", route: resolvedDemo };
  }

  return { kind: "product", route: "main" };
}

function App() {
  const locale = useLocale();
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

  useEffect(() => {
    void syncNativeMenuLocale(locale);
    // Keep <html lang> in sync so assistive tech pronounces the UI correctly
    // when the student switches locale (S-044 / P1-33).
    applyDocumentLang(locale);
  }, [locale]);

  useEffect(() => {
    const w =
      typeof window === "undefined"
        ? null
        : (window as unknown as { __TAURI_INTERNALS__?: unknown });
    if (!w?.__TAURI_INTERNALS__) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("provider://changed", () => {
          void useProjectSessionStore
            .getState()
            .loadAll()
            .catch((err) => console.warn("provider refresh failed:", err));
        }),
      )
      .then((nextUnlisten) => {
        if (cancelled) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch((err) => console.warn("provider listener failed:", err));

    return () => {
      cancelled = true;
      unlisten?.();
    };
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
    content = (
      <Suspense fallback={<MainShell />}>
        <SettingsPage />
      </Suspense>
    );
  } else if (
    route.kind === "product" &&
    route.route === "prompt-helper" &&
    import.meta.env.DEV &&
    DevPromptHelperDemoPage
  ) {
    content = (
      <Suspense fallback={<MainShell />}>
        <DevPromptHelperDemoPage />
      </Suspense>
    );
  } else if (route.kind === "product" && route.route === "user-guide") {
    content = (
      <Suspense fallback={<MainShell />}>
        <UserGuidePage />
      </Suspense>
    );
  } else if (route.kind === "internal") {
    content = (
      <Suspense fallback={<MainShell />}>
        <ResearchSurveyPage />
      </Suspense>
    );
  } else {
    content = <MainShell />;
  }

  if (rc1Migration !== null) {
    return (
      <div className="min-h-screen bg-bg text-fg" data-testid="rc1-migration-shell">
        <Suspense
          fallback={<Rc1MigrationFallback result={rc1Migration} onAcknowledge={acknowledge} />}
        >
          <Rc1MigrationDialog open result={rc1Migration} onAcknowledge={acknowledge} />
        </Suspense>
      </div>
    );
  }

  return content;
}

export default App;
