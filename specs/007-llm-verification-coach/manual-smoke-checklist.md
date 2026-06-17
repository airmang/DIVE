# Manual Smoke Checklist: 006 + 007

Use this checklist while running the Tauri app locally to validate the merged
Sarkar provocation expansion and verification coach behavior.

## Setup

- [ ] Start the app with `pnpm tauri:dev` from `dive/`.
- [ ] Open or create a PRD-backed project that can reach plan review and step
      review.
- [ ] Use Work Mode first; repeat key surfaces in Guided Mode only if copy or
      density looks wrong.
- [ ] Confirm the Pi/provider path is available for shown-card and coach
      scenarios.

## 006: Expanded Supervisor Cards

- [ ] Plan draft review: open a draft with at least one weak verification or
      criterion-linkage issue.
- [ ] Confirm at most one plan-draft review card appears near the plan approval
      artifact, not in chat.
- [ ] Confirm the card cites concrete DIVE evidence such as plan steps,
      criteria, or verification refs.
- [ ] Confirm a well-scoped draft with covered criteria stays silent or shows no
      static fallback card.
- [ ] Diff-ready review: complete a step with changed files, including a file
      that appears outside expected scope.
- [ ] Confirm at most one diff-ready card appears near the changed-work review
      area and asks whether the changed files belong to the current goal.
- [ ] Retry-loop review: produce the same normalized verification or terminal
      failure twice for the same active step.
- [ ] Confirm no retry-loop card appears after the first failure, and at most one
      appears after the second matching failure.
- [ ] Confirm recovery, successful verification, or a materially different
      failure resets or changes the retry-loop evidence.
- [ ] Confirm existing add-step scope expansion cards still use SupervisorAgent
      behavior and do not fall back to static frontend cards.

## 007: Verification Coach

- [ ] Open a CLI/manual/no-preview step in review, such as the DIVE_TEST9 Step 1
      flow.
- [ ] Confirm the review panel shows verification coach guidance instead of an
      empty review state.
- [ ] Confirm guidance names the relevant completion criterion and suggests
      concrete CLI, file, preview, or inspection checks.
- [ ] Confirm the coach guidance is visually distinct from review cards and is
      not presented as verification evidence by itself.
- [ ] Record a criterion-linked user observation.
- [ ] Confirm normal approval becomes available only when there is automated
      pass evidence or a criterion-linked observation.
- [ ] Approve with observation evidence and confirm the result is treated as
      `verified_with_evidence`.
- [ ] Try approving a guided step without automated pass evidence or observation
      evidence.
- [ ] Confirm the decision gate explains missing evidence and routes to risk or
      deferral instead of evidence-backed approval.
- [ ] Use risk approval with a reason and confirm the result is treated as
      `unverified_risk_accepted`.
- [ ] For a step with passing automated verification, confirm approval still
      works without manual observation.
- [ ] Simulate or observe provider/coach unavailability and confirm the panel
      shows a concise unavailable state while request-changes, risk, and deferral
      paths remain usable.

## Plan Mutation UX

- [ ] Start a normal chat message that asks for new implementation work not
      covered by the approved plan.
- [ ] Confirm the add-step review modal appears, and choosing the plan-area
      action opens/focuses the Plan dashboard instead of sending the chat turn.
- [ ] Confirm the add-step form is prefilled with the routed draft and no plan
      mutation is saved until the Add step button is clicked.
- [ ] In the Plan dashboard add-step area, type a plain-language request and use
      Draft from request.
- [ ] Confirm the LLM-generated draft fills the editable form, step numbering is
      assigned only after saving, and scope-expansion review cards still appear
      near the add-step area when evidence indicates possible scope expansion.

## Rollback UX

- [ ] Restore an earlier checkpoint from Recovery & Undo.
- [ ] Confirm the success message says project files were restored, a
      pre-restore backup was saved, and chat history remains as the
      audit/research log.
- [ ] Confirm a system marker appears in the current chat timeline explaining
      that files were restored while chat history was retained.

## Audit And Export

- [ ] Complete one coached step with observation-backed approval.
- [ ] Complete one coached step with risk-accepted approval.
- [ ] Export the session.
- [ ] Confirm export distinguishes supervisor evaluations, coach guidance,
      observation evidence, AI self-report, approval provenance, and step
      verification evidence.
- [ ] Confirm exported payloads do not include raw secrets, OAuth tokens, API
      keys, private environment dumps, raw diffs, or raw observation text where
      redaction/hashing is expected.

## UX Regression Pass

- [ ] Review cards appear near their relevant artifact and never as ordinary
      assistant chat messages.
- [ ] Work Mode stays low-friction for low-risk states.
- [ ] Guided Mode may provide more explanation but remains tied to the real
      project workflow.
- [ ] Korean user-facing review-card language uses `검토 카드` or
      `확인 필요 카드`, not `도발카드` as the primary label.
- [ ] No generic AI warning appears without concrete project evidence.
