// 25-user concurrent simulation for Phase 4-5 pilot sizing.
// Spins up 25 parallel browser contexts, each completing onboarding + project +
// session + first card flow. Records timing metrics to stdout.
//
// Usage: node scripts/simulate-25-users.mjs [count=25]
// Requires dev server on http://localhost:1420.

import { chromium } from "./_playwright-loader.mjs";

const BASE = "http://localhost:1420";
const COUNT = Number(process.argv[2] ?? "25");
const CONCURRENCY = Math.min(COUNT, 10);

async function runOneUser(browser, index) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const t0 = Date.now();
  try {
    await page.goto(BASE);
    await page.evaluate(() => {
      window.localStorage.clear();
      window.localStorage.setItem("dive:rc1_migrated", "true");
    });
    await page.reload();
    await page.waitForSelector('[data-testid="onboarding-dialog"]', { timeout: 5000 });
    const tOnboarding = Date.now() - t0;

    await page.click('[data-testid="onb-skip"]');
    await page.waitForTimeout(200);

    const t1 = Date.now();
    await page.click('[data-testid="btn-new-project"]');
    await page.waitForSelector('[data-testid="new-project-dialog"]');
    await page.fill('[data-testid="np-name"]', `sim-user-${index}`);
    await page.fill('[data-testid="np-path"]', `/tmp/sim-user-${index}`);
    await page.click('[data-testid="np-create"]');
    await page.waitForSelector('[data-testid="project-item"]', { timeout: 3000 });
    const tProject = Date.now() - t1;

    const t2 = Date.now();
    await page.click('[data-testid="btn-new-session"]');
    await page.waitForSelector('[data-testid="session-item"]', { timeout: 3000 });
    const tSession = Date.now() - t2;

    return {
      index,
      ok: true,
      onboardingMs: tOnboarding,
      projectMs: tProject,
      sessionMs: tSession,
      totalMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      index,
      ok: false,
      error: err.message,
      totalMs: Date.now() - t0,
    };
  } finally {
    await context.close();
  }
}

function summarize(results) {
  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const median = (arr) => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const pct = (arr, p) => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length * p) / 100)];
  };
  const onboarding = ok.map((r) => r.onboardingMs);
  const project = ok.map((r) => r.projectMs);
  const session = ok.map((r) => r.sessionMs);
  const total = ok.map((r) => r.totalMs);
  console.log("\n=== 시뮬레이션 요약 ===");
  console.log(`총: ${results.length}명`);
  console.log(`성공: ${ok.length}명 / 실패: ${fail.length}명`);
  console.log(`onboarding ms — median ${median(onboarding)} / p95 ${pct(onboarding, 95)}`);
  console.log(`project     ms — median ${median(project)} / p95 ${pct(project, 95)}`);
  console.log(`session     ms — median ${median(session)} / p95 ${pct(session, 95)}`);
  console.log(`total       ms — median ${median(total)} / p95 ${pct(total, 95)}`);
  if (fail.length > 0) {
    console.log("\n실패 사유:");
    fail.forEach((r) => console.log(`  user ${r.index}: ${r.error}`));
  }
}

async function main() {
  console.log(
    `\n=== 25-user concurrent simulation (count=${COUNT}, concurrency=${CONCURRENCY}) ===`,
  );
  const browser = await chromium.launch();
  const results = [];
  const queue = [...Array(COUNT).keys()];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const idx = queue.shift();
      const r = await runOneUser(browser, idx);
      results.push(r);
      console.log(`  user ${idx}: ${r.ok ? "OK" : "FAIL"} (${r.totalMs}ms)`);
    }
  });
  await Promise.all(workers);
  await browser.close();
  summarize(results);
  const failCount = results.filter((r) => !r.ok).length;
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
