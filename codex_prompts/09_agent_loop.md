# 작업 09: Agent Loop + 도구 호출

## 컨텍스트
백엔드 핵심. 메시지 → 모델 → 도구 호출 → 결과 → 재호출 루프를 구현합니다. 명세 §8.2 의사코드 그대로. Permission Hook은 골격만 (모든 도구 자동 승인) — 실제 권한 카드는 작업 10에서.

## 이번 작업 범위
- Agent Loop (Rust)
- Tool Registry — `read_file`, `list_dir`, `write_file`, `edit_file` 4개 (`bash`는 작업 16에서)
- Permission Hook 골격 (자동 승인)
- 스트리밍 이벤트를 Tauri event로 프론트 전달
- 채팅 ↔ Agent Loop IPC 연결
- 단위 테스트 (mock provider, mock tools)

## 명세 참조
- DIVE_SPEC.md §8.1 — 도구 호출 시퀀스
- DIVE_SPEC.md §8.2 — Agent Loop 의사코드
- DIVE_SPEC.md §8.4 — Tool Registry 구현
- DIVE_SPEC.md §6.3 — 도구 시스템 (도구 목록, 위험도)
- DIVE_SPEC.md §11.5 — IPC

## 단계

1. `src-tauri/src/agent/loop.rs` — Agent Loop:
   ```rust
   loop {
       let stream = provider.chat(req).await?;
       let mut tool_calls = vec![];
       while let Some(event) = stream.next().await {
           match event {
               TextDelta(t) => emit("chat_message_delta", t),
               ToolCall(tc) => tool_calls.push(tc),
               Done(_) => break,
           }
       }
       if tool_calls.is_empty() { break; }
       for tc in tool_calls {
           let perm = permission_hook.intercept(&tc).await?;
           if perm.approved {
               let result = tool_registry.run(tc).await?;
               messages.push(tool_result);
           } else {
               messages.push(tool_rejected);
           }
       }
   }
   ```
2. `src-tauri/src/tools/registry.rs` — Tool trait 정의, 등록 시스템
3. `src-tauri/src/tools/builtin/` — 4개 내장 도구 (`read_file.rs`, `list_dir.rs`, `write_file.rs`, `edit_file.rs`)
4. `ToolContext` — 프로젝트 루트, FS 가드 (이번 작업은 단순 — 경로 제한은 작업 16)
5. `src-tauri/src/agent/permission.rs` — Permission Hook 골격, 모든 도구 자동 승인 (작업 10에서 권한 카드 통합)
6. `src-tauri/src/ipc/chat.rs` — Tauri command `chat_send`, `chat_cancel`
7. Tauri event 정의 — `chat_message_delta`, `chat_tool_call_started`, `chat_tool_call_done`, `chat_done`, `chat_error`
8. 프론트 (`src/lib/agent.ts`) — `invoke('chat_send', ...)`, event listener 통합 → useChatStore
9. 더미 스트림 코드(작업 08) 제거, 실제 백엔드 연결
10. 단위 테스트 — mock provider, mock tools로 루프 흐름 검증

## 완료 조건
- [ ] 채팅에서 "현재 폴더 파일 보여줘" → AI가 list_dir 호출 → 결과 표시까지 동작
- [ ] AI가 여러 도구 연속 호출 가능 (write_file → read_file로 검증 등)
- [ ] 스트리밍 텍스트가 끊김 없이 표시
- [ ] 도구 호출 중 에러 발생 시 stderr가 AI 메시지로 전달, AI가 재시도 가능
- [ ] `chat_cancel` 동작 — 진행 중 호출을 사용자가 중단 가능
- [ ] 단위 테스트 통과

## 확인 질문
- 동시 호출 정책 — 사용자가 메시지 보내는 중 새 메시지 보내면? 큐 vs 거절. 거절 추천 (혼란 방지)
- 도구 호출 병렬 실행 — 모델이 한 번에 여러 tool_call 반환 시 직렬? 병렬? 직렬 추천 (디버깅 용이, 권한 카드 흐름과 일관)
- 무한 루프 방지 — 같은 도구·인자 N회 연속 호출 시 강제 정지 (명세 §6.4.3)
- 컨텍스트 길이 — 토큰 한도 초과 시 어떻게? 오래된 메시지 요약? 단순 절단? 일단 절단으로, 요약은 후속 작업

## 작업 후
- DIVE_PROGRESS.md 2-3 `[x]`
- ADR: 동시 호출 정책, 도구 병렬·직렬, 컨텍스트 한도 처리
