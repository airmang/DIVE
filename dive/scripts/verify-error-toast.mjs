// Playwright verification for task 4-3 — error toast + retry UX.
// Run with: node scripts/verify-error-toast.mjs
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

  console.log("1. Navigate to ?demo=toast");
  await page.goto(`${BASE}/?demo=toast`);
  await page.waitForSelector('[data-testid="toast-demo-shell"]');

  console.log("\n2. 4 variant buttons render");
  for (const v of ["success", "info", "warn", "error"]) {
    const el = await page.$(`[data-testid="btn-toast-${v}"]`);
    check(`btn ${v}`, el !== null);
  }

  console.log("\n3. Click success → toast with data-variant=success appears");
  await page.click('[data-testid="btn-toast-success"]');
  await page.waitForSelector('[data-testid="toast"][data-variant="success"]', {
    timeout: 1000,
  });
  check("success toast visible", true);

  console.log("\n4. Stacking: click 4 toasts → max 3 visible");
  await page.click('[data-testid="btn-toast-info"]');
  await page.click('[data-testid="btn-toast-warn"]');
  await page.click('[data-testid="btn-toast-error"]');
  await page.waitForTimeout(200);
  const count = await page.$$eval('[data-testid="toast"]', (els) => els.length);
  check("max 3 toasts visible (drops oldest)", count <= 3, `got ${count}`);

  console.log("\n5. Error toast has action button");
  const actionBtn = await page.$('[data-testid="toast-action"]');
  check("toast action button", actionBtn !== null);

  console.log("\n6. Click toast-dismiss removes one toast");
  const beforeDismiss = await page.$$eval('[data-testid="toast"]', (els) => els.length);
  const dismissBtns = await page.$$('[data-testid="toast-dismiss"]');
  if (dismissBtns.length > 0) {
    await dismissBtns[0].click();
    await page.waitForTimeout(200);
  }
  const afterDismiss = await page.$$eval('[data-testid="toast"]', (els) => els.length);
  check("dismissed one toast", afterDismiss < beforeDismiss, `${beforeDismiss} -> ${afterDismiss}`);

  console.log("\n7. Action button triggers onAction + dismisses toast");
  await page.evaluate(() => {
    document.querySelectorAll('[data-testid="toast-dismiss"]').forEach((el) => {
      el.click();
    });
  });
  await page.waitForTimeout(200);
  await page.click('[data-testid="btn-toast-error"]');
  await page.waitForSelector('[data-testid="toast-action"]');
  await page.click('[data-testid="toast-action"]');
  await page.waitForTimeout(800);
  const retryStatus = await page.textContent('[data-testid="retrying-status"]');
  check("retry flow completed", retryStatus?.includes("false"), retryStatus ?? "");
  const successAfterRetry = await page.$('[data-testid="toast"][data-variant="success"]');
  check("success toast after retry", successAfterRetry !== null);

  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
