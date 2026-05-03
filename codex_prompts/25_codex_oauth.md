# 작업 25: Codex OAuth (PKCE)

## 컨텍스트
ChatGPT 구독 사용자가 본인 구독으로 모델 호출. PKCE 기반이라 client secret 없이 데스크톱 앱에 적합. **OpenAI가 비공식 사용을 차단할 위험이 있으므로 fallback이 중요.**

## 이번 작업 범위
- PKCE 흐름 구현 (verifier·challenge 생성)
- localhost 콜백 서버 (axum, 포트 1455)
- OAuth 토큰 교환·저장·자동 갱신
- ChatGPT-Account-ID 추출 (id_token JWT 디코드)
- LlmProvider 어댑터로 통합
- 차단 위험 대비 fallback 동작

## 명세 참조
- DIVE_SPEC.md §7.4 — ChatGPT 구독 (Codex OAuth) 전체

## 단계

1. `Cargo.toml` — `axum`, `oauth2`, `jsonwebtoken`, `tokio`, `pkce`, `fs2`
2. `src-tauri/src/auth/codex_oauth.rs`:
   ```rust
   pub async fn start_oauth_flow() -> Result<()>
   ```
   - PKCE verifier·challenge 생성
   - `https://auth.openai.com/oauth/authorize?...` URL 빌드
   - 시스템 브라우저 열기 (`tauri-plugin-shell`)
   - localhost:1455에 axum 콜백 서버 실행 (timeout 5분)
3. 콜백 처리:
   - 사용자가 브라우저에서 ChatGPT 로그인 → code 수신
   - `POST https://auth.openai.com/oauth/token` 토큰 교환
   - `access_token`, `refresh_token`, `id_token` 수신
4. `id_token` JWT 디코드 → `accountId` 추출 (검증 없이 payload만)
5. Keyring 저장:
   - `auth::store_key("codex_oauth_access", access_token)`
   - `auth::store_key("codex_oauth_refresh", refresh_token)`
   - `auth::store_key("codex_oauth_account", account_id)`
6. `src-tauri/src/providers/codex_oauth.rs` — LlmProvider 구현:
   - 호출 시 헤더:
     ```
     Authorization: Bearer <access_token>
     ChatGPT-Account-ID: <account_id>
     OpenAI-Beta: responses=v1
     ```
   - 시스템 프롬프트 첫 부분에 Codex CLI prefix 필요 (현재 알려진 prefix 사용, 변경 시 업데이트)
   - 응답 형식이 OpenAI Responses API임. Chat Completions shape으로 변환 필요.
7. 자동 토큰 갱신:
   - `tokio::spawn` background task
   - 만료 5분 전 갱신 시도
   - 파일 락 (`fs2::FileExt::lock_exclusive`)으로 동시 갱신 race 방지
   - 갱신 실패 시 사용자에게 토스트 + 재인증 요청
8. **Fallback** — Codex 차단 감지 시 자동 다른 프로바이더 안내:
   - 호출 시 401·403·429와 함께 알려진 차단 메시지 패턴 감지
   - 사용자에게 토스트 — "ChatGPT 구독 연결이 차단되었습니다. 다른 프로바이더로 전환해주세요."
   - 설정에서 자동으로 [재인증] 버튼 노출 (효과 없을 가능성 높지만 옵션 제공)
9. 단위 테스트 — mock OAuth 서버, JWT 디코드, fallback 감지

## 완료 조건
- [ ] 사용자가 [ChatGPT 구독 연결] 클릭 → 브라우저 열림 → 로그인 → 자동으로 DIVE에 토큰 저장
- [ ] LLM 호출 정상 (Anthropic/OpenAI와 동일 인터페이스)
- [ ] 자동 토큰 갱신 동작 (수동 테스트)
- [ ] 토큰 갱신 실패 시 친절한 재인증 안내
- [ ] Codex 차단 패턴 감지 시 fallback 안내
- [ ] keyring에 토큰 저장됨 (평문 저장 X)
- [ ] 단위 테스트 통과

## 확인 질문
- Codex CLI prefix — Codex 업데이트마다 변경 가능. 알려진 최신 prefix를 코드에 하드코딩 + 환경변수로 override 가능하게.
- localhost:1455 포트 — 충돌 가능성. 실패 시 다른 포트 자동 선택? 일단 고정, 충돌 시 사용자에게 안내.
- OpenAI 차단 시점 — 명세 §7.4 위험 노트. README와 매뉴얼에 명시.
- Codex CLI 버전 호환성 — 본 프로젝트는 Codex CLI 자체가 아닌 OAuth 흐름만 모방. CLI 업데이트와 독립적이지만 OAuth 엔드포인트나 헤더 변경 시 영향. 모니터링 필요.

## 작업 후
- DIVE_PROGRESS.md 5-1 `[x]`
- ADR: Codex CLI prefix 하드코딩 vs 동적 fetch, fallback 정책
