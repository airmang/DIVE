# Improvement Cycles (spec 015)

How DIVE's supervision behavior and product quality are improved from
evidence: loop A for the SupervisorAgent's review cards, loop B for QA
defects. Authority: `specs/015-self-improvement-loops/` (spec FR-070–FR-081,
decisions D-015-01–D-015-08). Commands run from `dive/` unless noted.

## Ground rules

- **No runtime adaptation (D-015-01).** DIVE never changes its own behavior
  from user responses: no learner model, no per-student card suppression, no
  self-editing prompt. Every change is a versioned release — a new
  `promptVersion` or `policyVersion` — proposed from evidence, measured before
  merge, and merged only through an owner-approved PR.
- **Claim discipline.** Eval metrics and field aggregates describe card
  quality on synthetic fixtures and response patterns in exports. They are not
  evidence that DIVE improves students' supervision skill, metacognition,
  critical thinking, or AI overreliance. Reports, PRs, and release notes must
  not say otherwise.
- **The LLM judge is advisory (D-015-05).** Its section is labelled
  "AI judgment (advisory, not a merge gate)" and never decides a merge.
- **Research data stays separated.** QA and development sessions carry
  `Session.origin` `qa` / `dev` and are excluded from field aggregates unless
  explicitly included (`--include-origin`).

## Overview

```
 field exports ──► research:cards ─┐
 replay corpus ──► exemplars ──────┼─► one candidate change ─► version bump
 eval report (dev) ────────────────┘                              │
                                                                   ▼
 release note ◄── owner-approved PR ◄── eval:gate ◄── eval dev + holdout
     (versions)      (before/after report)

 qa:queue ─► live QA run ─► qa:run apply ─► qa:triage ─► spec / Stage (by hand)
     ▲                                          ▲
     └──── code changes ◄───────────────────────┴── eval-gate regressions
                                                    (qa:triage --from-eval)
```

## Loop A — one supervision improvement cycle

Use `.specify/templates/improvement-cycle-work-order.md` as the work order;
one filled copy per cycle travels with the PR.

1. **Inputs.**
   - Field aggregate: `pnpm research:cards <export.jsonl...>` over classroom
     exports (per event, concern, mode, promptVersion, policyVersion, model:
     action / dismiss / mark-irrelevant / continued-with-risk / unanswered
     rates, response latency, drop reasons).
   - Bench: `pnpm eval:supervisor:recorded`, rendered with
     `pnpm eval:report <report.json>`; read the **dev** split only while
     choosing and iterating.
   - Exemplars: `pnpm research:cards <exports> -- --exemplars` lists
     evaluation ids worth a look; the matching replay-corpus rows stay on the
     machine that captured them. Promoting one into a fixture is manual: rewrite
     it as a synthetic case, strip anything that could identify a student or
     school, review, commit (FR-051; see `dive/eval/supervisor/README.md`).
2. **Choose exactly one candidate change**, aimed at one weak deterministic
   metric or one field signal:
   - prompt text (`src-tauri/src/dive/supervisor/prompt.rs`);
   - a `SupervisionPolicy` value (`src/features/provocation/supervision-policy.json`);
   - the action allowlist (prompt action instructions and/or the frontend
     `allowedActionIds` in `src/features/provocation/adapters.ts`).
3. **Bump the version.**
   - Prompt text changed: bump `SUPERVISOR_PROMPT_SEMVER` and append the new
     `(semver, hash)` pair to the pin test history (the failing pin test prints
     the hash); never rewrite an existing entry.
   - Policy value or frontend allowlist changed: bump `policyVersion` in
     `supervision-policy.json` and update both value pins
     (`policy.test.ts`, `supervision_policy.rs`).
4. **Record fixtures for the new prompt version** (prompt changes only; a
   policy-only change keeps the prompt version and its recordings, but add
   recordings if a fixture's gate now opens without one):
   `pnpm eval:supervisor:live -- --db <copied dive.db> --write-recordings`,
   then `pnpm prettier --write eval/supervisor/fixtures && pnpm eval:fixtures`.
   Live runs are capped at 2 × fixture count model calls (D-015-06).
5. **Run the eval on dev + holdout** (one report holds both splits):
   ```sh
   pnpm eval:supervisor:recorded -- --prompt-version <old> --out /tmp/base.json
   pnpm eval:supervisor:recorded -- --out /tmp/head.json
   pnpm eval:report -- --compare /tmp/base.json /tmp/head.json --out /tmp/compare.md
   ```
   Iterate on dev. Look at holdout only for the gate; if the candidate is
   reworked after a holdout failure, say so in the PR.
6. **Gate.** `pnpm eval:gate -- /tmp/base.json /tmp/head.json --model <live model>`
   (add `--json > /tmp/gate.json` for the machine-readable result). Groups are
   compared like for like by (split, model); `--model` gates the live model
   the candidate was recorded with. Without it every model present in both
   reports is gated; a model only in the head is reported as new and not
   gated. It fails on
   any hard violation — a shown non-question, a shown card without evidence
   refs, a static/fallback question where a model call was expected, a
   negative control whose drop reason changed — on any split, and on the
   holdout split when a rate metric (provoke agreement, drop-reason match,
   locale compliance, criterion linkage, evidence precision, required
   evidence cited) drops more than 5 pp or over-limit questions / locale
   violations increase at all. Exit 0 pass, 1 fail, 2 bad input.
7. **PR** carrying `compare.md`, the gate summary, the filled work order,
   and the new versions. A failing gate does not merge; record why the
   candidate was dropped in the work order instead.
8. **Owner approval** merges the PR. Nothing auto-merges.
9. **Release note** names the shipped `promptVersion` and `policyVersion`
   (the join key between field exports, the bench, and releases) and repeats
   the claim-discipline sentence.

## Loop B — one QA cycle

1. `pnpm qa:queue [-- --since <ref>]` — selects scenarios (fixed-but-unverified
   defects, areas changed since their last pass, stale scenarios) and writes a
   work order to `.harness/work-orders/qa/<date>.md`.
2. **Live run** on a release `.app` with computer-use, following the work
   order. Tag the session as QA: write `qa` into
   `<app_data_dir>/session-origin` (a LaunchServices launch passes no env
   vars) or launch with `DIVE_SESSION_ORIGIN=qa`.
3. `pnpm qa:run init --scenarios <ids>`, fill in results, defects and evidence,
   then `pnpm qa:run apply <draft>` — writes `docs/qa/ledger/runs/` and the
   defect transitions.
4. `pnpm qa:triage` — clusters open defects into spec-theme stubs and Wily
   `design_stage` payload drafts in `.harness/triage/<date>/`. Drafts only:
   a person reviews them and registers Stages or edits specs.
5. A `fixed` defect closes only through a guard its runner resolves
   (`pnpm verify:qa-ledger`).

## How the loops connect

- A failing gate becomes ledger defects:
  `pnpm eval:gate -- base.json head.json --json > gate.json` then
  `pnpm qa:triage -- --from-eval gate.json`. Each regressed fixture becomes an
  open defect (`source.kind: eval`, `eval-fixture` guard); hard fails and
  holdout regressions past tolerance are `P1`, other fixture regressions `P2`.
- QA runs tag their sessions `origin: qa`, so they feed `research:cards` only
  with `--include-origin qa`.
- `promptVersion` / `policyVersion` join field aggregates (loop A input), the
  bench reports, the gate result, and release notes.
