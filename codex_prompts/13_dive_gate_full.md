# 작업 13: DIVE 게이트 I·V·E 전체 + 카드 상태 머신

## 컨텍스트
v0.2의 핵심. D만 강제하던 게이트를 I·V·E 모두 강제로 확장. CardState enum 6개 상태와 전이 로직을 백엔드에 박아 넣습니다. 명세 §4.6 그림 4(상태 머신)와 동일하게.

## 이번 작업 범위
- CardState 전이 로직 (Rust) — Decomposed → Instructed → Verifying → Verified / Rejected → ... → Extended
- I 단계 게이트 — 카드 instruction 비어 있으면 V로 진행 불가
- V 단계 게이트 — I에서 도구 호출 1회 이상 + 사용자 [검증 시작] 클릭 후 진입
- E 단계 게이트 — 모든 카드 Verified여야 활성
- 한 번에 한 카드만 I 단계 가능 (다중 진행 불가)
- AI 시스템 프롬프트에 현재 카드 컨텍스트 주입
- 게이트 위반 시 백엔드 거절 + 프론트 가이드

## 명세 참조
- DIVE_SPEC.md §4.3 — I 단계
- DIVE_SPEC.md §4.4 — V 단계 (자체검증 절차는 작업 14)
- DIVE_SPEC.md §4.5 — E 단계
- DIVE_SPEC.md §4.6 — 카드 상태 머신
- DIVE_SPEC.md §4.7 — 게이트 강제의 구현 원칙
- DIVE_SPEC.md §10.3 — CardState enum
- 와이어프레임 — `images/16_state_machine.png`

## 단계

1. `src-tauri/src/dive/state_machine.rs` — CardState 전이 함수:
   ```rust
   pub fn transition(card: &Card, action: Action) -> Result<CardState>
   ```
   허용 전이만 정의 (그림 4과 일치). 부적합 전이는 `GateError::InvalidTransition`.
2. `src-tauri/src/dive/gate.rs` 확장 — I·V·E 게이트 검사 함수
3. 시스템 프롬프트 빌더 — 현재 카드 정보를 컨텍스트로 주입:
   ```
   현재 작업 중인 카드: {title}
   이 카드의 의도: {instruction}
   다른 카드는 건드리지 마세요.
   ```
4. 카드 클릭 시 동작 (작업 07의 `onClick`을 실제 라우팅으로):
   - 대기 카드 클릭 → I 단계 진입 (`transition(Decomposed → Instructed)`), 채팅 컨텍스트 전환
   - 진행 중 카드 클릭 → 해당 카드 채팅 컨텍스트로 전환
   - 검증 중 카드 클릭 → V 검증 화면 (작업 14)
   - 완료 카드 클릭 → 슬라이드 인 코드 탭
5. I → V 진입 — 채팅에 [검증 시작] 버튼 (도구 호출 1회 이상 후 노출)
6. E 단계 — 모든 카드 Verified 시 자동 활성, [통합 점검] / [새 카드 추가] / [세션 마무리] 옵션
7. 한 번에 한 카드만 I — 다른 카드가 Instructed 상태이면 새 I 진입 차단 (또는 자동 닫기 후 진입)
8. 거부 (Rejected) — V 거부 시 카드 → Rejected, [지시 수정] 버튼으로 다시 I 진입 가능
9. 통합 테스트 — 카드 1개의 D → I → V → 다음 카드 ... → 모든 V 통과 → E 활성

## 완료 조건
- [ ] 카드 상태 전이가 명세 §4.6 그림과 일치
- [ ] 부적합 전이 시 백엔드에서 거절 (UI disable만 X)
- [ ] I 단계 — instruction 비어 있으면 V로 못 감
- [ ] V 단계 — 도구 호출 1회 이상 + [검증 시작] 클릭 시에만 진입
- [ ] 한 번에 한 카드만 Instructed
- [ ] E 단계 — 모든 카드 Verified 시 활성
- [ ] AI 시스템 프롬프트에 현재 카드 정보 포함됨 (로그로 확인 가능)
- [ ] `cargo test` 상태 머신 단위 테스트 통과

## 확인 질문
- "한 번에 한 카드" 정책 — 다른 카드 클릭 시 현재 진행 중 카드 자동 닫기 vs 경고. 자동 닫기 추천 (UX 부드럽게)
- I 단계에서 사용자가 카드 제목 변경 — 허용? 명세에는 없음. 허용 추천 (수정 자유롭게).
- V 거부 후 코드 롤백 — 자동 (체크포인트 복원) vs 수동. 수동 추천 (사용자가 명시 결정). 작업 15 체크포인트와 연동.
- E 단계에서 새 카드 추가 시 — 그 카드만 D → I → V 다시? 또는 다음 세션? 같은 세션 내에서 가능 추천 (시나리오 B 패턴)

## 작업 후
- DIVE_PROGRESS.md 3-1 `[x]`
- ADR: 카드 동시 진행 정책, V 거부 후 롤백 정책, E 단계 추가 카드 흐름
