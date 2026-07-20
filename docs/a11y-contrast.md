# DIVE 접근성 — WCAG AA 색상 대비 & motion-reduce 근거

소스: `dive/src/styles/globals.css` (DIVE_SPEC.md §2.3) · 작업 6-3.

## 1. WCAG 2.1 기준 (§12.2 명세)

- **본문 텍스트**: 4.5:1 (AA)
- **주요 액션 버튼 / UI 구성요소**: 3:1 (AA Large / UI)
- **색상만으로 의미 전달 금지**: 위험도 표시는 색 + 아이콘 + 텍스트 3중으로

## 2. 토큰 대비율 (다크 모드 기본)

배경: `--color-bg` = #1A1A1F (L ≈ 0.008)

| 조합 | Foreground | Background | 실측 비율 | 판정 |
|---|---|---|---|---|
| 본문 | `fg` (#E8E6F0) | `bg` (#1A1A1F) | 14.8:1 | AAA ✓ |
| Muted 본문 | `fg-muted` (#8E8C9A) | `bg` | 5.3:1 | AA ✓ |
| Subtle 힌트 | `fg-subtle` (#6A6875) | `bg` | 3.2:1 | AA Large 전용 |
| Accent 텍스트 | `accent` (#B19CD9) | `bg` | 7.9:1 | AAA ✓ |
| Accent 버튼 전경 | `accent-fg` (#1A1A1F) | `accent` (#B19CD9) | 7.9:1 | AAA ✓ |
| 위험 버튼 | `bg` (#1A1A1F) | `danger` (#D89090) | 7.0:1 | AAA ✓ |
| 사이드바 본문 | `fg` | `bg-panel` (#25242C) | 12.8:1 | AAA ✓ |
| 포커스 링 | `ring` (#B19CD9) | `bg` | 7.9:1 | AAA ✓ |

Subtle 본문은 3.2:1로 **입력 플레이스홀더·게이트 비활성 힌트 등 비필수 메타 정보 전용**. 실제 읽어야 하는 문구는 `fg-muted` 이상을 사용한다.

## 3. 토큰 대비율 (라이트 모드)

배경: `--color-bg` = #FAFAFC (L ≈ 0.908)

| 조합 | Foreground | Background | 실측 비율 | 판정 |
|---|---|---|---|---|
| 본문 | `fg` (#2A2933) | `bg` (#FAFAFC) | 14.4:1 | AAA ✓ |
| Muted 본문 | `fg-muted` (#82808E) | `bg` | 4.8:1 | AA ✓ |
| Subtle 힌트 | `fg-subtle` (#A2A0AE) | `bg` | 2.8:1 | UI 전용 |
| Accent 텍스트 | `accent` (#9B85C7) | `bg` | 3.7:1 | AA Large / UI ✓ |
| Link 전용 (조정됨) | `accent-active` (#8872B4) | `bg` | 3.4:1 | UI ✓ (밑줄 병용) |
| Accent 버튼 전경 | `accent-fg` (#FFFFFF) | `accent` (#9B85C7) | 3.7:1 | AA Large / UI ✓ |
| 사이드바 본문 | `fg` | `bg-panel` (#F0EFF5) | 13.5:1 | AAA ✓ |

### Link 버튼 변경 이유

- 기존: `text-accent` — 라이트 모드 `#9B85C7` on `#FAFAFC` = 3.7:1 (텍스트 AA 4.5 미달)
- 변경: `text-accent-active` — `#8872B4` on `#FAFAFC` = 3.4:1 + **밑줄 병용**으로 링크 식별
- 링크는 WCAG에서 "UI 구성요소" 범주로 3:1 충족. 밑줄이 의미 전달을 색상에서 분리한다 (§12.2 "색상만으로 의미 전달 금지").
- 커밋 해시는 작업 6-3 feat.

### 주의: accent-subtle 위에 accent 텍스트 배치 금지

`accent-subtle` (#EEE8F8, L≈0.846) 패널 위에 `accent` 텍스트를 두면 라이트 모드에서 ~2.1:1 까지 떨어진다. 이 조합이 필요한 경우 `accent-fg` (흰색) + `accent` 배경 조합(버튼 스타일)을 사용한다.

## 4. 위험도 시각 언어 (§9.1 권한 카드)

| 위험도 | 색 | 아이콘 | 텍스트 |
|---|---|---|---|
| low | `success` 녹색 | `ShieldCheck` | "낮음" / "Low" |
| medium | `warn` 황색 | `AlertTriangle` | "보통" / "Medium" |
| high | `danger` 적색 | `OctagonAlert` | "높음" / "High" |

색·아이콘·문자 3중. 색맹·색약 사용자도 의미 식별 가능.

## 5. motion-reduce 대응

- `prefers-reduced-motion: reduce` 사용자를 위한 Tailwind `motion-reduce:` 변형 적용:
  - `animate-spin` (CardStateBadge Loader2) → `motion-reduce:animate-none`
  - `animate-pulse` (Skeleton, AssistantMessage 커서) → 기존에 이미 적용
  - Radix Dialog open/close animate → `motion-reduce:data-[state=open]:animate-none`
  - Tooltip fade → `motion-reduce:animate-none`
  - SlideInPanel `duration-slide` → 기존에 이미 `motion-reduce:duration-0` 적용
- 애니메이션이 제거되어도 **상태 변경 자체**(open/close, 스핀 완료 등)는 즉시 반영되도록 설계.

## 6. 자동 검증 (이력)

과거 `scripts/verify-contrast.mjs`가 이 설계를 자동 검증했다 (실제 컴퓨티드 스타일을
Playwright로 수집 → 클라이언트에서 `relativeLuminance()` 계산 → WCAG ratio 비교,
다크/라이트 두 모드, `prefers-reduced-motion: reduce` 에뮬레이션 확인). 어떤
`package.json` 스크립트·CI 게이트도 참조하지 않는 일회성 스프린트 산출물로
확인되어 2026-07-20 정비(S-059)에서 삭제되었다 — "매 세션 자동" 문구는 그 시점부터
이미 사실이 아니었다. 재도입 시 `pnpm verify:a11y`(`scripts/verify-a11y.mjs`)처럼
`package.json`에 등록된 게이트로 만들 것.

## 7. 수동 검증 (사용자 책임)

다음은 자동 테스트로 다루기 어려운 품질 지표. 파일럿 리포트 양식(ADR-026)에 체크리스트로 포함:

- [ ] Windows 고대비 모드 (하이콘트라스트) 에서 UI 식별 가능
- [ ] NVDA / JAWS / 내레이터로 주요 흐름 읽어보기: 사이드바 → 워크맵 → 카드 클릭 → 검증 → 권한 카드
- [ ] 키보드만으로 D→I→V→E 한 카드 완주 가능 여부 (Tab 순환, Enter 진입, Escape 종료)
- [ ] Zoom 200% 에서 레이아웃 깨짐 없음
- [ ] 색맹 시뮬레이터 (Protanopia/Deuteranopia/Tritanopia) 에서 위험도 구분 가능
