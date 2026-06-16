# Contract: Verification Coach

## Purpose

Generate and validate step-specific verification guidance for the review panel.
This contract is guidance-only. It never marks a step complete by itself.

## Request

`verification_coach_generate`

```json
{
  "sessionId": 4,
  "projectId": 6,
  "cardId": 1,
  "planStepId": 6,
  "sourceUiMode": "work",
  "locale": "ko-KR",
  "step": {
    "title": "캐릭터 생성 구현",
    "summary": "플레이어가 캐릭터를 만들 수 있는 최소 기능을 구현한다.",
    "instruction": "캐릭터 생성 UI/흐름과 기본 상태 저장을 구현하세요.",
    "acceptanceCriteria": [
      {
        "criterionId": "AC-001",
        "text": "플레이어가 캐릭터를 만들 수 있다."
      }
    ]
  },
  "evidence": {
    "changedFiles": ["package.json", "src/main.js", "README.md"],
    "verificationKind": "manual",
    "verificationCommand": null,
    "verificationManualCheck": null,
    "testResult": "skipped",
    "aiClaimedDone": false,
    "previewAvailable": false,
    "appRunAvailable": false,
    "diffAvailable": true,
    "priorObservations": []
  }
}
```

## Response

```json
{
  "status": "shown",
  "eventId": "uuid",
  "guideVersion": 1,
  "guide": {
    "criterionSummary": "플레이어가 캐릭터를 만들 수 있다.",
    "recommendedChecks": [
      {
        "kind": "terminal",
        "label": "npm start로 CLI 실행",
        "instruction": "터미널에서 npm start를 실행하고 캐릭터 생성 메뉴를 선택하세요.",
        "expectedObservation": "이름, 직업, 성별 입력 후 저장 성공 메시지가 보여야 합니다."
      },
      {
        "kind": "file",
        "label": "저장 파일 확인",
        "instruction": "data/characters.json에 입력한 캐릭터가 저장됐는지 확인하세요.",
        "expectedObservation": "characters 배열에 새 캐릭터가 있어야 합니다."
      }
    ],
    "evidencePrompts": [
      "어떤 명령을 실행했나요?",
      "완료 기준을 만족한다고 판단한 화면, 출력, 파일 변화는 무엇인가요?"
    ]
  },
  "validation": {
    "outcome": "valid",
    "reasonCode": "ok",
    "evidenceRefs": ["criterion:AC-001", "changed_file:src/main.js"]
  },
  "model": "openai/gpt-5.4-mini",
  "latencyMs": 1200
}
```

## Unavailable Or Dropped Response

```json
{
  "status": "unavailable",
  "eventId": "uuid",
  "guideVersion": 1,
  "dropReason": "runtime_unavailable",
  "message": "현재 검증 안내를 만들 수 없습니다. Diff를 확인하거나 직접 관찰 결과를 남긴 뒤 승인 여부를 결정하세요."
}
```

## Validation Rules

- A shown guide must not claim the step is complete.
- A shown guide must be grounded in supplied criterion, changed-file, command,
  preview, test, or prior-observation evidence.
- A generated command may be shown only when it is already supplied by project
  evidence or is a safe inspection/run action inferred from changed project
  metadata.
- Generic advice such as "test the app" without a concrete action must be
  dropped.
- Runtime unavailable, timeout, malformed output, invalid evidence references,
  or unsafe guidance must produce no shown guide and must be logged.
