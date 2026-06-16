# Research: LLM Verification Coach

## Decision: Coach Guidance Is Not A Review Card

**Decision**: Implement verification coaching as a separate guidance surface in
step review, not as a Sarkar/provocation review-card event.

**Rationale**: Review cards ask grounded supervision questions. The coach's job
is different: explain how to verify the current step. Keeping them separate
prevents the coach from becoming a static provocation fallback and reduces
merge risk with the in-flight 006 Sarkar expansion.

**Alternatives considered**:

- Add a new review-card type for verification coaching. Rejected because it
  blurs "question/provocation" with "procedure/guidance".
- Put guidance into chat. Rejected because review decisions should stay near the
  step artifact and approval gate.

## Decision: Reuse Pi Sidecar Zero-Tool Guidance Path

**Decision**: Generate guidance through the existing provider/Pi runtime
capability path with no model-visible tools.

**Rationale**: DIVE v2 requires Pi-only runtime behavior. The existing
SupervisorAgent path already demonstrates how to run a zero-tool Pi turn,
capture model/latency/usage, and fail closed to no UI artifact on unavailable
runtime.

**Alternatives considered**:

- Call the provider directly from frontend. Rejected because it bypasses the
  Rust-owned supervision boundary and local ledger.
- Add legacy provider fallback. Rejected by constitution.

## Decision: Validate Guidance Before Display

**Decision**: Validate generated guidance for actionability, evidence support,
safety, criterion alignment, and bounded size before display.

**Rationale**: The coach should never invent a command or imply confidence from
missing evidence. Invalid guidance should become a concise unavailable state and
an EventLog record, not a generic fallback warning.

**Alternatives considered**:

- Display raw LLM text with a disclaimer. Rejected because novice users may
  treat it as authority.
- Require perfect structured output before showing anything. Rejected because
  partial but valid procedure steps can still help when bounded and validated.

## Decision: Store MVP State In EventLog And Approval Provenance

**Decision**: Use EventLog for durable guidance/observation audit records and
existing approval provenance/step mapping fields for final evidence summaries.

**Rationale**: The feature needs research reconstruction more than random access
CRUD. Existing export already emits EventLog, card approval provenance, and
step mapping verification evidence.

**Alternatives considered**:

- Add `VerificationGuide` and `ObservationEvidence` tables. Deferred until
  multiple historical guides need first-class retrieval.
- Store only frontend state. Rejected because observations and guidance must be
  exportable.

## Decision: Criterion-Linked User Observation Counts As Concrete Evidence

**Decision**: A student-authored observation counts as concrete verification
only when linked to a completion criterion. Preview/app launch alone and AI
guidance alone remain non-evidence.

**Rationale**: This matches the existing verification-grade rule that mere
opening/looking is insufficient. It also covers CLI/file-output projects that
have no preview/test surface.

**Alternatives considered**:

- Treat any observation text as evidence. Rejected because unlinked notes do
  not prove the acceptance criterion.
- Require automated tests for normal approval. Rejected because many novice
  projects and early steps are CLI/manual.

## Decision: 006 Compatibility By Separation

**Decision**: Use separate names and components: `verification_coach.*` ledger
events and a `VerificationCoachPanel`, while 006 remains responsible for
expanded review-card events.

**Rationale**: 006 is already in progress on a separate branch. Keeping write
sets and concepts separate reduces conflict. Shared files such as
`StepDetailSlideIn.tsx` should integrate by composition rather than embedding
all logic directly.

**Alternatives considered**:

- Wait for 006 to merge before planning. Rejected because 007 can define an
  independent contract now.
