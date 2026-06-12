// Static and build-output verification for the route-chat cancel quality iteration.
// Run with: node scripts/verify-route-chat-cancel-quality.mjs

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
const main = read("src/main.tsx");
const usePlanRouter = read("src/features/planning/usePlanRouter.ts");
const controller = read("src/components/product/useProductShellController.ts");
const chatArea = read("src/components/shell/ChatArea.tsx");
const rc1Migration = read("src/lib/rc1-migration.ts");
const ko = read("src/i18n/ko.json");
const en = read("src/i18n/en.json");
const tauriLib = read("src-tauri/src/lib.rs");
const ipcMod = read("src-tauri/src/ipc/mod.rs");
const ipcState = read("src-tauri/src/ipc/state.rs");
const workspacePlan = read("src-tauri/src/ipc/workspace_plan.rs");
const planRouter = read("src-tauri/src/dive/plan_router.rs");
const workspacePlanTest = read("src-tauri/tests/workspace_plan_ipc.rs");
const releaseSmoke = read("scripts/release-gate-smoke.mjs");
const releaseGate = read("../.github/workflows/release-gate.yml");

console.log("1. Package wiring and warning policy");
check(
  "package.json has verify:route-chat-cancel-quality",
  pkg.scripts?.["verify:route-chat-cancel-quality"] ===
    "node scripts/verify-route-chat-cancel-quality.mjs",
);
check(
  "Vite warning limit is not raised to hide chunks",
  !/chunkSizeWarningLimit\s*:/.test(viteConfig),
);
check(
  "Vite uses relative asset base for Tauri bundled app",
  /base\s*:\s*["']\.\/["']/.test(viteConfig),
);

console.log("\n2. Frontend exposes route-chat cancellation separately from streaming");
check("usePlanRouter creates route request ids", /routeRequestId|requestIdRef/.test(usePlanRouter));
check("usePlanRouter invokes route cancel IPC", /workspace_plan_route_cancel/.test(usePlanRouter));
check(
  "usePlanRouter tracks route cancel requested state",
  /routeCancelRequested|cancelRequested/.test(usePlanRouter) &&
    /setRouteCancelRequested|cancelRequested: true/.test(usePlanRouter),
);
check(
  "usePlanRouter separates append busy from route busy",
  /appendBusy/.test(usePlanRouter) && /routeBusy/.test(usePlanRouter),
);
check(
  "Product shell passes routing cancel state to ChatArea",
  /isRouting|routeStartedAt|routeCancelRequested|onCancelRouting/.test(controller),
);
check(
  "Product code panel opens current card changed files when available",
  /const currentFiles = currentCard \? roadmapModel\.changedFilesForStep\(currentCard\.id\) : \[\]/.test(
    controller,
  ) &&
    /files: currentFiles/.test(controller) &&
    /currentFiles\.length > 0\s*\?\s*null/.test(controller),
);
check(
  "ChatArea renders a routing running status",
  /chat-routing-status/.test(chatArea) && /chat-cancel-routing/.test(chatArea),
);
check(
  "ChatArea does not require chat streaming for routing cancel UI",
  /isRouting/.test(chatArea) && /routingLabel/.test(chatArea),
);
check("Korean route cancel copy exists", /라우팅 중 중지 요청됨/.test(ko) && /중지 요청/.test(ko));
check("English route cancel copy exists", /Routing stop requested/.test(en) && /Stop/.test(en));
check(
  "RC1 migration lazy fallback is visible for fresh WebView QA",
  /rc1-migration-fallback/.test(read("src/App.tsx")) &&
    /rc1-migration-fallback-confirm/.test(read("src/App.tsx")),
);
check(
  "RC1 migration storage access is guarded for Tauri WebView startup",
  /try\s*{[\s\S]{0,120}window\.localStorage[\s\S]{0,120}catch\s*{[\s\S]{0,80}return null/.test(
    rc1Migration,
  ),
);
check(
  "Startup render errors show a visible fallback instead of a blank WebView",
  /StartupErrorBoundary/.test(main) && /startup-error-boundary/.test(main),
);

console.log("\n3. Backend route-chat cancellation is route-specific");
check("AppState has route cancel registry", /route_cancels/.test(ipcState));
check(
  "route cancel command is registered",
  /workspace_plan_route_cancel/.test(tauriLib) && /workspace_plan_route_cancel/.test(workspacePlan),
);
check(
  "workspace_plan_route_chat accepts a route request id",
  /route_request_id|routeRequestId/.test(workspacePlan),
);
check(
  "workspace_plan_route_chat removes route cancel tokens",
  /route_cancels[\s\S]{0,300}remove/.test(workspacePlan),
);
check(
  "provider runtime hydrate wait is route-cancel selected",
  /ensure_provider_runtime\(\)[\s\S]{0,700}wait_for_route_cancel/.test(workspacePlan),
);
check(
  "plan router has cancel-aware decide function",
  /decide_cancelable/.test(planRouter) && /wait_for_route_cancel/.test(planRouter),
);
check(
  "route provider chat wait is cancel-selected",
  /provider\.chat\(req\)[\s\S]{0,700}wait_for_route_cancel/.test(planRouter),
);
check(
  "route stream next wait is cancel-selected",
  /stream\.next\(\)[\s\S]{0,700}wait_for_route_cancel/.test(planRouter),
);

console.log("\n4. Route-chat cancellation tests");
check(
  "workspace_plan_ipc has route provider response cancel test",
  /route_chat_cancel_while_waiting_for_provider_response/.test(workspacePlanTest),
);
check(
  "workspace_plan_ipc has route stream cancel test",
  /route_chat_cancel_while_waiting_for_stream_chunk/.test(workspacePlanTest),
);
check(
  "route cancel tests use workspace_plan_route_cancel",
  /workspace_plan_route_cancel_impl/.test(workspacePlanTest),
);

console.log("\n5. Windows NSIS validation remains explicit");
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

console.log("\n6. Production build output budget when dist exists");
const files = jsDistFiles();
if (files.length === 0) {
  check("dist build output present", false, "run pnpm build before final verification");
} else {
  const initial = files
    .filter((file) => /^index-.*\.js$/.test(file.name))
    .sort((a, b) => b.bytes - a.bytes)[0];
  check("initial app chunk exists", Boolean(initial));
  check(
    "initial app chunk is below 500KB",
    initial ? initial.bytes < 500 * 1024 : false,
    initial ? `${Math.round(initial.bytes / 1024)}KB` : "",
  );
}

console.log(`\nPASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
