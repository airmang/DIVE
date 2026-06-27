# S-039 — Refactor/rename safety: behavior-preserving guidance, multi_replace tool & quieter search (009 theme 11) — stage spec/plan

**Wily Stage**: S-039 (`STG-c13191d37e20`, project `dive-2`). Status `draft` →
claimed by root. **Scope**: `dive/src-tauri/src/{tools,agent,ipc,dive,db}/**`,
`dive/src/features/provocation/**`, `dive/src/components/permission-card/**`,
i18n. Root owns the Wily lifecycle.

**Spec**: [`spec.md`](spec.md) theme 11 — "Refactor/rename safety
(behavior-preserving guidance, multi-replace, quieter search)."

**Owner decision (2026-06-27)**: ship the **new `multi_replace` runtime tool**
(Option B) for atomic cross-file rename — routed strictly through the existing
008 approval/guard/secret-scan + S-037 scope-drift pipeline (no bypass). The
behavior-preserving banner + quieter search ship regardless. **Adopted
recommendations**: the `behavior_preserving`/`step_kind` marker is **auto-set by
the specs/004 D-stage decomposition** (not diff keyword-sniffing), gated on
"no verification evidence yet" so it can't nag a tested refactor; quieter-search
vendor exclusion is **per-run `include_vendor`** (+ include/exclude glob), never
a silent hide.

## Context & why (confirmed by source reads)

1. **REFACTOR-03**: no cross-file replace/rename primitive. The builtin tool set
   (`tools/registry.rs:26-39`, closed-set test :78-99) is exactly 10 tools;
   `edit_file` REFUSES a `find` matching >1 time in one file
   (`edit_file.rs:60-68`) and touches one path. So a cross-file rename = N
   scattered `edit_file`/`write_file` calls, each its own approval card, **no
   atomicity** → partial-rename failure + beginner card-spam/stall.
2. **REFACTOR-02**: nothing tells the agent a refactor/rename must move code
   verbatim (`current_card_system_prompt`, mod.rs:1768-1790, has no step kind),
   and the diff-time supervisor rail (`buildDiffReadyReviewAssessment`,
   adapters.ts:789-799) ignores the existing `changeType:"renamed"` field
   (types.ts:133), so a pure rename produces no "is this behavior-preserving?"
   provocation.
3. **Quieter search**: `search_files` walks the whole tree skipping only `.git`
   (visit ~line 135) — traverses node_modules/dist/build/target, no .gitignore,
   caps 100 flat matches at 500 chars/line, and the agent ships the entire `full`
   payload to the model (`agent/mod.rs:647`), polluting context + rename-
   completeness evidence.

## Acceptance

1. A cross-file rename is executable via ONE `multi_replace` call producing a
   SINGLE approval card showing the full multi-file blast radius (per-file
   before/after), applied **atomically** (all target files change or none).
2. `multi_replace` flows through the SAME safety pipeline as write/edit: a secret
   in any replacement after-content flags + escalates to Danger; it is blocked by
   plan-first/build gating until an approved active step exists; its changed files
   feed the **S-037 scope-drift/high-risk DiffReady gate** (no bypass).
3. On a refactor/rename step the per-step agent prompt instructs the model to move
   code verbatim (no logic/defaults/ordering change), sourced from the D-stage
   marker, i18n en+ko (not hardcoded Hangul).
4. A pure rename diff (`changeType:'renamed'`) with **no verification evidence**
   triggers an AI-authored, criterion-linked, **non-blocking** DiffReady
   provocation asking whether the change is behavior-preserving; a tested refactor
   does NOT trigger it; it degrades to a deterministic locale shell when the
   runtime is down.
5. `search_files` no longer walks node_modules/dist/build/target by default
   (re-includable via `include_vendor`), caps returned matches per-file + globally,
   shortens lines, and the summary reports scanned/matched/capped — so a verifier
   can still prove old-name=0-hits across real source.
6. All new prose is i18n en+ko (S-030 ESLint green); S-029/S-030/S-034/S-037
   surfaces untouched.
7. Full local CI green (rust fmt + clippy -Dwarnings + test --all-targets
   --features dev-mock; frontend format:check + typecheck + lint + unit);
   adversarial review pass; live refactor/rename re-run on the release `.app` in
   ko + en (deferred per live-QA caveat).

## Gaps closed

| Gap | Sev | Summary |
| --- | --- | --- |
| REFACTOR-03 (no multi-file rename) | P1 | New `multi_replace` tool (RiskLevel::Warn): resolves an explicit path set via the sandboxed FsGuard, pre-computes every (path,before,after), writes ALL-OR-NOTHING — routed through the SAME approval/guard/secret-scan/scope-drift pipeline as write/edit. |
| REFACTOR-02 (prompt path) | P2 | `current_card_system_prompt` never says "move code verbatim". Add a `step_kind`/`behavior_preserving` marker to NewStep/StepRow (from D-stage), inject an i18n verbatim-move clause when set. |
| REFACTOR-02 (supervisor path) | P2 | `buildDiffReadyReviewAssessment` ignores `changeType:"renamed"`. Add a `behavior_preserving_refactor` reason code (rename-shape AND no-evidence) → the EXISTING DiffReady provoke gate fires an AI-authored question (specs/002, no static card). |
| Quieter / trustworthy search | P2 | Default-exclude vendor/build dirs (opt-OUT `include_vendor`), per-file + global caps, shorter lines, explicit scanned/matched/capped accounting; never silently hide source. |
| DiffReady offline degradation | P3 | `provocation_agent.rs:316-328` drops DiffReady to RuntimeUnavailable offline. Add a locale-aware deterministic DiffReady shell so the refactor banner degrades gracefully. |

## Design decisions (resolved)

1. **Ship the new `multi_replace` tool** (owner Option B) — only a cross-file tool
   solves the completeness story (one card + atomic all-or-nothing). Surface-area
   risk mitigated by **reuse** (same FsGuard resolve, `assess_file_write_secrets`
   per after-content, Danger-escalation, DiffReady scope-drift gate, a generalized
   multi-entry DiffPreview), not avoidance.
2. **Multi-file diff = a parallel `diff_previews: Vec<DiffPreview>`** field
   (event.rs:226, permission.rs:55/106), keeping the single `diff_preview` working
   for write/edit — additive, backward-compatible with the existing approval card.
3. **The refactor banner reuses `SupervisorEvent::DiffReady`** (add a reason code),
   NOT a new ProvocationCardType or frontend static rule. The gate already fires on
   any non-empty reason_codes; the SupervisorAgent authors the criterion-linked
   wording. Key on the `multi_replace` tool-name / `changeType:"renamed"` for
   precision.
4. **Marker auto-classified in the D-stage decomposition** (canon-clean), with the
   supervisor reason additionally gated on "no verification evidence yet" so a
   mis-classification can't nag a tested refactor. Human override = follow-up.
5. **Quieter-search exclusion is per-run `include_vendor`** (+ include/exclude glob,
   serde defaults = today's contract); always surface scanned/matched/capped.

## Non-goals / boundary

- Do NOT add a new ProvocationCardType or a static/keyword "looks like a refactor"
  card (specs/002) — reuse the deterministic DiffReady provoke gate + AI question.
- Do NOT let `multi_replace` bypass the 008 pipeline: same FsGuard resolve,
  `assess_file_write_secrets` per after-content, Danger-escalation, multi-file diff
  preview, plan-first gating, and the **S-037 scope-drift gate**. No private path.
- Do NOT keyword-sniff the diff to set the marker — source from the D-stage
  decomposition (diff-shape may only boost precision on the high-confidence
  tool-name signal).
- Do NOT make quieter-search hide safety-relevant usages — `include_vendor`
  opt-out + scanned/matched/capped surfaced. Literal/regex contract unchanged.
- Do NOT re-do S-029/S-030/S-034/S-037 — reuse them; the multi-file card respects
  the S-034 legibility budget (no new layout).
- Do NOT alter `edit_file` single-match strictness (it stays the safe one-off);
  `multi_replace` is the explicit opt-in bulk path. Do NOT mutate the single
  `DiffPreview` contract for write/edit (add a parallel field).
- Do NOT extend the hardcoded-Korean defect in `current_card_system_prompt` — the
  new clause is i18n en+ko.

## Regression guards

- Registry closed-set test (registry.rs:78-99) updated to exactly **11** builtins
  incl. `('multi_replace', RiskLevel::Warn)`.
- Existing single-`DiffPreview` path for write/edit stays functional + its approval
  card tests green after the parallel `diff_previews` Vec.
- `edit_file` N>1 refusal unchanged (regression test).
- **Atomicity**: a mid-batch unwritable/non-UTF-8 file leaves NO file changed.
- `multi_replace` appears in `denies_pre_plan_mutation` + triggers secret-scan/
  Danger-escalation (not invisible to plan-first gating or secret detection).
- Quieter-search: literal/regex/bad-regex/sandbox-escape tests still pass;
  node_modules excluded by default but re-included with `include_vendor`; summary
  reports true scanned vs capped (truncation never silent).
- `behavior_preserving` provocation does NOT over-fire (tested refactor with
  evidence → no card; keyed on rename-shape AND no-evidence).
- `StepContext.kind` defaults so existing callers compile; the new prompt clause is
  i18n (S-030 green).
- Offline DiffReady shell fires ONLY when `supervisor_provoke_gate` says yes,
  locale-aware, never when the gate says no.

## Phase plan (= Wily phases; Codex work orders; ordered smallest/safest first)

| Phase | Scope | Gaps |
| --- | --- | --- |
| **P1 Quieter search** | `search_files.rs`: `IGNORED_DIRS` skipped in `visit()` with opt-in `include_vendor`; keep scanning for accurate counts but cap returned matches (global ~50, per-file ~5) with `total_match_count` separate; shorten lines (~160); summary "scanned X, matched Y, showing K, capped"; optional include/exclude_glob/max_results (serde defaults). | quieter search |
| **P2 Behavior-preserving prompt** | optional `behavior_preserving`/`step_kind` on NewStep/StepRow (models.rs) from the D-stage; thread through LoadedStepContext (chat.rs) → StepContext (mod.rs) with a compile-safe default; `current_card_system_prompt` pushes one **i18n** verbatim-move clause when set (NOT extend the hardcoded-Korean defect). | REFACTOR-02 prompt |
| **P3 Behavior-preserving provocation + offline shell** | `buildDiffReadyReviewAssessment` adds `behavior_preserving_refactor` (renamed/refactor AND no-evidence) → existing DiffReady gate (supervisor.rs) fires AI question; locale-aware deterministic DiffReady shell in `provocation_agent.rs` (en+ko). No new card type. | REFACTOR-02 supervisor + offline |
| **P4 multi_replace tool core** | NEW `tools/multi_replace.rs` (Tool, RiskLevel::Warn, schema {find,replace,paths?,path_glob?,occurrence}); `run()` resolves via `ctx.fs.resolve` (sandbox+reject_symlink), reads UTF-8, **atomic pre-compute** of every (path,before,after) — any resolve/non-UTF-8 failure aborts ALL (no partial); `full.changed_files=[{path,replacements}]`; reuse `IGNORED_DIRS` for path_glob. Register in `with_builtins()` + closed-set test (11) + `params_preview()`. NO approval/diff wiring yet. | REFACTOR-03 core |
| **P5 multi_replace pipeline wiring** | (1) generalize diff: parallel `diff_previews: Vec<DiffPreview>` on event.rs + PermissionRequestContext/PendingApprovalSnapshot; `multi_replace` arm in `build_diff_preview`. (2) `multi_replace` in `approval_warnings_for_tool` matches! + `assess_file_write_secrets` per after-content → Danger-escalation. (3) `multi_replace` in `denies_pre_plan_mutation`. (4) `record_changed_files` attaches each per-path diff → checkpoint/rollback + **S-037 scope-drift gate** see every file. Frontend: PatchPreviewPanel renders multi-entry. en+ko. | REFACTOR-03 integration |

## Validation loop / Codex handoff

Likely **4 Codex passes**: A=P1 (search), B=P2+P3 (behavior-preserving rail),
C=P4 (tool core, isolated), D=P5 (pipeline wiring — the riskiest, verified after
the tool core is proven atomic). Root owns Wily lifecycle + verification + PR +
merge; Codex implements per boundary (reuse pipeline, no bypass, atomic, i18n).
Per-phase: raw `codex exec --dangerously-bypass-approvals-and-sandbox` in primary
(no git) → root re-runs gates + commits → adversarial review at stage end → PR →
merge → Wily complete.
