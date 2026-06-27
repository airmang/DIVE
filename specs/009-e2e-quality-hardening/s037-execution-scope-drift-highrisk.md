# S-037 — Execution-time scope-drift & high-risk-file non-blocking provocation (009 theme 9) — stage spec/plan

**Wily Stage**: S-037 (`STG-e599094ff419`, project `dive-2`). Status `draft` →
claimed by root. **Scope**: `dive/src/components/product/**`,
`dive/src/features/provocation/**`, `dive/src-tauri/src/dive/supervisor.rs`,
i18n. Root owns the Wily lifecycle.

**Spec**: [`spec.md`](spec.md) theme 9 — "Production scope-drift / high-risk-file
gate appears to be dead code."

**Key finding (canon-checked design)**: the gate is **not** dead code — it is a
**producer/consumer CONTRACT MISMATCH**. The legacy frontend rules engine
(`diffScopeDriftRule`, rules.ts:468) is intentionally dev-quarantined (stays
dead). The LIVE supervisor `diff_ready` path fires, but the high-risk signal is
silently dropped: the Rust `ProvocationSeverity` enum has only `Caution` (no
`Risk` variant) and ships `highRiskFiles` nested under
`metadata.assessmentSummary.highRiskFiles` / `metadata.diffReadyAssessment.
highRiskFiles`, while both consumers (`decisionGatePolicy.ts:122-129`,
`StepDetailSlideIn.tsx:176-185`) require `severity==='risk'` + FLAT
`metadata.highRiskFiles`. So `high_risk_unexpected_files`
(decisionGatePolicy.ts:151) **can never fire in a shipped build**. This is a
WIRING fix, not new heuristics — the detection inputs already exist
deterministically on both sides (`buildDiffReadyReviewAssessment` adapters.ts:729;
`diff_ready_assessment.high_risk_files` supervisor.rs:2376).

**Adopted engineering decisions** (design recommendations; no owner-blocking
product call): (1) **deterministic-first** gate-block (survives supervisor
parse_error/RuntimeUnavailable — strongest anti-degradation posture, canon 002:
the deterministic gate owns WHEN); (2a) **drop the severity predicate** rather
than add a Rust `Risk` variant (minimal blast radius — keep the single-variant
`Caution` model; the trigger is the deterministic high-risk list); (3) key on
**high-risk AND outside expected_files** (don't nag on deliberately-planned
auth/config edits — `buildDiffReadyReviewAssessment` already path-excludes);
(4) **broaden the classifier** (add CI/secret-path/lockfile categories).

## Acceptance

1. During execution/verify of an approved step, editing a high-risk file
   (.env/config, auth, db/migration, dependency/lockfile, routing, CI, secret
   paths) **outside** the step's `expected_files` surfaces the
   `high_risk_unexpected_files` written-risk reason with the concrete drifted
   paths as evidence — **independent of whether the SupervisorAgent LLM card
   parsed**.
2. The reason is **NON-blocking**: it sets `requiresReason` (written
   justification), never a disabled Approve or hard stop; the authoritative
   approve gate (`card.state==='verified'` / DecisionGate) is unchanged.
3. A high-risk file that **is** in `expected_files` does NOT fire the reason.
4. The `diff_ready` card carries the criterion-linked **question** near the diff
   (reuse the existing SupervisorAgent path), non-blocking/dismissible; on
   supervisor degradation the deterministic gate-block + non-LLM reason chip is
   the surface with **NO fabricated AI question** (002 canon, no static fallback).
5. Legacy `diffScopeDriftRule` stays quarantined; a regression test locks that
   the production (non-DEV) supervisor path still drives the gate.
6. All user-facing strings via i18n en+ko reusing existing keys
   (`decision_reason_high_risk_files`, `stepper_code_high_risk`,
   `bundle_unexpected_high_risk`) — S-030 Hangul ESLint gate green.
7. Full local CI green; CAREFUL-04 journey re-run live on the release `.app` in
   ko + en (deferred per live-QA caveat).

## Gaps closed

| Gap | Sev | Summary |
| --- | --- | --- |
| CAREFUL-04 / producer-consumer contract mismatch | P1 | Live supervisor `diff_ready` card hardcodes `severity:Caution` and nests `highRiskFiles`, but consumers require `severity==='risk'` + flat `metadata.highRiskFiles`, so `high_risk_unexpected_files` never fires. Drop the severity predicate; source high-risk from the shipping nested metadata; gate-block on high-risk AND outside-expected, independent of LLM parse. |
| Dead-code regression (legacy `diffScopeDriftRule`) | P2 | rules.ts:468 stays dev-quarantined (don't revive — would double-fire). Add a regression test asserting the production non-DEV supervisor path drives the gate so the quarantine can't silently re-kill the live signal. |
| Classifier coverage gaps | P2 | `guessChangedFileCategory` (adapters.ts:74-89) misses CI (.github/workflows, Dockerfile, Makefile), generic lockfiles (Cargo.lock/poetry.lock/Gemfile.lock/go.sum), secret paths (*.pem,*.key,id_rsa,.npmrc,.netrc). Add `ci` category, broaden `dependency`, add a secret-path set; include in `isHighRiskFile`. |

## Confirmed touch points

- `dive/src/components/product/decisionGatePolicy.ts` (~122-129, ~151) — drop
  `severity==='risk'`; accept `diff_scope_drift` OR `diff_scope_review`; source
  high-risk from `metadata.assessmentSummary.highRiskFiles` /
  `metadata.diffReadyAssessment.highRiskFiles`; keep `requiresReason`
  (NON-blocking).
- `dive/src/components/product/StepDetailSlideIn.tsx` (~176-185
  `highRiskFilesFromCards`) — mirror the predicate-drop + source.
- `dive/src/features/provocation/adapters.ts` (~74-89 `guessChangedFileCategory`,
  ~729 `buildDiffReadyReviewAssessment`, ~744-747 path-exclusion) — classifier
  broadening (P3).
- `dive/src-tauri/src/dive/supervisor.rs` (~2227-2231, ~2340-2362 card builder,
  ~2376 `diff_ready_assessment.high_risk_files`) — ensure the high-risk list rides
  at the agreed metadata key + the question near the diff. (No Risk variant —
  decision 2a.)
- Tests: `DecisionGate.test.tsx`, `adapters.test.ts`,
  `features/provocation/__tests__/rules.test.ts`, `tests/export_jsonl.rs`.
- `dive/src/i18n/{en,ko}.json` — reuse the 3 existing high-risk keys (no new
  keys/Hangul).

## Non-goals / boundary

- Do NOT duplicate the S-034 approval-card secret/.env warning
  (`guard.rs::assess_file_write_secrets`): S-037 keys on **path-category vs
  expected-files drift at decision-time**, not secret-value content at
  approval-time. Cross-reference/sequence for the same .env write (approval-time
  then decision-time) — never two scary callouts within seconds.
- Do NOT re-do S-018/S-019 (005 add-step `scope_expansion`, plan-time growth):
  S-037 is execution-time DRIFT (`SupervisorEvent::DiffReady`, card
  `DiffScopeReview`, Verify stage). Shared rails, disjoint event + stage-gating;
  confirm no card-type aliasing.
- Do NOT re-do S-029 / S-030 (reuse both; don't regress the 3 high-risk i18n
  keys). Do NOT un-quarantine `diffScopeDriftRule` / `generateProvocationCards`.
- Do NOT hard-gate: `requiresReason` (written justification) only, never a
  disabled Approve.

## Regression guards

- Approve stays disabled until `card.state==='verified'` (authoritative);
  the new reason is a written-justification escalation, not a hard stop.
- High-risk file that IS in `expected_files` ⇒ reason does NOT fire (path-match
  exclusion preserved). Empty/all-in-scope changedFiles ⇒ eligible=false.
- Legacy `diffScopeDriftRule` stays quarantined (returns [] in prod) — locked by
  a test asserting the production non-DEV supervisor path drives the gate.
- Existing S-029/S-030 plumbing + the 3 high-risk i18n keys untouched.
- Supervisor `diff_ready` gate unchanged where high-risk is empty
  (`supervisor_diff_ready_gate_covers_scope_drift_edges` ~supervisor.rs:3945
  stays green).
- Export round-trip: the `provocation.supervisor_evaluated` `diff_ready` row
  carries `reasonCodes` (high_risk_area) + `highRiskFiles` intact.

## Phase plan (= Wily phases; Codex work orders)

| Phase | Scope | Gaps |
| --- | --- | --- |
| **P0 Foundation** | Read-only confirm: legacy quarantine intact; live `diff_ready` gate+classifier intact; S-029/S-030 keys intact; pick the metadata source-of-truth. No behavior change. | seams |
| **P1 Deterministic gate-block** *(load-bearing)* | `decisionGatePolicy.ts`: drop `severity==='risk'`; accept `diff_scope_drift`/`diff_scope_review`; source high-risk from the nested metadata; keep `requiresReason` (non-blocking). Mirror in `StepDetailSlideIn.tsx`. Tests: fires on off-target high-risk with NO LLM card + on parse_error; not when in `expected_files`; reason is `requiresReason` not `canApproveDirectly`. | CAREFUL-04 |
| **P2 Supervisor card metadata + question** | Ensure the live `diff_ready` card carries the high-risk list at the agreed metadata key + the criterion-linked question near the diff (reuse path), non-blocking/dismissible; degraded path shows the deterministic chip with NO fabricated AI question. (No Risk variant.) Rust tests. | CAREFUL-04 question surface |
| **P3 Classifier coverage** | Extend `guessChangedFileCategory`: add `ci`, broaden `dependency` (lockfiles), add secret-path set; include in `isHighRiskFile`. Classifier unit tests. | classifier |
| **P4 Regression + boundary + i18n + integration** | Dead-code regression test (prod non-DEV path drives the gate); S-034 de-dup cross-reference (no double callout for the same .env write); en+ko reuse existing keys (no new Hangul); export round-trip. Full local CI + adversarial review; live CAREFUL-04 ko+en (deferred). | regression, boundary, integration |

## Validation loop / Codex handoff

Same as S-035/S-036. Likely **2 Codex passes**: (A) frontend wiring + classifier
(decisionGatePolicy + StepDetailSlideIn + adapters + tests); (B) supervisor
metadata + regression/export/i18n. Root owns Wily lifecycle + verification + PR +
merge; Codex implements per boundary (no Risk variant, no un-quarantine, no
S-034/S-018/S-029/S-030 re-do, non-blocking). Per-phase: raw `codex exec
--dangerously-bypass-approvals-and-sandbox` in primary (no git) → root re-runs
gates + commits → adversarial review → PR → merge → Wily complete.
