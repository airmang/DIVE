// Standalone Playwright verification for the plan surface redesign.
// Run with: node scripts/verify-workmap.mjs
// Requires dev server running on http://localhost:1420.

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

  console.log("1. Navigate to ?demo=workmap (plan surface demo)");
  await page.goto(`${BASE}/?demo=workmap`);
  await page.waitForSelector('[data-testid="plan-view"]');

  console.log("\n2. Timeline renders seven equal-tier plan steps");
  const stepRows = await page.$$eval('[data-testid="plan-step"]', (els) =>
    els.map((el) => ({
      id: el.getAttribute("data-plan-step-id"),
      status: el.getAttribute("data-plan-step-status"),
    })),
  );
  check("7 plan steps rendered", stepRows.length === 7, JSON.stringify(stepRows));
  check(
    "blocked step present",
    stepRows.some((step) => step.status === "blocked"),
  );
  check(
    "in-progress step present",
    stepRows.some((step) => step.status === "in_progress"),
  );

  console.log("\n3. Parallel group uses twin rail contract");
  const groupCount = await page.$$eval('[data-testid="plan-parallel-group"]', (els) => els.length);
  const groupButton = await page.$('[data-testid="plan-roadmap-start-group"]');
  check("one parallel group rendered", groupCount === 1, `got ${groupCount}`);
  check("parallel run button present", !!groupButton);

  console.log("\n4. Step actions map by status");
  const resumeAction = await page.$(
    '[data-plan-step-id="S-003"] [data-testid="plan-step-action"][data-action="resume"]',
  );
  const startAction = await page.$(
    '[data-plan-step-id="S-004"] [data-testid="plan-step-action"][data-action="start"]',
  );
  const lockedDisabled = await page.$eval(
    '[data-plan-step-id="S-007"] [data-testid="plan-step-action"]',
    (el) => el.disabled,
  );
  check("in-progress step has Resume", !!resumeAction);
  check("ready step has Start", !!startAction);
  check("blocked step action is disabled", lockedDisabled);

  console.log("\n5. Minimap is collapsed by default, then opens with focusable nodes");
  const initiallyOpen = await page.$('[data-testid="plan-minimap"]');
  check("minimap collapsed by default", !initiallyOpen);
  await page.click('[data-testid="plan-minimap-toggle"]');
  await page.waitForSelector('[data-testid="plan-minimap"]');
  const nodeInfo = await page.$$eval('[data-testid="plan-minimap-node"]', (els) =>
    els.map((el) => ({
      id: el.getAttribute("data-plan-step-id"),
      tabIndex: el.getAttribute("tabindex"),
      role: el.getAttribute("role"),
    })),
  );
  check("7 minimap nodes rendered", nodeInfo.length === 7, JSON.stringify(nodeInfo));
  check(
    "minimap nodes are keyboard buttons",
    nodeInfo.every((node) => node.tabIndex === "0" && node.role === "button"),
  );

  console.log("\n6. Minimap node click moves focus to matching timeline row");
  await page.click('[data-testid="plan-minimap-node"][data-plan-step-id="S-006"]');
  await page.waitForTimeout(180);
  const focusedStep = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-plan-step-id"),
  );
  check("timeline row S-006 focused", focusedStep === "S-006", `focused=${focusedStep}`);

  await browser.close();
  console.log(`\n\nTotal: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
