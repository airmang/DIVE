// Static and build-output verification for the product-quality follow-up.
// Run with: node scripts/verify-quality-followup.mjs

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

function jsDistFiles() {
  const dir = join(root, "dist", "assets");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({
      name,
      path: join(dir, name),
      text: read(join("dist", "assets", name)),
      bytes: statSync(join(dir, name)).size,
    }));
}

const pkg = JSON.parse(read("package.json"));
const viteConfig = read("vite.config.ts");
const app = read("src/App.tsx");
const actionDock = read("src/components/product/ActionDock.tsx");
const productShellLayout = read("src/components/product/ProductShellLayout.tsx");
const controller = read("src/components/product/useProductShellController.ts");
const agentLoop = read("src-tauri/src/agent/mod.rs");
const agentLoopTest = read("src-tauri/tests/agent_loop.rs");
const ipc = read("src-tauri/src/ipc/mod.rs");
const telemetry = read("src-tauri/src/telemetry.rs");
const releaseSmoke = read("scripts/release-gate-smoke.mjs");
const releaseGate = read("../.github/workflows/release-gate.yml");

console.log("1. Package wiring and warning policy");
check(
  "package.json has verify:quality-followup",
  pkg.scripts?.["verify:quality-followup"] === "node scripts/verify-quality-followup.mjs",
);
check(
  "Vite warning limit is not raised to hide chunks",
  !/chunkSizeWarningLimit\s*:/.test(viteConfig),
);

console.log("\n2. Non-initial surfaces are code-split");
check("SettingsPage is lazy-loaded", /lazy\(\(\)\s*=>\s*import\(["']\.\/pages\/settings["']\)\)/.test(app));
check(
  "Rc1MigrationDialog is lazy-loaded",
  /lazy\(\(\)\s*=>\s*import\(["']\.\/components\/rc1\/Rc1MigrationDialog["']\)\)/.test(app),
);
check(
  "App has no static Settings import",
  !/import\s+SettingsPage\s+from\s+["']\.\/pages\/settings["']/.test(app),
);
check(
  "ActionDock lazy-loads SlideInPanel",
  /lazy\(\(\)\s*=>\s*import\(["']\.\.\/slide-in\/SlideInPanel["']\)\)/.test(actionDock),
);
check(
  "ProductShellLayout lazy-loads RoadmapRail",
  /lazy\(\(\)\s*=>\s*import\(["']\.\/RoadmapRail["']\)/.test(productShellLayout),
);
check(
  "ProductShellLayout lazy-loads StepDetailSlideIn",
  /lazy\(\(\)\s*=>\s*import\(["']\.\/StepDetailSlideIn["']\)/.test(productShellLayout),
);
check(
  "ProductShellLayout lazy-loads RecoverySlideIn",
  /lazy\(\(\)\s*=>\s*import\(["']\.\/RecoverySlideIn["']\)/.test(productShellLayout),
);
check(
  "Product shell controller lazy-loads PlanDraftApprovalScreen",
  /lazy\(\(\)\s*=>\s*import\(["']\.\/PlanDraftApprovalScreen["']\)/.test(controller),
);

console.log("\n3. Cancel is checked at async wait boundaries");
check("agent loop has cancel-aware helper", /wait_for_cancel/.test(agentLoop));
check("provider chat wait is cancel-selected", /provider\.chat\(req\)[\s\S]{0,500}wait_for_cancel/.test(agentLoop));
check("stream next wait is cancel-selected", /stream\.next\(\)[\s\S]{0,500}wait_for_cancel/.test(agentLoop));
check(
  "cancel test covers pending provider response",
  /cancel_while_waiting_for_provider_response/.test(agentLoopTest),
);
check(
  "cancel test covers pending stream chunk",
  /cancel_while_waiting_for_stream_chunk/.test(agentLoopTest),
);
check(
  "QA app data override isolates rebuilt-app QA",
  /DIVE_QA_APP_DATA_DIR/.test(ipc) && /DIVE_QA_APP_DATA_DIR/.test(telemetry),
);

console.log("\n4. Windows NSIS validation remains explicit");
check(
  "release smoke has macOS/non-Windows preflight path",
  /preflightOnly/.test(releaseSmoke) && /process\.platform !== ["']win32["']/.test(releaseSmoke),
);
check(
  "release-gate workflow runs Windows NSIS matrix",
  /windows-latest/.test(releaseGate) &&
    /windows-11-arm/.test(releaseGate) &&
    /--bundles nsis/.test(releaseGate) &&
    /release:smoke/.test(releaseGate),
);

console.log("\n5. Production build output budget when dist exists");
const files = jsDistFiles();
if (files.length === 0) {
  check("dist build output present", false, "run pnpm build before final verification");
} else {
  const initial = files
    .filter((file) => /^index-.*\.js$/.test(file.name))
    .sort((a, b) => b.bytes - a.bytes)[0];
  check("initial app chunk exists", Boolean(initial));
  check(
    "initial app chunk is below previous 534KB baseline",
    initial ? initial.bytes < 520 * 1024 : false,
    initial ? `${Math.round(initial.bytes / 1024)}KB` : "",
  );
  check(
    "initial app chunk does not contain settings route module",
    initial ? !/SettingsPage|settings-provider-card|settings-section/.test(initial.text) : false,
  );
  check(
    "initial app chunk does not contain slide-in tab modules",
    initial ? !/preview-url-input|terminal-log|code-tab-empty-action/.test(initial.text) : false,
  );
  check(
    "initial app chunk does not contain recovery/detail panel modules",
    initial ? !/recovery-slide-in|step-detail-panel/.test(initial.text) : false,
  );
}

console.log(`\nPASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
