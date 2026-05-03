// Standalone Playwright verification for task 2-1 (workmap card tiles).
// Run with: node scripts/verify-workmap.mjs
// Requires dev server running on http://localhost:1420.

import { chromium } from "./_playwright-loader.mjs";

const BASE = "http://localhost:1420";
const results = [];
let pass = 0;
let fail = 0;

function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? "  " + detail : ""}`);
    results.push({ name, pass: true });
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? "  " + detail : ""}`);
    results.push({ name, pass: false, detail });
  }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log("1. Navigate to ?demo=workmap");
  await page.goto(`${BASE}/?demo=workmap`);
  await page.waitForSelector('[data-testid="demo-section-expanded"]');

  console.log("\n2. 4 expanded cards in section 1");
  const expandedCards = await page.$$eval(
    '[data-testid="demo-section-expanded"] [data-testid="card-tile"]',
    (els) =>
      els.map((e) => ({
        id: e.getAttribute("data-card-id"),
        state: e.getAttribute("data-card-state"),
      })),
  );
  check("section 1 has 4 cards", expandedCards.length === 4, JSON.stringify(expandedCards));

  console.log("\n3. Expanded card bbox is 200x130");
  const firstCardBox = await page.$eval(
    '[data-testid="demo-section-expanded"] [data-testid="card-tile"]',
    (el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    },
  );
  check(
    "expanded bbox 200x130",
    firstCardBox.w === 200 && firstCardBox.h === 130,
    `got ${firstCardBox.w}x${firstCardBox.h}`,
  );

  console.log("\n4. Collapsed card bbox is 200x36");
  const collapsedBox = await page.$eval(
    '[data-testid="demo-section-collapsed"] [data-testid="card-tile"]',
    (el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    },
  );
  check(
    "collapsed bbox 200x36",
    collapsedBox.w === 200 && collapsedBox.h === 36,
    `got ${collapsedBox.w}x${collapsedBox.h}`,
  );

  console.log("\n5. Section 3 has all 6 CardStates");
  const sixStates = await page.$$eval(
    '[data-testid="demo-section-all-states"] [data-testid="card-tile"]',
    (els) => els.map((e) => e.getAttribute("data-card-state")),
  );
  const expectedStates = [
    "decomposed",
    "instructed",
    "verifying",
    "verified",
    "rejected",
    "extended",
  ];
  const hasAllStates = expectedStates.every((s) => sixStates.includes(s));
  check("6 unique CardStates present", hasAllStates, `got ${JSON.stringify(sixStates)}`);

  console.log("\n6. Color bar uses distinct colors per state");
  const barColors = await page.$$eval(
    '[data-testid="demo-section-all-states"] [data-testid="card-tile"]',
    (els) =>
      els.map((el) => {
        const bar = el.querySelector('[data-testid="card-color-bar"]');
        return {
          state: el.getAttribute("data-card-state"),
          bg: bar ? getComputedStyle(bar).backgroundColor : null,
        };
      }),
  );
  // decomposed/instructed/verifying/verified/rejected should all differ
  const distinctColors = new Set(barColors.filter((c) => c.state !== "extended").map((c) => c.bg));
  check(
    "5 distinct color bar colors (excluding extended)",
    distinctColors.size === 5,
    JSON.stringify(barColors),
  );

  console.log("\n7. DIVE progress dots — completed count matches aria-valuenow");
  const progressCheck = await page.$$eval(
    '[data-testid="demo-section-all-states"] [data-testid="card-tile"]',
    (els) =>
      els.map((el) => {
        const pb = el.querySelector('[data-testid="dive-progress"][data-mode="expanded"]');
        if (!pb) return { state: el.getAttribute("data-card-state"), valid: false };
        const now = Number(pb.getAttribute("aria-valuenow"));
        const filled = pb.querySelectorAll('[data-completed="true"]').length;
        return {
          state: el.getAttribute("data-card-state"),
          ariaValue: now,
          filledDots: filled,
          valid: now === filled && Number(pb.getAttribute("aria-valuemax")) === 4,
        };
      }),
  );
  const allValid = progressCheck.every((c) => c.valid);
  check(
    "DIVE dots valid (aria-valuenow == filled count, max=4)",
    allValid,
    JSON.stringify(progressCheck),
  );

  console.log("\n8. Tab navigates between cards");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(100);
  const focusedAfterFirstTab = await page.evaluate(() => {
    const el = document.activeElement;
    return {
      tag: el?.tagName,
      testId: el?.getAttribute("data-testid"),
      cardId: el?.getAttribute("data-card-id"),
    };
  });
  check(
    "first Tab lands on a button element",
    focusedAfterFirstTab.tag === "BUTTON",
    JSON.stringify(focusedAfterFirstTab),
  );

  console.log("\n9. [+ 카드 추가] button disabled state toggles with canAddCard");
  const initialDisabled = await page.$eval(
    '[data-testid="demo-section-list"] [data-testid="workmap-add-card"]',
    (el) => el.disabled,
  );
  check(
    "add card initially enabled (checkbox default)",
    !initialDisabled,
    `disabled=${initialDisabled}`,
  );

  await page.click('[data-testid="demo-toggle-can-add"]');
  await page.waitForTimeout(50);
  const afterToggle = await page.$eval(
    '[data-testid="demo-section-list"] [data-testid="workmap-add-card"]',
    (el) => el.disabled,
  );
  check("add card disabled after toggle off", afterToggle, `disabled=${afterToggle}`);

  console.log("\n10. Horizontal scroll changes scrollLeft");
  const scrollResult = await page.$eval(
    '[data-testid="demo-section-list"] [data-testid="workmap-scroll-container"]',
    (el) => {
      const before = el.scrollLeft;
      el.scrollBy({ left: 400, behavior: "instant" });
      const after = el.scrollLeft;
      return { before, after, width: el.clientWidth, scrollWidth: el.scrollWidth };
    },
  );
  check(
    "horizontal scroll changes scrollLeft",
    scrollResult.after > scrollResult.before && scrollResult.scrollWidth > scrollResult.width,
    JSON.stringify(scrollResult),
  );

  console.log("\n11. WorkmapStrip integration (section 5) renders cards");
  const stripCards = await page.$$eval(
    '[data-testid="demo-section-strip"] [data-testid="workmap-strip"] [data-testid="card-tile"]',
    (els) => els.length,
  );
  check("strip renders 4 cards", stripCards === 4, `got ${stripCards}`);

  console.log("\n12. Toggle strip collapse → card mode flips to collapsed");
  await page.click('[data-testid="demo-section-strip"] [data-testid="workmap-toggle"]');
  await page.waitForTimeout(300);
  const stripMode = await page.$eval(
    '[data-testid="demo-section-strip"] [data-testid="workmap-strip"]',
    (el) => el.getAttribute("data-collapsed"),
  );
  check("strip now collapsed", stripMode === "true", `data-collapsed=${stripMode}`);

  console.log("\n13. Dark/Light theme toggle");
  const initialTheme = await page.evaluate(() => document.documentElement.className);
  await page.click('button[aria-label*="모드"]');
  await page.waitForTimeout(100);
  const newTheme = await page.evaluate(() => document.documentElement.className);
  check(
    "theme toggle flips html class",
    initialTheme !== newTheme,
    `${initialTheme} -> ${newTheme}`,
  );

  console.log("\n14. Cards still render in light mode");
  const lightCards = await page.$$eval('[data-testid="card-tile"]', (els) => els.length);
  check("cards render after theme flip", lightCards > 0, `${lightCards} cards`);

  console.log("\n15. ?demo=showcase still works");
  await page.goto(`${BASE}/?demo=showcase`);
  await page.waitForTimeout(300);
  const showcaseHeading = await page.$eval("h1", (el) => el.textContent);
  check("showcase page heading visible", !!showcaseHeading?.includes("DIVE"), showcaseHeading);

  console.log("\n16. Default route (no demo param) renders MainShell");
  await page.goto(BASE);
  await page.waitForTimeout(300);
  const mainShellStrip = await page.$('[data-testid="workmap-strip"]');
  check("main shell visible at /", !!mainShellStrip, mainShellStrip ? "present" : "missing");

  await browser.close();

  console.log(`\n\nTotal: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
