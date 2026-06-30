import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { detectOsLocale, translate } from "./i18n";
import { ToastProvider } from "./components/toast/ToastProvider";
import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/500.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "./styles/globals.css";

interface StartupErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

class StartupErrorBoundary extends React.Component<
  React.PropsWithChildren,
  StartupErrorBoundaryState
> {
  state: StartupErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): StartupErrorBoundaryState {
    return { error, componentStack: null };
  }

  componentDidCatch(_error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  render() {
    if (this.state.error) {
      // The boundary lives above the React tree's locale store, so resolve copy
      // directly from the OS locale instead of the store hook (P2-33). Catches
      // failures before the app (and its locale provider) mounts.
      const locale = detectOsLocale();
      return (
        <main
          className="flex min-h-screen items-center justify-center bg-bg px-6 text-fg"
          data-testid="startup-error-boundary"
        >
          <section className="w-full max-w-xl rounded-md border bg-bg-panel p-5 shadow-soft">
            <h1 className="text-base font-semibold">{translate(locale, "startup.error.title")}</h1>
            <p className="mt-2 text-sm text-fg-muted">
              {translate(locale, "startup.error.description")}
            </p>
            <pre className="mt-4 max-h-64 overflow-auto rounded bg-bg-subtle p-3 text-xs text-fg-muted">
              {this.state.error.message}
              {this.state.componentStack ? `\n${this.state.componentStack}` : ""}
            </pre>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <StartupErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StartupErrorBoundary>
  </React.StrictMode>,
);
