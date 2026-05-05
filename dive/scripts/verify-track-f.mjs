#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
let failed = 0;

function read(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

const app = read("dive/src/App.tsx");
if (/^import\s+DemoShell\s+from/m.test(app)) {
  console.error("[FAIL] App.tsx still has static DemoShell import");
  failed++;
} else {
  console.log("[OK] App.tsx has no static DemoShell import");
}

if (!/import\.meta\.env\.DEV/.test(app)) {
  console.error("[FAIL] App.tsx missing import.meta.env.DEV guard");
  failed++;
} else {
  console.log("[OK] App.tsx uses import.meta.env.DEV");
}

const productImportsDemoRoutes = execSync(
  "grep -RIn \"demo-routes\" src --include='*.tsx' --include='*.ts' || true",
  { cwd: resolve(repoRoot, "dive"), encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .filter((line) => !line.includes("src/components/demo/"));
if (productImportsDemoRoutes.length > 0) {
  console.error("[FAIL] Product-side code imports demo-routes:");
  for (const line of productImportsDemoRoutes) console.error(`  ${line}`);
  failed += productImportsDemoRoutes.length;
} else {
  console.log("[OK] Product-side code does not import demo-routes");
}

console.log("\n[BUILD] Running production build...");
try {
  execSync("pnpm build", { cwd: resolve(repoRoot, "dive"), stdio: "inherit" });
} catch {
  console.error("[FAIL] pnpm build failed");
  process.exit(1);
}

const distAssets = resolve(repoRoot, "dive/dist/assets");
if (!existsSync(distAssets)) {
  console.error("[FAIL] dist/assets not found after build");
  process.exit(1);
}

const forbidden = [
  "scenario-a-demo",
  "scenario-b-demo",
  "workmap-demo",
  "chat-demo",
  "polish-demo",
  "mcp-demo",
  "export-demo",
  "provisioning-demo",
  "slide-in-demo",
  "timeline-demo",
  "toast-demo",
  "tool-guard-demo",
  "permission-demo",
  "phase5-integration",
];

const jsFiles = readdirSync(distAssets).filter((file) => file.endsWith(".js"));
let bundleViolations = 0;
for (const jsFile of jsFiles) {
  const content = readFileSync(join(distAssets, jsFile), "utf8");
  for (const pattern of forbidden) {
    if (content.includes(pattern)) {
      console.error(`[FAIL] Production bundle ${jsFile} contains "${pattern}"`);
      bundleViolations++;
    }
  }
}

if (bundleViolations === 0) {
  console.log("[OK] Production bundle free of demo page identifiers");
} else {
  failed += bundleViolations;
}

const totalSize = jsFiles.reduce((acc, file) => acc + statSync(join(distAssets, file)).size, 0);
console.log(`[INFO] Total production JS bundle: ${(totalSize / 1024).toFixed(1)} KB`);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\n[OK] Track F 검증 통과");
