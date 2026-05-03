// Playwright verification for task 4-1 — onboarding dialog.
// Run with: node scripts/verify-onboarding.mjs
// Requires dev server on http://localhost:1420.

import { chromium } from "./_playwright-loader.mjs";

const BASE = "http://localhost:1420";
let pass = 0;
let fail = 0;

function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? "  " + detail : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? "  " + detail : ""}`);
  }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log("1. Clear storage and navigate to /");
  await page.goto(BASE);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="sidebar"]');

  console.log("\n2. Onboarding dialog should be visible on first run");
  const dialog = await page.waitForSelector('[data-testid="onboarding-dialog"]', {
    timeout: 3000,
  });
  check("onboarding dialog rendered", dialog !== null);

  console.log("\n3. Provider choices and fields present");
  check("anthropic choice", (await page.$('[data-testid="onb-kind-anthropic"]')) !== null);
  check("openai choice", (await page.$('[data-testid="onb-kind-openai"]')) !== null);
  check("openrouter choice", (await page.$('[data-testid="onb-kind-openrouter"]')) !== null);
  check("api key input", (await page.$('[data-testid="onb-api-key"]')) !== null);
  check("skip button", (await page.$('[data-testid="onb-skip"]')) !== null);
  check("connect button", (await page.$('[data-testid="onb-connect"]')) !== null);

  console.log("\n4. Empty api key shows error on connect");
  await page.click('[data-testid="onb-connect"]');
  await page.waitForSelector('[data-testid="onb-error"]', { timeout: 1000 });
  check("empty key error shown", true);

  console.log("\n5. Skip closes dialog and persists onboarded flag");
  await page.click('[data-testid="onb-skip"]');
  await page.waitForTimeout(300);
  const dialogGone = (await page.$('[data-testid="onboarding-dialog"]')) === null;
  check("dialog closed after skip", dialogGone);
  const onboarded = await page.evaluate(() => window.localStorage.getItem("dive:onboarded"));
  check("onboarded flag persisted", onboarded === "true", String(onboarded));

  console.log("\n6. Reload — dialog stays hidden (already onboarded)");
  await page.reload();
  await page.waitForSelector('[data-testid="sidebar"]');
  await page.waitForTimeout(500);
  const visibleAfterReload = await page.$('[data-testid="onboarding-dialog"]');
  check("dialog not shown on subsequent load", visibleAfterReload === null);

  console.log("\n7. Clear storage → dialog re-appears");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="onboarding-dialog"]', { timeout: 3000 });
  check("dialog re-appears after clearing storage", true);

  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
