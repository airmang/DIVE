# 작업 02: 디자인 시스템 + 베이스 컴포넌트

## 컨텍스트
프로젝트 골격 위에 Tailwind 디자인 토큰과 베이스 컴포넌트를 설치합니다. 이후 모든 화면이 이 토큰만 사용해야 하므로, 명세 §2.3 컬러 팔레트를 정확히 옮기는 것이 중요합니다. 다크/라이트 두 모드 모두 토큰으로 정의.

## 이번 작업 범위
- Tailwind CSS 3 설정 + 디자인 토큰 (다크/라이트)
- shadcn/ui 베이스 컴포넌트 설치 (Button, Card, Badge, Input, Tabs, Tooltip, Dialog)
- 다크 모드 기본, 라이트 토글 (zustand 또는 jotai store)
- Pretendard Variable + JetBrains Mono 폰트 설정
- 데모 페이지 — 모든 베이스 컴포넌트 다크/라이트 양쪽 렌더 확인

## 명세 참조
- DIVE_SPEC.md §2.3 — 컬러 팔레트 (다크 + 라이트)
- DIVE_SPEC.md §2.6 — 다크/라이트 모드
- DIVE_SPEC.md §A.3 — 의사결정 권장 (Zustand, react-i18next)

## 단계

1. Tailwind CSS 3 설치 + 설정
2. `tailwind.config.ts` — 명세 §2.3의 모든 색상을 디자인 토큰으로 정의:
   - `bg.default`, `bg.panel`, `bg.panel2`, `border.default`
   - `fg.default`, `fg.muted`, `fg.subtle`
   - `accent.default` (#B19CD9), `accent.hover`, `accent.active`, `accent.subtle`
   - `success`, `warn`, `danger`, `info`
3. CSS 변수 기반 다크/라이트 — `:root.dark` / `:root.light`로 두 세트
4. shadcn/ui 초기화 (`pnpm dlx shadcn-ui init`) — DIVE 토큰으로 커스터마이즈
5. 베이스 컴포넌트 추가 — Button, Card, Badge, Input, Tabs, Tooltip, Dialog
6. 폰트 — Pretendard Variable (한글), JetBrains Mono (코드). 로컬 호스팅 또는 CDN
7. `useTheme` 훅 + 로컬스토리지 저장 + OS 자동 감지
8. 데모 페이지 (`/showcase`) — 모든 컴포넌트 + 토글 버튼

## 완료 조건
- [ ] 데모 페이지에서 모든 베이스 컴포넌트가 다크/라이트 양쪽 정상 렌더
- [ ] 임의 색상 코드(`#xxxxxx`) 미사용 — Tailwind 토큰만
- [ ] 다크/라이트 토글 즉시 반영
- [ ] OS 다크 모드 자동 감지
- [ ] 모든 컴포넌트가 키보드 접근 가능 (focus ring)
- [ ] `pnpm typecheck`, `pnpm lint` 통과

## 확인 질문
- shadcn/ui vs 자체 구현 — shadcn/ui 추천 (명세 §A.3 의도)
- 폰트 호스팅 — 로컬 vs CDN. 학교 PC 오프라인 가능성 고려해 로컬 추천?
- 라이트 모드 토글이 로딩 시 Flash of Unstyled Content (FOUC)를 일으키지 않게 처리할 방법?

## 작업 후
- DIVE_PROGRESS.md 1-2 `[x]`
- shadcn/ui 채택, 폰트 호스팅 방식 등은 ADR로
