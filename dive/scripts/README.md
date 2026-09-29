# dive/scripts

Static and Playwright-driven verifiers, release tooling, and QA-data analyzers.
Every script here is wired into a `package.json` script — run via `pnpm <name>`
from `dive/`, not by invoking the file directly (a few also take CLI args, see
`pnpm <name> -- --help` or the script's own usage comment).

Scripts that go unreferenced by `package.json`, CI, or another surviving
script for a full release round get removed (see `docs/qa/public-release-code-review-2026-07-20.md`
finding C8 — 23 one-shot sprint verifiers were retired 2026-07-20).

## Release / CI gates

| Script                       | Run via                                              | Purpose                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `verify-production-wire.mjs` | `pnpm verify:production-wire`                        | Static check that production IPC/provider wiring matches the spec (no mock fallbacks left enabled).                                                                                              |
| `verify-product-flow.mjs`    | `pnpm verify:product-flow`                           | Static golden-path check: project → AI → goal/interview → plan approval → roadmap/step → permission → changed files/preview → verify → checkpoint/recovery wiring exists end to end.             |
| `verify-version-sync.mjs`    | `pnpm verify:version-sync`                           | Cross-checks `package.json` / `Cargo.toml` / `tauri.conf.json` versions and required README markers. Reads the expected version from `package.json` unless an override is passed as an argument. |
| `release-gate-smoke.mjs`     | `pnpm release:smoke`, `pnpm release:smoke:preflight` | Installed-app smoke test used by `build.yml` / `release-gate.yml`; `--preflight` runs the pre-build subset only.                                                                                 |

## v4 track verifiers

| Script               | Run via                  | Purpose                                                                                |
| -------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `verify-v4-all.mjs`  | `pnpm verify:v4`         | Runs tracks A–G in sequence.                                                           |
| `verify-track-a.mjs` | `pnpm verify:v4:track-a` | Onboarding/settings copy: no student-facing model IDs or teacher-facing language leak. |
| `verify-track-b.mjs` | `pnpm verify:v4:track-b` | Tauri dialog plugin wiring (`Cargo.toml`, capabilities).                               |
| `verify-track-c.mjs` | `pnpm verify:v4:track-c` | Settings/sidebar wiring.                                                               |
| `verify-track-d.mjs` | `pnpm verify:v4:track-d` | Native menu (`menu.rs`) wiring.                                                        |
| `verify-track-e.mjs` | `pnpm verify:v4:track-e` | File-existence/structure checks over a source subtree.                                 |
| `verify-track-f.mjs` | `pnpm verify:v4:track-f` | Source-content checks across a source subtree (build-aware).                           |
| `verify-track-g.mjs` | `pnpm verify:v4:track-g` | Provider DAO/model-selection wiring.                                                   |

## Point-in-time quality gates

| Script                                 | Run via                                 | Purpose                                                                                                                   |
| -------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `verify-audit-fixes.mjs`               | `pnpm verify:audit-fixes`               | Static verification for the audit-driven reliability fixes.                                                               |
| `verify-quality-iteration.mjs`         | `pnpm verify:quality-iteration`         | Static/build-output verification for the post-audit product-quality iteration.                                            |
| `verify-quality-followup.mjs`          | `pnpm verify:quality-followup`          | Static/build-output verification for the product-quality follow-up round.                                                 |
| `verify-route-chat-cancel-quality.mjs` | `pnpm verify:route-chat-cancel-quality` | Static/build-output verification for the route-chat cancel quality iteration.                                             |
| `verify-rc1-migration.mjs`             | `pnpm verify:rc1-migration`             | Playwright check for the rc.1 yanked-build localStorage migration. Requires a dev server on `http://localhost:1420`.      |
| `verify-a11y.mjs`                      | `pnpm verify:a11y`                      | Playwright accessibility check (keyboard shortcuts, ARIA, `aria-live`). Requires a dev server on `http://localhost:1420`. |

## QA data analysis (manual, not part of any gate)

| Script                      | Run via                                         | Purpose                                                                                                                                 |
| --------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `analyze-retrospective.mjs` | `pnpm research:retrospective <export.jsonl...>` | Summarizes `Card.retrospective` / `retrospective_metrics` records from a DIVE JSONL export without de-anonymizing students or sessions. |
| `analyze-supervision.mjs`   | `pnpm research:supervision <export.jsonl>`      | Aggregates automatic supervision metrics 1/3/4 from a DIVE JSONL export.                                                                |
| `analyze-cards.mjs`         | `pnpm research:cards <export.jsonl...>`         | Review-card field aggregates per supervisor version (spec 015 S-081); see below.                                                        |

### `research:cards` (spec 015, FR-050/FR-051)

Joins each export's `provocation.card_*` exposures to their
`provocation.supervisor_evaluated` rows (within one export only: every export
has a fresh salt) and groups by event, concern, mode, `promptVersion`,
`policyVersion` and model. Per group: exposures; action / dismiss /
mark-irrelevant / continued-with-risk / unanswered counts and rates (the
denominator is exposures); median response latency; median visible time of
unanswered cards; supervisor outcome and drop-reason distribution, including
evaluations that produced no card; unanswered reasons (`removed`, `replaced`,
`unmounted`, `page_hidden`; legacy `superseded` is kept as-is). `promptVersion`
has three states that are never pooled: a real version, `(no LLM)` (explicit
`null`: no prompt reached a model) and `(legacy)` (missing or empty, pre-S-076).
Data-integrity warnings come first: exposures with no terminal event (should
be 0), card events attributed via `sessionResolvedBy: project_latest`, and
frontend/Rust policy version mismatches (`policyVersionRust`). Smaller tables
summarize `verification_coach.evaluated` (status, reason codes) and
`prd_interview.turn_evaluated` (outcomes incl. `model_error`, error classes)
per prompt version. Field names:
`specs/015-self-improvement-loops/contracts/event-log-export.md`.

- Default: Markdown. `-- --json` prints JSON.
- `-- --include-origin qa,dev` adds QA/dev sessions (default: `classroom`
  only). Exports without `origin` (before migration v20) are included and
  counted as legacy.
- `-- --exemplars` lists the evaluation/exposure ids and question of each
  marked-irrelevant or unanswered exposure per export file. These are
  candidates only: promotion into eval fixtures is manual and needs a human
  anonymization review. Look them up on the machine that holds the replay corpus.
- Rates are card-quality proxies, not evidence of student supervision skill.

## QA ledger (`qa-ledger/`, spec 015)

Tooling for the machine-readable QA ledger in `docs/qa/ledger/` (defects,
scenarios, live-run records). Field reference: `qa-ledger/schema.md`; workflow:
`docs/qa/ledger/README.md`. Its `*.test.mjs` files run under `pnpm test:unit`
(vitest includes `scripts/**/*.test.mjs`), including a check of the real ledger.

| Script                   | Run via                                                                     | Purpose                                                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qa-ledger/validate.mjs` | `pnpm qa:ledger:validate` (`-- --next-id`)                                  | Schema + cross-reference check of every ledger record; exits 1 listing each problem. `--next-id` prints the next free `DEF-NNNN`.                                                                                                     |
| `qa-ledger/schema.mjs`   | (module)                                                                    | Enums and per-record validators for Defect / Scenario / RunRecord.                                                                                                                                                                    |
| `qa-ledger/load.mjs`     | (module)                                                                    | Reads the ledger; duplicate-id, filename/id and dangling-reference checks.                                                                                                                                                            |
| `qa-ledger/areas.mjs`    | (module)                                                                    | Area name → repo path globs, shared by scenarios and defects (and S-082's rerun queue).                                                                                                                                               |
| `qa-ledger/verify.mjs`   | `pnpm verify:qa-ledger` (`-- --kinds vitest,cargo`, `-- --cargo-dir <dir>`) | Validate, then resolve the guard of every `fixed`/`verified` defect through its runner (S-080, FR-040/041); exits 1 on an unresolved or skipped/ignored guard.                                                                        |
| `qa-ledger/guards.mjs`   | (module)                                                                    | Per-kind guard resolvers with injectable runners: `vitest list --json`, `cargo test -- --list` (+ `--ignored`), eval fixture ids, live-run records.                                                                                   |
| `qa-ledger/queue.mjs`    | `pnpm qa:queue` (`-- --since <ref>`, `-- --stale-days N`)                   | Pick the next live-QA run set (fixed-unverified defects, areas changed since last pass, stale, cross-cutting/unmapped ⇒ all) and write a work order to `.harness/work-orders/qa/<date>.md` (S-082).                                   |
| `qa-ledger/run.mjs`      | `pnpm qa:run init --scenarios …` / `pnpm qa:run apply <draft>`              | Run-record draft with build version + commit; apply writes the run, new defects, `fixed → verified` (build must contain `fixCommit`) and `lastPass`, validated all-or-nothing.                                                        |
| `qa-ledger/git.mjs`      | (module)                                                                    | Read-only git helpers (`core.quotePath=false` diffs, ancestry, HEAD).                                                                                                                                                                 |
| `qa-ledger/triage.mjs`   | `pnpm qa:triage` (`-- --from-eval <result.json>`, `-- --json`)              | Cluster open/fixing defects (area, merged by shared spec/stage refs) into spec-theme stubs + Wily `design_stage` payload drafts in `.harness/triage/<date>/` — drafts only; `--from-eval` opens `source: eval` defects first (S-084). |

Where guard resolution runs (D-015-08 — workflow files can't be changed from
agent sessions):

- **CI, every push**: `pnpm test:unit` (`guards.test.mjs` resolves the real
  ledger's vitest, eval-fixture and live-scenario guards) and `pnpm verify:v4`
  (the "QA Ledger Guards" step, same kinds). The frontend job has no Rust
  toolchain, so **cargo guards are not enforced by any CI job today** — see
  the owner step below. CI checks out with depth 1: a `fixCommit` or run
  commit missing from that shallow clone makes a live-scenario guard
  "unverifiable" (a WARN line, exit 0); missing from full history it fails.
- **Locally / before a release**: `pnpm verify:qa-ledger` checks every kind
  including cargo (it compiles the test targets, same flags as CI's
  `cargo test`). When the working tree is mid-edit and doesn't compile, list
  from a clean checkout: `git worktree add <dir> HEAD`, copy
  `src-tauri/binaries/*` and `dist/` into it, then
  `pnpm verify:qa-ledger -- --cargo-dir <dir>/dive/src-tauri`.
- **Owner step (needed for cargo guards to be enforced)**: add this one line
  to the "Rust gate" step of `.github/workflows/release-gate.yml`, right after
  `cargo test --features dev-mock --all-targets`. The step runs in
  `dive/src-tauri` under PowerShell on the Windows runners, so the line uses
  `pnpm -C ..` (works in PowerShell and bash) rather than `cd`; the cargo test
  build is already warm at that point:

  ```sh
  pnpm -C .. verify:qa-ledger --kinds cargo
  ```

  Agent sessions can't push workflow files (no `workflow` token scope,
  D-015-08).

## Shared helper (not a standalone script)

- `_playwright-loader.mjs` — resolves the pnpm-hoisted `playwright` module for
  the Playwright-driven verifiers above (`verify-a11y.mjs`,
  `verify-rc1-migration.mjs`). Not runnable on its own; import it, don't add a
  `package.json` entry for it.
