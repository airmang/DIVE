// Static verification for the product-quality iteration after the DIVE audit.
// Run with: node scripts/verify-quality-iteration.mjs

import { existsSync, readdirSync, readFileSync } from "node:fs";
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

function distFiles() {
  const dir = join(root, "dist", "assets");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({ name, text: read(join("dist", "assets", name)) }));
}

const pkg = JSON.parse(read("package.json"));
const agentLoopTest = read("src-tauri/tests/agent_loop.rs");
const chatSession = read("src/hooks/useChatSession.ts");
const chatArea = read("src/components/shell/ChatArea.tsx");
const chatInput = read("src/components/chat/ChatInput.tsx");
const codeTab = read("src/components/slide-in/CodeTab.tsx");
const slideInStore = read("src/stores/slideIn.ts");
const slideInTypes = read("src/components/slide-in/types.ts");
const controller = read("src/components/product/useProductShellController.ts");
const planMiniMap = read("src/components/plan/PlanMiniMap.tsx");
const planDraftMap = read("src/components/product/PlanDraftDependencyMap.tsx");
const ko = JSON.parse(read("src/i18n/ko.json"));
const en = JSON.parse(read("src/i18n/en.json"));

console.log("1. Dev-mock product path proves real code output");
check(
  "agent-loop has product path code-output regression",
  /product_path_build_step_creates_code_output_and_records_changed_files/.test(agentLoopTest),
);
check(
  "test writes index.html through write_file",
  /write_file[\s\S]*index\.html/.test(agentLoopTest),
);
check(
  "test asserts changed_files contains index.html",
  /changed_files[\s\S]*index\.html/.test(agentLoopTest),
);

console.log("\n2. Long provider runs expose elapsed time and cancel");
check("chat session tracks run started_at", /runStartedAt/.test(chatSession));
check("chat session exposes cancelRequested", /cancelRequested/.test(chatSession));
check("chat area renders running status", /chat-running-status/.test(chatArea));
check("chat area wires cancel action", /onCancelStreaming/.test(chatArea));
check("chat input supports busy label", /busyLabel/.test(chatInput));
check("Korean running copy exists", typeof ko.chat?.running?.elapsed === "string");
check("English running copy exists", typeof en.chat?.running?.elapsed === "string");

console.log("\n3. Empty code output state is actionable");
check("slide-in store tracks empty reason", /emptyReason/.test(slideInStore));
check("slide-in types include blocked empty reason", /blocked_no_output/.test(slideInTypes));
check("controller sends blocked no-output context", /blocked_no_output/.test(controller));
check("code tab renders actionable empty state", /code-tab-empty-action/.test(codeTab));
check(
  "Korean blocked output copy exists",
  typeof ko.slide_in?.code_empty?.blocked_no_output?.title === "string",
);
check(
  "English blocked output copy exists",
  typeof en.slide_in?.code_empty?.blocked_no_output?.title === "string",
);

console.log("\n4. Dependency maps use lightweight SVG surfaces");
check("plan minimap exposes focusable nodes", /plan-minimap-node/.test(planMiniMap));
check("draft approval map exposes a test id", /plan-draft-dependency-map/.test(planDraftMap));
check("plan minimap uses keyboard handlers", /onKeyDown/.test(planMiniMap));

console.log("\n5. Bundle output keeps initial chunk within budget when dist exists");
const built = distFiles();
if (built.length === 0) {
  check("dist build output present", false, "run pnpm build before final verification");
} else {
  const initial = built.find((file) => /^index-.*\.js$/.test(file.name));
  check("initial app chunk exists", Boolean(initial));
  check(
    "initial app chunk is below 500KB",
    initial ? initial.text.length < 500 * 1024 : false,
    initial ? `${Math.round(initial.text.length / 1024)}KB` : "",
  );
}

console.log("\n6. Package wiring");
check(
  "package.json has verify:quality-iteration",
  pkg.scripts?.["verify:quality-iteration"] === "node scripts/verify-quality-iteration.mjs",
);

console.log(`\nPASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
