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
  - `docs/internal/DIVE_PROGRESS.md` — 작업 체크리스트
  - `docs/internal/DIVE_NEXT.md` — 단일 작업 단위 (ralph가 매 턴 갱신)
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
  - 작업 1-1의 Windows 빌드 완료 조건 2개는 CI 첫 push에서 자동 검증된다. 실패 시 `docs/internal/DIVE_NEXT.md`에 BLOCKED로 다시 기록한다.
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

## ADR-008: rusqlite 0.32 + bundled feature 채택

- 일시: 2026-05-03
- 상태: 채택
- 컨텍스트: 작업 1-3에서 SQLite 기반 데이터 레이어를 추가해야 한다. 명세 §11.1은 `rusqlite`와 `bundled` feature 사용을 명시한다. 타겟은 Windows x64/ARM64 + macOS 개발 환경이며 시스템 sqlite3 의존은 NSIS 인스톨러 배포에 부담이다.
- 결정: `rusqlite = { version = "0.32", features = ["bundled"] }`. `Cargo.lock`에 기존 항목이 없으므로 0.32(당시 최신 안정)로 고정.
- 대안:
  - `sqlx` — 비동기 + compile-time 쿼리 검증이지만 현재 단계에서는 동기 rusqlite로 충분하고, 비동기가 필요한 레이어는 후속 작업에서 `tokio::task::spawn_blocking`으로 감쌀 예정.
  - `rusqlite` 시스템 SQLite 링크 — Windows 배포 환경 불투명, bundled 쪽이 안전.
- 결과: SQLite C 소스를 cc로 컴파일해 첫 빌드가 길어지지만(CI 매트릭스 전체 +30초 수준) 모든 타겟에서 동일 SQLite 런타임을 보장. 이후 업그레이드는 별도 ADR로 처리.

## ADR-009: 시간 필드 i64 Unix millisecond epoch 표현

- 일시: 2026-05-03
- 상태: 채택
- 컨텍스트: `Project.created_at`, `Session.started_at`, `EventLog.created_at`, `schema_version.applied_at` 등 모든 시간 필드를 SQLite에 저장한다. 명세는 표현을 규정하지 않음.
- 결정: DB 모델의 시간 필드는 전부 `i64` Unix millisecond epoch로 저장·직렬화한다. 헬퍼 `db::now_ms()` 제공.
- 대안:
  - `chrono::DateTime<Utc>` + serde — 타입 안전·가독성 우수하지만 chrono 의존성 1개 추가. 현재는 불필요한 무게.
  - `time` crate — 비슷한 성격, 동일한 이유로 제외.
  - ISO 8601 TEXT 저장 — SQLite `datetime()` 함수와 친화적이지만 정렬/비교 속도가 떨어지고 serde 처리가 번거로움.
- 결과: serde JSON 직렬화가 숫자 그대로이며 SQLite 인덱스/정렬이 단순. 도메인 계층에서 타입 안전성이 필요해지면 저장 포맷 유지 + newtype 래퍼로 대응 가능.

## ADR-010: schema_version 메타 테이블 기반 마이그레이션

- 일시: 2026-05-03
- 상태: 채택
- 컨텍스트: 9개 테이블을 v1 마이그레이션에 모두 포함하되, 향후 스키마 변경은 append-only로 누적해야 한다(명세 §10.2 원칙). 현재 버전 추적 방법을 선택해야 한다.
- 결정: `schema_version(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)` 메타 테이블로 적용된 마이그레이션을 기록한다. `migrate()`는 `MAX(version)` 조회 → 다음 버전만 트랜잭션 내 실행 → 성공 시 메타 테이블에 `(version, applied_at)` INSERT.
- 대안:
  - `PRAGMA user_version` — 가장 가볍고 SQLite 내장이지만 `applied_at` 타임스탬프/설명/체크섬 같은 감사 메타데이터를 붙일 수 없음.
  - `refinery`, `sqlx::migrate` 같은 외부 crate — 기능은 많지만 동기 rusqlite 환경에서 추가 의존성을 정당화할 만한 요구가 아직 없음.
- 결과: 테이블 1개가 추가되지만 migration 이력과 적용 시점을 남길 수 있고, 향후 checksum/description 컬럼 추가 여지도 확보. 추가 조회 성능이 필요하면 보조로 `PRAGMA user_version`을 미러링하면 됨.

## ADR-011: DAO는 순수 함수 스타일

- 일시: 2026-05-03
- 상태: 채택
- 컨텍스트: Project/Session/Workmap/Card/Message/ToolCall/Checkpoint/ProviderConfig/EventLog 9개 엔티티의 CRUD를 제공해야 한다. 테스트 용이성과 트랜잭션 조합이 우선 과제.
- 결정: 각 DAO 모듈은 `insert(conn, &NewFoo) -> Result<i64, DbError>`, `get_by_id(conn, id)`, `list(conn)`, `update(conn, id, &NewFoo)`, `delete(conn, id)` 같은 순수 함수 집합으로 작성한다. 상태를 가진 구조체(`CardRepository`)나 trait 추상화는 도입하지 않는다.
- 대안:
  - Trait 기반 repository(`trait CardRepo`) — 테스트용 mock 주입에 유리하지만 현 단계에서 mock이 필요한 소비자가 없음. 과한 추상화.
  - 구조체 + impl(`struct CardDao<'a>(&'a Connection)`) — 메서드 체이닝이 약간 자연스럽지만 함수형과 본질적 차이는 없고 트랜잭션 전달 시 라이프타임이 번거로움.
- 결과: `&Connection`/`&Transaction` 중 어느 쪽이든 받는 단일 시그니처로 트랜잭션 내 여러 DAO 호출 조합이 단순. 후일 mocking이 필요해지면 기존 순수 함수를 감싸는 trait facade를 append할 수 있음.

## ADR-012: 테스트 DB는 tempfile 기반 디스크 SQLite

- 일시: 2026-05-03
- 상태: 채택
- 컨텍스트: CI 매트릭스(Linux/macOS/Windows x64+ARM64)에서 DAO·마이그레이션 테스트가 통과해야 한다. `Database::open()`은 WAL + FK를 켜고, 이 조건이 실제 프로덕션과 동일하게 검증되는 것이 바람직.
- 결정: 테스트는 `tempfile::NamedTempFile`로 생성한 디스크 SQLite 파일을 기본으로 사용한다. 각 테스트는 `fresh_db()` 헬퍼로 새 파일 + migrate()를 받는다.
- 대안:
  - `Connection::open_in_memory()` — 빠르지만 WAL이 실제로는 `memory` 모드라 저널 동작 검증이 제한적. 파일 잠금·sidecar(`-wal`/`-shm`) 시나리오 재현 불가.
  - `tempfile::TempDir` + 수동 경로 — 동등하지만 현재 규모에서는 NamedTempFile 단일 파일이 더 단순.
- 결과: 테스트 실행 시간이 미세하게 증가하나(22 테스트 0.04s), FK/WAL/파일 잠금을 프로덕션과 동일 조건으로 검증. Windows 파일 잠금 이슈가 생기면 `TempDir + db.sqlite` helper로 전환한다.

## ADR-013: 카드 상태 머신은 세션당 `current_card_id` 단일 슬롯으로 강제 (DB 마이그레이션 v2)

- 일시: 2026-05-04
- 상태: 채택 (작업 3-1)
- 컨텍스트: 명세 §4.3 — "한 번에 하나의 카드만 I 단계에 있을 수 있다". 또한 §4.6 상태 머신은 카드 단위 state 전이지만, I/V 게이트는 "현재 어떤 카드에 대해 대화 중인가"를 아는 맥락이 필요.
- 결정:
  - DB 마이그레이션 v2로 `Workmap.current_card_id INTEGER REFERENCES Card(id) ON DELETE SET NULL` 컬럼을 append-only ALTER로 추가. 세션당 0개 또는 1개의 current card.
  - FK `ON DELETE SET NULL`로 카드 삭제 시 애플리케이션 레벨 체크 없이 자동 null 처리.
  - `CardTransition` enum은 6 variant (`EnterInstruct`, `RequestVerify`, `Approve`, `Reject`, `ReopenFromReject`, `Extend`)로 고정. 명세 §4.6 그림 4의 화살표 8개 전부 매핑 + `EnterInstruct`는 Decomposed→Instructed와 Instructed→Instructed(재편집) 모두 허용.
  - 게이트 레이어는 `current_card_id`만 읽고 쓰기는 하지 않는다. 프론트가 `workmap_set_current_card` IPC로 명시적 세팅, 또는 카드 전이 시 UI 로직이 함께 갱신.
- 대안:
  - 세션 레벨 current card 없이 카드 테이블만으로 "가장 최근 편집된 카드" 추론 — 암묵적이고 race condition 우려. 모든 게이트 판정이 시간 정렬에 의존하게 되어 테스트 복잡도 증가.
  - 카드별 독립 진행 (N개 카드가 각자 I/V 단계 동시 진행) — 명세 §4.3 위반. AgentLoop가 어느 카드에 대해 응답 중인지 판단할 컨텍스트 부재.
  - Checkpoint 테이블처럼 `SessionCurrentCard(session_id, card_id, created_at)` 별도 테이블 — 단일 슬롯 의미론을 PRIMARY KEY로 강제하려면 결국 `session_id PRIMARY KEY`가 되어 `Workmap` 컬럼 추가와 동등. 테이블 수만 늘어남.
- 결과:
  - 마이그레이션 v2는 1줄 ALTER이므로 롤백·WAL 시나리오 모두 안전. v1→v2 순차 적용이 idempotent (schema_version 테이블로 보장).
  - I/V/E 게이트 판정 로직이 DB 쿼리 1~2회로 단순화 (`workmap.current_card_id → cards.get_by_id`).
  - 상태 머신은 Rust 순수 함수 (`apply(state, transition) -> Result<state, TransitionError>`)로 추출. DB 의존성 없이 12 개 단위 테스트로 매트릭스 전수 검증. 잘못된 전이(예: `Decomposed → Approve`)는 명시적 `InvalidTransition` 에러.
  - 프론트 Zustand 스토어도 동일한 전이 개념(`transitionCard(id, nextState)`)으로 미러링. 백엔드 IPC `card_transition`은 DB update를 실제로 수행하되, Phase 3 현재 MainShell은 아직 IPC 호출 없이 프론트 스토어만 업데이트 (3-2 이후 백엔드 연동).

## ADR-014: 블록리스트는 리터럴 substring + 정규식 혼합, 심볼릭 링크 거부는 프로젝트 루트 하위 컴포넌트만

- 일시: 2026-05-04
- 상태: 채택 (작업 3-4)
- 컨텍스트: 명세 §9.2 — "정규식 + AST 기반 매칭 (단순 문자열 매칭은 회피 쉬움)". 명세 §9.3 — "심볼릭 링크는 따라가지 않음 (canonicalize 후 검사)". 두 가지 모두 학생 PC에서 실수든 의도든 시스템 파괴를 막는 최후 방어선.
- 결정:
  - **블록리스트 매칭 전략**: 리터럴 substring (case-insensitive, 명세 §9.2 예시의 14 변형) + 정규식 (dd→block device, mkfs.\*, curl|bash, wget|sh, iwr|iex, rm -rf 절대 경로 루트레벨). AST 파싱은 `v1.0` 이후로 연기 — bash 문법 파서 추가 복잡도 대비 이득이 낮고, 리터럴+정규식 2중화로 스펙 예시 전부 차단 가능.
  - **`BlockReason { rule, pattern }` 구조**: UI에 매칭 규칙 이름과 패턴을 별도로 표시해 사용자가 왜 차단되었는지 즉시 이해. EventLog에도 동일 구조 저장.
  - **`Tool::validate()` trait 훅**: 도구별 사전 검증을 PermissionHook 이전에 실행. 기본 구현은 `Ok(())`, `bash` 도구만 오버라이드하여 `classify_bash_command`를 호출. 향후 신규 danger 도구가 자체 정책을 쉽게 붙일 수 있다.
  - **심볼릭 링크 거부 범위**: `reject_symlink_components(target, root)`는 **프로젝트 루트 하위** 컴포넌트만 검사. 루트 자체나 그 위 조상은 건드리지 않음 — macOS `/tmp` → `/private/tmp`, Linux `/home` 바인드 마운트 등 시스템 레벨 심볼릭 링크에 프로젝트를 두는 정당한 사용을 막지 않기 위함. 루트 하위에서 학생이 임의 심볼릭 링크로 FsGuard를 우회하는 시나리오만 차단.
  - **블록 통지 경로**: PermissionCard/Approve 플로우를 건너뛰고, 별도 `AgentEvent::ToolCallBlocked { id, reason }` 이벤트 + 빨간 "실행 불가" 카드. 기존 `ToolCallDenied`와 의미를 구분 — Denied는 사용자가 거부한 것, Blocked는 정책이 거부한 것이며 사용자 승인도 불가.
- 대안:
  - **완전 AST 기반 매칭** (실제 bash parser) — 회피 저항성은 높지만 `bash`/`cmd`/`powershell`마다 별도 파서 필요. v1.0 범위를 벗어남. Phase 6 다국어 셸 지원 시점에 재검토.
  - **sudo도 허용** — 명세 §9.2가 `sudo *`를 명시적 차단 패턴으로 지정. 학생 PC에서 sudo가 필요한 시나리오는 수업 밖의 시스템 관리로 한정되므로 정책적으로 전면 차단.
  - **심볼릭 링크 검사를 전체 경로에 적용** — 초기 구현이었으나 macOS `/tmp` → `/private/tmp` 때문에 테스트 환경 자체가 깨졌다. 프로젝트 루트 기준으로 축소하는 것이 안전성과 실용성의 균형점.
  - **경고 카드 variant 신설** — 명세 §9.2는 차단과 블록을 구분하지 않음. 경고는 §4.2 자동 승인 정책 영역으로, 현재는 차단만 구현 (경고 카드는 Phase 4-2 설정 화면에서 자동 승인 정책 UI로 다룸).
- 결과:
  - `src-tauri/src/tools/guard.rs` 16개 단위 테스트 + `tests/tool_guard.rs` 3개 통합 테스트로 패턴 전수 검증 + AgentLoop 이벤트 발행 검증.
  - `Cargo.toml` 신규 의존성 `regex = "1"`, `once_cell = "1"` (정규식 카탈로그 lazy 초기화). `tokio` features에 `process` + `io-util` 추가 (bash 도구 `tokio::process::Command`).
  - 매칭은 `classify_bash_command(cmd) -> Option<BlockReason>` 단일 진입점이므로 향후 패턴 추가·갱신이 한 파일 안에서 완결. 테스트도 같은 파일에 위치해 리뷰어가 "어떤 명령이 어떻게 차단되는가"를 한눈에 감사 가능.
  - 프론트 `ToolCallMessage.tsx`의 blocked 분기는 기존 pending/approved/denied 분기와 독립적이라 기존 Playwright 스위트(111 assertions) 회귀 없이 16개 신규 assertion이 추가됐다.

## ADR-015: V-stage 검증과 AI 분해는 single-tool `tool_choice` 패턴으로 구조화 출력 강제

- 일시: 2026-05-04
- 상태: 채택 (작업 3-2)
- 컨텍스트: 명세 §4.4 V 단계는 `verify_log` JSON 스키마를 요구. 명세 §4.1 D 단계 AI 도움은 카드 배열을 요구. 두 경로 모두 "모델이 자유 텍스트로 답하면 파싱이 깨지기 쉽다"는 공통 위험이 있다. Anthropic `tool_use`, OpenAI `tools` + `tool_choice`는 둘 다 단일 도구 강제 호출을 지원하므로 JSON schema 검증을 provider 레벨에서 받아낼 수 있다.
- 결정:
  - **`VerifyEngine`과 `AiAssistEngine`을 별도 모듈로** (각각 `dive/verify.rs`, `dive/assist.rs`) — `AgentLoop`와 라이프사이클이 다르다. AgentLoop는 사용자 메시지 주도, Engine들은 카드·D단계 주도 1-shot.
  - **Single-tool `tool_choice: Specific(tool_name)`**: `verify_result` / `assist_cards` 각 1개 도구만 노출하고 선택을 강제. 모델이 다른 도구를 쓰거나 텍스트로만 답할 여지 차단. 같은 패턴을 두 엔진이 공유해 코드 감사가 쉬움.
  - **`VerifyLog`는 JSON으로 `Card.verify_log` TEXT 컬럼에 직렬화**: v1 스키마가 이미 TEXT nullable 컬럼을 갖고 있어 마이그레이션 비용 0. 읽을 때만 lazy parse (`VerifyLog::from_json_str`).
  - **Approve 게이트는 IPC 레이어에서 강제**: `state_machine::apply`는 순수 함수로 유지 (6개 카드 상태 enum + 전이 매트릭스). verify_log 조건은 `card_transition` IPC가 DB 쿼리와 함께 검사해 `TransitionError::InvalidTransition`과 별개의 명확한 에러("verify failed: ... Pass approve_force=true to override.")로 surface. `approve_force: Option<bool>` 파라미터가 명시적 override 경로.
  - **Test runner는 Phase 4로 연기**: 명세 §4.4의 "실행 후 결과 확인" 단계는 3-2 범위 밖. `VerifyLog.test_result`는 기본 `skipped`, AI가 정적 분석만으로 `pass/fail`을 확신 가능할 때만 채움. 실제 `bash` 기반 테스트 실행은 3-4 블록리스트가 선행됐으므로 Phase 4-3에서 안전하게 확장.
- 대안:
  - **자유 텍스트 JSON 요청 (tool 없이)**: Anthropic의 "response format: JSON" 없음. OpenAI도 `response_format: json_schema`가 있지만 프로바이더 간 추상화 부담. 도구 호출은 두 프로바이더가 이미 공통 어댑터로 추상화돼 있어 유리.
  - **다중 도구 노출 + Auto 선택**: 모델이 `verify_result`를 건너뛰고 다른 도구를 쓰거나 텍스트로만 답할 여지. 1-shot 검증에서는 신뢰성이 떨어짐.
  - **Approve 게이트를 state_machine에 합치기**: 순수 함수 성질이 깨진다. 상태 전이 테스트 복잡도 급증. IPC 레이어 게이트가 관심사 분리 면에서 우수.
  - **Test runner를 3-2에서 함께 구현**: 긴 verify 시간 때문에 UI 블로킹 증가. 3-4 블록리스트는 있으나 실제 테스트 명령 결정(프로젝트별 `pnpm test` vs `cargo test` 등)은 4-3에서 다룰 설정 UI가 필요.
  - **Mock LLM fallback을 프로덕션 빌드에 포함**: 브라우저 데모(`?demo=scenario-b`)와 Playwright에 유용하지만 Tauri 빌드에서는 `__TAURI_INTERNALS__` 감지로 자동 분기. 프로덕션 경로는 항상 실제 IPC.
- 결과:
  - Rust 테스트 +10 (`tests/verify_engine.rs` 7 + `tests/ai_assist_engine.rs` 3) = **139 passed / 0 failed**. 두 엔진 모두 `MockProvider` 스크립트로 구조화 응답 시뮬레이션.
  - 프론트 `CardDetailPanel`의 verifying body 한 곳만 고쳐도 실제 LLM ↔ mock ↔ 실패 판정 세 경로를 모두 커버. Playwright 19 assertion으로 전체 흐름 검증.
  - `ai_assist_cards` IPC는 3-2 범위 밖이었지만 VerifyEngine과 동일 패턴이라 비용이 거의 없어 함께 처리 (핸드오프 권장안 5번 답). AiAssistDialog가 더 이상 4개 하드코드 mock에만 의존하지 않음.
  - `approve_force` 파라미터는 향후 설정 UI(Phase 4-2)에서 "자동 재승인 정책"과 별개의 수동 override 경로로 재활용 가능.

## ADR-016: 체크포인트는 베어 git 저장소 + 수동 트리 재작성으로 복원 (reset-hard 불가)

- 일시: 2026-05-04
- 상태: 채택 (작업 3-3)
- 컨텍스트: 명세 §6.5는 `.dive/git/` 베어 저장소 + 복원 기능을 요구. 그러나 git2-rs의 `Repository::reset(ResetType::Hard)`는 베어 저장소에서 `"cannot reset hard. This operation is not allowed against bare repositories."` 에러로 거부한다. `set_workdir(root, false)`로 work dir을 지정해도 마찬가지.
- 결정:
  - **베어 저장소 유지**: 사용자 자신의 `.git/`과 완전 분리해야 하므로 non-bare 저장소를 project_root에 만드는 선택지는 `git status` 오염·사용자 혼란 때문에 기각. `.dive/git/`은 계속 bare로 둔다.
  - **복원은 수동 트리 재작성 3단계**: ① `clear_tracked_worktree`로 이전 HEAD 트리가 참조하던 blob 경로만 `fs::remove_file`. 사용자의 unrelated 파일(빌드 산출물, 새 파일)은 건드리지 않음. ② `write_tree_to_disk`가 타겟 트리를 순회하며 blob 내용을 `fs::write`로 풀어냄. 디렉터리는 `create_dir_all`. ③ `repo.reference("HEAD", oid, true, ...)`로 HEAD 갱신. `checkout_tree` 호출도 시도했지만 베어 저장소에서는 경고만 남기고 파일을 쓰지 않아 제외.
  - **복원 전 자동 "복원 직전" 체크포인트**: 복원이 파괴적 작업이라 반드시 선행 스냅샷. 라벨은 한국어 고정으로 DB에 저장 — UI가 타임라인에서 "되돌릴 수 있는 지점"을 쉽게 식별.
  - **`add_all(["*"], path_filter)`**: WAL/SHM/SQLite/빌드 산출물 제외는 `.gitignore` 대신 `IndexMatchedPath` 콜백으로. 이유: `.gitignore` 파일을 베어 저장소 최상위에 두면 워크트리 추적·무시 경계가 불명확하고 사용자가 실수로 편집할 수 있음. 콜백은 코드로만 제어되므로 감사가 쉬움.
  - **자동 트리거 범위**: 3-3에서는 Approve·Extend만 (§6.5.2 5가지 중 실제 파일 변화가 확정되는 두 시점). D 통과·I 통과·V 거부는 Phase 4 파일럿 피드백 후 확장 여부 재평가 — 학생 PC에서 체크포인트 빈도를 낮춰 git objects 비대를 피한다.
- 대안:
  - **non-bare 저장소**: `.dive/git/`이 work dir을 갖게 하면 `reset --hard` 사용 가능하지만 파일이 `.dive/git/.git/`으로 내려가 디렉터리 구조 가독성 악화, 그리고 `repo.set_workdir`로 project_root를 가리키도록 강제해야 해서 결국 수동 제어 필요. 베어 유지가 깔끔.
  - **`checkout_tree(tree, Some(&mut CheckoutBuilder))`**: 베어 저장소에서 target_dir를 명시해도 실제 파일 쓰기를 하지 않는다 (git2-rs 0.18 확인). 수동 write가 유일한 신뢰 가능 경로.
  - **`.gitignore` 기반 필터**: 위 결정 참조. 코드 콜백이 더 감사 친화적.
  - **D/I 통과 자동 체크포인트도 포함**: 카드 10개짜리 세션에서 커밋 50+개 생성. 의미 있는 복원 지점은 V 통과이므로 범위를 좁히는 것이 사용자 경험상 유리.
  - **`repo.reset()` 실패 시 fallback으로 non-bare로 전환**: 마이그레이션 부담. 기존 베어 저장소를 가진 사용자의 히스토리 처리 문제. 수동 복원이 더 단순.
- 결과:
  - Rust 테스트 8개 (lib 5 + 통합 3). 복원 왕복 시나리오가 실제 파일 시스템 내용 변화를 검증 (`v1` → `v2` → restore → `v1` 확인 + "복원 직전" 자동 생성 확인).
  - `path_filter`는 `src/checkpoint/mod.rs:path_filter` 한 함수에 집중 — 새 제외 패턴 추가 시 여기에만 추가하고 단위 테스트로 검증 가능.
  - 복원 시 unrelated 파일이 남는 behavior는 의도 (사용자의 새 실험 파일은 복원 대상에 없으면 보존). 사용자가 원하면 그 파일을 삭제 후 다시 복원 가능 — 명세 §6.5.4 미니멀 복원 의미론에 부합.
  - Approve/Extend만 자동 체크포인트를 발행하므로 git objects 크기 증가가 선형적이고 학생 세션(카드 5~10개) 당 10~20MB 수준으로 예측 가능.

## ADR-017: OpenRouter는 OpenAI 어댑터의 base_url 스왑으로 재사용, Provisioning은 별도 모듈

- 일시: 2026-05-04
- 상태: 채택 (작업 3-5)
- 컨텍스트: 명세 §7.5는 OpenRouter Provisioning Keys를 "부수 공급자"로 기술. 하지만 OpenRouter의 채팅 API(`/chat/completions`)는 OpenAI와 완전 호환이고, 차이는 오직 (a) base_url, (b) 모델 ID 네이밍뿐이다. 한편 `/api/v1/keys` Provisioning 엔드포인트는 OpenAI에 없는 OpenRouter 전용 API라 별도 처리 필요.
- 결정:
  - **채팅 경로**: 신규 `providers/openrouter.rs` 어댑터를 만들지 않고 `OpenAiProvider::openrouter(api_key)` 편의 생성자를 추가. 내부적으로 `with_base_url("https://openrouter.ai/api/v1")` 한 줄. 현실적으로 OpenAI·OpenRouter를 넘나드는 테스트·fmt·clippy·SSE 파서 유지 비용이 0이 된다.
  - **Provisioning 경로**: `auth/openrouter_provisioning.rs`에 별도 모듈. `OpenRouterProvisioning`는 `reqwest::Client`만 들고 있고 `LlmProvider` 트레이트와 무관 — Provisioning은 채팅 트레이트 계약과 근본적으로 다른 관리 API이기 때문.
  - **`ChildKey`는 1회성**: 발급 시점에만 `key` 필드를 반환, 이후 `list_child_keys`는 `ChildKeySummary { hash, label, limit_usd, disabled }`로 `.key` 생략. OpenRouter 서버 정책과 일치 — 분실 시 재생성.
  - **keyring 저장은 IPC 레이어 선택**: 3-5 IPC는 발급 결과를 그대로 프론트에 반환. 실제 keyring 저장(`SecretScope::OpenRouterChildKey { label }`)은 교사 UX에 따라 달라져 Phase 4-2 설정 UI에서 결정. 3-5는 하위 레이어만.
  - **wiremock-only 테스트**: 실제 main key가 없으므로 3-5 검증은 5개 wiremock 시나리오(발급·401 에러·목록·개별 폐기·접두사 일괄 폐기)로 한정. 파일럿(4-5)에서 실제 API로 E2E 재검증.
  - **QR만, 짧은 URL 없음**: `qrcode.react`로 각 자식 키를 즉시 QR로 렌더. 짧은 URL 호스팅(Cloudflare Workers 등)은 Phase 4-5로 연기 — 학생이 QR을 촬영하면 즉시 키가 노출되므로 짧은 URL 없이도 수업 진행 가능.
- 대안:
  - **완전 별도 `providers/openrouter.rs`**: 코드 중복. 재사용 가능한 OpenAI 어댑터와 diff가 base_url 한 줄이라 가치 없음.
  - **Provisioning을 `providers` 하위에 두기**: 채팅 API와 관리 API를 혼재시키면 LlmProvider 트레이트 설계가 오염. auth가 이미 keyring 같은 "크로스-provider 보안/관리"를 담당하므로 자연스러운 위치.
  - **`SecretScope::OpenRouterChildKey` 자동 저장**: 3-5 범위를 벗어남. 교사가 키 발급 후 (a) 현장 QR 공유 (b) 키를 앱에 기억 (c) 세션 종료 후 일괄 폐기 — 세 워크플로가 공존할 수 있어 4-2에서 UI와 함께 결정.
  - **실제 OpenRouter 토큰으로 통합 테스트**: 비용 + 공유 API 키 유출 위험. wiremock이 `/api/v1/keys` 계약 3종 모두 커버하므로 스키마 회귀는 잡힘.
- 결과:
  - 테스트 +5 (wiremock 5). `cargo test` 총 **152 passed / 0 failed / 1 ignored**.
  - `providers::OpenAiProvider::openrouter()` 덕분에 Phase 4-2 설정 UI에서 OpenRouter를 일등 공급자로 노출하는 비용이 거의 없다 (ProviderConfig `base_url` 컬럼에 OpenRouter URL 저장 시 자동 분기).
  - `ProvisioningError::Remote { status, body }`가 UI 디버깅에 그대로 쓰이도록 설계 — 교사가 "401: invalid token" 같은 원인을 즉시 파악 가능.

## ADR-018: 익명화 export는 per-export UUIDv4 salt + 접두사 표기 + 경로 감지 휴리스틱

- 일시: 2026-05-04
- 상태: 채택 (작업 3-6)
- 컨텍스트: 명세 §9.4는 "SHA-256 해시 마스킹 — 학번 등 식별자가 원본으로 저장되지 않음"과 "이 데이터는 후속 분석·연구 목적으로만 사용됩니다" 동의를 요구. 문제는 (a) salt를 어디 범위로 잡을지, (b) 마스킹된 값을 육안으로 식별 가능하게 할지, (c) 경로 감지를 어떻게 할지.
- 결정:
  - **Per-export UUIDv4 salt**: export 호출마다 `uuid::Uuid::new_v4()`로 새 salt 생성. 동일 세션을 두 번 export 해도 hash 프리픽스가 바뀐다 → 연구자가 두 export 파일을 합쳐 re-identification을 시도해도 교차 매칭 불가. Salt는 출력에 포함하지 않음(§9.4 준수), 테스트로 누수 없음을 검증.
  - **접두사 표기 `h:` / `p:`**: 해시값은 SHA-256의 앞 16자(64비트) hex. 사용자 텍스트는 `h:<16hex>`, 파일 경로는 `p:<16hex>`. 접두사를 붙인 이유는 (i) 육안 검사 시 "이 값은 마스킹되었음"을 즉시 식별, (ii) 분석 스크립트가 prefix로 필터링해 집계 용이. 16자는 64비트 collision 확률이 학교 1차시 규모(N < 10⁴)에서 무시 가능.
  - **경로 감지 휴리스틱**: JSON 트리를 순회하며 (i) key가 `{path, file, filename, file_path, target_path}` 중 하나이면 그 값(문자열)을 통째 path로 간주, (ii) 그 외 모든 문자열은 `'/' 또는 '\\' 포함` AND `알려진 소스 확장자(.rs, .ts, .tsx, .js, .py, .json, .md 등 17개) 접미사`이면 path로 간주. false positive는 마스킹 과다(사용자 데이터 손실 없음), false negative는 마스킹 누락(학생 식별 위험)이라 보수적으로 범위를 넓혔다.
  - **레코드 순서 결정적**: `session_meta → card(position asc) → message(id asc) → tool_call(id asc) → checkpoint(created_at asc) → event(id asc)`. 파일럿 분석 스크립트(pandas/jq)가 순서에 의존해 조인하므로 DAO 쿼리에 항상 ORDER BY 명시. Kind 문자열 + 필드 이름은 **stable API** — 필드 추가는 자유, 제거/이름 변경은 ADR 필요.
  - **기본값 everything-on**: 포함 옵션 5개 모두 + 마스킹 옵션 2개 모두 기본 on. 연구자가 명시적으로 옵트아웃하지 않으면 최대 보호.
  - **IPC는 JSONL 문자열 반환**: Tauri 프런트가 문자열을 Blob으로 감싸 `save` dialog + `writeFile`을 호출하는 쪽이 역할 분리상 깔끔. 3-6은 백엔드 API만 제공, UX 디테일은 Phase 4-2에서.
- 대안:
  - **Per-session salt**: 한 세션의 동일 문자열이 항상 같은 hash가 되므로 세션 내 재식별 공격에 취약. 개인 식별자(학번·이름)가 여러 메시지에 반복 등장할 때 빈도 분석이 가능해짐.
  - **영구 salt (앱 설치 단위)**: 크로스-세션 통계가 가능하지만 연구자 퇴장 후 salt 유출 시 전체 재식별 가능. 학교 환경에서는 "이번 차시만 마스킹" 범위가 더 현실적.
  - **접두사 없이 순수 hex**: 분석 스크립트가 어떤 필드가 마스킹됐는지 별도 메타로 알려야 함. 접두사 방식이 self-describing.
  - **AST 기반 경로 감지 (실제 파일 시스템 질의)**: 빌드 시 존재하지 않을 수 있는 경로 + 느림. 휴리스틱으로 충분.
  - **IPC에서 직접 파일 쓰기**: `save` dialog가 Tauri 프런트에서 네이티브라 프런트가 관장하는 쪽이 UX 일관성. 3-6 범위에서는 JSONL 문자열만 반환.
  - **Salt를 output에 포함해 같은 export 내 재분석 허용**: §9.4 명세 "학번 등 식별자가 원본으로 저장되지 않음" 위반. Salt가 있으면 무차별 해시 사전 공격으로 원본 복구 가능.
- 결과:
  - Rust 테스트 +11 (`tests/export_jsonl.rs` 6 + inline 5). `cargo test` 총 **163 passed / 0 failed**.
  - 파일럿(Phase 4-5)은 **jq 기반 10줄 분석 스크립트**로 즉시 집계 가능 — record kind 필터 + field 선택.
  - 향후 스키마 진화: 필드 추가는 자유, 제거/rename은 ADR + 버전 필드 추가 후 migration note 커밋.

## ADR-019: 프로젝트·세션·프로바이더 IPC는 Tauri 우선 + localStorage mock 이중 경로

- 일시: 2026-05-04
- 상태: 채택 (작업 4-1)
- 컨텍스트: 4-1은 Sidebar의 `disabled` 잠금을 풀어 실제 CRUD를 연결한다. 두 경로가 있다: (1) `pnpm tauri:dev` / 릴리스 빌드에서는 실제 IPC + SQLite + OS keyring. (2) 브라우저 데모(`pnpm dev`) 및 Playwright 회귀에서는 Tauri 런타임이 없어 IPC 호출이 실패. 이 둘을 어떻게 조화시킬지가 핵심.
- 결정:
  - **Zustand 스토어가 런타임 감지**: `stores/project-session.ts`의 `loadTauri()`가 `window.__TAURI_INTERNALS__` 유무로 분기. `useChatSession`(2-3)의 동일 패턴 재사용 — 회귀 안정성 최고.
  - **이중 경로 함수 `withTauriOrMock<T>`**: `(api, tauriFn, mockFn)` 시그니처. IPC 실패 시 `console.warn` 후 mock으로 폴백(silent corruption 방지). 프로덕션에서는 api가 null일 일이 없지만, 개발 중 IPC 오류가 UI 전체를 브릭하지 않도록.
  - **localStorage 스키마**: `dive:onboarded`(boolean) + `dive:current-project-id`(number) + `dive:current-session-id`(number) + `dive:project-session`(mock 데이터 JSON blob, `{ projects, sessions, providers, nextId }`). 4-2에서 자동 승인 정책이 추가되면 `dive:auto-approve-policy` 등을 동일 prefix로 추가.
  - **`InMemoryKeyring` 테스트용 주입**: `AppState::with_keyring(Arc<dyn Keyring>)` 빌더를 추가. 기본은 `OsKeyring`(production), 테스트는 `InMemoryKeyring`. keyring 결합을 DI로 풀어서 단위 테스트 + Playwright mock이 같은 코드 경로를 공유.
  - **`.dive/` 자동 생성 + CheckpointEngine::init 자동 호출**: `project_create` / `project_open`이 무조건 둘 다 수행. idempotent이므로 기존 프로젝트 열 때도 안전. 프로젝트 삭제 시 `delete_folder=false`가 기본값 — `.dive/`만 지우고 사용자 코드는 보존(명세 §6.1 위험 옵션 기본 꺼짐).
  - **세션 기본 제목 `"새 세션 YYYY-MM-DD HH:mm"` (KST 고정)**: chrono 의존성 추가를 피하려고 stdlib만으로 civil-date 알고리즘 구현. AI 자동 제목 생성은 4-2 이후로 연기 (모델 호출 1회 필요).
  - **Onboarding은 `?demo=*` 라우트에서 트리거 금지**: MainShell이 URL params에 `demo` 키가 있으면 온보딩 모달을 띄우지 않음. 이 한 줄이 11개 Phase 3 Playwright 회귀를 구원 — 안 그러면 scenario-a/b가 `MainShell`을 임베드하는데 모달 오버레이가 클릭을 차단.
- 대안:
  - **IPC-only (mock 없음)**: 브라우저 데모 `pnpm dev`에서 Sidebar가 완전히 비활성 → Phase 4-5 파일럿 전까지 교사가 UX를 체험 불가. Playwright 회귀도 `tauri dev` 필요해져 CI 비용 폭증.
  - **Tauri 플러그인 dialog 도입** (`@tauri-apps/plugin-dialog`): 폴더 선택 UI가 더 예쁘지만 (a) Cargo + capabilities + CI 체인 전부 갱신 (b) Windows ARM64 호환성 재검증 필요 (c) 4-1 범위를 넘어 Phase 5로 영향. 4-1은 텍스트 입력 form으로 단순화, Phase 4-4 폴리싱에서 dialog 승격 검토.
  - **zustand/middleware/persist 사용**: 라이브러리 없이 직접 `localStorage.setItem`으로 충분. persist middleware는 재수화 타이밍 이슈(React 18 strict mode)가 있어 명시적 컨트롤이 더 안전.
  - **세션 자동 제목을 LLM 호출로**: 4-1 범위 벗어남 + 프로바이더 미연결 상태에서 UX 깨짐. `{timestamp}` 기본값이 실용적.
  - **Radix ContextMenu 우클릭**: 이번에는 `confirm()` + 인라인 삭제 버튼으로 단순화. ContextMenu는 4-4 폴리싱에서.
- 결과:
  - Rust 단위 테스트 +5 (ipc::{project,session,provider}). 총 117 lib passing.
  - Playwright 신규 2 suite = 21 asserts (`verify-onboarding` 12 + `verify-project-session` 9). Phase 3 회귀 11 suite 전부 통과 (2 suite에 `dive:onboarded` pre-set 추가하는 non-invasive 수정).
  - `AppState::with_keyring()` 패턴 덕에 Phase 4-2/4-3의 정책·재시도 테스트도 OS keyring 없이 단위화 가능.
  - Sidebar 하단 "현재 모델" 카드 → `?demo=settings` 푸시 — 4-2가 이 링크를 소비.

## ADR-020: 자동 승인 정책은 process-local + Warn/Danger 도구 잠금 + 다음 차시 초기화

- 일시: 2026-05-04
- 상태: 채택 (작업 4-2)
- 컨텍스트: §8.3은 `AutoApprovePolicy`를 정의하지만 UI 표현과 저장 수명은 열려 있음. 학교 환경 특성(여러 학생이 같은 PC, 차시마다 다른 교사·실습) + 안전 기준(§6.4: Warn·Danger 도구는 항상 수동 승인) + UX 단순성 사이에서 결정 필요.
- 결정:
  - **정책 저장은 process-local `once_cell::Lazy<Mutex<AutoApprovePolicyDto>>`**: 4-2는 설정 UI 레이어만. DB `ProviderConfig.config.auto_approve` 영속화는 4-3에서 `PolicyHook`을 Agent Loop의 실제 디폴트로 연결할 때 함께. 4-2 독립 단위로 머물면 회귀 영향 최소.
  - **Safe 도구만 토글 가능, Warn·Danger는 항상 잠금**: `read_file` / `list_dir` / `search_files` 3개는 체크박스 토글. `write_file` / `edit_file`은 `data-testid="policy-row-locked"`로 disabled 표시 + 시각적 `opacity-60`. 이는 §6.4.1(도구별 위험도 표) + `AutoApprovePolicy::decide`의 Danger 반환 None을 UI에 반영.
  - **"다음 차시 초기화" 기본 on**: `dive:reset-next-session=true` 기본값. 4-3에서 `session_create`/`session_delete` 시 자동 정책 초기화 훅을 연결. 학교 시나리오: 교사가 1차시에 `read_file=always`를 켰어도 2차시 시작 시 리셋 → 학생이 새 교사/실습에서 예상치 못한 자동 승인 안전.
  - **프론트 fallback은 `localStorage` 동기화**: IPC 실패 또는 브라우저 데모일 때 `dive:auto-approve-policy` JSON blob로 대체. 양쪽 경로가 같은 shape을 가지므로 Phase 4-3의 DB 영속화 전환이 non-breaking.
- 대안:
  - **즉시 DB 영속화**: 4-2 범위를 넘어 Agent Loop의 PermissionHook swap + `AppState`에 `Arc<Mutex<PolicyHook>>` 추가 필요. 4-3의 AgentLoop 재시도 로직과 충돌 가능 → 4-3에서 합쳐서 진행.
  - **Warn 도구도 토글 가능**: §6.4 위반. 학교 환경에서 `write_file` 자동 승인은 학생이 파일 시스템을 의도치 않게 변경할 위험 증가. 기본값 잠금.
  - **정책 영구 저장 (차시 간 보존)**: 여러 학생이 같은 PC를 쓸 때 이전 학생 설정이 남으면 보안·학습 혼란. "다음 차시 초기화"가 기본 on.
  - **프로바이더 kind 별 정책 분기**: MVP 초과. 모든 kind가 동일 도구 셋 사용(내장 도구는 provider-agnostic).
- 결과:
  - Rust 테스트 +3 (`ipc::policy::tests` DTO roundtrip + Danger manual + default fallback). 120 lib passing.
  - 4-3의 재시도 + 실제 테스트 실행(bash) 작업이 같은 `AppState` 확장 패턴을 공유하므로 후속 변경 면적 감소.

## ADR-021: CheckpointTimeline은 IPC + mockItems prop 이중 경로 + 26×26px 고정 점

- 일시: 2026-05-04
- 상태: 채택 (작업 4-2)
- 컨텍스트: §5.8.2 체크포인트 타임라인 시각 규격 — 점 26×26px, 색상 4종(init/auto/manual/current). 이를 Tauri 런타임(실제 `checkpoint_timeline` IPC)과 브라우저 데모(mock) 양쪽에서 동작시키며, 회귀 안정성을 깨지 않고 슬라이드 인 하단에 붙일 수 있어야 함.
- 결정:
  - **`mockItems?: TimelineItem[]` prop 주입**: 있으면 Tauri IPC 호출 생략 + 직접 표시. 없으면 `sessionId` 기반 IPC 시도. 두 경로가 같은 React state로 수렴하므로 시각적 회귀 없음.
  - **색상 매핑**:
    - init: 투명 배경 + 회색 테두리 (시작점)
    - auto: success 색 채움 (V 통과 / E 진입 자동 생성)
    - manual: accent 색 채움 (Ctrl+S 수동 저장)
    - current (`data-active="true"`): accent + glow 효과 (`shadow-accent`) — "지금 여기" 표시
  - **호버 툴팁 + 인라인 복원 버튼**: 툴팁이 뜰 때만 복원 버튼 표시. 클릭 → `onRestore(id)` 콜백. 4-4에서 "복원 직전 자동 체크포인트" 확인 다이얼로그와 함께 사용.
  - **`file_changes` 필드 예약만**: 4-2는 0으로 채움. 실제 git tree diff로 파일 변경 수 계산은 4-4 폴리싱에서 (체크포인트 간 `Tree::diff_tree_to_tree` 호출 필요, 비용이 크므로 lazy 계산 검토).
  - **빈 상태 `data-empty="true"`**: 체크포인트 0개일 때 "체크포인트가 없습니다" 메시지. Playwright가 `data-empty`로 분기 검증 가능.
- 대안:
  - **IPC 결과를 워크스토어(Zustand) 전역으로**: 여러 컴포넌트가 공유하지 않으므로 과설계. 슬라이드 인 내부만.
  - **점 크기 CSS 변수화**: §5.8.2가 26×26 고정 명세라 유연성 불필요.
  - **복원 버튼을 툴팁 밖에**: 클릭 영역이 겹쳐 잘못된 복원 유발. 툴팁 내부 명시적 버튼이 안전.
  - **`file_changes` 즉시 계산**: 체크포인트 100개 타임라인이면 git diff 100번 호출 → 렌더 블록. 4-4에서 lazy + debounced.
- 결과:
  - Rust 테스트 +1 (`ipc::timeline::tests::row_to_item_preserves_fields`). Playwright verify-timeline 10 asserts.
  - Phase 4-4에서 실제 git diff 기반 `file_changes` + "복원 직전 자동 체크포인트" + 복원 확인 다이얼로그가 이 컴포넌트를 그대로 확장.

## ADR-022: 재시도는 provider.chat() 시작점만 래핑 + 분류기로 빠른 실패

- 일시: 2026-05-04
- 상태: 채택 (작업 4-3)
- 컨텍스트: §9.6은 "네트워크 오류 시 자동 재시도 3회 후 사용자 노출"을 요구. 실제로 LLM 호출은 HTTP POST → SSE stream 형태라 재시도 경계가 두 단계(connection establish vs mid-stream). 전체 스트림 재시도는 상태 복구(이미 emit된 TextDelta 되돌리기)가 복잡하고, 단순 replay는 idempotency 보장 불가능.
- 결정:
  - **재시도는 `provider.chat(request)` 초기 호출만**: `with_retry` 래퍼가 `BoxStream`을 반환하는 해당 Future만 감싼다. 스트림이 시작된 후의 mid-flight 에러는 `stream.next()` loop에서 `ChatEvent::Error`로 emit되어 UI에서 재시도 버튼으로 수동 처리(4-4).
  - **`is_retryable` 분류기**: 5xx + `reqwest::Error::is_timeout()` + `is_connect()` + `ProviderError::Stream` 파서 에러만 재시도. 400/401/403 + `Auth` + `Unsupported`는 재시도해도 절대 성공하지 않으므로 즉시 표면화. 학교 환경에서 잘못된 API 키로 3번 대기 → 5초 후 실패는 최악의 UX.
  - **지수 백오프 0.5s/1s/2s, max=3**: §9.6 명세 "3회" 준수. 백오프 base 값은 `Duration` 파라미터라 테스트에서 1ms로 축소 가능.
  - **`ChatRequest::Clone` 활용**: 이미 derive된 `Clone`으로 각 재시도 attempt마다 request 복제. 메시지 배열이 크면 오버헤드가 있지만 초당 0.5회 이하 재시도라 무시 가능.
  - **Stream variant를 retryable로 포함**: SSE 파서가 처음 chunk에서 실패하는 경우(서버가 잘못된 Content-Type을 잠깐 반환) 재시도가 유의미. Permanent bug라면 3번 모두 실패.
- 대안:
  - **전체 stream 재시도**: emit된 이벤트 rollback이 UI state machine을 오염. AgentLoop가 assistant_end를 이미 쏜 경우 재시도 시 중복 메시지.
  - **400/401도 재시도**: 명세 위반 + UX 악화. API 키 만료면 즉시 설정 화면으로 유도하는 게 올바름.
  - **linear backoff**: 1+1+1=3초 vs 지수 0.5+1+2=3.5초로 총 시간 유사. 지수는 짧은 장애(0.5초)를 빠르게 복구 + 긴 장애에도 서버 부하 분산.
  - **재시도 수 설정화(설정 화면 슬라이더)**: MVP 초과. 3회 고정이 §9.6 권장.
- 결과:
  - Rust 테스트 +5. AgentLoop `stream_assistant` 1줄 변경으로 통합 완료(125 lib passing / 5 integration scenarios 전부 통과).
  - 4-4에서 mid-stream 에러 토스트 + "다른 프로바이더로 전환" 버튼을 붙일 때 에러 원인이 `retryable=false` / `retryable=true` 구분 정보를 이미 갖고 있음.

## ADR-023: ToastProvider는 root-mount + 4 variant + max 3 + action 선택 콜백

- 일시: 2026-05-04
- 상태: 채택 (작업 4-3)
- 컨텍스트: §9.6 에러 메시지 표시 + 4-4가 사용할 체크포인트 저장 알림 + 복원 확인 전에 토스트 인프라가 필요. 여러 컴포넌트가 토스트를 쏘므로 context + provider가 필수.
- 결정:
  - **`main.tsx`에 `<ToastProvider><App /></ToastProvider>`**: 최상단 mount. `demo=*` 라우트도 토스트가 필요(restore 토스트, 에러 토스트)하므로 App 루트 외 다른 경로 불가.
  - **컨텍스트/hook과 Provider 파일 분리**: `toast-context.ts`는 `createContext` + `useContext` hook만, `ToastProvider.tsx`는 React 컴포넌트만. 이는 eslint-plugin-react-refresh의 `only-export-components` 규칙 + HMR 안정성 때문. 하나의 파일에 컴포넌트 + non-component 둘 다 export 하면 hot reload가 깨짐.
  - **4 variant + max 3 + 5s auto dismiss**: success/info/warn/error + stacking 오래된 것 drop. 동시에 10개 토스트가 뜨면 사용자 panic → 3이 실용적 상한.
  - **선택적 `actionLabel` + `onAction` 콜백**: 에러 토스트에 "다시 시도" 같은 single primary action을 붙일 수 있음. 클릭 시 콜백 + 자동 dismiss. 복잡한 다중 action 필요하면 Dialog로 승격.
  - **`useToast()` fallback**: Provider 밖에서 호출해도 `{ toast: () => "", dismiss: () => {} }` no-op 반환 → 테스트·SSR 안전.
  - **`data-testid="toast"` + `data-variant`**: Playwright가 스크립트 하나로 4 variant 회귀 가능.
- 대안:
  - **shadcn/ui `<Sonner />` 또는 `<Toaster />` 채택**: 의존성 추가 부담 + 현재 스타일 토큰과 맞추는 작업이 직접 구현과 비슷. 직접 구현이 투명하고 번들 크기 작음.
  - **Provider 없이 전역 event bus**: React 트리 외부 side effect → React 18 Strict Mode에서 double-fire. Provider + context가 표준 패턴.
  - **모든 토스트가 action 버튼 필수**: 대부분 정보 제공만 필요. optional이 올바름.
- 결과:
  - Playwright 10 asserts + 16 스위트 통과. 4-4에서 이 인프라를 Ctrl+S 체크포인트 성공 토스트로 재사용 (console.log 제거 경로).
  - Phase 4-4/4-6 i18n 작업이 `toast({ title: t("checkpoint.saved") })` 한 줄로 다국어화 가능한 설계.

## ADR-024: 복원 확인 다이얼로그는 '복원 직전' 자동 체크포인트 계약 명시 + 취소 가능

- 일시: 2026-05-04
- 상태: 채택 (작업 4-4)
- 컨텍스트: §6.5 체크포인트 계약은 "복원 실행 시 현재 상태를 암묵적으로 '복원 직전' 체크포인트로 저장 → 복원은 되돌릴 수 있음"을 보장. 학생에게 이 안전 보장을 UI로 가시화해야 복원 버튼을 두려움 없이 누를 수 있다.
- 결정:
  - **다이얼로그 본문에 계약을 평문으로**: "현재 상태가 '복원 직전' 체크포인트로 자동 저장됩니다. 언제든 되돌릴 수 있습니다." — §6.5 보장을 UI 텍스트로 번역. 학생이 "실수로 복원하면 작업이 사라진다"는 잘못된 멘탈 모델을 갖지 않게 함.
  - **대상 체크포인트 label preview**: `checkpointLabel` prop으로 "어느 시점으로 돌아가는지" 명시 → 타임라인 점 tooltip과 일관성.
  - **"취소" / "복원하기" 2 버튼 only**: 추가 옵션(e.g. "이번 세션만", "영구 고정") 넣지 않음 → MVP 단순성.
  - **성공 경로는 info → success 2-토스트 시퀀스**: 복원 시작 시 info("복원 중"), 완료 시 success("복원 완료"). 빠른 작업이라도 2개 토스트가 "일이 일어났다"는 감각을 줌.
- 대안:
  - **"이 작업을 다시 보지 않기" 체크박스**: 첫 실수 한 번으로 안전장치를 학생이 꺼버릴 위험. 학교 환경은 기본 보수적.
  - **복원 직전 체크포인트를 UI에서 숨기기**: 타임라인에 "복원 직전" 자동 점이 표시되는 쪽이 "되돌리기가 되돌리기 가능하다"는 신뢰 구축에 더 좋음 → 4-2 `CheckpointEngine::create_checkpoint(kind="manual", label="복원 직전")` 그대로 유지.
  - **다이얼로그 없이 복원 즉시 실행**: §6.5 안전 보장이 아무 가치 없어짐. 교실에서 복원 오용 잦을 시 교사 개입 비용.
- 결과:
  - Playwright `verify-polish.mjs` 10 asserts 통과. 17 스위트 합계.
  - MainShell Ctrl+S → 토스트 연결(4-1에서 예고). 3-3 `console.log` 완전 제거.
  - 4-5 파일럿 환경 검증에서 이 다이얼로그가 학생 사용성의 1차 검증 대상이 됨.

## ADR-025: 파일럿 검증은 코드·문서 준비 vs 실제 교실 검증 분리 (Phase 4-5)

- 일시: 2026-05-04
- 상태: 채택 (작업 4-5)
- 컨텍스트: 핸드오프 명세가 요구한 4-5 범위는 (a) 실제 학교 PC에 설치 및 검증 (b) OpenRouter 자식 키 25개 발급 + 25명 동시 호출 시뮬레이션 (c) Cloudflare Workers 짧은 URL 호스팅. 이번 세션은 외부 자원(학교 PC, 충전된 OpenRouter main key, Cloudflare 계정/도메인) 부재로 (a)(b)(c) 세 번째 단계를 직접 수행할 수 없음.
- 결정:
  - **코드·문서 준비는 이번 세션에서 완료**: 교사 체크리스트, 벤치마크 템플릿, Windows 빌드 가이드, 25명 동시 시뮬레이션 스크립트. 모두 "사용자가 실제 자원을 가진 시점에 바로 실행 가능"한 상태.
  - **실제 학교 PC 검증은 사용자 몫으로 명시 이관**: `docs/internal/DIVE_PROGRESS.md` 4-5 완료 노트에 "외부 자원 필요 항목(사용자 실행 대기)" 섹션 추가. Phase 5 진입 전이라도 파일럿 실시 가능.
  - **25명 시뮬레이션은 Playwright로 가능 범위까지**: 실제 OpenRouter 호출 없이 UI 플로우(onboarding → 프로젝트 → 세션)만 25 컨텍스트 동시 실행. 네트워크 stress는 목표가 아니고 UI 동시성·localStorage 충돌 회귀 검증이 목표. 실제 API stress는 유료 실제 키 필요.
  - **Cloudflare Workers는 Phase 5로 연기**: 학교 환경에서 QR 직접 스캔만으로도 25명 배포가 가능함을 ADR-017(OpenRouter provisioning 3-5)이 확인. 짧은 URL은 편의 기능이지 필수가 아님.
- 대안:
  - **4-5를 Phase 5로 완전 이관**: 핸드오프에서 명시적으로 "코드 준비 완료"로 PHASE_GATE를 통과하는 옵션이 있었고 사용자가 이를 택함. Phase 5를 차단할 필요 없음.
  - **무료 OpenRouter 키로 제한된 stress 테스트**: 무료 티어는 $0 한도 + rate limit 엄격 → 25명 동시 호출이 의미 있는 데이터를 주지 못함. 불필요 비용만 발생.
  - **실제 학교 PC 없이 Windows VM으로 대체**: VM은 SmartScreen/Defender 동작이 실제 학교 IT 환경과 다름 → false positive 많음. 실제 하드웨어가 유일한 truth source.
- 결과:
  - 4 docs 신규 (`docs/pilot-checklist.md`, `pilot-benchmarks.md`, `windows-build-guide.md` + 향후 `pilot-feedback.md` 템플릿은 4-6에서 매뉴얼과 함께 추가).
  - `scripts/simulate-25-users.mjs`는 CI 회귀에는 들어가지 않음 — on-demand 벤치마크 도구. `--count N` 파라미터로 규모 조정.
  - Phase 4 PHASE_GATE는 "코드·문서 준비 완료, 실환경 검증 사용자 대기"로 마킹. 실제 검증 후 필요 시 Phase 4-5-post 패치 ADR.

## ADR-026: 파일럿 매뉴얼은 학생·교사·시나리오 3층 구조로 분리

- 일시: 2026-05-04
- 상태: 채택 (작업 4-6)
- 컨텍스트: 4-6은 파일럿을 "학교에서 실제로 돌릴 수 있게" 만드는 문서화가 범위. 누가 읽느냐에 따라 요구 정보가 다름: 학생은 5분 안에 "어떻게 시작?", 교사는 50분 수업 흐름 + 예상 문제, 현장은 차시별 최소한의 일관성(6회차가 다 비슷해야 학생·교사 모두 예측 가능).
- 결정:
  - **3-tier docs**: `student-quickstart.md` (5분, 비개발자 학생용) / `teacher-manual.md` (종합 운영, 교사용) / `scenarios/session-0N.md × 6` (차시 실행 대본, 교사가 매 차시 참조).
  - **시나리오 공통 골격**: 학습 목표 + 전제 + 분 단위 흐름 + 교사 개입 포인트 + 예상 문제 + 종료 체크 + 명세 참조. 6 파일 모두 동일 구조라 교사가 한 파일 익숙해지면 나머지 자동 이해.
  - **난이도 곡선**: 01 (체험) → 02 (권한 카드 교육) → 03 (검증 거부 훈련) → 04 (복원 드릴) → 05 (에러 처리 + 재시도) → 06 (종합 + 발표). 각 차시가 한 가지 DIVE 특성(권한 / 검증 / 복원 / 에러)을 명시적으로 교육.
  - **"실수해도 괜찮다" 심리 안전망**: 차시 04를 복원 드릴로 고정 → 05/06에서 학생이 실험적 지시를 시도할 수 있도록 토대 마련.
  - **차시 06은 파일럿 종료 처리 포함**: OpenRouter 키 폐기, 데이터 백업, 설문 수집 등 6회차 후에만 실행하는 절차를 같은 파일에 묶음 — 검색 부담 감소.
- 대안:
  - **단일 대형 "교사 매뉴얼" 파일**: 50KB 이상 되고 차시별 검색이 비효율. 교사가 "오늘 어떻게?"를 빠르게 찾지 못함.
  - **공식 교재 형식 (Google Docs)**: 버전 관리·diff가 힘듦. 현장 교사가 자유롭게 fork+수정할 수 있는 Markdown이 개방적.
  - **PDF 출력**: 필요하면 pandoc로 변환. 원본은 Markdown.
  - **다국어 동시 제공**: Phase 6의 i18n 작업. 4-6은 한국어 원본 확정.
- 결과:
  - 학생 quickstart 1 + 교사 manual 1 + 시나리오 6 = 총 8 신규 문서. 전체 ~700줄.
  - 차시 간 의존성 명시 — 02는 01의 파일 재사용, 04는 03 상태 전제. 복사·이동 시 전제 깨지지 않게 주의 필요.
  - Phase 4 PHASE_GATE 조건 중 "사용자 매뉴얼 + 6차시 시나리오"가 이로써 충족. 실제 교실 walkthrough는 사용자 몫.

## ADR-027: Codex OAuth는 PKCE(S256) + 코드 붙여넣기 fallback + 토큰은 3-scope Keyring 저장

- 일시: 2026-05-04
- 상태: 채택 (작업 5-1)
- 컨텍스트: 명세 §7.4는 ChatGPT Plus/Pro/Team/Enterprise 구독으로 Codex를 호출하는 흐름을 기술. PKCE 기반 OAuth라 client secret 없이 public client로 동작. 표준 흐름은 시스템 브라우저 실행 + `localhost:1455` 콜백 서버 수신. 하지만 (a) 헤드리스 테스트 환경에서는 브라우저 자동화가 불안정, (b) Playwright가 실제 chatgpt.com OAuth 페이지를 주행하는 것은 사용자 계정이 필요하고 자동화 ToS 위반 위험, (c) wiremock으로 대체 가능한 범위가 어디까지인지 명확화 필요.
- 결정:
  - **PKCE S256 + RFC 7636 준수**: 32-byte verifier → SHA-256 → URL-safe base64 challenge. 고정 client_id (Codex CLI 참조값).
  - **토큰 저장은 3-scope Keyring 분리**: `SecretScope::Codex{Access,Refresh,Id}Token`. DB `ProviderConfig`는 `auth_type="oauth"` 메타만, 민감값은 키링. 기존 §7.7 / §10.4 정책(1-5 ADR-013)과 정합.
  - **id_token JWT 서명 검증은 하지 않음**: 토큰이 TLS로 `auth.openai.com`에서 직접 수신된 직후 파싱되며, 실제 API 호출은 서버가 재검증한다. `account_id` 클레임은 라우팅 힌트에 불과(보안 경계 아님). jsonwebtoken 등 크립토 라이브러리 의존 회피로 빌드 시간·ARM64 호환성 이득.
  - **UI는 phase 기반 + 코드 붙여넣기 fallback**: idle/waiting/done/error 4-phase. `[ChatGPT 연결]` → 시스템 브라우저 열기 → 리다이렉트 URL에서 `code=` + `state=` 추출해 붙여넣기. Codex CLI의 `--paste-code` 모드와 동등하며, 헤드리스·CI·데모 환경에서도 동일 UI로 검증 가능. 실제 localhost 콜백 서버는 Phase 5-6 통합 테스트 또는 실사용 시점에 선택 가능(UI 변경 없음).
  - **검증은 wiremock 전용**: `/oauth/token` 교환·갱신을 로컬 mock 서버로 커버. 실제 `auth.openai.com` + 브라우저 리다이렉트는 사용자 실환경 검증으로 분리(ADR-025와 동일 패턴).
  - **CSRF state는 32-byte random + server-side verify**: `start`가 생성한 state를 pending-flow에 저장, `complete`에서 정확히 일치 여부만 확인. mismatch 시 즉시 오류.
- 대안:
  - **jsonwebtoken crate로 id_token 서명 검증**: 과공학. OpenAI JWKS 동기화 부담 + ARM64 crypto 빌드 의존 증가. 이득은 "중간자가 위조한 id_token이 DB에 기록될 수 있음" 리스크이지만 이미 tokens.access_token이 실 호출에서 서버 검증됨.
  - **localhost:1455 콜백 서버를 기본 UX로**: 사용자가 코드 복사·붙여넣기 할 필요 없어 편의성 ↑. 그러나 방화벽·다른 애플리케이션과 포트 충돌 시 폴백 UX 필요 → 어차피 paste 모드가 존재. Phase 5-6 폴리싱에서 옵션 추가 여지.
  - **Playwright가 실제 chatgpt.com 주행**: 테스트 안정성 낮음(OpenAI가 captcha·2FA·UI 변경). 또한 OpenAI ToS상 자동화 로그인 금지 가능성.
  - **별도 `CodexProvider::openrouter` 같은 특수 생성자**: OpenRouter는 이미 `OpenAiProvider::openrouter`로 해결됨. Codex는 고유 헤더(`ChatGPT-Account-ID`, `OpenAI-Beta`) 때문에 별도 provider 필요.
- 결과:
  - +31 Rust 테스트, +1 Playwright 스위트(17 assertions), Settings UI 1 카드 재작성 + 1 다이얼로그 신규
  - 기존 onboarding / project-session / settings(4개 assertion 갱신 반영) 회귀 모두 통과
  - 실제 OAuth 플로우 E2E 검증은 5-6 통합 테스트 또는 사용자 파일럿 시점에
  - `CodexProvider`는 Agent Loop와 직접 연결되지 않음 — 현재 `AppState`는 생성 시 provider 1개 고정. Codex로 스위칭은 5-6 단계에서 provider factory + `ai_assist`/`verify` 엔진 재사용 방식 재검토

## ADR-028: MCP 클라이언트는 rmcp 대신 경량 직접 구현 + 도구는 권한 카드로 위임

- 일시: 2026-05-04
- 상태: 채택 (작업 5-2)
- 컨텍스트: 명세 §8.5는 `rmcp` crate 사용을 제안. 그러나 (a) rmcp는 alpha 단계(v0.x)라 API가 유동적, (b) Windows ARM64 타겟에서 의존성(특히 SSE/WebSocket 스택) 빌드 호환 미검증, (c) DIVE가 MCP에서 실제로 호출하는 메서드는 `initialize` + `tools/list` + `tools/call` 3개뿐, (d) 스트리밍 notifications(서버 push)는 v0.3 파일럿 범위에서 불필요. 추가로 stdio/HTTP 양방향 transport 통일 추상화가 이후 권한 카드 통합(5-3)에서 재사용되므로 우리 도메인에 맞춘 직접 구현이 유지보수 친화적.
- 결정:
  - **JSON-RPC 2.0 직접 구현(약 220줄)**: request id 단조 증가, `result` 또는 `error` 중 하나 검증, protocol version `2024-11-05` 하드코딩. 도구 메타데이터 파싱 시 `annotations.riskLevel` 힌트를 `risk_hint: Option<String>`로 수집(5-3에서 기본 위험도와 병합).
  - **Transport trait + 3 구현**: `HttpTransport`(reqwest POST /rpc + custom headers), `StdioTransport`(tokio subprocess line-delimited JSON), `MockTransport`(테스트·데모용 VecDeque). 각 구현이 독립적이라 단위 테스트에서 transport별 격리 가능.
  - **DB 마이그레이션 v3 = McpServer 단일 테이블**: label UNIQUE(사용자 식별자), transport/default_risk CHECK 제약. `args`/`env`/`headers`는 JSON TEXT(쿼리 미지원이지만 우리 쿼리는 label/id만). 기존 DAO 패턴(순수 함수)과 동일.
  - **IPC는 5개로 최소화**: add/list/remove/set_enabled/test_connect. `test_connect`는 `connect → initialize → list_tools` 3-step을 1 호출로 수행 — UI는 "연결 테스트" 버튼 하나로 서버 건강성 + 도구 수 확인 가능.
  - **5-3으로 이어지는 계약**: `McpToolInfo { name, description, input_schema, risk_hint }`은 그대로 `Tool` trait을 감싸는 어댑터로 주입될 수 있도록 설계. `risk_hint` + `McpServerRow.default_risk` 순서로 병합(5-3 결정).
  - **UI: stdio args는 textarea 한 줄 = 1 arg**: JSON array 요구보다 교사 친화. 서버 측에서 `serde_json::json!(arr)`로 직렬화.
  - **실제 MCP 서버 E2E는 사용자 몫**: `npx @modelcontextprotocol/server-filesystem` 등 npm 패키지는 CI에서 spawn하지 않음(설치·격리 비용). 대신 unix `cat` 기반 stdio roundtrip 테스트로 transport 계약 자체는 검증. 실사용 서버 호환성은 파일럿에서.
- 대안:
  - **rmcp 그대로 채택**: alpha API 변화 리스크 + ARM64 빌드 사이드 이펙트(특히 SSE streams) + streaming notifications 미활용. 득보다 실.
  - **JSON-RPC 2.0 대신 MCP HTTP의 향후 "Streamable HTTP" 표준 직접 구현**: 스펙이 아직 변동 중(SSE vs chunked vs WebSocket). 5-6 통합 테스트 이후 선택.
  - **McpServer 도구를 DB ToolCall 테이블에 원격 도구 플래그로 합치기**: 위험도 병합 로직이 쿼리 경로에 스며들어 복잡도 ↑. 독립 테이블로 명확한 경계.
  - **localhost 콜백 없는 stdio-only**: 교사가 등록하는 "학습용 MCP 서버(채점 검증 등)"는 HTTP 서버 형태가 더 일반적. 두 transport 모두 필수.
- 결과:
  - +24 Rust 테스트, +1 Playwright 스위트(18 assertions), Settings UI 1 섹션 신규 + 추가 form 1개
  - DB 마이그레이션 v2 → v3 (append-only). 기존 테이블/인덱스 9+4 유지 + 신규 1
  - `McpClient`는 `Agent Loop`에 아직 연결되지 않음 — 5-3이 `ToolRegistry`에 MCP 도구 등록 + 권한 카드 라우팅을 붙이면서 정식 연결
  - rmcp 전환 여부는 5-6 통합 테스트에서 스트리밍 notifications 또는 OAuth 필요가 발생할 때 재검토

## ADR-029: MCP 도구는 `mcp__{server}__{tool}` 네임스페이스 + MAX(default_risk, risk_hint) 병합

- 일시: 2026-05-04
- 상태: 채택 (작업 5-3)
- 컨텍스트: 5-2의 McpClient 인프라가 만들어낸 도구 메타데이터(`McpToolInfo`)를 DIVE의 `Tool` trait에 맞춰 ToolRegistry에 정식 등록해야 함. 몇 가지 설계 질문: (a) 이름 충돌 방지(서로 다른 MCP 서버가 동일 도구 이름을 노출하는 경우 + built-in과 충돌) (b) 위험도 결정 — 서버가 힌트를 주지만 교사가 default_risk를 설정한 경우 어느 쪽을 우선? (c) 권한 카드 UX에서 "이 도구가 MCP 출처"임을 어떻게 명시? (d) Agent Loop는 도구 이름 문자열로 registry lookup하는데 모델이 `mcp__` 접두사까지 정확히 생성할 수 있는가?
- 결정:
  - **네임스페이스 규약**: `mcp__{server_label}__{remote_name}`. `mcp__` 접두사 + `{label}__` + 원격 도구 이름. 구분자 `__` 2자는 도구 이름에 거의 등장하지 않아 파싱 안정적. 서버 label은 UNIQUE 제약(5-2)이므로 충돌 불가.
  - **Built-in 우선**: ToolRegistry에 동일 이름 등록은 덮어쓰기지만, built-in은 `mcp__` 접두사가 절대 없으므로 실제 충돌 발생 불가. 대신 MCP 서버가 `read_file` 같은 이름을 노출해도 `mcp__fs__read_file`로 qualified되므로 built-in `read_file`과 공존.
  - **위험도 MAX 병합**: `MAX(default_risk, risk_hint) = 더 위험한 쪽`. 이유: (1) 안전-쪽 실수 = 교사가 default_risk=safe로 설정했는데 서버가 hint=danger이면 `danger`로 올림 → 실수로 자동 승인되는 것 방지. (2) 위험-쪽 실수 = 서버 hint=safe지만 교사가 default_risk=danger로 설정하면 `danger` 유지 → 서버의 낙관적 힌트를 신뢰하지 않음.
  - **카드 UX에서 출처 배지**: `info` variant Badge(파스텔 보라) + 🔌 Plug 아이콘 + `MCP · {server_label}` 문구. `data-mcp-server` + `data-mcp-remote` 속성으로 Playwright·접근성 둘 다 지원. Safe/Warn/Danger 3종 카드 헤더 + ToolCallMessage 일반/차단 variant 모두 일관 적용.
  - **모델에게 도구 이름 노출**: ToolRegistry → ToolDef 직렬화 시 `mcp__fs__read_file`이 그대로 이름으로 전달. 이름에 `_`가 들어가도 OpenAI/Anthropic 함수 호출 API 양쪽 모두 허용(검증됨). 모델이 이름을 정확히 생성할 책임은 모델·provider SDK가 진다 — DIVE는 registry lookup 실패 시 "not registered" ToolResult로 모델에게 피드백.
  - **test_connect와 list_tools IPC 분리**: 5-2 단일 `test_connect`가 초기화 + 도구 목록 + 결과를 한꺼번에 돌려주는 것은 UI "연결 건강성 점검" 용도. 별도 `mcp_server_list_tools`는 설정 페이지 드릴다운(도구 수 확인) 용도. 두 IPC 모두 같은 `connect_and_initialize` 내부를 재사용.
- 대안:
  - **네임스페이스 대신 registry에 server_id 필드 추가**: lookup 시 `(name, server_id)` 쌍 필요 → Agent Loop의 ToolCallEvent payload에 server_id를 추가해야 함 → provider wire format 확장 필요 → 불필요한 복잡성.
  - **risk_hint 우선**: 서버 제공자가 도메인 전문가라는 논리. 그러나 교사가 교실 맥락에 맞춰 default를 올렸다면 그 판단이 더 신뢰할 만함. "안전-쪽 실수"를 피하는 원칙으로 MAX 선호.
  - **배지 아이콘으로 lucide `Server` 또는 `Cable`**: `Plug`가 "연결됨" 은유로 가장 직관적. 나중에 교체 여지.
  - **MCP 도구를 built-in과 동일 이름으로 등록(서버 우선)**: "사내 MCP로 더 안전한 read_file을 제공하는 케이스"를 지원할 수 있으나 기본 기대가 깨짐(built-in이 없어졌다는 착각). 네임스페이스가 더 예측 가능.
- 결과:
  - Phase 5-4~5-6이 이 결정을 기반으로 동작: 프롬프트 도우미(5-4)는 `mcp__` 접두사를 감지해 `"MCP 도구를 직접 호출하면 서버 검증이 필요함"` 힌트를 줄 수 있고, 통합 테스트(5-6)는 `AppState`에 MCP client 캐시를 추가해 앱 시작 시 enabled 서버 자동 연결하면 됨.
  - UI 일관성: 3종 권한 카드 + ToolCallMessage 2종 variant에 동일 출처 배지. 접근성은 Phase 6에서 `aria-label="MCP 출처 {server}"` 추가.
  - "not registered" 실패 메시지는 모델이 실수로 `mcp__nonexistent__foo`를 생성해도 자동으로 다시 정정할 수 있게 도와줌(재귀 호출 없이 다음 턴에서 자체 수정).
  - rmcp 전환 여부는 여전히 5-6에서 결정 (ADR-028 유지).

## ADR-030: 프롬프트 도우미는 순수 TS 정규식 + 단계별 템플릿 + 데이터 노출 0

- 일시: 2026-05-04
- 상태: 채택 (작업 5-4)
- 컨텍스트: 명세 §6.6.2는 "실시간 모호함 감지"를 외부 호출 없이 로컬에서 처리하라고 요구한다(개인정보 보호). 두 가지 구현 노선이 가능: (A) 정규식 + 휴리스틱, (B) 클라이언트 사이드 경량 언어 모델(예: transformers.js). 또한 "JS 단위 테스트 러너"가 DIVE 프로젝트에 아직 없고(Playwright만 있음), 이를 도입하면 빌드·CI 복잡도가 늘어난다.
- 결정:
  - **정규식 + span 기반 감지**: 5 규칙(지시 대명사 / 모호한 시점 / 모호한 주어 / 모호한 수량 / 대상 누락)을 `(pattern, kind, suggestion)` 튜플로 정의. `detectAmbiguity(text) -> AmbiguityHit[]`는 span 정렬 + 겹침 제거. 결과는 `[start, end]` 인덱스이므로 underlay mark 렌더에 그대로 쓸 수 있음.
  - **JS `\b` 포기**: 한국어는 `\b` 워드 바운더리가 동작하지 않음(ASCII 문자 경계 전용). 대신 "~줘/~해줘" suffix를 명령어 규칙에 하드코딩해 불필요한 매치 방지. 예: `missing_target`은 "지워줘/삭제해줘/…"처럼 어미까지 포함한 정확 매치 + "(문장 끝 또는 구두점)" lookahead로 "바꿔줘 파일명" 같은 완전한 명령은 통과.
  - **단계별 템플릿 SSOT**: 8 템플릿 각각 `stages: DiveStage[]`로 멀티-스테이지 선언. 현재는 1 템플릿 = 1 단계지만 Phase 6에서 "여러 단계에 공통 쓸 수 있는" 템플릿 확장 여지. 필터는 `templatesForStage(stage)`.
  - **Playwright로 단위 검증 대체**: `window.__test_detect_ambiguity` / `window.__test_prompt_templates` 글로벌 노출(demo 페이지 mount 시점에만). Playwright가 `page.evaluate()`로 직접 호출해 span·kind를 검증. vitest 도입은 Phase 6로 연기 — 추가 CI 러너는 지금 필요 없음.
  - **Underlay pointer-events-none**: textarea 위에 absolute mark overlay. 키보드 포커스·커서·선택 동작을 방해하지 않음. `whitespace-pre-wrap`으로 textarea 래핑 규칙 맞춤.
  - **500ms debounce**: 명세 정의값 그대로. 타자 중 감지가 깜빡이는 것을 방지.
- 대안:
  - **transformers.js 또는 tree-sitter-korean**: 품질 ↑, 그러나 wasm 적재 시간(3~10MB) 및 ARM64/Windows 호환 검증 필요. 교실에서의 첫 입력 응답성 우선이라 과공학.
  - **서버(백엔드 Rust)로 감지 위임**: 로컬 전용 원칙에는 부합하나 IPC 왕복 비용이 타자 중 매 keystroke마다 발생. 프론트 완결이 맞음.
  - **vitest/jest 즉시 도입**: 빌드 시간·의존성 증가 vs 얻는 이득(빠른 단위 회귀)이 현재로서는 작음. Playwright로 충분 검증됨. Phase 6 접근성 정리와 함께 재검토.
  - **한 규칙에 `\p{Script=Hangul}` 사용한 복잡한 look-around**: JS `u` 플래그로 가능하나 가독성↓. 현재 suffix 화이트리스트가 명확.
- 결과:
  - +16 Playwright 검증, 0 신규 CI 러너, 이전 회귀 전부 유지(21 suites / 330 assertions)
  - 한국어 특화 규칙 품질은 파일럿 데이터로 튜닝 예정 — `docs/pilot-benchmarks.md`에 "모호함 감지 오탐/누락 비율" 지표 추가 여부를 5-6 통합 이후 결정
  - "보내기 전 점검"(§6.6.3, 모델 자체 비평)은 5-5에서 — 모델 호출 1회 추가 + 토큰 사용량 표시까지. 5-4는 외부 호출 0 원칙 유지

## ADR-031: 보내기 전 점검은 single-tool tool_choice + 3-way 적용 + 토큰 수 즉시 표시

- 일시: 2026-05-04
- 상태: 채택 (작업 5-5)
- 컨텍스트: §6.6.3는 "모델 호출 1회로 프롬프트 자체 비평 + 사용자가 제안을 수락·무시 선택 + 토큰 사용량 표시"를 요구. 우리는 이미 3-2 VerifyEngine과 3-2 AiAssistEngine에서 single-tool `tool_choice::Specific` 패턴을 검증했음(구조화된 응답이 `serde_json` 한 번에 역직렬화 가능). 같은 패턴을 prompt-critique에도 적용한다.
- 결정:
  - **단일 도구 `prompt_review`** 강제: `{issues: [{kind, span?, excerpt, suggestion}], refined_text}` 응답만 받음. span은 optional(모델이 정확한 문자 인덱스를 항상 맞추지 못함 → span 누락 시에도 issue 표시 가능).
  - **3-way 적용 footer**: `닫기` / `제안 적용만` / `제안 적용 + 전송`. "적용만"은 사용자가 refined text를 더 다듬고 싶을 때(일반적). "적용 + 전송"은 신뢰해서 즉시 보내고 싶을 때(단축). 기본 위치는 primary 버튼에 "적용 + 전송"을 두지만, 위험도 낮은 "적용만"을 왼쪽에 두어 실수 클릭 방지.
  - **토큰 수는 `ChatEvent::Usage` 단일 소스**: 이미 provider 어댑터에서 emit되고 있음(OpenAI/Anthropic 모두). `prompt_tokens + completion_tokens`를 합산해 `approximate_tokens`로 표면화. 가격 환산은 provider-specific이라 Phase 6로 연기.
  - **다이얼로그 state reset on re-open**: `useEffect(!open)`으로 result/loading/error 초기화. 5-4의 PromptHelperPanel과 마찬가지로 "열 때마다 새로운 세션"을 보장.
  - **Ctrl+Shift+Enter vs 버튼**: 키보드 사용자 + 마우스 사용자 둘 다 지원. Shift+Enter는 이미 줄바꿈이라 Ctrl/⌘을 추가로 요구. `navigator.platform` 분기 없이 `e.ctrlKey || e.metaKey`로 양 OS 동시 수용.
  - **5-4와 5-5 분업 유지**: 5-4 정규식 감지는 항상 활성(외부 호출 0, 타자 중 실시간). 5-5 모델 비평은 명시적 행동(클릭/단축키). 둘 결과를 합치는 "smart merge" 로직은 의도적으로 없음 — 사용자가 선택하도록 둔다.
- 대안:
  - **ChatEvent::Done에 모델의 자유 형식 응답 파싱**: 하위호환성 좋지만 JSON 파싱 실패 위험 + 모델이 매번 포맷 안 맞춤. single-tool이 확실.
  - **Streaming UI (타이핑하는 동안 issue들이 점점 나타남)**: UX 좋지만 구현 복잡도 ↑, 이 기능은 "클릭 후 몇 초 기다리는" 사용 패턴이므로 과잉.
  - **Refined text가 너무 짧을 때 경고**: 현재는 그대로 표시. 실 데이터에서 "과도하게 압축된" 케이스가 보이면 6월 파일럿 이후 휴리스틱 추가.
  - **5-4 감지 결과를 prompt에 첨부해 모델에게 전달**: 모델이 중복 감지하지 않도록. 이번 세션에선 복잡도 회피 — 모델이 혼자서 판단. 6-Phase에서 필요시 추가.
  - **토큰 비용 $ 환산 표시**: provider별 모델별 가격 테이블 유지 부담. 숫자만 표시.
- 결과:
  - +7 Rust 테스트, +1 Playwright 스위트(15 assertions), UI는 ChatInput에 버튼 1개 + 단축키만 추가 (인지 부담 ↓)
  - 5-6 통합 테스트는 이 다이얼로그를 시나리오 B(교사가 복원 드릴 연습)에 끼워 넣어 "AI 자체 비평 → 토큰 인지 → 명시적 적용"의 풀 플로우를 검증할 수 있다
  - 실제 모델 연결은 `prompt_check_review` IPC로 즉시 가능 — provider가 어떤 것이든(1-4/3-5/5-1) 동일 trait로 주입

## ADR-032: Phase 5 v0.3 통합은 랜딩 페이지 + Rust e2e 1건 + 23 스위트 회귀로 종결

- 일시: 2026-05-04
- 상태: 채택 (작업 5-6)
- 컨텍스트: 5-6의 목표는 "Phase 5 모든 기능이 서로 간섭 없이 end-to-end 동작"을 증명. 하지만 (a) 실제 Codex 계정·MCP npm 패키지 의존은 ADR-025 패턴대로 사용자 실환경으로 이관, (b) 21개 기존 스위트 + 2개 신규(5-4/5-5)로 UI 회귀는 이미 커버됨. 추가로 필요한 것은 "기능들이 서로 엮인 흐름이 자동 테스트에 존재하는가"의 증명.
- 결정:
  - **Rust end-to-end 1건만 추가**: `tests/phase5_e2e.rs` — Codex-style MockProvider + MCP MockTransport를 AgentLoop 한 번의 실행에 결합. 이 하나의 테스트가 ① Agent Loop가 MCP 네임스페이스를 정확히 resolve한다는 것, ② MCP tools/call 응답을 ToolResult로 변환한다는 것, ③ 다음 iteration에서 모델이 결과를 소비한다는 것을 모두 보인다. 별도 시나리오 테스트 다수를 만들기보다 이 "한 줄기 플로우"가 더 강한 증명.
  - **랜딩 페이지는 얇게**: `pages/phase5-integration.tsx`는 5개 feature 카드 + 각 demo로 링크 + Rust 통과 배너만. 실제 검증은 기존 22 스위트가 모두 돌아가는 것으로. 랜딩 자체는 13 assertion(카드 렌더 + 네비게이션 + end-to-end ambiguity→check 플로우)만 검증.
  - **Rust 테스트 수는 하드코딩**: 랜딩 배너의 "238 passed"는 현재 세션 수치. Phase 6 CI 연동 시점에 자동 갱신 예정. 파일럿 시연 시 Rust 테스트가 더 붙을 수 있지만 배너는 "대략적 신뢰 지표"로만 취급.
  - **`AppState`에 MCP client 캐시 도입은 연기**: 현재 테스트는 `McpServerRegistry::build_adapters`로 직접 ToolRegistry에 등록하는 방식만 검증. 실제 앱 lifecycle(시작 시 enabled 서버 자동 연결 + 종료 시 child 프로세스 정리)은 Phase 6-4 NSIS 패키징 작업과 함께 Rust main loop 구조를 재검토할 때 다룬다.
  - **실환경 검증은 사용자 몫**: Codex OAuth, MCP npm 서버, HTTP MCP 인증은 유료/외부 계정 필요. docs/internal/PHASE5_HANDOFF.md에 체크리스트로 명시.
- 대안:
  - **여러 개의 end-to-end 테스트** (Codex-only / MCP-only / Combined): 같은 모크 인프라를 반복 설정하는 비용 vs 한 테스트가 실패해도 어느 계층인지 알 수 있는 이점. 기존 통합 테스트(`ai_assist_engine.rs`, `verify_engine.rs`, `mcp_tool_integration.rs`)가 각 계층을 이미 커버하므로 phase5_e2e는 "결합" 레이어만 검증.
  - **Playwright로 모든 5 feature를 한 페이지에서 직접 재생**: Tauri IPC가 요구되는 Codex status / MCP test_connect 등은 브라우저 mock fallback에 의존. 랜딩 페이지에서는 네비게이션 + 기존 데모 재사용이 더 유지보수 친화적.
  - **수동 walkthrough 문서**: 핸드오프에 체크리스트로만 남기고 자동 테스트 없음. 자동화 이득(회귀 방지) 포기.
- 결과:
  - +1 Rust 테스트, +1 Playwright 스위트(13 assertions), +1 데모 페이지. 전체 Rust 237 → 238, 전체 Playwright 22 → 23 스위트 / 345 → 358 assertions
  - Phase 5 PHASE_GATE 진입 — `docs/internal/DIVE_NEXT.md` / `docs/internal/DIVE_PROGRESS.md` / `docs/internal/PHASE5_HANDOFF.md` 세트 업데이트
  - Phase 6 진입 시 5-4 한국어 정규식에 영어 룰 추가, 5-5 토큰 비용 환산 UI 등 다국어·정식 릴리스 마감이 이어진다

## ADR-033: i18n은 i18next 없이 JSON + Zustand persist + useT() 커스텀 훅으로 충분

- 일시: 2026-05-04
- 상태: 채택 (작업 6-1)
- 컨텍스트: 명세 §2.5 / §12.3는 ko-KR · en-US 2개 로케일 동등 지원만 요구. 5개 이상 로케일 확장, 복수 형태(plurals), 날짜·숫자 포맷 같은 `i18next` 본격 기능은 필요하지 않다. 동시에 기존 상태 관리는 전부 Zustand로 통일되어 있어(이론적 선택: React Context · Zustand · Redux) 언어 상태를 별도 인프라에 올릴 이유가 없다. Phase 6에서 접근성·NSIS·릴리스 작업이 이어지므로 런타임 번들 사이즈도 가볍게 유지해야 한다.
- 결정:
  - **커스텀 `t(key, params?)` 함수**: 점 표기(dot notation) 키 조회 + `{{name}}` 보간. 전체 엔진이 ~90줄(`dive/src/i18n/index.ts`). i18next 런타임 의존 0.
  - **리소스는 JSON + ES module import**: `ko.json`, `en.json`을 Vite가 번들 타임에 포함. 비동기 로더 없음 — 첫 페인트에 바로 번역 사용 가능.
  - **Zustand persist 스토어(`dive:locale`)**: 로케일 선택은 `localStorage` 자동 영속. 백엔드 왕복 없음. 첫 실행 시 `navigator.languages`로 ko/en 감지 후 저장.
  - **Fallback chain: active locale → ko → key 자체**: 미번역 키가 UI를 깨지 않도록 한국어 폴백 후, 최종적으로 키 문자열을 그대로 반환. 테스트에서 untranslated 키 검출 용이.
  - **Sidebar 내부 언어 전환 토글**: 별도 설정 페이지 이동 없이 사이드바 하단 `role="group"` + `aria-pressed`로 제공. 언어는 자주 바뀌는 설정이 아니므로 최소 공간(1행).
  - **첫 번째 대상은 Sidebar + MainShell 배너**: 카드 내부 상태 라벨(`card-state-meta.ts`) 같이 테스트 케이스가 문자열에 의존하는 지점은 이번 작업에서 그대로 두고, 후속 6-2/6-3에서 `data-*` 속성 기반으로 리팩터 후 번역. 점진 전환.
- 대안:
  - **react-i18next 도입**: +~25KB min+gzip, 비동기 네임스페이스 로딩, Suspense 통합. 2 로케일에는 과잉.
  - **LinguiJS (ICU 포맷)**: 빌드 타임 카탈로그 추출이 훌륭하지만, DIVE는 단순 보간 이상이 필요 없음. 빌드 파이프라인 복잡도 증가 대비 이득 적음.
  - **전역 Context + useReducer**: Zustand를 이미 쓰고 있는데 별도 Context로 분리하면 컴포넌트 구독 방식 일관성 붕괴.
  - **`src-tauri/src/i18n/`에 Rust side 번역도**: 현 단계 Rust는 UI 문자열을 거의 내보내지 않음(IPC 응답은 대부분 enum/번호). 필요해지면 ko/en JSON 하나를 공유하고 serde로 읽는 방식으로 확장 가능. 이번 작업에서 하드 스크리핑 대신 TypeScript 단일 소스만.
- 결과:
  - Rust 회귀 없음(Rust 쪽에 번역 로직 0). 프론트: +3 파일(index.ts, ko.json, en.json), +1 Playwright 스위트(verify-i18n 13 assertions), 기존 23 스위트 회귀 없음 확인
  - 6-2 접근성 작업은 aria-label을 번역된 리소스에서 직접 사용 가능(이미 Sidebar에서 `t("a11y.region_sidebar")` 적용). 6-5 릴리스 README는 영어 버전도 동시 제공 가능.
  - 번들 사이즈 영향 미미(ko/en JSON 합계 ~8KB raw, gzip ~2KB)

## ADR-034: 단축키는 단일 `useGlobalShortcuts` 훅으로 통합 + 폼 필드 자동 억제

- 일시: 2026-05-04
- 상태: 채택 (작업 6-2)
- 컨텍스트: 명세 §12.2는 Ctrl+N/S/, /E/W/ /의 6개 단축키 세트를 요구. 기존 MainShell에는 Ctrl+S만 ad-hoc `useEffect`로 있었다. 추가 단축키를 같은 패턴으로 확장하면 6개의 `useEffect + keydown listener`가 MainShell에 축적되어 유지보수가 어렵다. 동시에 "사용자가 텍스트를 타이핑 중일 때 Ctrl+N이 다이얼로그를 여는" 버그가 발생하면 입문자에게 치명적이라 기본 억제가 필요하다.
- 결정:
  - **단일 `useGlobalShortcuts({ ... })` 훅**: 모든 단축키 등록을 한 곳에서. MainShell은 핸들러만 전달. 새 단축키 추가 시 훅 내부 switch만 확장하면 됨.
  - **폼 필드 자동 억제**: `isTypingInFormField`로 `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable` 감지. Ctrl+N·Ctrl+E·Ctrl+W는 폼 안에서 발화 시 무시(사용자가 텍스트 편집 중이라는 신호). Ctrl+S·Ctrl+,·Ctrl+/는 "저장", "설정", "도우미 열기"로 폼 안에서도 의미가 유효하므로 억제하지 않음.
  - **모디파이어 조건**: `ctrlKey || metaKey`를 모두 수용(Windows/macOS 공통). `altKey`는 명시적으로 배제(Alt는 브라우저 메뉴 트리거로 충돌).
  - **Shift 조합 배제**: `Ctrl+Shift+N` 등은 브라우저 기본 단축키(새 시크릿 창)와 충돌하므로 `if (e.shiftKey) return`으로 조기 종료.
  - **대문자/소문자 둘 다 처리**: `case "n": case "N":` — Caps Lock 상태에서도 동작.
  - **이벤트 대상은 `window`**: 컴포넌트 루트가 아닌 전역. ESLint에 경고가 없고 cleanup도 간단.
  - **슬라이드 인 패널은 토글(open↔close)**: 다른 경로(설정·프롬프트 도우미)는 URL 이동이라 "다시 누르면 돌아옴"이 자연스럽지 않지만, 슬라이드 패널은 같은 공간에서 켜고 끄는 것이 명세 §5.4의 의도에 부합.
- 대안:
  - **각 단축키마다 개별 훅**(`useNewProjectShortcut`, `useCheckpointShortcut` 등): 재사용성은 좋지만 등록 순서·우선순위 제어가 어렵고 같은 keydown을 중복 처리.
  - **전역 이벤트 버스**: pub-sub 패턴. DIVE 규모에서는 과잉 엔지니어링.
  - **Radix `useKeyboard` 사용**: Radix는 DropdownMenu 등에 한정되어 전역 단축키에는 부적합.
  - **IME(한글 입력) 도중 키 감지 억제**: `e.isComposing` 체크 추가 여부 — 현재는 단축키가 Ctrl 조합이라 한글 IME와 충돌 거의 없음. 만약 7월 파일럿에서 한글 입력 중 Ctrl+,가 동작 안 한다는 보고가 오면 `if (e.isComposing) return` 추가.
- 결과:
  - +2 파일(useGlobalShortcuts.ts, verify-a11y.mjs), +1 테스트 스위트(12 assertions)
  - MainShell의 기존 Ctrl+S `useEffect`는 훅 호출로 대체 (-10줄 +25줄 — 순증이지만 6개 단축키 커버)
  - 기존 23 스위트 전부 pass (회귀 없음)
  - Toast `aria-live="polite"` 추가로 체크포인트 저장·도구 결과 등의 상태 변경이 스크린리더에 자동 통보됨

## ADR-035: WCAG 대비는 런타임 Playwright 계산으로 검증 + Link 버튼만 토큰 교체

- 일시: 2026-05-04
- 상태: 채택 (작업 6-3)
- 컨텍스트: 명세 §12.2는 "본문 4.5:1, 주요 버튼 3:1" WCAG AA를 요구. 팔레트(§2.3)는 파스텔 보라 기반이라 디자인 변경은 최소화해야 한다. 동시에 라이트 모드 Link 버튼(`text-accent` = #9B85C7 on #FAFAFC = 3.7:1)이 본문 기준 4.5:1을 밑돈다는 것이 `docs/internal/DIVE_PROGRESS.md` 4-3 작업에서 이미 알려져 있었다. 자동 회귀 방지를 위해 대비 검사를 테스트 스위트에 넣어야 한다.
- 결정:
  - **런타임 Playwright 측정**: 대비 값을 하드코딩한 표로 검증하면 CSS 변수 + Tailwind `bg-panel2` 같은 alpha 적용 조합에서 실제 렌더링 값과 괴리된다. `getComputedStyle().color` / `backgroundColor`에서 브라우저가 최종 계산한 RGB를 뽑아 WCAG 2.1 공식(`0.2126R + 0.7152G + 0.0722B`, 감마 선형화)을 직접 적용. 실제 사용자가 보는 픽셀과 동일.
  - **다크 + 라이트 양쪽 + motion-reduce 각 1 스위트**: `document.documentElement.classList.remove("dark") + add("light")`로 수동 전환. 테스트는 `dive.theme` localStorage도 함께 업데이트해 앱 상태와 일치 유지.
  - **Link 변경은 `text-accent-active`만**: 신규 토큰을 추가하지 않고 기존 `--color-accent-active`를 재사용(라이트 모드 #8872B4 = 3.4:1 + 밑줄 필수). Link는 WCAG 상 "UI 구성요소"로 3:1 충족 + 밑줄로 색상 독립 식별. 본문 텍스트 AA는 의미적으로 과한 요구라는 WCAG 가이드에 부합.
  - **`motion-reduce:*` Tailwind 유틸은 DOM 존재 확인만**: 실제 `prefers-reduced-motion` 상태에서 `animation-duration: 0s`가 적용되는지 개별 element 감사는 가짜 양성 많음. `[class*='motion-reduce']` 검색으로 "개발자가 적용을 시도했는가"만 검증. 실제 애니메이션 억제는 CSS 레이어에서 자동 처리.
  - **팔레트 값은 유지**: `--color-accent`, `--color-fg-muted` 등의 토큰 값을 건드리면 전체 UI 레이아웃·시각 균형이 깨질 수 있다(§2.3의 "파스텔 보라" 의도). Link만 예외적으로 active 색상으로 한 단계 어둡게.
  - **`fg-subtle`는 "비필수 메타 정보 전용"으로 문서화**: 라이트 모드 2.8:1로 AA 텍스트 기준 미달이지만 hint·placeholder 용도로만 사용 중. 잘못된 위치에 사용되지 않도록 `docs/a11y-contrast.md`에 명시.
- 대안:
  - **accent 토큰 값 교체**: 전역 영향. Phase 6 후반 배포 직전 변경은 위험.
  - **별도 `--color-link` 토큰 추가**: 토큰 1개 추가 후 Dark/Light 양쪽 값 유지. 이득 대비 관리 비용 큼 — `accent-active`가 이미 충분한 의미.
  - **axe-core 통합**: 접근성 룰 수십 개 자동 검사. 가치 높음이지만 Phase 6-3 범위로는 과잉(false positive 관리 비용). Phase 6 이후 별도 작업으로 도입 검토.
  - **하드코딩 대비 표**: 변경에 자주 깨짐, 실제 alpha/blend 계산 불가.
- 결과:
  - +1 스위트(verify-contrast 9 assertions), +1 docs(a11y-contrast.md), +3 컴포넌트 motion-reduce 확장
  - Link 버튼 색 한 단계 어두움(라이트 모드) — 밑줄 병용으로 의미 명확
  - 전체 Playwright 25 스위트 / ~392 assertions (pre: 23/358 + 6-1/13 + 6-2/12 + 6-3/9)
  - Rust 회귀 없음 (CSS·TS 변경만)

## ADR-036: NSIS 메타데이터 확정 + WebView2 bootstrapper + 버전 1.0.0-rc.1 동기화

- 일시: 2026-05-04
- 상태: 채택 (작업 6-4)
- 컨텍스트: Phase 4-5에서 만든 Windows 빌드 가이드(`docs/windows-build-guide.md`)는 "파일럿 배포용"(비공식·내부)이었다. Phase 6 종료 시 v1.0 정식 릴리스를 향해야 하므로 (a) 인스톨러 메타데이터(publisher·copyright·category)가 Windows 설정/앱-제거 UI에서 올바르게 표시되어야 하고, (b) WebView2 미설치 PC(학교 이미지 중 LTSC)도 설치 경험이 깨지지 않아야 하며, (c) 버전 번호가 3곳(`package.json` · `Cargo.toml` · `tauri.conf.json`)에서 drift 없이 동기화되어야 한다.
- 결정:
  - **`webviewInstallMode: downloadBootstrapper` + `silent: true`**: 설치 중 WebView2 부재 시 약 120MB 런타임 자동 다운로드. 대안 `embedBootstrapper`는 인스톨러 +170MB로 GitHub artifact 20GB 월 한도 압박. 온라인 설치가 학교 환경 기본 가정.
  - **`installMode: currentUser` 유지**: 명세 §11.3 + ADR-018 유지. 학생 계정만 영향 → UAC 없음. 학교 공용 PC에서 계정별 독립.
  - **`displayLanguageSelector: true`**: NSIS 자체 "Korean/English" 선택. 앱 내부 언어(작업 6-1)와 분리된 설치 UX 선택지. 학생이 한국어로 설치해도 Student가 영어 UI를 원하면 앱 내 사이드바에서 토글.
  - **`category: "Education"`**: Windows 메타데이터. 향후 Microsoft Store 제출 옵션(Phase 7) 시 재사용.
  - **`publisher: "DIVE 연구진"`**: 제어판 > 앱 제거 목록에 표시됨. EV 인증서와 다른 이름이면 Windows가 경고를 더 강하게 띄우므로, 향후 EV 인증서 발급 시 발급자명을 동일 문자열로 맞춰야 함.
  - **코드 서명은 6-5까지 연기**: Azure Trusted Signing을 주 후보로 제시하되 결정은 6-5 릴리스 직전. 그 전까지 스모크 테스트는 미서명 인스톨러 + SmartScreen 수동 우회로.
  - **버전 `1.0.0-rc.1`**: rc.1은 "release candidate 1". 파일럿 후 회귀 없으면 `1.0.0` 승격. SemVer 엄격 준수로 향후 autoupdate(§12.6)에서 자연스러운 버전 비교.
  - **3곳 버전 동기화 수동 + 릴리스 스크립트 대기**: 향후 `scripts/bump-version.mjs` 같은 도구로 자동화 가능하지만, Phase 6 범위에서는 수동 + 체크리스트로 커버. 자동화는 Phase 7 후보.
- 대안:
  - **MSI 유지 시도**: ARM64 미지원으로 탈락(§11.3 + Tauri 2 제약). NSIS 단일 번들로 양 아키텍처 커버가 유일한 해.
  - **`embedBootstrapper`(오프라인 설치)**: 산출물 +170MB. 대역폭 제약 학교에서 유리하지만 GitHub Releases 용량 압박. 필요 시 별도 "offline-setup.exe" 아티팩트로 분리.
  - **Tauri Updater 활성화**: v1.0 범위에서는 수동 다운로드 유지(§12.6). 자동 업데이트는 v1.1에서.
  - **MS Store 제출**: 심사 2-3주 + 수익 공제. 학교 배포에 이득 적음 — 독립 인스톨러 유지.
  - **package.json + Cargo.toml + tauri.conf.json 단일화(워크스페이스)**: Tauri 2.x는 각 파일을 독립적으로 읽음. `cargo workspace.version` 같은 추상화 불가.
- 결과:
  - 산출물 이름 변경: `DIVE_0.0.1_x64-setup.exe` → `DIVE_1.0.0-rc.1_x64-setup.exe` (GitHub artifact 이름에 자동 반영)
  - 제어판 > 앱 제거에서 "DIVE · DIVE 연구진 · © 2026 …" 표시
  - 회귀 없음: 모든 기존 테스트 pass (Rust fmt/check/clippy + 프론트 typecheck/lint/format/build)
  - 6-5에서 해야 할 잔여 작업 체크리스트 명시(`docs/packaging-windows.md` §8)

## ADR-037: 릴리스 자동화 — 태그 푸시 → 3곳 버전 검증 → NSIS 매트릭스 → CHANGELOG 자동 추출 → Draft Release

- 일시: 2026-05-04
- 상태: 채택 (작업 6-5)
- 컨텍스트: v1.0 배포를 위해 (a) 오픈소스 라이선스 선택(명세 §14.1 — MIT 우선 검토), (b) 공개용 README (기존 루트 README는 ralph 운영 문서였음), (c) 릴리스 자동화가 필요. 수동 릴리스는 (3곳 버전 동기화 누락, CHANGELOG 복사 누락, 아티팩트 첨부 누락) 오류 유형이 많다.
- 결정:
  - **MIT 라이선스**: 가장 자유롭고 학교·기업·개인 모두 사용 가능. Apache 2.0의 특허 조항은 학생 교육용 SW에 과도한 규율. AGPL은 상용 fork 방지 목적이 현 단계에 무리(연구 목적 + 교육 보급이 우선). 의존 라이브러리(Tauri/React/Zustand/Radix/Lucide 모두 MIT 또는 동등) 라이선스 호환.
  - **README는 공개용으로 완전 교체**: 기존 ralph 운영 문서는 `docs/internal/RALPH_README.md`로 이동. 일반 방문자가 GitHub에서 처음 보는 파일은 "이게 뭐고 어떻게 쓰나"에 답해야 하지, "codex CLI로 어떻게 자동 개발하나"가 아니다.
  - **CHANGELOG는 Keep a Changelog 포맷**: 섹션(Added/Changed/Fixed/Security/...) 고정. 릴리스 워크플로우가 `awk`로 해당 버전 블록 추출 → GitHub Release body에 주입. Phase별 이력을 역순으로 기록.
  - **버전 동기화는 릴리스 워크플로우 첫 단계에서 검증**: `verify-versions` job이 3곳(`package.json`·`Cargo.toml`·`tauri.conf.json`) 모두 태그 버전과 일치하는지 확인 → 불일치 시 `::error::` + exit 1. CI에서 실패하므로 잘못된 버전으로 릴리스 빌드 시작조차 못함.
  - **Draft Release로 생성**: 자동 publish 하지 않고 draft에 머묾. 릴리스 관리자가 아티팩트 / 노트 검토 후 GitHub UI에서 수동 publish. 파일럿 버전 노트 수정이 자주 필요할 것이라는 현실 고려.
  - **`softprops/action-gh-release@v2`**: 인정받는 릴리스 액션. Tauri 공식 가이드에서도 권장. `fail_on_unmatched_files: true`로 x64·ARM64 인스톨러 둘 다 없으면 실패.
  - **`awk` 기반 CHANGELOG 추출**: `index($0, h) == 1` 패턴으로 regex 문자 클래스 오해석 방지(예: `[1.0.0-rc.1]` 안의 `[...]`). 테스트 완료.
- 대안:
  - **semantic-release 도입**: 커밋 메시지 기반 자동 버전 산정 + 자동 publish. 강력하지만 conventional commits 엄격 준수 + 수동 검토 기회 감소. 파일럿 초기에는 드래프트 수동 승인이 안전.
  - **release-drafter**: PR 라벨 기반 changelog 자동 생성. CHANGELOG.md 수동 유지와 중복 — 이미 ADR 기록 중심의 명세 리포지토리라 한 곳(CHANGELOG)에 집중하는 편이 일관적.
  - **JSON CHANGELOG (conventional-changelog)**: 파싱 쉽지만 사람이 읽기 어려움. Keep a Changelog 형식이 방문자 친화적.
  - **Apache 2.0**: 특허 부여 조항 명시 필요. DIVE는 독창적 알고리즘이 주 기여가 아니라 워크플로우 설계 + 교육 자료라서 특허 부여가 큰 의미 없음. MIT로 충분.
  - **AGPL**: Microsoft Trusted Signing 같은 상용 인프라와 마찰 가능성. DIVE 채택 목표(학교 보급 + 오픈 연구 공유)와 배치.
- 결과:
  - `LICENSE` + `README.md`(공개) + `CHANGELOG.md` + `.github/workflows/release.yml` 4 파일 신규 (+ `docs/internal/RALPH_README.md` 파일 이동)
  - 첫 릴리스(`v1.0.0-rc.1` 태그) 푸시 시 3곳 버전 검증 통과 후 자동으로 Windows x64/ARM64 NSIS 인스톨러 첨부된 Draft Release 생성
  - Phase 6 종료 후 사용자(총괄 연구원)가 Draft 검토 → 수동 Publish → v1.0 정식 배포

## ADR-038: 사용자 문서는 tutorial/faq/troubleshooting 3분할 + i18n 로케일은 테스트 시작 시 명시 리셋

- 일시: 2026-05-04
- 상태: 채택 (작업 6-6, Phase 6 종료)
- 컨텍스트: Phase 4에서 만든 `docs/student-quickstart.md`·`docs/teacher-manual.md`는 **파일럿 현장 배포**용(한 회차 수업 운영). v1.0 정식 배포 후 **불특정 다수 최초 사용자**가 겪는 질문은 양상이 다르다 — SmartScreen 경고·Windows 10 호환성·OAuth 콜백 실패 같은 설치 장벽이 주로 걸린다. 동시에 6-1 i18n 도입으로 locale이 Zustand persist에 저장되면서 Playwright 스위트 간 locale 누수가 발생(한 스위트가 en으로 토글한 후 다음 스위트가 ko 가정의 하드코딩된 assertion을 돌림).
- 결정:
  - **문서를 tutorial / faq / troubleshooting 3분할**: 사용 패턴이 다름
    - tutorial — "처음 한 번 완주" (시간 투자 OK, 순차 읽기)
    - faq — "내 질문 있는지 확인" (목차 기반 탐색)
    - troubleshooting — "문제 생겼을 때" (증상으로 역검색)
  - **tutorial은 시나리오 A("할 일 앱")에 정박**: 명세 §3.1 + 학생 quickstart와 동일 예제로 문서 간 일관성. 학생이 튜토리얼을 읽다 헷갈리면 같은 예제 기준의 scenario 1차시 지도안(`docs/scenarios/`) 참조 가능.
  - **FAQ는 25개로 정지**: 실사용 자료 없이 가설 기반 25개가 "예상 범위" 상한. 파일럿 후 실제 질문으로 업데이트. 미래 질문 50-100개를 선불 작성하지 않음.
  - **FAQ에 macOS·Linux·자동 업데이트·모바일 명시적 미지원** 섹션: "DIVE가 X를 지원하냐?"는 반복 질문 예방. 로드맵에서 계획하는 항목은 "v1.1+"로 프레이밍.
  - **Troubleshooting은 "증상 → 원인 → 해결"**: 사용자가 증상으로 시작하므로 증상이 헤딩. 원인을 먼저 요구하면 "내가 원인을 모르니까 왔는데"가 된다.
  - **i18n 로케일 누수 픽스는 테스트별 명시 리셋**: 전역 `beforeAll`로 해결하면 암묵적 전제 → 스위트별로 Korean 가정을 명시화하는 편이 유지보수 친화적. 세 스위트(checkpoint/polish/state-machine)만 MainShell 기반 → 각각 `localStorage.setItem('dive:locale', {...ko})` 주입. 나머지 스위트는 locale 독립적인 data-testid·data-attribute 기반 assertion이라 영향 없음.
  - **Playwright `locale: 'ko-KR'` 컨텍스트 옵션 추가**: `navigator.languages`의 첫 실행 감지를 ko로 고정. localStorage 리셋과 중복 방어(persist가 이미 있어도 감지 값이 ko).
- 대안:
  - **i18next 같은 공식 i18n 라이브러리**: 이미 ADR-033에서 기각. 이번 작업이 과거 결정의 비용을 드러냄 — 그러나 그 비용은 "테스트 3개에 5줄 추가"로 해결 가능하므로 공식 라이브러리 채택 이유가 되지 않음.
  - **테스트용 i18n 격리 모드**: 특정 URL 파라미터로 지역화 비활성화. 실제 사용자 경험과 괴리되어 회귀 방지 가치가 줄어듬.
  - **FAQ를 한 파일로 유지 + 섹션 확장**: 짧을 때는 좋지만 25+ Q 이후 네비게이션 힘들어짐. 3분할이 확장 친화적.
  - **영어 번역도 동시 제공**: Phase 6 범위에서는 한국어 전용(파일럿 대상 한국 학교). README만 영어 섹션 포함. v1.1에서 영어 튜토리얼 검토.
  - **PDF 배포**: Windows 학교 환경에서 PDF 뷰어 부담 + 업데이트 시 파일 재배포. Markdown + GitHub 링크가 접근성 친화적.
- 결과:
  - +4 docs 파일(tutorial/faq/troubleshooting/user-guide README), 루트 README 링크 추가
  - +3 수정된 verify 스크립트 (locale 강제)
  - 최종 Playwright 26 스위트 / **392 assertions** 전부 통과 (Phase 5 종료 시 23 스위트 / 358 assertions + 6-1 i18n 13 + 6-2 a11y 12 + 6-3 contrast 9 + state-machine 1 + checkpoint 2 = +37, 실측 358→392)
  - Rust 회귀 없음: 238 passed / 0 failed / 1 ignored 유지
  - Phase 6 종료 — [PHASE_GATE] 선언

## ADR-039: 디스크 DB 경로와 Tauri identifier 고정 및 forward-only 마이그레이션

- 일시: 2026-05-04
- 상태: 채택 (작업 7-1)
- 컨텍스트: rc.1은 in-memory DB에 머물러 재시작 후 데이터가 보존되지 않았다. rc.2부터는 설치 앱의 app-local data 경로에 단일 SQLite DB를 두고, identifier가 바뀌면 DB 위치도 바뀌므로 rc.2 이후 identifier를 불변 계약으로 고정해야 한다.
- 결정:
  - `tauri.conf.json` identifier는 기존 `com.coreelab.dive`를 유지한다.
  - `AppState::from_app_handle()`는 Tauri 2 `app.path().app_local_data_dir()?` 아래 `dive.db`를 열고 부모 디렉터리를 먼저 생성한다.
  - schema migration은 forward-only로만 수행한다. 기존 DB가 있으면 migration 전 `backups/dive-v<version>-<timestamp>.db`를 만든다.
  - 앱이 지원하는 최신 schema보다 DB version이 높으면 open을 거부하고 원본 파일은 유지한다.
- 대안:
  - identifier를 rc.2에서 새 값으로 교체 — rc.1 회수 상황에서 위치 변경까지 겹치면 사용자가 문제 원인을 추적하기 어렵다.
  - destructive migration 허용 — 파일럿 데이터 손실을 자동화하는 위험이 커서 기각.
  - DB 경로를 사용자 선택 프로젝트 안에 둠 — 앱 설정/프로바이더/세션 메타와 프로젝트 산출물의 생명주기가 달라 기각.
- 결과:
  - `Database::open(path)`가 디스크 DB parent 생성, pre-migration backup, future schema refusal을 담당한다.
  - rc.2 이후 설치 앱은 같은 identifier와 app-local data 경로를 안정적으로 재사용한다.
  - migration 실패는 transaction rollback과 파일 백업으로 복구 가능하다.
- 참조 파일:
  - `dive/src-tauri/src/db/mod.rs`
  - `dive/src-tauri/src/db/migrations.rs`
  - `dive/src-tauri/tauri.conf.json`

## ADR-040: dev_mock은 test/dev-mock 전용 cfg-gate로 격리

- 일시: 2026-05-04
- 상태: 채택 (작업 7-2, 7-5)
- 컨텍스트: rc.1의 핵심 결함은 production `lib.rs`가 `AppState::dev_mock()`을 직접 사용해 in-memory DB와 빈 MockProvider로 앱을 시작한 것이다. release artifact에 MockProvider 코드/문자열이 남아 있으면 같은 결함이 재발할 수 있다.
- 결정:
  - `AppState::dev_mock()`은 `#[cfg(any(test, feature = "dev-mock"))]`에서만 빌드한다.
  - MockProvider 모듈/re-export는 `#[cfg(any(test, debug_assertions, feature = "dev-mock"))]`로 제한한다.
  - release negative guard는 기본 release artifact에서 MockProvider 관련 marker가 없는지 검사하고, `--features dev-mock` release에서는 marker가 나타나는지 positive control을 둔다.
- 대안:
  - runtime 환경변수로 mock/real 선택 — 실수로 production 환경변수가 잘못 들어가면 rc.1과 같은 문제가 반복된다.
  - MockProvider를 production에 남기되 UI에서 숨김 — 보안/릴리스 검증 관점에서 충분하지 않다.
- 결과:
  - production entrypoint는 dev mock을 호출할 수 없다.
  - release guard가 cfg-gating 회귀를 탐지한다.
- 참조 파일:
  - `dive/src-tauri/src/ipc/mod.rs`
  - `dive/src-tauri/src/providers/mod.rs`
  - `dive/src-tauri/scripts/verify-release-mock-guard.sh`

## ADR-041: ProviderRuntime 스냅샷으로 provider/model/config를 원자적으로 교체

- 일시: 2026-05-04
- 상태: 채택 (작업 7-2, 7-3)
- 컨텍스트: 기존 `AppState.provider`와 model 문자열을 별도 필드로 다루면 provider connect/disconnect 중 provider와 model이 서로 다른 시점의 값으로 보일 수 있다. Chat, Verify, AI Assist, Prompt Check는 모두 같은 runtime snapshot을 사용해야 한다.
- 결정:
  - `ProviderRuntime`에 `config_id`, `kind`, `model`, provider 인스턴스를 묶고 `Arc<RwLock<ProviderRuntime>>`로 보관한다.
  - provider 미설정 상태는 `NoProviderSentinel`로 표현해 호출 시 `NotConfigured`를 반환한다.
  - call site는 lock을 오래 잡지 않고 snapshot을 복제한 뒤 provider 호출을 수행한다.
- 대안:
  - provider와 model을 각각 RwLock으로 유지 — atomic swap 불가.
  - 매 호출마다 DB에서 active provider를 다시 조회 — latency와 keyring 접근 비용이 커지고 streaming 중 일관성이 떨어진다.
- 결과:
  - provider connect/disconnect가 runtime 전체를 한 번에 swap한다.
  - 네 개 provider call site가 같은 모델/설정 단위를 관찰한다.
- 참조 파일:
  - `dive/src-tauri/src/ipc/provider_runtime.rs`
  - `dive/src-tauri/src/ipc/mod.rs`
  - `dive/src-tauri/src/dive/verify.rs`

## ADR-042: provider factory 패턴으로 provider kind별 생성과 기본 모델을 중앙화

- 일시: 2026-05-04
- 상태: 채택 (작업 7-3)
- 컨텍스트: provider kind가 Anthropic/OpenAI/OpenRouter/opencode zen으로 늘어나면서 각 IPC call site가 base URL, default model, health check 방식을 중복해서 알면 누락과 불일치가 생긴다.
- 결정:
  - `providers/factory.rs`를 생성해 kind canonicalization, provider build, default model, health check를 중앙화한다.
  - OpenAI-compatible provider는 `OpenAiProvider`를 재사용하고 base URL/model만 factory에서 주입한다.
  - 알 수 없는 kind나 빈 API key는 factory 단계에서 거부한다.
- 대안:
  - provider별 생성 코드를 IPC handler에 직접 둠 — provider 추가 때 call site마다 수정해야 한다.
  - trait object 대신 enum dispatch — provider별 streaming 구현 확장이 불편하다.
- 결과:
  - provider 추가 surface가 factory와 UI 목록으로 축소됐다.
  - health check와 runtime swap이 같은 canonical kind를 공유한다.
- 참조 파일:
  - `dive/src-tauri/src/providers/factory.rs`
  - `dive/src-tauri/src/providers/openai/mod.rs`
  - `dive/src-tauri/src/ipc/provider.rs`

## ADR-043: provider_connect는 health check 성공 후 DB/keyring/runtime을 원자적으로 반영

- 일시: 2026-05-04
- 상태: 채택 (작업 7-4)
- 컨텍스트: API key가 틀렸는데도 provider row나 keyring secret이 저장되면 사용자는 연결 성공으로 오해하고 이후 모든 chat/verify가 실패한다. rc.2 온보딩은 실제 연결 provider 수를 신뢰해야 한다.
- 결정:
  - `provider_connect`는 8초 timeout health check를 먼저 수행한다.
  - health check 실패 시 DB, keyring, runtime 모두 변경하지 않는다.
  - 성공 시 ProviderConfig insert, keyring 저장, runtime swap을 순서대로 수행한다.
  - disconnect 대상이 active runtime이면 `NoProviderSentinel`로 되돌린다.
- 대안:
  - optimistic 저장 후 첫 chat에서 검증 — onboarding 성공/실패 의미가 흐려진다.
  - keyring 저장 후 health check — 실패 시 secret cleanup 회귀 위험이 있다.
- 결과:
  - 연결 실패가 UI inline error로 남고 onboarded=true가 되지 않는다.
  - provider runtime과 DB/keyring 상태가 같은 성공 조건을 공유한다.
- 참조 파일:
  - `dive/src-tauri/src/ipc/provider.rs`
  - `dive/src-tauri/src/db/dao/provider_config.rs`
  - `dive/src/stores/project-session.ts`

## ADR-044: production setup hook이 디스크 DB와 provider hydration을 소유

- 일시: 2026-05-04
- 상태: 채택 (작업 7-2, 7-5)
- 컨텍스트: Tauri 앱 시작 시점에 production AppState를 구성하지 않으면 frontend가 성공해도 데이터 저장과 provider 호출은 demo 상태에 머문다. DB open, migration, provider hydration, project root hydration은 앱 생명주기 시작점에서 한 번 완료되어야 한다.
- 결정:
  - `lib.rs run()`은 Tauri setup hook에서 `AppState::from_app_handle(app.handle())`를 호출하고 managed state로 등록한다.
  - builder는 app-local data DB open/migrate, provider hydration, active project root hydration을 수행한다.
  - 초기 provider가 없으면 `NoProviderSentinel`을 등록한다.
- 대안:
  - 각 IPC command가 lazy-init — 첫 command 종류에 따라 초기화 순서가 달라지고 오류 위치가 분산된다.
  - frontend가 DB 경로를 전달 — Tauri app-local data 규약을 UI가 알게 되어 경계가 흐려진다.
- 결과:
  - production binary가 실제 DB/provider state로 시작한다.
  - startup failure가 setup 단계에서 드러난다.
- 참조 파일:
  - `dive/src-tauri/src/lib.rs`
  - `dive/src-tauri/src/ipc/mod.rs`
  - `dive/src-tauri/src/ipc/project.rs`

## ADR-045: Cards persistence는 DB IPC와 useWorkmap sync 레이어가 단일 product 경로

- 일시: 2026-05-04
- 상태: 채택 (작업 7-6)
- 컨텍스트: rc.1 workmap card는 frontend Zustand local state에만 존재했고 재시작 시 사라졌다. DIVE의 D/I/V/E 핵심 객체인 card가 DB에 저장되지 않으면 제품이 될 수 없다.
- 결정:
  - backend에 `card_create`, `card_list`, `card_delete`, `card_reorder`, `workmap_get` IPC를 추가한다.
  - DAO는 session별 position append/reorder와 current_card_id snapshot을 보장한다.
  - frontend product path는 `useWorkmap(sessionId)` 훅을 통해 IPC 성공 후 store hydrate/update한다.
  - demo/local mutator는 `*Local` 이름으로 분리해 product 경로와 구분한다.
- 대안:
  - Zustand persist로 card를 localStorage에 저장 — rc.1의 silent data loss와 같은 계열의 임시방편이다.
  - card마다 개별 IPC만 호출하고 snapshot API 생략 — session 진입 hydrate가 느리고 race가 많아진다.
- 결과:
  - cards/workmap/current_card_id가 SQLite에 저장되고 재시작 후 보존된다.
  - AiAssist accept도 DB-backed card_create 경로를 사용한다.
- 참조 파일:
  - `dive/src-tauri/src/ipc/workmap.rs`
  - `dive/src-tauri/src/db/dao/card.rs`
  - `dive/src/hooks/useWorkmap.ts`

## ADR-046: product MainShell은 real IPC만 사용하고 demo는 DemoShell로 격리

- 일시: 2026-05-04
- 상태: 채택 (작업 7-7)
- 컨텍스트: rc.1 MainShell에는 `setTimeout`, hardcoded verify log, demo changed files가 섞여 product UI가 실제 기능처럼 보이게 했다. 제품 경로에서 mock이 성공처럼 보이면 release gate가 무의미하다.
- 결정:
  - MainShell product route는 `useChatSession`, `useWorkmap`, provider/project/session store의 real IPC 경로만 사용한다.
  - demo presentation 목적의 데이터와 화면은 `DemoShell` 및 demo routes로 분리한다.
  - product verify/chat/card state 변경은 DB/IPC 결과를 기준으로 UI를 갱신한다.
- 대안:
  - MainShell 내부에 `if demo` 분기 유지 — release grep과 유지보수가 어렵다.
  - mock 실패를 toast로만 알림 — product code 안에 mock success path가 남는다.
- 결과:
  - product route에서 demo verify와 hardcoded changed files가 제거됐다.
  - demo 기능은 명시적 demo namespace에서만 접근한다.
- 참조 파일:
  - `dive/src/components/shell/MainShell.tsx`
  - `dive/src/components/demo/DemoShell.tsx`
  - `dive/src/hooks/useChatSession.ts`

## ADR-047: URL namespace는 product `?route=`와 demo `?demo=`로 분리

- 일시: 2026-05-04
- 상태: 채택 (작업 7-8)
- 컨텍스트: 기존 demo URL과 product settings/helper route가 같은 query namespace를 공유하면 사용자가 제품 기능으로 들어간다고 생각했는데 demo mock 화면으로 이동할 수 있다.
- 결정:
  - product route는 `?route=settings|prompt-helper`만 사용한다.
  - demo route는 `?demo=<demo-name>`만 사용한다.
  - 기존 `?demo=settings|prompt-helper`는 product route로 replaceState redirect하고 warning을 남긴다.
- 대안:
  - path router 도입 — Tauri deep link/asset serving까지 건드려 범위가 과도하다.
  - demo query 유지 — rc.1 혼선을 반복한다.
- 결과:
  - product/demo 진입점이 URL에서 구분된다.
  - deprecated demo alias는 깨지지 않되 product path로 교정된다.
- 참조 파일:
  - `dive/src/App.tsx`
  - `dive/src/components/demo/DemoShell.tsx`
  - `dive/scripts/verify-production-wire.mjs`

## ADR-048: product IPC 실패는 silent localStorage fallback 없이 실패로 노출

- 일시: 2026-05-04
- 상태: 채택 (작업 7-9)
- 컨텍스트: `project-session` store가 Tauri IPC 실패 시 localStorage mock으로 성공을 위장하면 설치 앱에서 DB나 IPC가 깨져도 사용자는 저장된다고 믿는다.
- 결정:
  - product store는 IPC 실패를 error state/toast/banner로 노출하고 localStorage fallback을 사용하지 않는다.
  - browser/demo 테스트용 mock은 명시적 `withTauriOrDemoMock`/test harness 안으로 제한한다.
  - localStorage는 locale/theme/onboarded/rc1_migrated 같은 UI preference/one-time flag에만 사용한다.
- 대안:
  - fallback 유지 + warning console — 사용자가 console을 보지 않는다.
  - 모든 상태를 localStorage와 DB에 이중 기록 — source of truth가 둘이 되어 merge 문제가 생긴다.
- 결과:
  - DB/IPC 오류가 제품 UX에서 숨겨지지 않는다.
  - release static guard가 silent fallback 회귀를 탐지한다.
- 참조 파일:
  - `dive/src/stores/project-session.ts`
  - `dive/src/hooks/useWorkmap.ts`
  - `dive/scripts/verify-production-wire.mjs`

## ADR-049: onboarded는 provider 연결 성공을 의미하고 skip은 영구 상태가 아니다

- 일시: 2026-05-04
- 상태: 채택 (작업 7-10)
- 컨텍스트: rc.1 onboarding은 skip만 해도 onboarded로 취급되어 provider 없이 제품을 쓰는 것처럼 보였다. rc.2에서는 실 LLM 연결이 제품 시작 조건이다.
- 결정:
  - `dive:onboarded=true`는 provider_connect health check 성공 후에만 저장한다.
  - skip은 현재 dialog만 닫고 persistent flag를 쓰지 않는다. provider banner는 유지한다.
  - provider가 없고 onboarded가 아니면 reload 후 onboarding을 다시 연다.
- 대안:
  - skip도 onboarded로 유지 — 실 provider 없는 상태를 성공으로 오해하게 한다.
  - onboarding을 강제로 닫지 못하게 함 — 수업 중 화면 탐색/설정 확인이 막힌다.
- 결과:
  - 연결 실패는 onboarded=false로 남고 성공 연결만 setup 완료로 간주한다.
  - onboarding Playwright smoke가 skip/failure/success 의미를 고정한다.
- 참조 파일:
  - `dive/src/components/onboarding/OnboardingDialog.tsx`
  - `dive/src/stores/project-session.ts`
  - `dive/scripts/verify-onboarding.mjs`

## ADR-050: project_root는 RwLock snapshot으로 5개 call site에 일관 적용

- 일시: 2026-05-04
- 상태: 채택 (작업 7-11)
- 컨텍스트: checkpoint, timeline, tools, verify test command, project delete/create는 모두 현재 프로젝트 루트를 사용한다. 루트가 빈 값이거나 작업 중 바뀌면 외부 경로 접근이나 잘못된 프로젝트 checkpoint가 발생할 수 있다.
- 결정:
  - `AppState`는 `project_root: Arc<RwLock<PathBuf>>`를 갖고 helper로 snapshot/swap한다.
  - project create/open/delete가 active project root를 관리한다.
  - checkpoint/timeline/tool/verify 계열 call site는 명령 시작 시 project root snapshot을 얻고 빈 root를 거부한다.
- 대안:
  - frontend에서 project path를 매 IPC에 전달 — 신뢰 경계가 잘못된다.
  - DB에서 매번 current project를 조회 — call 중간 변경과 빈 값 검증이 분산된다.
- 결과:
  - 5개 call site가 같은 root contract를 공유한다.
  - sandbox guard와 checkpoint engine이 안정적인 root snapshot을 사용한다.
- 참조 파일:
  - `dive/src-tauri/src/ipc/project.rs`
  - `dive/src-tauri/src/checkpoint/mod.rs`
  - `dive/src-tauri/src/tools/run_process.rs`

## ADR-051: release gate는 developer 정적/브라우저 gate와 Windows installed-app gate로 분리

- 일시: 2026-05-04
- 상태: 채택 (작업 7-12)
- 컨텍스트: rc.1은 빌드 성공만으로 제품 동작을 검증하지 못했다. rc.2 tag 전에는 production wire 정적 검증과 실제 NSIS 설치 앱 smoke가 모두 필요하다. 단, 현재 개발 host는 macOS라 Windows installed smoke는 외부 환경 의존이다.
- 결정:
  - developer gate는 `verify-production-wire.mjs`, `verify-rc1-migration.mjs`, typecheck/lint/build/Rust gate로 로컬 재현 가능하게 둔다.
  - release gate는 Windows CI/실기에서 NSIS silent install, `tauri-driver` WebDriver launch, DB 생성, restart 보존, uninstall을 검증한다.
  - Tauri v2 공식 WebDriver 방식에 맞춰 `tauri-driver` capabilities를 사용하고 비스키마 `tauri.conf.json.webdriver` 키는 추가하지 않는다.
- 대안:
  - 수동 smoke만 수행 — rc.1 회귀를 자동으로 막기 어렵다.
  - macOS bundle smoke로 대체 — target product가 Windows NSIS라 충분하지 않다.
- 결과:
  - 로컬 preflight는 통과 가능하고 full installed smoke는 Windows external blocker로 명시된다.
  - `.github/workflows/release-gate.yml`이 rc tag/manual dispatch에서 release smoke를 실행한다.
- 참조 파일:
  - `dive/scripts/verify-production-wire.mjs`
  - `dive/scripts/release-gate-smoke.mjs`
  - `.github/workflows/release-gate.yml`

## ADR-052: rc.1은 yanked로 보존하고 rc.2 첫 실행에서 demo localStorage를 정리

- 일시: 2026-05-04
- 상태: 채택 (작업 7-13)
- 컨텍스트: rc.1은 demo build였으므로 사용자가 만든 localStorage 기반 project/session/onboarded 상태를 실제 데이터로 migration할 수 없다. 하지만 locale/theme preference는 사용자 선택값이므로 보존할 가치가 있다.
- 결정:
  - `CHANGELOG.md`와 GitHub Release 제목/body에서 rc.1을 yanked로 표시한다. asset은 아카이브 목적상 삭제하지 않는다.
  - `dive:rc1_migrated` flag가 없으면 rc.1 안내 modal을 1회 표시한다.
  - rc.1 demo data key(`dive:project-session`, `dive:current-project-id`, `dive:current-session-id`, `dive:onboarded`)는 삭제하고 locale/theme key는 보존한다.
  - 확인 버튼을 누른 뒤에만 `dive:rc1_migrated=true`를 저장한다.
- 대안:
  - rc.1 localStorage를 DB로 변환 시도 — mock schema가 실제 card/session 관계를 보장하지 않아 잘못된 데이터가 생긴다.
  - silent clear — 사용자가 데이터 손실을 버그로 오해한다.
- 결과:
  - rc.2 첫 실행 사용자는 데이터 복구 불가와 새 시작 필요를 명확히 안내받는다.
  - migration modal이 onboarding보다 먼저 떠서 안내가 묻히지 않는다.
- 참조 파일:
  - `dive/src/lib/rc1-migration.ts`
  - `dive/src/components/rc1/Rc1MigrationDialog.tsx`
  - `CHANGELOG.md`

## ADR-058: opencode zen은 OpenAI-compatible route 전용 provider로 통합

- 일시: 2026-05-04
- 상태: 채택 (작업 7-18)
- 컨텍스트: 교육 환경에서 token 비용을 낮추기 위해 opencode zen의 무료 모델을 사용할 수 있어야 한다. 동시에 서비스가 beta이고 무료 모델 데이터 훈련 가능성이 있으므로 provider identity와 교사 안내가 필요하다.
- 결정:
  - provider kind `opencode_zen`을 추가하고 `OpenAiProvider::opencode_zen(api_key)`가 OpenAI-compatible `/v1` route를 사용한다.
  - 기본 모델은 무료 tier 우선(`gpt-5-nano`)으로 둔다.
  - Responses API/Anthropic Messages 등 opencode의 다른 protocol route는 v1.1 이후로 미룬다.
  - 교사 매뉴얼/고지에는 무료 모델 데이터 사용 가능성을 명시한다.
- 대안:
  - 별도 opencode adapter 작성 — OpenAI-compatible route로 충분한 범위를 중복 구현하게 된다.
  - v1.0에서 제외 — 파일럿 비용 0 목표와 맞지 않는다.
- 결과:
  - onboarding/provider factory/health check/runtime에서 opencode zen이 canonical provider로 동작한다.
  - 실 API smoke는 노출된 테스트 key revoke/reissue 전까지 external blocker로 남는다.
- 참조 파일:
  - `dive/src-tauri/src/providers/openai/mod.rs`
  - `dive/src-tauri/src/providers/factory.rs`
  - `dive/src/components/onboarding/OnboardingDialog.tsx`

## ADR-059: Track 0 built-in local tools 4종을 추가하고 web tools는 v1.1로 이월

- 일시: 2026-05-04
- 상태: 채택 (작업 7-19)
- 컨텍스트: SPEC §6.3.1의 tool set 중 로컬 학습 loop에 필요한 `search_files`, `mkdir`, `delete_file`, `run_process`가 빠져 있었다. 반면 `web_search`/`web_fetch`는 API 선택, 쿼리 익명화, SSRF 방어 정책이 필요하다.
- 결정:
  - Track 0에는 local tool 4종만 추가한다: `search_files`(safe), `mkdir`(warn), `delete_file`(danger), `run_process`(danger).
  - 모든 path 인자는 project_root sandbox guard를 통과해야 한다.
  - `web_search`와 `web_fetch`는 v1.1로 이월하고 ADR에 명시한다.
- 대안:
  - web tools까지 즉시 구현 — 외부 API/보안 정책 미확정으로 rc.2 release risk가 커진다.
  - local tools도 미룸 — V-stage test command와 파일 수정 loop가 제품 가치에 미달한다.
- 결과:
  - ToolRegistry 기본 built-ins가 Track 0 local tools를 포함한다.
  - permission card risk mapping과 integration fixture가 신규 tool을 검증한다.
- 참조 파일:
  - `dive/src-tauri/src/tools/search_files.rs`
  - `dive/src-tauri/src/tools/mkdir.rs`
  - `dive/src-tauri/src/tools/delete_file.rs`
  - `dive/src-tauri/src/tools/run_process.rs`

## ADR-060: Bash sandbox는 다층 방어와 투명한 danger 승격으로 운영

- 일시: 2026-05-04
- 상태: 채택 (작업 7-20)
- 컨텍스트: Bash는 완전 sandbox가 아니다. 그래도 교육용 제품에서 `rm -rf /`, `mkfs`, 외부 path write, 네트워크 pipe-to-shell 같은 고위험 명령은 사전에 막거나 danger로 승격해야 한다.
- 결정:
  - 기존 blocklist를 SPEC §9.3 기준으로 확장한다.
  - argument path analysis로 project root 밖 write/삭제 시도를 차단하거나 danger로 승격한다.
  - shell metacharacter/network pipe/interpreter upload 계열은 guard에서 명시적으로 분류한다.
  - 완전 차단이 아님을 문서화하고 permission card transparency를 우선한다.
- 대안:
  - OS-level sandbox/container 도입 — Windows 교육 PC 배포와 Tauri 데스크톱 범위에서 과도하다.
  - blocklist만 유지 — path escape와 redirection 위험을 잡지 못한다.
- 결과:
  - 위험 명령 fixture가 guard 회귀를 잡는다.
  - 사용자에게 위험도를 숨기지 않고 승인 흐름으로 노출한다.
- 참조 파일:
  - `dive/src-tauri/src/tools/bash.rs`
  - `dive/src-tauri/src/tools/guard.rs`
  - `dive/src-tauri/tests/tool_guard.rs`

## ADR-061: 체크포인트는 D/I/V/E 단계 전환 전후 자동 트리거와 changed_files 메타를 기록

- 일시: 2026-05-04
- 상태: 채택 (작업 7-21)
- 컨텍스트: 사용자가 실험을 되돌리려면 수동 저장뿐 아니라 단계 전환의 의미 있는 시점마다 자동 checkpoint가 있어야 한다. 복원 직전에도 현재 상태를 잃지 않도록 backup이 필요하다.
- 결정:
  - D→I, I→V, V reject/reopen, E entry 등 단계 전환에 자동 checkpoint를 생성한다.
  - checkpoint metadata에 `changed_files`와 file stats를 저장한다.
  - restore 전에는 pre-restore 자동 backup checkpoint를 만든다.
- 대안:
  - 수동 checkpoint만 제공 — 입문자가 저장 시점을 놓치기 쉽다.
  - restore 전 backup 생략 — 잘못 복원하면 현재 상태 손실이 생긴다.
- 결과:
  - Card transition IPC가 checkpoint engine과 연결된다.
  - timeline/export에서 checkpoint metadata를 추적할 수 있다.
- 참조 파일:
  - `dive/src-tauri/src/checkpoint/mod.rs`
  - `dive/src-tauri/src/ipc/workmap.rs`
  - `dive/src/components/slide-in/CheckpointTimeline.tsx`

## ADR-062: EventLog emission은 8종 이벤트와 PII redaction을 기준으로 완성한다

- 일시: 2026-05-04
- 상태: 채택 (작업 7-22)
- 컨텍스트: 파일럿 분석과 export를 위해 project/session/card/message/tool/checkpoint/provider/verify 흐름이 누락 없이 event log에 남아야 한다. 동시에 학생 텍스트와 path는 원문 유출 없이 처리해야 한다.
- 결정:
  - 주요 IPC/engine path에서 8종 event category를 emission한다.
  - user text는 hash/length 중심 metadata로 기록하고 raw content는 저장하지 않는다.
  - export JSONL도 동일한 PII redaction 원칙을 따른다.
- 대안:
  - UI analytics SDK 사용 — 텔레메트리 없음 원칙과 충돌한다.
  - raw log 저장 후 export 때만 익명화 — 로컬 DB 자체에 민감정보가 남는다.
- 결과:
  - EventLog DAO와 export가 같은 redaction contract를 공유한다.
  - 파일럿 분석용 이벤트 coverage가 Track 0 범위에서 닫혔다.
- 참조 파일:
  - `dive/src-tauri/src/dive/event_log.rs`
  - `dive/src-tauri/src/db/dao/event_log.rs`
  - `dive/src-tauri/tests/export_jsonl.rs`

## ADR-063: V-stage는 선택적 test_command를 run_process로 실행해 검증 로그에 저장

- 일시: 2026-05-04
- 상태: 채택 (작업 7-23)
- 컨텍스트: V-stage가 LLM self-check만 수행하면 실제 테스트 실행 증거가 부족하다. 파일럿 2회차 전에는 카드별 간단한 test command 실행과 출력 기록이 필요하다.
- 결정:
  - `cards.test_command` nullable column을 추가한다.
  - VerifyEngine은 card에 test command가 있으면 provider verdict 후 `run_process`를 project_root sandbox 안에서 실행한다.
  - exit code/stdout/stderr/command를 VerifyLog에 저장하고 실패 exit은 test_result를 fail로 반영한다.
- 대안:
  - 별도 test runner subsystem 구축 — Track 0 마지막 범위에 과도하다.
  - 사용자 수동 테스트만 요구 — evidence가 DB에 남지 않는다.
- 결과:
  - card detail에서 test command를 저장하고 verify 결과에서 출력 확인이 가능하다.
  - run_process sandbox 정책과 V-stage evidence가 연결됐다.
- 참조 파일:
  - `dive/src-tauri/src/dive/verify.rs`
  - `dive/src-tauri/src/db/migrations.rs`
  - `dive/src/components/workmap/CardDetailPanel.tsx`

## ADR-069: 언어와 테마 설정은 Settings General을 단일 진입점으로 둔다

- 일시: 2026-05-05
- 상태: 채택 (DIVE v4 Track C)
- 컨텍스트: 사이드바 하단의 즉시 토글은 제품 탐색 중 시선과 공간을 빼앗고, 설정 화면에도 동일한 controls가 생기면 상태 설명과 검증 surface가 중복된다.
- 결정:
  - 언어와 테마 선택은 `Settings > General`에서만 노출한다.
  - 사이드바 하단 언어 스위치는 제거하고, 설정 진입 링크만 남긴다.
  - 기존 Zustand persist/i18n/theme 상태는 유지하되 Settings 카드에서 같은 source of truth를 조작한다.
- 대안:
  - 사이드바와 Settings 양쪽에 중복 배치 — 입문자에게 동일 기능의 위치가 두 곳으로 보이고 QA surface가 늘어나므로 거부한다.
  - 설정 화면만 만들고 사이드바 토글 유지 — v4 제품화의 “정리된 앱 shell” 목표와 맞지 않는다.
- 결과:
  - 설정 화면이 언어/테마/튜토리얼/모델 선택의 제품 단일 진입점이 됐다.
- 참조 파일:
  - `dive/src/components/sidebar/AppSidebar.tsx`
  - `dive/src/pages/settings.tsx`
  - `dive/scripts/verify-track-c.mjs`

## ADR-070: 네이티브 메뉴바는 Tauri v2 메뉴와 frontend menu event bridge로 구현한다

- 일시: 2026-05-05
- 상태: 채택 (DIVE v4 Track D)
- 컨텍스트: Windows 데스크톱 앱으로 제품화하려면 New/Open/Open Recent/Settings/Tutorial 같은 앱 진입점이 OS 메뉴와 동일한 mental model로 동작해야 한다.
- 결정:
  - Tauri v2 `MenuBuilder`/submenu APIs로 File/View/Help 메뉴를 구성한다.
  - 메뉴 item id는 `menu:*` namespace로 고정하고 frontend는 Tauri event listener로 navigation/toast/action을 처리한다.
  - `Open Recent`는 DB recent projects를 읽어 메뉴 재빌드 시 반영한다.
- 대안:
  - HTML 내부 메뉴만 제공 — Windows 데스크톱 앱 기대와 다르고 keyboard/menu automation 검증이 약하다.
  - Tauri v1 API 또는 platform-specific shell 메뉴 — v2 기준 명세와 충돌하므로 거부한다.
- 결과:
  - 메뉴 actions가 product route와 프로젝트 생성/열기 흐름을 공유한다.
- 참조 파일:
  - `dive/src-tauri/src/menu.rs`
  - `dive/src-tauri/src/lib.rs`
  - `dive/src/hooks/use-native-menu-events.ts`
  - `dive/scripts/verify-track-d.mjs`

## ADR-071: 설명성 학습 문구는 기본 비활성 Tutorial mode로만 노출한다

- 일시: 2026-05-05
- 상태: 채택 (DIVE v4 Track E)
- 컨텍스트: 제품 UI에서는 긴 설명 문구가 사용 흐름을 방해하지만, 입문자 튜토리얼에서는 단계별 안내가 필요하다. 안전 카피는 숨기면 안 된다.
- 결정:
  - `dive:ui-preferences` persisted store에 `tutorialEnabled`를 두고 기본값은 false로 한다.
  - `LearningHint` 컴포넌트로 순수 설명/학습 보조 문구만 gating한다.
  - 안전/권한/위험도 카피 K1~K6는 절대 `LearningHint` 뒤에 숨기지 않는다.
  - Help 메뉴의 Tutorial action은 tutorial mode를 켜고 안내 toast를 띄운다.
- 대안:
  - 모든 설명 문구 제거 — 파일럿 onboarding과 교사용 시나리오에서 안내 근거가 사라진다.
  - 안전 문구까지 tutorial mode에 종속 — 권한 카드/위험 고지의 제품 안전 계약을 깨므로 거부한다.
- 결과:
  - 기본 제품 화면은 간결해지고, 튜토리얼에서는 같은 화면에서 보조 설명을 복원할 수 있다.
- 참조 파일:
  - `dive/src/stores/ui-preferences.ts`
  - `dive/src/components/ui/learning-hint.tsx`
  - `dive/src/pages/settings.tsx`
  - `dive/scripts/verify-track-e.mjs`

## ADR-072: 선택 모델은 새 DB 컬럼 없이 ProviderConfig.config JSON의 `selected_model`에 저장한다

- 일시: 2026-05-05
- 상태: 채택 (DIVE v4 Track G)
- 컨텍스트: v4는 provider별 모델 선택 UI가 필요하지만, rc.2 이후 사용자 DB를 불필요하게 마이그레이션하지 않고 기존 provider config 확장 지점으로 해결해야 한다.
- 결정:
  - 선택 모델은 `provider_configs.config` JSON 안의 `selected_model` key에 저장한다.
  - 저장 시 기존 config key를 merge 보존한다.
  - hydration은 `selected_model`을 우선 읽고, 기존 row 호환을 위해 legacy `model` key를 fallback으로 읽는다.
  - runtime active provider가 있으면 모델 변경 시 runtime snapshot도 원자적으로 교체한다.
- 대안:
  - `selected_model` 전용 컬럼 추가 — v4 범위 대비 migration/rollback surface가 커진다.
  - frontend localStorage만 사용 — backend runtime hydration과 재시작 persistence가 깨진다.
- 결과:
  - provider model selection이 DB와 runtime 양쪽에서 일관되며 기존 config payload를 보존한다.
- 참조 파일:
  - `dive/src-tauri/src/db/dao/provider_config.rs`
  - `dive/src-tauri/src/ipc/provider.rs`
  - `dive/src-tauri/src/ipc/mod.rs`
  - `dive/src/components/settings/ProviderModelSelector.tsx`

## ADR-073: Demo route 파일은 보존하되 production bundle에서는 DEV-only lazy import로 제외한다

- 일시: 2026-05-05
- 상태: 채택 (DIVE v4 Track F)
- 컨텍스트: demo pages는 개발/QA fixture로 계속 필요하지만, production bundle과 사용자 route에서는 제품 앱만 노출되어야 한다.
- 결정:
  - demo page 파일은 삭제하지 않는다.
  - `import.meta.env.DEV` 조건과 lazy/dynamic import를 사용해 production tree-shaking 대상에서 제외한다.
  - production에서 `?demo=` 진입 시 product shell fallback으로 처리한다.
- 대안:
  - demo 파일 삭제 — QA fixture와 시각 regression reference를 잃는다.
  - static import 유지 후 route만 숨김 — production bundle에 demo 코드가 남아 v4 목표와 충돌한다.
- 결과:
  - 개발 모드에서는 demo routes를 유지하고, production build에서는 demo code path가 번들에 포함되지 않는다.
- 참조 파일:
  - `dive/src/App.tsx`
  - `dive/src/demo/DemoRouter.tsx`
  - `dive/scripts/verify-track-f.mjs`

## ADR-074: 프로젝트 폴더 선택은 Tauri v2 dialog directory picker를 표준으로 한다

- 일시: 2026-05-05
- 상태: 채택 (DIVE v4 Track B)
- 컨텍스트: 입문자가 경로 문자열을 직접 입력하는 방식은 Windows UX와 오류 복구에 취약하다. 제품화된 onboarding/project creation은 OS folder picker를 기본으로 해야 한다.
- 결정:
  - 프로젝트 생성/온보딩은 `@tauri-apps/plugin-dialog`의 `open({ directory: true })`를 우선 사용한다.
  - Tauri runtime이 아니거나 dialog 실패 시 수동 경로 입력 fallback을 유지한다.
  - 선택된 폴더는 기존 project creation IPC와 같은 validation path를 통과한다.
- 대안:
  - 수동 입력만 유지 — 경로 오타와 Windows path UX 문제가 반복된다.
  - backend-only picker command 작성 — Tauri v2 plugin이 제공하는 표준 surface를 중복한다.
- 결과:
  - 데스크톱 앱다운 폴더 선택 UX와 기존 검증 경로를 함께 유지한다.
- 참조 파일:
  - `dive/src/components/onboarding/OnboardingDialog.tsx`
  - `dive/src/components/project/ProjectCreateDialog.tsx`
  - `dive/scripts/verify-track-b.mjs`

## ADR-075: UI 안내 문자열에는 구체 모델 ID를 하드코딩하지 않는다

- 일시: 2026-05-05
- 상태: 채택 (DIVE v4 Track G)
- 컨텍스트: 모델 ID는 빠르게 바뀌며, 기본 chat hint나 toast 같은 안내 문구에 특정 ID가 박히면 문서/코드/제품 copy가 즉시 stale해진다. 반면 provider selector option value에는 실제 모델 ID가 필요하다.
- 결정:
  - 기본 chat chip/hint/toast/설명 copy는 “선택한 모델”, “모델 선택”처럼 generic하게 유지한다.
  - 실제 모델 ID는 provider factory/static model list와 selector option value/display 영역에만 둔다.
  - OpenAI/Anthropic/Codex/OpenRouter static lists는 provider module에서 중앙 관리한다.
- 대안:
  - 최신 모델 ID를 UI hint에 직접 표시 — 최신성 유지 비용과 Track G 불변 조건 때문에 거부한다.
  - 모델 ID를 모두 숨김 — 사용자가 어떤 모델을 선택하는지 알 수 없으므로 selector option에는 표시해야 한다.
- 결과:
  - 제품 안내 문구는 모델 출시 주기에 덜 민감해지고, 선택 UI는 실제 ID 기반으로 동작한다.
- 참조 파일:
  - `dive/src/components/chat/ChatInput.tsx`
  - `dive/src/components/settings/ProviderModelSelector.tsx`
  - `dive/src-tauri/src/providers/factory.rs`
  - `dive/scripts/verify-track-g.mjs`

## ADR-076: 게이트 ablation은 연구 전용 runtime flag와 EventLog trace로만 허용한다

- 일시: 2026-05-05
- 상태: 채택 (DIVE productization/research evidence)
- 컨텍스트: 학술 비교 실험에서 D/I/V/E 게이트의 효과를 측정하려면 게이트 OFF 조건이 필요하다. 그러나 일반 교실 사용에서 게이트 우회가 노출되면 DIVE의 교육적 안전장치가 무력화될 수 있다.
- 결정:
  - 기본값은 항상 게이트 ON으로 유지한다.
  - Settings의 연구 전용 섹션에서만 runtime `disable_gates`를 켤 수 있다.
  - agent loop가 게이트를 우회할 때마다 `EventLog`에 `gate_bypassed` 이벤트를 기록한다.
  - headless/dev 검증용 `DIVE_RESEARCH_ABLATION_GATES=1` 환경 변수는 유지하되 교실 운영 경로로 권장하지 않는다.
- 대안:
  - 모든 사용자에게 게이트 OFF 토글 노출 — 제품의 초심자 보호 목표와 충돌한다.
  - 코드 분기 없이 별도 ablation 빌드 생성 — 연구 재현성은 높지만 배포/검증 비용이 커진다.
  - 환경 변수만 사용 — 교실 연구자가 조건 전환을 확인하기 어렵고 EventLog 추적이 약하다.
- 결과:
  - 연구자는 동일 앱에서 게이트 ON/OFF 조건을 비교할 수 있고, 분석자는 JSONL export의 `gate_bypassed` 기록으로 조건을 검증할 수 있다.
- 참조 파일:
  - `dive/src-tauri/src/agent/mod.rs`
  - `dive/src-tauri/src/ipc/policy.rs`
  - `dive/src/pages/settings.tsx`
  - `docs/research-ablation.md`

## ADR-080: SQLite는 runtime SoT, `.dive/plan.json`은 승인 시점 portable export

- 일시: 2026-05-09
- 상태: 채택 (Phase 9 — Plan-first 흐름 도입의 기반)
- 컨텍스트: v0.3 Plan-first 흐름에서 사용자의 의도(Interview), 승인된 계획(Plan), 작업 단위(Step), 실행 매핑(StepSessionMapping)을 어디에 진실되게 보관할지 결정해야 한다. 후보는 (a) `.dive/plan.json`을 1차 진실로 두는 안, (b) SQLite를 1차 진실로 두는 안, (c) 둘을 동등하게 두고 양방향 동기화하는 안.
- 결정:
  - SQLite의 `Plan`/`Step`/`StepSessionMapping`/`Interview` 테이블이 runtime SoT다.
  - `.dive/plan.json`/`plan.md`/`flow.mmd`는 `Plan.status = approved` 시점에 SQLite로부터 결정론적으로 생성되는 portable export(snapshot)다.
  - 앱 시작 시 `.dive/plan.json`이 존재하지만 SQLite Plan이 없으면 import(복원)한다 — 프로젝트 폴더 이동·백업 시나리오 보호.
  - SQLite와 파일이 동시에 존재하고 충돌하면 SQLite가 우선이며, 파일은 다음 export 시 덮어써진다.
  - 사용자 직접 파일 편집은 비지원. 편집은 IPC를 거친다.
- 대안 검토:
  - (a) 파일 1차 — git diff/PR 친화적이지만, 동시 쓰기·인덱싱·참조무결성을 SQLite로 강제하기 어렵고 ADR-008/010/011과 충돌.
  - (c) 양방향 동기화 — 충돌 해결과 lock 정책이 복잡해져 입문자 보호 원칙과 어긋난다.
- 결과:
  - Phase 9 데이터 모델(Interview/Plan/Step/StepSessionMapping)이 ADR-008(rusqlite 0.32) + ADR-010(append-only migration) 위에서 일관된다.
  - 외부 도구·연구자는 `.dive/plan.json`만 읽으면 plan을 portable하게 분석할 수 있다.
- 참조 파일:
  - `dive/src-tauri/src/db/schema.rs` (CREATE_INTERVIEW/PLAN/STEP/STEP_SESSION_MAPPING)
  - `dive/src-tauri/src/db/migrations.rs` (migration_v7)
  - `dive/src-tauri/src/workspace_plan/artifacts.rs` (export 생성)
  - `docs/internal/DIVE_NEXT_PHASE9_PLAN.md`
  - `DIVE_SPEC.md` §4.1.1, §4.1.6, §10.2

## ADR-081: Card 테이블은 변경하지 않고 별도 Step 테이블로 계획 메타데이터 분리

- 일시: 2026-05-09
- 상태: 채택 (Phase 9)
- 컨텍스트: Plan-first 흐름에서 "계획 단위(Step)"가 새로 도입되어야 한다. 후보는 (a) 기존 `Card`에 plan metadata 컬럼들(`instruction_seed`, `expected_files`, `acceptance_criteria`, `verification_*`, `dependencies`, `parallel_group`)을 추가하는 안, (b) 별도 `Step` 테이블을 만들고 Card는 실행 단위로 유지하는 안. Card는 D/I/V/E state machine, gate, 272줄의 DAO 테스트 + 128줄의 state machine 테스트 + gate 통합 테스트에 깊이 결합되어 있다.
- 결정:
  - `Card` 테이블의 컬럼·DAO·state machine·gate는 변경하지 않는다.
  - `Step` 테이블을 신규로 만들고, plan metadata(instruction_seed/expected_files/acceptance_criteria/verification/dependencies/parallel_group/position)를 거기에만 보관한다.
  - Step ↔ Card 연결은 `StepSessionMapping`이 담당(별 ADR-082 참조).
  - 마이그레이션은 ADR-010의 append-only 원칙에 따라 `migration_v7`으로 추가한다.
- 대안 검토:
  - (a) Card 확장 — 기존 게이트·테스트 회귀 위험이 크고, "실행 단위(Card)"와 "계획 단위(Step)"의 의미가 한 테이블에 섞여 책임 경계가 흐려진다.
- 결과:
  - Phase 9 도입에서 Card 회귀 0건이 가능. 기존 v0.2 게이트·테스트는 수정 없이 통과.
  - 계획 변경(`Step` 추가·dependency 변경)이 실행 상태(`Card.state`)에 영향을 주지 않으므로 Plan 편집이 안전.
- 참조 파일:
  - `dive/src-tauri/src/db/schema.rs` (CREATE_STEP)
  - `dive/src-tauri/src/db/dao/card.rs` (변경 없음)
  - `dive/src-tauri/src/db/dao/step.rs` (신규)
  - `dive/src-tauri/src/dive/state_machine.rs` (변경 없음)
  - `DIVE_SPEC.md` §4.2.1, §10.2

## ADR-082: Step ↔ Card는 `StepSessionMapping`을 통한 선택적 1:1 매핑

- 일시: 2026-05-09
- 상태: 채택 (Phase 9)
- 컨텍스트: Step(계획 단위)과 Card(실행 단위)의 관계 모델이 필요하다. 후보는 (a) `Card.step_id` FK 직접 추가, (b) Step ↔ Card 1:N(한 Step이 여러 Card 생성), (c) `StepSessionMapping`이라는 매핑 테이블에 Step ↔ Session ↔ Card를 함께 저장하는 안.
- 결정:
  - `StepSessionMapping(step_id UNIQUE, session_id NULL FK, card_id NULL FK, status, ...)` 테이블로 매핑을 외재화한다.
  - 매핑은 **Step당 0..1**(선택적). Step Open 전에는 매핑 없음(Plan만 존재), Open 시 Session/Card 생성 또는 재사용 후 매핑 row가 만들어진다.
  - `status`는 `planned/blocked/ready/in_progress/review/done/shipped` 중 하나로, Roadmap 시각화의 1차 입력이다.
  - `Card`/`Session` 테이블은 변경하지 않는다(ADR-081과 일관).
- 대안 검토:
  - (a) `Card.step_id` FK 직접 — Card 테이블 변경 회귀를 부르고, Step Open 전 "계획만 있는 상태"를 표현하기 어렵다.
  - (b) 1:N 매핑 — Step 단위의 검증 evidence/checkpoint/user_decision을 어디에 둘지 모호. 또한 v0.3 권장 경로는 "Step당 1 Session" 단순 모델이며, 1:N은 미래(병렬 분기) 검토 사안.
- 결과:
  - Step 단위 통합 정보(checkpoint_ids, verification_evidence, user_decision)를 매핑 row 한 곳에 모아 Roadmap이 단일 row 조회로 상태를 도출 가능.
  - "Plan만 만들고 아직 실행 안 함" 상태를 자연스럽게 표현(매핑 row 부재).
  - 미래에 1:N으로 확장이 필요하면 `step_id`의 UNIQUE만 풀고 N row를 허용하면 됨.
- 참조 파일:
  - `dive/src-tauri/src/db/schema.rs` (CREATE_STEP_SESSION_MAPPING)
  - `dive/src-tauri/src/db/dao/step_session_mapping.rs`
  - `dive/src-tauri/src/ipc/workspace_plan.rs` (`workspace_plan_step_open`)
  - `dive/src/features/roadmap/usePlanRoadmap.ts` (`derivePlanRoadmapSteps`)
  - `DIVE_SPEC.md` §4.1.4, §10.2

## ADR-083: Interview → Plan → Step → Card 책임 분리 (4계층 흐름)

- 일시: 2026-05-09
- 상태: 채택 (Phase 9)
- 컨텍스트: Plan-first 흐름의 각 단계가 어떤 데이터에 무슨 책임을 갖는지를 명확히 해야 코드/UI/IPC가 일관된다. 책임이 흐려지면 "어디서 mutating 도구를 차단할지", "Roadmap 상태는 누구로부터 유도되는지", "사용자 의도 변경은 어디까지 전파되는지"가 모호해진다.
- 결정:
  - **Interview** (project당 0..1) — 사용자 의도의 외화(소크라테스식 Q&A). 산출물은 `intent_summary`, `unresolved_questions`. mutating 도구 차단(`run_mode = Interview`).
  - **Plan** (project당 0..1) — 승인된 계획 메타(goal/scope/non_goals/constraints/acceptance_criteria). draft 동안 mutating 차단(`run_mode = Plan`), approved 시 Build 게이트 해제 + portable export 생성.
  - **Step** (plan당 N) — 계획 단위. instruction_seed/expected_files/verification/dependencies/parallel_group을 보관. 실행 상태는 보관하지 않음(ADR-082의 매핑이 책임).
  - **Card** (session당 N) — 실행 단위. D/I/V/E state machine, instruction, verify_log, changed_files. Step의 instruction_seed가 카드 분해의 초안이 되지만, Card 자체는 Step을 모름(매핑이 외재화).
  - 이 계층의 각 경계에서만 게이트가 작동한다(ADR-076의 ablation flag와 호환).
- 대안 검토:
  - 3계층(Plan → Step → Card, Interview를 Plan 안에 흡수) — 의도 파악 단계가 Plan과 한 곳에 섞이면, "의도가 바뀌면 Plan을 폐기해야 하는가"의 의사결정 경계가 흐려진다. Interview를 분리하면 폐기·재시작이 깔끔.
  - Step 안에 Card 직접 임베드 — Card의 D/I/V/E·게이트·체크포인트와 결합되어 Plan 편집 시 회귀 위험.
- 결과:
  - 각 계층의 mutating 권한·UI 진입·portable export·삭제 정책이 단일 ownership 규칙으로 결정 가능.
  - Plan 편집은 Step만 영향, Step 실행은 Card만 영향 → Plan 편집과 진행 중 작업이 충돌하지 않는다.
  - 향후 Plan 버전 관리(N개 plan 동시 보관)나 Step 병렬 분기를 도입할 때 경계가 명확해 마이그레이션이 쉬움.
- 참조 파일:
  - `dive/src-tauri/src/dive/gate.rs` (`run_mode` 분기)
  - `dive/src-tauri/src/agent/mod.rs` (Step context 주입)
  - `dive/src-tauri/src/ipc/workspace_plan.rs` (각 계층 IPC)
  - `dive/src/features/planning/`, `dive/src/features/roadmap/`
  - `DIVE_SPEC.md` §4.1.x, §4.2.x, §10.2
