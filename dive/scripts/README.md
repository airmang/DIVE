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

## Shared helper (not a standalone script)

- `_playwright-loader.mjs` — resolves the pnpm-hoisted `playwright` module for
  the Playwright-driven verifiers above (`verify-a11y.mjs`,
  `verify-rc1-migration.mjs`). Not runnable on its own; import it, don't add a
  `package.json` entry for it.
