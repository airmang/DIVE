# 015 Self-Improvement Loops — Decision Log

Decisions for spec 015 (S-076–S-084). Each entry names the scope, the decision,
and the evidence. Canonical order: constitution > specs > this log.

## D-015-01 (umbrella) — Improvement is offline, human-gated, and versioned

DIVE never adapts supervision behavior at runtime from user responses: no
learner model, no per-student card suppression, no self-editing prompt. A
change to supervision behavior is a versioned release (`promptVersion`,
`policyVersion`) proposed from evidence (field aggregates + offline eval),
gated by a before/after eval comparison, and merged only through an
owner-approved PR.

Evidence / rationale: Constitution IV (interventions must be reconstructable
for research; per-user drift breaks comparability), VI (drop/dedup/cooldown
rules deterministic and unit-tested — they may change between versions, never
between sessions), V (no runtime suppression of risk cards — marking risk
cards irrelevant is the automation-bias pattern DIVE surfaces, so learning
from it would optimize against the product), and AGENTS.md claim discipline
(eval metrics are card-quality proxies, not evidence of student skill gains).
Runtime adaptation needs its own spec and constitution ADR.

## D-015-02 (OD-1, S-078) — Replay capture is local ON with a retention cap

`SupervisorReplayRecord` capture defaults to ON, capped at 500 records and 30
days (whichever is hit first), clearable from Settings, and excluded from the
default export. Rationale: the captured context is exactly what DIVE already
sends to the configured provider, so local storage adds no new recipient; an
opt-in default would leave the eval corpus empty in practice.

## D-015-03 (OD-2, S-076) — Generated question text is exported in plain text

The SupervisorAgent question is AI output and the core unit of card-quality
analysis. It is logged and exported in plain text, still passing through the
existing PII/secret detectors in `export/anonymize.rs` (a question that trips
them is hashed like any other matching value).

## D-015-04 (OD-3, S-077) — The QA ledger is seeded with open items only

Seed = the surviving findings of `docs/qa/post-cleanup-review-2026-07-22.md`
re-checked against the current tree (still-valid and partially-fixed ones
become `open`) + every new finding from now on. Older reports stay as history
and are not bulk-migrated.

Amended 2026-09-29 (S-077 review): fixed findings whose guard the re-check
reported as existing are imported by S-080 as `fixed` once `verify:qa-ledger`
resolves the guard through its runner — not before, and never as `verified`
(that state requires a rebuilt, re-run release). Fixed findings without a
resolvable guard stay out of the ledger.

## D-015-05 (OD-4, S-079) — LLM-judge is advisory only

The optional rubric (specific, criterion-linked, answerable by observation,
non-leading) is reported in its own section labelled AI judgment. It never
gates a merge on its own; the FR-071 gate uses deterministic metrics only.

## D-015-06 (OD-5, S-079) — Live eval uses the owner's provider key with a call cap

Live mode uses the owner's configured OpenRouter key through the normal Pi
provider path (no separate SDK path — Constitution III) and refuses to run
past `2 × fixture count` model calls per invocation.

## D-015-07 (S-077) — Ledger files are JSON, validated without new dependencies

`dive/` has no YAML parser or JSON-Schema validator. Ledger records are one
JSON file each (merge-friendly, diffable) validated by a small hand-written
typed validator in `dive/scripts/qa-ledger/`. The schema lives next to it as
documentation (`schema.md`) and is enforced by vitest tests.

## D-015-08 (umbrella) — CI wiring rides on scripts CI already runs

Workflow files cannot be pushed from agent sessions (token lacks the
`workflow` scope). New checks therefore attach to steps CI already runs:
vitest (`test:unit`, include widened to `scripts/**/*.test.mjs`),
`verify:v4` (new track), and `cargo test --features dev-mock --all-targets`
(new integration tests). Checks that need both toolchains (cargo-guard
resolution) run locally and in `release-gate`; a one-line workflow addition is
left for the owner if full CI coverage is wanted.

## D-015-09 (S-076 review) — Session origin: persisted override, legacy rows are `dev`

A release `.app` launched through LaunchServices receives no shell environment,
so `DIVE_SESSION_ORIGIN` alone cannot tag live-QA sessions. Precedence is
env > `<app_data_dir>/session-origin` file > debug build → `dev` > `classroom`;
the live-QA recipe writes the file. Migration v20 (unreleased when amended)
backfills sessions that existed before it as `dev`: no classroom pilot has run
on any build yet, so labelling historical team/QA sessions `classroom` would
seed the research aggregates with non-classroom data.

## D-015-10 (S-076 review) — Card events keep one session per exposure

A card exposure's events are attributed to one session: the host captures the
context (and session) when the exposure opens, and the Rust fallback reuses the
session of an earlier row with the same `exposureId` before falling back to the
project's latest non-archived session (marked `sessionResolvedBy`). Events with
no session at all (PRD authoring before any session exists) stay NULL and are
not in any session export — a documented limitation, not silently misattributed.
Misattribution is worse than absence for the research ledger (Constitution IV).
