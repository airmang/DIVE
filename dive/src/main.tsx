import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/toast/ToastProvider";
import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/500.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "./styles/globals.css";

interface StartupErrorBoundaryState {
  error: Error | null;
}

class StartupErrorBoundary extends React.Component<
  React.PropsWithChildren,
  StartupErrorBoundaryState
> {
  state: StartupErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): StartupErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main
          className="flex min-h-screen items-center justify-center bg-bg px-6 text-fg"
          data-testid="startup-error-boundary"
        >
          <section className="w-full max-w-xl rounded-md border bg-bg-panel p-5 shadow-soft">
            <h1 className="text-base font-semibold">DIVE 초기화 실패</h1>
            <p className="mt-2 text-sm text-fg-muted">
              앱을 시작하는 동안 문제가 발생했습니다. 다시 실행해도 반복되면 로그를 확인해 주세요.
            </p>
            <pre className="mt-4 max-h-64 overflow-auto rounded bg-bg-subtle p-3 text-xs text-fg-muted">
              {this.state.error.message}
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
