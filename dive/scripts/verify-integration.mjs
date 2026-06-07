// Playwright verification for DIVE shell + plan surface integration.
// Run with: node scripts/verify-integration.mjs
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
  await context.addInitScript(() => {
    window.localStorage.setItem("dive:rc1_migrated", "true");
  });
  const page = await context.newPage();

  console.log("1. Plan surface demo is reachable through legacy workmap demo alias");
  await page.goto(`${BASE}/?demo=workmap`);
  await page.waitForSelector('[data-testid="plan-view"]');
  const initialCount = await page.$$eval('[data-testid="plan-step"]', (els) => els.length);
  check("plan view renders steps", initialCount === 7, `got ${initialCount}`);

  console.log("\n2. Ready step Start action updates the row state");
  await page.click('[data-plan-step-id="S-004"] [data-testid="plan-step-action"]');
  await page.waitForTimeout(150);
  const s4Status = await page.$eval('[data-plan-step-id="S-004"]', (el) =>
    el.getAttribute("data-plan-step-status"),
  );
  check("S-004 is now in progress", s4Status === "in_progress", `status=${s4Status}`);

  console.log("\n3. Parallel group Run both starts ready peers");
  await page.click('[data-testid="plan-roadmap-start-group"]');
  await page.waitForTimeout(150);
  const peerStatuses = await page.$$eval(
    '[data-plan-step-id="S-005"], [data-plan-step-id="S-006"]',
    (els) => els.map((el) => el.getAttribute("data-plan-step-status")),
  );
  check(
    "parallel peers are in progress",
    peerStatuses.every((status) => status === "in_progress"),
    JSON.stringify(peerStatuses),
  );

  console.log("\n4. Minimap keyboard activation focuses a timeline row");
  await page.click('[data-testid="plan-minimap-toggle"]');
  await page.focus('[data-testid="plan-minimap-node"][data-plan-step-id="S-002"]');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(180);
  const focusedStep = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-plan-step-id"),
  );
  check("Enter on minimap node focuses S-002", focusedStep === "S-002", `focused=${focusedStep}`);

  console.log("\n5. Default product route still renders MainShell");
  await page.goto(BASE);
  await page.evaluate(() => window.localStorage.setItem("dive:onboarded", "true"));
  await page.reload();
  await page.waitForSelector('[data-testid="main-shell"]');
  const shell = await page.$('[data-testid="main-shell"]');
  check("default / renders MainShell", !!shell);

  console.log("\n6. Unknown demo param stays product mode");
  await page.goto(`${BASE}/?demo=unknown`);
  await page.waitForSelector('[data-testid="main-shell"]');
  const planDemo = await page.$('[data-testid="plan-surface-demo"]');
  check("unknown ?demo=unknown does not enable demo fallback", planDemo === null);

  await browser.close();
  console.log(`\n\nTotal: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
