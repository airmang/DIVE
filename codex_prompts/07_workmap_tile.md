# 작업 07: 워크맵 카드 타일 + 가로 띠

## 컨텍스트
워크맵 가로 띠를 실제로 채웁니다. 카드 타일 컴포넌트 (4가지 상태) + 가로 스크롤 + 펼침/접힘 양쪽 모드 + + 카드 추가 버튼. 명세 §5.2의 가장 중요한 부분.

## 이번 작업 범위
- 카드 타일 컴포넌트 (200×130px 펼침, 200×36px 접힘)
- 4가지 상태 시각 구분 (대기·진행 중·검증 중·완료)
- 좌측 컬러 바 + 상태 아이콘 + 제목 + DIVE 진행 점 + 한 줄 요약
- 가로 스크롤 컨테이너 (Shift+휠, ← → 화살표)
- + 카드 추가 버튼 (현재는 D 단계 가정, 추후 게이트와 연동)
- 카드 클릭 동작 (5.2.3) — 콘솔 로그만, 실제 라우팅은 작업 12에서

## 명세 참조
- DIVE_SPEC.md §5.2 — 워크맵 (하단 가로 띠) 전체
- 와이어프레임 — `images/03_workmap_tiles.png`
- DIVE_SPEC.md §10.3 — CardState enum

## 단계

1. `src/components/workmap/types.ts` — `Card` 타입 (id, title, state, dive_done, summary 등)
2. `src/components/workmap/CardTile.tsx`:
   - props: `card`, `expanded` (boolean), `onClick`
   - 펼침 모드 (200×130) — 컬러 바, 상태 아이콘 (○ ◐ ◑ ✓), 제목 (말줄임), DIVE 진행 점 4개, 한 줄 요약
   - 접힘 모드 (200×36) — 컬러 바, 작은 아이콘, 제목, "DIVE"/"DI"/"D" 텍스트
   - 상태별 색상 매핑 — 대기=blue, 진행=accent, 검증=warn, 완료=success
3. `src/components/workmap/HorizontalScroll.tsx` — Shift+휠 가로 변환, 좌우 화살표 버튼, 페이드 효과 (CSS gradient)
4. `src/components/workmap/AddCardButton.tsx` — D 단계에서만 활성, 클릭 시 인라인 입력 (제목만 받음)
5. `src/components/workmap/ProgressBar.tsx` — 워크맵 헤더의 진행률 바 + 숫자 라벨
6. `src/components/workmap/Workmap.tsx` 갱신 — 하드코딩 데이터로 카드 4~6개 표시, 펼침/접힘 모두 시각 검증
7. 데모 데이터 (`src/lib/demo-cards.ts`) — Phase 2 동안 백엔드 연동 전 더미 데이터로 진행
8. `useWorkmapStore` (Zustand) — 카드 목록·진행률·current_stage 상태 관리

## 완료 조건
- [ ] 명세 그림 6과 동일한 4종 카드 시각 구분
- [ ] 펼침/접힘 토글 시 카드 형태 변경
- [ ] 가로 스크롤 동작 (Shift+휠, ← → 버튼)
- [ ] 6개+ 카드일 때 우측 페이드 + 화살표 노출
- [ ] + 카드 추가 클릭 시 인라인 입력 → 새 카드 추가 (메모리만)
- [ ] 카드 클릭 시 콘솔 로그 (어느 카드 클릭됐는지)
- [ ] 모든 텍스트 한국어, 호칭 없음
- [ ] Tailwind 토큰만 사용
- [ ] `pnpm typecheck`, `pnpm lint` 통과

## 확인 질문
- 가로 스크롤 라이브러리 — 자체 구현 vs `react-horizontal-scrolling-menu` 등
- 카드 드래그 정렬 (명세 §4.2 카드 데이터) — 이번 작업 X, 작업 13 (게이트 전체)에서?
- 한 줄 요약이 너무 길면 — 말줄임? 줄바꿈? 말줄임 추천 (높이 일관성)

## 작업 후
- DIVE_PROGRESS.md 2-1 `[x]`
- ADR: 가로 스크롤 라이브러리 결정, 카드 드래그 정렬 시점
