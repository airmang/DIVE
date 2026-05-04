// Playwright verification for task 6-1 — i18n (ko/en) switch.
// Run with: node scripts/verify-i18n.mjs
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

  console.log("1. Clear storage, mark onboarded");
  await page.goto(BASE);
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem("dive:onboarded", "true");
  });
  await page.reload();
  await page.waitForSelector('[data-testid="sidebar"]');

  console.log("\n2. Language switch is visible with both locales");
  const switchEl = await page.$('[data-testid="language-switch"]');
  check("language switch exists", switchEl !== null);
  const koBtn = await page.$('[data-testid="lang-ko"]');
  const enBtn = await page.$('[data-testid="lang-en"]');
  check("ko toggle exists", koBtn !== null);
  check("en toggle exists", enBtn !== null);

  console.log("\n3. Default locale matches OS (ko-KR → ko active)");
  const koActive = await page.$eval('[data-testid="lang-ko"]', (el) => el.dataset.active);
  check("ko active by default for ko-KR OS", koActive === "true");

  console.log("\n4. Korean strings render");
  const sidebarText = await page.$eval('[data-testid="sidebar"]', (el) => el.textContent || "");
  check(
    "Korean 프로젝트 section header",
    sidebarText.includes("프로젝트"),
    sidebarText.slice(0, 60),
  );
  check("Korean 새 프로젝트 button label", sidebarText.includes("새 프로젝트"));

  console.log("\n5. Switching to English updates UI strings");
  await page.click('[data-testid="lang-en"]');
  await page.waitForTimeout(200);
  const enActive = await page.$eval('[data-testid="lang-en"]', (el) => el.dataset.active);
  check("en toggle active after click", enActive === "true");
  const sidebarTextEn = await page.$eval('[data-testid="sidebar"]', (el) => el.textContent || "");
  check("English Projects section header", sidebarTextEn.includes("Projects"));
  check("English New project button label", sidebarTextEn.includes("New project"));

  console.log("\n6. Locale persists across reloads");
  await page.reload();
  await page.waitForSelector('[data-testid="sidebar"]');
  const sidebarTextReload = await page.$eval(
    '[data-testid="sidebar"]',
    (el) => el.textContent || "",
  );
  check(
    "English persisted after reload",
    sidebarTextReload.includes("Projects"),
    sidebarTextReload.slice(0, 60),
  );
  const enActive2 = await page.$eval('[data-testid="lang-en"]', (el) => el.dataset.active);
  check("en still active after reload", enActive2 === "true");

  console.log("\n7. Switching back to Korean works");
  await page.click('[data-testid="lang-ko"]');
  await page.waitForTimeout(200);
  const sidebarTextKo = await page.$eval('[data-testid="sidebar"]', (el) => el.textContent || "");
  check("Korean strings restored", sidebarTextKo.includes("프로젝트"));

  console.log("\n8. localStorage contains dive:locale");
  const localeStored = await page.evaluate(() => {
    const raw = window.localStorage.getItem("dive:locale");
    if (!raw) return null;
    try {
      return JSON.parse(raw).state.locale;
    } catch {
      return null;
    }
  });
  check("dive:locale persists ko", localeStored === "ko", String(localeStored));

  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
