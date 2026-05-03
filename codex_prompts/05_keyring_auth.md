# 작업 05: Keyring 인증 + 설정 저장

## 컨텍스트
API 키, OAuth 토큰을 Windows Credential Manager에 안전하게 저장합니다. 명세 §9.5에 따라 평문 저장은 절대 금지. SQLite의 `ProviderConfig` 테이블에는 비민감 설정만, 민감 정보는 keyring에.

## 이번 작업 범위
- `keyring` crate 통합 (Windows Credential Manager 추상화)
- 키링 추상화 모듈 — `auth::store_key`, `auth::load_key`, `auth::delete_key`
- `ProviderConfig` DAO와 연결
- API 키 저장·로드·삭제 흐름
- 단위 테스트 (mock 또는 in-memory keyring)
- OAuth 토큰 저장은 Codex OAuth 작업(25)에서 확장

## 명세 참조
- DIVE_SPEC.md §7.7 — 키와 토큰 저장
- DIVE_SPEC.md §9.5 — OAuth 토큰 보안
- DIVE_SPEC.md §10.4 — ProviderConfig 분리 원칙

## 단계

1. `Cargo.toml` — `keyring = "2"`
2. `src-tauri/src/auth/mod.rs`:
   ```rust
   pub fn store_key(provider_id: &str, key: &str) -> Result<()>
   pub fn load_key(provider_id: &str) -> Result<Option<String>>
   pub fn delete_key(provider_id: &str) -> Result<()>
   ```
   서비스 이름: `"DIVE"`, account 이름: `provider_id` (예: `"anthropic"`, `"openai"`)
3. ProviderConfig DAO 확장 — `register_provider(config, key)`: SQLite 저장 + keyring 저장 동시
4. `unregister_provider(id)` — 양쪽 동시 삭제
5. 평문 저장 코드 경로 정적 검증 — `grep -r "api_key" src-tauri/src/` 후 의심 발견 시 즉시 제거
6. 단위 테스트 — keyring 모킹 또는 별도 service 이름으로 격리. CI 환경 고려해 conditional compile.
7. 통합 테스트 — 키 저장 → 다른 프로세스/재시작 후 로드 확인 (수동 또는 자동)

## 완료 조건
- [ ] `auth::store_key`, `load_key`, `delete_key` 모두 동작
- [ ] ProviderConfig 등록 시 SQLite + keyring 일관성 유지
- [ ] 평문 저장 코드 경로 없음 (정적 분석 통과)
- [ ] 삭제 시 Windows Credential Manager에서 실제로 사라짐 (수동 확인 가능)
- [ ] 단위 테스트 통과

## 확인 질문
- macOS·Linux 지원은 Phase 6 또는 v1.1로 미루는 게 맞는지? (`keyring` crate가 양쪽 추상화를 이미 하지만 QA 부담)
- 키 누락 시 동작 — provider 사용 시 keyring 비어 있으면 친절한 에러 메시지로 재인증 요청
- 테스트에서 실제 keyring 건드리지 않도록 — `keyring::Entry::new_with_credential`로 in-memory 또는 별 service 이름 분리

## 작업 후
- DIVE_PROGRESS.md 1-5 `[x]`
- ADR: 테스트 격리 전략
