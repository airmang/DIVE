# S-057 GO 판정 실행 지시서 — clean app-data E2E ×3 (2026-07-11)

보고서(`docs/qa/conference-readiness-2026-07-10/report.md`)의 GO 조건:
**완전히 새 앱 데이터 디렉터리에서 새 프로젝트 생성부터 3단계 완료까지
3회 연속 성공, 허위 오류 0회.**

## 실행 방법 (격리 app-data)

각 회차마다 새 격리 디렉터리로 앱을 직접 실행한다 (`open` 금지 — env가
전달되지 않음):

```bash
DIVE_QA_APP_DATA_DIR=/tmp/dive-go-run-1 \
  ~/DIVE-2/dive/src-tauri/target/release/bundle/macos/DIVE.app/Contents/MacOS/dive
```

회차 2·3은 `-2`, `-3`으로. 격리 확인: 사이드바가 비어 있고 기존 프로젝트가
안 보여야 한다. provider 설정은 회차마다 새로 (OpenRouter 키 입력, 모델
`Anthropic: Claude Sonnet 5`).

## 회차당 여정 (보고서 GO 기준 그대로)

1. 새 프로젝트 생성 (`go-run-N`).
2. PRD 인터뷰: 상세 답변 1회로 구조화 (정적 체크리스트 앱) → 아키텍처
   확정 (정적 페이지 + HTML/CSS/JS) → PRD 확정.
3. 계획 생성 → 초안 검토 → 승인.
4. **3개 스텝 이상 실행·검증·승인** (편집 권한 승인 → 미리보기 실제 조작 →
   관찰 기록 → 승인).
5. 마지막 승인 후 **90초 무조작 관찰** — 허위 오류 0회.

## 판정 기준

- 3회 전부: 차단·크래시·허위 오류 없이 완주 → **GO**.
- 1회라도 실패: 실패 지점·재현 절차 기록, NO-GO 유지, 미달 항목 명시.

## 기록

- `docs/qa/011-live-qa/s057-go-run-log.md`에 회차별 결과 + 스크린샷
  (`s057-runN-*` 접두사). 커밋 금지 — 루트가 검수 후 커밋하고 보고서
  판정을 갱신한다.
- 회차 사이에 앱을 완전히 종료할 것 (격리 디렉터리 교체를 위해).
