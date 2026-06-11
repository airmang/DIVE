// Playwright verification for task 6-2 — accessibility (keyboard shortcuts + ARIA + aria-live).
// Run with: node scripts/verify-a11y.mjs
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

  console.log("1. Main shell loads with sidebar aria-label");
  await page.goto(BASE);
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem("dive:rc1_migrated", "true");
    window.localStorage.setItem("dive:onboarded", "true");
  });
  await page.reload();
  await page.waitForSelector('[data-testid="sidebar"]');

  const sidebarLabel = await page.$eval(
    '[data-testid="sidebar"]',
    (el) => el.getAttribute("aria-label") || "",
  );
  check("sidebar has aria-label", sidebarLabel.length > 0, sidebarLabel);

  console.log("\n2. Toast stack has polite aria-live");
  const toastLive = await page.$eval(
    '[data-testid="toast-stack"]',
    (el) => el.getAttribute("aria-live") || "",
  );
  check("toast-stack aria-live=polite", toastLive === "polite", toastLive);
  const toastRole = await page.$eval(
    '[data-testid="toast-stack"]',
    (el) => el.getAttribute("role") || "",
  );
  check("toast-stack role=region", toastRole === "region", toastRole);

  console.log("\n3. Ctrl+S triggers manual checkpoint toast");
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(200);
  const toastCount = await page.$$eval('[data-testid="toast"]', (els) => els.length);
  check("checkpoint toast appears", toastCount >= 1, String(toastCount));

  console.log("\n4. Ctrl+N opens new project dialog");
  await page.keyboard.press("Control+n");
  await page.waitForTimeout(200);
  const newProjectDialog = await page.$('[data-testid="new-project-dialog"]');
  check("new project dialog visible", newProjectDialog !== null);
  if (newProjectDialog) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  console.log("\n5. Ctrl+, routes to settings");
  await page.keyboard.press("Control+,");
  await page.waitForTimeout(300);
  const onSettings = await page.evaluate(() =>
    new URLSearchParams(window.location.search).get("route"),
  );
  check("navigated to settings route", onSettings === "settings", String(onSettings));

  console.log("\n6. Main shell exposes roadmap visibility state");
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="main-shell"]');
  const roadmapVisible = await page.$eval(
    '[data-testid="main-shell"]',
    (el) => el.getAttribute("data-roadmap-visible") || "",
  );
  check(
    "main shell exposes roadmap visibility state",
    roadmapVisible === "true" || roadmapVisible === "false",
    roadmapVisible,
  );

  console.log("\n7. Ctrl+E toggles slide-in panel");
  await page.keyboard.press("Control+e");
  const slideInPanel = await page
    .waitForSelector('[data-testid="slide-in-panel"]', { timeout: 1000 })
    .catch(() => null);
  const slideInOpen =
    slideInPanel === null
      ? ""
      : await slideInPanel.evaluate((el) => el.getAttribute("data-open") || "");
  check("slide-in panel open after Ctrl+E", slideInOpen === "true", slideInOpen);

  console.log("\n8. Ctrl+/ routes to prompt-helper");
  await page.keyboard.press("Control+/");
  await page.waitForTimeout(300);
  const promptRoute = await page.evaluate(() =>
    new URLSearchParams(window.location.search).get("route"),
  );
  check("navigated to prompt-helper route", promptRoute === "prompt-helper", String(promptRoute));

  console.log("\n9. Typing in input field: Ctrl+N is suppressed (doesn't open dialog)");
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="sidebar"]');
  // Focus a textarea first (new-project dialog is closed, so focus body input-like region via opening then typing in np-name).
  // We use a simpler proxy: simulate focus on any input and press Control+n; dialog must NOT appear.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName || "");
  await page.keyboard.press("Control+n");
  await page.waitForTimeout(150);
  const dialogAfterTyping = await page.$('[data-testid="new-project-dialog"]');
  // Because focus is on a button (not input/textarea), the shortcut MAY fire. To really
  // test suppression, manually focus an input first.
  await page.evaluate(() => {
    const el = document.createElement("input");
    el.type = "text";
    el.id = "__a11y_probe";
    document.body.appendChild(el);
    el.focus();
  });
  if (dialogAfterTyping) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
  }
  await page.keyboard.press("Control+n");
  await page.waitForTimeout(150);
  const dialogWhileTyping = await page.$('[data-testid="new-project-dialog"]');
  check(
    "Ctrl+N suppressed when focus is in input field",
    dialogWhileTyping === null,
    `focused=${focusedTag}, dialog=${dialogWhileTyping ? "open" : "closed"}`,
  );

  console.log("\n10. Settings locale select has aria-label");
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("route", "settings");
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForSelector('[data-testid="settings-locale-select"]');
  const localeSelectLabel = await page.$eval(
    '[data-testid="settings-locale-select"]',
    (el) => el.getAttribute("aria-label") || "",
  );
  check("settings locale select has aria-label", localeSelectLabel.length > 0, localeSelectLabel);

  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
