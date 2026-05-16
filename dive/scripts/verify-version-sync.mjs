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
const roadmap = read(".wily/roadmap.yaml");
const wilyStatus = read(".wily/status.md");
const releaseSyncRequest = read(
  ".wily/phases/p10-09-external-release-blockers/release-sync-approval-request.md",
);
const externalEvidenceRequest = read(
  ".wily/phases/p10-09-external-release-blockers/external-evidence-request.md",
);
const approvalPacket = read(".wily/phases/p10-09-external-release-blockers/approval-packet.md");
const releasePrepManifest = read(
  ".wily/phases/p10-09-external-release-blockers/release-prep-commit-manifest.md",
);
const releaseOwnerTemplate = read(
  ".wily/phases/p10-09-external-release-blockers/release-owner-approval-template.md",
);
const p1009Handoff = read(".wily/phases/p10-09-external-release-blockers/handoff.md");
const p1009Verification = read(".wily/phases/p10-09-external-release-blockers/verification.md");
const p1009Phase = read(".wily/phases/p10-09-external-release-blockers/phase.md");
const p1009Result = read(".wily/phases/p10-09-external-release-blockers/result.md");
const p1009CompletionAudit = read(
  ".wily/phases/p10-09-external-release-blockers/completion-audit.md",
);
const p1009PrettierDocs = [
  "../.wily/phases/p10-09-external-release-blockers/approval-packet.md",
  "../.wily/phases/p10-09-external-release-blockers/release-sync-approval-request.md",
  "../.wily/phases/p10-09-external-release-blockers/release-prep-commit-manifest.md",
  "../.wily/phases/p10-09-external-release-blockers/release-owner-approval-template.md",
  "../.wily/phases/p10-09-external-release-blockers/external-evidence-request.md",
  "../.wily/phases/p10-09-external-release-blockers/verification.md",
  "../.wily/phases/p10-09-external-release-blockers/handoff.md",
  "../.wily/phases/p10-09-external-release-blockers/completion-audit.md",
  "../.wily/phases/p10-09-external-release-blockers/phase.md",
  "../.wily/phases/p10-09-external-release-blockers/result.md",
];
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
    p1009PrettierDocs.every((needle) => releaseGateDocs.includes(needle)) &&
    workflowRunExamplesUseApprovedRef(
      releaseGateDocs,
      packagingWindowsDocs,
      externalEvidenceRequest,
      p1009Handoff,
    ) &&
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
  "release owner approval template covers external closure evidence",
  [
    "## 1. Release Prep Sync Approval",
    "## 2. Windows Smoke Evidence",
    "### x64",
    "### ARM64",
    "## 3. Release Gate Evidence",
    "## 4. Release Workflow Evidence",
    "## 5. rc.1 Yank / Absence Decision",
    "## 6. Final Ship / Defer Decision",
    "현재 release prep 변경을 main에 commit/push하고 P10-09 GitHub release-gate 증거 수집을 진행해도 된다.",
    "`release-gate.yml` numeric run id (`databaseId`)",
    "`release.yml` numeric run id (`databaseId`)",
    "Approved release-gate numeric run id input",
    "git ls-remote origin refs/heads/<approved-branch>",
    "DIVE-release-evidence",
    "release-gate-run.json",
    "Remote SHA confirmation immediately before `release.yml` dispatch",
    "same commit SHA",
    "approved `release-gate.yml` run",
    "Staging safety summary",
    "do not use `git add .`",
    "no `qa-sandbox/` paths",
    "no `.wily/sessions/**` paths",
    "2026-05-15 00:05 KST",
    "Latest recorded tracked diffstat: 56 files changed, 2964 insertions, 606 deletions",
    "--ref <approved-branch>",
    "Secret hygiene summary",
    "found no provider key",
  ].every((needle) => releaseOwnerTemplate.includes(needle)),
);
check(
  "Wily status points to release approval packet",
  wilyStatus.includes("approval-packet.md") &&
    wilyStatus.includes("release-sync-approval-request.md") &&
    wilyStatus.includes("release-prep-commit-manifest.md") &&
    wilyStatus.includes("release-owner-approval-template.md") &&
    ['status: "blocked"', "release-gate-run.json", "Windows x64/ARM64", "GitHub Release"].every(
      (needle) => roadmap.includes(needle),
    ) &&
    ((roadmap.includes('id: "P10-09"') &&
      roadmap.includes("pre-push verification passing on 2026-05-15 00:14 KST") &&
      roadmap.includes("PASS 53 / FAIL 0 / WARN 3") &&
      roadmap.includes(
        "approval-packet.md and release-owner-approval-template.md summarize the exact approval sentence",
      ) &&
      roadmap.includes("2026-05-15 00:05 KST dry-run showing 172 stage-candidate paths") &&
      roadmap.includes("tracked diffstat 56 files changed / 2964 insertions / 606 deletions") &&
      roadmap.includes(
        "release-owner/user approval is still required before commit/push or GitHub Actions dispatch",
      ) &&
      roadmap.includes("2026-05-15 00:00 KST read-only GitHub refresh found no releases") &&
      roadmap.includes("local HEAD still differs from origin/main")) ||
      (roadmap.includes('schema: "stage-first"') &&
        roadmap.includes('id: "S04"') &&
        roadmap.includes("legacy_phases:") &&
        roadmap.includes('"P10-09"') &&
        roadmap.includes(
          "Commit/push approval is separate from GitHub Actions dispatch or release publish approval.",
        ) &&
        roadmap.includes("final release-owner ship/defer decision"))),
);
check(
  "release sync approval request covers commit and push approval",
  [
    "## Current State",
    "## Approval Requested",
    "## Required Pre-Push Verification",
    "## Post-Approval Execution Order",
    "## Required Push Confirmation",
    "## Approval Record",
    "git rev-parse HEAD",
    "git ls-remote origin refs/heads/<approved-branch>",
    "git diff --cached --name-only | rg '^(qa-sandbox/|\\.wily/sessions/)'",
    "Dispatch `release-gate.yml` only after the remote SHA match is recorded",
    "Dispatch `release.yml` only after the approved numeric `release-gate.yml`",
    "Re-run the remote SHA confirmation immediately before dispatching",
    "approved branch must still point to the same commit SHA",
    "Include `--ref <approved-branch>` in both workflow dispatch commands",
    "2026-05-15 00:00 KST",
    "2026-05-15 00:05 KST",
    "release-gate-run.json",
    "Latest recorded tracked diffstat: 56 files changed, 2964 insertions, 606",
    "release-gate.yml",
    "release.yml",
    ...p1009PrettierDocs,
  ].every((needle) => releaseSyncRequest.includes(needle)) &&
    [
      "staging summary confirming the explicit manifest staging list was used",
      "Do not use `git add .`",
      "dry-run check",
      "--ref <approved-branch>",
      "Repeat the same remote SHA confirmation immediately before dispatching",
      "same commit SHA as",
      "GitHub Actions `databaseId`",
      "gh workflow run release.yml --repo airmang/DIVE-2",
      "-f tag=v1.0.0-rc.2",
      '-f release_owner="<owner-name>"',
      '-f release_gate_run_id="<approved-numeric-release-gate-run-id>"',
      "no `qa-sandbox/` paths",
      "`.wily/sessions/**` paths",
      "2026-05-15 00:05 KST",
      "56 files changed, 2964 insertions, and 606 deletions",
      "2026-05-15 00:00 KST",
      "release-gate-run.json",
      "Secret scans found no provider key",
      ...p1009PrettierDocs,
    ].every((needle) => externalEvidenceRequest.includes(needle)) &&
    [
      "현재 release prep 변경을 main에 commit/push하고 P10-09 GitHub release-gate 증거 수집을 진행해도 된다.",
      "2026-05-14 22:09 KST read-only remote refresh",
      "2026-05-14 22:38 KST release prep manifest refresh",
      "no `qa-sandbox/` or `.wily/sessions/**` paths",
      "no paths are staged",
      "--ref <approved-branch>",
      "Repeat the same remote SHA confirmation immediately before dispatching",
      "same commit SHA as",
      "GitHub Actions `databaseId`",
      "gh workflow run release.yml --repo airmang/DIVE-2",
      "-f tag=v1.0.0-rc.2",
      '-f release_owner="<owner-name>"',
      '-f release_gate_run_id="<approved-numeric-release-gate-run-id>"',
      "2026-05-14 22:35 KST local evidence search",
      "2026-05-15 00:00 KST completion audit refresh",
      "2026-05-15 00:05 KST staging safety refresh",
      "56 files changed with 2964 insertions and 606 deletions",
      "release-owner approval template evidence fields remained blank",
      "release-gate-run.json",
      "Do not treat local preflight, version sync, or documentation readiness as",
    ].every((needle) => p1009Handoff.includes(needle)) &&
    [
      "2026-05-14 22:09 KST read-only remote refresh",
      "2026-05-14 22:38 KST release prep manifest refresh passed",
      "local HEAD `afe56d1bead61a56617cfa127ce71ee89fbb6deb` still differs from `origin/main`",
      "no `qa-sandbox/` or `.wily/sessions/**` paths",
      "no paths are staged",
      "2026-05-14 22:35 KST local evidence search passed as a negative audit",
      "2026-05-15 00:00 KST completion audit refresh passed as a negative audit",
      "2026-05-15 00:05 KST staging safety refresh passed",
      "tracked diffstat 56 files changed with 2964 insertions and 606 deletions",
      "release-gate-run.json",
      "matches the GitHub Actions `databaseId`",
      "release-owner approval template evidence fields remained blank",
    ].every((needle) => p1009Verification.includes(needle)) &&
    [
      "현재 release prep 변경을 main에 commit/push하고 P10-09 GitHub release-gate 증거 수집을 진행해도 된다.",
      "Windows x64 installed-app smoke evidence",
      "Windows ARM64 installed-app smoke evidence",
      "release-owner-approved ARM64 hardware/access blocker",
      "release-owner/user 승인 전에는 commit/push 또는 workflow dispatch를 하지 않는다",
    ].every((needle) => p1009Phase.includes(needle)) &&
    [
      "2026-05-14 22:19 KST completion audit refresh",
      "2026-05-14 22:38 KST explicit staging dry-run",
      "2026-05-14 22:35 KST local evidence search found no Windows smoke JSON",
      "2026-05-15 00:00 KST completion audit refresh",
      "2026-05-15 00:05 KST explicit staging dry-run",
      "release-gate-run.json",
      "56 files changed, 2964 insertions, and 606 deletions",
      "matches the GitHub Actions `databaseId`",
      "현재 release prep 변경을 main에 commit/push하고 P10-09 GitHub release-gate 증거 수집을 진행해도 된다.",
      "Do not run `$wily-complete P10-09` until those external evidence items are present",
    ].every((needle) => p1009Result.includes(needle)) &&
    [
      "2026-05-14 22:35 KST local evidence search found no `release-smoke*.json`",
      "DIVE-release-evidence",
      "release-gate-evidence-list.txt",
      "release-gate-run.json",
      "2026-05-15 00:00 KST completion audit refresh",
      "2026-05-15 00:05 KST explicit staging dry-run refresh",
      "release-owner approval template fields",
      "final ship/defer decision remain blank",
    ].every((needle) => p1009CompletionAudit.includes(needle)) &&
    [
      "현재 release prep 변경을 main에 commit/push하고 P10-09 GitHub release-gate 증거 수집을 진행해도 된다.",
      "Do not use `git add .`",
      "Do not dispatch `release-gate.yml` until the pushed branch SHA matches the",
      "Do not dispatch `release.yml` until the approved numeric `release-gate.yml`",
      "--ref <approved-branch>",
      "Windows x64 installed-app smoke evidence",
      "Windows ARM64 installed-app smoke evidence",
      "Final release-owner ship/defer decision",
      "Latest remote refresh: no GitHub releases",
      "Explicit staging dry-run found 172 stage-candidate paths",
      "Tracked diffstat snapshot: 56 files changed, 2964 insertions, 606 deletions",
      "git diff --stat | tail -1",
      "Secret hygiene scan found no provider key, private-key block, GitHub token, or",
    ].every((needle) => approvalPacket.includes(needle)),
);
check(
  "release prep commit manifest covers include and exclude scope",
  [
    "## Commit Scope Recommendation",
    "### Include",
    "### Review Before Include",
    "### Exclude",
    "## Staging Commands After Approval",
    ".github/workflows/release-gate.yml",
    ".gitignore",
    "dive/scripts/verify-version-sync.mjs",
    ".wily/phases/**",
    ".wily/sessions/**",
    "qa-sandbox/",
    "Provider keys, OAuth tokens, cookies, or raw secret files",
    "Do not use `git add .`",
    "Run the `git add --dry-run` count and exclusion checks serially",
    ".git/index.lock",
    "git diff --cached --name-only | rg '^(qa-sandbox/|\\.wily/sessions/)'",
    "Tracked diffstat",
    "Untracked classification",
    "Dry-run output contained",
    "## Proposed Commit Message",
    "Prepare Phase 10 release gate evidence",
    ...p1009PrettierDocs,
  ].every((needle) => releasePrepManifest.includes(needle)),
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
