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
  - **블록리스트 매칭 전략**: 리터럴 substring (case-insensitive, 명세 §9.2 예시의 14 변형) + 정규식 (dd→block device, mkfs.*, curl|bash, wget|sh, iwr|iex, rm -rf 절대 경로 루트레벨). AST 파싱은 `v1.0` 이후로 연기 — bash 문법 파서 추가 복잡도 대비 이득이 낮고, 리터럴+정규식 2중화로 스펙 예시 전부 차단 가능.
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
  - **실제 학교 PC 검증은 사용자 몫으로 명시 이관**: `DIVE_PROGRESS.md` 4-5 완료 노트에 "외부 자원 필요 항목(사용자 실행 대기)" 섹션 추가. Phase 5 진입 전이라도 파일럿 실시 가능.
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
