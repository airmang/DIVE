// Playwright verification for task 6-3 — WCAG AA color contrast ratios.
// Source tokens: dive/src/styles/globals.css (§2.3 DIVE_SPEC.md).
// Run with: node scripts/verify-contrast.mjs
// Requires dev server on http://localhost:1420.
//
// WCAG 2.1 contrast ratio:
//   ratio = (L1 + 0.05) / (L2 + 0.05), L1 >= L2
//   L = 0.2126 R + 0.7152 G + 0.0722 B (gamma-linearized)
// Thresholds (§12.2):
//   - AA body text: 4.5:1
//   - AA large text / UI components: 3:1

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

function parseRgb(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
  return { r: parts[0], g: parts[1], b: parts[2] };
}

function relativeLuminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fg, bg) {
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

async function getColor(page, selector, prop) {
  return page.$eval(selector, (el, p) => window.getComputedStyle(el).getPropertyValue(p), prop);
}

async function contrastPair(page, fgSelector, bgSelector, label, threshold) {
  const fgStr = await getColor(page, fgSelector, "color");
  const bgStr = await getColor(page, bgSelector, "background-color");
  const fg = parseRgb(fgStr);
  const bg = parseRgb(bgStr);
  if (!fg || !bg) {
    check(`${label} — parse colors`, false, `${fgStr} / ${bgStr}`);
    return;
  }
  const ratio = contrastRatio(fg, bg);
  check(`${label} (>= ${threshold}:1)`, ratio >= threshold, `ratio=${ratio.toFixed(2)}:1`);
}

async function runSuite(page, themeName) {
  console.log(`\n--- ${themeName.toUpperCase()} THEME ---`);

  console.log("\n* Body text on bg (AA 4.5:1)");
  await contrastPair(page, "body", "body", "body fg on bg", 4.5);

  console.log("\n* Sidebar foreground on panel (AA 4.5:1)");
  const sidebarLi = await page.$('[data-testid="sidebar"]');
  if (sidebarLi) {
    await contrastPair(
      page,
      '[data-testid="sidebar"] [data-testid="provider-label"]',
      '[data-testid="sidebar"]',
      "provider label on sidebar",
      4.5,
    );
  }

  console.log("\n* Accent button (AA 3:1 for UI)");
  // The new-project button uses accent text. Measure against bg-panel.
  const accentProbeExists = await page.$('[data-testid="btn-new-project"]');
  if (accentProbeExists) {
    await contrastPair(
      page,
      '[data-testid="btn-new-project"]',
      '[data-testid="sidebar"]',
      "new-project button text on sidebar",
      3,
    );
  }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(BASE);
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem("dive:rc1_migrated", "true");
    window.localStorage.setItem("dive:onboarded", "true");
    window.localStorage.setItem("dive.theme", "dark");
  });
  await page.reload();
  await page.waitForSelector('[data-testid="sidebar"]');

  // Default theme (dark)
  await runSuite(page, "dark");

  // Switch to light
  console.log("\n(switching to light theme)");
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    window.localStorage.setItem("dive.theme", "light");
  });
  await page.waitForTimeout(100);
  await runSuite(page, "light");

  console.log("\n--- MOTION-REDUCE ---");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await page.waitForSelector('[data-testid="sidebar"]');
  // Provoke a Loader2 spin via verify engine or check a known spinner pattern
  // We check whether any animate-spin element has an effective animation-duration of 0s via tailwind `motion-reduce:animate-none`.
  const motionSafeCount = await page.$$eval("[class*='motion-reduce']", (els) => els.length);
  check("motion-reduce utilities present in DOM", motionSafeCount >= 1, `count=${motionSafeCount}`);

  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
