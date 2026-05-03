// Playwright verification for task 2-5 (slide-in panel).
// Run with: node scripts/verify-slide-in.mjs
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

  console.log("1. Navigate to ?demo=slide-in — panel auto-opens on mount");
  await page.goto(`${BASE}/?demo=slide-in`);
  await page.waitForSelector('[data-testid="slide-in-panel"]');
  await page.waitForTimeout(350);
  const openAttr = await page.$eval(
    '[data-testid="slide-in-panel"]',
    (el) => el.getAttribute("data-open"),
  );
  check("panel data-open=true after mount", openAttr === "true", `got ${openAttr}`);

  console.log("\n2. Panel width is 520px");
  const width = await page.$eval(
    '[data-testid="slide-in-panel"]',
    (el) => el.getBoundingClientRect().width,
  );
  check("panel width 520px", width === 520, `got ${width}`);

  console.log("\n3. Default tab is code + 3 tabs present");
  const tabs = await page.$$eval('[data-testid="slide-in-tab"]', (els) =>
    els.map((e) => ({
      id: e.getAttribute("data-tab"),
      selected: e.getAttribute("aria-selected"),
    })),
  );
  check(
    "3 tabs, code selected",
    tabs.length === 3 &&
      tabs.find((t) => t.id === "code")?.selected === "true",
    JSON.stringify(tabs),
  );

  console.log("\n4. CodeTab renders 3 mock files + diff");
  const fileCount = await page.$$eval(
    '[data-testid="changed-file-item"]',
    (els) => els.length,
  );
  check("3 changed files listed", fileCount === 3, `got ${fileCount}`);
  const diffPresent = await page.$('[data-testid="diff-viewer"]');
  check("diff viewer visible", !!diffPresent);

  console.log("\n5. Click second file → diff path updates");
  await page.click(
    '[data-testid="changed-file-item"][data-file-path="src/main.tsx"]',
  );
  await page.waitForTimeout(100);
  const diffPath = await page.$eval(
    '[data-testid="diff-path"]',
    (el) => el.textContent,
  );
  check(
    "diff path reflects selected file",
    diffPath?.includes("src/main.tsx") ?? false,
    diffPath ?? "null",
  );

  console.log("\n6. Switch to preview tab");
  await page.click('[data-testid="slide-in-tab"][data-tab="preview"]');
  await page.waitForTimeout(80);
  const previewEmpty = await page.$('[data-testid="preview-empty"]');
  check("preview empty state visible", !!previewEmpty);

  console.log("\n7. Invalid URL shows error");
  await page.fill('[data-testid="preview-url-input"]', "not a url");
  await page.click('[data-testid="preview-load"]');
  await page.waitForTimeout(80);
  const previewErr = await page.$('[data-testid="preview-error"]');
  check("preview error visible for invalid URL", !!previewErr);

  console.log("\n8. Valid URL loads iframe");
  await page.fill(
    '[data-testid="preview-url-input"]',
    "https://example.com",
  );
  await page.click('[data-testid="preview-load"]');
  await page.waitForTimeout(150);
  const iframe = await page.$('[data-testid="preview-iframe"]');
  check("iframe rendered for valid URL", !!iframe);

  console.log("\n9. Terminal tab starts empty, sample lines populate");
  await page.click('[data-testid="slide-in-tab"][data-tab="terminal"]');
  await page.waitForTimeout(80);
  const emptyInitially = await page.$eval(
    '[data-testid="terminal-log"]',
    (el) => el.textContent ?? "",
  );
  check(
    "terminal empty initially",
    emptyInitially.includes("출력이 없습니다"),
    emptyInitially.slice(0, 40),
  );
  await page.click('[data-testid="open-terminal-btn"]');
  await page.waitForTimeout(150);
  const lineCount = await page.$$eval(
    '[data-testid="terminal-line"]',
    (els) => els.length,
  );
  check("5 terminal lines after sample", lineCount === 5, `got ${lineCount}`);

  console.log("\n10. Terminal has stderr kind line");
  const kinds = await page.$$eval(
    '[data-testid="terminal-line"]',
    (els) => els.map((e) => e.getAttribute("data-kind")),
  );
  check(
    "terminal has stderr + stdout + info",
    kinds.includes("stderr") && kinds.includes("stdout") && kinds.includes("info"),
    JSON.stringify(kinds),
  );

  console.log("\n11. Clear button empties terminal");
  await page.click('[data-testid="terminal-clear"]');
  await page.waitForTimeout(80);
  const clearedCount = await page.$$eval(
    '[data-testid="terminal-line"]',
    (els) => els.length,
  );
  check("terminal cleared", clearedCount === 0);

  console.log("\n12. ESC closes the panel");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  const closedAttr = await page.$eval(
    '[data-testid="slide-in-panel"]',
    (el) => el.getAttribute("data-open"),
  );
  check("panel data-open=false after ESC", closedAttr === "false", `got ${closedAttr}`);

  console.log("\n13. Reopen via button + close button works");
  await page.click('[data-testid="open-code-btn"]');
  await page.waitForTimeout(350);
  const reopened = await page.$eval(
    '[data-testid="slide-in-panel"]',
    (el) => el.getAttribute("data-open"),
  );
  check("panel reopen", reopened === "true");
  await page.click('[data-testid="slide-in-close"]');
  await page.waitForTimeout(350);
  const closedAgain = await page.$eval(
    '[data-testid="slide-in-panel"]',
    (el) => el.getAttribute("data-open"),
  );
  check("panel closed via X button", closedAgain === "false");

  console.log("\n14. MainShell [코드/미리보기] opens slide-in");
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="workmap-strip"]');
  await page.click('button[aria-label="코드와 미리보기 패널 열기"]');
  await page.waitForTimeout(350);
  const shellOpen = await page.$eval(
    '[data-testid="slide-in-panel"]',
    (el) => el.getAttribute("data-open"),
  );
  check("main shell slide-in opens via button", shellOpen === "true");

  console.log("\n15. Other demo routes still reachable");
  for (const r of ["chat", "permission", "workmap", "showcase"]) {
    await page.goto(`${BASE}/?demo=${r}`);
    await page.waitForTimeout(200);
    const body = await page.$("body");
    check(`?demo=${r} reachable`, !!body);
  }

  await browser.close();

  console.log(`\n\nTotal: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
