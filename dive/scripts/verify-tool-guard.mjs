// Playwright verification for task 3-4 (blocked command guard).
// Run with: node scripts/verify-tool-guard.mjs
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

  console.log("1. Navigate to ?demo=tool-guard");
  await page.goto(`${BASE}/?demo=tool-guard`);
  await page.waitForSelector('[data-testid="demo-section-intro"]');

  console.log("\n2. All three blocked cases render with tool-call-blocked testid");
  const blockedCount = await page.$$eval('[data-testid="tool-call-blocked"]', (els) => els.length);
  check("3 blocked cards rendered", blockedCount === 3, String(blockedCount));

  console.log("\n3. Every blocked card has data-status=blocked on the article");
  const statuses = await page.$$eval('[data-testid="chat-message"][data-kind="tool_call"]', (els) =>
    els.map((e) => e.getAttribute("data-status")),
  );
  check(
    "three blocked + one non-blocked",
    statuses.filter((s) => s === "blocked").length === 3,
    JSON.stringify(statuses),
  );

  console.log("\n4. Blocked cards do NOT render approve/deny buttons");
  const approveInsideBlocked = await page.$(
    '[data-testid="tool-call-blocked"] [data-testid="card-approve"]',
  );
  const denyInsideBlocked = await page.$(
    '[data-testid="tool-call-blocked"] [data-testid="card-deny"]',
  );
  check("no approve button in blocked cards", approveInsideBlocked === null);
  check("no deny button in blocked cards", denyInsideBlocked === null);

  console.log("\n5. rm -rf / case surfaces rule name");
  const rmCase = await page.$eval('[data-testid="case-rm-rf"]', (el) => el.textContent ?? "");
  check(
    "rm -rf case mentions rule",
    rmCase.includes("rm -rf"),
    rmCase.length ? "found" : "missing",
  );
  check("rm -rf case mentions 차단 규칙", rmCase.includes("차단 규칙"));

  console.log("\n6. curl-pipe-shell case mentions the rule");
  const curlCase = await page.$eval(
    '[data-testid="case-curl-pipe-sh"]',
    (el) => el.textContent ?? "",
  );
  check(
    "curl-pipe-shell rule visible",
    curlCase.includes("curl-pipe-shell"),
    curlCase.includes("curl") ? "found" : "missing",
  );

  console.log("\n7. mkfs case mentions mkfs rule");
  const mkfsCase = await page.$eval('[data-testid="case-mkfs"]', (el) => el.textContent ?? "");
  check("mkfs case mentions mkfs", mkfsCase.includes("mkfs"));

  console.log("\n8. Every blocked card shows the §9.2 안전 정책 copy");
  const allText = await page.$$eval('[data-testid="tool-call-blocked"]', (els) =>
    els.map((e) => e.textContent ?? ""),
  );
  check(
    "every blocked card references §9.2",
    allText.every((t) => t.includes("§9.2")),
    `${allText.length} cards checked`,
  );

  console.log("\n9. '실행 불가' label on every blocked header");
  const labelCount = await page.$$eval(
    '[data-testid="tool-call-blocked"] header',
    (els) => els.filter((e) => (e.textContent ?? "").includes("실행 불가")).length,
  );
  check("label '실행 불가' shown 3x", labelCount === 3, String(labelCount));

  console.log("\n10. Normal approved card coexists (control)");
  const normalCard = await page.$('[data-testid="case-normal"] [data-kind="tool_call"]');
  check("normal approved card present", normalCard !== null);
  const normalStatus = await normalCard?.getAttribute("data-status");
  check("normal card status is 'approved'", normalStatus === "approved", String(normalStatus));

  console.log("\n11. Navigate away, main shell still works");
  await page.goto(BASE);
  await page.waitForTimeout(300);
  const shell = await page.$('[data-testid="workmap-strip"]');
  check("main shell still works", !!shell);

  console.log("\n12. chat demo still reachable");
  await page.goto(`${BASE}/?demo=chat`);
  await page.waitForTimeout(300);
  const chatSec = await page.$('[data-testid="demo-section-six"]');
  check("chat demo still reachable", !!chatSec);

  console.log("\n13. permission demo still reachable");
  await page.goto(`${BASE}/?demo=permission`);
  await page.waitForTimeout(300);
  const permSec = await page.$('[data-testid="demo-section-safe"]');
  check("permission demo still reachable", !!permSec);

  console.log("\n14. back to tool-guard then blocked cards still render");
  await page.goto(`${BASE}/?demo=tool-guard`);
  await page.waitForSelector('[data-testid="tool-call-blocked"]');
  const c2 = await page.$$eval('[data-testid="tool-call-blocked"]', (els) => els.length);
  check("blocked cards still 3 after nav", c2 === 3, String(c2));

  await browser.close();

  console.log(`\n\nTotal: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
