// Track 0 / task 7-14 verification: rc.2 version, ADR bundle, docs markers.
// Usage: node scripts/verify-version-sync.mjs [expected-version]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repo = path.resolve(new URL("../..", import.meta.url).pathname);
const expected = process.argv[2] ?? "1.0.0-rc.2";
let pass = 0;
let fail = 0;
let warn = 0;

function read(rel) {
  return fs.readFileSync(path.join(repo, rel), "utf8");
}

function readFirst(...rels) {
  const found = rels.find((rel) => fs.existsSync(path.join(repo, rel)));
  if (!found) {
    throw new Error(`none of these files exist: ${rels.join(", ")}`);
  }
  return read(found);
}

function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? "  " + detail : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? "  " + detail : ""}`);
  }
}

function note(name, detail = "") {
  warn++;
  console.log(`  WARN  ${name}${detail ? "  " + detail : ""}`);
}

function cargoVersion() {
  return read("dive/src-tauri/Cargo.toml").match(/^version = "([^"]+)"/m)?.[1] ?? null;
}

function lockVersion() {
  const lock = read("dive/src-tauri/Cargo.lock");
  const section = lock.match(/\[\[package\]\]\nname = "dive"\nversion = "([^"]+)"/);
  return section?.[1] ?? null;
}

console.log(`1. Version sync (${expected})`);
const pkg = JSON.parse(read("dive/package.json"));
const tauri = JSON.parse(read("dive/src-tauri/tauri.conf.json"));
check("package.json version", pkg.version === expected, pkg.version);
check("Cargo.toml version", cargoVersion() === expected, String(cargoVersion()));
check("Cargo.lock package version", lockVersion() === expected, String(lockVersion()));
check("tauri.conf.json version", tauri.version === expected, tauri.version);
check(
  "package script registered",
  pkg.scripts?.["verify:version-sync"]?.includes(expected),
  pkg.scripts?.["verify:version-sync"] ?? "missing",
);

console.log("\n2. ADR bundle");
const decisions = read("DIVE_DECISIONS.md");
const requiredIds = [
  ...Array.from({ length: 14 }, (_, i) => 39 + i),
  ...Array.from({ length: 6 }, (_, i) => 58 + i),
];
const realAdrIds = Array.from(decisions.matchAll(/^## ADR-(\d{3}):/gm)).map((m) => Number(m[1]));
const adrCount = realAdrIds.length;
const latestAdrId = Math.max(...realAdrIds);
check(
  "Track 0 ADR count",
  requiredIds.every((id) => realAdrIds.includes(id)),
  `required=${requiredIds.length}`,
);
for (const id of requiredIds) {
  const label = `ADR-${String(id).padStart(3, "0")}`;
  const current = decisions.indexOf(`## ${label}:`);
  const next = decisions.indexOf("\n## ADR-", current + 1);
  const body = current >= 0 ? decisions.slice(current, next === -1 ? undefined : next) : "";
  check(
    `${label} required sections`,
    ["- 컨텍스트:", "- 결정:", "- 대안:", "- 결과:", "- 참조 파일:"].every((needle) =>
      body.includes(needle),
    ),
  );
}

console.log("\n3. README / progress / changelog markers");
const readme = read("README.md");
const progress = readFirst("DIVE_PROGRESS.md", "docs/internal/DIVE_PROGRESS.md");
const changelog = read("CHANGELOG.md");
check(
  "README old v1.0 2026-11~12 completed Phase 6 row removed",
  !/2026-11\s*~\s*12.*\*\*v1\.0\*\*.*(Phase 6|✅)/.test(readme),
);
check("README mentions rc.1 yanked", /rc\.1.*Yanked|Yanked.*rc\.1|회수/.test(readme));
check(
  "README mentions rc.2 production wiring",
  /rc\.2.*production wiring|production wiring.*rc\.2|실 동작/i.test(readme),
);
check(
  "README ADR count updated",
  readme.includes(`(${adrCount} ADR`) &&
    readme.includes(`ADR-${String(latestAdrId).padStart(3, "0")}`),
  `expected=${adrCount} ADR, latest=ADR-${String(latestAdrId).padStart(3, "0")}`,
);
check("DIVE_PROGRESS Phase 7 exists", /## Phase 7 .*Production Wiring/.test(progress));
check(
  "DIVE_PROGRESS Phase 6 yanked note",
  /Phase 6[\s\S]{0,500}Yanked|Phase 6[\s\S]{0,500}회수/.test(progress),
);
check(
  "DIVE_PROGRESS 7-14 marked complete or gated",
  /7-14[\s\S]{0,400}(완료|PHASE_GATE|외부 blocker)/.test(progress),
);
check("CHANGELOG rc.2 header", changelog.includes(`## [${expected}]`));
check("CHANGELOG rc.1 yanked header", changelog.includes("## [Yanked] 1.0.0-rc.1"));
check(
  "CHANGELOG yanked references ADR-052",
  /\[Yanked\] 1\.0\.0-rc\.1[\s\S]*ADR-052/.test(changelog),
);

console.log("\n4. Tag / GitHub release external gates");
let tags = "";
try {
  tags = execFileSync("git", ["tag", "--list", "v1.0.0-rc.*", "-n9"], {
    cwd: repo,
    encoding: "utf8",
  });
} catch (err) {
  tags = String(err);
}
if (!tags.includes("v1.0.0-rc.1")) {
  note(
    "rc.1 local tag not present",
    "local clone has no rc tags; GitHub release/tag validation remains external",
  );
} else {
  check("rc.1 local tag exists", true);
}
if (!tags.includes("v1.0.0-rc.2")) {
  note(
    "rc.2 local tag not created",
    "blocked until release gate full Windows smoke and publish authority",
  );
} else {
  check("rc.2 local tag exists", true);
}
note(
  "GitHub Release API verification",
  "blocked without GitHub release authority; rc.1 yank UI action remains explicit external blocker",
);

console.log(`\nPASS ${pass} / FAIL ${fail} / WARN ${warn}`);
process.exit(fail === 0 ? 0 : 1);
