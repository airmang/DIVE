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
  /#\[cfg\(any\(test, feature = "dev-mock"\)\)\][\s\S]{0,120}MockProvider/.test(providers) &&
    !/debug_assertions[\s\S]{0,120}MockProvider/.test(providers),
);

const registry = read("dive/src-tauri/src/tools/registry.rs");
check(
  "production builtins omit freeform bash",
  !registry.includes("Arc::new(Bash)") && !registry.includes('("bash", RiskLevel::Danger)'),
);
check(
  "production builtins omit stale emit plan draft tool",
  !registry.includes("EmitPlanDraftTool") && !registry.includes("emit_workspace_plan_draft"),
);

const productShellController = read("dive/src/components/product/useProductShellController.ts");
check(
  "Product shell controller uses real roadmap wiring",
  productShellController.includes("useRoadmap(currentSessionId)"),
);
check(
  "Product shell controller has no DEMO_CHANGED_FILES",
  !productShellController.includes("DEMO_CHANGED_FILES"),
);
check(
  "Product shell controller uses recognized demo route predicate",
  productShellController.includes("hasRecognizedDemoRoute"),
);
check(
  "Product shell controller has no simulate timeout verify",
  !/setTimeout\s*\(\s*\(\)\s*=>[\s\S]{0,160}verify/i.test(productShellController),
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

const planInterview = read("dive/src/features/planning/usePlanInterviewLLM.ts");
check(
  "Plan interview parses assistant_end JSON without mock fallback",
  planInterview.includes("decodeWorkspacePlanDraftFromLlm") &&
    planInterview.includes("assistant_end") &&
    !planInterview.includes("mockPlanDraft"),
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
