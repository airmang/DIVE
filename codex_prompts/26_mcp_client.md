# 작업 26: MCP 클라이언트 기반 (rmcp)

## 컨텍스트
명세 §6.3.2의 MCP (Model Context Protocol) 통합. 외부 도구 서버를 등록해 학생이 가져다 쓸 수 있도록. 교사가 만든 학습용 MCP 서버 시나리오 가능.

## 이번 작업 범위
- `rmcp` crate 통합 (Rust MCP 클라이언트)
- stdio 방식 MCP 서버 등록·연결
- streamable HTTP 방식 등록·연결
- 등록된 MCP 서버의 도구 목록 fetch
- Tool Registry에 MCP 도구 통합
- 권한 카드 통합은 작업 27

## 명세 참조
- DIVE_SPEC.md §6.3.2 — MCP 지원
- DIVE_SPEC.md §8.5 — MCP 통합

## 단계

1. `Cargo.toml` — `rmcp = "..."` (최신 버전)
2. `src-tauri/src/mcp/client.rs`:
   ```rust
   pub async fn connect_stdio(cmd: &str, args: &[&str], env: HashMap<String, String>)
       -> Result<McpSession>
   pub async fn connect_http(url: &str, headers: HashMap<String, String>)
       -> Result<McpSession>
   pub async fn list_tools(session: &McpSession) -> Result<Vec<McpTool>>
   pub async fn call_tool(session: &McpSession, name: &str, input: Value)
       -> Result<Value>
   ```
3. `src-tauri/src/mcp/registry.rs` — 등록된 MCP 서버 관리:
   - SQLite 새 테이블 `McpServer` (id, kind, command/url, env, label, enabled)
   - 시작 시 enabled 서버 자동 연결
   - 연결 실패 시 토스트 + 재시도 옵션
4. UI — 설정 화면 새 탭 [MCP]:
   - 등록된 MCP 서버 목록
   - [+ 서버 추가] — stdio (명령 + args) 또는 HTTP (URL + 헤더)
   - 서버별 [활성/비활성] 토글, [✕ 삭제]
   - 각 서버의 도구 목록 표시 (활성 시)
5. Tool Registry 확장 — MCP 도구를 일반 도구처럼 등록:
   - `name` 형식: `mcp::server_id::tool_name` (충돌 회피)
   - 호출 시 적절한 MCP 세션으로 dispatch
6. 도구 위험도 결정 — 명세 §8.5:
   - 서버 등록 시 사용자가 도구별 위험도 지정 (또는 일괄 설정 — 모두 "주의")
   - MCP 서버가 메타데이터에 위험도 힌트 제공 시 그것 사용 (rmcp 표준 확장)
7. 단위 테스트 — mock MCP 서버 (rmcp 테스트 유틸리티)
8. 통합 테스트 — 실제 MCP 서버 (예: `@modelcontextprotocol/server-filesystem`) 연결, 도구 호출

## 완료 조건
- [ ] stdio MCP 서버 등록·연결 성공
- [ ] HTTP MCP 서버 등록·연결 성공
- [ ] 등록 시 도구 목록 fetch 성공
- [ ] AI가 MCP 도구 호출 시 정상 동작 (자동 승인 모드)
- [ ] 서버 비활성화 시 도구 사용 불가
- [ ] 시작 시 enabled 서버 자동 재연결
- [ ] 단위 테스트 통과

## 확인 질문
- MCP OAuth 인증 — 명세 §8.5에서 언급. 일부 서버는 OAuth 필요. rmcp의 streamable HTTP + OAuth 기능 사용. 이번 작업에 포함 vs 후속? 후속 권장 (복잡도).
- stdio 서버 자식 프로세스 관리 — DIVE 종료 시 정리. SIGTERM → SIGKILL 순.
- MCP 서버 환경 변수 — 민감 정보(API 키 등) 포함 가능. SQLite 평문 저장 X. keyring 사용. ProviderConfig와 동일 패턴.
- 사용자 정의 도구 위험도 우선순위 — 사용자 설정 > MCP 메타 힌트 > 기본값 (주의).

## 작업 후
- DIVE_PROGRESS.md 5-2 `[x]`
- ADR: MCP OAuth 시점, stdio 프로세스 관리, 위험도 우선순위
