// Playwright verification for task 5-6 (Phase 5 v0.3 integration).
// Run with: node scripts/verify-phase5-integration.mjs
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
    window.localStorage.setItem("dive:onboarded", "true");
  });

  console.log("1. Landing page renders all 5 feature cards");
  await page.goto(`${BASE}/?demo=phase5`);
  await page.waitForSelector('[data-testid="phase5-integration-page"]');
  const cards = await page.$$('[data-testid="phase5-feature-card"]');
  check("5 feature cards", cards.length === 5, String(cards.length));
  for (const id of ["codex", "mcp-setup", "mcp-tools", "prompt-helper", "prompt-check"]) {
    const el = await page.$(`[data-testid="phase5-feature-card"][data-feature-id="${id}"]`);
    check(`card ${id}`, el !== null);
  }

  console.log("\n2. Rust summary banner rendered");
  const summary = await page.$eval(
    '[data-testid="phase5-rust-summary"]',
    (el) => el.textContent ?? "",
  );
  check("rust summary shows passed count", summary.includes("passed"), summary);

  console.log("\n3. Navigate to Codex demo via card");
  await page.click('[data-testid="phase5-open-demo"][data-feature-id="codex"]');
  await page.waitForSelector('[data-testid="settings-page"]');
  const codexCardOnSettings = await page.$(
    '[data-testid="provider-card"][data-provider-kind="codex"]',
  );
  check("landed on settings with codex card", codexCardOnSettings !== null);

  console.log("\n4. Back and navigate to MCP-tools demo");
  await page.goto(`${BASE}/?demo=phase5`);
  await page.waitForSelector('[data-testid="phase5-integration-page"]');
  await page.click('[data-testid="phase5-open-demo"][data-feature-id="mcp-tools"]');
  await page.waitForSelector('[data-testid="mcp-demo-page"]');
  const mcpProvenance = await page.$$('[data-testid="mcp-provenance"]');
  check("mcp demo renders provenance badges", mcpProvenance.length >= 4, String(mcpProvenance.length));

  console.log("\n5. Back and navigate to prompt-helper demo");
  await page.goto(`${BASE}/?demo=phase5`);
  await page.waitForSelector('[data-testid="phase5-integration-page"]');
  await page.click('[data-testid="phase5-open-demo"][data-feature-id="prompt-helper"]');
  await page.waitForSelector('[data-testid="prompt-helper-demo-page"]');

  console.log("\n6. End-to-end: trigger ambiguity + prompt check from one input");
  await page.fill('[data-testid="chat-input-textarea"]', "이거 고쳐줘");
  await page.waitForSelector('[data-testid="ambiguity-hint-list"]', { timeout: 2000 });
  const hintCount = await page.$$eval(
    '[data-testid="ambiguity-hint"]',
    (els) => els.length,
  );
  check("local ambiguity hints detected", hintCount >= 1, String(hintCount));

  await page.click('[data-testid="chat-prompt-check"]');
  await page.waitForSelector('[data-testid="prompt-check-dialog"]');
  await page.click('[data-testid="prompt-check-run"]');
  await page.waitForSelector('[data-testid="prompt-issues"]');
  const issuesRendered = await page.$$eval(
    '[data-testid="prompt-issue"]',
    (els) => els.length,
  );
  check("AI critique issues rendered", issuesRendered >= 1, String(issuesRendered));
  const usageText = await page.$eval(
    '[data-testid="prompt-usage"]',
    (el) => el.textContent ?? "",
  );
  check("token usage displayed", /\d/.test(usageText), usageText);
  await page.keyboard.press("Escape");

  console.log("\n7. Return to main shell via 'back'");
  await page.goto(`${BASE}/?demo=phase5`);
  await page.waitForSelector('[data-testid="phase5-integration-page"]');
  await page.click('[data-testid="phase5-back"]');
  await page.waitForTimeout(300);
  const url = page.url();
  check("phase5 demo param removed", !url.includes("demo=phase5"), url);

  console.log(`\n---\nTotal: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
