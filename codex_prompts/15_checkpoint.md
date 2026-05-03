# 작업 15: 체크포인트 (git2-rs)

## 컨텍스트
실패의 가역성 보장. 명세 §6.5에 따라 git 커밋 기반 체크포인트 시스템 구현. 사용자 git 사용 여부와 독립적으로 `.dive/git/` 베어 저장소 사용.

## 이번 작업 범위
- `git2-rs` (`vendored-libgit2` feature) 의존성 추가
- 체크포인트 생성 — 자동 트리거(단계 전환) + 수동 트리거(Ctrl+S)
- 체크포인트 복원 (현재 상태 자동 저장 후 이동)
- 타임라인 UI (슬라이드 인 패널 하단 또는 메뉴)
- Checkpoint 종류 — init, auto, manual, current

## 명세 참조
- DIVE_SPEC.md §6.5 — 체크포인트 시스템 전체
- DIVE_SPEC.md §5.8 — 체크포인트 타임라인
- DIVE_SPEC.md §10.2 — Checkpoint 테이블
- 와이어프레임 — `images/08_checkpoint_timeline.png`

## 단계

1. `Cargo.toml` — `git2 = { version = "0.18", features = ["vendored-libgit2"] }`
2. `src-tauri/src/checkpoint/mod.rs` — 추상화:
   ```rust
   pub fn init_repo(project_root: &Path) -> Result<()>  // .dive/git/ 베어
   pub fn create_checkpoint(kind: Kind, label: &str) -> Result<Sha>
   pub fn list_checkpoints(session_id: &str) -> Result<Vec<Checkpoint>>
   pub fn restore(sha: &Sha) -> Result<()>
   ```
3. 자동 트리거 — DIVE 단계 전환 시 자동 호출:
   - D 통과 (모든 카드 작성 + 사용자 [다음])
   - I 통과 (각 카드별)
   - V 통과 (각 카드별, 최종 승인 시)
   - V 거부 (Rejected 상태 변경 시 — 복구용)
   - E 진입
4. 수동 트리거 — `Ctrl+S` 단축키 + 슬라이드 인 패널 [지금 저장] 버튼, 라벨 입력 다이얼로그
5. 커밋 메시지 자동 생성 — `[D 통과] 카드 4개 작성`, `[I 통과] 입력 폼 만들기 - localStorage 추가` 등
6. 복원 동작:
   - [복원] 클릭 → "현재 상태도 자동 저장 후 이동합니다" 확인 모달
   - 자동으로 manual 체크포인트 생성 (라벨: "복원 직전")
   - 선택 시점으로 git checkout
   - UI 상태 동기화 — 워크맵 카드 상태, 활성 카드 등 (Card·Workmap 테이블도 함께 복원되어야 하므로 SQLite 트랜잭션 필요)
7. UI — 타임라인 (`src/components/checkpoint/Timeline.tsx`):
   - 슬라이드 인 패널 하단 또는 별도 모달
   - 각 점 = 체크포인트
   - 호버 툴팁 (시각, 종류, 변경 파일)
   - 클릭 시 미리보기 모달 + [복원] 버튼
8. SQLite Checkpoint 테이블에 메타 저장 — git_sha, kind, label, session_id, card_id

## 완료 조건
- [ ] 단계 전환 시 자동 체크포인트 생성됨 (SQLite + git 둘 다)
- [ ] Ctrl+S 수동 체크포인트 동작
- [ ] 타임라인에 init·auto·manual·current 4종 시각 구분
- [ ] [복원] 시 — 현재 상태 자동 저장 → 선택 시점 checkout → UI 갱신
- [ ] 복원 후 워크맵·카드 상태도 그 시점으로
- [ ] 빈 프로젝트에서도 init 체크포인트 생성됨
- [ ] `cargo test` 통과

## 확인 질문
- SQLite와 git을 동기화 — Card·Workmap 상태도 복원되어야 함. 방법 (a) SQLite 스냅샷도 git에 함께 커밋 vs (b) 체크포인트마다 SQLite도 별도 백업. (a) 추천 — 단일 트랜잭션, 깔끔.
- `.dive/git/` 격리 — 사용자 자체 git이 있을 때 (`.git/`) 충돌 없이 공존하는지. `.dive/git/` 베어이고 working tree는 프로젝트 루트라서 OK일 듯, 검증 필요.
- 빈 파일 변경(스페이스만) 시 — 체크포인트 만들지 vs 무시. 무시 추천 (노이즈 감소).
- 체크포인트 N개 후 정리 — 일정 수 초과 시 오래된 것 압축? 일단 무제한, 후속 작업.

## 작업 후
- DIVE_PROGRESS.md 3-3 `[x]`
- ADR: SQLite-git 동기화 방식, 사용자 git과 공존 검증, 체크포인트 정리 정책
