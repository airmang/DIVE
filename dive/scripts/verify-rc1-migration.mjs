// Playwright verification for task 7-13 — rc.1 yanked-build localStorage migration.
// Run with: node scripts/verify-rc1-migration.mjs
// Requires dev server on http://localhost:1420.

import { chromium } from "./_playwright-loader.mjs";

const BASE = "http://localhost:1420";
const REMOVED_KEYS = [
  "dive:project-session",
  "dive:current-project-id",
  "dive:current-session-id",
  "dive:onboarded",
];
const PRESERVED = {
  "dive:locale": "ko",
  "dive.theme": "light",
};
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
  await context.addInitScript(
    ({ removed, preserved }) => {
      if (window.sessionStorage.getItem("dive:rc1_seeded") === "true") return;
      window.sessionStorage.setItem("dive:rc1_seeded", "true");
      window.localStorage.clear();
      for (const key of removed) window.localStorage.setItem(key, `rc1-${key}`);
      for (const [key, value] of Object.entries(preserved)) window.localStorage.setItem(key, value);
    },
    { removed: REMOVED_KEYS, preserved: PRESERVED },
  );
  const page = await context.newPage();

  console.log("1. rc.1 keys trigger one-time migration dialog");
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="rc1-migration-dialog"]', { timeout: 3000 });
  check("migration dialog rendered", true);
  const removedCount = await page.textContent('[data-testid="rc1-removed-count"]');
  check("removed key count visible", removedCount?.includes("4개") === true, removedCount ?? "");

  console.log("\n2. rc.1 demo keys removed and locale/theme preserved before acknowledgement");
  const storageAfterLoad = await page.evaluate((removed) => {
    const removedValues = Object.fromEntries(
      removed.map((key) => [key, window.localStorage.getItem(key)]),
    );
    return {
      removedValues,
      locale: window.localStorage.getItem("dive:locale"),
      theme: window.localStorage.getItem("dive.theme"),
      migrated: window.localStorage.getItem("dive:rc1_migrated"),
    };
  }, REMOVED_KEYS);
  check(
    "all rc.1 keys removed",
    Object.values(storageAfterLoad.removedValues).every((value) => value === null),
    JSON.stringify(storageAfterLoad.removedValues),
  );
  check("locale preserved", storageAfterLoad.locale === "ko", String(storageAfterLoad.locale));
  check("theme preserved", storageAfterLoad.theme === "light", String(storageAfterLoad.theme));
  check(
    "migration flag not set before confirm",
    storageAfterLoad.migrated !== "true",
    String(storageAfterLoad.migrated),
  );

  console.log("\n3. Confirm stores flag and prevents re-display");
  await page.click('[data-testid="rc1-migration-confirm"]');
  await page.waitForSelector('[data-testid="rc1-migration-dialog"]', {
    state: "detached",
    timeout: 1500,
  });
  const flag = await page.evaluate(() => window.localStorage.getItem("dive:rc1_migrated"));
  check("confirm stores rc1 migration flag", flag === "true", String(flag));
  await page.reload();
  await page.waitForSelector('[data-testid="main-shell"]', { timeout: 3000 });
  check(
    "dialog does not re-open after reload",
    (await page.$('[data-testid="rc1-migration-dialog"]')) === null,
  );

  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  await context.close();
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
