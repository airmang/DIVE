# DIVE 의사결정 기록 (Architecture Decision Records)

이 문서는 DIVE 구현 과정에서 내린 결정들을 누적 기록합니다. 한 번 채택된 결정은 폐기될 수는 있어도 **삭제되지 않습니다** (이력 보존). 폐기 시에는 새 ADR로 폐기 사유를 명시하고 기존 ADR의 상태를 "폐기됨"으로 변경합니다.

## 형식

```markdown
## ADR-NNN: [짧은 제목]
- 일시: YYYY-MM-DD
- 상태: 채택 / 폐기됨 / 재고 중
- 컨텍스트: 왜 이 결정이 필요했는가
- 결정: 무엇을 선택했는가
- 대안: 검토했지만 선택하지 않은 옵션들
- 결과: 이 결정의 영향
```

---

## ADR-001: 마크다운 명세서 + Ralph 루프 운영
- 일시: 2026-05-03
- 상태: 채택
- 컨텍스트: DIVE 구현은 5월~12월 장기 프로젝트로, 단일 long-running 에이전트로는 컨텍스트 윈도우 한계에 부딪힘. 사용자(고규현)는 학교 본업과 병행해야 함.
- 결정: Ralph 패턴(단일 프롬프트의 무한 루프) + SoT 4파일 운영 (SPEC, DECISIONS, PROGRESS, NEXT). codex CLI를 ChatGPT 구독으로 호출.
- 대안:
  - opencode UltraWorker로 한 번에 큰 작업 — 컨텍스트 한계로 거절
  - 36개 분할 프롬프트를 사람이 순차 실행 — 자동화 이점 상실
- 결과: 사용자는 매일 1회 진행 점검만 하면 됨. 막히면 ralph가 `[BLOCKED]` 상태로 멈추고 사용자 결정 대기.

## ADR-002: SoT 4파일 구조
- 일시: 2026-05-03
- 상태: 채택
- 컨텍스트: ralph 루프는 매 턴 fresh context. 모든 상태가 파일에 있어야 복원 가능.
- 결정: 다음 4파일로 운영
  - `DIVE_SPEC.md` — 제품 명세 (변하지 않음, 사용자만 수정)
  - `DIVE_DECISIONS.md` — ADR 누적 (이 파일)
  - `DIVE_PROGRESS.md` — 작업 체크리스트
  - `DIVE_NEXT.md` — 단일 작업 단위 (ralph가 매 턴 갱신)
- 대안: 단일 통합 파일 — 너무 커져서 파싱 부담
- 결과: 각 파일이 명확한 책임. ralph 프롬프트가 짧아짐.

---

<!-- 새 ADR은 아래에 추가하세요. 번호는 003부터 시작 -->

## ADR-003: Windows NSIS 빌드 검증을 GitHub Actions로 위임

- 일시: 2026-05-03
- 상태: 채택
- 컨텍스트: 개발 환경은 macOS (darwin arm64)이며, 작업 1-1의 완료 조건에는 Windows x64와 ARM64 NSIS 인스톨러 생성이 포함된다. macOS에서 `x86_64-pc-windows-msvc` / `aarch64-pc-windows-msvc` 타겟으로 cargo를 돌릴 수는 있지만 MSVC 링커·Windows SDK·NSIS 툴체인이 없어서 실제 NSIS 인스톨러 산출까지 가는 경로가 현실적으로 막혀 있다. Windows 머신을 상시 보유한 상태도 아니다.
- 결정:
  - 로컬(macOS)에서는 pnpm install, typecheck, lint, format, cargo check, cargo fmt, `pnpm tauri:dev`(창이 뜨는지 확인)까지만 검증한다.
  - Windows x64 / ARM64 NSIS 빌드는 `.github/workflows/build.yml`의 `build-windows` 매트릭스(`windows-latest` + `windows-11-arm` 러너)에서 수행하고, NSIS `.exe`를 artifact로 업로드한다.
  - Phase 1 이후에도 동일한 CI 매트릭스를 유지한다. 로컬 머신을 확보하면 보강만 하고 CI 정책을 바꾸지 않는다.
- 대안:
  - macOS에서 `cargo-xwin`으로 Windows 크로스 빌드 강행 — NSIS 번들링·코드 서명 흐름과 호환성이 불확실하고, 공식 Tauri 문서가 권장하는 경로가 아니라 기각.
  - Windows VM을 상시 로컬에서 돌림 — 디스크·메모리 오버헤드 부담. ralph 루프가 사용자 부재 시간에 돌아간다는 점과도 맞지 않음.
  - 친지 Windows 머신에서 수동 빌드 — 재현성·접근성 부족.
- 결과:
  - 작업 1-1의 Windows 빌드 완료 조건 2개는 CI 첫 push에서 자동 검증된다. 실패 시 `DIVE_NEXT.md`에 BLOCKED로 다시 기록한다.
  - GitHub Actions 무료 러너 `windows-11-arm`는 2025년부터 GA된 상태이므로 비용 추가 없이 ARM64 검증이 가능하다.
  - 로컬 macOS 검증 + Windows CI 검증의 이원화를 공식 절차로 문서화(`dive/README.md`의 "CI (권장)" 섹션).

## ADR-004: v1.0 전까지 개발 빌드를 코드 서명하지 않음

- 일시: 2026-05-03
- 상태: 채택
- 컨텍스트: 개발·파일럿 단계(Phase 1~5)에서 생성되는 NSIS 인스톨러는 교내 파일럿 참가자(25명, Phase 4)와 개발자 본인에게 한정 배포된다. 현재 EV 코드 서명 인증서는 보유하지 않으며, 연간 수십만 원~수백만 원 규모 비용이 든다. 서명 없는 인스톨러는 Windows SmartScreen에서 "게시자를 알 수 없음" 경고가 뜨지만 `추가 정보 → 실행`으로 진행 가능하다.
- 결정:
  - Phase 1~5 기간 동안 코드 서명을 도입하지 않는다.
  - `dive/README.md`의 "코드 서명 / SmartScreen" 섹션에 SmartScreen 경고가 정상이며 실행 절차를 설명해 둔다.
  - 파일럿 교사·학생에게 배포할 때도 릴리스 노트에 동일 문구를 포함한다.
  - v1.0 정식 배포를 준비하는 Phase 6 (작업 6-4 / 6-5)에서 EV 인증서 구매, 서명 파이프라인 구축, SmartScreen 평판 축적을 일괄 처리한다.
- 대안:
  - 지금부터 OV/EV 인증서 구매 — 초기 비용 대비 가치 없음. 파일럿 전 UI/로직 변경이 잦아 재서명 부담만 누적.
  - Self-signed 인증서 사용 — SmartScreen 우회 효과 없음. 사용자가 설치 전 루트 CA를 수동으로 신뢰해야 하므로 교육 환경 배포 난이도만 올라감.
  - 빌드 산출물 대신 소스를 직접 실행 — 파일럿 환경(학교 PC)에서 pnpm/cargo를 설치할 수 없으므로 비현실적.
- 결과:
  - Phase 4 파일럿까지 "서명 없음 안내"가 공식 상태로 유지됨.
  - 코드 서명 비용·흐름 결정이 Phase 6로 지연됨. 그 전까지 인증서 구매/신청 리드 타임(보통 1~2주)만 파악해 두면 됨.

## ADR-005: shadcn/ui 구조 채택 (CLI 대신 수동 작성)

- 일시: 2026-05-03
- 상태: 채택
- 컨텍스트: 작업 1-2에서 Button, Card, Badge, Input, Tabs, Tooltip, Dialog 7종 베이스 컴포넌트가 필요하다. 명세 §A.3는 shadcn/ui 계열(Radix primitive + Tailwind + 소스 복사 방식)을 권장한다. shadcn CLI(`pnpm dlx shadcn@latest init`)는 기본 팔레트를 자동 주입하는데, DIVE는 이미 §2.3 고유 팔레트를 CSS 변수로 정의한 상태라 CLI 기본값과 충돌한다.
- 결정:
  - shadcn/ui의 아키텍처 패턴(Radix headless + cva variants + tailwind-merge + 컴포넌트 소스 `src/components/ui/`에 직접 소유)을 채택한다.
  - CLI는 돌리지 않고 7종 컴포넌트를 직접 작성한다. cva/tailwind-merge/clsx는 개별 의존성으로만 추가.
  - 팔레트는 DIVE 전용 토큰(`bg`, `accent`, `fg`, `success`, `warn`, `danger`, `info`)을 Tailwind config에 노출하고 컴포넌트는 이 토큰만 참조한다.
  - cva 변형 팩토리는 `*-variants.ts` 파일로 분리(`button-variants.ts`, `badge-variants.ts`)하여 `react-refresh/only-export-components` 경고를 방지하고 `.tsx`는 컴포넌트만 export한다.
  - 추후 shadcn이 제공하는 추가 컴포넌트(Sheet, Popover, Command 등)가 필요해지면 CLI를 `components/ui/`에 바로 돌려도 충돌 없이 확장 가능하다.
- 대안:
  - Radix primitive만 쓰고 래퍼를 전혀 안 두기 — 매 호출마다 중복 Tailwind 클래스 필요, 디자인 일관성 유지 부담.
  - Headless UI (@headlessui/react) 기반 — Dialog/Tooltip의 API 풍부도가 Radix보다 얕음, 접근성 기본값도 Radix가 더 완비.
  - shadcn CLI 사용 + 기본 팔레트를 덮어쓰기 — init이 기존 `globals.css`를 덮어쓸 위험, 작업 단위 구분이 흐려짐.
- 결과:
  - 7종 컴포넌트가 DIVE 토큰만으로 스타일링됨. 임의 `#xxxxxx` 하드코딩 0건(grep 확인).
  - 소스 복사 방식이므로 향후 디자인 드리프트 시 해당 파일만 수정하면 되고 node_modules 업데이트에 얽매이지 않음.
  - cva variants 파일 분리로 ESLint `--max-warnings 0` 통과.

## ADR-006: 폰트 로컬 호스팅 (Pretendard Variable + JetBrains Mono)

- 일시: 2026-05-03
- 상태: 채택
- 컨텍스트: DIVE는 Tauri 네이티브 앱으로 학교 PC에 배포된다. 파일럿 교실 네트워크는 필터링·오프라인 가능성이 있으며, 첫 렌더에서 한글 폰트가 빠지면 시각적 인상이 크게 훼손된다. Pretendard Variable은 가변 폰트 단일 woff2(2MB)로 제공되고 OFL 라이선스이며, JetBrains Mono는 Apache 2.0이다.
- 결정:
  - `src/assets/fonts/` 아래 woff2 직접 포함: `PretendardVariable.woff2`(2.0MB), `JetBrainsMono-Regular.woff2`(92KB), `JetBrainsMono-Bold.woff2`(95KB). 합계 ~2.2MB.
  - `src/styles/globals.css`의 `@font-face`로 상대 경로 참조 → Vite가 해시 파일명으로 번들에 포함.
  - CDN fallback은 두지 않는다. 오프라인 환경에서도 100% 동일 렌더 보장.
  - Pretendard Variable은 `font-weight: 45 920`으로 선언해 100~900 어느 굵기 요청도 변형으로 대응.
  - README 라이선스 섹션에 Pretendard(OFL) / JetBrains Mono(Apache 2.0) 고지를 Phase 6 정식 배포 시 포함한다(현재는 ADR로만 기록).
- 대안:
  - jsdelivr/google fonts CDN — 리포지토리 경량화에 유리하지만 오프라인 환경에서 시스템 fallback으로 밀려남. 파일럿 PC 환경이 불투명한 상태에서 리스크 과도.
  - Pretendard 정적 웨이트 5~7개 woff2 — 가변 폰트 1개로 대체 가능하며 용량도 비슷함. 가변 쪽이 구현 단순.
  - Noto Sans KR — 한글 커버리지는 비슷하지만 §2.3 권장 순위가 "Pretendard 또는 Noto Sans KR"이므로 Pretendard가 상위 선택지.
- 결과:
  - 빌드 산출물 크기 증가 2.2MB. Tauri NSIS 인스톨러 전체 크기 대비 무시할 수준.
  - 학교 PC에서 첫 실행부터 올바른 한글 타이포그래피 보장.
  - `font-display: swap`으로 초기 로드 중에는 시스템 sans로 대체 후 폰트 로드 완료 시 교체 — FOUT는 발생 가능하나 FOUC보다 수용 가능.

## ADR-007: FOUC 방지 인라인 스크립트를 index.html `<head>`에 배치

- 일시: 2026-05-03
- 상태: 채택
- 컨텍스트: 다크/라이트 테마는 `<html>` 클래스(`dark`/`light`)로 전환된다. React가 마운트되기 전에 이 클래스가 결정되지 않으면 초기 페인트가 잘못된 테마로 그려졌다가 번쩍이며 전환된다(FOUC). DIVE_NEXT.md 완료 조건에 "FOUC 없음"이 명시되어 있다.
- 결정:
  - `index.html`의 `<head>`에 동기 인라인 IIFE를 둔다. React 번들 로드보다 먼저 실행되어 DOM parsing 초기 시점에 `<html>` 클래스를 적용한다.
  - 순서: localStorage `dive.theme` 값(dark/light) → 없으면 `matchMedia('(prefers-color-scheme: light)')` → 그래도 실패하면 dark 기본값.
  - `<html>`에 `class="dark"`를 정적으로 써 두어 JS 실패 시에도 다크 모드로 폴백.
  - `meta name="color-scheme" content="dark light"`를 선언해 네이티브 스크롤바/폼 요소가 테마에 맞춰 그려지도록 함.
  - 현재 `src-tauri/tauri.conf.json`의 CSP는 null(비활성)이라 인라인 스크립트 허용. v1.0에서 CSP를 켤 경우 nonce 주입 또는 별도 `public/theme-init.js`로 전환한다.
- 대안:
  - 외부 `public/theme-init.js` 사용 — 로컬 파일이라 지연은 무시 가능하지만 현재 CSP가 비활성이므로 굳이 분리할 실익 없음. CSP 강화 시점에 전환 예정.
  - React 최초 렌더에서 처리 — 첫 페인트가 무조건 다크로 번쩍 뒤 라이트로 전환되는 FOUC 발생. 완료 조건 위반.
  - next-themes 같은 라이브러리 — Next.js 종속. Vite 환경에서 과한 의존성.
- 결과:
  - Playwright 검증에서 OS=dark 상태 초기 접속 시 `classList: ["dark"]`로 시작, 토글 후 reload해도 `classList: ["light"]` + 백그라운드 `rgb(250,250,252)` 유지 확인.
  - 인라인 스크립트 5줄(try/catch 포함)로 충분. 유지보수 부담 적음.
  - 향후 CSP 강화 시 ADR 추가로 마이그레이션 경로 문서화.
