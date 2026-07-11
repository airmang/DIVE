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

# 재QA (2026-07-11)

## 실행 환경

- 대상 앱: `dive/src-tauri/target/release/bundle/macos/DIVE.app`
- 앱/실행 파일 빌드 시각: `2026-07-11 11:26:16 KST`
- 재QA 지시서 커밋: `8bc9f87` (`2026-07-11 11:25:54 KST`)
- 반영 핫픽스:
  - `68102db` — criterion ID 해석
  - `7c8363c` — PRD 인터뷰 단일 JSON 응답 계약
- 모델: `Anthropic: Claude Sonnet 5`

## 재저니 1 — 계획 게이트

**결과: PASS**

1. 기존 `qa-tier1-checklist` 프로젝트에서 `이 PRD로 계획 만들기`를 실행했다.
2. 약 30초 뒤 5개 단계가 있는 계획 초안 검토 화면에 도달했다.
3. `AC-001`/`AC-002` 식별자를 짧은 완료 기준으로 오인하는 차단은 재현되지 않았다.
4. 검토 답변과 승인 사유를 입력해 계획을 승인하고 실행 단계로 진행했다.

증거:

- `screenshots/reqa-s050-01-plan-draft.jpg`

## 재저니 2 — PRD 구조화

**결과: BLOCKED (미실행)**

- 재저니 3의 최종 다중 기준 관찰을 진행하던 중 릴리스 앱이 비정상 종료됐다.
- macOS 재실행 경고(`The last time you opened DIVE, it unexpectedly quit...`)가 나타났고, 같은 시각대에 `SIGABRT` 진단 보고서가 3개 생성됐다.
  - `~/Library/Logs/DiagnosticReports/dive-2026-07-11-114929.ips`
  - `~/Library/Logs/DiagnosticReports/dive-2026-07-11-114930.000.ips`
  - `~/Library/Logs/DiagnosticReports/dive-2026-07-11-114930.ips`
- 앱 재실행 뒤 QA 자동화 캡처 계층도 `failedToCreateImageDestination` 및 `failed to write kernel assets`로 복구되지 않아, 새 프로젝트 `qa-reqa-interview`에서 상세 답변 구조화와 혼합 provenance를 검증하지 못했다.
- 따라서 PRD 핫픽스의 PASS/FAIL은 이번 실행에서 판정하지 않는다.

## 재저니 3 — 실행·검증·성공 후 관찰

**결과: FAIL**

### F1 세션 시작 빈상태

**하위 결과: PASS**

- step-1 세션 시작 직후 `세션이 시작됐어요`와 `아직 대화가 없어요. 아래 입력창에 첫 메시지를 보내면 바로 시작됩니다.`가 표시됐다.
- 종전의 잘못된 `세션을 시작해 대화를 시작하세요` 빈상태는 재현되지 않았다.

증거:

- `screenshots/reqa-s056-01-session-empty.jpg`

### 구현·미리보기

- 계획의 step 1~4를 실행했다.
- step 3에서 할 일 `첫 번째`, `두 번째`, `세 번째`를 추가해 목록에 3개가 표시되는 것을 직접 확인했다.
- step 4에서 `토글 확인` 항목을 추가하고 클릭해 취소선이 표시되는 것을 직접 확인했다.
- 계획이 HTML/CSS 골격 단계에도 최종 완료 기준을 연결해 둔 탓에 step 1~2는 그 단계만으로 기준을 충족할 수 없었다. 두 단계는 실제 상태를 적은 위험 감수 승인으로 넘겼고, 해당 동작은 각각 step 3~4에서 구현·확인했다.

증거:

- `screenshots/reqa-s056-02-preview-toggle.jpg`

### F2 관찰 다중 연결

**하위 결과: BLOCKED (UI 노출 PASS, 기록 완료 미검증)**

- 기준 2개가 연결된 step-5 검토의 `점검·관찰` 화면에 도달했다.
- 기준별 체크박스 2개와 `이번 관찰을 관련 기준 모두에 적용` 버튼이 표시됐다.
- 초기 상태에서 기준 1개만 선택돼 있었고, 관찰 내용이 비어 있어 `관찰 증거로 기록` 버튼은 비활성화돼 있었다.
- `모두에 적용` 버튼을 누른 직후 앱/캡처 계층이 비정상 상태가 되어 두 기준 선택 결과와 관찰 1회 기록 완료를 검증하지 못했다.

증거:

- `screenshots/reqa-s056-03-multi-criterion-observation.jpg`

### D 성공 후 허위 오류 0

**하위 결과: FAIL**

1. step-1 구현이 성공하고 검토·승인까지 마쳤다.
2. 다음 단계로 이동한 직후 메인 화면에 다음 오류가 표시됐다.
   - `AI 응답이 일정 시간 동안 진행되지 않았습니다. 네트워크나 모델 상태를 확인한 뒤 다시 시도하세요.`
3. 이미 성공 처리된 응답 뒤에 stall timeout이 발생했으므로, 요구 조건인 `성공 후 90초 동안 stall timeout 오류 0회`는 관찰 시작 직후부터 충족될 수 없다.

증거:

- `screenshots/reqa-s052-01-stall-error-after-success.jpg`

## 재QA 판정

- 재저니 1: **PASS** — criterion ID 계획 게이트 핫픽스 확인
- 재저니 2: **BLOCKED** — 앱 비정상 종료 및 QA 제어 계층 장애로 미판정
- 재저니 3: **FAIL** — F1 PASS, F2 기록 완료 미검증, D 허위 stall 오류 재현
- 세 재저니 모두 PASS 조건을 충족하지 못했으므로 S-057 GO 판정 준비로 진행하지 않는다.
- QA 프로젝트는 삭제하지 않았고 커밋하지 않았다.

# 재QA 2차 (2026-07-11)

## 실행 환경

- 대상 앱: `dive/src-tauri/target/release/bundle/macos/DIVE.app`
- 앱/실행 파일 빌드 시각: `2026-07-11 13:50:26 KST`
- 실행 브랜치/HEAD: `011-conference-demo-readiness` / `d52c4e2`
- 필수 done 이벤트 픽스 `cd3b5b1` 포함 여부: 포함
- 모델: `Anthropic: Claude Sonnet 5`
- 종합 판정: **FAIL** — stall 재검과 다중 기준 관찰은 PASS했지만 PRD 구조화가 재시도 후에도 수렴하지 않음

실행 전 QA 캡처 서비스가 `failedToCreateImageDestination` 오류를 반환했으나,
캡처 서비스만 재시작한 뒤 target 경로 릴리스 앱의 보존 상태에 정상 재연결했다.
같은 날 13:41에 생성된 진단 보고서의 `procPath`는 `/Applications/DIVE.app`
rc.6였으며, 이번에 조작한 target 경로 앱의 크래시는 아니었다.

## 항목 1 — PRD 구조화 수렴

**결과: FAIL**

새 프로젝트 `qa-reqa2-interview`를 만들고 다음 정보를 포함한 상세 한국어
답변을 한 번에 전송했다.

- 사용자: 수업 시간에 개인 과제를 관리하는 중학생
- 범위: 할 일 입력·추가, 목록 표시, 완료 취소선 토글
- 비범위: 로그인, 서버 저장, 사용자 계정, 알림
- 제약: HTML/CSS/JavaScript, 별도 설치 없음, 로컬 브라우저, 한국어 UI
- 완료 기준: 3개 항목 표시, 클릭 시 취소선 표시·재클릭 시 해제

첫 시도는 `방금 답변을 PRD 항목으로 구조화하지 못했어요.`로 종료됐다.
`다시 구조화`를 1회 실행했지만 모든 PRD 필드가 다시 빈 상태로 남았다.
재시도 모델 응답에는 `모두 draft에 담았어요`라는 취지의 문장이 표시됐지만
실제 필드에는 패치가 반영되지 않아 UI 상태와 모델 자기보고가 불일치했다.

- 필드 반영: FAIL
- 같은 답변 재시도 수렴: FAIL
- 혼합 provenance: SKIP — 적용된 AI 패치가 없어 수동 수정과 혼합할 선행 조건을 만들 수 없었음

증거:

- `screenshots/reqa2-s053-01-structure-retry-fail.jpg`

## 항목 2 — 성공 후 stall 0회 재검

**결과: PASS**

1. 기존 `qa-tier1-checklist`의 step 5 검토에서 다중 기준 관찰 증거를 기록했다.
2. step 5를 승인해 화면이 `모든 단계 완료`와 `05 / 05 완료`로 전환되는 것을 확인했다.
3. 승인 직후부터 127초 동안 조작하지 않고 관찰했다.
4. `AI 응답이 일정 시간 동안 진행되지 않았습니다` 또는 stall timeout 오류는 0회였다.

done 이벤트 픽스 이후 성공한 실행이 후속 telemetry/progress 때문에 stall로
재분류되는 현상은 이 재검에서 재현되지 않았다.

증거:

- `screenshots/reqa2-s052-01-no-stall-127s.jpg`

## 항목 3 — 관찰 다중 연결 기록 완료

**결과: PASS**

1. `qa-tier1-checklist` step 5의 `점검·관찰` 화면에서 처음에는 AC-001만 선택돼 있었다.
2. `이번 관찰을 관련 기준 모두에 적용`을 눌러 AC-001과 AC-002 체크박스가 모두 선택된 것을 확인했다.
3. 미리보기를 다시 열어 할 일 `첫 번째`, `두 번째`, `세 번째`를 추가했고 목록에 3개가 표시되는 것을 확인했다.
4. 첫 번째 항목을 클릭해 취소선이 표시되는 것을 직접 확인했다.
5. 프리뷰 관찰에 연결하고 8자 이상의 관찰 내용을 입력한 뒤 `관찰 증거로 기록`을 1회 실행했다.
6. 화면에 `완료 기준에 연결된 관찰 증거가 기록되었습니다`가 표시됐고, step 5가 `검증 증거 있음`, 전체 계획이 `05 / 05 완료`로 전환됐다.

증거:

- `screenshots/reqa2-s056-01-multi-criterion-recorded.jpg`

## 재QA 2차 결론

- 항목 1 PRD 구조화 수렴: FAIL
- 항목 2 성공 후 stall 0회: PASS
- 항목 3 다중 기준 관찰 기록: PASS
- 1차 티어 + S-056 라이브 검증 완결 조건(3항목 모두 PASS): **미충족**
- `qa-reqa2-interview` 프로젝트는 삭제하지 않았다.
- 커밋하지 않았다.

# 재QA 3차 (2026-07-11)

## 실행 환경

- 대상 앱: `dive/src-tauri/target/release/bundle/macos/DIVE.app`
- 앱/실행 파일 빌드 시각: `2026-07-11 14:10:32 KST`
- 실행 브랜치/HEAD: `011-conference-demo-readiness` / `1c4f131`
- 반영 핫픽스: `1c4f131` — PRD 인터뷰 응답 토큰 상한 확대 및 truncation audit
- 모델: `Anthropic: Claude Sonnet 5`
- 재검 범위: 재QA 2차에서 실패한 PRD 상세 답변 1회 구조화 + 혼합 provenance
- 종합 판정: **PASS**

## 새 프로젝트 상세 답변 구조화

**결과: PASS**

새 프로젝트 `qa-reqa3-interview`를 만들고 사용자·범위·비범위·제약·완료
기준 2개를 포함한 상세 한국어 답변을 한 번 전송했다. 재시도 없이 다음
필드가 모두 실제 PRD 초안에 반영됐다.

- 목표: 중학생용 정적 체크리스트
- 의도 요약: 로그인·서버 저장 없이 브라우저에서 개인 과제 관리
- 범위: 할 일 입력·추가, 목록 표시, 완료 취소선 토글
- 하지 않을 일: 로그인, 서버 저장, 사용자 계정, 알림
- 제약: HTML/CSS/JavaScript, 별도 설치 없음, 로컬 브라우저, 한국어 UI
- 완료 기준: 할 일 3개 표시, 클릭 시 취소선 표시·재클릭 시 해제

화면에는 `방금 대화가 PRD 초안에 반영되었습니다.`가 표시됐고, 모든 필드의
실제 값이 접근성 트리에서도 확인됐다.

증거:

- `screenshots/reqa3-s053-01-fields-applied.jpg`

## 일부 필드 수동 수정 + 혼합 provenance

**결과: PASS**

AI가 반영한 필드 중 다음 두 항목을 학생 입력으로 직접 수정했다.

- 목표: `한국어` 요구를 명시하도록 문구 보완
- 범위: `빈 입력은 목록에 추가하지 않음` 추가

그 뒤 형태를 `정적 페이지`로 선택하고 기술 스택
`HTML/CSS/JavaScript`와 선택 이유를 직접 입력했다. PRD 확정 직전 확인
카드가 다음 혼합 문구를 표시했다.

- 제목: `AI와 함께 정리한 PRD입니다`
- 본문: `이 PRD는 AI와 당신이 함께 작성했습니다.`
- 학생 직접 작성 필드 열거: `목표, 범위`

수동 수정한 AI 반영 필드를 정확히 열거했고, 잘못된 AI 단독 작성 또는 학생
단독 작성 문구는 표시되지 않았다.

증거:

- `screenshots/reqa3-s053-02-mixed-provenance.jpg`

## 재QA 3차 결론

- 상세 한국어 답변 1회 필드 반영: PASS
- 반영 필드 수동 수정 후 혼합 provenance: PASS
- 재QA 2차에서 남은 PRD 구조화 결함: 재현되지 않음
- 재QA 2차의 stall 0회 PASS 및 다중 기준 관찰 PASS와 합쳐 잔여 3항목은 모두 PASS 상태다.
- `qa-reqa3-interview` 프로젝트는 삭제하지 않았고 PRD 확정 직전 상태로 보존했다.
- 커밋하지 않았다.
