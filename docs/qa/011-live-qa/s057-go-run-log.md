# S-057 GO 판정 실행 로그 — clean app-data E2E ×3

- 실행일: 2026-07-11 (KST)
- 브랜치/커밋: `011-conference-demo-readiness` / `a004a8a`
- 앱: `dive/src-tauri/target/release/bundle/macos/DIVE.app`
- 모델: OpenRouter `Anthropic: Claude Sonnet 5`
- 최종 판정: **NO-GO 유지**

## 판정 요약

회차 1이 PRD 인터뷰의 1회 구조화 조건에서 실패했다. 실행 지시서의
판정 기준은 한 회차라도 실패하면 NO-GO를 유지하도록 규정하므로 회차 2와
3은 실행하지 않았다. 3회 연속 성공 조건은 달성되지 않았다.

| 회차 | 격리 app-data | 결과 | 실패/중단 지점 | 허위 오류 |
| --- | --- | --- | --- | --- |
| 1 | `/tmp/dive-go-run-1` | FAIL | 상세 답변 1회 구조화 실패 (`no_json_truncated`) | 해당 없음 — PRD 단계에서 중단 |
| 2 | `/tmp/dive-go-run-2` | 미실행 | 회차 1 실패로 GO 조건 달성 불가 | 미관찰 |
| 3 | `/tmp/dive-go-run-3` | 미실행 | 회차 1 실패로 GO 조건 달성 불가 | 미관찰 |

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

## 미달 항목

- clean app-data 새 프로젝트 → PRD → 계획 → 3개 스텝 완료의 3회 연속 성공
- 회차 1의 상세 답변 1회 구조화
- 회차별 3개 스텝 실행·미리보기 조작·관찰 기록·승인
- 마지막 승인 후 90초 무조작 관찰과 허위 오류 0회 확인
- macOS release 앱 GO 판정
- 설치된 Windows demo build의 동일 GO 판정은 이번 macOS 지시서 실행
  범위에서도 새 증거가 추가되지 않았다.

## 후속 재검증 조건

`no_json_truncated`가 재발하지 않도록 PRD 인터뷰 출력 계약/토큰 한도를
수정·검증하고 release 앱을 다시 빌드한 뒤, 세 격리 app-data 디렉터리에서
처음부터 3회 연속 실행해야 한다. 실패한 회차를 `다시 구조화`로 이어서
완주하는 것은 이 출구 게이트의 연속 성공으로 계산하지 않는다.
