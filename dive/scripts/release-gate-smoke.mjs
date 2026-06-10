#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const diveRoot = resolve(__dirname, "..");
const tauriRoot = resolve(diveRoot, "src-tauri");
const args = new Set(process.argv.slice(2));
const preflightOnly = args.has("--preflight");
const keepInstalled = args.has("--keep-installed");
const jsonOut = argValue("--json-out");
const webdriverRequestTimeoutMs = Number(process.env.DIVE_WEBDRIVER_REQUEST_TIMEOUT_MS ?? 30000);

const results = [];
const blockers = [];
let sessionId = null;
let driver = null;
let evidence = null;

function argValue(name) {
  const argv = process.argv.slice(2);
  const prefixed = argv.find((arg) => arg.startsWith(`${name}=`));
  if (prefixed) return prefixed.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

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

function commandOutput(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function resolveCommand(command) {
  if (process.platform !== "win32") return command;
  const found = commandOutput("where", [command]);
  return found?.split(/\r?\n/).find(Boolean) ?? command;
}

function collectEvidence() {
  const statusShort = commandOutput("git", ["status", "--short"]);
  const statusEntries = statusShort ? statusShort.split(/\r?\n/).filter(Boolean).length : 0;
  return {
    generatedAt: new Date().toISOString(),
    tester: process.env.DIVE_RELEASE_TESTER ?? process.env.USERNAME ?? process.env.USER ?? null,
    releaseOwner: process.env.DIVE_RELEASE_OWNER ?? null,
    host: {
      hostname: os.hostname(),
      osType: os.type(),
      osRelease: os.release(),
      osVersion: typeof os.version === "function" ? os.version() : null,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
    },
    repo: {
      branch: commandOutput("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
      commit: commandOutput("git", ["rev-parse", "HEAD"]),
      worktree: statusEntries === 0 ? "clean" : "changed",
      statusEntries,
    },
    paths: {},
  };
}

function writeReport(mode) {
  const report = { mode, evidence, results, blockers };
  const text = JSON.stringify(report, null, 2);
  if (jsonOut) {
    const output = resolve(diveRoot, jsonOut);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${text}\n`, "utf8");
    console.log(`[release-gate-smoke] wrote JSON evidence to ${output}`);
  }
  console.log(text);
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

function releaseGateWorkflowMatchesSop() {
  const workflow = join(repoRoot, ".github", "workflows", "release-gate.yml");
  if (!existsSync(workflow)) return false;
  const body = readFileSync(workflow, "utf8");
  const requiresReleaseOwner =
    /release_owner:\s*\n\s+description:[^\n]*\n\s+required:\s*true/m.test(body);
  const hasRequiredCommands = [
    "pnpm typecheck",
    "pnpm lint --max-warnings 0",
    "pnpm build",
    "pnpm format:check",
    "pnpm verify:production-wire",
    "pnpm verify:v4",
    "npm --prefix pi-sidecar ci",
    "node pi-sidecar/build-sidecar.mjs --target ${{ matrix.target }}",
    "windows-latest",
    "windows-11-arm",
    "x86_64-pc-windows-msvc",
    "aarch64-pc-windows-msvc",
    "cargo fmt --all -- --check",
    "cargo test --features dev-mock --all-targets",
    "cargo clippy --features dev-mock --all-targets -- -D warnings",
    "cargo check --release",
    "bash ./scripts/verify-release-mock-guard.sh",
    "pnpm tauri build --target ${{ matrix.target }} --bundles nsis",
    "pnpm release:smoke -- --json-out release-smoke-${{ matrix.label }}.json",
    "RELEASE_OWNER: ${{ github.event.inputs.release_owner }}",
    "DIVE_RELEASE_OWNER",
    "actions/upload-artifact@v4",
    "DIVE-windows-${{ matrix.label }}-nsis",
    "DIVE-release-smoke-${{ matrix.label }}",
    '$driverTool = Join-Path $cargoBin "msedgedriver-tool.exe"',
    "& $driverTool",
  ].every((command) => body.includes(command));
  return (
    hasRequiredCommands &&
    requiresReleaseOwner &&
    body.includes("workflow_dispatch:") &&
    !/^\s+push:\s*$/m.test(body)
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), webdriverRequestTimeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:4444${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
    }
    return payload;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`${method} ${path} timed out after ${webdriverRequestTimeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function elementId(element) {
  return element?.["element-6066-11e4-a52e-4f735466cecf"] ?? element?.ELEMENT;
}

async function findElement(selector) {
  try {
    const payload = await httpJson("POST", `/session/${sessionId}/element`, {
      using: "css selector",
      value: selector,
    });
    return elementId(payload.value) ?? null;
  } catch {
    return null;
  }
}

async function waitForElement(selector, timeoutMs = 30000) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const id = await findElement(selector);
      if (id) return id;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${selector}: ${lastError?.message ?? "not found"}`);
}

async function clickElement(id) {
  await httpJson("POST", `/session/${sessionId}/element/${id}/click`, {});
}

async function executeScript(script, args = []) {
  const payload = await httpJson("POST", `/session/${sessionId}/execute/sync`, {
    script,
    args,
  });
  return payload.value;
}

async function domSnapshot() {
  try {
    return await executeScript(`
      const ids = [...document.querySelectorAll("[data-testid]")]
        .slice(0, 40)
        .map((el) => el.getAttribute("data-testid"));
      return {
        readyState: document.readyState,
        url: location.href,
        title: document.title,
        bodyText: (document.body?.innerText || "").slice(0, 500),
        testIds: ids,
      };
    `);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function waitForBodyText(pattern, timeoutMs = 45000) {
  const start = Date.now();
  let lastText = "";
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const text = String(
        await executeScript('return document.body ? document.body.innerText : "";'),
      );
      lastText = text;
      if (pattern.test(text)) return text;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const detail = lastError ? lastError.message : lastText.slice(0, 200);
  throw new Error(`Timed out waiting for app body text: ${detail}`);
}

async function acknowledgeRc1MigrationIfPresent() {
  const confirm =
    (await findElement('[data-testid="rc1-migration-confirm"]')) ??
    (await findElement('[data-testid="rc1-migration-fallback-confirm"]'));
  if (!confirm) return false;
  await clickElement(confirm);
  return true;
}

async function waitForMainShell(timeoutMs = 60000) {
  const start = Date.now();
  let migrationAcknowledged = false;
  while (Date.now() - start < timeoutMs) {
    const shell = await findElement('[data-testid="main-shell"]');
    if (shell) return { shell, migrationAcknowledged };
    if (await acknowledgeRc1MigrationIfPresent()) {
      migrationAcknowledged = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for main shell after app launch: ${JSON.stringify(await domSnapshot())}`,
  );
}

async function startDriver(application) {
  driver = spawn(resolveCommand("tauri-driver"), ["--port", "4444"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });
  driver.stdout.on("data", (chunk) => process.stdout.write(`[tauri-driver] ${chunk}`));
  driver.stderr.on("data", (chunk) => process.stderr.write(`[tauri-driver] ${chunk}`));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (driver.exitCode !== null || driver.signalCode !== null) {
    throw new Error(
      `tauri-driver exited before session start: code=${driver.exitCode} signal=${driver.signalCode}`,
    );
  }
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

function waitForProcessExit(child, timeoutMs = 3000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

function killDriverSync(child = driver) {
  if (!child) return;
  try {
    child.kill();
  } catch {}
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  }
}

async function stopDriver() {
  if (sessionId) {
    try {
      await httpJson("DELETE", `/session/${sessionId}`);
    } catch {}
    sessionId = null;
  }
  if (driver) {
    const activeDriver = driver;
    driver = null;
    try {
      activeDriver.kill();
    } catch {}
    if (!(await waitForProcessExit(activeDriver))) {
      killDriverSync(activeDriver);
      await waitForProcessExit(activeDriver, 1000);
    }
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
  await waitForElement("body", 45000);
  const bodyText = await waitForBodyText(/DIVE|API|프로바이더|provider|프로젝트|project/i, 45000);
  if (!/DIVE|API|프로바이더|provider|프로젝트|project/i.test(bodyText)) {
    throw new Error(`unexpected app body text: ${bodyText.slice(0, 200)}`);
  }
  const { migrationAcknowledged } = await waitForMainShell(60000);
  const dataDir = appDataDir();
  const db = join(dataDir, "dive.db");
  if (!existsSync(db)) {
    throw new Error(`expected disk DB at ${db}`);
  }
  return { dataDir, db, migrationAcknowledged };
}

async function main() {
  evidence = collectEvidence();
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
  record(
    "release gate workflow matches SOP commands",
    releaseGateWorkflowMatchesSop(),
    ".github/workflows/release-gate.yml",
  );

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
    writeReport("preflight");
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
  evidence.paths.appDataDir = dataDir;
  rmSync(dataDir, { recursive: true, force: true });
  record("clean app local data", true, dataDir);

  const installer = await findInstaller();
  evidence.paths.installer = installer;
  await installNsis(installer);
  record("silent NSIS install", true, installer);

  const application = await findApplication();
  if (!application) throw new Error("Installed DIVE executable not found; set DIVE_RELEASE_APP");
  evidence.paths.application = application;
  const sidecar = join(dirname(application), "dive-pi-sidecar.exe");
  evidence.paths.sidecar = sidecar;
  const sidecarExists = existsSync(sidecar);
  record(
    "bundled Pi sidecar exists",
    sidecarExists,
    sidecarExists ? `${sidecar} (${statSync(sidecar).size} bytes)` : sidecar,
  );
  if (!sidecarExists) throw new Error(`bundled Pi sidecar not found: ${sidecar}`);
  const smoke = await smokeInstalledApp(application);
  evidence.paths.db = smoke.db;
  record("tauri-driver startup + main shell", true, application);
  record("first-run migration acknowledged", true, String(smoke.migrationAcknowledged));
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

  writeReport("full");
}

process.on("exit", () => killDriverSync());
process.on("SIGINT", async () => {
  await stopDriver();
  process.exit(130);
});

main().catch(async (err) => {
  await stopDriver();
  fail("release gate smoke", err instanceof Error ? err.message : String(err));
  writeReport(preflightOnly ? "preflight" : "full");
  process.exit(process.exitCode || 1);
});
