# 작업 06: 메인 셸 레이아웃 (사이드바·채팅·하단 워크맵)

## 컨텍스트
명세 §5.1의 핵심 레이아웃을 빈 컨테이너로 구현. 워크맵·채팅·슬라이드 인 패널의 실제 내용물은 다음 작업들에서 채워 넣습니다. 이 작업이 끝나면 명세 그림 5와 동일한 시각적 골격이 보여야 합니다.

## 이번 작업 범위
- 좌측 사이드바 (280px, 고정) — 빈 셸 (프로젝트 목록 X)
- 상단 우측 채팅 영역 — 빈 셸 (메시지 스트림 X, 입력란만)
- 하단 워크맵 가로 띠 — 펼침 220px / 접힘 80px 토글 (빈 컨테이너)
- 우측 슬라이드 인 패널 — 호출 버튼 자리만, 실제 패널 없음
- 다크/라이트 토글 동작
- React Router 또는 단일 페이지 (현 단계는 단일 페이지로 충분)
- Zustand store — `useUIStore` (워크맵 collapsed, 테마 등)

## 명세 참조
- DIVE_SPEC.md §5.1 — 메인 화면 레이아웃
- DIVE_SPEC.md §5.2.5 — 워크맵 펼침/접힘
- 와이어프레임 — `images/01_main_layout.png` (펼침), `images/02_workmap_collapsed.png` (접힘)

## 단계

1. `src/stores/ui.ts` — Zustand store:
   ```ts
   { workmapCollapsed: boolean, theme: 'dark' | 'light',
     toggleWorkmap: () => void, setTheme: (t) => void }
   ```
2. `src/components/sidebar/Sidebar.tsx` — 280px 고정, DIVE 로고 (파스텔 보라), 빈 프로젝트 목록 placeholder, 빈 세션 목록 placeholder, 하단 프로바이더 미니 카드 (placeholder)
3. `src/components/chat/ChatArea.tsx` — flex-1 가변, 헤더 ("대화" + 현재 카드 표시 자리), 메시지 영역 (빈), 입력란 (메시지 입력 필드 + 모델 셀렉터 칩 placeholder + ✨ 버튼), 우상단 [코드/미리보기] 토글 버튼
4. `src/components/workmap/Workmap.tsx` — 화면 폭 전체, 높이 220px (펼침) / 80px (접힘), 200ms transition, 우측 [▼]/[▲] 토글, 헤더 (제목·진행률 placeholder), 빈 카드 영역
5. `src/components/slide-in/SlideInPanel.tsx` — placeholder. 실제 내용은 작업 11에서.
6. 메인 레이아웃 (`src/App.tsx` 또는 `src/pages/MainPage.tsx`):
   ```
   ┌──────────┬─────────────────────────┐
   │ Sidebar  │ ChatArea                │
   │ 280px    │ flex-1                  │
   │ 고정      │                         │
   ├──────────┴─────────────────────────┤
   │ Workmap (220px or 80px)            │
   └────────────────────────────────────┘
   ```
   slide-in panel은 z-index로 채팅 위에 떠 있는 형태 (이번 작업은 placeholder)
7. 다크/라이트 토글 — 사이드바 하단 또는 설정 메뉴 (단순 토글)
8. 키보드 단축키 — `Ctrl+W` 워크맵 토글 (명세 §12.2)

## 완료 조건
- [ ] `pnpm tauri:dev`로 띄웠을 때 명세 그림 5와 동일한 레이아웃
- [ ] 워크맵 토글 클릭 시 220px ↔ 80px 전환 (200ms 트랜지션)
- [ ] `Ctrl+W` 단축키 동작
- [ ] 다크 → 라이트 토글 즉시 반영
- [ ] 임의 색상 코드 없음 — Tailwind 토큰만
- [ ] 모든 사용자 노출 텍스트가 한국어, 호칭 없음
- [ ] `pnpm typecheck`, `pnpm lint` 통과

## 확인 질문
- 슬라이드 인 패널이 채팅 위에 떠 있나, 채팅 영역을 좁히나? — 명세 §5.4 검토. 와이어프레임 `04_slide_in_panel.png`를 보면 채팅을 좁히는 형태. 그대로 가는 게 맞는지?
- 모델 셀렉터 칩의 위치 — 입력란 좌측 하단? 우측? 와이어프레임 확인.
- 화면 폭이 좁을 때 (1366px 이하 노트북) 레이아웃 유지 가능한가? 사이드바 접기 옵션이 필요한가?

## 작업 후
- DIVE_PROGRESS.md 1-6 `[x]`
- ADR: 슬라이드 인 패널 동작 방식, 작은 화면 대응
- **Phase 1 완료. Phase 2 시작 전 사용자 점검 시점.**
