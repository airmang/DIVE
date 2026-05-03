# 작업 08: 채팅 영역 + 메시지 스트림

## 컨텍스트
채팅 영역에 실제 메시지를 표시합니다. 6종 메시지 타입 + 스트리밍 + 입력란 + 모델 셀렉터 드롭다운. 백엔드 연결은 작업 09(Agent Loop)에서 — 이번에는 더미 스트림으로 시각 동작 확인.

## 이번 작업 범위
- 6종 메시지 컴포넌트 — 사용자, AI 텍스트, 도구 호출 placeholder, 도구 결과, 시스템, 에러
- 스트리밍 텍스트 (delta append)
- 입력란 + 전송 버튼 + 모델 셀렉터 (드롭다운 실제 동작)
- 프롬프트 도우미 버튼 (✨, 동작은 placeholder — 작업 28)
- 메시지 가상화 — `react-virtuoso` 또는 자체

## 명세 참조
- DIVE_SPEC.md §5.3 — 채팅 영역 상세
- DIVE_SPEC.md §5.3.1 — 메시지 종류 표
- DIVE_SPEC.md §5.3.2 — 모델 셀렉터
- 와이어프레임 — `images/01_main_layout.png`, `images/11_model_selector.png`

## 단계

1. `src/components/chat/types.ts` — Message 타입 union (user, assistant_text, tool_call, tool_result, system, error)
2. 메시지 컴포넌트들 (`src/components/chat/messages/`):
   - `UserMessage.tsx` — 우측 정렬, 보라 배경, 편집·재전송 버튼 (호버 시)
   - `AssistantMessage.tsx` — 좌측 정렬, panel2 배경, 복사 버튼
   - `ToolCallPlaceholder.tsx` — 빈 인라인, 작업 10에서 권한 카드로 교체
   - `ToolResultMessage.tsx` — 접힌 형태 + 펼치기 버튼
   - `SystemMessage.tsx` — 중앙 정렬, 작은 글씨
   - `ErrorMessage.tsx` — 빨간 좌측 바 + 재시도 버튼
3. `src/components/chat/MessageList.tsx` — 메시지 가상화, 자동 스크롤 (새 메시지 도착 시 하단 고정)
4. `src/components/chat/MessageInput.tsx` — textarea (multiline), Shift+Enter 줄바꿈, Enter 전송, 첨부 버튼, ✨ 버튼
5. `src/components/chat/ModelSelector.tsx` — 칩 클릭 시 dropdown, 프로바이더별 그룹핑, 권장 모델 별표
6. `useChatStore` (Zustand) — 메시지 목록, 입력 상태, 스트리밍 중 여부
7. 더미 스트림 — 사용자가 메시지 전송 시 setTimeout으로 토큰 한 글자씩 추가하는 mock 모델 (작업 09 전까지 임시)
8. 메시지 편집 — 사용자 메시지 호버 시 [편집] 버튼, 클릭 시 inline 수정 + 재전송 (히스토리에서 이후 메시지 제거)

## 완료 조건
- [ ] 6종 메시지가 모두 시각적으로 구분되어 렌더
- [ ] 입력 → 전송 → 더미 AI 응답 스트리밍 정상 동작
- [ ] 모델 셀렉터 드롭다운 (등록된 프로바이더가 없어도 placeholder 모델 표시)
- [ ] 메시지 자동 스크롤 (사용자가 위로 스크롤 중일 때는 자동 스크롤 X)
- [ ] 사용자 메시지 편집·재전송 동작
- [ ] 100개+ 메시지에서도 스크롤 부드러움 (가상화 검증)
- [ ] `pnpm typecheck`, `pnpm lint` 통과

## 확인 질문
- 가상화 — `react-virtuoso` vs `tanstack-virtual`. 메시지가 가변 높이인 점 고려해 virtuoso 추천
- 마크다운 렌더링 — AI 메시지에서 `**bold**`, 코드 블록 등 렌더할지? `react-markdown` + `rehype-highlight`. 작업 09에서 확정
- 코드 블록 syntax 하이라이팅 — `shiki` vs `prism`. shiki 추천 (Tailwind와 잘 맞음)
- 전송 중 입력 disabled 처리 — UX 결정. disabled 추천 (혼란 방지)

## 작업 후
- DIVE_PROGRESS.md 2-2 `[x]`
- ADR: 가상화 라이브러리, 마크다운 렌더링, 코드 하이라이팅 결정
