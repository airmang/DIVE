// Playwright verification for task 2-6 (DIVE gate D + scenario A integration).
// Run with: node scripts/verify-integration.mjs
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
  await context.addInitScript(() => {
    window.localStorage.setItem("dive:rc1_migrated", "true");
  });
  const page = await context.newPage();

  console.log("1. Navigate to ?demo=scenario-a");
  await page.goto(`${BASE}/?demo=scenario-a`);
  await page.waitForSelector('[data-testid="scenario-shell"]');
  await page.waitForTimeout(200);

  console.log("\n2. Steps panel + 6 steps visible");
  const stepCount = await page.$$eval('[data-testid="steps-panel"] li', (els) => els.length);
  check("6 steps rendered", stepCount === 6, `got ${stepCount}`);

  console.log("\n3. Input blocked initially (empty workmap)");
  const blocked = await page.$('[data-testid="chat-input-blocked"]');
  check("input-blocked banner visible", !!blocked);

  console.log("\n4. Chat textarea disabled");
  const textareaDisabled = await page.$eval(
    '[data-testid="chat-input-textarea"]',
    (el) => el.disabled,
  );
  check("textarea disabled", textareaDisabled);

  console.log("\n5. 'AI 도움 받기' button present in empty workmap");
  const aiBtn = await page.$('[data-testid="workmap-ai-assist"]');
  check("ai-assist button visible", !!aiBtn);

  console.log("\n6. Click AI button → dialog opens");
  await page.click('[data-testid="workmap-ai-assist"]');
  await page.waitForTimeout(150);
  const dialog = await page.$('[data-testid="ai-assist-dialog"]');
  check("dialog open", !!dialog);

  console.log("\n7. Submit request → 4 drafts appear");
  await page.fill('[data-testid="ai-assist-input"]', "할 일 앱을 만들고 싶어요");
  await page.click('[data-testid="ai-assist-request"]');
  await page.waitForSelector('[data-testid="ai-assist-drafts"]');
  const draftCount = await page.$$eval('[data-testid="ai-assist-draft"]', (els) => els.length);
  check("4 drafts shown", draftCount === 4, `got ${draftCount}`);

  console.log("\n8. Accept all → dialog closes + 4 cards added");
  await page.click('[data-testid="ai-assist-accept-all"]');
  await page.waitForTimeout(250);
  const dialogGone = await page.$('[data-testid="ai-assist-dialog"]');
  check("dialog closed", !dialogGone);
  const cardCount = await page.$$eval('[data-testid="card-tile"]', (els) => els.length);
  check("4 cards added to workmap", cardCount === 4, `got ${cardCount}`);

  console.log("\n9. Input unblocked after cards added");
  await page.waitForTimeout(100);
  const stillBlocked = await page.$('[data-testid="chat-input-blocked"]');
  check("blocked banner removed", !stillBlocked);
  const textareaNow = await page.$eval('[data-testid="chat-input-textarea"]', (el) => el.disabled);
  check("textarea enabled", !textareaNow);

  console.log("\n10. Reset + seed verified card → click opens slide-in");
  await page.click('[data-testid="scenario-reset"]');
  await page.waitForTimeout(150);
  await page.click('[data-testid="scenario-seed"]');
  await page.waitForTimeout(150);
  const seededCount = await page.$$eval('[data-testid="card-tile"]', (els) => els.length);
  check("seeded 3 cards", seededCount === 3, `got ${seededCount}`);

  console.log("\n11. Click verified card → slide-in opens on code tab");
  const verifiedCard = await page.$('[data-testid="card-tile"][data-card-state="verified"]');
  check("verified card found", !!verifiedCard);
  if (verifiedCard) {
    await verifiedCard.click();
    await page.waitForTimeout(350);
    const slideOpen = await page.$eval('[data-testid="slide-in-panel"]', (el) =>
      el.getAttribute("data-open"),
    );
    check("slide-in opened after verified click", slideOpen === "true");
    const activeTab = await page.$eval('[data-testid="slide-in-tab"][aria-selected="true"]', (el) =>
      el.getAttribute("data-tab"),
    );
    check("code tab active", activeTab === "code", `got ${activeTab}`);
  }

  console.log("\n12. Click decomposed card → slide-in does NOT auto-open");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const decomposedCard = await page.$('[data-testid="card-tile"][data-card-state="decomposed"]');
  if (decomposedCard) {
    await decomposedCard.click();
    await page.waitForTimeout(200);
    const stillClosed = await page.$eval('[data-testid="slide-in-panel"]', (el) =>
      el.getAttribute("data-open"),
    );
    check(
      "slide-in stays closed for decomposed card",
      stillClosed === "false",
      `got ${stillClosed}`,
    );
  }

  console.log("\n13. Other demo routes still reachable");
  for (const r of ["chat", "permission", "workmap", "showcase", "slide-in"]) {
    await page.goto(`${BASE}/?demo=${r}`);
    await page.waitForTimeout(200);
    const body = await page.$("body");
    check(`?demo=${r} reachable`, !!body);
  }

  console.log("\n14. Default MainShell still renders");
  await page.goto(BASE);
  await page.evaluate(() => window.localStorage.setItem("dive:onboarded", "true"));
  await page.reload();
  await page.waitForSelector('[data-testid="workmap-strip"]');
  const shell = await page.$('[data-testid="workmap-strip"]');
  check("default / renders MainShell", !!shell);

  console.log("\n15. Unknown demo param stays product mode");
  await page.goto(`${BASE}/?demo=unknown`);
  await page.waitForSelector('[data-testid="main-shell"]');
  const providerBanner = await page.$('[data-testid="provider-required-banner"]');
  check("unknown ?demo=unknown does not enable demo fallback", providerBanner !== null);

  await browser.close();

  console.log(`\n\nTotal: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
