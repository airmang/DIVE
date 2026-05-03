# 작업 11: 슬라이드 인 패널 (코드/미리보기/터미널 탭)

## 컨텍스트
명세 §5.4의 핵심. 채팅 우상단 [코드/미리보기] 또는 워크맵 완료 카드 클릭 시 우측에서 슬라이드 인. 3개 탭 — 코드(diff), 미리보기(iframe), 터미널(누적 출력).

## 이번 작업 범위
- 슬라이드 인 패널 (280ms 트랜지션)
- 3개 탭 — 코드, 미리보기, 터미널
- 코드 탭 — 변경 파일 목록 + diff (읽기 전용)
- 미리보기 탭 — iframe (웹) / placeholder (그 외)
- 터미널 탭 — 누적 출력 (읽기 전용)
- 닫기 — [✕] 버튼 + ESC

## 명세 참조
- DIVE_SPEC.md §5.4 — 슬라이드 인 패널 전체
- DIVE_SPEC.md §5.6 — 슬라이드 인 패널 (참조)
- 와이어프레임 — `images/04_slide_in_panel.png`, `images/05_preview_tab.png`

## 단계

1. `src/components/slide-in/SlideInPanel.tsx` — 우측 280ms 슬라이드 인, 폭 ~600px, z-index로 채팅 좁히는 형태
2. `src/components/slide-in/Tabs.tsx` — 3개 탭 (코드/미리보기/터미널), 활성 탭 표시
3. `src/components/slide-in/CodeTab.tsx`:
   - 컨텍스트 헤더 ("카드: 로컬 저장 기능" 등)
   - 변경 파일 탭 바 (해당 카드의 changed_files 또는 세션의 모든 변경)
   - 선택 파일의 diff 본문 (작업 10의 DiffViewer 재사용)
   - 읽기 전용
4. `src/components/slide-in/PreviewTab.tsx`:
   - 프로젝트 루트의 `index.html` 존재 시 iframe 임베드 (`http://localhost:PORT/index.html` 로컬 정적 서버)
   - Python: 마지막 실행 결과 stdout/stderr (placeholder, 작업 16+ 에서)
   - Roblox: 외부 Studio 연결 안내 텍스트
   - 그 외: README 또는 빈 상태
   - 자동 새로고침 토글 (기본 ON), 수동 새로고침, 새 창 열기
5. `src/components/slide-in/TerminalTab.tsx` — bash 도구 누적 출력 (작업 16에서 bash 도구 추가 시 채워짐), 읽기 전용
6. 정적 서버 — Tauri 백엔드에서 프로젝트 폴더를 `localhost:PORT`로 서빙 (`tauri-plugin-fs` 또는 자체 axum 서버)
7. 호출 진입점:
   - 채팅 우상단 [코드/미리보기] 토글 — 마지막 활성 탭 기억
   - 워크맵 완료 카드 클릭 → 코드 탭 + 해당 카드 changed_files 자동 필터
   - 권한 카드 [전체 보기 ↓] → 코드 탭 + 해당 파일 자동 선택
8. 닫기 — [✕] 버튼, ESC, 토글 버튼 재클릭

## 완료 조건
- [ ] [코드/미리보기] 버튼 클릭 시 280ms 슬라이드 인
- [ ] 3개 탭 전환 동작
- [ ] 코드 탭 — write_file/edit_file 후 diff가 표시됨
- [ ] 미리보기 탭 — `index.html` 있는 프로젝트에서 iframe 정상 렌더, 파일 변경 시 자동 새로고침
- [ ] 터미널 탭 — placeholder 메시지 (bash 도구 활성화 후 채워짐)
- [ ] ESC로 닫힘
- [ ] 워크맵 완료 카드 클릭 → 코드 탭으로 자동 열림
- [ ] `pnpm typecheck`, `cargo check` 통과

## 확인 질문
- iframe 보안 — `sandbox` 속성 어떻게? 학생 코드가 부모 창 접근 못하도록 격리 필요. 추천: `sandbox="allow-scripts allow-forms"` (allow-same-origin은 위험)
- 정적 서버 포트 — 고정 (예: 3939) vs 동적 할당. 동적 추천 (충돌 회피)
- 자동 새로고침 디바운스 — 빠른 연속 변경 시 매번 새로고침은 부하. 500ms 디바운스 추천
- 미리보기 캐시 — iframe URL에 `?v=timestamp` 쿼리 추가로 캐시 무효화

## 작업 후
- DIVE_PROGRESS.md 2-5 `[x]`
- ADR: iframe 격리 정책, 정적 서버 구성, 새로고침 디바운스
