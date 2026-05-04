#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

function read(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

const settings = read("dive/src/pages/settings.tsx");
const sidebar = read("dive/src/components/shell/Sidebar.tsx");

const checks = [
  {
    name: "Settings has General section",
    ok: /data-testid="settings-section-general"/.test(settings),
  },
  {
    name: "Settings has locale select",
    ok: /data-testid="settings-locale-select"/.test(settings),
  },
  {
    name: "Theme toggle moved into General (no separate theme section)",
    ok:
      !/data-testid="settings-section-theme"/.test(settings) &&
      /data-testid="settings-theme-toggle"/.test(settings),
  },
  {
    name: "Settings imports locale store and locale labels",
    ok: /useLocaleStore/.test(settings) && /SUPPORTED_LOCALES/.test(settings),
  },
  {
    name: "Sidebar removed language-switch",
    ok: !/data-testid="language-switch"/.test(sidebar),
  },
  {
    name: "Sidebar removed lang-ko/lang-en buttons",
    ok: !/data-testid="lang-(ko|en)"/.test(sidebar),
  },
  {
    name: "Sidebar removed Languages icon import",
    ok: !/from "lucide-react"[^;]*\bLanguages\b/.test(sidebar),
  },
  {
    name: "General section appears before Providers section",
    ok: (() => {
      const gi = settings.indexOf('settings-section-general');
      const pi = settings.indexOf('settings-section-providers');
      return gi > 0 && pi > 0 && gi < pi;
    })(),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`[OK] ${check.name}`);
  } else {
    console.error(`[FAIL] ${check.name}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\n[OK] Track C 검증 통과");
