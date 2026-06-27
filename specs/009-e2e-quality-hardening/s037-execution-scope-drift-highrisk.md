# S-037 — Execution-time scope-drift & high-risk-file non-blocking provocation (009 theme 9) — stage spec/plan

**Wily Stage**: S-037 (project `dive-2`). Status `draft` → claimed by root.
**Scope**: `dive/src/components/product/**` (decisionGatePolicy.ts, StepDetailSlideIn.tsx,
DecisionGate.tsx) + `dive/src/features/provocation/**` (adapters.ts classifier +
normalizeCard) + `dive/src-tauri/src/dive/supervisor.rs` (card-builder severity +
metadata, provoke-gate tests) + `dive/src/i18n/**` (en+ko). Root owns the Wily
lifecycle.

**Spec**: [`spec.md`](spec.md) theme 9 — "Execution-time scope drift onto high-risk
files surfaces no written-risk reason at the decision gate (CAREFUL-04)."

**Key design correction (from canon-checked investigation)**: the task premise that
the scope-drift / high-risk gate is "dead code" is **half true and must be split**.

1. The **LEGACY** frontend rules engine (`diffScopeDriftRule`, rules.ts:468) IS dead,
   but it is **intentionally quarantined** behind `isQuarantinedRuleCardGenerationEnabled()`
   (rules.ts:662-667: `import.meta.env.DEV && VITE_DIVE_INTERNAL_PROVOCATION_RULE_CARDS`).
   **S-037 must NOT un-quarantine it** — that resurrects a deprecated keyword engine
   that would double-fire against the supervisor card. Leave it quarantined.
2. The **LIVE shipped** detector is the **SupervisorAgent `diff_ready` path**
   (frontend `buildDiffReadyReviewAssessment` adapters.ts:729 → IPC
   `provocation_agent_evaluate` → backend `supervisor_provoke_gate` supervisor.rs:1405).
   It fires, computes scope-drift (`unexpectedFiles` vs `step.expected_files`) and
   high-risk classification, and renders a non-blocking `DiffScopeReview` card. It is
   **NOT dead**. **The actual bug is a producer/consumer CONTRACT MISMATCH** that
   silently drops the high-risk signal at the decision gate — see below.

**Root cause (the load-bearing fix)**: the deterministic gate reason
`high_risk_unexpected_files` (decisionGatePolicy.ts:151-153) can never fire in a
shipped build because both consumers require a card shape the live producer never
emits:

- `decisionGatePolicy.ts:122-129` reads high-risk files only from cards where
  `type === 'diff_scope_drift' && severity === 'risk'`, via flat `metadata.highRiskFiles`.
- `StepDetailSlideIn.tsx:176-185` (`highRiskFilesFromCards`) requires
  `(diff_scope_drift || diff_scope_review) && severity === 'risk'` + flat
  `metadata.highRiskFiles`.
- But the live producer (`map_decision_to_card_at`, supervisor.rs:2347-2362) hardcodes
  `severity: ProvocationSeverity::Caution` (supervisor.rs:2351) — and the
  `ProvocationSeverity` Rust enum (supervisor.rs:2227-2231) has a **single variant
  `Caution`**; `risk` is literally unrepresentable on the backend. The high-risk list
  ships **nested** under `metadata.assessmentSummary.highRiskFiles` (supervisor.rs:2376-2385)
  and `metadata.diffReadyAssessment.highRiskFiles` (normalizeCard adapters.ts:1235-1236),
  **never** flat `metadata.highRiskFiles`.

Net: an off-target `package.json` / auth / config / db edit during execution forces
**no written risk reason** at the decision gate in a production build — the classifier
computes it deterministically, the gate silently discards it. This is a **wiring fix,
not new heuristics** — the detection inputs already exist deterministically on both
sides.

## Owner-facing decisions (FLAGGED — must confirm before P1)

1. **DETERMINISTIC-ONLY vs LLM-PLUS-BACKSTOP.** Recommended: make the deterministic
   gate-block fire on a populated outside-expected high-risk list **regardless of the
   SupervisorAgent** — the WHEN is 100% DIVE-owned/deterministic (per 002 canon:
   "deterministic provoke gate decides WHEN"), the LLM owns only the QUESTION. This is
   the strongest anti-degradation posture (survives supervisor parse-failure /
   runtime-unavailable). The softer alternative (LLM-first, deterministic only on
   parse-failure) risks the same dead-on-happy-path problem if the LLM under-flags.
   **Recommendation: deterministic gate-block always; LLM owns question only.**
2. **SEVERITY MODEL.** The Rust enum has only `Caution`; the consumers dead-require
   `severity === 'risk'`. Two options — (a) **DROP the severity predicate** entirely
   and key the gate on the populated deterministic high-risk list (minimal, keeps the
   single-severity backend model, lower blast radius); or (b) **ADD a `Risk` variant**
   to the Rust enum + serde + every card path and branch in the card builder when
   `diff_ready_assessment.high_risk_files` is non-empty. **Recommendation: (a) drop the
   predicate** unless a first-class `Risk` severity is wanted for other surfaces.
3. **OVER-BLOCK THRESHOLD.** Should a high-risk file that IS in `expected_files` ever
   block? `buildDiffReadyReviewAssessment` already excludes path-matched files from
   `highRiskFiles` (adapters.ts:744-747), so a deliberately-planned auth/config edit
   does NOT nag. **Recommendation: gate-block keys on high-risk AND outside-expected**
   (matching `unrelatedChangedFiles` semantics) — confirm.
4. **CLASSIFIER COVERAGE BREADTH.** `guessChangedFileCategory` (adapters.ts:74-89) does
   NOT match CI files (`.github/workflows/`, Dockerfile, Makefile), lockfiles beyond
   the 3 named (Cargo.lock/poetry.lock/Gemfile.lock/go.sum), or secret-file paths
   (`*.pem`, `*.key`, `id_rsa`, `.npmrc`, `.netrc`). Broadening increases provocation
   frequency. **Recommendation: add a `ci` category + broaden `dependency` + add a
   secret-path set, gated by tests** — confirm breadth vs noise tolerance.

## Acceptance

1. During EXECUTION/verify of an already-approved step, when the agent edits a
   **high-risk file** (`.env`/config, auth, db/migration, dependency/lockfile, routing)
   that is **outside the plan step's `expected_files`**, the decision gate surfaces a
   **written-risk reason** `high_risk_unexpected_files` carrying the concrete drifted
   file paths as evidence — **independent of whether the SupervisorAgent LLM card
   parsed** (deterministic backstop).
2. The gate reason is **NON-BLOCKING**: it sets `requiresReason` (written
   justification), never a disabled Approve or a hard stop. Navigation and the
   authoritative approve gate (`card.state === 'verified'`) are unchanged.
3. A high-risk file that **IS in `expected_files`** does **not** fire the reason
   (deliberately-planned sensitive edits do not nag).
4. The SupervisorAgent `diff_ready` card carries the criterion-linked QUESTION near the
   diff (reuse existing path), non-blocking/dismissible; when the supervisor degrades
   (RuntimeUnavailable / parse_error), the deterministic gate-block + the existing
   non-LLM reason chip is the honest surface — **no static fallback question
   masquerading as the AI decision** (002 canon).
5. The legacy `diffScopeDriftRule` stays quarantined (production card path is the
   supervisor); a regression test locks that the production (non-DEV) gate still fires
   so the dev-quarantine can never silently re-kill the signal.
6. All user-facing strings via i18n en+ko (reuse `decision_reason_high_risk_files`,
   `stepper_code_high_risk`, `bundle_unexpected_high_risk` — already in en+ko; S-030
   Hangul ESLint gate green).
7. Full local CI green (cargo fmt + clippy --all-targets --features dev-mock -D warnings
   + test; pnpm format:check + typecheck + lint + test:unit) and CAREFUL-04 re-run live
   on the release `.app` in ko + en (off-target `package.json` touch forces a written
   risk reason in a production build).

## Gaps closed

| Gap | Sev | Summary |
| --- | --- | --- |
| CAREFUL-04 / contract-mismatch | P1 | Live supervisor `diff_ready` card hardcodes `severity: Caution` (Rust enum has no `Risk`) and nests `highRiskFiles` under `assessmentSummary`/`diffReadyAssessment`, but both consumers require `severity === 'risk'` + flat `metadata.highRiskFiles`. Drop the severity predicate; source high-risk files from the shipping `assessmentSummary.highRiskFiles` / `diffReadyAssessment.highRiskFiles` (or flatten in `normalizeCard`); gate-block keys on high-risk AND outside-expected, firing independent of LLM parse. |
| dead-code regression | P2 | Legacy `diffScopeDriftRule` (rules.ts:468) is dev-quarantined and intentionally dead. Do NOT revive. Add a regression test asserting the production (non-DEV) supervisor card path still triggers the gate so the quarantine never silently re-kills the live signal. |
| classifier coverage (optional) | P2 | `guessChangedFileCategory` misses CI files, generic lockfiles, and secret-file paths — a `.github/workflows/*.yml` / `Cargo.lock` / `*.pem` drift is classified non-high-risk and never flagged. Add a `ci` category, broaden `dependency`, add a secret-path set; tests so coverage is intentional. (Owner decision 4.) |

## Design decisions (resolved, pending owner confirm on flagged items)

1. **Deterministic gate-block is the load-bearing fix** (Layer A, the WHEN). In
   `decisionGatePolicy.ts`, source high-risk files from the card metadata that actually
   ships — `metadata.assessmentSummary.highRiskFiles` and/or
   `metadata.diffReadyAssessment.highRiskFiles` — for cards of type `diff_scope_drift`
   OR `diff_scope_review`, **without** the `severity === 'risk'` predicate. Treat a
   populated (outside-expected) high-risk list as a gate-blocking
   `high_risk_unexpected_files` reason that fires independent of LLM card parse.
2. **Equivalent flatten option**: alternatively flatten
   `assessmentSummary.highRiskFiles → metadata.highRiskFiles` (and `diffReadyAssessment`)
   in `normalizeCard` (adapters.ts:1218-1240) so existing flat readers see it; mirror
   the predicate-drop in `StepDetailSlideIn.tsx:176-185`. Pick one source-of-truth and
   apply identically in both consumers to avoid drift.
3. **SupervisorAgent owns the QUESTION only** (Layer B, optional/canon-aligned). The
   deterministic gate decides to provoke; the supervisor generates the criterion-linked
   question for the near-artifact diff-scope card via the existing `diff_ready` path. Do
   NOT add a static fallback question that pretends to be the AI decision — when the
   supervisor degrades, the deterministic gate-block + non-LLM reason chip is the honest
   surface.
4. **Reuse, don't fork.** Same `evaluateProvocationSupervisor` plumbing, same
   non-blocking/near-artifact/dismissible card contract, same S-030 i18n keys, same
   S-029 evidence-gate plumbing. Event stays `diff_ready` (card `DiffScopeReview`, Verify
   stage) — never aliased to `scope_expansion` (that is S-018/019's plan-time path).
5. **Severity predicate dropped, not replaced** (owner decision 2a). The enum stays
   single-variant `Caution`; the trigger is the deterministic high-risk list, not a
   severity axis. If owner picks 2b instead, add a `Risk` variant + branch in the card
   builder when `diff_ready_assessment.high_risk_files` is non-empty.

## Non-goals / boundary

- **Do NOT duplicate S-034** (approval-card secret/.env warning,
  `guard.rs::assess_file_write_secrets`). S-034 = "is this single pending write leaking a
  secret VALUE?" — content+path heuristic, **per-write, approval-time**, on the
  write/edit APPROVAL card, can hard-block. S-037 = "did the agent edit a high-risk FILE
  the plan did not anticipate?" — **path-category vs expected-files SET drift,
  execution/verify-time**, at the DECISION gate, non-blocking. **S-037 must NOT re-scan
  file content for secret literals** and must NOT re-emit the env_file detection as a
  second approval callout. `.env` can legitimately appear in BOTH at different moments
  (S-034 at approval if content looks secret; S-037 at decision if edited outside plan)
  — sequence them, cross-reference, never two scary callouts for the same write within
  seconds.
- **Do NOT re-do S-018/S-019** (005 add-step `scope_expansion`). That is PLAN-time scope
  GROWTH (PRD-criterion-vs-add-step-fields, `SupervisorEvent::ScopeExpansion`, card
  `ScopeExpansion`, stage Extend, near the add-step area). S-037 is EXECUTION-time scope
  DRIFT (`SupervisorEvent::DiffReady`, card `DiffScopeReview`, stage Verify). Shared
  supervisor rails, **disjoint event + stage-gating** (`cardEligibleForStage`
  rules.ts:677-705 already separates them) — confirm no card-type aliasing.
- **Do NOT re-do S-029** (per-criterion evidence gate) or **S-030** (i18n) — reuse both;
  do not regress the existing high-risk i18n keys.
- **Do NOT un-quarantine** `diffScopeDriftRule` / `generateProvocationCards` — leave the
  legacy static keyword engine permanently dead.
- **Do NOT GATE** (hard-stop) — adds `requiresReason`, never a disabled Approve.

## Regression guards

- Approve stays disabled until `card.state === 'verified'` (DecisionGate authoritative) —
  unchanged; the new reason is a written-justification escalation, not a hard stop.
- High-risk file that IS in `expected_files` → reason does NOT fire (no over-block).
- Empty `changedFiles` / all-in-scope → `eligible=false`, no reason (existing
  `buildDiffReadyReviewAssessment` guards).
- Legacy `diffScopeDriftRule` stays quarantined (returns `[]` in prod) — locked by a test
  asserting the **production (non-DEV) supervisor path** still drives the gate.
- Existing S-029 / S-030 plumbing and the 3 existing high-risk i18n keys untouched
  (no regression).
- Supervisor `diff_ready` provoke-gate behavior unchanged where high-risk is empty
  (`supervisor_diff_ready_gate_covers_scope_drift_edges` ~supervisor.rs:3945 stays green).
- Export round-trip: `provocation.supervisor_evaluated` row for `diff_ready` carries
  `reasonCodes` (`high_risk_area`) + `highRiskFiles` intact (export_jsonl test family).

## Phase plan (= Wily phases; each = one Codex work order)

| Phase | Scope | Gaps |
| --- | --- | --- |
| **P0 Foundation / boundary lock** | Read-only confirm: legacy `diffScopeDriftRule` quarantine intact (rules.ts:662-667); live `diff_ready` provoke-gate + classifier intact; S-029/S-030 keys intact. Confirm chosen source-of-truth (decision 1/2: predicate-drop reading `assessmentSummary.highRiskFiles`/`diffReadyAssessment.highRiskFiles`, OR flatten in `normalizeCard`). No behavior change. Files: `decisionGatePolicy.ts`, `StepDetailSlideIn.tsx`, `adapters.ts`, `rules.ts`, `supervisor.rs`. | seams |
| **P1 Deterministic gate-block (load-bearing)** | `decisionGatePolicy.ts`: drop `severity === 'risk'` predicate; accept `diff_scope_drift` AND `diff_scope_review`; source high-risk from `metadata.assessmentSummary.highRiskFiles` / `metadata.diffReadyAssessment.highRiskFiles` (or via flattened `metadata.highRiskFiles` from `normalizeCard`); keep `requiresReason` (NON-blocking). Mirror in `StepDetailSlideIn.tsx:176-185`. Unit tests: gate blocks on off-target `package.json` with NO LLM card; does NOT fire when high-risk file is in `expected_files`; fires on supervisor parse_error; co-exists with other reasons. Files: `dive/src/components/product/decisionGatePolicy.ts`, `dive/src/components/product/StepDetailSlideIn.tsx`, `dive/src/features/provocation/adapters.ts` (if flatten), `dive/src/components/product/DecisionGate.test.tsx`. | CAREFUL-04 |
| **P2 Supervisor card metadata + question** | Ensure the live `diff_ready` card carries the high-risk list at the agreed metadata key and the criterion-linked QUESTION near the diff (reuse existing path); NON-blocking/dismissible. If owner picks decision 2b, add `Risk` variant + serde + branch in card builder when `diff_ready_assessment.high_risk_files` non-empty (supervisor.rs:2340-2362). Confirm degraded path shows the deterministic reason chip with NO fabricated AI question. Rust tests near `sample_diff_ready_context` (supervisor.rs:2777): high-risk non-empty ⇒ list present at top-level metadata; unexpected-only ⇒ no high-risk. Files: `dive/src-tauri/src/dive/supervisor.rs`. | CAREFUL-04 (question) |
| **P3 Classifier coverage (optional, owner decision 4)** | Extend `guessChangedFileCategory` (adapters.ts:74-89): add `ci` (`.github/workflows/`, gitlab-ci, Dockerfile, Makefile); broaden `dependency` (Cargo.lock/poetry.lock/Gemfile.lock/go.sum/requirements.txt); add secret-path set (`*.pem`,`*.key`,`id_rsa`,`credentials`,`.npmrc`,`.netrc`); include `ci`+secret in `isHighRiskFile`. Classifier unit tests (adapters.test.ts) for each category + the in-scope/out-of-scope boundary. Files: `dive/src/features/provocation/adapters.ts`, `dive/src/features/provocation/adapters.test.ts`. | classifier coverage |
| **P4 Regression lock + boundary + i18n + integration** | Add the dead-code regression test: production (non-DEV) supervisor card path still drives `high_risk_unexpected_files`. Add S-034 de-dup cross-reference (no double secret/drift callout for the same `.env` write within seconds; sequence approval-time then decision-time). Confirm en+ko strings reuse existing keys (no new Hangul literals; S-030 ESLint green). Export round-trip assertion. Full local CI + adversarial review; live CAREFUL-04 re-run on the built `.app` in ko+en. Files: `dive/src/features/provocation/__tests__/`, `dive/src-tauri/tests/export_jsonl.rs`, `dive/src/i18n/{en,ko}.json`. | regression, boundary, integration |

## Validation loop / Codex handoff

Same as S-035/S-036: root owns Wily lifecycle + this doc + verification + PR + merge;
Codex implements each phase within boundary (no un-quarantining `diffScopeDriftRule`, no
S-029/S-030/S-034/S-018-019 re-do, NON-blocking only — `requiresReason` not a hard
stop, deterministic gate-block survives supervisor degradation, SupervisorAgent owns the
question with no static fallback). Per-phase: Codex (raw `codex exec
--dangerously-bypass-approvals-and-sandbox` in the primary checkout, no git) → root
re-runs gates + commits → adversarial review at stage end → PR → merge → Wily complete.
Live CAREFUL-04 re-run deferred to P4 per the live-QA caveat (release `.app`, not tauri
dev).
