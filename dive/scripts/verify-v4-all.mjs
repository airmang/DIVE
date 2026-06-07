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

if (failed > 0) {
  console.error(`\n${failed} track(s) failed`);
  process.exit(1);
}
console.log("\n[OK] All v4 tracks and product flow verified");
