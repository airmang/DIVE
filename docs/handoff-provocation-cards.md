# Handoff: DIVE Contextual Review Cards

## Summary

Implement a Contextual Review Cards layer for DIVE Editor. The feature should help novice users notice risky, vague, overbroad, repeated, or unverified moments while working with an AI coding agent on a real project.

This is not a separate classroom quiz, flashcard deck, worksheet, score system, or gamified learning module. Cards must stay attached to DIVE's real workflow:

Decompose -> Instruct -> Execute -> Verify -> Extend.

## Product Claim Boundary

Safe claim:

- DIVE makes supervision checkpoints visible and helps users review AI coding work with evidence.

Do not claim:

- DIVE proves supervision skill improvement.
- DIVE improves critical thinking.
- DIVE eliminates AI overreliance.
- DIVE trains metacognition.

Those claims require empirical validation and should not appear in product UI.

## Design Principle

A review card must have:

- Context: it appears near the relevant artifact.
- Evidence: it states why it appeared.
- Short challenge: it nudges inspection, not obedience.
- Action: the user can immediately do something useful.
- Log: exposure and response are stored for later analysis.

Evidence examples:

- "계획에 검증 단계 없음"
- "`package.json` changed despite a UI-only goal"
- "AI claimed done but no preview/test evidence exists"
- "Same terminal error appeared 3 times"

## Non-Goals

Do not implement:

- Quiz screens
- Fake practice exercises
- Flashcard decks
- Scores, badges, or levels
- Generic warnings without state evidence
- Chatbot-style advice messages
- Forced long-form reflection on every approval

## Terminology

Internal name:

- Provocation Card

Student-facing Korean names:

- 검토 카드
- 확인 필요 카드

Avoid:

- 도발카드 as the main student-facing label unless the product intentionally adopts that tone.

## MVP Card Types

### oversized_scope

Purpose: prevent one-shot prompting and excessive task scope.

Trigger:

- Goal or prompt appears to contain multiple independent features.
- One AI instruction is being used for a project-level or multi-feature request.

Actions:

- 기능으로 나누기
- 첫 기능만 요청하기
- 그대로 진행

### missing_acceptance_criteria

Purpose: make goals verifiable.

Trigger:

- Goal exists but no observable completion criteria exist.
- Goal is vague: "좋게", "예쁘게", "잘 되게", "개선해줘", "완성해줘".

Actions:

- 완료 기준 추가
- 예시 입력/출력 추가
- 그대로 진행

### missing_verification_step

Purpose: prevent implementation-only plans.

Trigger:

- AI plan or roadmap has build/change steps but no run/test/preview/check/verify step.

Actions:

- 검증 단계 추가
- 테스트/프리뷰 확인 추가
- 그대로 승인

### diff_scope_drift

Purpose: catch unrelated or risky changes.

Trigger:

- Changed files do not align with goal/current feature.
- High-risk files changed: package.json, lockfiles, env/config, auth, db schema, routing, deleted files.

Actions:

- 파일별 Diff 보기
- AI에게 변경 이유 묻기
- 관련 없는 변경 되돌리기
- 위험 감수하고 수용

### ai_self_report_only

Purpose: separate AI claims from verification evidence.

Trigger:

- AI claims completion.
- No diff review, app launch, preview check, manual check, or automated test result exists.

Actions:

- 앱 실행
- 프리뷰 확인
- 테스트 실행
- 미검증 상태로 승인

### regeneration_loop

Purpose: break repeated "fix it again" loops.

Trigger:

- Same or similar error appears repeatedly.
- User asks for fixes repeatedly without rollback, repro steps, or narrowed scope.

Actions:

- 마지막 변경 되돌리기
- 에러 로그 정리
- 재현 단계 만들기
- 범위 줄여 다시 요청

## Scaffold Modes

Guided:

- Show title, message, evidence, explanation, and actions.
- Include one sentence explaining why the card matters.
- Still operate on real project context.

Standard:

- Show title, concise message, evidence chips, and actions.
- Keep explanations collapsed or visually secondary by default.

Expert:

- Only show high-risk or high-confidence cards by default.
- Prefer compact banners.
- Do not interrupt low-risk work.

## Priority Rule

Show at most one primary card per context by default.

Priority:

1. diff_scope_drift with high-risk files
2. ai_self_report_only at final approval
3. regeneration_loop
4. missing_verification_step
5. missing_acceptance_criteria
6. oversized_scope

Secondary cards can be collapsed under "추가 확인 필요" only if this fits the existing UI.

## Required Data Context

The rule engine should consume a context object. It should not directly depend on UI components.

Expected context fields:

- mode
- stage
- goalText
- acceptanceCriteria
- currentFeatureTitle
- promptDraft
- planSteps
- changedFiles
- targetFiles
- verification state
- recent terminal/errors
- retry count
- user viewed diff/preview/test result flags

If some fields do not exist yet, create adapter functions and integrate with available state.

## Verification Labels

The app must distinguish:

- AI 자가보고만 있음
- Diff 확인됨
- 앱 실행 확인됨
- 수동 프리뷰 확인됨
- 자동 테스트 통과
- 외부 테스트 없음
- 실패했지만 승인됨
- 위험을 감수하고 승인됨

Do not show "verified" based only on AI self-report.

## Logging Schema

Log these events:

- provocation.card_shown
- provocation.action_clicked
- provocation.dismissed
- provocation.marked_irrelevant
- provocation.continued_with_risk

Minimum fields:

- eventId
- timestamp
- projectId/sessionId if available
- featureId/taskId if available
- cardId
- cardType
- stage
- severity
- mode
- evidence summary
- selected action if any
- reason if required
- verification status at event time

Use the existing local EventLog/export path when possible. Keep data privacy-safe and local.

## UI Integration Points

Preferred locations:

- Goal / Decompose area: oversized_scope, missing_acceptance_criteria
- Prompt planner / Instruct area: oversized_scope, missing_acceptance_criteria
- Plan approval area: missing_verification_step
- Tool permission / diff preview: diff_scope_drift
- Verify gate / final approval: ai_self_report_only, missing_verification_step
- Terminal / error / retry area: regeneration_loop
- Extend / integration area: ai_self_report_only when integration evidence is missing

Cards must not appear as normal chat messages.

## Implementation Checklist

- No quiz, worksheet, card deck, badge, score, or artificial exercise screen.
- Cards are contextual annotations, not chat messages.
- Every card has evidence.
- Rule engine is deterministic.
- AI self-report is not treated as verification.
- High-risk continue requires a short reason.
- Normal approvals are not blocked by long reflection.
- Guided, Standard, and Expert differ by scaffold density, not separate product flows.
- Logs include card_shown, action_clicked, dismissed, marked_irrelevant, and continued_with_risk.
- Unit tests exist for all six MVP card triggers.
- Export path includes card logs.
- No UI copy overclaims supervision skill improvement.

## Verification Commands

Run from the repository root:

```bash
pnpm --dir dive typecheck
pnpm --dir dive test:unit
pnpm --dir dive lint
pnpm --dir dive build
```
