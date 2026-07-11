// Static verification for the audit-driven reliability fixes.
// Run with: node scripts/verify-audit-fixes.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
let pass = 0;
let fail = 0;

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function check(name, condition, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? `  ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? `  ${detail}` : ""}`);
  }
}

const agentEvent = read("src-tauri/src/agent/event.rs");
const agentLoop = read("src-tauri/src/agent/mod.rs");
const chatSession = read("src/hooks/useChatSession.ts");
const planLlm = read("src/features/planning/usePlanInterviewLLM.ts");
const controller = read("src/components/product/useProductShellController.ts");
const sidebar = read("src/components/shell/Sidebar.tsx");
const providerSelector = read("src/components/settings/ProviderModelSelector.tsx");
const roadmap = read("src/features/roadmap/usePlanRoadmap.ts");
const planStepActions = read("src/components/plan/PlanStepActions.tsx");
const ipc = read("src-tauri/src/ipc/chat.rs");
const errors = read("src/lib/error-classify.ts");
const ko = JSON.parse(read("src/i18n/ko.json"));
const en = JSON.parse(read("src/i18n/en.json"));
const pkg = JSON.parse(read("package.json"));

console.log("1. Assistant finish reason is available to the UI");
check(
  "AgentEvent AssistantEnd carries finish_reason",
  /AssistantEnd\s*\{[\s\S]*finish_reason:\s*String/.test(agentEvent),
);
check(
  "Agent loop emits finish_reason on assistant_end",
  /AgentEvent::AssistantEnd\s*\{[\s\S]*finish_reason:\s*finish_reason_str\(finish_reason\)\.to_owned\(\)/.test(
    agentLoop,
  ),
);
check(
  "frontend AgentEvent type includes finish_reason",
  /type:\s*"assistant_end"[\s\S]*finish_reason\??:\s*string/.test(chatSession),
);

console.log("\n2. Plan interview parser reports recoverable failures");
check("hook accepts onPlanDraftError", /onPlanDraftError/.test(planLlm));
check("hook distinguishes length finish reason", /finishReason\s*===\s*"length"/.test(planLlm));
check("hook reports invalid JSON", /invalid_json/.test(planLlm));
check("hook reports invalid plan shape", /invalid_plan_shape/.test(planLlm));
check("controller renders PlanDraftRecoveryScreen", /PlanDraftRecoveryScreen/.test(controller));
check("controller sends compact retry prompt", /compact_retry_prompt/.test(controller));

console.log("\n3. Sidebar model label uses selected model");
check("sidebar formats selected model", /selected_model/.test(sidebar));
check("sidebar keeps provider kind as secondary text", /provider-sub-label/.test(sidebar));
check("settings model selector refreshes provider list", /onModelSaved/.test(providerSelector));

console.log("\n4. Rate-limit failures become recoverable blocked steps");
check(
  "IPC marks active step blocked after provider quota errors",
  /mark_step_blocked_after_recoverable_error/.test(ipc),
);
check(
  "roadmap state preserves blocked mappings",
  /mapping\.status\s*===\s*"blocked"/.test(roadmap),
);
check(
  "blocked mapped steps keep a resume action",
  /item\.status\s*===\s*"blocked"[\s\S]*onResume/.test(planStepActions),
);

console.log("\n5. Rate-limit guidance names quota and model switching");
check("rate-limit classifier detects FreeUsageLimitError", /FreeUsageLimitError/i.test(errors));
check(
  "Korean rate-limit hint mentions model/settings",
  /모델|설정/.test(ko.error.rate_limit.hints),
);
check(
  "English rate-limit hint mentions model/settings",
  /model|Settings/i.test(en.error.rate_limit.hints),
);

console.log("\n6. Verification script is wired into package scripts");
check(
  "package.json has verify:audit-fixes",
  pkg.scripts?.["verify:audit-fixes"] === "node scripts/verify-audit-fixes.mjs",
);

console.log(`\nPASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
