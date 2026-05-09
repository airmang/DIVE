#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const repoPath = (path) => resolve(repoRoot, path);
let failed = 0;

function checkFile(path, name) {
  if (!existsSync(repoPath(path))) {
    console.error(`[FAIL] ${name} missing: ${path}`);
    failed++;
  } else {
    console.log(`[OK] ${name} present`);
  }
}

checkFile("dive/src/stores/ui-preferences.ts", "ui-preferences store");
checkFile("dive/src/components/ui/learning-hint.tsx", "LearningHint component");

const settings = readFileSync(repoPath("dive/src/pages/settings.tsx"), "utf8");
if (!/data-testid="settings-tutorial-toggle"/.test(settings)) {
  console.error("[FAIL] Settings missing tutorial toggle");
  failed++;
} else {
  console.log("[OK] Settings has tutorial toggle");
}

const menu = readFileSync(repoPath("dive/src-tauri/src/menu.rs"), "utf8");
if (!/menu:help-tutorial/.test(menu)) {
  console.error("[FAIL] Native Help menu missing tutorial toggle item");
  failed++;
} else {
  console.log("[OK] Native Help menu has tutorial toggle item");
}

const productShellController = readFileSync(
  repoPath("dive/src/components/product/useProductShellController.ts"),
  "utf8",
);
if (
  !/menu:help-tutorial/.test(productShellController) ||
  !/setTutorialEnabled/.test(productShellController)
) {
  console.error("[FAIL] Product shell controller missing help tutorial handler");
  failed++;
} else {
  console.log("[OK] Product shell controller handles help tutorial menu event");
}

const grepOutput = execSync("grep -RIn --include='*.tsx' '<LearningHint' dive/src || true", {
  cwd: repoRoot,
  encoding: "utf8",
});
const hintCount = grepOutput.split("\n").filter((line) => line.trim()).length;
if (hintCount < 10) {
  console.error(`[FAIL] LearningHint used only ${hintCount} times (expected >=10)`);
  failed++;
} else {
  console.log(`[OK] LearningHint used ${hintCount} times`);
}

const forbiddenGrep = execSync(
  "grep -RIn --include='*.tsx' --include='*.ts' -E '학생|선생님|교사' " +
    "dive/src/components dive/src/hooks dive/src/stores dive/src/lib dive/src/pages/settings.tsx || true",
  { cwd: repoRoot, encoding: "utf8" },
);
if (forbiddenGrep.trim()) {
  console.error("[FAIL] Student/teacher terminology still present:\n" + forbiddenGrep);
  failed++;
} else {
  console.log("[OK] No student/teacher terminology in product code");
}

const forbiddenSafetyGates = [
  ["dive/src/components/permission-card/DangerCard.tsx", "Danger card"],
  ["dive/src/components/chat/ToolCallMessage.tsx", "Tool call warning"],
  ["dive/src/components/slide-in/RestoreConfirmDialog.tsx", "Restore warning"],
  ["dive/src/components/permission-card/DiffViewer.tsx", "Diff truncation notice"],
];
for (const [path, name] of forbiddenSafetyGates) {
  const content = readFileSync(repoPath(path), "utf8");
  if (/<LearningHint/.test(content)) {
    console.error(`[FAIL] ${name} must not be hidden behind LearningHint (${path})`);
    failed++;
  } else {
    console.log(`[OK] ${name} not gated`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\n[OK] Track E 검증 통과");
