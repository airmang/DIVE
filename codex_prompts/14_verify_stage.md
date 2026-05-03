# 작업 14: V 단계 — AI 자체검증 + 사용자 최종 승인

## 컨텍스트
명세 §4.4의 핵심. V는 단순 "다음" 클릭이 아니라 2단계 게이트 — AI가 자체 검증 후 사용자가 최종 승인. 이 작업이 끝나면 검증 절차의 외화가 완성됩니다.

## 이번 작업 범위
- AI 자체 검증 절차 (Rust)
  - 카드 의도와 변경 코드 일치 분석
  - 실행 가능한 코드면 적절한 도구로 실행 후 결과 확인
  - verify_log 구조화 저장
- 검증 결과 화면 (UI)
- 사용자 [최종 승인] / [거부 — I로 돌아가기]
- 거부 시 Rejected 상태 + 지시 수정 후 재진입

## 명세 참조
- DIVE_SPEC.md §4.4 — V 단계 전체
- DIVE_SPEC.md §10.2 — Card.verify_log 필드

## 단계

1. `src-tauri/src/dive/verify.rs` — AI 자체 검증:
   ```rust
   pub async fn verify_card(card: &Card, agent: &Agent) -> Result<VerifyLog>
   ```
2. 검증 절차:
   - 시스템 프롬프트 — 카드 의도 + 변경된 파일 목록 + 검증 요청
   - AI에게 다음 항목 자체 검증 요청 (구조화 출력):
     - 의도와 코드 일치 여부
     - 실행 가능 코드면 실행 후 결과
     - 발견한 문제 목록
     - 권장 조치
3. `VerifyLog` 구조:
   ```rust
   struct VerifyLog {
       checks: Vec<CheckItem>,    // 항목별 통과 여부
       issues: Vec<String>,       // 발견 문제
       recommendations: Vec<String>,
       executed_outputs: Vec<String>, // 실행 결과
   }
   ```
4. 실행 검증 (실행 가능 코드만):
   - 웹 프로젝트 — 미리보기 캡처 (puppeteer-rs 또는 Tauri webview 캡처)
   - Python — `python script.py` 실행 후 stdout/stderr (블록리스트 통과 후)
   - 그 외 — 정적 분석만
5. UI — V 검증 화면:
   - 채팅 영역에 검증 결과 시스템 메시지로 표시
   - 항목별 ✓ / ✗ + 색상 구분
   - 실행 결과 미리보기 (스크린샷 또는 텍스트)
   - [최종 승인] / [거부 — 지시 수정으로 돌아가기] 버튼
6. 거부 시 동작:
   - 카드 → Rejected 상태
   - 사용자가 instruction 수정 → 다시 [검증 시작] 가능
   - 코드 롤백은 별도 (체크포인트 복원, 작업 15)
7. 거부 사유 입력 (옵션) — AI에게 전달되어 재시도 시 참고

## 완료 조건
- [ ] [검증 시작] 클릭 시 AI 자체 검증 실행
- [ ] 검증 결과가 채팅에 구조화 표시 (항목별 ✓/✗)
- [ ] 웹 프로젝트면 미리보기가 슬라이드 인 패널에 갱신
- [ ] [최종 승인] → 카드 Verified, 다음 카드 가능
- [ ] [거부] → Rejected, instruction 수정 후 재시도 가능
- [ ] verify_log가 SQLite에 저장됨
- [ ] `cargo test` 통과

## 확인 질문
- 검증 실패가 "치명적"인지 "경미"인지 구분 — AI가 자체 분류? 사용자 판단? 사용자 추천 (시각적으로 표시만)
- 실행 검증의 보안 — 실행 시간 제한, 메모리 제한, 네트워크 차단? 일단 시간 제한(30초)만, 그 외는 작업 16 블록리스트와 통합
- 미리보기 캡처 방법 — Tauri webview API (`window.capture`) vs headless 브라우저. webview 추천 (간단)
- AI 자체 검증의 거짓 양성 — AI가 통과로 판단해도 실제론 버그. 사용자 최종 승인이 안전망. 그러나 사용자가 너무 빠르게 승인하면? UI에 검증 결과를 충분히 노출 (스크롤 필요한 정보는 펼쳐 보여주기)

## 작업 후
- DIVE_PROGRESS.md 3-2 `[x]`
- ADR: 실행 검증 보안 정책, 미리보기 캡처 방법
