// Playwright verification for task 5-2 (MCP settings UI + backend registry).
// Run with: node scripts/verify-mcp-setup.mjs
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
  await page.goto(`${BASE}/?demo=settings`);
  await page.evaluate(() => window.localStorage.removeItem("dive:mcp-servers"));
  await page.reload();
  await page.waitForSelector('[data-testid="settings-section-mcp"]');

  console.log("\n2. MCP section renders with empty state and form");
  check("mcp empty visible", (await page.$('[data-testid="mcp-empty"]')) !== null);
  check("mcp form visible", (await page.$('[data-testid="mcp-form"]')) !== null);
  check("mcp label input present", (await page.$('[data-testid="mcp-label"]')) !== null);
  check("mcp transport select present", (await page.$('[data-testid="mcp-transport"]')) !== null);

  console.log("\n3. Add button disabled when label empty");
  const addBtn = await page.$('[data-testid="mcp-add-submit"]');
  const disabled0 = await addBtn.evaluate((el) => el.disabled);
  check("add disabled initially", disabled0 === true);

  console.log("\n4. Add stdio server — row appears, empty state hidden");
  await page.fill('[data-testid="mcp-label"]', "fs");
  await page.fill('[data-testid="mcp-command"]', "npx");
  await page.fill(
    '[data-testid="mcp-args"]',
    "@modelcontextprotocol/server-filesystem\n/tmp/project",
  );
  await page.click('[data-testid="mcp-add-submit"]');
  await page.waitForSelector('[data-testid="mcp-server-row"][data-mcp-label="fs"]');
  check("empty state removed", (await page.$('[data-testid="mcp-empty"]')) === null);
  const stdioRow = await page.$('[data-testid="mcp-server-row"][data-mcp-label="fs"]');
  check("stdio row rendered", stdioRow !== null);
  const stdioText = await stdioRow.evaluate((el) => el.textContent ?? "");
  check("row shows stdio transport", stdioText.includes("stdio"), stdioText.slice(0, 60));
  check("row shows command", stdioText.includes("npx"), stdioText.slice(0, 60));

  console.log("\n5. Switch to http transport and add second server");
  await page.selectOption('[data-testid="mcp-transport"]', "http");
  await page.fill('[data-testid="mcp-label"]', "grading");
  await page.fill('[data-testid="mcp-url"]', "https://grading.example.com/rpc");
  await page.selectOption('[data-testid="mcp-default-risk"]', "safe");
  await page.click('[data-testid="mcp-add-submit"]');
  await page.waitForSelector('[data-testid="mcp-server-row"][data-mcp-label="grading"]');
  const httpRow = await page.$('[data-testid="mcp-server-row"][data-mcp-label="grading"]');
  const httpText = await httpRow.evaluate((el) => el.textContent ?? "");
  check("http row shows http transport", httpText.includes("http"), httpText.slice(0, 80));
  check("http row shows url", httpText.includes("grading.example.com"));
  check("http row shows safe risk", httpText.includes("safe"));

  console.log("\n6. Test connect (mock) renders result message");
  await page.click('[data-testid="mcp-test-connect"][data-mcp-label="grading"]');
  await page.waitForSelector('[data-testid="mcp-test-result"]');
  const testResultText = await page.$eval(
    '[data-testid="mcp-test-result"]',
    (el) => el.textContent ?? "",
  );
  check(
    "test result mentions mock success",
    testResultText.includes("mock") || testResultText.includes("연결"),
    testResultText,
  );

  console.log("\n7. Remove server");
  await page.click('[data-testid="mcp-remove"][data-mcp-label="fs"]');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="mcp-server-row"][data-mcp-label="fs"]'),
  );
  const stillThere = await page.$('[data-testid="mcp-server-row"][data-mcp-label="fs"]');
  check("fs row removed", stillThere === null);

  console.log("\n8. Reload preserves remaining server (localStorage persistence)");
  await page.reload();
  await page.waitForSelector('[data-testid="settings-section-mcp"]');
  const gradingAfterReload = await page.$(
    '[data-testid="mcp-server-row"][data-mcp-label="grading"]',
  );
  check("grading persists across reload", gradingAfterReload !== null);

  console.log("\n9. Regression — other settings sections unaffected");
  check("providers section", (await page.$('[data-testid="settings-section-providers"]')) !== null);
  check("policy section", (await page.$('[data-testid="settings-section-policy"]')) !== null);
  check("theme section", (await page.$('[data-testid="settings-section-theme"]')) !== null);

  console.log(`\n---\nTotal: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
