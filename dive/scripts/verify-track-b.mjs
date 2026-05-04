#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

const checks = [
  {
    name: "Cargo.toml has tauri-plugin-dialog",
    path: "dive/src-tauri/Cargo.toml",
    pattern: /tauri-plugin-dialog\s*=\s*"2"/,
  },
  {
    name: "lib.rs registers dialog plugin",
    path: "dive/src-tauri/src/lib.rs",
    pattern: /\.plugin\(tauri_plugin_dialog::init\(\)\)/,
  },
  {
    name: "capabilities grants dialog:allow-open",
    path: "dive/src-tauri/capabilities/default.json",
    pattern: /"dialog:allow-open"/,
  },
  {
    name: "capabilities does not grant unused dialog permissions",
    path: "dive/src-tauri/capabilities/default.json",
    pattern: /^(?![\s\S]*"dialog:allow-(?:save|ask|confirm|message)")/,
  },
  {
    name: "package.json has @tauri-apps/plugin-dialog",
    path: "dive/package.json",
    pattern: /"@tauri-apps\/plugin-dialog"/,
  },
  {
    name: "pnpm-lock.yaml has @tauri-apps/plugin-dialog",
    path: "dive/pnpm-lock.yaml",
    pattern: /@tauri-apps\/plugin-dialog/,
  },
  {
    name: "tauri-dialog.ts exists",
    path: "dive/src/lib/tauri-dialog.ts",
    exists: true,
  },
  {
    name: "NewProjectDialog has np-browse button",
    path: "dive/src/components/onboarding/NewProjectDialog.tsx",
    pattern: /data-testid="np-browse"/,
  },
  {
    name: "NewProjectDialog imports pickFolder",
    path: "dive/src/components/onboarding/NewProjectDialog.tsx",
    pattern: /pickFolder/,
  },
  {
    name: "NewProjectDialog keeps manual path input",
    path: "dive/src/components/onboarding/NewProjectDialog.tsx",
    pattern: /onChange=\{\(e\) => setPath\(e\.target\.value\)\}/,
  },
];

let failed = 0;
for (const check of checks) {
  const absPath = resolve(repoRoot, check.path);
  if (!existsSync(absPath)) {
    console.error(`[FAIL] ${check.name}: file missing (${check.path})`);
    failed++;
    continue;
  }
  if (check.exists && !check.pattern) {
    console.log(`[OK] ${check.name}`);
    continue;
  }
  const content = readFileSync(absPath, "utf8");
  if (!check.pattern.test(content)) {
    console.error(`[FAIL] ${check.name}: pattern not found in ${check.path}`);
    failed++;
  } else {
    console.log(`[OK] ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\n[OK] Track B 검증 통과");
