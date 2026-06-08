#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getModel } from "@earendil-works/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import {
  BUILTIN_DENYLIST,
  makeCustomTools,
  makeNoDiscoveryResourceLoader,
  summarizeTools,
} from "./src/index.mjs";

const DIVE_TOOLS = [
  "delete_file",
  "edit_file",
  "list_dir",
  "mkdir",
  "read_file",
  "run_process",
  "search_files",
  "write_file",
];

const FORBIDDEN_TOOLS = [
  ...BUILTIN_DENYLIST,
  "extension_read",
  "extension_write",
  "resource_loader_tool",
  "unknown_tool",
];

function diveToolSpec(name) {
  return {
    name,
    description: `DIVE supervised tool ${name}`,
    parameters: {
      type: "object",
      properties: {},
    },
  };
}

function seedDiscoveryDecoys(root) {
  const decoys = [
    [".pi/extensions/extension_read.json", '{"name":"extension_read"}'],
    [".agents/resource-loader-tool.md", "tool: resource_loader_tool"],
    ["prompts/unknown-tool.md", "Use unknown_tool"],
    ["skills/extension-write/SKILL.md", "Registers extension_write"],
    [".pi/settings.json", '{"tools":["bash","read","extension_read"]}'],
  ];
  for (const [relative, content] of decoys) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dive-pi-sidecar-builtins-"));
const agentDir = path.join(cwd, "agent");
fs.mkdirSync(agentDir, { recursive: true });
seedDiscoveryDecoys(cwd);

const authStorage = AuthStorage.inMemory();
const modelRegistry = ModelRegistry.inMemory(authStorage);
const model = getModel("openai-codex", "gpt-5.4-mini");
assert.ok(model, "openai-codex/gpt-5.4-mini must be registered");

const created = await createAgentSession({
  cwd,
  agentDir,
  model,
  thinkingLevel: "off",
  authStorage,
  modelRegistry,
  resourceLoader: makeNoDiscoveryResourceLoader(),
  noTools: "builtin",
  excludeTools: BUILTIN_DENYLIST,
  customTools: makeCustomTools("builtins-absent", {
    tools: DIVE_TOOLS.map(diveToolSpec),
  }),
  sessionManager: SessionManager.inMemory(cwd),
  settingsManager: SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false, maxRetries: 0 },
  }),
});

let interviewSession;
try {
  const enabledTools = summarizeTools(created.session);
  assert.deepEqual(enabledTools, DIVE_TOOLS);
  for (const forbidden of FORBIDDEN_TOOLS) {
    assert.equal(
      enabledTools.includes(forbidden),
      false,
      `forbidden tool leaked into Pi session: ${forbidden}`,
    );
  }
  console.log(`builtins-absent ok: ${enabledTools.join(",")}`);

  // Interview-mode turns send an explicit empty `tools` array and must enable zero
  // tools — NOT the smoke `dive_context` fallback. Regression guard for the strict
  // enabled-tools parity check in src-tauri/src/pi_sidecar.rs.
  const interview = await createAgentSession({
    cwd,
    agentDir,
    model,
    thinkingLevel: "off",
    authStorage,
    modelRegistry,
    resourceLoader: makeNoDiscoveryResourceLoader(),
    noTools: "builtin",
    excludeTools: BUILTIN_DENYLIST,
    customTools: makeCustomTools("interview-empty-tools", { tools: [] }),
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0 },
    }),
  });
  interviewSession = interview.session;
  const interviewTools = summarizeTools(interview.session);
  assert.deepEqual(interviewTools, [], "interview-mode turn must enable zero tools");
  assert.equal(
    interviewTools.includes("dive_context"),
    false,
    "dive_context smoke fallback must not leak into an explicit empty-tools turn",
  );
  console.log("interview-empty-tools ok: []");
} finally {
  created.session?.dispose();
  interviewSession?.dispose();
  fs.rmSync(cwd, { recursive: true, force: true });
}
