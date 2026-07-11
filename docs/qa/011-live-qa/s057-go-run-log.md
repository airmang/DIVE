# S-057 GO 판정 실행 로그 — clean app-data E2E ×3

- 실행일: 2026-07-11 (KST)
- 브랜치/재실행 커밋: `011-conference-demo-readiness` / `dc9564a`
- 이전 실패 커밋: `a004a8a`
- 앱: `dive/src-tauri/target/release/bundle/macos/DIVE.app`
- 모델: OpenRouter `Anthropic: Claude Sonnet 5`
- macOS 실행 지시서 최종 판정: **GO 조건 충족 (3/3 PASS)**
- 전체 011 보고서 판정: 루트 검수 및 Windows 실기기 조건 확인 전까지 별도 갱신하지 않음

## 판정 요약

`dc9564a`의 deterministic in-turn structuring retry와 `max_tokens=8000`
수정이 반영된 release 앱으로 처음부터 재실행했다. 세 회차 모두 새 격리
app-data에서 시작해 PRD 상세 답변 1회 구조화, 아키텍처 확정, 계획 승인,
3개 Step 실행·검증·승인, 실제 미리보기 조작, 마지막 승인 후 90초 무조작
관찰을 완료했다. 세 회차 모두 차단·크래시·허위 stall 오류 없이 끝났다.

| 회차 | 격리 app-data | 결과 | 실패/중단 지점 | 허위 오류 |
| --- | --- | --- | --- | --- |
| 1 | `/tmp/dive-go-run-1` | PASS | 없음 — Step 3개 완료 후 90초 관찰 | 0 |
| 2 | `/tmp/dive-go-run-2` | PASS | 없음 — Step 3개 완료 후 90초 관찰 | 0 |
| 3 | `/tmp/dive-go-run-3` | PASS | 없음 — Step 3개 완료 후 90초 관찰 | 0 |

## 재실행 회차 1 — PASS

- 빈 사이드바와 `프로젝트가 없습니다`를 확인하고 `go-run-1`을 생성했다.
- PRD 상세 답변 1회로 목표·범위·비범위·제약·완료 기준 3개가 구조화됐다.
- 정적 페이지 + `HTML / CSS / JavaScript` 아키텍처를 확정하고 계획을
  승인했다.
- `step-1`, `step-2`, `step-2b`를 실행·검증·승인했다.
- 미리보기에서 `S057 테스트 할 일`을 입력하고 추가 버튼을 눌러 체크박스와
  함께 목록에 즉시 표시되는 것을 직접 확인했다.
- 마지막 승인 후 45초 + 45초 동안 접근성 트리에 변화가 없었고 새 오류가
  나타나지 않았다.

증거:

- ![회차 1 — 3개 Step 완료](./s057-run1-rerun-3steps-complete.jpg)
- ![회차 1 — 90초 관찰 후](./s057-run1-rerun-post90s.jpg)

## 재실행 회차 2 — PASS

- 새 app-data와 빈 프로젝트 폴더에서 `go-run-2`를 생성했다.
- PRD 1회 구조화, 정적 페이지 아키텍처 확정, 계획 승인을 완료했다.
- `step-1`, `step-2`, `step-3`을 실행·검증·승인했다.
- 계획 밖 `style.css`/`app.js` 선행 생성과 삭제 기능 제안은 승인하지 않고
  Step 범위에 맞게 재요청했다.
- 미리보기에서 `2회차 테스트 할 일`을 추가하고 체크박스를 눌러 완료 상태로
  전환되는 것을 직접 확인했다.
- 마지막 승인 후 90초 동안 UI 변화와 허위 오류가 없었다.

증거:

- ![회차 2 — 3개 Step 완료](./s057-run2-3steps-complete.jpg)
- ![회차 2 — 90초 관찰 후](./s057-run2-post90s.jpg)

## 재실행 회차 3 — PASS

- 새 app-data와 빈 프로젝트 폴더에서 `go-run-3`을 생성했다.
- PRD 1회 구조화, 정적 페이지 아키텍처 확정, 계획 승인을 완료했다.
- `step-1`, `step-2`, `step-3`을 실행·검증·승인했다.
- Step 3 미리보기에서 계획 밖 삭제 버튼이 생성된 것을 발견해 승인하지
  않고 제거를 재요청했다. 수정 후 미리보기를 다시 불러와 삭제 버튼이
  사라지고 할 일 추가만 동작하는 것을 확인했다.
- 마지막 승인 후 90초 동안 UI 변화와 허위 오류가 없었다.

증거:

- ![회차 3 — 3개 Step 완료](./s057-run3-3steps-complete.jpg)
- ![회차 3 — 90초 관찰 후](./s057-run3-post90s.jpg)

## 공통 비차단 복구 관찰

- 각 회차에서 초기 `asset://project/index.html` 미리보기 시도가 Tauri asset
  protocol 내부 로그에 오류를 남겼으나, `내 결과 보기`가 로컬 HTTP
  미리보기로 전환해 실제 조작이 가능했다. 사용자 여정은 차단되지 않았다.
- verification coach Pi 요청은 일부 회차에서 12초 타임아웃으로 오프라인
  수동 체크리스트를 표시했다. 이는 실제 타임아웃에 대한 명시적 복구였고,
  관찰 증거 기록과 승인은 정상 진행됐다.
- 세 회차 모두 마지막 승인 뒤 90초 관찰 구간에는 새 오류·stall 메시지·UI
  상태 변화가 없었다. 따라서 S-052가 겨냥한 성공 후 허위 stall 오류는 0회다.
- 위 두 복구 경로는 허위 오류로 세지 않았지만, 데모 노이즈를 줄이기 위한
  별도 후속 개선 후보로 남긴다.

## 이전 시도 — 회차 1 FAIL (`a004a8a`)

## 회차 1 — FAIL

### 격리 확인

- `DIVE_QA_APP_DATA_DIR=/tmp/dive-go-run-1`로 저장소의 release 앱 바이너리를
  직접 실행했다 (`open` 미사용).
- 앱 로그에 `QA app data directory override enabled
  path=/tmp/dive-go-run-1`이 기록됐다.
- 시작 화면의 사이드바가 비어 있고 `프로젝트가 없습니다`가 표시되는 것을
  확인했다.
- 빈 프로젝트 폴더
  `/Users/wilycastle/Code/projects/DIVE-2/qa-sandbox/go-run-1`을 만들고 프로젝트
  이름을 `go-run-1`로 생성했다.
- OpenRouter를 연결하고 모델을 `Anthropic: Claude Sonnet 5`로 선택했다.

### 재현 절차

1. 시작하기의 `요구사항 작성`을 눌러 PRD 인터뷰를 연다.
2. 정적 체크리스트 앱의 사용자·기능·완료 기준 3개·비범위·제약을 한 번의
   상세 답변으로 전송한다.
   - 기능: 할 일 추가, 완료/미완료 토글, `localStorage` 유지
   - 비범위: 로그인, 서버, 데이터베이스, 협업, 알림
   - 제약: 정적 페이지, HTML/CSS/바닐라 JavaScript,
     `index.html`/`style.css`/`app.js`, 외부 프레임워크·빌드 도구 없음
3. 구조화 응답을 기다린다.

### 실제 결과

- 화면에 모델 응답의 `assistantMessage` 내용이 일부 노출된 뒤 다음 오류가
  표시됐다.
  - `방금 답변을 PRD 항목으로 구조화하지 못했어요. 답변 내용은 사라지지
    않았으니, 다시 구조화를 눌러 이어가 주세요.`
- 앱은 `다시 구조화` 복구 버튼을 제시했으나, S-057 여정의 `상세 답변
  1회로 구조화` 조건을 이미 위반했으므로 회차를 실패 처리하고 중단했다.
- `InterviewTurn`의 저장 결과:
  - `outcome = not_structured`
  - `parse_failure_kind = no_json_truncated`
- `EventLog`의 `prd_patch_unstructured` 이벤트에도 같은
  `parse_failure_kind=no_json_truncated`와 모델
  `anthropic/claude-sonnet-5`가 기록됐다.

### 증거

![회차 1 PRD 구조화 실패](./s057-run1-prd-structuring-failure.jpg)

## 이전 시도의 미달 항목

- clean app-data 새 프로젝트 → PRD → 계획 → 3개 스텝 완료의 3회 연속 성공
- 회차 1의 상세 답변 1회 구조화
- 회차별 3개 스텝 실행·미리보기 조작·관찰 기록·승인
- 마지막 승인 후 90초 무조작 관찰과 허위 오류 0회 확인
- macOS release 앱 GO 판정
- 설치된 Windows demo build의 동일 GO 판정은 이번 macOS 지시서 실행
  범위에서도 새 증거가 추가되지 않았다.

## 이전 시도의 후속 재검증 조건 — 충족됨

`no_json_truncated`가 재발하지 않도록 PRD 인터뷰 출력 계약/토큰 한도를
수정·검증하고 release 앱을 다시 빌드한 뒤, 세 격리 app-data 디렉터리에서
처음부터 3회 연속 실행해야 한다. 실패한 회차를 `다시 구조화`로 이어서
완주하는 것은 이 출구 게이트의 연속 성공으로 계산하지 않는다.

이 조건은 `dc9564a` release 앱의 재실행 3회로 충족했다. 세 회차의
`InterviewTurn`은 모두 1회 구조화에 성공했고, `EventLog`에는 회차별
`prd_patch_proposed=1`, `prd_patch_applied=1`, `plan_generated=1`,
`plan_approved=1`, `plan_step_opened=3`이 기록됐다.
