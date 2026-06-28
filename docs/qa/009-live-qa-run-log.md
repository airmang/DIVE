# 009 S-035..S-040 Live QA Run Log

Focused continuation pass for the live QA handoff in
`docs/qa/009-s035-s040-live-qa-handoff.md`, after reading the related Claude
session context and the active Spec Kit materials.

## Pre-Release Addendum — 2026-06-27

This addendum records the final local pre-release pass performed after the
focused live QA continuation. It uses the same governing feature spec and the
same built app path.

### Final Build Under Test

- Branch: `docs/009-live-qa-handoff`.
- Commit under test: `d81956a9b2a5e4c64f23c83601f0f118ccd663d9`, with local
  QA documentation and release-prep changes pending.
- App bundle:
  `dive/src-tauri/target/release/bundle/macos/DIVE.app`.
- Data backups:
  `.qa-backups/com.coreelab.dive-20260627-211652` and
  `.qa-backups/com.coreelab.dive-prerelease-20260627-222255`.
- Secret backend: `DIVE_SECRET_BACKEND=local-file`; no secret values were read.
- Dependency hardening: `dive/pi-sidecar` moved
  `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` from `0.79.3`
  to exact `0.79.10`. `npm --prefix pi-sidecar audit --audit-level=moderate`
  now reports `found 0 vulnerabilities`.

### Local Gates

All local release gates run during the final pass completed successfully:

- Frontend: `pnpm format:check`, `pnpm typecheck`, `pnpm lint`,
  `pnpm test:unit`.
- Rust: `cargo fmt --all -- --check`,
  `cargo clippy --features dev-mock --all-targets -- -D warnings`,
  `cargo test --features dev-mock --all-targets`,
  `cargo test --features dev-mock multi_replace --all-targets`.
- Release/product gates: `pnpm verify:version-sync`,
  `pnpm verify:production-wire`, `pnpm verify:product-flow`,
  `pnpm verify:v4`, `pnpm release:smoke:preflight`,
  `bash ./scripts/verify-release-mock-guard.sh`, `cargo check --release`,
  `pnpm build`, `pnpm build:sidecar && pnpm tauri build --bundles app`.
- Final sidecar packaging: `npm --prefix pi-sidecar ci` reported
  `found 0 vulnerabilities`, `node pi-sidecar/build-sidecar.mjs` passed its
  stdin round-trip, and the final app bundle contains
  `Contents/MacOS/dive-pi-sidecar`.

### Final 009 Checks

| Stage | Final status | Evidence |
| --- | --- | --- |
| S-035 PRD interview scaffolding | LIVE PARTIAL PASS; residual copy warning | In the final app, an existing PRD draft with only one acceptance criterion kept both `PRD 확정` buttons disabled and continued to show `구체적이고 확인 가능한 완료 기준을 최소 2개 적어 주세요.` after a vague follow-up (`just make it nice...`). EventLog rows `2311`/`2312` show the model proposed extra criteria but the patch was rejected with `student_edit_conflict`; the deterministic gate did not accept the model's "ready to confirm" self-report. Residual UX warning: the assistant text overstates readiness while the actual gate correctly blocks confirmation. |
| S-037 execution-time scope drift and high-risk files | LIVE/DATA PASS | The final app reopened `Live-careful-04` and showed step-1 as `완료` with `위험 감수 승인`. EventLog rows `1631`/`1632` recorded `outside_expected_files` and `high_risk_area` for unexpected `package.json`; rows `1639`/`1645` dropped duplicates, and row `1641` recorded `approved_with_risk`. |
| S-039 refactor/rename safety and `multi_replace` | AUTOMATED PASS; live card not rerun | The focused Rust tests passed the key `multi_replace` guarantees: plan/build pre-step denial, sandbox-escape denial without writes, non-UTF8 atomic abort, vendor glob exclusion, cross-file replacement, secret warning Danger escalation, per-target diff previews, and changed-file recording for scope-drift/checkpoint consumers. Frontend tests also passed, including the multi-file patch preview path. A fresh live `multi_replace` approval card was not generated in this pass. |

### Release Decision

Local macOS release-candidate status is **PASS**: the rebuilt `.app` launches,
contains the Pi sidecar binary, has zero `pi-sidecar` npm audit findings, and
passes the local documented gates above.

Unrestricted/public release is **CONDITIONAL GO** only after the external gates
are completed or explicitly waived by the release owner:

- Windows NSIS installed-app smoke with tauri-driver + msedgedriver remains an
  external blocker on this Darwin arm64 host.
- GitHub release/tag/yank validation still requires release authority; local
  `verify:version-sync` reports this as external warnings, not local failures.
- The worktree must be committed/tagged from the intended release SHA before
  publishing. `.qa-backups/` remains intentionally untracked.

## Environment

- Date: 2026-06-27, Asia/Seoul.
- Governing feature spec: `specs/009-e2e-quality-hardening/spec.md`.
- Branch under test: `docs/009-live-qa-handoff`.
- Build under test: `d81956a`; `origin/main` baseline: `8358ff6`.
- App bundle: `dive/src-tauri/target/release/bundle/macos/DIVE.app`.
- Build command completed: `pnpm build:sidecar && pnpm tauri build --bundles app`
  from `dive/`.
- Secret backend: `DIVE_SECRET_BACKEND=local-file`; app log confirmed the QA
  local-file backend. No secret values were read.
- App data backup before live app interactions:
  `.qa-backups/com.coreelab.dive-20260627-211652`.

## Scope

This was a resumed, focused verification pass, not a fresh end-to-end rerun of
all six stage journeys. The pass prioritized the items that could be verified
in the already-built release app without creating destructive approvals or
running broad live-agent edits:

- Live app verification: S-036, S-038, S-040.
- Source and test wiring confirmation: S-035, S-037, S-039.
- No OS keychain checks, destructive approvals, project deletion, or secret
  export/readback were performed.

## Results

| Stage | Result | Evidence |
| --- | --- | --- |
| S-035 PRD interview scaffolding | SOURCE-CONFIRMED; full vague-input live journey not rerun | Source confirms typed `VerificationType` values (`run`, `preview`, `manual`, `test`), static/manual plans sanitizing commands to `null`, UI/data-fetch quality gates, quick intake default off, and tests for missing responsive/state criteria. Existing live project state showed a static HTML step using manual/no command, but this was not treated as a fresh S-035 live pass. |
| S-036 review stepper completion and locale | LIVE PASS | In the release app, navigating review stages without evidence produced neutral visited/revisit states rather than green completion. Decision approval remained disabled without linked observation/verification evidence. English and Korean localized decision/review text were observed, including the evidence-required approval explanation. Source tests also cover the `visited` state without a success check. |
| S-037 execution-time scope drift and high-risk files | SOURCE-CONFIRMED; high-risk live journey not rerun | Source confirms the decision gate now emits `high_risk_unexpected_files`, consumes high-risk files from supervisor metadata including nested assessment summaries, and covers `package.json` and `.env` cases in tests. The earlier pre-fix live failure remains recorded in `docs/qa/live-run-results.md`; this pass did not create a fresh package-drift live run. |
| S-038 preview discoverability and static preview UX | LIVE PASS | Korean empty preview state distinguished static file preview from dev-server preview and said nothing runs before "Show my result" / local URL open. "Show my result" opened `http://127.0.0.1:53625/index.html` and rendered the static page. Viewport controls, full static-preview badge, reload control, and status text were present. After switching to English, the same surface showed `Viewport`, `Mobile`, `Tablet`, `Desktop`, `Full Static file preview`, `Reload the preview`, and `Show my result`. |
| S-039 refactor/rename safety and `multi_replace` | SOURCE-CONFIRMED; live multi-replace journey not rerun | Source confirms the `multi_replace` tool exists, is registered as warn-risk, precomputes changes atomically, rejects sandbox escapes/non-UTF8 targets without partial writes, excludes ignored dirs for globs, is blocked before an approved step in plan/build mode, produces per-target diff previews, escalates secret warnings, and records changed files for checkpoint/scope-drift consumers. Tests cover those paths. |
| S-040 verification coach degradation fallback | LIVE PASS | English and Korean live app checks both exercised timeout/unavailable fallback. English event log rows `2304`/`2305` and Korean rows `2309`/`2310` recorded `verification_coach.requested` and `verification_coach.evaluated` with timeout/unavailable status. The UI showed offline/manual fallback copy that explicitly was not AI coach guidance, per-criterion manual checklist text, and disabled observation/confirm controls until a real preview/app/check action existed. Decision approval stayed disabled without evidence. |

## Notes

- No new confirmed product defects were found in this resumed pass.
- The release build succeeded, but the full Rust/TypeScript test suite was not
  rerun during this pass.
- The app database was touched by locale changes and verification-coach timeout
  events. The app language was restored to Korean before wrapping up.
- `.qa-backups/` is intentionally untracked and should not be included in a
  product commit.

## Follow-Up Queue

Run these if a full fresh live replay is required before final sign-off:

1. S-035: create a new vague PRD/intake goal and verify Socratic scaffolding,
   missing UI/data-state criteria handling, and `verification_type` output live.
2. S-037: run a high-risk package/config drift scenario and confirm the decision
   gate blocks with concrete unexpected high-risk paths.
3. S-039: run a live cross-file rename that requires a single `multi_replace`
   approval card, then verify per-file diff preview, approval risk wording,
   changed-file recording, and rollback/checkpoint visibility.
