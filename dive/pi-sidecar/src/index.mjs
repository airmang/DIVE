#!/usr/bin/env node
import readline from "node:readline";

import { getModel, Type } from "@earendil-works/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  defineTool,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const BUILTIN_DENYLIST = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const DEFAULT_DIVE_CONTEXT_TOOL = {
  name: "dive_context",
  description:
    "Ask DIVE for supervised context. This is the only tool in the Phase 2 sidecar smoke path.",
  parameters: Type.Object({
    request: Type.Optional(Type.String({ description: "Short context request" })),
  }),
};

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

const pendingToolResults = new Map();

function emit(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function redactError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Za-z0-9_-]{32,}/g, "[REDACTED]");
}

function makeNoDiscoveryResourceLoader() {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () =>
      "You are running inside DIVE. Only DIVE-owned custom tools are available. Be concise.",
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

function summarizeTools(session) {
  const tools = session?.agent?.state?.tools;
  if (!tools) return [];
  if (tools instanceof Map) return [...tools.keys()].sort();
  if (Array.isArray(tools)) return tools.map((tool) => tool.name ?? String(tool)).sort();
  return Object.keys(tools).sort();
}

function waitForToolResult(toolCallId, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      pendingToolResults.delete(toolCallId);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("tool execution aborted"));
    };
    pendingToolResults.set(toolCallId, (result) => {
      cleanup();
      resolve(result);
    });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeParameters(schema) {
  if (!schema || typeof schema !== "object") return Type.Object({});
  if (schema.$id || schema.type) return Type.Unsafe(schema);
  return Type.Object({});
}

function makeDiveTool(requestId, toolSpec) {
  const name = toolSpec.name;
  return defineTool({
    name,
    label: toolSpec.label ?? name,
    description: toolSpec.description ?? `DIVE supervised tool ${name}`,
    promptSnippet: `${name}: execute only through DIVE supervision.`,
    parameters: normalizeParameters(toolSpec.parameters),
    async execute(toolCallId, params, signal) {
      emit({
        type: "tool_call",
        request_id: requestId,
        tool_call_id: toolCallId,
        name,
        params,
      });
      const result = await waitForToolResult(toolCallId, signal);
      if (!result.success) {
        return {
          content: [{ type: "text", text: result.content || "DIVE tool call failed" }],
          details: result.details ?? { success: false },
          error: result.content || "DIVE tool call failed",
        };
      }
      return {
        content: [{ type: "text", text: result.content }],
        details: result.details ?? { success: true },
      };
    },
  });
}

function makeCustomTools(requestId, message) {
  const specs = Array.isArray(message.tools) ? message.tools : [DEFAULT_DIVE_CONTEXT_TOOL];
  return specs.map((spec) => makeDiveTool(requestId, spec));
}

async function handleRun(message) {
  const requestId = message.request_id ?? "run";
  let session;
  try {
    const authStorage = AuthStorage.create(message.auth_path);
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const model = getModel(message.provider ?? "openai-codex", message.model ?? "gpt-5.4-mini");
    if (!model) {
      throw new Error(`model not found: ${message.provider ?? "openai-codex"}/${message.model}`);
    }
    const cwd = message.cwd ?? process.cwd();
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0 },
    });

    const customTools = makeCustomTools(requestId, message);
    const created = await createAgentSession({
      cwd,
      agentDir: message.agent_dir ?? cwd,
      model,
      thinkingLevel: "off",
      authStorage,
      modelRegistry,
      resourceLoader: makeNoDiscoveryResourceLoader(),
      noTools: "builtin",
      excludeTools: BUILTIN_DENYLIST,
      customTools,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager,
    });
    session = created.session;

    const enabledTools = summarizeTools(session);
    emit({
      type: "ready",
      request_id: requestId,
      model: `${model.provider}/${model.id}`,
      enabled_tools: enabledTools,
    });

    let assistantText = "";
    session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        assistantText += event.assistantMessageEvent.delta;
        emit({
          type: "assistant_delta",
          request_id: requestId,
          delta: event.assistantMessageEvent.delta,
        });
      }
    });

    await session.prompt(message.prompt);
    emit({
      type: "turn_succeeded",
      request_id: requestId,
      assistant_text: assistantText,
    });
  } catch (error) {
    emit({
      type: "error",
      request_id: requestId,
      message: redactError(error),
    });
    process.exitCode = 1;
  } finally {
    session?.dispose();
  }
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    emit({ type: "error", message: `invalid JSON: ${redactError(error)}` });
    return;
  }

  if (message.type === "tool_result") {
    const resolve = pendingToolResults.get(message.tool_call_id);
    if (resolve) resolve(message);
    return;
  }

  if (message.type === "run") {
    handleRun(message).finally(() => {
      rl.close();
    });
    return;
  }

  emit({ type: "error", message: `unknown message type: ${message.type}` });
});
