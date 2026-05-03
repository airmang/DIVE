# 작업 04: LlmProvider trait + Anthropic·OpenAI 어댑터

## 컨텍스트
멀티 프로바이더 지원의 기반. 모든 LLM 호출이 동일한 trait를 거치도록 추상화합니다. 내부 정규화 형식은 OpenAI Chat Completions shape — OpenAI/OpenRouter는 그대로, Anthropic은 어댑터에서 변환.

## 이번 작업 범위
- `LlmProvider` trait 정의 (명세 §7.1과 시그니처 일치)
- Anthropic 어댑터 — `messages` 형식 ↔ OpenAI shape 변환
- OpenAI 어댑터 — 직접 매핑
- 스트리밍 (SSE) 지원
- 단위 테스트 + 옵션 통합 테스트 (env에 키 있을 때만)
- Codex OAuth, OpenRouter, Custom은 다음 작업·후속 Phase에서

## 명세 참조
- DIVE_SPEC.md §7.1 — LlmProvider trait
- DIVE_SPEC.md §7.2 — Anthropic API
- DIVE_SPEC.md §7.3 — OpenAI API
- DIVE_SPEC.md §11.4 — 자체 에이전트 루프 구현 이유

## 단계

1. `Cargo.toml` — `async-trait`, `reqwest` (`stream` feature), `tokio`, `futures`, `eventsource-stream`
2. `src-tauri/src/providers/mod.rs` — trait 정의:
   ```rust
   #[async_trait]
   pub trait LlmProvider: Send + Sync {
       fn id(&self) -> &str;
       fn list_models(&self) -> Vec<ModelInfo>;
       async fn chat(&self, req: ChatRequest)
           -> Result<BoxStream<'_, ChatEvent>>;
       async fn refresh_auth(&mut self) -> Result<()>;
   }
   ```
3. 정규화 형식 정의 — `ChatRequest`, `ChatEvent`, `Message`, `ToolCall`, `Usage` (OpenAI shape 기준)
4. `src-tauri/src/providers/openai.rs` — 직접 매핑, SSE 파싱 (`eventsource-stream`)
5. `src-tauri/src/providers/anthropic.rs` — 변환 로직:
   - `messages` 형식 (system 분리, content blocks)
   - `tools` 형식 변환
   - SSE event 종류별 매핑 (`content_block_delta`, `tool_use` 등)
6. `ChatEvent::TextDelta`, `ChatEvent::ToolCall`, `ChatEvent::Done(Usage)` 이벤트 통일
7. 에러 처리 — `ProviderError` enum (network, auth, rate_limit, invalid_request)
8. 단위 테스트 — mock HTTP 응답으로 양쪽 어댑터 변환 검증
9. 옵션 통합 테스트 — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` env 있으면 실제 호출

## 완료 조건
- [ ] 두 어댑터가 같은 정규화된 입력 → 정규화된 출력 반환
- [ ] 스트리밍 정상 동작 (텍스트 점진 생성)
- [ ] tool_calls 형식이 OpenAI shape으로 통일됨
- [ ] 에러 매핑 — Anthropic·OpenAI 각자의 에러 → 공통 `ProviderError`
- [ ] 단위 테스트 모두 통과
- [ ] `cargo test` 에러 0

## 확인 질문
- `async-openai` crate 사용 vs `reqwest` 직접 — 직접 추천 (Anthropic 어댑터를 쓸 거라 일관성)
- 스트리밍 백프레셔 — 사용자가 입력 중 새 메시지 보내면 이전 스트림 어떻게? (이번 작업 X, Agent Loop에서)
- 모델 카탈로그 — 하드코딩 vs `/v1/models` 자동 fetch. 둘 다 지원?

## 작업 후
- DIVE_PROGRESS.md 1-4 `[x]`
- ADR: 모델 카탈로그 전략, 정규화 형식 세부사항
