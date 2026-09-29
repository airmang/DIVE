---

description: "Work order for one supervision improvement cycle (spec 015 loop A)"
---

# Improvement Cycle: [SHORT NAME]

**Runbook**: `docs/improvement-cycle.md` · **Spec**: `specs/015-self-improvement-loops/` (FR-070–FR-072)
**Owner approval required before merge** · **Branch**: `[branch]` · **Date**: [YYYY-MM-DD]

Ground rules (copy unchanged into the PR):

- One candidate change per cycle. No runtime adaptation: the change ships as a
  new `promptVersion` or `policyVersion` (D-015-01).
- Metrics are card-quality proxies on synthetic fixtures and field response
  patterns, not evidence of improved student supervision skill.
- The LLM judge is advisory and never gates the merge (D-015-05).

## 1. Baseline

| Item | Value |
| --- | --- |
| Shipped `promptVersion` | [e.g. 1.0.0+256c9520] |
| Shipped `policyVersion` | [e.g. 1.0.0] |
| Baseline report | [path to `supervisor-recorded-<version>.json`] |
| Field exports used | [count, date range, origins included — classroom only unless stated] |

## 2. Evidence (inputs)

- **Field aggregate** (`pnpm research:cards`): [the signal — e.g. unanswered
  rate of `diff_ready` cards in Work mode, with counts]
- **Bench, dev split** (`pnpm eval:report`): [the weakest deterministic
  metric and the fixtures behind it]
- **Exemplars** (`--exemplars`, human-reviewed): [evaluation ids consulted;
  fixtures promoted, if any, after anonymized rewrite]

## 3. Candidate change (exactly one)

- [ ] Prompt text · [ ] `SupervisionPolicy` value · [ ] action allowlist
- What changes: [one sentence]
- Why it should move the target metric: [one sentence]
- Files: [paths]

## 4. Versioning

- [ ] Prompt text changed → `SUPERVISOR_PROMPT_SEMVER` [old → new], pin history
      appended with `(new, hash)`.
- [ ] Policy value / frontend allowlist changed → `policyVersion` [old → new],
      value pins updated (`policy.test.ts`, `supervision_policy.rs`).
- New `promptVersion`: [ ] · new `policyVersion`: [ ]

## 5. Recordings (prompt changes)

- [ ] `pnpm eval:supervisor:live -- --db <copied dive.db> --write-recordings`
      (model: [id], calls used: [n] ≤ 2 × fixtures)
- [ ] `pnpm prettier --write eval/supervisor/fixtures && pnpm eval:fixtures`

## 6. Measurement

- [ ] Head report: [path] · Base report: [path]
- [ ] `pnpm eval:report -- --compare <base> <head> --out compare.md`
- [ ] `pnpm eval:gate -- <base> <head> --model <live model>` → **[PASS / FAIL]**
      (`--json > gate.json`; on FAIL, `pnpm qa:triage -- --from-eval gate.json`)

| Metric (holdout, gated model) | Before | After | Within tolerance |
| --- | --- | --- | --- |
| Provoke agreement | | | |
| Locale compliance | | | |
| Criterion linkage | | | |
| Evidence precision | | | |
| Over-limit questions | | | |
| Hard fails | — | | |

Holdout consulted more than once for this candidate: [no / yes — why]

AI judgment (advisory, not a merge gate): [summary or "not run"]

## 7. Decision

- [ ] PR opened with `compare.md`, the gate summary and this work order: [link]
- [ ] Owner approval: [name, date] — or dropped: [reason]
- [ ] Release note names `promptVersion` [ ] and `policyVersion` [ ] and repeats
      the claim-discipline sentence.
