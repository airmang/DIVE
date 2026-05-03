# 작업 19: 온보딩 모달

## 컨텍스트
첫 실행 경험. 명세 §5.7에 따라 미니멀 1단계 — 프로바이더 연결만 요구하고 DIVE 4단계 설명·튜토리얼은 강제하지 않음. 학습은 사용 중 자연스럽게 (게이트 차단 가이드가 첫 학습 지점).

## 이번 작업 범위
- 첫 실행 감지 (한 번만)
- 프로바이더 선택 모달 (Anthropic / OpenAI / ChatGPT 구독 / OpenRouter / Custom)
- 각 프로바이더별 등록 흐름 (API 키 입력, OpenRouter는 메인 또는 자식)
- "나중에 설정" 옵션 (단, 미연결 시 채팅 비활성)

## 명세 참조
- DIVE_SPEC.md §5.7 — 온보딩 (첫 실행)
- 와이어프레임 — `images/10_onboarding.png`

## 단계

1. `src-tauri/src/state/first_run.rs` — 첫 실행 감지:
   - SQLite의 `app_state` 테이블 (id INTEGER, key TEXT, value TEXT)
   - `first_run_completed` 키로 표시
2. `src/components/onboarding/OnboardingModal.tsx`:
   - 첫 실행 시 자동 표시 (z-index 가장 높게)
   - DIVE 로고 + 짧은 인삿말 ("AI 코딩 에이전트와 함께 시작하기")
   - 프로바이더 4종 카드 (Anthropic, OpenAI, ChatGPT 구독, OpenRouter)
   - 각 카드 — 이름 + 한 줄 설명 + [연결하기] 버튼
   - 하단 "나중에 설정" 작은 링크
3. 각 프로바이더 등록 흐름:
   - Anthropic / OpenAI / OpenRouter (학생용 자식 키 또는 본인 키) — API 키 입력 필드 + 검증 (API 호출로 인증 확인)
   - ChatGPT 구독 — Codex OAuth (작업 25, 이번에는 placeholder + "v0.3 예정" 표시)
   - 각 단계 후 keyring 저장
4. 등록 성공 시 — 토스트 "프로바이더 연결됨", 모달 닫음, 메인 화면 진입
5. "나중에 설정" — 모달 닫고 메인 진입, 단 채팅 입력란 disabled + 안내 ("프로바이더를 먼저 연결하세요" + [설정 열기] 버튼)
6. 학생용 — QR 스캔 옵션 (작업 17 KeyImport 재사용) — 모달 안에 [수업용 키 등록] 버튼
7. 다국어 — i18n 리소스 (작업 31에서 확장, 이번 작업은 ko 위주)
8. 단위 테스트 — 첫 실행 감지 로직, 모달 표시·닫기 동작

## 완료 조건
- [ ] 첫 실행 시 모달 자동 표시
- [ ] 두 번째 실행부터 모달 미표시
- [ ] Anthropic 키 등록 → 실제 API 호출로 검증 → keyring 저장 → 메인 진입
- [ ] OpenAI 키 등록 동작
- [ ] OpenRouter 키 등록 동작
- [ ] ChatGPT 구독 항목은 "v0.3 예정"으로 비활성
- [ ] "나중에 설정" 시 채팅 disabled + 안내
- [ ] 학생용 QR 스캔 진입점 동작
- [ ] `cargo test` 통과

## 확인 질문
- 프로바이더 검증 호출 — 작은 테스트 메시지(빈 prompt 또는 "ping") vs 모델 목록 fetch. 모델 목록 추천 (메시지 전송이 비용 발생).
- ChatGPT 구독 placeholder 어떻게 보일지 — 회색 + "v0.3 예정" 뱃지. 클릭 시 "이 기능은 v0.3 (10월)에 추가됩니다" 토스트.
- 키 입력 후 검증 실패 시 — 친절한 에러 메시지 ("API 키가 유효하지 않습니다. 다시 확인해주세요" + [재시도] 버튼)
- 학생용 QR 모드 — 별도 [학생용] 버튼? 또는 OpenRouter 카드 안에 [QR 스캔] 옵션? 후자 추천 (UI 단순).

## 작업 후
- DIVE_PROGRESS.md 4-1 `[x]`
- ADR: 프로바이더 검증 방식, 학생용 진입점 위치
