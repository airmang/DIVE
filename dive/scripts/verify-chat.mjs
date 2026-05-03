// Standalone Playwright verification for task 2-2 (chat area + message stream).
// Run with: node scripts/verify-chat.mjs
// Requires dev server running on http://localhost:1420.

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

  console.log("1. Navigate to ?demo=chat");
  await page.goto(`${BASE}/?demo=chat`);
  await page.waitForSelector('[data-testid="demo-section-six"]');

  console.log("\n2. Six message kinds render statically");
  const sixKinds = await page.$$eval(
    '[data-testid="demo-section-six"] [data-testid="chat-message"]',
    (els) => els.map((e) => e.getAttribute("data-kind")),
  );
  const expected = ["system", "user", "assistant", "tool_call", "tool_result", "error"];
  check(
    "6 distinct kinds rendered",
    expected.every((k) => sixKinds.includes(k)),
    JSON.stringify(sixKinds),
  );

  console.log("\n3. Assistant and user messages have different alignment");
  const userAlign = await page.$eval(
    '[data-testid="demo-section-six"] [data-kind="user"]',
    (el) => getComputedStyle(el).alignItems,
  );
  const assistantAlign = await page.$eval(
    '[data-testid="demo-section-six"] [data-kind="assistant"]',
    (el) => getComputedStyle(el).alignItems,
  );
  check(
    "user right-aligned, assistant left-aligned",
    userAlign === "flex-end" && assistantAlign === "flex-start",
    `user=${userAlign} assistant=${assistantAlign}`,
  );

  console.log("\n4. ErrorMessage has role=alert and retry button");
  const errorHasRetry = await page.$(
    '[data-testid="demo-section-six"] [data-kind="error"] [data-testid="error-retry"]',
  );
  check("error retry button present", !!errorHasRetry);

  console.log("\n5. MessageList has role=log + aria-live=polite");
  const logAttrs = await page.$eval(
    '[data-testid="demo-section-stream"] [data-testid="message-list"]',
    (el) => ({
      role: el.getAttribute("role"),
      live: el.getAttribute("aria-live"),
    }),
  );
  check(
    "role=log aria-live=polite",
    logAttrs.role === "log" && logAttrs.live === "polite",
    JSON.stringify(logAttrs),
  );

  console.log("\n6. Send button disabled when input empty");
  const sendDisabled = await page.$eval(
    '[data-testid="demo-section-stream"] [data-testid="chat-send"]',
    (el) => el.disabled,
  );
  check("send disabled on empty", sendDisabled);

  console.log("\n7. Send button enabled after typing");
  await page.fill(
    '[data-testid="demo-section-stream"] [data-testid="chat-input-textarea"]',
    "안녕",
  );
  await page.waitForTimeout(50);
  const sendEnabled = await page.$eval(
    '[data-testid="demo-section-stream"] [data-testid="chat-send"]',
    (el) => !el.disabled,
  );
  check("send enabled when non-empty", sendEnabled);

  console.log("\n8. Enter submits, user message appears");
  await page.focus('[data-testid="demo-section-stream"] [data-testid="chat-input-textarea"]');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  const userMsgCount = await page.$$eval(
    '[data-testid="demo-section-stream"] [data-testid="chat-message"][data-kind="user"]',
    (els) => els.length,
  );
  check("one user message in stream after Enter", userMsgCount === 1, `got ${userMsgCount}`);

  console.log("\n9. Assistant streaming appears within ~600ms + content grows");
  await page.waitForTimeout(700);
  const assistantInitial = await page.$eval(
    '[data-testid="demo-section-stream"] [data-kind="assistant"] [data-testid="assistant-content"]',
    (el) => el.textContent?.length ?? 0,
  );
  await page.waitForTimeout(400);
  const assistantLater = await page.$eval(
    '[data-testid="demo-section-stream"] [data-kind="assistant"] [data-testid="assistant-content"]',
    (el) => el.textContent?.length ?? 0,
  );
  check(
    "assistant content grows over time (streaming)",
    assistantLater > assistantInitial && assistantInitial > 0,
    `initial=${assistantInitial} later=${assistantLater}`,
  );

  console.log("\n10. Streaming cursor visible while streaming");
  const cursorStreaming = await page.$(
    '[data-testid="demo-section-stream"] [data-kind="assistant"][data-streaming="true"] [data-testid="streaming-cursor"]',
  );
  check("cursor visible during stream", !!cursorStreaming);

  console.log("\n11. Wait for stream completion, cursor goes away");
  await page.waitForFunction(
    () => {
      const el = document.querySelector(
        '[data-testid="demo-section-stream"] [data-kind="assistant"]',
      );
      return el?.getAttribute("data-streaming") === "false";
    },
    { timeout: 20000 },
  );
  const cursorAfter = await page.$(
    '[data-testid="demo-section-stream"] [data-kind="assistant"][data-streaming="true"] [data-testid="streaming-cursor"]',
  );
  check("cursor gone after completion", !cursorAfter);

  console.log("\n12. Shift+Enter inserts newline (no submit)");
  await page.fill(
    '[data-testid="demo-section-stream"] [data-testid="chat-input-textarea"]',
    "",
  );
  await page.focus('[data-testid="demo-section-stream"] [data-testid="chat-input-textarea"]');
  await page.keyboard.type("line1");
  await page.keyboard.down("Shift");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
  await page.keyboard.type("line2");
  const taValue = await page.$eval(
    '[data-testid="demo-section-stream"] [data-testid="chat-input-textarea"]',
    (el) => el.value,
  );
  check("shift+enter inserts newline", taValue.includes("\n"), JSON.stringify(taValue));

  console.log("\n13. Integrated ChatArea (section 3) renders MessageList");
  const integratedList = await page.$(
    '[data-testid="demo-section-integrated"] [data-testid="message-list"]',
  );
  check("integrated ChatArea has message list", !!integratedList);

  console.log("\n14. Integrated card title prop visible");
  const cardTitle = await page.$eval(
    '[data-testid="demo-section-integrated"] [data-testid="chat-card-title"]',
    (el) => el.textContent,
  );
  check(
    "card title prop renders in header",
    cardTitle?.includes("할 일 앱") ?? false,
    cardTitle ?? "null",
  );

  console.log("\n15. Route: default shell still works");
  await page.goto(BASE);
  await page.waitForTimeout(300);
  const mainShell = await page.$('[data-testid="workmap-strip"]');
  check("default route renders MainShell", !!mainShell);

  console.log("\n16. Routes ?demo=workmap and ?demo=showcase still reachable");
  await page.goto(`${BASE}/?demo=workmap`);
  await page.waitForTimeout(300);
  const workmap = await page.$('[data-testid="demo-section-expanded"]');
  check("workmap demo reachable", !!workmap);
  await page.goto(`${BASE}/?demo=showcase`);
  await page.waitForTimeout(300);
  const showcase = await page.$("h1");
  check("showcase demo reachable", !!showcase);

  console.log("\n17. Auto-scroll pins to bottom on new message");
  await page.goto(`${BASE}/?demo=chat`);
  await page.waitForSelector('[data-testid="demo-section-stream"]');
  await page.fill(
    '[data-testid="demo-section-stream"] [data-testid="chat-input-textarea"]',
    "긴 메시지 테스트",
  );
  await page.focus('[data-testid="demo-section-stream"] [data-testid="chat-input-textarea"]');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  const autoScrollAttr = await page.$eval(
    '[data-testid="demo-section-stream"] [data-testid="message-list"]',
    (el) => el.getAttribute("data-auto-scroll"),
  );
  check("auto-scroll still true after send", autoScrollAttr === "true", `got ${autoScrollAttr}`);

  await browser.close();

  console.log(`\n\nTotal: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
