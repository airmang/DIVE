// Playwright verification for task 5-3 (MCP tool permission card integration UI).
// Run with: node scripts/verify-mcp-integration.mjs
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
  await page.addInitScript(() => {
    window.localStorage.setItem("dive:rc1_migrated", "true");
    window.localStorage.setItem("dive:onboarded", "true");
  });

  console.log("1. Navigate to MCP demo");
  await page.goto(`${BASE}/?demo=mcp`);
  await page.waitForSelector('[data-testid="mcp-demo-page"]');

  console.log("\n2. Provenance badge rendered for mcp__-prefixed name only");
  const badges = await page.$$('[data-testid="mcp-provenance"]');
  check("4 or more MCP badges on page", badges.length >= 4, String(badges.length));
  const firstBadge = badges[0];
  const serverAttr = await firstBadge.getAttribute("data-mcp-server");
  const remoteAttr = await firstBadge.getAttribute("data-mcp-remote");
  check("badge exposes server label", serverAttr === "fs", serverAttr);
  check("badge exposes remote tool name", remoteAttr === "read_file", remoteAttr);

  console.log("\n3. Built-in tool does NOT receive MCP badge");
  const builtinNoBadge = await page.$eval(
    '[data-testid="builtin-no-badge"]',
    (el) => el.textContent ?? "",
  );
  check("builtin note visible", builtinNoBadge.includes("배지 없음"));

  console.log("\n4. Three permission cards rendered (Safe/Warn/Danger)");
  const safeCard = await page.$('[data-testid="permission-card"][data-risk="safe"]');
  const warnCard = await page.$('[data-testid="permission-card"][data-risk="warn"]');
  const dangerCard = await page.$('[data-testid="permission-card"][data-risk="danger"]');
  check("safe card", safeCard !== null);
  check("warn card", warnCard !== null);
  check("danger card", dangerCard !== null);

  console.log("\n5. Each permission card carries an MCP badge inside");
  const safeCardBadge = await safeCard.$('[data-testid="mcp-provenance"]');
  const warnCardBadge = await warnCard.$('[data-testid="mcp-provenance"]');
  const dangerCardBadge = await dangerCard.$('[data-testid="mcp-provenance"]');
  check("safe card badge", safeCardBadge !== null);
  check("warn card badge", warnCardBadge !== null);
  check("danger card badge", dangerCardBadge !== null);
  const dangerServer = await dangerCardBadge.getAttribute("data-mcp-server");
  check("danger card server label is grading", dangerServer === "grading", dangerServer);

  console.log("\n6. Approve on safe card updates last action");
  await page.click(
    '[data-testid="permission-card"][data-risk="safe"] [data-testid="card-approve"]',
  );
  const lastAction = await page.$eval('[data-testid="last-action"]', (el) => el.textContent ?? "");
  check("approve safe recorded", lastAction.includes("approved:safe-1"), lastAction);

  console.log("\n7. Approved / blocked tool call messages render");
  const approvedRow = await page.$(
    '[data-testid="chat-message"][data-kind="tool_call"][data-status="approved"]',
  );
  check("approved message present", approvedRow !== null);
  const approvedBadge = await approvedRow.$('[data-testid="mcp-provenance"]');
  check("approved message has mcp badge", approvedBadge !== null);

  const blockedRow = await page.$(
    '[data-testid="chat-message"][data-kind="tool_call"][data-status="blocked"]',
  );
  check("blocked message present", blockedRow !== null);
  const blockedBadge = await blockedRow.$('[data-testid="mcp-provenance"]');
  check("blocked message has mcp badge", blockedBadge !== null);
  const blockedBody = await blockedRow.evaluate((el) => el.textContent ?? "");
  check(
    "blocked shows destructive rule",
    blockedBody.includes("destructive"),
    blockedBody.slice(0, 80),
  );

  console.log("\n8. Back button returns to main shell");
  await page.click('[data-testid="back"]');
  await page.waitForTimeout(200);
  const url = page.url();
  check("back removes demo param", !url.includes("demo=mcp"), url);

  console.log(`\n---\nTotal: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
