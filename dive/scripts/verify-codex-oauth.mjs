// Playwright verification for task 5-1 (Codex OAuth dialog + settings integration).
// Run with: node scripts/verify-codex-oauth.mjs
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
    window.localStorage.removeItem("dive:codex-connected");
  });

  console.log("1. Navigate to settings");
  await page.goto(`${BASE}/?demo=settings`);
  await page.waitForSelector('[data-testid="settings-section-providers"]');

  console.log("\n2. Codex card is present and GA (not disabled)");
  const codexCard = await page.$('[data-testid="provider-card"][data-provider-kind="codex"]');
  check("codex card exists", codexCard !== null);
  const codexConnectBtn = await page.$(
    '[data-testid="provider-connect-btn"][data-provider-kind="codex"]',
  );
  check("codex connect button exists", codexConnectBtn !== null);
  const codexBtnText = await codexConnectBtn.evaluate((el) => el.textContent?.trim() ?? "");
  check("codex button says 'ChatGPT 연결'", codexBtnText.includes("ChatGPT 연결"), codexBtnText);
  const codexDisabled = await codexConnectBtn.evaluate((el) => el.disabled);
  check("codex button is not disabled", codexDisabled === false);

  console.log("\n3. Click opens dialog in idle phase");
  await codexConnectBtn.click();
  await page.waitForSelector('[data-testid="codex-oauth-dialog"]');
  const phase0 = await page.$eval('[data-testid="codex-oauth-dialog"]', (el) =>
    el.getAttribute("data-phase"),
  );
  check("initial phase is idle", phase0 === "idle", phase0);
  check("start button present", (await page.$('[data-testid="codex-start"]')) !== null);

  console.log("\n4. Start the flow (browser fallback path, no Tauri)");
  await page.click('[data-testid="codex-start"]');
  await page.waitForSelector('[data-testid="codex-phase-waiting"]');
  const authUrl = await page.$eval(
    '[data-testid="codex-auth-url"]',
    (el) => el.textContent?.trim() ?? "",
  );
  check("auth URL contains /oauth/authorize", authUrl.includes("/oauth/authorize"), authUrl);
  check(
    "auth URL contains response_type=code",
    authUrl.includes("response_type=code"),
    authUrl.slice(0, 80),
  );
  check("auth URL contains state=", authUrl.includes("state="));

  console.log("\n5. Expected state data attribute matches returned state input");
  const expectedState = await page.$eval(
    '[data-testid="codex-state-expected"]',
    (el) => el.getAttribute("data-expected") ?? "",
  );
  const inputStateValue = await page.$eval('[data-testid="codex-state-input"]', (el) => el.value);
  check("returned state pre-filled with csrf state", inputStateValue === expectedState);

  console.log("\n6. Complete disabled when code empty");
  const completeBtn = await page.$('[data-testid="codex-complete"]');
  const disabledInitial = await completeBtn.evaluate((el) => el.disabled);
  check("complete button disabled without code", disabledInitial === true);

  console.log("\n7. Fill code and submit — browser mock transitions to done phase");
  await page.fill('[data-testid="codex-code-input"]', "browser-mock-code");
  await page.click('[data-testid="codex-complete"]');
  await page.waitForSelector('[data-testid="codex-phase-done"]');
  const phase1 = await page.$eval('[data-testid="codex-oauth-dialog"]', (el) =>
    el.getAttribute("data-phase"),
  );
  check("phase is done", phase1 === "done", phase1);

  console.log("\n8. Close dialog and verify card shows connected + account hint");
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="codex-oauth-dialog"]', { state: "detached" });
  const codexCardConnected = await page.$eval(
    '[data-testid="provider-card"][data-provider-kind="codex"]',
    (el) => el.getAttribute("data-connected") === "true",
  );
  check("codex card marked connected after flow", codexCardConnected);
  const acct = await page.$eval(
    '[data-testid="codex-account-id"]',
    (el) => el.textContent?.trim() ?? "",
  );
  check("account id hint rendered", acct.includes("acct_mock"), acct);

  console.log("\n9. Disconnect flow clears codex connected state");
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="provider-disconnect"][data-provider-kind="codex"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="provider-card"][data-provider-kind="codex"]')
        ?.getAttribute("data-connected") === "false",
  );
  const connectedAfter = await page.$eval(
    '[data-testid="provider-card"][data-provider-kind="codex"]',
    (el) => el.getAttribute("data-connected"),
  );
  check("codex disconnected after logout", connectedAfter === "false");

  console.log("\n10. Regression — other provider cards still render");
  const anthropicBtn = await page.$(
    '[data-testid="provider-connect-btn"][data-provider-kind="anthropic"]',
  );
  check("anthropic connect button present", anthropicBtn !== null);
  const openrouterBtn = await page.$(
    '[data-testid="provider-connect-btn"][data-provider-kind="openrouter"]',
  );
  check("openrouter connect button present", openrouterBtn !== null);

  console.log(`\n---\nTotal: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
