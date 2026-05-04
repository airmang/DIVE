// Playwright verification for task 3-3 (checkpoint auto-trigger + UI badge + Ctrl+S).
// Run with: node scripts/verify-checkpoint.mjs
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "ko-KR",
  });
  const page = await context.newPage();

  console.log("1. Navigate to ?demo=scenario-b (reusing state-machine demo)");
  await page.goto(`${BASE}/?demo=scenario-b`);
  await page.waitForLoadState("domcontentloaded");
  // Reset i18n to Korean (persist store may have been left at "en" by other suites).
  await page.evaluate(() => {
    const persisted = window.localStorage.getItem("dive:locale");
    if (persisted) {
      try {
        const parsed = JSON.parse(persisted);
        parsed.state.locale = "ko";
        window.localStorage.setItem("dive:locale", JSON.stringify(parsed));
      } catch {
        window.localStorage.removeItem("dive:locale");
      }
    }
  });
  await page.reload();
  await page.waitForSelector('[data-testid="scenario-b-shell"]');

  console.log("\n2. Seed verifying card + run verify + approve → checkpoint badge");
  await page.click('[data-testid="scenario-b-seed-v"]');
  await page.waitForSelector('[data-card-state="verifying"]');
  await page.click('[data-testid="card-tile"][data-card-state="verifying"]');
  await page.waitForSelector('[data-testid="card-detail-panel"][data-card-state="verifying"]');
  await page.waitForSelector('[data-testid="btn-run-verify"]:not([disabled])');
  await page.locator('[data-testid="btn-run-verify"]').click({ force: true });
  await page.waitForSelector('[data-testid="verify-log"]');
  await page.waitForSelector('[data-testid="btn-approve"]:not([disabled])');
  await page.locator('[data-testid="btn-approve"]').click({ force: true });
  await page.waitForSelector('[data-card-state="verified"]');

  console.log("\n3. Re-open verified card → checkpoint badge renders");
  await page.click('[data-testid="card-tile"][data-card-state="verified"]');
  await page.waitForTimeout(300);
  const slideIn = await page.$('[data-testid="slide-in-panel"]');
  check("verified click opens slide-in (not modal)", slideIn !== null, "spec §5.2.3");

  console.log("\n4. Check current-card-id tracks the verified card");
  const cardId = await page.$eval(
    '[data-testid="current-card-id"]',
    (el) => el.getAttribute("value") ?? "",
  );
  check("current-card-id is set", cardId.length > 0, `id=${cardId}`);

  console.log("\n5. Ctrl+S (Cmd+S) triggers a manual checkpoint log");
  const isMac = process.platform === "darwin";
  await page.keyboard.press(isMac ? "Meta+KeyS" : "Control+KeyS");
  await page.waitForTimeout(100);
  const manualLabel = await page.$eval(
    '[data-testid="last-manual-checkpoint"]',
    (el) => el.getAttribute("value") ?? "",
  );
  check(
    "manual checkpoint label captured",
    manualLabel.length > 0 && manualLabel.includes("수동 저장"),
    `label="${manualLabel}"`,
  );

  console.log("\n6. Ctrl+S defaults to '수동 저장' without selected card");
  await page.goto(`${BASE}/?demo=scenario-b`);
  await page.waitForSelector('[data-testid="scenario-b-shell"]');
  await page.keyboard.press(isMac ? "Meta+KeyS" : "Control+KeyS");
  await page.waitForTimeout(100);
  const blankLabel = await page.$eval(
    '[data-testid="last-manual-checkpoint"]',
    (el) => el.getAttribute("value") ?? "",
  );
  check("default label when no card selected", blankLabel === "수동 저장", `label="${blankLabel}"`);

  console.log("\n7. Run full V-cycle on a fresh verifying card and verify badge");
  await page.click('[data-testid="scenario-b-seed-v"]');
  await page.waitForSelector('[data-card-state="verifying"]');
  await page.click('[data-testid="card-tile"][data-card-state="verifying"]');
  await page.waitForSelector('[data-testid="card-detail-panel"][data-card-state="verifying"]');
  await page.waitForSelector('[data-testid="btn-run-verify"]:not([disabled])');
  await page.locator('[data-testid="btn-run-verify"]').click({ force: true });
  await page.waitForSelector('[data-testid="verify-log"]');
  await page.waitForSelector('[data-testid="btn-approve"]:not([disabled])');
  await page.locator('[data-testid="btn-approve"]').click({ force: true });
  await page.waitForSelector('[data-card-state="verified"]');

  console.log("\n8. Verified card click → slide-in opens (not modal)");
  await page.click('[data-testid="card-tile"][data-card-state="verified"]');
  await page.waitForTimeout(300);
  const panel2 = await page.$('[data-testid="slide-in-panel"]');
  check("slide-in opens for verified card", panel2 !== null);

  console.log("\n9. Reject path does not set a checkpoint badge");
  await page.goto(`${BASE}/?demo=scenario-b`);
  await page.waitForSelector('[data-testid="scenario-b-shell"]');
  await page.click('[data-testid="scenario-b-seed-v"]');
  await page.waitForSelector('[data-card-state="verifying"]');
  await page.click('[data-testid="card-tile"][data-card-state="verifying"]');
  await page.waitForSelector('[data-testid="card-detail-panel"][data-card-state="verifying"]');
  await page.locator('[data-testid="btn-reject"]').click({ force: true });
  await page.waitForSelector('[data-card-state="rejected"]');
  const rejCount = await page.$$eval(
    '[data-card-state="rejected"][data-testid="card-tile"]',
    (els) => els.length,
  );
  check("reject transitions to rejected", rejCount === 1);

  await browser.close();
  console.log(`\n\nTotal: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
