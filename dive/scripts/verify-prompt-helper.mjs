// Playwright verification for task 5-4 (prompt helper + ambiguity detection).
// Run with: node scripts/verify-prompt-helper.mjs
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

  console.log("1. Navigate to prompt helper demo");
  await page.goto(`${BASE}/?demo=prompt-helper`);
  await page.waitForSelector('[data-testid="prompt-helper-demo-page"]');
  await page.waitForFunction(() => typeof window.__test_detect_ambiguity === "function");

  console.log("\n2. Detector detects pronoun and vague subject");
  const hits1 = await page.evaluate(() => window.__test_detect_ambiguity("이거 좀 고쳐줘"));
  check(
    "'이거' is pronoun hit",
    hits1.length >= 1 && hits1.some((h) => h.kind === "pronoun"),
    JSON.stringify(hits1),
  );
  const hits2 = await page.evaluate(() => window.__test_detect_ambiguity("뭔가 이상해"));
  check(
    "'뭔가' is vague_subject hit",
    hits2.some((h) => h.kind === "vague_subject"),
    JSON.stringify(hits2),
  );
  const hitsMissingTarget = await page.evaluate(() =>
    window.__test_detect_ambiguity("그냥 지워줘."),
  );
  check(
    "'지워줘.' alone triggers missing_target",
    hitsMissingTarget.some((h) => h.kind === "missing_target"),
    JSON.stringify(hitsMissingTarget),
  );
  const clean = await page.evaluate(() =>
    window.__test_detect_ambiguity("src/App.tsx 파일의 타이틀을 '안녕'으로 설정해 주세요"),
  );
  check("clean prompt has no hits", clean.length === 0, JSON.stringify(clean));

  console.log("\n3. Templates filtered by stage");
  const templatesDRaw = await page.evaluate(() =>
    window.__test_prompt_templates.filter((t) => t.stages.includes("D")),
  );
  check("D stage has >= 2 templates", templatesDRaw.length >= 2, String(templatesDRaw.length));
  const templatesV = await page.evaluate(() =>
    window.__test_prompt_templates.filter((t) => t.stages.includes("V")),
  );
  check("V stage has >= 2 templates", templatesV.length >= 2, String(templatesV.length));

  console.log("\n4. Type ambiguous text into ChatInput, hits appear after 500ms debounce");
  await page.fill('[data-testid="chat-input-textarea"]', "이거 좀 고쳐줘");
  await page.waitForSelector('[data-testid="ambiguity-hint-list"]', { timeout: 2000 });
  const hintKinds = await page.$$eval('[data-testid="ambiguity-hint"]', (els) =>
    els.map((el) => el.getAttribute("data-hit-kind")),
  );
  check("at least one pronoun hint", hintKinds.includes("pronoun"), JSON.stringify(hintKinds));

  console.log("\n5. Underlay renders highlighted span");
  const underlayCount = await page.$eval('[data-testid="ambiguity-underlay"]', (el) =>
    Number(el.getAttribute("data-hit-count")),
  );
  check("underlay reports hits", underlayCount >= 1, String(underlayCount));
  const markCount = await page.$$eval('[data-testid="ambiguity-hit"]', (els) => els.length);
  check("mark element rendered", markCount >= 1, String(markCount));

  console.log("\n6. Clean input has no hits");
  await page.fill('[data-testid="chat-input-textarea"]', "");
  await page.fill(
    '[data-testid="chat-input-textarea"]',
    "package.json 의 react 버전을 19.2.0 으로 설정해 주세요",
  );
  await page.waitForTimeout(700);
  const cleanCount = await page.$eval('[data-testid="ambiguity-underlay"]', (el) =>
    Number(el.getAttribute("data-hit-count")),
  );
  check("no hits on specific prompt", cleanCount === 0, String(cleanCount));

  console.log("\n7. Prompt helper panel opens and inserts template");
  await page.click('[data-testid="chat-prompt-helper"]');
  await page.waitForSelector('[data-testid="prompt-helper-panel"]');
  const templateButtons = await page.$$('[data-testid="prompt-helper-template"]');
  check("templates rendered in panel", templateButtons.length >= 2, String(templateButtons.length));
  const stageAttr = await page.$eval('[data-testid="prompt-helper-panel"]', (el) =>
    el.getAttribute("data-stage"),
  );
  check("panel shows current stage", stageAttr === "I", stageAttr ?? "");

  await page.fill('[data-testid="chat-input-textarea"]', "");
  await page.click('[data-testid="prompt-helper-template"][data-template-id="i-focus-card"]');
  const filled = await page.$eval('[data-testid="chat-input-textarea"]', (el) => el.value);
  check("template inserted into textarea", filled.includes("[현재 카드]"), filled);
  const panelAfterInsert = await page.$('[data-testid="prompt-helper-panel"]');
  check("panel closes after insert", panelAfterInsert === null);

  console.log("\n8. Stage switching changes templates");
  await page.click('[data-testid="stage-set"][data-stage="V"]');
  await page.click('[data-testid="chat-prompt-helper"]');
  await page.waitForSelector('[data-testid="prompt-helper-panel"][data-stage="V"]');
  const vTemplates = await page.$$('[data-testid="prompt-helper-template"]');
  check("V stage shows V templates", vTemplates.length >= 2, String(vTemplates.length));
  const firstIdV = await vTemplates[0].getAttribute("data-template-id");
  check("first V template starts with 'v-'", (firstIdV ?? "").startsWith("v-"), firstIdV ?? "");

  console.log(`\n---\nTotal: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
