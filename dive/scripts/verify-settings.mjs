// Playwright verification for task 4-2 — settings page.
// Run with: node scripts/verify-settings.mjs
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

  console.log("1. Navigate to ?demo=settings");
  await page.goto(`${BASE}/?demo=settings`);
  await page.waitForSelector('[data-testid="settings-page"]');

  console.log("\n2. Three sections render");
  check("providers section", (await page.$('[data-testid="settings-section-providers"]')) !== null);
  check("policy section", (await page.$('[data-testid="settings-section-policy"]')) !== null);
  check("theme section", (await page.$('[data-testid="settings-section-theme"]')) !== null);

  console.log("\n3. Five provider cards");
  const cards = await page.$$('[data-testid="provider-card"]');
  check("5 provider cards", cards.length === 5, `got ${cards.length}`);
  for (const kind of ["anthropic", "openai", "openrouter", "codex", "mock"]) {
    const el = await page.$(`[data-testid="provider-card"][data-provider-kind="${kind}"]`);
    check(`${kind} card`, el !== null);
  }

  console.log("\n4. Codex is GA (5-1), Mock is disabled (dev-only)");
  const codexDisabled = await page.$eval(
    '[data-testid="provider-connect-btn"][data-provider-kind="codex"]',
    (el) => el.disabled,
  );
  check("codex connect enabled (5-1)", codexDisabled === false);
  const codexLabel = await page.$eval(
    '[data-testid="provider-connect-btn"][data-provider-kind="codex"]',
    (el) => el.textContent?.trim() ?? "",
  );
  check("codex button labelled ChatGPT 연결", codexLabel.includes("ChatGPT 연결"), codexLabel);
  const mockDisabled = await page.$eval(
    '[data-testid="provider-connect-btn"][data-provider-kind="mock"]',
    (el) => el.disabled,
  );
  check("mock connect disabled", mockDisabled === true);

  console.log("\n5. Policy rows — 3 safe toggles + 2 warn locked");
  const safeRows = await page.$$('[data-testid="policy-row"]');
  check("3 safe policy rows", safeRows.length === 3, `got ${safeRows.length}`);
  const lockedRows = await page.$$('[data-testid="policy-row-locked"]');
  check("2 warn-locked rows", lockedRows.length === 2, `got ${lockedRows.length}`);

  console.log("\n6. Toggle read_file policy — persists in localStorage");
  await page.click('[data-testid="policy-toggle"][data-tool="read_file"]');
  await page.waitForTimeout(100);
  const stored = await page.evaluate(() => window.localStorage.getItem("dive:auto-approve-policy"));
  check("policy persisted", stored !== null && stored.includes("read_file"), String(stored));

  console.log("\n7. Click anthropic connect → key input appears");
  await page.click('[data-testid="provider-connect-btn"][data-provider-kind="anthropic"]');
  await page.waitForSelector('[data-testid="provider-key-input"][data-provider-kind="anthropic"]', {
    timeout: 1000,
  });
  check("anthropic key input visible", true);

  console.log("\n8. Enter key + submit → provider shown as connected");
  await page.fill(
    '[data-testid="provider-key-input"][data-provider-kind="anthropic"]',
    "sk-test-xyz",
  );
  await page.click('[data-testid="provider-submit"][data-provider-kind="anthropic"]');
  await page.waitForTimeout(400);
  const connectedAttr = await page.$eval(
    '[data-testid="provider-card"][data-provider-kind="anthropic"]',
    (el) => el.getAttribute("data-connected"),
  );
  check("anthropic now connected", connectedAttr === "true", String(connectedAttr));

  console.log("\n9. Theme toggle changes data-theme");
  const themeBefore = await page.$eval('[data-testid="settings-theme-toggle"]', (el) =>
    el.getAttribute("data-theme"),
  );
  await page.click('[data-testid="settings-theme-toggle"]');
  await page.waitForTimeout(100);
  const themeAfter = await page.$eval('[data-testid="settings-theme-toggle"]', (el) =>
    el.getAttribute("data-theme"),
  );
  check("theme toggled", themeBefore !== themeAfter, `${themeBefore} -> ${themeAfter}`);

  console.log("\n10. Back button removes demo param");
  await page.click('[data-testid="settings-back"]');
  await page.waitForTimeout(300);
  const url = page.url();
  check("back returns to root", !url.includes("demo=settings"), url);

  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
