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
    window.localStorage.setItem("dive:rc1_migrated", "true");
    window.localStorage.setItem("dive:onboarded", "true");
  });
  await page.reload();
  await page.waitForSelector('[data-testid="sidebar"]');

  console.log("\n2. Settings locale select is visible with both locales");
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("route", "settings");
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForSelector('[data-testid="settings-locale-select"]');
  const localeOptions = await page.$$eval('[data-testid="settings-locale-select"] option', (opts) =>
    opts.map((o) => o.value),
  );
  check("ko option exists", localeOptions.includes("ko"));
  check("en option exists", localeOptions.includes("en"));

  console.log("\n3. Default locale matches OS (ko-KR → ko active)");
  const defaultLocale = await page.$eval(
    '[data-testid="settings-locale-select"]',
    (el) => el.value,
  );
  check("ko selected by default for ko-KR OS", defaultLocale === "ko");

  console.log("\n4. Korean strings render");
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("route");
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForSelector('[data-testid="sidebar"]');
  const sidebarText = await page.$eval('[data-testid="sidebar"]', (el) => el.textContent || "");
  check(
    "Korean 프로젝트 section header",
    sidebarText.includes("프로젝트"),
    sidebarText.slice(0, 60),
  );
  check("Korean 새 프로젝트 button label", sidebarText.includes("새 프로젝트"));

  console.log("\n5. Switching to English updates UI strings");
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("route", "settings");
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForSelector('[data-testid="settings-locale-select"]');
  await page.selectOption('[data-testid="settings-locale-select"]', "en");
  await page.waitForTimeout(200);
  const enSelected = await page.$eval('[data-testid="settings-locale-select"]', (el) => el.value);
  check("en selected after change", enSelected === "en");
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("route");
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForSelector('[data-testid="sidebar"]');
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
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("route", "settings");
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForSelector('[data-testid="settings-locale-select"]');
  const enSelected2 = await page.$eval('[data-testid="settings-locale-select"]', (el) => el.value);
  check("en still selected after reload", enSelected2 === "en");

  console.log("\n7. Switching back to Korean works");
  await page.selectOption('[data-testid="settings-locale-select"]', "ko");
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("route");
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForSelector('[data-testid="sidebar"]');
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
