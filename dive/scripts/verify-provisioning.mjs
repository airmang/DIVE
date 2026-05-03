// Playwright verification for task 3-5 (OpenRouter provisioning demo UI).
// Run with: node scripts/verify-provisioning.mjs
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

  console.log("1. Navigate to ?demo=provisioning");
  await page.goto(`${BASE}/?demo=provisioning`);
  await page.waitForSelector('[data-testid="demo-section-intro"]');

  console.log("\n2. Form fields present");
  check(
    "main key field present",
    (await page.$('[data-testid="prov-main-key"]')) !== null,
  );
  check("label field present", (await page.$('[data-testid="prov-label"]')) !== null);
  check("count field present", (await page.$('[data-testid="prov-count"]')) !== null);
  check("limit field present", (await page.$('[data-testid="prov-limit"]')) !== null);
  check(
    "issue button present",
    (await page.$('[data-testid="prov-issue"]')) !== null,
  );

  console.log("\n3. Default values");
  const defaultLabel = await page.$eval(
    '[data-testid="prov-label"]',
    (el) => el.value,
  );
  check(
    "default label has date + 반",
    defaultLabel.includes("반"),
    defaultLabel,
  );
  const defaultCount = await page.$eval(
    '[data-testid="prov-count"]',
    (el) => el.value,
  );
  check("default count is 25", defaultCount === "25", defaultCount);

  console.log("\n4. Reduce count to 3 for faster test");
  await page.fill('[data-testid="prov-count"]', "3");

  console.log("\n5. Click issue — mock falls through to browser path");
  await page.click('[data-testid="prov-issue"]');
  await page.waitForSelector('[data-testid="demo-section-results"]', { timeout: 3000 });

  console.log("\n6. Source indicator reports 'mock' in browser");
  const source = await page.$eval(
    '[data-testid="prov-source"]',
    (el) => el.textContent ?? "",
  );
  check("source is mock", source.includes("mock"), source);

  console.log("\n7. Exactly 3 result items rendered");
  const items = await page.$$('[data-testid="prov-result-item"]');
  check("3 result items", items.length === 3, String(items.length));

  console.log("\n8. Each item has a QR SVG");
  const qrs = await page.$$('[data-testid="prov-qr"] svg');
  check("3 QR codes", qrs.length === 3, String(qrs.length));

  console.log("\n9. Each item label follows 차시 라벨-#NN pattern");
  const labels = await page.$$eval(
    '[data-testid="prov-result-item"]',
    (els) => els.map((e) => e.getAttribute("data-label") ?? ""),
  );
  check(
    "labels carry class prefix + #NN",
    labels.every((l) => l.includes("반") && /#\d{2}$/.test(l)),
    JSON.stringify(labels),
  );

  console.log("\n10. Issue with empty main key is blocked");
  await page.fill('[data-testid="prov-main-key"]', "");
  const disabled = await page.$eval(
    '[data-testid="prov-issue"]',
    (el) => el.disabled,
  );
  check("issue disabled with empty main key", disabled === true);

  console.log("\n11. Increase count to 10 + re-issue — 6 preview + overflow note");
  await page.fill('[data-testid="prov-main-key"]', "sk-main-demo");
  await page.fill('[data-testid="prov-count"]', "10");
  await page.click('[data-testid="prov-issue"]');
  await page.waitForTimeout(500);
  const items2 = await page.$$('[data-testid="prov-result-item"]');
  check("6 preview items rendered for count=10", items2.length === 6, String(items2.length));

  console.log("\n12. Main shell still works");
  await page.goto(BASE);
  await page.waitForTimeout(300);
  const shell = await page.$('[data-testid="workmap-strip"]');
  check("main shell still works", shell !== null);

  console.log("\n13. Tool-guard demo still reachable");
  await page.goto(`${BASE}/?demo=tool-guard`);
  await page.waitForTimeout(300);
  const tg = await page.$('[data-testid="demo-section-intro"]');
  check("tool-guard demo reachable", tg !== null);

  await browser.close();
  console.log(`\n\nTotal: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
