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

async function getStage(page) {
  return page.$eval('[data-testid="current-stage"]', (el) => el.getAttribute("value"));
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log("1. Navigate to ?demo=scenario-b");
  await page.goto(`${BASE}/?demo=scenario-b`);
  await page.waitForSelector('[data-testid="scenario-b-shell"]');
  await page.waitForSelector('[data-testid="current-stage"]', { state: "attached" });

  console.log("\n2. Initial D-stage: empty workmap + input blocked");
  const initialStage = await getStage(page);
  check("initial stage is d", initialStage === "d", `got "${initialStage}"`);
  const blockedInitial = await page.$('[data-testid="chat-input-blocked"]');
  check("input blocked banner visible", blockedInitial !== null);

  console.log("\n3. D seed → one decomposed card");
  await page.click('[data-testid="scenario-b-seed-d"]');
  await page.waitForSelector('[data-card-state="decomposed"]');
  const decomposedCount = await page.$$eval(
    '[data-card-state="decomposed"][data-testid="card-tile"]',
    (els) => els.length,
  );
  check("1 decomposed card exists", decomposedCount === 1);

  console.log("\n4. Click decomposed card → CardDetailPanel opens");
  await page.click('[data-testid="card-tile"][data-card-state="decomposed"]');
  await page.waitForSelector('[data-testid="card-detail-panel"]');
  const panelState = await page.$eval('[data-testid="card-detail-panel"]', (el) =>
    el.getAttribute("data-card-state"),
  );
  check("panel shows decomposed", panelState === "decomposed");
  const enterBtnDisabled = await page.$eval(
    '[data-testid="btn-enter-instruct"]',
    (el) => el.disabled,
  );
  check("enter-instruct is disabled when empty", enterBtnDisabled === true);

  console.log("\n5. Type instruction → enable enter-instruct → click → state = Instructed");
  await page.fill('[data-testid="instruction-input"]', "로그인 폼을 구현해줘");
  const enterBtnEnabled = await page.$eval(
    '[data-testid="btn-enter-instruct"]',
    (el) => el.disabled,
  );
  check("enter-instruct enabled after typing", enterBtnEnabled === false);
  await page.click('[data-testid="btn-enter-instruct"]');
  await page.waitForTimeout(200);
  const instructedCount = await page.$$eval(
    '[data-card-state="instructed"][data-testid="card-tile"]',
    (els) => els.length,
  );
  check("card now instructed", instructedCount === 1);

  console.log("\n6. After close, no current card → stage d; re-open card → stage i");
  const stageAfterEnter = await getStage(page);
  check("stage is d when no current card", stageAfterEnter === "d", `got "${stageAfterEnter}"`);

  console.log("\n7. Re-open card → [V 단계로 진입] exists (disabled — tool calls = 1)");
  await page.click('[data-testid="card-tile"][data-card-state="instructed"]');
  await page.waitForSelector('[data-testid="card-detail-panel"]');
  const stageWithCurrentCard = await getStage(page);
  check("stage is i when instructed card is current", stageWithCurrentCard === "i");
  const verifyBtnEnabled = await page.$eval(
    '[data-testid="btn-request-verify"]',
    (el) => el.disabled,
  );
  check("request-verify enabled (sim tool_count=1)", verifyBtnEnabled === false);

  console.log("\n8. Click request-verify → state = Verifying + V stage inferred");
  await page.click('[data-testid="btn-request-verify"]');
  await page.waitForTimeout(200);
  const verifyingCount = await page.$$eval(
    '[data-card-state="verifying"][data-testid="card-tile"]',
    (els) => els.length,
  );
  check("card now verifying", verifyingCount === 1);

  console.log("\n9. Open verifying card → run verify → approve → Verified");
  await page.click('[data-testid="card-tile"][data-card-state="verifying"]');
  await page.waitForSelector('[data-testid="card-detail-panel"][data-card-state="verifying"]');
  await page.waitForSelector('[data-testid="btn-run-verify"]:not([disabled])');
  await page.locator('[data-testid="btn-run-verify"]').click({ force: true });
  await page.waitForSelector('[data-testid="verify-log"]', { timeout: 3000 });
  await page.waitForSelector('[data-testid="btn-approve"]:not([disabled])');
  await page.locator('[data-testid="btn-approve"]').click({ force: true });
  await page.waitForTimeout(200);
  const verifiedCount = await page.$$eval(
    '[data-card-state="verified"][data-testid="card-tile"]',
    (els) => els.length,
  );
  check("card now verified", verifiedCount === 1);

  console.log("\n10. Verified click → slide-in instead of modal");
  await page.click('[data-testid="card-tile"][data-card-state="verified"]');
  await page.waitForTimeout(200);
  const slideInOpen = await page.$('[data-testid="slide-in-panel"]');
  const modalOpen = await page.$('[data-testid="card-detail-panel"]');
  check("slide-in opens for verified", slideInOpen !== null);
  check("modal does NOT open for verified", modalOpen === null);

  console.log("\n11. Reset → load Rejected seed → Reopen");
  await page.click('[data-testid="scenario-b-reset"]');
  await page.waitForTimeout(200);
  await page.click('[data-testid="scenario-b-seed-rejected"]');
  await page.waitForSelector('[data-card-state="rejected"]');
  await page.click('[data-testid="card-tile"][data-card-state="rejected"]');
  await page.waitForSelector('[data-testid="card-detail-panel"][data-card-state="rejected"]');
  await page.fill('[data-testid="instruction-input"]', "수정된 지시입니다.");
  await page.click('[data-testid="btn-reopen"]');
  await page.waitForTimeout(200);
  const reopenedInstructedCount = await page.$$eval(
    '[data-card-state="instructed"][data-testid="card-tile"]',
    (els) => els.length,
  );
  check("rejected → instructed after reopen", reopenedInstructedCount === 1);

  console.log("\n12. Reset → load all-done (E seed) → E banner");
  await page.click('[data-testid="scenario-b-reset"]');
  await page.waitForTimeout(200);
  await page.click('[data-testid="scenario-b-seed-all"]');
  await page.waitForSelector('[data-card-state="verified"]');
  const bannerText = await page.$eval(
    '[data-testid="chat-stage-banner"]',
    (el) => el.textContent ?? "",
  );
  check("E-stage banner appears when all cards done", bannerText.includes("모든 카드"));
  const eStageTone = await page.$eval('[data-testid="chat-stage-banner"]', (el) =>
    el.getAttribute("data-tone"),
  );
  check("banner tone=success for all-done", eStageTone === "success");

  console.log("\n13. Stage remains d until a card is current — seed D only");
  await page.click('[data-testid="scenario-b-reset"]');
  await page.waitForTimeout(200);
  await page.click('[data-testid="scenario-b-seed-d"]');
  const stageDseed = await getStage(page);
  check("stage is d with decomposed seed", stageDseed === "d");

  console.log("\n14. CardStateBadge visible in detail panel");
  await page.click('[data-testid="card-tile"][data-card-state="decomposed"]');
  await page.waitForSelector('[data-testid="card-detail-panel"]');
  const panelHeader = await page.$eval(
    '[data-testid="card-detail-panel"]',
    (el) => el.textContent ?? "",
  );
  check("panel shows card title", panelHeader.includes("로그인 폼 구현"));

  console.log("\n15. Close panel via Cancel button → currentCardId resets");
  const cancelBtn = await page
    .locator('[data-testid="card-detail-panel"] button:has-text("취소")')
    .first();
  await cancelBtn.click();
  await page.waitForTimeout(200);
  const cardIdAfterClose = await page.$eval('[data-testid="current-card-id"]', (el) =>
    el.getAttribute("value"),
  );
  check("current-card-id cleared after close", cardIdAfterClose === "");

  console.log("\n16. D/I/V seed buttons cycle stages");
  await page.click('[data-testid="scenario-b-seed-i"]');
  await page.waitForSelector('[data-card-state="instructed"]');
  const iCount = await page.$$eval(
    '[data-card-state="instructed"][data-testid="card-tile"]',
    (els) => els.length,
  );
  check("I seed produces instructed card", iCount === 1);

  await page.click('[data-testid="scenario-b-seed-v"]');
  await page.waitForSelector('[data-card-state="verifying"]');
  const vCount = await page.$$eval(
    '[data-card-state="verifying"][data-testid="card-tile"]',
    (els) => els.length,
  );
  check("V seed produces verifying card", vCount === 1);

  console.log(`\n${"=".repeat(50)}`);
  console.log(`PASS ${pass}  FAIL ${fail}`);
  console.log("=".repeat(50));

  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
