// Static verification for the product-quality iteration after the DIVE audit.
// Run with: node scripts/verify-quality-iteration.mjs

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
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
const mermaid = read("src/components/product/MermaidDiagram.tsx");
const ko = JSON.parse(read("src/i18n/ko.json"));
const en = JSON.parse(read("src/i18n/en.json"));

console.log("1. Dev-mock product path proves real code output");
check(
  "agent-loop has product path code-output regression",
  /product_path_build_step_creates_code_output_and_records_changed_files/.test(agentLoopTest),
);
check("test writes index.html through write_file", /write_file[\s\S]*index\.html/.test(agentLoopTest));
check("test asserts changed_files contains index.html", /changed_files[\s\S]*index\.html/.test(agentLoopTest));

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
check("Korean blocked output copy exists", typeof ko.slide_in?.code_empty?.blocked_no_output?.title === "string");
check("English blocked output copy exists", typeof en.slide_in?.code_empty?.blocked_no_output?.title === "string");

console.log("\n4. Mermaid is lazy-loaded");
check("MermaidDiagram has no static mermaid import", !/import\s+mermaid\s+from\s+["']mermaid["']/.test(mermaid));
check("MermaidDiagram dynamically imports mermaid", /import\(["']mermaid["']\)/.test(mermaid));
check("MermaidDiagram initializes once after load", /mermaidInitialized/.test(mermaid));
check("MermaidDiagram exposes loading state", /mermaid-loading/.test(mermaid));

console.log("\n5. Bundle output keeps Mermaid out of initial chunk when dist exists");
const built = distFiles();
if (built.length === 0) {
  check("dist build output present", false, "run pnpm build before final verification");
} else {
  const initial = built.find((file) => /^index-.*\.js$/.test(file.name));
  const mermaidChunks = built.filter((file) => /mermaid|diagram|flow|cytoscape|dagre/i.test(file.name));
  check("initial app chunk exists", Boolean(initial));
  check("Mermaid-related chunks are split", mermaidChunks.length > 0, `chunks=${mermaidChunks.length}`);
  check(
    "initial app chunk does not contain Mermaid renderer payload",
    initial ? !/mermaidAPI|mermaid version|sequenceDiagram/.test(initial.text) : false,
  );
}

console.log("\n6. Package wiring");
check(
  "package.json has verify:quality-iteration",
  pkg.scripts?.["verify:quality-iteration"] === "node scripts/verify-quality-iteration.mjs",
);

console.log(`\nPASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
