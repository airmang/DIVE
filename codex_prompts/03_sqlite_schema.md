# 작업 03: SQLite 스키마 + DAO + 마이그레이션

## 컨텍스트
백엔드 데이터 저장 기반. 명세 §10.2의 9개 엔티티를 SQLite 테이블로 만들고, Rust DAO 레이어를 구축합니다. 마이그레이션 시스템도 포함 — 향후 스키마 변경에 대비.

## 이번 작업 범위
- `rusqlite` (`bundled` feature) 의존성 추가
- 9개 테이블 CREATE — Project, Session, Workmap, Card, Message, ToolCall, Checkpoint, ProviderConfig, EventLog
- 마이그레이션 시스템 (버전 관리)
- DAO 레이어 — 각 엔티티 CRUD
- 단위 테스트
- API 키·OAuth 토큰은 keyring에 저장 (이 작업은 아님, ProviderConfig 필드만 정의)

## 명세 참조
- DIVE_SPEC.md §10.2 — 9개 엔티티 스키마
- DIVE_SPEC.md §10.3 — 카드 상태 enum
- DIVE_SPEC.md §10.4 — ProviderConfig 분리 원칙
- DIVE_SPEC.md §10.5 — EventLog

## 단계

1. `Cargo.toml` — `rusqlite = { version = "0.31", features = ["bundled"] }`, `serde`, `serde_json`, `uuid`, `chrono`
2. `src-tauri/src/db/mod.rs` — DB 연결 추상화, connection pool (`r2d2-sqlite` 검토)
3. `src-tauri/src/db/migrations/` — 마이그레이션 파일들 (`001_initial.sql` 등)
4. 마이그레이션 러너 — `schema_version` 테이블로 현재 버전 관리, 시작 시 자동 적용
5. 각 엔티티 모델 (`src-tauri/src/db/models/`) — `Project`, `Session`, `Workmap`, `Card`, `Message`, `ToolCall`, `Checkpoint`, `ProviderConfig`, `EventLog`
6. `CardState` enum (§10.3) — `Decomposed`, `Instructed`, `Verifying`, `Verified`, `Rejected`, `Extended`
7. 각 DAO — CRUD + 관계 쿼리 (예: `Card::find_by_session(session_id)`)
8. 단위 테스트 — in-memory SQLite로 각 DAO의 CRUD 동작 확인
9. JSON 필드(`verify_log`, `tool_calls`, `usage`, `changed_files`)는 `Value` 또는 strongly-typed 구조체로

## 완료 조건
- [ ] 마이그레이션이 빈 DB → 최신 스키마로 정상 적용
- [ ] 각 DAO 단위 테스트 통과
- [ ] `cargo test` 에러 0
- [ ] 9개 테이블 모두 §10.2 스키마와 일치
- [ ] `CardState` enum이 §10.3과 일치
- [ ] ProviderConfig에 API 키 필드 없음 (keyring에 저장될 것이므로)

## 확인 질문
- `sqlx`(컴파일 타임 SQL 검사) vs `rusqlite`(런타임) — 명세는 rusqlite 명시. 그대로 갈지?
- 트랜잭션 격리 — 단일 사용자 가정, `serializable` 기본
- 마이그레이션 파일 형식 — SQL 파일 vs Rust 코드. SQL 파일 추천 (검토 용이)
- JSON 필드 strongly-typed — `verify_log`, `usage` 등은 구체 구조체로? 자유 JSON으로?

## 작업 후
- DIVE_PROGRESS.md 1-3 `[x]`
- ADR 후보: 트랜잭션 격리, 마이그레이션 형식, JSON 필드 타입 결정
