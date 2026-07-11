# S-053 Design — PRD Interview Transparency + Field Provenance (011 Theme 4, P1-02 + P1-03)

**Stage**: wily `dive-2` S-053 (STG-3c95426ceaad) · **Status**: Designed 2026-07-11
**Evidence**: `research-s053.md`. Two defects on one surface: (a) model
structuring failures collapse into the same `"none"` outcome as a benign
net-zero patch, the student's answer is dropped server-side, and **no EventLog
event fires at all** for a structuring failure (an audit hole in the very log
the conference paper's architecture contribution rests on); (b) five scalar PRD
fields carry no provenance and the intent-check card claims "AI가 대화를
정리한 요약" on `validation.valid` alone — human editing exported as AI
summarization.

## Decisions

### D1 — Distinct `not_structured` outcome + auditable turn record

- `parse_prd_turn_response` yielding `patch: None` no longer leaves the
  default `"none"`: the impl's else-branch sets a new additive outcome
  `not_structured`. The parse layer's two failure kinds (no JSON object found
  vs JSON that deserializes as neither shape) are preserved as a
  `parse_failure_kind` detail (`no_json` | `undecodable_json`).
- The outcome is stringly-typed in three places — Rust
  `PrdPatchValidationOutcome` (`models.rs:304`), TS union (`types.ts:118`),
  EventLog outcome classifier (`event_log.rs:499-521`) — all three get the
  additive variant; old rows/snapshots keep deserializing.
- **Audit hole closed**: a structuring failure now emits
  `prd_patch_unstructured` (new event, payload: turn_id, draft_id,
  parse_failure_kind, model/provider echo — no raw answer text in the
  EventLog, consistent with existing PRD event redaction posture).
- **Student answer persisted**: the dead `InterviewTurn` struct
  (`models.rs:584`) gets its table (additive migration) — turn_id, draft_id,
  student answer text, outcome, parse_failure_kind, created_at — written for
  EVERY interview turn (applied ones too), local-DB only (not exported raw).
  This is the durable research-data record of the conversation the PRD came
  from, and it is what the retry re-sends.

### D2 — Frontend: three distinguishable states + "다시 구조화" retry

`PrdAuthoringBoard` stops rendering one rejection line for everything:

- `not_structured` → honest cause copy ("답변을 구조화하지 못했습니다" 계열,
  parse-failure framing, 원문은 보존됨을 명시) + a **다시 구조화** button that
  re-invokes `onSubmitAnswer` with the stored turn (context =
  `prdConversationTurns` already in component state; server-side record from
  D1 is the durable backup).
- `rejected` → surface the actual `rejected_reasons` (validation codes →
  localized copy), visually distinct from a parse failure.
- `none` (true net-zero) → honest "변경할 내용이 없었습니다" framing, not the
  generic rejection line.
- `held_for_student` unchanged.

### D3 — Field-level provenance + honest intent-check card

- `field_provenance: BTreeMap<String, ProvenanceSource>` on
  `LiveProjectSpecDraft` (serde-default), carried onto the confirmed
  `ProjectSpec` snapshot (pattern: `architecture` field), values
  `student | ai_patch | ai_suggestion_accepted`.
- Stamp sites (from research seam list): `apply_prd_patch_to_draft` per
  applied field path (`ai_patch`); the student edit path feeding
  `markDraftStudentEdited` (`student`); the architecture proposal-accept path
  (`ai_suggestion_accepted`). Criteria/architecture keep their existing
  richer `source` enums — the map covers the five scalar/list fields.
- DB: one additive `field_provenance TEXT NOT NULL DEFAULT '{}'` column on
  the live-draft table + DAO read/write. Version snapshots are JSON blobs —
  serde-default covers old rows. Export gains the field additively
  (`.dive/plan.json` stays backward-readable).
- `buildPrdIntentCheckCard` becomes provenance-aware with three framings:
  all-AI ("AI가 대화를 정리한 요약"), all-student (neutral confirm framing —
  no AI attribution), mixed (명시적 혼합 문구: 어떤 필드가 학생 작성인지
  요약). Card remains a non-blocking nudge (Constitution; no gate).
- EventLog/export: PRD lifecycle events gain the per-field provenance summary
  where they already carry `applied_field_paths` (additive keys only).

## Non-goals / preserve

- No LLM in any of this — deterministic outcomes, deterministic provenance.
- `held_for_student` conflict semantics unchanged; patch validation rules
  unchanged; no new blocking gates anywhere (transparency, not friction).
- Export schema changes additive-only; no removal/rename of existing fields.
- The interview prompt (`build_prd_interview_system_prompt`) is out of scope
  (improving patch yield is a model-behavior question — this stage makes
  failures honest, not impossible).

## Acceptance mapping

1. Parse failure, policy rejection, and net-zero render three different
   messages with correct recovery affordances (Vitest + live).
2. One detailed Korean answer → real patch: provider integration test
   (dev-mock provider fixture that returns a valid patch; plus the
   `not_structured` path fixture).
3. Manual-entry PRD no longer shows the AI-summarized card; provenance
   survives confirm/export (Rust + Vitest + live).
4. `prd_patch_unstructured` events + interview-turn rows exist for failure
   turns (integration test).
5. Local CI green + release-app live re-QA of the interview surface.

## Phases

- **P1**: Rust — `not_structured` outcome (3 places), `prd_patch_unstructured`
  EventLog event, `interview_turns` table + DAO + writes.
- **P2**: frontend — three-state rendering + 다시 구조화 retry + i18n.
- **P3**: provenance — map + stamps + DB column + intent-check framings +
  export additions.
- **P4**: local CI + rebuild + live re-QA (ko), stage evidence.
