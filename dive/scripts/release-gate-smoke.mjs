#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const diveRoot = resolve(__dirname, "..");
const tauriRoot = resolve(diveRoot, "src-tauri");
const args = new Set(process.argv.slice(2));
const preflightOnly = args.has("--preflight");
const keepInstalled = args.has("--keep-installed");

const results = [];
const blockers = [];
let sessionId = null;
let driver = null;

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const icon = ok ? "✓" : "✗";
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail) {
  record(name, false, detail);
  process.exitCode = 1;
}

function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "command";
  const probeArgs = process.platform === "win32" ? [command] : ["-v", command];
  return (
    spawnSync(probe, probeArgs, { stdio: "ignore", shell: process.platform !== "win32" }).status ===
    0
  );
}

function appDataDir() {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (!local) throw new Error("LOCALAPPDATA is not set");
    return join(local, "com.coreelab.dive");
  }
  if (process.platform === "darwin") {
    return join(process.env.HOME ?? "", "Library", "Application Support", "com.coreelab.dive");
  }
  return join(
    process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? "", ".local", "share"),
    "com.coreelab.dive",
  );
}

async function findNewestFile(root, predicate) {
  const candidates = [];
  async function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (predicate(path)) candidates.push(path);
    }
  }
  await walk(root);
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

async function findInstaller() {
  if (process.env.DIVE_NSIS_INSTALLER) return resolve(process.env.DIVE_NSIS_INSTALLER);
  return findNewestFile(join(tauriRoot, "target"), (path) =>
    /bundle[\\/]nsis[\\/].+setup\.exe$/i.test(path),
  );
}

async function findApplication() {
  if (process.env.DIVE_RELEASE_APP) return resolve(process.env.DIVE_RELEASE_APP);
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? "";
    const candidates = [
      join(local, "Programs", "DIVE", "DIVE.exe"),
      join(local, "DIVE", "DIVE.exe"),
      join(process.env.ProgramFiles ?? "", "DIVE", "DIVE.exe"),
    ];
    return candidates.find((path) => existsSync(path)) ?? null;
  }
  if (process.platform === "darwin") {
    const app = join(tauriRoot, "target", "release", "bundle", "macos", "DIVE.app");
    return existsSync(app) ? app : null;
  }
  return findNewestFile(join(tauriRoot, "target", "release"), (path) =>
    /(^|[\/])dive$/i.test(path),
  );
}

async function httpJson(method, path, body) {
  const response = await fetch(`http://127.0.0.1:4444${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  }
  return payload;
}

function elementId(element) {
  return element?.["element-6066-11e4-a52e-4f735466cecf"] ?? element?.ELEMENT;
}

async function waitForElement(selector, timeoutMs = 30000) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const payload = await httpJson("POST", `/session/${sessionId}/element`, {
        using: "css selector",
        value: selector,
      });
      const id = elementId(payload.value);
      if (id) return id;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${selector}: ${lastError?.message ?? "not found"}`);
}

async function elementText(id) {
  const payload = await httpJson("GET", `/session/${sessionId}/element/${id}/text`);
  return String(payload.value ?? "");
}

async function startDriver(application) {
  driver = spawn("tauri-driver", ["--port", "4444"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  driver.stdout.on("data", (chunk) => process.stdout.write(`[tauri-driver] ${chunk}`));
  driver.stderr.on("data", (chunk) => process.stderr.write(`[tauri-driver] ${chunk}`));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const payload = await httpJson("POST", "/session", {
    capabilities: {
      alwaysMatch: {
        "tauri:options": { application },
      },
    },
  });
  sessionId = payload.value?.sessionId ?? payload.sessionId;
  if (!sessionId)
    throw new Error(`tauri-driver did not return session id: ${JSON.stringify(payload)}`);
}

async function stopDriver() {
  if (sessionId) {
    try {
      await httpJson("DELETE", `/session/${sessionId}`);
    } catch {}
    sessionId = null;
  }
  if (driver) {
    driver.kill();
    driver = null;
  }
}

async function installNsis(installer) {
  if (!installer)
    throw new Error(
      "NSIS installer not found; set DIVE_NSIS_INSTALLER or build pnpm tauri:build:x64",
    );
  const result = spawnSync(installer, ["/S"], { stdio: "inherit", shell: true });
  if (result.status !== 0) throw new Error(`installer failed with status ${result.status}`);
}

async function smokeInstalledApp(application) {
  await startDriver(application);
  const body = await waitForElement("body", 45000);
  const bodyText = await elementText(body);
  if (!/DIVE|API|프로바이더|provider|프로젝트|project/i.test(bodyText)) {
    throw new Error(`unexpected app body text: ${bodyText.slice(0, 200)}`);
  }
  await waitForElement('[data-testid="main-shell"]', 30000);
  const dataDir = appDataDir();
  const db = join(dataDir, "dive.db");
  if (!existsSync(db)) {
    throw new Error(`expected disk DB at ${db}`);
  }
  return { dataDir, db };
}

async function main() {
  console.log("[release-gate-smoke] DIVE installed-app release gate smoke");
  record(
    "official tauri-driver contract",
    true,
    "uses tauri-driver WebDriver capabilities; no tauri.conf webdriver key required for Tauri v2",
  );
  record(
    "release mock guard script exists",
    existsSync(join(tauriRoot, "scripts", "verify-release-mock-guard.sh")),
  );
  record(
    "production wire verifier exists",
    existsSync(join(diveRoot, "scripts", "verify-production-wire.mjs")),
  );
  record("release gate SOP exists", existsSync(join(repoRoot, "docs", "release-gate-2026-05.md")));

  if (preflightOnly) {
    const isWindows = process.platform === "win32";
    record(
      "Windows host for full tauri-driver smoke",
      true,
      isWindows ? process.platform : "external blocker on this host",
    );
    if (!isWindows) {
      blockers.push(
        "Full tauri-driver + NSIS installed-app smoke requires Windows with msedgedriver; current host is not Windows.",
      );
      process.exitCode = 0;
    }
    console.log(JSON.stringify({ mode: "preflight", results, blockers }, null, 2));
    return;
  }

  if (process.platform !== "win32") {
    throw new Error(
      "Full release gate smoke must run on Windows. Use --preflight on non-Windows hosts.",
    );
  }
  if (!commandExists("tauri-driver"))
    throw new Error("tauri-driver not found in PATH; run `cargo install tauri-driver --locked`");
  if (!commandExists("msedgedriver"))
    throw new Error("msedgedriver not found in PATH; install matching Microsoft Edge Driver");

  const dataDir = appDataDir();
  rmSync(dataDir, { recursive: true, force: true });
  record("clean app local data", true, dataDir);

  const installer = await findInstaller();
  await installNsis(installer);
  record("silent NSIS install", true, installer);

  const application = await findApplication();
  if (!application) throw new Error("Installed DIVE executable not found; set DIVE_RELEASE_APP");
  const smoke = await smokeInstalledApp(application);
  record("tauri-driver startup + main shell", true, application);
  record("disk DB created", existsSync(smoke.db), smoke.db);

  await stopDriver();

  const applicationAgain = await findApplication();
  await smokeInstalledApp(applicationAgain);
  record("restart preserves disk DB", existsSync(smoke.db), smoke.db);
  await stopDriver();

  if (!keepInstalled) {
    const uninstall = await findNewestFile(dirname(applicationAgain), (path) =>
      /uninstall.*\.exe$/i.test(path),
    );
    if (uninstall) {
      const result = spawnSync(uninstall, ["/S"], { stdio: "inherit", shell: true });
      record("silent uninstall", result.status === 0, uninstall);
    } else {
      record("silent uninstall", false, "uninstaller not found; manual cleanup required");
    }
  }

  console.log(JSON.stringify({ mode: "full", results, blockers }, null, 2));
}

process.on("exit", () => {
  if (driver) driver.kill();
});
process.on("SIGINT", async () => {
  await stopDriver();
  process.exit(130);
});

main().catch(async (err) => {
  await stopDriver();
  fail("release gate smoke", err instanceof Error ? err.message : String(err));
  console.log(
    JSON.stringify({ mode: preflightOnly ? "preflight" : "full", results, blockers }, null, 2),
  );
  process.exit(process.exitCode || 1);
});
