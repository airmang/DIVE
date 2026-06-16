# Contract: Step Observation Evidence

## Purpose

Capture user-observed evidence from the review panel and connect it to the
approval gate without treating AI guidance as verification.

## Observation Input

```json
{
  "sessionId": 4,
  "cardId": 1,
  "planStepId": 6,
  "guideVersion": 1,
  "evidenceKind": "terminal_observation",
  "criterionIds": ["AC-001"],
  "observationText": "npm start 실행 후 캐릭터 이름/직업/성별을 입력했고 저장 성공 메시지를 확인했다. data/characters.json에도 저장됐다."
}
```

## Derived Verification Status

When observation text is non-empty and linked to a criterion, the review panel
may add a concrete status:

```json
{
  "id": "manual_observation",
  "label": "직접 관찰 확인",
  "evidenceBacked": true,
  "tone": "success",
  "source": "user_observation"
}
```

## Approval Provenance Extension

```json
{
  "schemaVersion": 1,
  "verificationState": "verified_with_evidence",
  "statusIds": ["manual_observation"],
  "evidenceSummary": {
    "concreteEvidence": true,
    "aiSelfReport": false,
    "automatedTestsPassed": false,
    "externalTestRun": false,
    "testResult": "skipped",
    "manualEvidenceCount": 1,
    "evidenceLabels": ["직접 관찰 확인"],
    "observationIds": ["obs-uuid"]
  },
  "approvalOutcome": "approved"
}
```

## Rules

- Observation text without criterion linkage is useful context but not concrete
  approval evidence.
- AI guidance text must never be copied into observation evidence unless the
  student explicitly writes their own observation.
- Risk approval with observation text but no criterion linkage remains
  `unverified_risk_accepted`.
- Failed automated tests remain failure evidence unless the student explicitly
  accepts risk.
