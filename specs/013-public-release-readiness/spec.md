# Feature Specification: Public Release Readiness (Round 4)

**Feature Branch**: `013-public-release-readiness`

**Created**: 2026-07-20

**Status**: Approved (owner, 2026-07-20 — full scope "3단계 전부", staged via Wily
S-058–S-070, implemented in stage order by Opus/Sonnet subagents under root
verification)

**Input**: Full-repo public-release code review, 2026-07-20 (14 parallel review
areas over ~130k LOC, every finding adversarially verified against the actual
code). Evidence:
[`docs/qa/public-release-code-review-2026-07-20.md`](../../docs/qa/public-release-code-review-2026-07-20.md)
(**124 confirmed findings: 2 P0 / 35 P1 / 87 P2**; finding IDs P0-1, A1–A3,
B1–B5, C1–C8, D1–D3, E1–E7, F1–F3, G1–G4 referenced below are that report's).

**Deadline anchor**: the repository goes **public simultaneously with the
2026-08-14 conference presentation (Busan)**. Everything in Wave 1 plus the
history purge (S-070) is a hard gate for the flip; Waves 2–3 are the
quality-criticism surface ("개판/비효율" prevention) and should land before the
flip in stage order.

## Context And Why

011 achieved macOS demo GO. The remaining risk is no longer "does the demo
work" but "what does an external developer see when the repo becomes public."
The review verdict: the foundation is healthier than feared — zero real secrets
in tree *and* full history, strong security cores (FsGuard, egress_guard,
keyring redaction), no debug residue — but four criticism surfaces are real:

1. **A hard legal blocker**: 18 copyrighted academic paper PDFs (30 MB) are
   tracked, in history, and pushed to origin/main (P0-1). Public flip without a
   purge is copyright infringement (DMCA-exposed).
2. **Giant files**: 6 files over ~1.5k lines (workspace_plan.rs 7,724;
   supervisor.rs 4,217; pi_sidecar.rs 3,794; agent/mod.rs 3,227;
   useProductShellController.ts 2,365; StepDetailSlideIn.tsx 1,858).
3. **Dead code advertised by its own lint suppression**: crate-root
   `#![allow(dead_code)]` under a `-D warnings` CI, template `greet`, an
   ~800-line caller-less legacy agent loop, 23 orphaned scripts, dead FE
   components/wiring.
4. **Copy-paste**: loadTauri ×18, the security-critical tool-approval pipeline
   ×2 (~370 lines, already drifted), sidecar spawn loop ×4.

Real bugs confirmed along the way (oldest-200 history window, evidence-losing
unmount, silent failures, staging-file leak) ride the same round.

## Non-Goals

- No new product features; no supervision-behavior changes beyond confirmed
  bug fixes. Constitution I–VI remain binding; splits are behavior-preserving.
- No blanket P2 sweep: P2s land only where folded into a themed stage below.
  Unabsorbed P2s remain backlog in the review report.
- The 011 tail (S-055 Windows rehearsal, S-057 exit gate) is untouched by this
  round and proceeds independently.

## Requirements *(themes → Stages, in execution order)*

### Wave 1 — Public hygiene (flip-blocking)

#### Theme 1 — 저작권·추적파일·라이선스 정비 → Stage **S-058** (P0-1 tree half, A1, A2, P2 hygiene)

- Remove `docs/research/conference-poster/references-pdf/` from the tree;
  replace with a `references.md` (DOI/official links only).
- Promote the local-only `.git/info/exclude` protections (internal KACE
  strategy docs, final paper) into the shared `.gitignore`, and close the
  ignore gaps that caused the PDF accident: `.orca/`, `.playwright-mcp/`,
  `decks/`, `.pnpm-store/`, `*.pptx`, `dive/tmp/`, `fig1-preview.png`-class
  artifacts (A2). Internal-only docs move out of the repo tree where possible.
- Add OFL license files for bundled fonts (Pretendard, JetBrains Mono) +
  THIRD-PARTY-NOTICES section (A1).
- Delete tracked junk: `dive/test-results/.last-run.json`,
  `dive/pi-sidecar-spikes/` (spike over, unreferenced); resolve root `images/`
  (18 PNG, referenced only by archived legacy specs → move under
  `docs/archive/` or delete).
- **Gate**: `git status --ignored` review shows no internal/junk candidates;
  no tracked file the public repo should not carry (except history, which
  S-070 owns).

#### Theme 2 — 스크립트·버전 진실성 정비 → Stage **S-059** (C8, E6, A3, P2 deps-ci)

- Remove or archive the 23 unreferenced one-shot verify scripts (~3,000
  lines); wire the surviving manual-QA suite into `package.json` scripts with
  a `scripts/README.md` (C8).
- `verify:version-sync`: drop the hardcoded `1.0.0-rc.7` argument — the script
  reads `package.json` version itself; retire the 2026-05-15 release-day
  sentence-freeze checks (§wilyChecks) whose release has shipped (E6 + 632-line
  verifier finding).
- Fix both READMEs' version drift (dive/README rc.2 → actual; root badge and
  roadmap table rc.6 → rc.9) **while preserving every release-gate hard-read
  marker** (rc.2 production wiring, recall warning, 72 ADR·ADR-085) — run the
  affected verifier/CI gates after edits (A3).
- Fold in small deps-ci P2s: `packageManager`/`engines` declaration, axe-core
  removal, `permissions` blocks in workflows, pinned `cargo install --git` rev.

### Wave 2 — Quick wins (deletion/small-fix, low risk)

#### Theme 3 — Rust 데드코드 일소 → Stage **S-060** (C1, C2, C4, C5, P2)

- Remove crate-root `#![allow(dead_code)]`; delete what the compiler then
  reports (10+ items measured), narrowing any true keeper to item-level
  `#[allow]` + reason comment (C1).
- Delete template `greet` command + handler registration (C2).
- Remove or `dev-mock`-gate the caller-less IPC surface: `openrouter_issue_key`
  / `revoke_all` / `list_keys` (master-key-accepting!), `pi_sidecar_codex_smoke`
  (+ `provisioning-demo` page) (C4).
- Delete confirmed dead symbols: `hydrate_provider_runtime`, `select_runtime`,
  `LateAfterFinalization`, `ChatRequest.stream`, dead `ipnet` shim (C5, P2).
- **Legacy `AgentLoop::run` is NOT this stage** — it moves with S-065.

#### Theme 4 — FE 데드코드 일소 + loadTauri 단일화 → Stage **S-061** (C6, C7, D1, P2)

- Delete the RationaleChallengePanel ghost feature end-to-end (230-line panel +
  controller→layout→RoadmapRail wiring that PlanView never reads) and
  `RoadmapHost.tsx` (C6). If the owner later revives the feature it returns via
  spec 005 lineage, not this wiring.
- Delete `prdPatch.ts` TS mirror (253 lines, zero callers; Rust is canonical) +
  barrel export + its test (C7).
- Replace all 18 private `loadTauri` copies with the canonical
  `lib/tauri.ts` import (add a `listen`-capable variant for useChatSession);
  add a lint guard against re-copying (D1).
- Fold in FE dead-code P2s: always-empty `rules.ts` production path,
  `priority.ts` always-true stub, dead store selectors, ChatArea 12-field prop
  type triplication.

#### Theme 5 — FE 무음 실패 표면화 → Stage **S-062** (E3, E4, P2)

- `settings.tsx` connect/select: add catch + classifyError-based inline error
  (OnboardingDialog pattern); render-or-remove the never-read store `error`
  field (E3).
- Add catch+toast to PlanAddStepPanel submit, VerificationCoachPanel
  observation record, ProductShellLayout step-open, PreviewTab loadCandidate
  (E4, P2).
- Recurrence guard: no-floating-promises-class lint rule or a shared
  `runUserAction` helper.

#### Theme 6 — Rust 도구 보안·견고성 하드닝 → Stage **S-063** (F1–F3, E5, P2 security)

- Promote env-dump/dotenv-read rules from `TERMINAL_SCRIPT_EXTRA_RULES` into
  `classify_bash_command` so run_process and terminal_script share the
  credential-exposure blocklist; scrub sensitive env (`*_API_KEY`, `*TOKEN*`,
  `*SECRET*`) from child processes (F1).
- Fix `redact_line` to substring-scan (≥32-char `[A-Za-z0-9_-]` runs) so JSON
  lines redact; align with mjs `redactError` (F2).
- Stream-cap process output (web_fetch `read_bounded_byte_stream` pattern as a
  shared helper) instead of unbounded buffering (F3).
- Fix multi_replace staging-failure cleanup no-op (E5).
- Fold in security P2s: preview server Host-header validation, factory
  localhost IPv6/prefix check, runtime `"::1"` dead condition, SECRET_RE
  JSON-quoted gap + newline-destroying redaction, sidecar SEA download
  checksum. Design decides whether the S-048 6b plain-GET egress follow-up
  (tracked in `docs/spec-status.md`) is absorbed here or stays tracked.

#### Theme 7 — correctness 버그 팩 → Stage **S-064** (E1, E2, E7, G4, P2)

- `load_history`: keep the **latest** 200 (DESC + reverse), regression test
  for >200-message sessions (E1).
- StepDetailSlideIn evidence survival: always-mount-with-open-prop or rehydrate
  on mount; test close→reopen gate preservation (E2).
- Unify the two changed-file risk classifiers on the boundary-anchored
  patterns; table-test the false positives (`AuthorCard`, `packages/`) (E7).
- Interview no-patch turn: stop re-saving the pre-LLM stale draft (G4);
  stop `let _ =`-swallowing supervision-evidence EventLog appends.
- Fold in correctness P2s: checkpoint restore error propagation + nested
  build-dir exclusion, OAuth callback accept loop, OpenAI Usage-after-Done
  ordering, web_fetch error misclassification, OsKeyring store swallow,
  StepDetail 'checking…' latch race.

### Wave 3 — Structure & performance (behavior-preserving refactors)

#### Theme 8 — 승인 파이프라인 단일화 → Stage **S-065** (C3, D2; depends S-060)

- Delete (or `#[cfg(test)]`-degrade) the caller-less legacy in-process
  `AgentLoop::run`/`stream_assistant` (~800 lines); migrate its integration
  tests onto the supervised path (C3).
- Single tool-execution pipeline: `execute_supervised_tool_call` becomes the
  one source; path differences (runtime tag) become parameters — the ~370-line
  duplicated approval pipeline disappears structurally (D2).

#### Theme 9 — workspace_plan.rs 분할 → Stage **S-066** (B1)

- Mechanical split along existing S-033/S-047/S-050 comment seams into
  `ipc/workspace_plan/{commands,prd_interview,prd_patch,plan_mutations,dashboard,quality_gate}.rs`;
  inline tests follow their submodule. No behavior change; public IPC surface
  unchanged.

#### Theme 10 — supervisor.rs·pi_sidecar 분할 정리 → Stage **S-067** (B2, D3, P2)

- `dive/supervisor/` split: context/evidence/decision/card/prompt; mod.rs
  re-exports preserve the external API (B2).
- pi_sidecar: extract `spawn_sidecar` helper (4 copy sites) and common event
  read-loop; move the ~2,640-line inline test block into submodule test files;
  replace string-literal error protocol branching (D3, P2).

#### Theme 11 — FE 갓훅 분할 → Stage **S-068** (B3, B4, B5; depends S-061, S-062)

- useProductShellController → usePrdAuthoring / usePlanDraftLifecycle /
  usePlanChatRouting / useShellMenus (following the existing useProductRecovery
  precedent); move `createElement` view blocks into layout/surface components
  (B3).
- StepDetailSlideIn → resize hook / supervisor-request builders (pure,
  unit-testable) / evidence-gating derivations / subcomponent files (B4).
- useChatSession → agent-events types / pure reducer file / card+checkpoint
  IPC relocated to useWorkmap or useCardActions (B5).

#### Theme 12 — 성능·중복 팩 → Stage **S-069** (G1–G3, P2; depends S-066, S-067, S-068)

- card_metrics: single JOIN COUNT query replaces full-table load + N+1 (G1).
- EventLog: plan-scoped indexed query replaces per-project full-ledger scan
  (G2).
- Controller memoization: stabilize static slices + React.memo heavy children,
  or strip the ineffective ritual — one coherent policy (G3).
- Fold in performance/duplication P2s: useWorkmap N+1 + full refresh,
  MessageList streaming recompute, busy-poll ×2, hot-path regex recompile,
  preview Auto-branch copy, NewCard ×4, duplicate command pairs, glob engine
  ×2, export sanitize ×3, prompt_check parse duplication.

### Wave 4 — Flip gate

#### Theme 13 — 히스토리 퍼지 + 공개 전환 최종 게이트 → Stage **S-070** (P0-1 history half; owner decisions required)

- `git filter-repo` purge of `references-pdf/` from all history (precedent:
  2026-06-11 185 MB PNG rewrite; invalidates clones — coordinate).
- **Owner decisions executed in the same pass**: commit-author personal email
  exposure; personal home paths in 15 tracked docs (P2 privacy).
- Final flip checklist: `git status --ignored` sweep, secrets re-scan on the
  rewritten history, CI green on rewritten main, README/gate markers intact,
  then public flip synchronized with the conference date.
- Runs **last**, after all Wave 1–3 stages have merged, so history is rewritten
  exactly once.

## Execution Model

- Stage order = S-058 → S-070 as listed; Wave 2 stages are independent of each
  other (S-060/S-061/S-062 may interleave), Wave 3 respects the listed
  dependencies, S-070 is strictly last.
- **Implementer models** (owner instruction 2026-07-20): mechanical
  deletion/substitution stages (S-058–S-062) → Sonnet; judgment-bearing
  security/correctness/refactor stages (S-063–S-069) → Opus. Root session
  (this harness) owns per-stage design/plan, adversarial review, CI
  verification, and Wily lifecycle — implementers never self-verify (per
  established Codex-via-harness practice).
- Per-stage loop (established 009/010/011 pattern): design → plan → implement
  → local CI (`cargo fmt/clippy -D warnings/test --all-targets --features
  dev-mock`; `pnpm format:check/typecheck/lint/test:unit`) → adversarial
  review → merge. Live re-QA on the release .app for stages touching runtime
  behavior (S-063, S-064, S-065, S-068 at minimum).
- Constitution VI (typed seams, testable determinism) governs all splits;
  behavior-preserving refactors must show test-suite parity before/after.

## Exit Gate

S-070 complete = repository public with: purged history, zero copyrighted
binaries, zero secrets (re-verified post-rewrite), OFL notices present, CI
green, no crate-wide dead_code suppression, no file >4k lines outside tests,
and the review report's P0/P1 register fully dispositioned (fixed or
explicitly deferred with rationale in this spec's decisions.md).
