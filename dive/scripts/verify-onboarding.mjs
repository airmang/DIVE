// Playwright verification for task 7-10 — onboarding product semantics.
// Run with: node scripts/verify-onboarding.mjs
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

async function newPage(browser, mockMode = null) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (mockMode) {
    await context.addInitScript((mode) => {
      const state = { providers: [], nextId: 1 };
      window.__DIVE_MOCK_TAURI__ = state;
      window.__TAURI_INTERNALS__ = {
        invoke: async (cmd, args = {}) => {
          if (cmd === "project_list") return [];
          if (cmd === "provider_list") return state.providers;
          if (cmd === "session_list") return [];
          if (cmd === "provider_connect") {
            if (mode === "connect-fail") throw new Error("401 unauthorized");
            const row = {
              id: state.nextId++,
              kind: args.kind,
              auth_type: "api_key",
              base_url: args.baseUrl ?? null,
              is_connected: true,
            };
            state.providers.push(row);
            return row;
          }
          if (cmd === "provider_disconnect") {
            state.providers = state.providers.filter((p) => p.id !== args.providerConfigId);
            window.__DIVE_MOCK_TAURI__ = state;
            return null;
          }
          throw new Error(`unexpected command ${cmd}`);
        },
      };
    }, mockMode);
  }
  const page = await context.newPage();
  return { context, page };
}

async function resetAndLoad(page) {
  await page.goto(BASE);
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem("dive:rc1_migrated", "true");
  });
  await page.reload();
  await page.waitForSelector('[data-testid="sidebar"]');
}

async function main() {
  const browser = await chromium.launch();

  console.log("1. Browser product path: first run shows onboarding");
  {
    const { context, page } = await newPage(browser);
    await resetAndLoad(page);
    const dialog = await page.waitForSelector('[data-testid="onboarding-dialog"]', {
      timeout: 3000,
    });
    check("onboarding dialog rendered", dialog !== null);
    check(
      "provider required banner rendered",
      (await page.$('[data-testid="provider-required-banner"]')) !== null,
    );
    check("anthropic choice", (await page.$('[data-testid="onb-kind-anthropic"]')) !== null);
    check("openai choice", (await page.$('[data-testid="onb-kind-openai"]')) !== null);
    check("openrouter choice", (await page.$('[data-testid="onb-kind-openrouter"]')) !== null);
    check("opencode zen choice", (await page.$('[data-testid="onb-kind-opencode_zen"]')) !== null);
    check("api key input", (await page.$('[data-testid="onb-api-key"]')) !== null);

    console.log("\n2. Empty api key shows inline error");
    await page.click('[data-testid="onb-connect"]');
    await page.waitForSelector('[data-testid="onb-error"]', { timeout: 1000 });
    check("empty key error shown", true);

    console.log("\n3. Skip closes dialog but does not mark onboarded");
    await page.click('[data-testid="onb-skip"]');
    await page.waitForSelector('[data-testid="onboarding-dialog"]', {
      state: "detached",
      timeout: 1500,
    });
    check("dialog closed after skip", true);
    const onboarded = await page.evaluate(() => window.localStorage.getItem("dive:onboarded"));
    check("skip does not persist onboarded=true", onboarded !== "true", String(onboarded));
    check(
      "provider setup banner remains",
      (await page.$('[data-testid="provider-required-banner"]')) !== null,
    );

    console.log("\n4. Reload after skip reopens onboarding");
    await page.reload();
    await page.waitForSelector('[data-testid="onboarding-dialog"]', { timeout: 3000 });
    check("dialog re-opens after skip + reload", true);
    await context.close();
  }

  console.log("\n5. Mock Tauri provider_connect failure keeps onboarded false");
  {
    const { context, page } = await newPage(browser, "connect-fail");
    await resetAndLoad(page);
    await page.fill('[data-testid="onb-api-key"]', "bad-key");
    await page.click('[data-testid="onb-connect"]');
    await page.waitForSelector('[data-testid="onb-error"]', { timeout: 2000 });
    const errText = await page.textContent('[data-testid="onb-error"]');
    check(
      "failure message distinguishes auth",
      errText?.includes("키가 잘못") === true,
      errText ?? "",
    );
    const onboarded = await page.evaluate(() => window.localStorage.getItem("dive:onboarded"));
    check("failed connect does not mark onboarded", onboarded !== "true", String(onboarded));
    const providerCount = await page.evaluate(() => window.__DIVE_MOCK_TAURI__.providers.length);
    check("failed connect did not persist provider", providerCount === 0, `count=${providerCount}`);
    await context.close();
  }

  console.log("\n6. Mock Tauri provider_connect success marks onboarded and opens project CTA");
  {
    const { context, page } = await newPage(browser, "connect-success");
    await resetAndLoad(page);
    await page.fill('[data-testid="onb-api-key"]', "good-key");
    await page.click('[data-testid="onb-connect"]');
    await page.waitForSelector('[data-testid="onboarding-dialog"]', {
      state: "detached",
      timeout: 2000,
    });
    const onboarded = await page.evaluate(() => window.localStorage.getItem("dive:onboarded"));
    check("successful connect persists onboarded", onboarded === "true", String(onboarded));
    check(
      "provider banner hidden after connect",
      (await page.$('[data-testid="provider-required-banner"]')) === null,
    );
    check(
      "new project CTA opens after connect",
      (await page.$('[data-testid="new-project-dialog"]')) !== null,
    );
    await context.close();
  }

  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
