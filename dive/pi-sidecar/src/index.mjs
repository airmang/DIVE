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

export const BUILTIN_DENYLIST = ["read", "bash", "edit", "write", "grep", "find", "ls"];
export const DEFAULT_DIVE_CONTEXT_TOOL = {
  name: "dive_context",
  description:
    "Ask DIVE for supervised context. This is the only tool in the Phase 2 sidecar smoke path.",
  parameters: Type.Object({
    request: Type.Optional(Type.String({ description: "Short context request" })),
  }),
};

const pendingToolResults = new Map();
const HEARTBEAT_INTERVAL_MS = 5000;
let activeRun = null;

export function emit(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

export async function withHeartbeat(requestId, phase, operation) {
  const interval = setInterval(() => {
    emit({
      type: "heartbeat",
      request_id: requestId,
      turn_id: requestId,
      phase,
      ts: Date.now(),
    });
  }, HEARTBEAT_INTERVAL_MS);
  interval.unref?.();
  try {
    return await operation();
  } finally {
    clearInterval(interval);
  }
}

export function redactError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Za-z0-9_-]{32,}/g, "[REDACTED]");
}

export function makeNoDiscoveryResourceLoader() {
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

export function summarizeTools(session) {
  const tools = session?.agent?.state?.tools;
  if (!tools) return [];
  if (tools instanceof Map) return [...tools.keys()].sort();
  if (Array.isArray(tools)) return tools.map((tool) => tool.name ?? String(tool)).sort();
  return Object.keys(tools).sort();
}

export function waitForToolResult(toolCallId, signal) {
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

export function normalizeParameters(schema) {
  if (!schema || typeof schema !== "object") return Type.Object({});
  if (schema.$id || schema.type) return Type.Unsafe(schema);
  return Type.Object({});
}

export function makeDiveTool(requestId, toolSpec) {
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
      const result = await withHeartbeat(requestId, "tool_wait", () =>
        waitForToolResult(toolCallId, signal),
      );
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

export function makeCustomTools(requestId, message) {
  // An explicit `tools` array is used as-is — including `[]` for interview-mode turns,
  // which must enable zero tools. The `dive_context` fallback applies ONLY when `tools`
  // is absent, which is reserved for the Phase 2 smoke path; production run messages
  // always send an explicit array (see build_run_message in src-tauri/src/pi_sidecar.rs).
  const specs = Array.isArray(message.tools) ? message.tools : [DEFAULT_DIVE_CONTEXT_TOOL];
  return specs.map((spec) => makeDiveTool(requestId, spec));
}

export async function handleRun(message) {
  const requestId = message.request_id ?? "run";
  let session;
  const runState = {
    requestId,
    session: null,
  };
  activeRun = runState;
  try {
    const provider = message.provider ?? "openai-codex";
    const modelId = message.model ?? "gpt-5.4-mini";
    const authStorage = message.auth_path
      ? AuthStorage.create(message.auth_path)
      : AuthStorage.inMemory();
    if (typeof message.api_key === "string" && message.api_key.length > 0) {
      authStorage.setRuntimeApiKey(provider, message.api_key);
    }
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const model = getModel(provider, modelId);
    if (!model) {
      throw new Error(`model not found: ${provider}/${modelId}`);
    }
    const cwd = message.cwd ?? process.cwd();
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: {
        enabled: true,
        maxRetries: 3,
        baseDelayMs: 1000,
        provider: {
          maxRetries: 3,
          maxRetryDelayMs: 10000,
        },
      },
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
    runState.session = session;

    const enabledTools = summarizeTools(session);
    emit({
      type: "ready",
      request_id: requestId,
      model: `${model.provider}/${model.id}`,
      enabled_tools: enabledTools,
    });

    let assistantText = "";
    session.subscribe((event) => {
      const assistantEvent = event.assistantMessageEvent;
      if (event.type !== "message_update" || !assistantEvent) {
        return;
      }
      if (assistantEvent.type === "text_delta") {
        assistantText += assistantEvent.delta;
        emit({
          type: "assistant_delta",
          request_id: requestId,
          delta: assistantEvent.delta,
        });
      } else if (assistantEvent.type === "thinking_delta") {
        emit({
          type: "reasoning_delta",
          request_id: requestId,
          delta: assistantEvent.delta,
        });
      }
    });

    await withHeartbeat(requestId, "model_wait", () => session.prompt(message.prompt));
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
    if (activeRun === runState) {
      activeRun = null;
    }
    session?.dispose();
  }
}

export async function handleTurnCancel(message) {
  const run = activeRun;
  if (!run) return;
  if (message.request_id && message.request_id !== run.requestId) return;
  if (typeof run.session?.abort === "function") {
    await run.session.abort();
  }
  run.session?.dispose();
}

export function startProtocol(input = process.stdin) {
  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });

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

    if (message.type === "turn_cancel") {
      handleTurnCancel(message).catch((error) => {
        emit({ type: "error", message: `cancel failed: ${redactError(error)}` });
      });
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

  return rl;
}
