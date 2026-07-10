# S-053 Research — PRD patch-failure opacity + provenance mislabeling (2026-07-10)

Read-only investigation feeding the S-053 design (P1-02, P1-03). Anchors use
function names; line refs verified pre-S-050-P2.

## P1-02 — silent patch failure

- Turn path: `PrdAuthoringBoard.submitAnswer` → `handleSubmitPrdAnswer`
  (`useProductShellController.ts:1382`) → IPC `workspace_prd_interview_turn` →
  `workspace_prd_interview_turn_impl` (`workspace_plan.rs:974`) →
  `run_prd_interview_turn` (:2183) with
  `build_prd_interview_system_prompt` (:2241) →
  `parse_prd_turn_response` (:2474).
- **Three model-side failures collapse to `patch: None`** (no JSON at all;
  JSON that deserializes as neither `RawPrdTurnResponse` nor `RawPrdPatch`) and
  the impl's else-branch (:1095-1097) leaves the default
  `validation_outcome:"none"` (:1020) — the SAME status as a benign net-zero
  patch. Policy rejection (`validate_prd_patch_for_draft` :2761 →
  `"rejected"`) and student-edit conflict (`"held_for_student"` :2737) are
  distinct on the wire but the UI ternary (`PrdAuthoringBoard.tsx:602-606`)
  renders everything except applied/held as one line
  (`prd.authoring.patch_rejected`, ko.json:144).
- **Student answer is dropped server-side** on failure: preserved only in the
  client `conversationTurns` localStorage bubble. The `InterviewTurn` struct
  (`models.rs:584`) is dead — no table, no DAO.
- **Audit hole**: EventLog PRD events (PRD_PATCH_PROPOSED/APPLIED/REJECTED,
  `event_log.rs:21-23`, payloads :1196-1257) fire only inside
  `if let Some(patch)` (:1030-1094). A structuring failure emits NOTHING — the
  exact turn type a supervision-research log must capture.
- Retry: no affordance exists; the needed context
  (`conversationTurns` + `prdConversationContext`) is already in component
  state — a "다시 구조화" button can re-invoke `onSubmitAnswer` with the last
  student turn.

## P1-03 — provenance

- Student edits: `markDraftStudentEdited` (`projectSpec.ts:425`) →
  `studentEditedFields` + `dirtyFields`; used ONLY by the conflict guard
  (`conflicts_with_student_edit` :2847), never for labeling. AI patch:
  `apply_prd_patch_to_draft` (:2631) → `dirty_fields` + ephemeral
  `applied_field_paths`/`last_patch_id`.
- Persisted per-field provenance exists ONLY for `AcceptanceCriterion.source`
  (`models.rs:281`) and `ArchitectureDecision.decision_source` (:488). The five
  scalar/list fields (goal, intentSummary, scope, nonGoals, constraints) have
  none, and the confirmed `ProjectSpec` snapshot (:510) drops
  student_edited_fields/dirty_fields/last_patch_id entirely.
- Mislabeling source: `buildPrdIntentCheckCard`
  (`PrdAuthoringBoard.tsx:309-326`) selects `prd.authoring.intent_check.*`
  ("이 PRD는 AI가 대화를 정리한 요약입니다", ko.json:161) on
  `validation.valid` alone — never checks whether any AI patch applied.

## Fix shapes (design input)

1. **Transparency**: add a distinct outcome (e.g. `not_structured`) when
   `parse_prd_turn_response` yields None; emit an auditable EventLog event for
   it (new event or REJECTED with `reason_codes:["no_structured_patch"]`);
   persist the raw student answer (revive `InterviewTurn` with a table);
   frontend renders parse-failure vs policy-rejected vs net-zero distinctly,
   with a "다시 구조화" retry re-sending the stored turn context and rejected
   reasons surfaced. **Complication**: `validation_outcome` is stringly-typed
   in three places — Rust `PrdPatchValidationOutcome` (`models.rs:304`), TS
   union (`types.ts:118`), EventLog outcome classifier
   (`event_log.rs:499-521`) — a new variant must touch all three, additively.
2. **Provenance**: `field_provenance: BTreeMap<String, ProvenanceSource>`
   (student / ai_patch / ai_suggestion_accepted) on `LiveProjectSpecDraft`
   (`models.rs:550`), carried onto `ProjectSpec` (:510) with serde-default
   (pattern: `architecture` :524); stamped at the three write sites (AI-patch
   apply, student edit path, architecture-card accept); one additive
   `field_provenance TEXT NOT NULL DEFAULT '{}'` column on the draft table
   (`schema.rs:237-238`) + DAO read/write (`prd.rs:36-37,96-129`); export
   (`artifacts.rs:129,143`) gains the field automatically — keep additive-only
   for `.dive/plan.json` stability. Make `buildPrdIntentCheckCard`
   provenance-aware: AI-summarized vs student-authored vs mixed framing;
   student-typed-everything gets a neutral confirm framing. Card stays a
   non-blocking nudge (Constitution).
