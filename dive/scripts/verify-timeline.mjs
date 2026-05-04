// Playwright verification for task 4-2 — checkpoint timeline.
// Run with: node scripts/verify-timeline.mjs
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

  console.log("1. Navigate to ?demo=timeline");
  await page.goto(`${BASE}/?demo=timeline`);
  await page.waitForSelector('[data-testid="timeline-demo-shell"]');

  console.log("\n2. Timeline renders 3 seed dots");
  const dots = await page.$$('[data-testid="timeline-dot"]');
  check("3 dots", dots.length === 3, `got ${dots.length}`);
  const kinds = await page.$$eval('[data-testid="timeline-dot"]', (els) =>
    els.map((e) => e.getAttribute("data-kind")),
  );
  check("init dot exists", kinds.includes("init"));
  check("auto dot exists", kinds.includes("auto"));
  check("manual dot exists", kinds.includes("manual"));

  console.log("\n3. Hover first dot → tooltip visible");
  await page.hover('[data-testid="timeline-dot"][data-kind="init"]');
  await page.waitForSelector('[data-testid="timeline-tooltip"]', { timeout: 1000 });
  check("tooltip appears on hover", true);

  console.log("\n4. Restore button inside tooltip");
  const restoreBtn = await page.$('[data-testid="timeline-restore"]');
  check("restore button present", restoreBtn !== null);

  console.log("\n5. Hover auto dot → file change metadata visible");
  await page.hover('[data-testid="timeline-dot"][data-kind="auto"]');
  await page.waitForSelector('[data-testid="timeline-file-changes"]', { timeout: 1000 });
  const fileChanges = await page.$eval('[data-testid="timeline-file-changes"]', (el) =>
    el.textContent?.trim(),
  );
  const fileList = await page.$eval('[data-testid="timeline-file-list"]', (el) =>
    el.textContent?.trim(),
  );
  check("file change count is not fixed zero", fileChanges?.includes("파일 변경 2개"));
  check("file list tooltip includes changed file", fileList?.includes("src/LoginForm.tsx"));

  console.log("\n6. Click restore → log receives entry");
  const autoRestoreBtn = await page.$('[data-testid="timeline-restore"]');
  await autoRestoreBtn.click();
  await page.waitForTimeout(200);
  const log = await page.$$('[data-testid="timeline-log"]');
  check("log has entry", log.length >= 1, `got ${log.length}`);

  console.log("\n7. Active state updates on restore");
  const activeDots = await page.$$('[data-testid="timeline-dot"][data-active="true"]');
  check("one active dot", activeDots.length === 1, `got ${activeDots.length}`);

  console.log("\n8. Add checkpoint → count goes to 4");
  await page.click('[data-testid="timeline-add"]');
  await page.waitForTimeout(200);
  const dotsAfter = await page.$$('[data-testid="timeline-dot"]');
  check("4 dots after add", dotsAfter.length === 4, `got ${dotsAfter.length}`);

  console.log("\n9. Clear all → empty state shown");
  await page.click('[data-testid="timeline-clear"]');
  await page.waitForTimeout(200);
  const empty = await page.$('[data-testid="checkpoint-timeline"][data-empty="true"]');
  check("empty state rendered", empty !== null);

  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
