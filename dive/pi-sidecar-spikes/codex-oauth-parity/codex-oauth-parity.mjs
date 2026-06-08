#!/usr/bin/env node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { chmodSync, existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { getModel } from "@earendil-works/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const REDACTED = "[REDACTED]";
const DEFAULT_MODEL = "gpt-5.4-mini";
const EXCLUDED_BUILTINS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

function parseArgs(argv) {
  const args = {
    model: process.env.DIVE_PI_CODEX_MODEL || DEFAULT_MODEL,
    prompt:
      process.env.DIVE_PI_CODEX_PROMPT ||
      "Reply with exactly this text and nothing else: DIVE_PI_OAUTH_PARITY_OK",
    providerConfigId: process.env.DIVE_CODEX_PROVIDER_CONFIG_ID,
    keepAuthFile: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--model") args.model = argv[++i];
    else if (arg === "--prompt") args.prompt = argv[++i];
    else if (arg === "--provider-config-id") args.providerConfigId = argv[++i];
    else if (arg === "--keep-auth-file") args.keepAuthFile = true;
    else if (arg === "--help") {
      console.log(`Usage:
  node codex-oauth-parity.mjs --provider-config-id <DIVE provider id> [--model gpt-5.4-mini]

Credential sources, in order:
  1. macOS keychain service DIVE accounts codex-access-token:<id>, codex-refresh-token:<id>, codex-id-token:<id>
  2. DIVE_CODEX_ACCESS_TOKEN, DIVE_CODEX_REFRESH_TOKEN, DIVE_CODEX_ID_TOKEN

The script redacts all token and account-id values, writes a temporary auth.json
outside the project tree with 0600 permissions, and removes it on exit unless
--keep-auth-file is passed.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readKeychainSecret(account) {
  const result = spawnSync(
    "security",
    ["find-generic-password", "-s", "DIVE", "-a", account, "-w"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) return undefined;
  const value = result.stdout.trim();
  return value.length > 0 ? value : undefined;
}

function loadCredentials(providerConfigId) {
  if (providerConfigId) {
    const access = readKeychainSecret(`codex-access-token:${providerConfigId}`);
    const refresh = readKeychainSecret(`codex-refresh-token:${providerConfigId}`);
    const id = readKeychainSecret(`codex-id-token:${providerConfigId}`);
    if (access && refresh) {
      return { source: "dive-keyring", access, refresh, idToken: id };
    }
  }

  if (process.env.DIVE_CODEX_ACCESS_TOKEN && process.env.DIVE_CODEX_REFRESH_TOKEN) {
    return {
      source: "env",
      access: process.env.DIVE_CODEX_ACCESS_TOKEN,
      refresh: process.env.DIVE_CODEX_REFRESH_TOKEN,
      idToken: process.env.DIVE_CODEX_ID_TOKEN,
    };
  }

  return null;
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function accountIdFromClaims(claims) {
  if (!claims || typeof claims !== "object") return undefined;
  const nested = claims["https://api.openai.com/auth"];
  if (nested && typeof nested.chatgpt_account_id === "string") return nested.chatgpt_account_id;
  for (const key of ["chatgpt_account_id", "account_id", "https://openai.com/chatgpt_account_id"]) {
    if (typeof claims[key] === "string") return claims[key];
  }
  return undefined;
}

function tokenExpiryMs(accessClaims) {
  const envExpiry = Number(process.env.DIVE_CODEX_EXPIRES_EPOCH_MS);
  if (Number.isFinite(envExpiry) && envExpiry > 0) return envExpiry;
  if (typeof accessClaims?.exp === "number") return accessClaims.exp * 1000;
  return Date.now() + 55 * 60 * 1000;
}

function makeNoDiscoveryResourceLoader() {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "You are a concise assistant running inside a DIVE parity spike.",
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const credentials = loadCredentials(args.providerConfigId);
  if (!credentials) {
    console.error("BLOCKED_NO_DIVE_CODEX_TOKENS: no DIVE Codex OAuth credentials were found.");
    console.error(
      "Checked DIVE keyring provider_config_id and env fallback; no raw secrets were printed.",
    );
    process.exit(2);
  }

  const accessClaims = decodeJwtPayload(credentials.access);
  const idClaims = credentials.idToken ? decodeJwtPayload(credentials.idToken) : null;
  const accessAccountId = accountIdFromClaims(accessClaims);
  const idAccountId = accountIdFromClaims(idClaims);
  const accountId = accessAccountId || idAccountId;

  if (!accountId) {
    console.error(
      "BLOCKED_ACCOUNT_ID: neither access token nor id token exposed a ChatGPT account id claim.",
    );
    process.exit(3);
  }
  if (!accessAccountId) {
    console.error(
      "BLOCKED_PI_ACCOUNT_ID_EXTRACTION: Pi extracts ChatGPT account id from the access token.",
    );
    console.error(
      "DIVE can decode it from id_token, but Pi 0.78.0 has no public account-id injection hook.",
    );
    process.exit(4);
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "dive-pi-codex-oauth-"));
  const authPath = path.join(tmpDir, "auth.json");
  const agentDir = path.join(tmpDir, "agent");
  const cwd = path.join(tmpDir, "cwd");
  let session;

  try {
    const authJson = {
      "openai-codex": {
        type: "oauth",
        access: credentials.access,
        refresh: credentials.refresh,
        expires: tokenExpiryMs(accessClaims),
        accountId,
      },
    };
    await writeFile(authPath, `${JSON.stringify(authJson, null, 2)}\n`, { mode: 0o600 });
    chmodSync(authPath, 0o600);
    await mkdir(agentDir, { recursive: true, mode: 0o700 });
    await mkdir(cwd, { recursive: true, mode: 0o700 });

    const mode = (statSync(authPath).mode & 0o777).toString(8);
    const authStorage = AuthStorage.create(authPath);
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const model = getModel("openai-codex", args.model);
    if (!model) throw new Error(`Pi model not found: openai-codex/${args.model}`);

    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false, maxRetries: 0 },
    });

    console.log(
      JSON.stringify({
        event: "auth_seeded",
        authPath: args.keepAuthFile ? authPath : "[temp-auth-json]",
        mode,
        provider: "openai-codex",
        credentialShape: ["type", "access", "refresh", "expires", "accountId"],
        credentialSource: credentials.source,
        accessToken: REDACTED,
        refreshToken: REDACTED,
        accountId: REDACTED,
      }),
    );

    const created = await createAgentSession({
      cwd,
      agentDir,
      model,
      thinkingLevel: "off",
      authStorage,
      modelRegistry,
      resourceLoader: makeNoDiscoveryResourceLoader(),
      noTools: "builtin",
      excludeTools: EXCLUDED_BUILTINS,
      customTools: [],
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager,
    });
    session = created.session;

    const enabledTools = summarizeTools(session);
    console.log(
      JSON.stringify({
        event: "session_created",
        model: `openai-codex/${args.model}`,
        enabledTools,
      }),
    );

    let assistantText = "";
    session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        assistantText += event.assistantMessageEvent.delta;
      }
    });

    await session.prompt(args.prompt);
    if (assistantText.trim().length === 0) {
      throw new Error(
        "Pi prompt completed without assistant text; not counted as a successful model turn",
      );
    }
    console.log(
      JSON.stringify({
        event: "turn_succeeded",
        model: `openai-codex/${args.model}`,
        assistantTextPreview: assistantText.slice(0, 500),
        assistantTextLength: assistantText.length,
      }),
    );
  } finally {
    if (session) session.dispose();
    if (!args.keepAuthFile && existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true });
    } else {
      console.error(`Kept temp auth directory for inspection: ${tmpDir}`);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      event: "spike_failed",
      message: message.replace(/[A-Za-z0-9_-]{32,}/g, REDACTED),
    }),
  );
  process.exit(1);
});
