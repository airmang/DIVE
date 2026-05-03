// Playwright verification for task 2-4 (permission card + diff viewer).
// Run with: node scripts/verify-permission.mjs
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

  console.log("1. Navigate to ?demo=permission");
  await page.goto(`${BASE}/?demo=permission`);
  await page.waitForSelector('[data-testid="demo-section-safe"]');

  console.log("\n2. Three cards with distinct risk attributes");
  const risks = await page.$$eval('[data-testid="permission-card"]', (els) =>
    els.map((e) => e.getAttribute("data-risk")),
  );
  check(
    "3 cards: safe + warn + danger",
    risks.includes("safe") && risks.includes("warn") && risks.includes("danger"),
    JSON.stringify(risks),
  );

  console.log("\n3. Warn card has DiffViewer with + / - lines");
  const diffStats = await page.$eval(
    '[data-testid="demo-section-warn"] [data-testid="diff-viewer"]',
    (el) => ({
      add: el.querySelector('[data-testid="diff-add-count"]')?.textContent,
      del: el.querySelector('[data-testid="diff-del-count"]')?.textContent,
      adds: el.querySelectorAll('[data-op="add"]').length,
      dels: el.querySelectorAll('[data-op="del"]').length,
    }),
  );
  check(
    "diff has at least 1 add + 1 del",
    diffStats.adds >= 1 && diffStats.dels >= 1,
    JSON.stringify(diffStats),
  );

  console.log("\n4. Danger card renders command args block");
  const dangerArgs = await page.$eval(
    '[data-testid="demo-section-danger"] [data-testid="danger-args"]',
    (el) => el.textContent,
  );
  check(
    "danger args block shows rm -rf",
    dangerArgs?.includes("rm -rf") ?? false,
    dangerArgs?.slice(0, 80),
  );

  console.log("\n5. Safe approve logs a line");
  await page.click('[data-testid="demo-section-safe"] [data-testid="card-approve"]');
  await page.waitForSelector('[data-testid="demo-log"]');
  const firstLog = await page.$eval('[data-testid="demo-log"] li', (el) => el.textContent);
  check("safe approve logged", firstLog?.includes("approved") ?? false, firstLog ?? "null");

  console.log("\n6. Warn edit toggles ArgsEditor");
  await page.click('[data-testid="demo-section-warn"] [data-testid="card-edit"]');
  await page.waitForTimeout(100);
  const editorVisible = await page.$(
    '[data-testid="demo-section-warn"] [data-testid="args-editor-textarea"]',
  );
  check("warn args editor visible after toggle", !!editorVisible);

  console.log("\n7. Invalid JSON in editor surfaces error");
  await page.fill(
    '[data-testid="demo-section-warn"] [data-testid="args-editor-textarea"]',
    "{ not valid json",
  );
  await page.waitForTimeout(350);
  const err = await page.$('[data-testid="demo-section-warn"] [data-testid="args-editor-error"]');
  check("JSON parse error shown", !!err);

  console.log("\n8. Warn approve disabled while JSON invalid");
  const approveDisabled = await page.$eval(
    '[data-testid="demo-section-warn"] [data-testid="card-approve"]',
    (el) => el.disabled,
  );
  check("warn approve disabled while invalid JSON", approveDisabled);

  console.log("\n9. Restore valid JSON, approve with modified args");
  await page.fill(
    '[data-testid="demo-section-warn"] [data-testid="args-editor-textarea"]',
    '{"path":"src/App.tsx","find":"<div>old</div>","replace":"<div>MOD</div>"}',
  );
  await page.waitForTimeout(300);
  await page.click('[data-testid="demo-section-warn"] [data-testid="card-approve"]');
  await page.waitForTimeout(100);
  const logLines = await page.$$eval('[data-testid="demo-log"] li', (els) =>
    els.map((e) => e.textContent ?? ""),
  );
  check(
    "warn approve with (modified) recorded",
    logLines.some((l) => l.includes("warn") && l.includes("(modified)")),
    JSON.stringify(logLines.slice(0, 3)),
  );

  console.log("\n10. Danger deny-with-reason flow");
  await page.click('[data-testid="demo-section-danger"] [data-testid="card-deny-with-reason"]');
  await page.waitForTimeout(80);
  await page.fill(
    '[data-testid="demo-section-danger"] [data-testid="deny-reason"]',
    "학생이 직접 실행하기엔 위험",
  );
  await page.click('[data-testid="demo-section-danger"] [data-testid="card-deny-confirm"]');
  await page.waitForTimeout(100);
  const lines2 = await page.$$eval('[data-testid="demo-log"] li', (els) =>
    els.map((e) => e.textContent ?? ""),
  );
  check(
    "danger deny with reason recorded",
    lines2.some((l) => l.includes("danger") && l.includes("학생이")),
    JSON.stringify(lines2.slice(0, 3)),
  );

  console.log("\n11. Standalone DiffViewer renders");
  const standaloneDiff = await page.$(
    '[data-testid="demo-section-diff"] [data-testid="diff-viewer"]',
  );
  check("standalone diff present", !!standaloneDiff);

  console.log("\n12. Standalone ArgsEditor renders");
  const standaloneEditor = await page.$(
    '[data-testid="demo-section-editor"] [data-testid="args-editor-textarea"]',
  );
  check("standalone editor present", !!standaloneEditor);

  console.log("\n13. Default route still renders MainShell");
  await page.goto(BASE);
  await page.waitForTimeout(300);
  const shell = await page.$('[data-testid="workmap-strip"]');
  check("main shell still works", !!shell);

  console.log("\n14. Chat demo still reachable");
  await page.goto(`${BASE}/?demo=chat`);
  await page.waitForTimeout(300);
  const chatSection = await page.$('[data-testid="demo-section-six"]');
  check("chat demo reachable", !!chatSection);

  console.log("\n15. Workmap demo still reachable");
  await page.goto(`${BASE}/?demo=workmap`);
  await page.waitForTimeout(300);
  const wm = await page.$('[data-testid="demo-section-expanded"]');
  check("workmap demo reachable", !!wm);

  await browser.close();

  console.log(`\n\nTotal: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
