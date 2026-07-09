#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const repoPath = (path) => resolve(repoRoot, path);

const checks = [
  {
    name: "DAO has read_selected_model",
    path: "dive/src-tauri/src/db/dao/provider_config.rs",
    pattern: /pub fn read_selected_model/,
  },
  {
    name: "DAO has write_selected_model",
    path: "dive/src-tauri/src/db/dao/provider_config.rs",
    pattern: /pub fn write_selected_model/,
  },
  {
    name: "IPC has provider_list_models",
    path: "dive/src-tauri/src/ipc/provider.rs",
    pattern: /pub async fn provider_list_models/,
  },
  {
    name: "IPC has provider_set_model",
    path: "dive/src-tauri/src/ipc/provider.rs",
    pattern: /pub async fn provider_set_model/,
  },
  {
    name: "lib.rs registers provider_list_models",
    path: "dive/src-tauri/src/lib.rs",
    pattern: /ipc::provider_list_models/,
  },
  {
    name: "lib.rs registers provider_set_model",
    path: "dive/src-tauri/src/lib.rs",
    pattern: /ipc::provider_set_model/,
  },
  {
    name: "factory uses a current Claude default (>= 4)",
    path: "dive/src-tauri/src/providers/factory.rs",
    pattern: /claude-(opus|sonnet|haiku)-[4-9]/,
  },
  {
    name: "factory uses updated OpenAI GPT-5.x default",
    path: "dive/src-tauri/src/providers/factory.rs",
    pattern: /gpt-5\.\d/,
  },
  {
    name: "Anthropic static list includes Opus 4.7",
    path: "dive/src-tauri/src/providers/anthropic/mod.rs",
    pattern: /claude-opus-4-7/,
  },
  {
    name: "OpenAI static list includes GPT-5.5",
    path: "dive/src-tauri/src/providers/openai/mod.rs",
    pattern: /gpt-5\.5/,
  },
  {
    name: "ProviderModelSelector exists",
    path: "dive/src/components/settings/ProviderModelSelector.tsx",
    exists: true,
  },
  {
    name: "settings.tsx uses ProviderModelSelector",
    path: "dive/src/pages/settings.tsx",
    pattern: /ProviderModelSelector/,
  },
  {
    name: "ChatInput default label has no concrete model ID",
    path: "dive/src/components/chat/ChatInput.tsx",
    pattern: /model_select_default_label/,
  },
  {
    name: "No legacy claude-sonnet-4.5 in factory",
    path: "dive/src-tauri/src/providers/factory.rs",
    pattern: /claude-sonnet-4\.5/,
    negate: true,
  },
];

let failed = 0;
for (const check of checks) {
  if (!existsSync(repoPath(check.path))) {
    console.error(`[FAIL] ${check.name}: ${check.path} missing`);
    failed++;
    continue;
  }
  if (check.exists) {
    console.log(`[OK] ${check.name}`);
    continue;
  }
  const content = readFileSync(repoPath(check.path), "utf8");
  const matches = check.pattern.test(content);
  if (check.negate ? matches : !matches) {
    console.error(`[FAIL] ${check.name}`);
    failed++;
  } else {
    console.log(`[OK] ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\n[OK] Track G 검증 통과");
