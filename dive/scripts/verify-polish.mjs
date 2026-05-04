// Playwright verification for task 4-4 — polish (skeleton, empty states, restore dialog, toast).
// Run with: node scripts/verify-polish.mjs
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "ko-KR",
  });
  const page = await context.newPage();

  console.log("1. Navigate to ?demo=polish");
  await page.goto(`${BASE}/?demo=polish`);
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => {
    const persisted = window.localStorage.getItem("dive:locale");
    if (persisted) {
      try {
        const parsed = JSON.parse(persisted);
        parsed.state.locale = "ko";
        window.localStorage.setItem("dive:locale", JSON.stringify(parsed));
      } catch {
        window.localStorage.removeItem("dive:locale");
      }
    }
  });
  await page.reload();
  await page.waitForSelector('[data-testid="polish-demo-shell"]');

  console.log("\n2. Skeletons render initially");
  const skeletons = await page.$$('[data-testid="skeleton"]');
  check("skeletons visible", skeletons.length >= 3, `got ${skeletons.length}`);

  console.log("\n3. Toggle off → skeletons disappear");
  await page.click('[data-testid="skeleton-toggle-projects"]');
  await page.waitForTimeout(200);
  const afterToggle = await page.$$('[data-testid="skeleton"]');
  check(
    "fewer skeletons after toggle off",
    afterToggle.length < skeletons.length,
    `${skeletons.length} -> ${afterToggle.length}`,
  );

  console.log("\n4. Four empty states all render");
  for (const k of ["empty-project", "empty-session", "empty-messages", "empty-cards"]) {
    const el = await page.$(`[data-testid="${k}"]`);
    check(`${k} rendered`, el !== null);
  }

  console.log("\n5. Ctrl+S test toast fires success");
  await page.click('[data-testid="btn-save-ctrl-s"]');
  await page.waitForSelector('[data-testid="toast"][data-variant="success"]', {
    timeout: 1500,
  });
  const title = await page.textContent('[data-testid="toast"] .font-semibold');
  check("ctrl+s toast contains 체크포인트", title?.includes("체크포인트") ?? false, title ?? "");

  console.log("\n6. Open restore dialog");
  await page.click('[data-testid="btn-open-restore"]');
  await page.waitForSelector('[data-testid="restore-confirm-dialog"]', {
    timeout: 1500,
  });
  const targetLabel = await page.textContent('[data-testid="restore-target-label"]');
  check("restore label rendered", targetLabel?.includes("V 통과") ?? false, targetLabel ?? "");

  console.log("\n7. Confirm restore → info + success toasts");
  await page.click('[data-testid="restore-confirm"]');
  await page.waitForSelector('[data-testid="toast"][data-variant="info"]', {
    timeout: 1500,
  });
  await page.waitForSelector('[data-testid="toast"][data-variant="success"]', {
    timeout: 2000,
  });
  check("info + success toasts after restore", true);

  console.log("\n8. Cancel restore keeps dialog closed");
  await page.click('[data-testid="btn-open-restore"]');
  await page.waitForSelector('[data-testid="restore-confirm-dialog"]', {
    timeout: 1000,
  });
  await page.click('[data-testid="restore-cancel"]');
  await page.waitForTimeout(300);
  const stillOpen = await page.$('[data-testid="restore-confirm-dialog"]');
  check("restore dialog closed after cancel", stillOpen === null);

  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
