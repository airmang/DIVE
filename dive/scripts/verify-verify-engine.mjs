// Playwright verification for task 3-2 (V-stage verify engine + UI).
// Run with: node scripts/verify-verify-engine.mjs
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

  console.log("1. Navigate to ?demo=scenario-b (reusing state-machine demo)");
  await page.goto(`${BASE}/?demo=scenario-b`);
  await page.waitForSelector('[data-testid="scenario-b-shell"]');

  console.log("\n2. Seed verifying card");
  await page.click('[data-testid="scenario-b-seed-v"]');
  await page.waitForSelector('[data-card-state="verifying"]');

  console.log("\n3. Open verifying card → CardDetailPanel");
  await page.click('[data-testid="card-tile"][data-card-state="verifying"]');
  await page.waitForSelector('[data-testid="card-detail-panel"][data-card-state="verifying"]');

  console.log("\n4. Verifying body has new structure (no 3-2 placeholder)");
  const verifyingBody = await page.$eval(
    '[data-testid="verifying-body"]',
    (el) => el.textContent ?? "",
  );
  check(
    "placeholder text removed",
    !verifyingBody.includes("3-2에서 실제 검증 로직 추가"),
    "body: " + verifyingBody.slice(0, 80),
  );
  check(
    "instruction to run verify",
    verifyingBody.includes("AI가 지시와 코드 변경의 일치 여부를"),
    "",
  );

  console.log("\n5. Initial state: empty verify log shown");
  const emptyBefore = await page.$('[data-testid="verify-empty"]');
  check("verify-empty placeholder before run", emptyBefore !== null);
  const logBefore = await page.$('[data-testid="verify-log"]');
  check("verify-log not yet rendered", logBefore === null);

  console.log("\n6. [검증 실행] button present and labeled '검증 실행'");
  const btn = await page.$('[data-testid="btn-run-verify"]');
  check("verify button present", btn !== null);
  const btnText = await btn?.textContent();
  check("button label '검증 실행'", (btnText ?? "").includes("검증 실행"), `text: ${btnText}`);

  console.log("\n7. Approve button disabled before verify runs");
  const approveBefore = await page.$eval(
    '[data-testid="btn-approve"]',
    (el) => el.disabled,
  );
  check("approve disabled before verify", approveBefore === true);

  console.log("\n8. Click [검증 실행] — mock verify resolves after ~500ms");
  await page.waitForSelector('[data-testid="btn-run-verify"]:not([disabled])');
  await page.locator('[data-testid="btn-run-verify"]').click({ force: true });
  await page.waitForSelector('[data-testid="verify-log"]', { timeout: 3000 });

  console.log("\n9. verify-log sections render");
  const intentEl = await page.$('[data-testid="verify-intent-match"]');
  check("verify-intent-match rendered", intentEl !== null);
  const intentVal = await intentEl?.getAttribute("data-intent-match");
  check("intent-match is true (mock)", intentVal === "true", `got ${intentVal}`);

  const testEl = await page.$('[data-testid="verify-test-result"]');
  check("verify-test-result rendered", testEl !== null);
  const testVal = await testEl?.getAttribute("data-test-result");
  check(
    "test-result is skipped (mock)",
    testVal === "skipped",
    `got ${testVal}`,
  );

  const detailsEl = await page.$('[data-testid="verify-details"]');
  check("verify-details rendered", detailsEl !== null);
  const detailsText = await detailsEl?.textContent();
  check(
    "details mentions model + time",
    (detailsText ?? "").includes("모델:"),
    (detailsText ?? "").slice(0, 80),
  );

  console.log("\n10. Approve button now enabled (intent_match=true, not fail)");
  const approveAfter = await page.$eval(
    '[data-testid="btn-approve"]',
    (el) => el.disabled,
  );
  check("approve enabled after verify success", approveAfter === false);

  console.log("\n11. Rerun button label becomes '재검증'");
  const rerunText = await page.$eval(
    '[data-testid="btn-run-verify"]',
    (el) => el.textContent ?? "",
  );
  check(
    "button label becomes '재검증'",
    rerunText.includes("재검증"),
    `text: ${rerunText}`,
  );

  console.log("\n12. Click [최종 승인] → card transitions to verified");
  await page.click('[data-testid="btn-approve"]');
  await page.waitForSelector('[data-card-state="verified"]', { timeout: 2000 });
  const verifiedCount = await page.$$eval(
    '[data-card-state="verified"][data-testid="card-tile"]',
    (els) => els.length,
  );
  check("card now verified", verifiedCount === 1);

  console.log("\n13. Fresh seed + reject path still works");
  await page.goto(`${BASE}/?demo=scenario-b`);
  await page.waitForSelector('[data-testid="scenario-b-shell"]');
  await page.click('[data-testid="scenario-b-seed-v"]');
  await page.waitForSelector('[data-card-state="verifying"]');
  await page.click('[data-testid="card-tile"][data-card-state="verifying"]');
  await page.waitForSelector('[data-testid="card-detail-panel"][data-card-state="verifying"]');
  const rejectBtn = await page.$('[data-testid="btn-reject"]');
  check("reject button present even before verify", rejectBtn !== null);
  await page.click('[data-testid="btn-reject"]');
  await page.waitForSelector('[data-card-state="rejected"]', { timeout: 2000 });
  const rejCount = await page.$$eval(
    '[data-card-state="rejected"][data-testid="card-tile"]',
    (els) => els.length,
  );
  check("reject transitions to rejected", rejCount === 1);

  console.log("\n14. Force-approve toggle appears only for failing verdicts");
  await page.goto(`${BASE}/?demo=scenario-b`);
  await page.waitForSelector('[data-testid="scenario-b-shell"]');
  await page.click('[data-testid="scenario-b-seed-v"]');
  await page.click('[data-testid="card-tile"][data-card-state="verifying"]');
  await page.waitForSelector('[data-testid="card-detail-panel"][data-card-state="verifying"]');
  await page.click('[data-testid="btn-run-verify"]');
  await page.waitForSelector('[data-testid="verify-log"]');
  const toggleAfterSuccess = await page.$('[data-testid="force-approve-toggle"]');
  check(
    "no force-approve toggle on success",
    toggleAfterSuccess === null,
    "mock verify returns success",
  );

  await browser.close();
  console.log(`\n\nTotal: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
