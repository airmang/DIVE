# 작업 10: 권한 카드 + diff 뷰어

## 컨텍스트
도구 호출 가시성의 핵심. 안전·주의·위험 3종 권한 카드 + diff 뷰어. 작업 09의 Permission Hook을 자동 승인에서 사용자 승인 흐름으로 전환.

## 이번 작업 범위
- 권한 카드 컴포넌트 3종 (안전·주의·위험)
- diff 뷰어 (`react-diff-viewer-continued` 또는 자체) — Monaco 미사용
- 도구별 위험도 매핑
- 승인/수정/거부 흐름 — 백엔드 Permission Hook과 연결
- 거부 시 AI에게 거부 메시지 전달 → AI가 다른 접근 시도

## 명세 참조
- DIVE_SPEC.md §5.5 — 권한 카드
- DIVE_SPEC.md §5.5.3 — 카드 안 정보 노출 (안전·주의·위험별)
- DIVE_SPEC.md §6.3.1 — 도구별 위험도 표
- DIVE_SPEC.md §6.4 — 권한 시스템
- 와이어프레임 — `images/04_permission_cards.png`

## 단계

1. `src-tauri/src/agent/permission.rs` 갱신:
   - 도구별 위험도 매핑 (`RiskLevel::Safe/Warn/Danger`)
   - 권한 요청 시 Tauri event `permission_request` emit
   - 사용자 응답 대기 (`permission_response` event 또는 `tool_approve`/`tool_reject` command)
   - 자동 승인 정책 검사 (현재 모든 도구 manual, 작업 20에서 설정 화면)
2. `src/components/permission-card/` 컴포넌트들:
   - `PermissionCard.tsx` — 위험도별 dispatch
   - `SafeCard.tsx` — 압축 (도구명 + 한 줄 설명만)
   - `WarnCard.tsx` — 도구명 + 변경 요약 + diff 본문 (펼침)
   - `DangerCard.tsx` — 도구명 + 명령어/입력 + 위험 사유
3. `src/components/permission-card/DiffViewer.tsx`:
   - `react-diff-viewer-continued` 통합 또는 자체 구현
   - 다크 모드 호환 (라이브러리 옵션 또는 CSS 오버라이드)
   - 짧은 diff (≤7줄) 인라인, 긴 diff는 [전체 보기 ↓] 링크 → 슬라이드 인 패널 (작업 11)
4. 승인/수정/거부 버튼:
   - [승인] — `invoke('tool_approve', { tool_call_id })`
   - [수정] — 입력 필드를 inline 편집 모드로 (예: 명령어 수정), 그 후 [승인]
   - [거부] — `invoke('tool_reject', { tool_call_id })`, 사유 입력 옵션
5. 채팅 메시지 스트림에 인라인 카드로 통합 — 작업 08의 `ToolCallPlaceholder`를 `PermissionCard`로 교체
6. 거부 후 AI 동작 검증 — 명세 §6.4.3 (3회 거부 시 AI가 사용자에게 명확화 질문)

## 완료 조건
- [ ] 명세 그림 11과 동일한 3종 카드 시각 차이
- [ ] 안전 카드 — read_file 호출 시 한 줄 압축 표시
- [ ] 주의 카드 — edit_file 호출 시 diff 펼친 형태
- [ ] 위험 카드 — bash 호출 시 명령어 + 위험 사유 (현재 bash는 작업 16에서, 일단 placeholder로 시각만)
- [ ] 승인 클릭 → 도구 실행 → 결과가 채팅에 추가
- [ ] 거부 클릭 → AI가 다른 접근 시도하거나 사용자에게 질문
- [ ] [수정] 클릭 → 인자 편집 후 승인 가능
- [ ] diff가 +(성공색)/-(위험색) 색상 구분
- [ ] `pnpm typecheck`, `cargo check` 에러 0

## 확인 질문
- diff 뷰어 — `react-diff-viewer-continued` (활발히 유지) vs `diff2html` vs 자체. 명세 §A.3 권장은 첫번째.
- 매우 긴 diff (1000줄+) — 권한 카드에 일부만, 슬라이드 인 패널에 전체. 슬라이드 인은 작업 11에서.
- 거부 후 AI가 이유 모를 때 — 시스템 메시지에 자동 추가 ("사용자가 X 도구를 거부함, 다른 방법을 시도하거나 명확화 질문을 하세요")
- 타임아웃 — 명세 §5.5.2에 "타임아웃 없음" 명시. 그대로 갈지? 학교 환경에서 학생이 PC 앞 떠나면 어떻게?

## 작업 후
- DIVE_PROGRESS.md 2-4 `[x]`
- ADR: diff 뷰어 라이브러리, 긴 diff 처리, 거부 후 AI 가이드 메시지
