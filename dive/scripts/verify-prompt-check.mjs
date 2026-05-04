// Playwright verification for task 5-5 (prompt pre-send check).
// Run with: node scripts/verify-prompt-check.mjs
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
  await page.addInitScript(() => {
    window.localStorage.setItem("dive:rc1_migrated", "true");
    window.localStorage.setItem("dive:onboarded", "true");
  });

  console.log("1. Navigate to prompt helper demo");
  await page.goto(`${BASE}/?demo=prompt-helper`);
  await page.waitForSelector('[data-testid="prompt-helper-demo-page"]');

  console.log("\n2. 점검 button is disabled when input empty");
  const checkBtn0 = await page.$('[data-testid="chat-prompt-check"]');
  check("check button exists", checkBtn0 !== null);
  const disabled0 = await checkBtn0.evaluate((el) => el.disabled);
  check("check disabled on empty", disabled0 === true);

  console.log("\n3. Type ambiguous prompt, then click 점검");
  await page.fill('[data-testid="chat-input-textarea"]', "이거 바꿔줘");
  const disabled1 = await checkBtn0.evaluate((el) => el.disabled);
  check("check enabled with text", disabled1 === false);
  await checkBtn0.click();
  await page.waitForSelector('[data-testid="prompt-check-dialog"]');
  const phase0 = await page.$eval('[data-testid="prompt-check-dialog"]', (el) =>
    el.getAttribute("data-phase"),
  );
  check("dialog opens in idle phase", phase0 === "idle", phase0);

  console.log("\n4. Original text surfaced");
  const original = await page.$eval(
    '[data-testid="prompt-original"]',
    (el) => el.textContent ?? "",
  );
  check("original text shown", original.includes("이거 바꿔줘"));

  console.log("\n5. Run check (uses mockResult in browser)");
  await page.click('[data-testid="prompt-check-run"]');
  await page.waitForSelector('[data-testid="prompt-issues"]');
  const phase1 = await page.$eval('[data-testid="prompt-check-dialog"]', (el) =>
    el.getAttribute("data-phase"),
  );
  check("dialog in done phase", phase1 === "done", phase1);
  const issueCount = await page.$$eval('[data-testid="prompt-issue"]', (els) => els.length);
  check("2 issues rendered", issueCount === 2, String(issueCount));
  const countBadge = await page.$eval(
    '[data-testid="prompt-issues-count"]',
    (el) => el.textContent ?? "",
  );
  check("count badge shows 2건", countBadge.includes("2건"), countBadge);

  console.log("\n6. Refined text + token usage shown");
  const refined = await page.$eval('[data-testid="prompt-refined"]', (el) => el.textContent ?? "");
  check("refined text present", refined.includes("src/App.tsx"), refined.slice(0, 80));
  const usage = await page.$eval('[data-testid="prompt-usage"]', (el) => el.textContent ?? "");
  check("usage reports tokens", usage.includes("142"), usage);

  console.log("\n7. '제안 적용만' updates textarea but does not send");
  await page.click('[data-testid="prompt-apply-only"]');
  await page.waitForSelector('[data-testid="prompt-check-dialog"]', { state: "detached" });
  const filled = await page.$eval('[data-testid="chat-input-textarea"]', (el) => el.value);
  check("textarea replaced with refined text", filled.includes("src/App.tsx"), filled);
  const lastSent = await page.$eval('[data-testid="last-sent"]', (el) => el.textContent ?? "");
  check("message not sent yet (apply-only)", lastSent.includes("(없음)"), lastSent.slice(0, 80));

  console.log("\n8. Open again + '제안 적용 + 전송' sends");
  await page.fill('[data-testid="chat-input-textarea"]', "이거 바꿔줘");
  await page.click('[data-testid="chat-prompt-check"]');
  await page.waitForSelector('[data-testid="prompt-check-dialog"]');
  await page.click('[data-testid="prompt-check-run"]');
  await page.waitForSelector('[data-testid="prompt-issues"]');
  await page.click('[data-testid="prompt-apply-send"]');
  await page.waitForSelector('[data-testid="prompt-check-dialog"]', { state: "detached" });
  const lastSent2 = await page.$eval('[data-testid="last-sent"]', (el) => el.textContent ?? "");
  check(
    "message sent with refined text",
    lastSent2.includes("src/App.tsx"),
    lastSent2.slice(0, 80),
  );
  const cleared = await page.$eval('[data-testid="chat-input-textarea"]', (el) => el.value);
  check("textarea cleared after send", cleared === "", cleared);

  console.log("\n9. Ctrl+Shift+Enter opens dialog too");
  await page.fill('[data-testid="chat-input-textarea"]', "그거 수정해줘");
  await page.focus('[data-testid="chat-input-textarea"]');
  await page.keyboard.press("Control+Shift+Enter");
  const dialogAfterShortcut = await page.$('[data-testid="prompt-check-dialog"]');
  check("dialog opens via shortcut", dialogAfterShortcut !== null);

  console.log(`\n---\nTotal: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
