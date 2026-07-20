// Version-sync verification: package.json / Cargo.toml / Cargo.lock /
// tauri.conf.json agree, the ADR bundle is complete, README/progress/
// changelog carry the required release markers, and the release-gate /
// release workflows keep their documented structure.
// Usage: node scripts/verify-version-sync.mjs [expected-version]
// With no argument, the expected version is read from dive/package.json —
// pass an explicit version only to override (e.g. checking the tree against
// an intended version before bumping package.json itself).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(repo, "dive/package.json"), "utf8"));
const expected = process.argv[2] ?? pkg.version;
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

function workflowRunExamplesUseApprovedRef(...docs) {
  return docs.every((doc) => {
    const lines = doc.split("\n");
    return lines.every((line, index) => {
      if (!/gh workflow run (?:release-gate|release)\.yml/.test(line)) {
        return true;
      }
      return lines
        .slice(index, index + 5)
        .join("\n")
        .includes("--ref <approved-branch>");
    });
  });
}

function cargoVersion() {
  return read("dive/src-tauri/Cargo.toml").match(/^version = "([^"]+)"/m)?.[1] ?? null;
}

function lockVersion() {
  const lock = read("dive/src-tauri/Cargo.lock");
  const section = lock.match(/\[\[package\]\]\r?\nname = "dive"\r?\nversion = "([^"]+)"/);
  return section?.[1] ?? null;
}

console.log(`1. Version sync (${expected})`);
const tauri = JSON.parse(read("dive/src-tauri/tauri.conf.json"));
check("package.json version", pkg.version === expected, pkg.version);
check("Cargo.toml version", cargoVersion() === expected, String(cargoVersion()));
check("Cargo.lock package version", lockVersion() === expected, String(lockVersion()));
check("tauri.conf.json version", tauri.version === expected, tauri.version);
check(
  "package script registered",
  pkg.scripts?.["verify:version-sync"] === "node scripts/verify-version-sync.mjs",
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
const changelogReleaseNotes = (() => {
  const header = `## [${expected}]`;
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.startsWith(header));
  if (start < 0) return "";
  const next = lines.findIndex((line, index) => index > start && line.startsWith("## ["));
  return lines
    .slice(start + 1, next === -1 ? undefined : next)
    .join("\n")
    .trim();
})();
check("CHANGELOG rc.2 release notes non-empty", changelogReleaseNotes.length > 0);

console.log("\n4. Tag / GitHub release external gates");
const releaseGateWorkflow = read(".github/workflows/release-gate.yml");
const releaseGateDocs = read("docs/release-gate-2026-05.md");
const packagingWindowsDocs = read("docs/packaging-windows.md");
const nextDocs = read("docs/internal/DIVE_NEXT.md");
const phase10PlanDocs = read("docs/internal/DIVE_NEXT_PHASE10_PLAN.md");
check(
  "release docs require committed current release prep",
  releaseGateDocs.includes("commit and push") &&
    releaseGateDocs.includes("current release prep state") &&
    releaseGateDocs.includes("workflow evidence must") &&
    releaseGateDocs.includes("current `release-gate.yml` /") &&
    releaseGateDocs.includes("`release.yml` hardening and docs") &&
    releaseGateDocs.includes("approval-packet.md") &&
    releaseGateDocs.includes("release-prep-commit-manifest.md") &&
    releaseGateDocs.includes("--ref <approved-branch>") &&
    releaseGateDocs.includes("Immediately before dispatching `release.yml`") &&
    releaseGateDocs.includes("same commit SHA") &&
    releaseGateDocs.includes("as the approved `release-gate.yml` run") &&
    releaseGateDocs.includes("numeric GitHub Actions `databaseId`") &&
    releaseGateDocs.includes("GitHub-hosted `windows-11-arm` label") &&
    releaseGateDocs.includes("bash ./scripts/verify-release-mock-guard.sh") &&
    releaseGateDocs.includes("Do not use `git add .`") &&
    releaseGateDocs.includes("`qa-sandbox/`") &&
    releaseGateDocs.includes("`.wily/sessions/**`") &&
    workflowRunExamplesUseApprovedRef(releaseGateDocs, packagingWindowsDocs) &&
    packagingWindowsDocs.includes("커밋·푸시된 현재 릴리스 준비 상태") &&
    packagingWindowsDocs.includes("같은 commit SHA") &&
    packagingWindowsDocs.includes("GitHub Actions `databaseId`") &&
    packagingWindowsDocs.includes("현재 로컬 하드닝을 증명하지 못한다") &&
    packagingWindowsDocs.includes("approval-packet.md") &&
    packagingWindowsDocs.includes("release-prep-commit-manifest.md") &&
    packagingWindowsDocs.includes("--ref <approved-branch>") &&
    packagingWindowsDocs.includes("`release.yml` dispatch 직전에는 remote SHA 확인을 다시 수행") &&
    packagingWindowsDocs.includes("gh workflow run release.yml --repo airmang/DIVE-2") &&
    packagingWindowsDocs.includes("-f tag=v1.0.0-rc.2") &&
    packagingWindowsDocs.includes('-f release_owner="<owner-name>"') &&
    packagingWindowsDocs.includes(
      '-f release_gate_run_id="<approved-numeric-release-gate-run-id>"',
    ) &&
    packagingWindowsDocs.includes("`git add .`는 사용하지 않고") &&
    packagingWindowsDocs.includes("`qa-sandbox/`") &&
    packagingWindowsDocs.includes("`.wily/sessions/**`"),
);
check(
  "Phase 10 SoT requires committed release prep before release evidence",
  nextDocs.includes("현재 release prep 변경이 승인된 브랜치에 커밋·푸시되고") &&
    nextDocs.includes("Stage 19 전체 완료 조건") &&
    phase10PlanDocs.includes(
      "Release-owner 승인 후 현재 release prep 변경을 승인된 브랜치에 커밋·푸시한다",
    ) &&
    phase10PlanDocs.includes("GitHub Release 권한 + 승인된 commit/push"),
);
check(
  "release-gate workflow manual dispatch only",
  releaseGateWorkflow.includes("workflow_dispatch:") && !/^\s+push:\s*$/m.test(releaseGateWorkflow),
);
check(
  "release-gate workflow requires release owner evidence",
  /release_owner:\s*\n\s+description:[^\n]*\n\s+required:\s*true/m.test(releaseGateWorkflow) &&
    releaseGateWorkflow.includes("RELEASE_OWNER: ${{ github.event.inputs.release_owner }}") &&
    releaseGateWorkflow.includes("DIVE_RELEASE_OWNER"),
);
check(
  "release-gate workflow runs x64 and ARM64 matrix",
  releaseGateWorkflow.includes("windows-latest") &&
    releaseGateWorkflow.includes("windows-11-arm") &&
    releaseGateWorkflow.includes("x86_64-pc-windows-msvc") &&
    releaseGateWorkflow.includes("aarch64-pc-windows-msvc"),
);
check(
  "release-gate workflow runs documented Gate A",
  [
    "pnpm typecheck",
    "pnpm lint --max-warnings 0",
    "pnpm build",
    "pnpm format:check",
    "pnpm verify:production-wire",
    "pnpm verify:v4",
    "npm --prefix pi-sidecar ci",
    "node pi-sidecar/build-sidecar.mjs --target ${{ matrix.target }}",
    "cargo fmt --all -- --check",
    "cargo test --features dev-mock --all-targets",
    "cargo clippy --features dev-mock --all-targets -- -D warnings",
    "cargo check --release",
    "bash ./scripts/verify-release-mock-guard.sh",
    '$driverTool = Join-Path $cargoBin "msedgedriver-tool.exe"',
    "& $driverTool",
  ].every((needle) => releaseGateWorkflow.includes(needle)),
);
check(
  "release-gate workflow uploads tested installer and smoke evidence",
  releaseGateWorkflow.includes("pnpm release:smoke -- --json-out") &&
    releaseGateWorkflow.includes("actions/upload-artifact@v4") &&
    releaseGateWorkflow.includes("DIVE-windows-${{ matrix.label }}-nsis") &&
    releaseGateWorkflow.includes("DIVE-release-smoke-${{ matrix.label }}") &&
    releaseGateWorkflow.includes("if-no-files-found: error"),
);
const releaseWorkflow = read(".github/workflows/release.yml");
check(
  "release workflow manual dispatch only",
  releaseWorkflow.includes("workflow_dispatch:") && !/^\s+push:\s*$/m.test(releaseWorkflow),
);
check(
  "release workflow requires owner and gate run id",
  releaseWorkflow.includes("release_owner:") &&
    releaseWorkflow.includes("release_gate_run_id:") &&
    releaseWorkflow.includes("release_gate_run_id must be the numeric GitHub Actions run id"),
);
check(
  "release workflow validates approved release-gate run",
  releaseWorkflow.includes("actions: read") &&
    releaseWorkflow.includes("gh run view") &&
    releaseWorkflow.includes("gh run download") &&
    releaseWorkflow.includes("DIVE-windows-x64-nsis") &&
    releaseWorkflow.includes("DIVE-windows-arm64-nsis") &&
    releaseWorkflow.includes("DIVE-release-smoke-x64") &&
    releaseWorkflow.includes("DIVE-release-smoke-arm64") &&
    releaseWorkflow.includes('smoke.mode !== "full"') &&
    releaseWorkflow.includes("smoke.evidence?.releaseOwner !== releaseOwner") &&
    releaseWorkflow.includes("smoke.evidence?.repo?.commit !== expectedSha") &&
    releaseWorkflow.includes("smoke.results.some((result) => !result.ok)") &&
    releaseWorkflow.includes("smoke.blockers.length > 0") &&
    releaseWorkflow.includes("String(run.databaseId) !== releaseGateRunId") &&
    releaseWorkflow.includes('run.workflowName !== "release-gate"') &&
    releaseWorkflow.includes('run.event !== "workflow_dispatch"') &&
    releaseWorkflow.includes('run.conclusion !== "success"') &&
    releaseWorkflow.includes("run.headSha !== expectedSha"),
);
check(
  "release workflow uploads evidence artifact",
  releaseWorkflow.includes("DIVE-release-evidence") &&
    releaseWorkflow.includes("release-evidence.md") &&
    releaseWorkflow.includes("source_file: release-gate-run.json") &&
    releaseWorkflow.includes("release-gate-run.json") &&
    releaseWorkflow.includes("installer-list.txt") &&
    releaseWorkflow.includes("find artifacts/DIVE-windows-x64-nsis") &&
    releaseWorkflow.includes("find artifacts/DIVE-windows-arm64-nsis") &&
    releaseWorkflow.includes("test -s installer-list.txt") &&
    releaseWorkflow.includes("release-gate-evidence-list.txt") &&
    releaseWorkflow.includes("test -f release-gate-evidence/x64/release-smoke-x64.json") &&
    releaseWorkflow.includes("test -f release-gate-evidence/arm64/release-smoke-arm64.json") &&
    releaseWorkflow.includes("test -s release-gate-evidence-list.txt") &&
    releaseWorkflow.includes("test -s release-notes.md") &&
    releaseWorkflow.includes("release-gate-evidence/**/*.json"),
);
check(
  "release workflow draft release uses dispatch tag and current SHA",
  releaseWorkflow.includes("tag_name: ${{ github.event.inputs.tag }}") &&
    releaseWorkflow.includes("target_commitish: ${{ github.sha }}"),
);
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
