#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const diveRoot = resolve(__dirname, "..");
const repoRoot = resolve(diveRoot, "..");
const checks = [];

function read(rel) {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const lib = read("dive/src-tauri/src/lib.rs");
check("production setup uses AppState::from_app_handle", lib.includes("AppState::from_app_handle"));
check("production setup does not call dev_mock", !/AppState::dev_mock\s*\(/.test(lib));
check("production exposes message_list IPC", lib.includes("ipc::message_list"));

const providers = read("dive/src-tauri/src/providers/mod.rs");
check(
  "MockProvider re-export is cfg gated",
  /#\[cfg\(any\(test, debug_assertions, feature = "dev-mock"\)\)\][\s\S]{0,120}MockProvider/.test(
    providers,
  ),
);

const mainShell = read("dive/src/components/shell/MainShell.tsx");
check("MainShell uses useWorkmap real wiring", mainShell.includes("useWorkmap("));
check("MainShell has no DEMO_CHANGED_FILES", !mainShell.includes("DEMO_CHANGED_FILES"));
check(
  "MainShell uses recognized demo route predicate",
  mainShell.includes("hasRecognizedDemoRoute"),
);
check(
  "MainShell has no simulate timeout verify",
  !/setTimeout\s*\(\s*\(\)\s*=>[\s\S]{0,160}verify/i.test(mainShell),
);

const projectSession = read("dive/src/stores/project-session.ts");
check(
  "project-session has no silent localStorage success fallback",
  !projectSession.includes("silent") && !projectSession.includes("localStorage fallback"),
);
check(
  "project-session keeps explicit demo fallback",
  projectSession.includes("withTauriOrDemoMock"),
);
check(
  "project-session demo fallback requires recognized demo route",
  projectSession.includes("hasRecognizedDemoRoute") &&
    !/URLSearchParams\(window\.location\.search\)\.has\(\"demo\"\)/.test(projectSession),
);

const useWorkmap = read("dive/src/hooks/useWorkmap.ts");
check("useWorkmap invokes card_create IPC", useWorkmap.includes('"card_create"'));
check("useWorkmap maps test_command", useWorkmap.includes("test_command"));

const useChatSession = read("dive/src/hooks/useChatSession.ts");
check(
  "useChatSession hydrates persisted message history",
  useChatSession.includes('"message_list"'),
);

const app = read("dive/src/App.tsx");
check("App resolves only recognized demo routes", app.includes("resolveDemoRouteValue(demo)"));

const aiAssistDialog = read("dive/src/components/workmap/AiAssistDialog.tsx");
check(
  "AiAssistDialog does not silently mock fallback on IPC failure",
  aiAssistDialog.includes("allowDemoFallback") &&
    !aiAssistDialog.includes(`catch {\n    return null;`) &&
    aiAssistDialog.includes("AI 카드 제안에 실패했습니다"),
);

check(
  "release smoke script exists",
  existsSync(resolve(diveRoot, "scripts/release-gate-smoke.mjs")),
);
check(
  "release gate workflow exists",
  existsSync(resolve(repoRoot, ".github/workflows/release-gate.yml")),
);

const failed = checks.filter((c) => !c.ok);
console.log(
  JSON.stringify({ passed: checks.length - failed.length, failed: failed.length, checks }, null, 2),
);
if (failed.length > 0) process.exit(1);
