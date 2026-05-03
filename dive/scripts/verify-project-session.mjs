// Playwright verification for task 4-1 — project/session CRUD UI.
// Run with: node scripts/verify-project-session.mjs
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

  console.log("1. Clear storage + set onboarded true so dialog does not block");
  await page.goto(BASE);
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem("dive:onboarded", "true");
  });
  await page.reload();
  await page.waitForSelector('[data-testid="sidebar"]');

  console.log("\n2. Sidebar CRUD buttons are enabled");
  const newProjectBtn = await page.$('[data-testid="btn-new-project"]');
  check("new project button exists", newProjectBtn !== null);
  const disabledNewProject = await page.$eval(
    '[data-testid="btn-new-project"]',
    (el) => el.disabled,
  );
  check("new project button not disabled", disabledNewProject === false);
  const newSessionDisabled = await page.$eval(
    '[data-testid="btn-new-session"]',
    (el) => el.disabled,
  );
  check(
    "new session button disabled with no project",
    newSessionDisabled === true,
    String(newSessionDisabled),
  );

  console.log("\n3. Create a project via dialog");
  await page.click('[data-testid="btn-new-project"]');
  await page.waitForSelector('[data-testid="new-project-dialog"]');
  await page.fill('[data-testid="np-name"]', "Test Project");
  await page.fill('[data-testid="np-path"]', "/tmp/dive-test-project");
  await page.click('[data-testid="np-create"]');
  await page.waitForTimeout(400);
  const items = await page.$$('[data-testid="project-item"]');
  check("project appears in list", items.length === 1, `count=${items.length}`);

  console.log("\n4. New session enabled after project select");
  const newSessionEnabled = await page.$eval(
    '[data-testid="btn-new-session"]',
    (el) => el.disabled,
  );
  check("new session enabled", newSessionEnabled === false);

  console.log("\n5. Create session");
  await page.click('[data-testid="btn-new-session"]');
  await page.waitForTimeout(300);
  const sessions = await page.$$('[data-testid="session-item"]');
  check("one session created", sessions.length === 1, `count=${sessions.length}`);

  console.log("\n6. current-session-id localStorage updated");
  const sessionIdStr = await page.evaluate(() =>
    window.localStorage.getItem("dive:current-session-id"),
  );
  check("current session id stored", Number(sessionIdStr) > 0, String(sessionIdStr));

  console.log("\n7. Reload — state persists");
  await page.reload();
  await page.waitForSelector('[data-testid="sidebar"]');
  await page.waitForTimeout(400);
  const itemsAfter = await page.$$('[data-testid="project-item"]');
  check("project persists", itemsAfter.length === 1, `count=${itemsAfter.length}`);
  const sessionsAfter = await page.$$('[data-testid="session-item"]');
  check("session persists", sessionsAfter.length === 1, `count=${sessionsAfter.length}`);

  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
