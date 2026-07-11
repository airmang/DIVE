# 011 Tier 1 Live QA Run Log

- 실행일: 2026-07-11 (KST)
- 실행 대상: `dive/src-tauri/target/release/bundle/macos/DIVE.app`
- 앱/바이너리 수정 시각: 2026-07-11 08:49:19 KST
- 실행 방식: macOS 릴리스 `.app` 직접 조작 (dev 모드 미사용)
- 언어: 한국어
- 주 모델: OpenRouter `anthropic/claude-sonnet-5`
- 종합 판정: **FAIL** — 계획 초안 검토 화면에 도달하지 못해 후속 실행/검증 저니가 차단됨

## 저니 A — S-051 Sonnet 5 실행

**결과: FAIL**

- 모델 선택기 접근성 트리에서 상단 `Pi 검증됨` 그룹과 하단 `전체 카탈로그` 그룹을 확인했다.
- `전체 카탈로그`의 여러 모델에 `(Pi 미지원)` 마킹이 표시됐다.
- macOS 네이티브 팝업이 열린 동안 Computer Use가 메뉴의 접근성 트리만 반환하고 창 이미지는 반환하지 않아, 그룹이 펼쳐진 상태의 별도 JPEG는 남기지 못했다. 선택 완료 화면은 저장했다.
- `Anthropic: Claude Sonnet 5`를 선택했고, 실행 시 헤더에 다음 상태가 표시됐다.
  - `감독 PI 준비됨`
  - 제공자 `openrouter`
  - 모델 `anthropic/claude-sonnet-5`
- `model not found` 오류는 발생하지 않았다.
- 그러나 계획 생성 결과가 완료 기준 본문 대신 `AC-001`, `AC-002` 식별자만 짧다고 판정해 차단되었고, 계획 초안 검토 화면에는 도달하지 못했다. 따라서 저니 전체는 FAIL이다.

증거:

- `screenshots/s051-01-sonnet5-selected.jpg`
- `screenshots/s050-01-valid-criteria-false-block.jpg`

## 저니 B — S-050 계획 게이트

**결과: FAIL**

### 유효 기준 프로젝트: `qa-tier1-checklist`

입력한 완료 기준:

1. `완료한 항목을 클릭하면 취소선이 표시되고 다시 클릭하면 해제된다.`
2. `할 일 3개를 추가하면 목록에 3개 항목이 보인다.`

재현 절차:

1. 위 기준과 `정적 페이지 / HTML/CSS/JavaScript` 아키텍처로 PRD를 확정했다.
2. Sonnet 5로 `이 PRD로 계획 만들기`를 실행했다.
3. 약 40초 뒤 `완료 기준에 더 구체적인 확인 방법이 필요합니다` 차단 화면이 표시됐다.
4. 이슈 목록에는 `완료 기준이 너무 짧습니다: "AC-001"`, `"AC-002"`가 반복 표시됐다.
5. 같은 화면의 `통과하는 예시`에는 실제로 입력한 두 완료 기준과 거의 같은 문장이 표시됐다.
6. `짧은 JSON으로 다시 생성`을 실행했으나 약 30초 뒤 `계획 구조가 맞지 않습니다`로 다시 실패했다.

관찰:

- 사용자가 입력한 기준 본문은 충분히 구체적이지만, 계획 응답/검증 경계에서 criterion ID만 품질 검사에 전달된 것으로 보인다(추론).
- 재시도 결과는 `goal, intent summary, steps 구조가 부족합니다`였다.
- 반복 차단 없이 계획 초안에 도달해야 하는 PASS 조건을 충족하지 못했다.

증거:

- `screenshots/s050-01-valid-criteria-false-block.jpg`
- `screenshots/s050-02-short-json-structure-fail.jpg`

### 모호한 기준 프로젝트: `qa-tier1-junk`

**하위 결과: PASS(조기 차단) / 계획 게이트 검증은 SKIP**

- `적당히 잘`, `대충 괜찮게`를 완료 기준으로 입력했다.
- PRD 작성 화면이 `구체적이고 확인 가능한 완료 기준을 최소 2개 적어 주세요.`로 즉시 차단했다.
- 모호한 기준을 통과시키지 않은 점은 정상이다.
- 다만 PRD 확정 전 조기 차단이라 지시서가 요구한 계획 게이트의 한국어 이슈 + `통과하는 예시` 블록은 이 프로젝트에서 별도로 확인할 수 없었다.

증거:

- `screenshots/s050-03-junk-prd-early-block.jpg`

## 저니 C — S-053 PRD 인터뷰 투명성 + provenance

**결과: FAIL**

### 상세 답변 구조화

1. 사용자·범위·비범위·제약·완료 기준을 포함한 상세 한국어 답변을 Sonnet 5로 1회 전송했다.
2. 필드 반영에 실패했을 때 종전 한 줄 대신 다음 새 문구가 표시됐다.
   - `방금 답변을 PRD 항목으로 구조화하지 못했어요.`
   - `다시 구조화` 버튼
3. `다시 구조화`를 눌러 같은 답변으로 재시도했다.
4. 약 12초 뒤에도 모든 PRD 필드는 비어 있었고 같은 실패 문구/버튼으로 돌아왔다.

판정:

- 실패 투명성 UI: PASS
- 같은 답변 재시도 수렴: FAIL

증거:

- `screenshots/s053-01-structure-retry.jpg`
- `screenshots/s053-02-manual-provenance.jpg` (AI 구조화 실패 뒤 수동 입력으로 전환했을 때도 중립 문구가 표시된 보조 증거)

### 수동 작성 provenance: `qa-tier1-manual`

**하위 결과: PASS**

- AI 대화 전송 없이 목표, 의도 요약, 범위, 하지 않을 일, 제약, 완료 기준 2개, 형태, 기술 스택을 모두 손으로 입력했다.
- 확정 직전 카드가 `직접 작성한 PRD입니다`와 `이 PRD는 AI 요약이 아니라 당신이 직접 쓴 내용입니다.`로 표시됐다.
- 잘못된 `AI가 대화를 정리한 요약` 문구는 표시되지 않았다.

증거:

- `screenshots/s053-03-manual-only-provenance.jpg`

### 혼합 작성 provenance

**하위 결과: SKIP**

- 같은 답변 재구조화가 두 번 모두 실패해 적용된 AI 패치가 없었다.
- 따라서 `AI 패치 1회 적용 + 일부 필드 수동 수정` 선행 조건을 만들 수 없었다.

## 저니 D — S-052 성공 후 허위 오류 0

**결과: SKIP**

- 저니 B가 계획 초안 검토 화면 전에 반복 차단되어 계획 승인, step-1 실행, 구현 완료 상태에 도달할 수 없었다.
- 따라서 성공 후 90초 무조작 관찰 창을 시작하지 않았다.
- 이 실행에서는 stall timeout의 PASS/FAIL을 판정할 수 없다.

## 저니 E — 모델 오류 표면화

**결과: PASS**

재현 절차:

1. OpenRouter 카탈로그에서 `OpenAI: GPT-5 Chat (Pi 미지원)`을 선택했다.
2. 설정 화면에 `이 모델은 DIVE의 감독 Pi 런타임에서 실행할 수 없습니다.`가 즉시 표시됐다.
3. 계획 생성을 시도했다.
4. 메인 화면 헤더에 `런타임 사용 불가`와 함께 제공자/모델 원인이 표시됐다.
   - 제공자: `openrouter`
   - 모델: `openai/gpt-5-chat`
5. 조용한 PRD 복귀나 무응답은 발생하지 않았다.
6. 검증 후 주 모델을 `Anthropic: Claude Sonnet 5`로 복원했다.

증거:

- `screenshots/s051-02-unsupported-model-selected.jpg`
- `screenshots/s051-03-unsupported-runtime-block.jpg`

## 저니 F — S-056 UX polish

**결과: FAIL**

### F1 세션 시작 빈상태

**하위 결과: SKIP**

- 계획 승인이 되지 않아 새 step 세션을 시작할 수 없었다.

### F2 관찰 다중 연결

**하위 결과: SKIP**

- 기준 2개가 연결된 승인 step의 검토 화면에 도달하지 못했다.

### F3 프로젝트 보관

**하위 결과: PASS**

1. `qa-tier1-checklist`의 보관 버튼을 눌렀다.
2. 프로젝트가 일반 목록에서 사라지고 접힌 `보관됨 (1)` 섹션이 표시됐다.
3. 섹션을 펼치자 `qa-tier1-checklist ... 보관됨` 항목과 `보관 해제` 버튼이 나타났다.
4. 보관된 프로젝트를 클릭했을 때 기존 PRD/세션 화면이 정상적으로 열렸다.
5. `보관 해제`를 눌렀고 프로젝트가 일반 목록으로 복귀했다.

증거:

- `screenshots/s056-03-archived-collapsed.jpg`
- `screenshots/s056-04-archived-expanded.jpg`

## 미실행/보존 상태

- QA 프로젝트는 삭제하지 않았다.
- 생성된 프로젝트:
  - `qa-tier1-checklist`
  - `qa-tier1-manual`
  - `qa-tier1-junk`
- `qa-tier1-checklist`는 보관 검증 후 보관 해제했다.
- 최종 선택 모델은 `Anthropic: Claude Sonnet 5`다.
- 커밋하지 않았다.

## 핵심 결함 요약

1. **P0 계획 게이트 회귀**: 유효한 기준 본문 대신 `AC-001/AC-002` ID만 짧다고 판정하며 계획 초안 도달을 막는다.
2. **계획 복구 재시도 실패**: `짧은 JSON으로 다시 생성`도 필수 구조 누락으로 종료된다.
3. **PRD 구조화 재시도 미수렴**: 투명성 UI는 정상이나 같은 답변 재시도가 필드를 채우지 못한다.
