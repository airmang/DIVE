#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const diveRoot = resolve(__dirname, "..");

const FORBIDDEN_STUDENT = /학생|선생님|교사/;
const FORBIDDEN_MODEL_IDS =
  /claude-\d|gpt-\d|gpt-4|claude-sonnet|claude-opus|claude-haiku|\bo1\b|gpt-5|gemini-\d|grok-\d/i;

const onboardingPath = "src/components/onboarding/OnboardingDialog.tsx";
const settingsPath = "src/pages/settings.tsx";

function read(relPath) {
  return readFileSync(resolve(diveRoot, relPath), "utf8");
}

const onboarding = read(onboardingPath);
if (FORBIDDEN_STUDENT.test(onboarding)) {
  console.error(`[FAIL] ${onboardingPath}: 학생/선생님/교사 문구 잔존`);
  process.exit(1);
}

for (const path of [onboardingPath, settingsPath]) {
  const src = read(path);
  const match = src.match(/PROVIDER_(?:CHOICES|KINDS)[\s\S]*?\];/);
  if (!match) {
    console.error(`[FAIL] ${path}: PROVIDER 배열을 찾지 못함`);
    process.exit(1);
  }

  const hints = [...match[0].matchAll(/hint:\s*"([^"]+)"/g)].map((m) => m[1]);
  for (const hint of hints) {
    if (FORBIDDEN_MODEL_IDS.test(hint)) {
      console.error(`[FAIL] ${path}: hint에 모델 ID 잔존 — "${hint}"`);
      process.exit(1);
    }
  }
}

if (onboarding.includes("⚠️ 베타 서비스") || read(settingsPath).includes("⚠️ 베타 서비스")) {
  console.error("[FAIL] opencode_zen warning에 ⚠️ 이모지 잔존");
  process.exit(1);
}

console.log("[OK] Track A 검증 통과");
