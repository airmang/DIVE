# Implementation Gap Matrix: Provocation Supervisor Agent

**Created**: 2026-06-14
**Spec**: `spec.md`

## Summary

Stage F cleanup status (2026-06-14): the shipped P1 verify/final-approval path
now runs through the Rust/Tauri `provocation_agent_evaluate` boundary and maps
only validated SupervisorAgent decisions into the existing card UI. The old
frontend keyword/list rule generator remains in the repository only as a
dev/internal migration and unit-test aid: `generateProvocationCards` returns no
cards unless `import.meta.env.DEV` and
`VITE_DIVE_INTERNAL_PROVOCATION_RULE_CARDS=true`, and `rules.ts` is no longer
exported from the provocation barrel. This means supervisor failure, no-card,
or dropped decisions do not revive static fallback cards in shipped/classroom
builds.

The current implementation has a usable card UI, card action logging,
verification evidence helpers, EventLog export sanitization, Rust supervisor
domain validation, and Pi sidecar supervision boundary pieces. Remaining gaps
are compatibility/QA items listed below, not a replacement-generation-path gap
for P1.

## Keep

| Area | Current files | Why keep |
| --- | --- | --- |
| Card UI host | `dive/src/features/provocation/ProvocationCardHost.tsx` | Already selects one primary card, supports dismiss/mark-irrelevant/action, and logs card exposure. |
| Card rendering | `dive/src/features/provocation/ProvocationCard.tsx` | Existing student-facing UI can remain the first target. |
| UI-facing types | `dive/src/features/provocation/types.ts` | `ProvocationCard`, action kinds, verification summaries, and card type taxonomy remain useful. |
| Priority ranking | `dive/src/features/provocation/priority.ts` | Keep ranking behavior only. Existing `expert` suppression is not canonical P1 behavior and must move to the rewrite/adapt bucket. |
| Verification evidence helpers | `dive/src/features/provocation/verificationStatus.ts` | Good reference for evidence categories, but Rust must become canonical. |
| Card interaction logging | `dive/src/features/provocation/logging.ts` | Already logs exposure/actions and summarizes evidence safely. |
| Tauri log command | `dive/src-tauri/src/ipc/provocation.rs` | Existing `provocation_log_event` can be extended. |
| Export sanitizer | `dive/src-tauri/src/export/mod.rs` | Already redacts long/raw/code-like evidence payloads. |
| Pi sidecar no-discovery loader | `dive/pi-sidecar/src/index.mjs` | Existing `makeNoDiscoveryResourceLoader` is the right baseline. |
| Pi sidecar event protocol | `dive/src-tauri/src/pi_sidecar.rs`, `dive/src-tauri/src/pi_sidecar/protocol.rs` | Existing process/protocol handling can be reused for supervisor one-shot. |

### Stage A Classification Confirmation

The previously unclassified provocation files are now classified for the P1
supervisor-agent plan. These classifications do not implement behavior; they
only remove planning ambiguity before later stages.

| Area | Current files | Classification | Notes |
| --- | --- | --- | --- |
| Action resolver | `dive/src/features/provocation/useProvocationActionResolver.ts` | Keep, adapt later | Keep the existing action dispatch seam. Later tasks must filter to feasible P1 verification nudges and prevent no-op verify actions. |
| Adapters | `dive/src/features/provocation/adapters.ts` | Rewrite/adapt | Keep temporary normalization helpers, but backend supervisor response mapping becomes the P1 authority. Do not let adapters assemble canonical supervisor context. |
| Verification grade | `dive/src/features/provocation/verificationGrade.ts` | Keep, align later | This is the strict frontend helper closest to FR-034; later tasks should align all looser evidence summaries to this criterion-linked definition and Rust canonical evidence. |
| Barrel | `dive/src/features/provocation/index.ts` | Keep, adapt later | Keep the export surface. Later cleanup should export supervisor-facing types and quarantine shipped P1 access to rule generation. |
| Socratic interview | `dive/src/components/product/SocraticInterviewPanel.tsx` | Keep UI, rule-card dependency removed | The interview surface remains product workflow, but it is outside P1 `verify_entered` review-card behavior. Stage F removed its direct `generateProvocationCards`/`ProvocationCardHost` dependency so it cannot mix old rule cards into shipped P1 review-card behavior. |

## Remove Or Disable

| Area | Current files | Required change |
| --- | --- | --- |
| Keyword card generation | `dive/src/features/provocation/rules.ts` | Stage F quarantined the aggregate generator. `generateProvocationCards` is shipped-safe no-op unless explicitly enabled in dev by `VITE_DIVE_INTERNAL_PROVOCATION_RULE_CARDS=true`; the old aggregate implementation is renamed `generateQuarantinedRuleProvocationCards` for migration/unit tests only. |
| Frontend generation hook | `dive/src/features/provocation/useProvocationCards.ts` | The hook now inherits the shipped-safe no-op behavior from `generateProvocationCards`; P1 verify/final approval does not use this hook. |
| Direct `generateProvocationCards` production references | `dive/src/features/provocation/useProvocationCards.ts`; `dive/src/components/chat/MessageList.tsx`; `dive/src/components/product/PlanDraftApprovalScreen.tsx`; `dive/src/components/slide-in/TerminalTab.tsx` (4 remaining references after Stage F; `StepDetailSlideIn.tsx` uses backend supervisor evaluation, `ToolActivity.tsx` no longer imports rule cards, and `SocraticInterviewPanel.tsx` no longer imports rule cards) | These legacy surfaces remain code-compatible but render no keyword/list cards in shipped/classroom builds because the public generator is quarantined. They are not fallback paths for SupervisorAgent failure. |
| `generateProvocationCards` rule tests | `dive/src/features/provocation/__tests__/rules.test.ts` | Stage F updated aggregate rule expectations to call `generateQuarantinedRuleProvocationCards` and added coverage that public `generateProvocationCards` returns no cards when the internal dev flag is disabled. |
| Static fallback behavior | Old design docs only | Do not implement. Failure means no card plus log. |
| Canonical `expert` / `standard` modes | `dive/src/features/provocation/types.ts`, mode settings/tests | Remove as supervisor canonical modes. During migration, `standard` and `expert` are adapter inputs that map to `work`; `guided` maps to `guided`. |
| Sidecar smoke fallback tool in supervisor path | `dive/pi-sidecar/src/index.mjs` | Supervisor messages must send `tools: []` explicitly and assert enabled tools are empty. |

## Improve

| Gap | Target |
| --- | --- |
| No Rust-owned `SupervisorContext` | Add Rust domain model and builder for P1 events. |
| No canonical mode adapter | Add an adapter before `SupervisorContext` construction: `guided -> guided`, `standard -> work`, `expert -> work`; unknown mode drops/logs `invalid_mode`. |
| No `SupervisorDecision` parser/validator | Add strict schema parsing, validation, and stable drop reasons. |
| No evaluation log for silent/drop outcomes | Add `SupervisorEvaluationLog` through EventLog/export. |
| No supervisor sidecar mode | Add `run_supervisor_turn` using Pi with no tools/resource discovery. |
| No zero-tool supervisor boundary test | Add sidecar/Rust tests asserting `enabled_tools == []`. |
| No deterministic supervisor card IDs | Add `artifactRef + concern + evidenceHash` ID generation. |
| No P1 dedup state | Add session-scoped duplicate suppression for artifact/concern/evidence hash. Cooldown remains reserved for future events. |
| Frontend evidence is not canonical | Frontend may send UI flags, but Rust owns evidence bundle and context hash. |
| No feasibility computation for verification | DIVE must compute feasible verification methods (`runnable`/`previewable`/`hasTests`/`diffAvailable`) and filter `allowedActionIds` (FR-030/FR-031). `app_launched`/`preview_checked` are observations, not capabilities. Card must stay non-blocking when nothing is feasible (FR-032). |

## Stage F Final Classification

| Item | Final state |
| --- | --- |
| P1 generation authority | `StepDetailSlideIn.tsx` requests `provocation_agent_evaluate`; no frontend keyword/list card is synthesized for `verify_entered` none/dropped/error outcomes. |
| Barrel export surface | `dive/src/features/provocation/index.ts` exports adapters, priority, card host/view, logging, types, action resolver, and verification helpers. It does not export `rules.ts` or `useProvocationCards`. Supervisor-facing TypeScript request/response/mode/feasibility types remain exported via `types.ts`. |
| Legacy keyword/list rules | Present only in `rules.ts` as migration/test code. The aggregate public generator is dev-flag quarantined and shipped no-op by default. |
| Pre-run permission cards | `ToolActivity.tsx` no longer renders legacy provocation cards, no longer blocks tool approval on old `diff_scope_drift` cards, and no longer writes `provocation.continue_with_risk` approval metadata from keyword/list rules. |
| Socratic interview | Kept as product workflow UI, but no longer renders provocation/review cards and therefore stays outside shipped P1 review-card behavior. |
| Obsolete tests | Aggregate rule tests no longer assert shipped `generateProvocationCards` behavior. Individual rule tests remain as migration regression coverage for the quarantined code. |
| 003 card UX compatibility | `ProvocationCard.tsx` now treats `prompt` as the focal question, hides the secondary `message` in Work Mode, and limits Guided Mode to one subordinate explanation/message line plus bounded evidence/actions. |
| Remaining gap | The old rule functions are still compiled because some legacy surfaces import the public generator directly, but the runtime behavior is no-op in shipped/classroom builds. Removing those surfaces entirely should be a later product decision, not a Stage F cleanup. |

## Field-Confirmed Verify-Flow Defects (historical trace, 2026-06-14)

A trace of the step-end review window (`StepDetailSlideIn.tsx`) reproduced the
"guidance for an unverifiable step, and cannot proceed" report, and an audit of
the verification-evidence logic (the D1 integrity class — fabricated or
ungrounded state trusted as verification) surfaced two more. Stage D/E fixed the
product behavior, and Stage F revalidated the final state. The table is retained
as an audit trail with current status rather than an open gap list.

| # | Defect | Location | Stage F status |
| --- | --- | --- | --- |
| D1 | Clicking `미리보기 열기`/`앱 실행` records `previewObserved`/`appLaunched` **before** anything is shown — a click fabricates concrete verification evidence, which flips `hasVerifiedEvidence` and can unblock approval. Violates constitution II ("AI self-report / unobserved state MUST NOT be treated as verification"). | `dive/src/components/product/StepDetailSlideIn.tsx` preview/app handlers and criterion confirmation state | Fixed. Preview/app clicks only record an opened target candidate; concrete evidence is recorded only after the user selects the relevant criterion evidence ref. Covered by `StepDetailSlideIn.test.tsx` and logging tests. |
| D2 | Infeasible verify actions are offered unconditionally; with no handler `onOpenPreview?.()` is a silent no-op, so the button does nothing and the user is stuck. `run_tests` routes to `onVerifyFirst`, which can re-trigger an equally infeasible verify. | `dive/src/features/provocation/useProvocationActionResolver.ts`; `StepDetailSlideIn.tsx`; `useProductShellController.ts` | Fixed. Rust filters `allowedActionIds` from feasibility flags, card rendering uses only accepted actions, and the action resolver refuses no-op preview/app/test actions with status feedback. |
| D3 | The gate has no feasibility input, so it cannot tell "unverified by choice" from "unverifiable now". Plain approve is disabled and the only forward path is `위험 감수 승인` (write a risk reason) — wrong framing for a step that simply cannot be verified yet. | `dive/src/components/product/decisionGatePolicy.ts`; `dive/src/components/product/DecisionGate.tsx` | Fixed. `verificationFeasibility` feeds the policy and `verification_deferred` is a non-risk proceed path distinct from `continue_with_risk`. |
| D4 | Two contradictory definitions of "concrete evidence". The gate and agency use the strict `hasConcreteVerification` (needs `acceptanceCriterionConfirmed`), but `hasConcreteVerificationEvidence` and `summarizeVerificationEvidence().concreteEvidence` treat `appLaunched`/`previewChecked`/`userHasViewedPreview`/`userHasViewedTestResult` **alone** as concrete. The loose verdict flows into the approval provenance (`verificationState: "verified_with_evidence"`), the **export ledger**, and back into agency state — so one preview click (D1) records "verified" in the research ledger with no criterion check. Violates constitution II/IV. | `dive/src/features/provocation/verificationGrade.ts`; `verificationStatus.ts`; `logging.ts`; `dive/src/features/roadmap/agencyStatus.ts` | Fixed. Gate, verification status, provenance/logging, and roadmap agency state share the criterion-linked concrete-evidence helper; preview/app viewed signals alone do not produce `verified_with_evidence`. |
| D5 | The keystone `acceptanceCriterionConfirmed` is a bare checkbox toggle, not tied to any observation. Ticking it plus the D1-fabricated `appLaunched` passes even the strict gate with zero real verification. (Resets per step via the `step?.id` effect, so no cross-step leak.) | `dive/src/components/product/StepDetailSlideIn.tsx` criterion confirmation UI | Fixed. The bare checkbox is replaced by preview/app evidence-ref confirmation buttons disabled until that observation path has been opened, and concrete evidence still requires the linked criterion confirmation. |

## First Implementation Slice

1. Add Rust domain structs for `SupervisorContext`, `EvidenceRef`,
   `SupervisorDecision`, `SupervisorValidationResult`, and
   `SupervisorEvaluationLog`.
2. Add pure validation tests for missing evidence, unknown evidence ref,
   non-question, unknown action, duplicate, and `provoke=false`.
3. Add Pi sidecar `run_supervisor_turn` with `tools: []`.
4. Add P1 `provocation_agent_evaluate` command for `verify_entered`: DIVE
   computes the deterministic provoke gate and, only when it fires, calls the
   supervisor to generate the criterion-linked question (DEC-008/FR-023).
5. Map a valid `ai_self_report_only` decision into existing `ProvocationCard`.
6. Extend logging/export for supervisor evaluation before UI exposure logs.
7. Wire only the verification/final approval surface to the backend evaluator.
