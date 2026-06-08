#!/usr/bin/env node
// Build the DIVE Pi sidecar as a standalone single-file executable for Tauri
// `externalBin`. Classroom PCs have no separately-installed Node, so the sidecar
// must ship as a self-contained binary.
//
// Toolchain: **Node SEA** (Single Executable Application).
//   esbuild bundles the ESM sidecar + Pi SDK into one CommonJS file, Node's SEA
//   tooling turns it into an injectable blob, and `postject` injects it into an
//   *official* Node binary. Node SEA runs the real Node runtime, so
//   `node:readline`/stdin behave exactly like `node src/main.mjs`.
//
//   We do NOT use `bun build --compile`: it bundles fine but the compiled binary
//   does not read piped/redirected stdin (verified 2026-06-08 — empty output /
//   SIGKILL), which breaks the JSONL protocol. See the flip plan, Phase C.
//
//   We fetch the official statically-linked Node binary as the SEA base instead
//   of copying the local `node`: package-manager builds (e.g. Homebrew) ship a
//   thin launcher that dynamically links libnode and is unusable when copied.
//
// SEA produces a binary for the HOST platform only. Windows x64/arm64 sidecars
// are built by running this script on a Windows runner in the build pipeline;
// `--target` other than the host is rejected here on purpose (no fake artifacts).
//
// ── Pi-SDK-in-SEA fix (2026-06-08) ────────────────────────────────────────────
// The Pi SDK does module-LOAD-TIME filesystem reads relative to its own file
// location (`fileURLToPath(import.meta.url)` then `readFileSync(<dir>/
// package.json)` etc.). Single-file bundling flattens that layout, so under SEA
// (`__filename` undefined) those throw. Resolved WITHOUT a heavier resources
// strategy by (1) pinning `import.meta.url` to a sentinel dir and (2) stubbing
// fs reads UNDER THAT SENTINEL ONLY (see the esbuild `define` + `banner` below).
// These are self-update / extension / version-metadata reads that DIVE disables,
// so stubbing them is safe; no real runtime path is touched. The round-trip gate
// confirms the binary answers the JSONL protocol identically to `node main.mjs`.
//
// Prereq: `npm ci` in dive/pi-sidecar (esbuild + postject devDeps) before build.
//
// Usage: node build-sidecar.mjs [--target <rust-triple>] [--keep]

import { execFileSync, spawn } from "node:child_process";
import {
  mkdirSync,
  copyFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
  createWriteStream,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "node:https";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "..", "src-tauri", "binaries");
const BUILD_DIR = resolve(HERE, "build");
const SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const NODE_VERSION = process.versions.node; // match the toolchain Node

function hostTriple() {
  const archMap = { x64: "x86_64", arm64: "aarch64" };
  const arch = archMap[process.arch] ?? process.arch;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  if (process.platform === "linux") return `${arch}-unknown-linux-gnu`;
  throw new Error(`unsupported host platform: ${process.platform}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let target = hostTriple();
  let keep = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--target") target = args[++i];
    else if (args[i] === "--keep") keep = true;
  }
  return { target, keep };
}

function run(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, { stdio: "inherit", ...opts });
}

function download(url, dest) {
  return new Promise((res, rej) => {
    const file = createWriteStream(dest);
    get(url, (resp) => {
      if (resp.statusCode === 302 || resp.statusCode === 301) {
        file.close();
        return download(resp.headers.location, dest).then(res, rej);
      }
      if (resp.statusCode !== 200) {
        file.close();
        return rej(new Error(`download ${url} -> HTTP ${resp.statusCode}`));
      }
      resp.pipe(file);
      file.on("finish", () => file.close(res));
    }).on("error", (e) => {
      file.close();
      rej(e);
    });
  });
}

// Fetch the official, statically-linked Node binary for the host and return its
// path. SEA needs a self-contained base, not a package-manager thin launcher.
async function fetchHostNodeBinary() {
  const platform = { darwin: "darwin", linux: "linux", win32: "win" }[process.platform];
  const arch = { x64: "x64", arm64: "arm64" }[process.arch];
  if (!platform || !arch)
    throw new Error(`no official Node build for ${process.platform}/${process.arch}`);
  if (platform === "win") {
    const zip = join(BUILD_DIR, "node.zip");
    await download(
      `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-${arch}.zip`,
      zip,
    );
    run("tar", ["-xf", zip, "-C", BUILD_DIR]); // bsdtar on win10+ extracts zip
    return join(BUILD_DIR, `node-v${NODE_VERSION}-win-${arch}`, "node.exe");
  }
  const tgz = join(BUILD_DIR, "node.tar.gz");
  const base = `node-v${NODE_VERSION}-${platform}-${arch}`;
  console.log(`[build-sidecar] fetching official Node ${NODE_VERSION} (${platform}-${arch}) …`);
  await download(`https://nodejs.org/dist/v${NODE_VERSION}/${base}.tar.gz`, tgz);
  run("tar", ["-xzf", tgz, "-C", BUILD_DIR]);
  return join(BUILD_DIR, base, "bin", "node");
}

// Round-trip the produced binary over stdin; it must answer the JSONL protocol
// exactly like `node src/main.mjs` or the build fails.
function roundTrip(binPath) {
  return new Promise((res, rej) => {
    const child = spawn(binPath, [], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rej(new Error("round-trip timed out (binary did not answer stdin)"));
    }, 15000);
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (out.includes("\n")) {
        clearTimeout(timer);
        child.kill("SIGKILL");
        const first = out.split("\n")[0];
        try {
          const msg = JSON.parse(first);
          if (msg.type === "error" && /unknown message type: ping/.test(msg.message)) res();
          else rej(new Error(`unexpected protocol reply: ${first}`));
        } catch (e) {
          rej(new Error(`non-JSON reply: ${first} (${e.message})`));
        }
      }
    });
    child.on("error", rej);
    child.stdin.write('{"type":"ping"}\n');
  });
}

async function main() {
  const { target, keep } = parseArgs();
  const host = hostTriple();
  if (target !== host) {
    console.error(
      `[build-sidecar] cannot build ${target} on this ${host} host.\n` +
        `Node SEA is host-only — run this script on a ${target} machine in the build pipeline.`,
    );
    process.exit(2);
  }

  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const binName = `dive-pi-sidecar-${target}${isWin ? ".exe" : ""}`;
  const outPath = join(OUT_DIR, binName);

  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(BUILD_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  // 1. Bundle the ESM sidecar + Pi SDK into a single CommonJS file.
  console.log("[build-sidecar] bundling with esbuild …");
  const { build } = await import("esbuild");
  const bundlePath = join(BUILD_DIR, "sidecar.cjs");
  // In a SEA there is no real module file, so (1) esbuild's CJS `import.meta.url`
  // shim resolves to undefined and the Pi SDK's `fileURLToPath(import.meta.url)`
  // throws, and (2) the SDK does load-time `readFileSync(<dir>/package.json)`
  // relative to that module dir. Pin `import.meta.url` to a sentinel dir and
  // stub fs reads UNDER THAT SENTINEL ONLY — these are self-update / extension /
  // version-metadata reads that DIVE disables, so stubbing them is safe and does
  // not touch any real filesystem path the sidecar uses at runtime.
  const SEA_DIR = "/__dive_sea__";
  const fsStubBanner =
    `(()=>{const fs=require("fs");const P=${JSON.stringify(SEA_DIR)};` +
    `for(const m of ["readFileSync","existsSync","statSync","readdirSync","realpathSync"]){` +
    `const o=fs[m];if(typeof o!=="function")continue;` +
    `fs[m]=function(p,...a){const s=typeof p==="string"?p:(p&&p.path);` +
    `if(typeof s==="string"&&s.indexOf(P)===0){try{return o.call(fs,p,...a)}catch(e){` +
    `if(m==="existsSync")return false;` +
    `if(m==="readFileSync")return s.endsWith("package.json")?'{"name":"dive-pi-sidecar","version":"0.0.0"}':"";` +
    `if(m==="readdirSync")return [];return {}}}return o.call(fs,p,...a)}}})();`;
  await build({
    entryPoints: [join(HERE, "src", "main.mjs")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: bundlePath,
    legalComments: "none",
    define: { "import.meta.url": JSON.stringify(`file://${SEA_DIR}/sidecar.cjs`) },
    banner: { js: fsStubBanner },
  });

  // 2. SEA config + blob.
  const seaConfig = join(BUILD_DIR, "sea-config.json");
  const blobPath = join(BUILD_DIR, "sidecar.blob");
  writeFileSync(
    seaConfig,
    JSON.stringify({ main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true }),
  );
  console.log("[build-sidecar] generating SEA blob …");
  run(process.execPath, ["--experimental-sea-config", seaConfig]);

  // 3. Official Node binary as the executable base (writable copy).
  const nodeBin = await fetchHostNodeBinary();
  copyFileSync(nodeBin, outPath);
  chmodSync(outPath, 0o755);

  // 4. macOS: strip the signature before injecting (re-signed at the end).
  if (isMac) {
    try {
      run("codesign", ["--remove-signature", outPath], { stdio: "ignore" });
    } catch {
      /* unsigned already */
    }
  }

  // 5. Inject the blob with postject.
  console.log("[build-sidecar] injecting blob with postject …");
  const postject = join(HERE, "node_modules", ".bin", "postject");
  const postjectArgs = [outPath, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", SENTINEL];
  if (isMac) postjectArgs.push("--macho-segment-name", "NODE_SEA");
  run(postject, postjectArgs);

  // 6. macOS: ad-hoc re-sign so the OS will run the modified binary.
  if (isMac) run("codesign", ["--sign", "-", outPath]);

  // 7. Gate: the binary must answer the JSONL protocol over stdin.
  console.log("[build-sidecar] verifying stdin round-trip …");
  await roundTrip(outPath);

  if (!keep) rmSync(BUILD_DIR, { recursive: true, force: true });
  console.log(`[build-sidecar] OK -> ${outPath}`);
}

main().catch((err) => {
  console.error(`[build-sidecar] FAILED: ${err.message}`);
  process.exit(1);
});
