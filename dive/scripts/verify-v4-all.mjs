#!/usr/bin/env node
import { execSync } from "node:child_process";

const tracks = ["a", "b", "c", "d", "e", "f", "g"];
let failed = 0;

for (const track of tracks) {
  console.log(`\n=== Verifying Track ${track.toUpperCase()} ===`);
  try {
    execSync(`node scripts/verify-track-${track}.mjs`, {
      cwd: new URL("..", import.meta.url),
      stdio: "inherit",
    });
  } catch {
    console.error(`[FAIL] Track ${track.toUpperCase()} verification failed`);
    failed++;
  }
}

console.log("\n=== Verifying Product Flow ===");
try {
  execSync("node scripts/verify-product-flow.mjs", {
    cwd: new URL("..", import.meta.url),
    stdio: "inherit",
  });
} catch {
  console.error("[FAIL] Product flow verification failed");
  failed++;
}

// S-054/D4: these three verifiers were manual-only, which is how target
// drift went unnoticed. Chaining them here makes them release-gating via
// release-gate.yml and build.yml, which already invoke this script.
const followUpVerifiers = [
  ["Audit Fixes", "scripts/verify-audit-fixes.mjs"],
  ["Quality Follow-up", "scripts/verify-quality-followup.mjs"],
  ["Route-Chat Cancel Quality", "scripts/verify-route-chat-cancel-quality.mjs"],
  // Version Sync was manual-only, so a stale README version badge or an
  // out-of-sync package/Cargo/tauri version could ship green. Chaining it here
  // makes it release-gating via release-gate.yml and build.yml, same as above.
  ["Version Sync", "scripts/verify-version-sync.mjs"],
];

for (const [label, script] of followUpVerifiers) {
  console.log(`\n=== Verifying ${label} ===`);
  try {
    execSync(`node ${script}`, {
      cwd: new URL("..", import.meta.url),
      stdio: "inherit",
    });
  } catch {
    console.error(`[FAIL] ${label} verification failed`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} track(s) failed`);
  process.exit(1);
}
console.log("\n[OK] All v4 tracks and product flow verified");
