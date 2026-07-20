#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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

function sourceFilesUnder(path, extensions) {
  const root = repoPath(path);
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) {
    return extensions.some((extension) => root.endsWith(extension)) ? [root] : [];
  }
  const files = [];
  for (const entry of readdirSync(root)) {
    const child = join(root, entry);
    const stats = statSync(child);
    if (stats.isDirectory()) {
      files.push(...sourceFilesUnder(relative(repoRoot, child), extensions));
    } else if (extensions.some((extension) => child.endsWith(extension))) {
      files.push(child);
    }
  }
  return files;
}

function sourceMatches(paths, extensions, pattern) {
  const matches = [];
  for (const path of paths) {
    for (const file of sourceFilesUnder(path, extensions)) {
      const rel = relative(repoRoot, file).replaceAll("\\", "/");
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (pattern.test(line)) matches.push(`${rel}:${index + 1}:${line}`);
        });
    }
  }
  return matches;
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

// S-068 split: the controller composes useShellMenus(), which owns native menu
// event handling including the help-tutorial toggle.
const productShellController = readFileSync(
  repoPath("dive/src/components/product/useShellMenus.ts"),
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

const hintCount = sourceMatches(["dive/src"], [".tsx"], /<LearningHint/).length;
if (hintCount < 10) {
  console.error(`[FAIL] LearningHint used only ${hintCount} times (expected >=10)`);
  failed++;
} else {
  console.log(`[OK] LearningHint used ${hintCount} times`);
}

const forbiddenTerminology = sourceMatches(
  [
    "dive/src/components",
    "dive/src/hooks",
    "dive/src/stores",
    "dive/src/lib",
    "dive/src/pages/settings.tsx",
  ],
  [".tsx", ".ts"],
  /\uD559\uC0DD|\uC120\uC0DD\uB2D8|\uAD50\uC0AC/,
);
if (forbiddenTerminology.length > 0) {
  console.error(
    "[FAIL] Student/teacher terminology still present:\n" + forbiddenTerminology.join("\n"),
  );
  failed++;
} else {
  console.log("[OK] No student/teacher terminology in product code");
}

const forbiddenSafetyGates = [
  ["dive/src/components/permission-card/DangerCard.tsx", "Danger card"],
  ["dive/src/components/chat/ToolActivity.tsx", "Tool call warning"],
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
console.log("\n[OK] Track E verification passed");
