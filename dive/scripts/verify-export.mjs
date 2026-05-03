// Playwright verification for task 3-6 (anonymized JSONL export demo UI).
// Run with: node scripts/verify-export.mjs
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

  console.log("1. Navigate to ?demo=export");
  await page.goto(`${BASE}/?demo=export`);
  await page.waitForSelector('[data-testid="demo-section-intro"]');

  console.log("\n2. Form + options + buttons present");
  check(
    "session select present",
    (await page.$('[data-testid="exp-session"]')) !== null,
  );
  check("options grid present", (await page.$('[data-testid="exp-options"]')) !== null);
  check(
    "preview button present",
    (await page.$('[data-testid="exp-preview"]')) !== null,
  );
  check(
    "download button present (disabled initially)",
    (await page.$eval('[data-testid="exp-download"]', (el) => el.disabled)) === true,
  );

  console.log("\n3. All 7 options rendered");
  const optKeys = [
    "includeMessages",
    "includeToolCalls",
    "includeVerifyLogs",
    "includeCheckpoints",
    "includeEvents",
    "hashUserText",
    "hashFilePaths",
  ];
  for (const key of optKeys) {
    const el = await page.$(`[data-testid="opt-${key}"]`);
    check(`option ${key} rendered`, el !== null);
  }

  console.log("\n4. All options default to checked");
  const checkedCount = await page.$$eval(
    '[data-testid="exp-options"] input[type="checkbox"]',
    (els) => els.filter((e) => e.checked).length,
  );
  check("all 7 checked by default", checkedCount === 7, String(checkedCount));

  console.log("\n5. Click 미리보기 with hashing on → masked preview");
  await page.click('[data-testid="exp-preview"]');
  await page.waitForSelector('[data-testid="demo-section-preview"]', { timeout: 3000 });
  const source = await page.$eval(
    '[data-testid="exp-source"]',
    (el) => el.textContent ?? "",
  );
  check("source badge visible", source.includes("mock") || source.includes("ipc"), source);

  const preview = await page.$eval(
    '[data-testid="exp-preview-text"]',
    (el) => el.textContent ?? "",
  );
  check(
    "preview contains masked hash prefix",
    preview.includes("h:") || preview.includes("p:"),
    "hashes present",
  );
  check(
    "plaintext user content NOT leaked when masking on",
    !preview.includes("로그인 폼 만들어줘"),
  );

  console.log("\n6. Toggle hashing off → plaintext visible");
  await page.click('[data-testid="opt-hashUserText"] input');
  await page.click('[data-testid="opt-hashFilePaths"] input');
  await page.click('[data-testid="exp-preview"]');
  await page.waitForTimeout(200);
  const preview2 = await page.$eval(
    '[data-testid="exp-preview-text"]',
    (el) => el.textContent ?? "",
  );
  check(
    "plaintext user content present when masking off",
    preview2.includes("로그인 폼 만들어줘"),
    preview2.slice(0, 40),
  );
  check(
    "plaintext file path present when masking off",
    preview2.includes("src/App.tsx"),
  );

  console.log("\n7. Exclude messages → message records disappear");
  await page.click('[data-testid="opt-includeMessages"] input');
  await page.click('[data-testid="exp-preview"]');
  await page.waitForTimeout(200);
  const preview3 = await page.$eval(
    '[data-testid="exp-preview-text"]',
    (el) => el.textContent ?? "",
  );
  const messageLines = preview3
    .split("\n")
    .filter((l) => l.includes('"kind":"message"'));
  check("no message records when excluded", messageLines.length === 0);

  console.log("\n8. Line count indicator updates with preview");
  const lineCountText = await page.$eval(
    '[data-testid="exp-line-count"]',
    (el) => el.textContent ?? "",
  );
  check("line count indicator shows 'records'", lineCountText.includes("records"), lineCountText);

  console.log("\n9. Download button enabled after preview");
  const downloadDisabled = await page.$eval(
    '[data-testid="exp-download"]',
    (el) => el.disabled,
  );
  check("download enabled after preview", downloadDisabled === false);

  console.log("\n10. Change session selection works");
  await page.selectOption('[data-testid="exp-session"]', "3");
  const selected = await page.$eval(
    '[data-testid="exp-session"]',
    (el) => el.value,
  );
  check("session selection updates", selected === "3");

  console.log("\n11. Main shell still works");
  await page.goto(BASE);
  await page.waitForTimeout(300);
  const shell = await page.$('[data-testid="workmap-strip"]');
  check("main shell still works", shell !== null);

  console.log("\n12. All other demo routes still reachable");
  await page.goto(`${BASE}/?demo=tool-guard`);
  await page.waitForTimeout(200);
  const tg = await page.$('[data-testid="demo-section-intro"]');
  check("tool-guard reachable", tg !== null);

  await page.goto(`${BASE}/?demo=provisioning`);
  await page.waitForTimeout(200);
  const prov = await page.$('[data-testid="demo-section-intro"]');
  check("provisioning reachable", prov !== null);

  await browser.close();
  console.log(`\n\nTotal: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
