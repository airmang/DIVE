# DIVE 네이티브 데스크톱 앱 출시 전 동적 검증 리포트

검증일: 2026-06-14  
검증 방식: 실행 중인 Tauri 데스크톱 앱 `DIVE`를 화면에서 직접 조작. 소스 코드는 보지 않음.  
검증 목적: 공개 데모/교수 자문 전, 죽은 버튼, 막다른 흐름, 상태 불일치, 시각 깨짐, 언어 혼재를 찾고 수정 체크리스트로 전환.

## 출시 차단 P0 체크리스트

- [ ] **P0-01. `앱 실행` 클릭 시 DIVE 앱 크래시를 제거한다.**
  - 화면/위치: 검증 단계의 `AI의 완료 보고만 있습니다` 카드
  - 행동: `앱 실행` 버튼 클릭
  - 기대: 앱/프리뷰 실행 또는 실행 실패 메시지 표시
  - 실제: macOS 다이얼로그 `DIVE 응용 프로그램이 예기치 않게 종료되었습니다.`
  - 증거: `/tmp/dive_A4_app_run.png`

- [ ] **P0-02. AI 자가보고 카드의 검증/승인 버튼을 실제 검증 흐름으로 연결한다.**
  - 화면/위치: `AI의 완료 보고만 있습니다` 카드
  - 행동: `테스트 실행`, `프리뷰 확인`, `미검증 상태로 승인` 클릭
  - 기대: 테스트/프리뷰 실행, 또는 미검증 승인 이유 입력 후 `이유 남기고 진행`으로 승인 상태 전환
  - 실제: 일부 클릭은 입력창에 제안 프롬프트만 삽입. 일부 상태에서는 버튼이 카드 그룹으로만 잡혀 무반응. 이유 입력 후 진행 버튼 접근도 불안정.
  - 증거: `/tmp/dive_cont10_preview_check_clicked_again.png`, `/tmp/dive_cont10_test_run_clicked_again.png`, `/tmp/dive_resume_unverified_direct_click.png`, `/tmp/dive_cont10_unverified_reason_entered.png`

- [ ] **P0-03. 계획 draft/session 상태 소실과 Dashboard/중앙 화면 불일치를 고친다.**
  - 화면/위치: Dashboard, 프로젝트 카드, 중앙 작업 영역
  - 행동: 계획 생성/승인 흐름 중 Dashboard 또는 프로젝트 카드를 오가며 `Open project` 클릭
  - 기대: draft가 유지되고 중앙 화면에서 승인 가능
  - 실제: Dashboard는 `Draft / Plan draft is waiting for approval`이라고 표시하지만 중앙은 `No session / No approved plan` 상태. `Open project`는 눈에 보이는 변화 없음.
  - 증거: `/tmp/dive_cont8_plan_card_none_selected.png`, `/tmp/dive_cont9_dashboard_project2_open_clicked.png`

- [ ] **P0-04. 새 세션 시작 후 중앙 화면이 실제 세션 상태를 반영하게 한다.**
  - 화면/위치: 새 프로젝트/새 세션 시작 화면
  - 행동: `Start session` 클릭
  - 기대: 목표 입력/대화 세션 화면으로 전환
  - 실제: 세션은 만들어진 듯하지만 중앙이 `Start a session to begin chatting` 또는 `No session` 상태에 머무는 경우 반복.
  - 증거: `/tmp/dive_start_session_clicked.png`, `/tmp/dive_cont6_start_session_after_guided.png`, `/tmp/dive_cont7_project2_start_session_clicked.png`

## 알려진 결함 A 재현 결과

- [ ] **A1. 완료 기준 수동 체크 후 `승인` 활성화 여부를 안정적으로 재검증한다.**
  - 결과: 지정된 완료 기준 체크박스 화면을 안정적으로 재현하지 못함.
  - 차단 원인: 계획 draft가 사라지거나 세션 상태가 깨져 승인/실행/검증 화면까지 재진입이 불안정.
  - 관련 증거: `/tmp/dive_step1_open_again_for_a1.png`, `/tmp/dive_cont7_plan_approve_precise_clicked.png`

- [ ] **A2. English 설정 후 슬라이드인 패널의 한국어 잔존을 제거한다.**
  - 결과: 재현됨.
  - 화면/위치: `Code & preview` 슬라이드인 패널
  - 행동: Settings에서 Language를 English로 둔 뒤 `Code & preview` 열기
  - 기대: 탭/헤더/버튼/오류/빈 상태가 영어
  - 실제: `코드 / 미리보기 / 터미널`, `결과 확인`, `터미널 - 0줄`, `지우기`, `출력이 없습니다` 등 한국어 잔존.
  - 증거: `/tmp/dive_resume_code_preview_three_clicks.png`, `/tmp/dive_resume_terminal_tab.png`, `/tmp/dive_english_code_preview_panel.png`

- [ ] **A3. 과도한 범위 카드의 `기능으로 나누기` / `첫 기능만 요청하기` 버튼을 실제 동작에 연결한다.**
  - 결과: 직접 재현 미완료.
  - 차단 원인: 큰 요청 입력 후 계획 승인 화면/범위 과다 카드에 안정적으로 도달하지 못함. draft 소실과 세션 상태 불일치가 먼저 발생.
  - 관련 증거: `/tmp/dive_cont8_plan_card_none_selected.png`

- [ ] **A4. AI 자가보고 카드의 `테스트 실행`과 `미검증 상태로 승인` 흐름을 고친다.**
  - 결과: 재현됨.
  - 행동: `테스트 실행`, `프리뷰 확인`, `미검증 상태로 승인`, 이유 입력 후 진행 시도
  - 기대: 테스트/프리뷰 실행 또는 이유 기록 후 승인 상태 전환
  - 실제: 테스트/프리뷰 실행 대신 입력창에 프롬프트 삽입. 이유 입력 후 진행 버튼 접근이 불안정. 어떤 상태에서는 버튼 클릭 자체가 카드 그룹으로만 잡힘.
  - 증거: `/tmp/dive_A4_test_run_clicked.png`, `/tmp/dive_A4_unverified_approve_clicked.png`, `/tmp/dive_cont10_unverified_approve_clicked_again.png`, `/tmp/dive_cont10_unverified_reason_scrolled_down.png`

- [ ] **A5. 복구/체크포인트 타임라인에서 Tab만으로 `복원`에 도달하고 실행되게 한다.**
  - 결과: 재현됨.
  - 행동: Recovery/Undo 패널에서 마우스 없이 Tab 반복
  - 기대: 체크포인트 항목과 `복원` 버튼에 순서대로 포커스 이동, 키보드 실행 가능
  - 실제: 포커스가 패널 내부 복원 버튼으로 안정적으로 들어가지 않고 상단/다른 영역으로 빠짐.
  - 증거: `/tmp/dive_recovery_tab_1.png`

## 신규 결함 D 체크리스트

### 프로젝트/세션/계획 흐름

- [ ] **D-01. 프로젝트 카드 `Open project`를 실제 프로젝트/세션 전환에 연결한다.**
  - 심각도: P1
  - 행동: Dashboard의 draft 프로젝트 카드에서 `Open project` 클릭
  - 기대: 해당 프로젝트의 draft/세션이 중앙에 열림
  - 실제: 아무 변화 없음.
  - 증거: `/tmp/dive_cont9_dashboard_project2_open_clicked.png`

- [ ] **D-02. 프로젝트 행 클릭 시 선택 상태와 중앙 컨텍스트를 일치시킨다.**
  - 심각도: P1
  - 행동: `project5 / .../qa-sandbox/...` 행 클릭
  - 기대: project5 선택, 상단/중앙/우측 컨텍스트 전환
  - 실제: 접근성상 project5 버튼이 클릭됐지만 화면은 계속 `DIVE TEST`.
  - 증거: `/tmp/dive_continue2_project5_selected_precise.png`

- [ ] **D-03. 세션 삭제 아이콘에 확인 다이얼로그를 추가한다.**
  - 심각도: P1
  - 행동: QA/project2 세션 휴지통 클릭
  - 기대: 삭제 확인 또는 취소 가능
  - 실제: 확인 없이 즉시 삭제됨.
  - 증거: `/tmp/dive_cont5_qa_session_delete_clicked.png`, `/tmp/dive_cont9_project2_session_delete_clicked.png`

- [ ] **D-04. 계획 draft가 검토 카드 클릭/프로젝트 이동 중 사라지지 않게 한다.**
  - 심각도: P0/P1
  - 행동: 계획 draft 화면에서 review card 옵션 또는 프로젝트 카드 이동
  - 기대: draft 유지 및 승인 가능
  - 실제: draft가 사라지고 중앙이 인터뷰/No session 상태로 돌아감.
  - 증거: `/tmp/dive_cont8_plan_card_none_selected.png`

- [ ] **D-05. AI 인터뷰 답변과 생성 계획의 목표 드리프트를 줄인다.**
  - 심각도: P1
  - 행동: vague landing page/style 답변 후 계획 생성
  - 기대: 입력 목표와 일치하는 계획
  - 실제: `English/Korean word quiz web app`처럼 다른 도메인의 계획 생성.
  - 증거: `/tmp/dive_cont8_finish_after_more_answers.png`

- [ ] **D-06. `Create plan` 버튼이 no-session 상태에서 죽은 버튼처럼 보이지 않게 한다.**
  - 심각도: P1
  - 행동: 우측 Project plan 영역의 `Create plan` 클릭
  - 기대: 계획 생성 또는 세션 필요 안내
  - 실제: 눈에 보이는 변화 없음.
  - 증거: `/tmp/dive_cont7_create_plan_right_clicked.png`

- [ ] **D-36. 미답변 인터뷰 질문이 남아 있는 상태에서 계획 승인 draft가 생성되는 흐름을 막거나 명확히 표시한다.**
  - 심각도: P1
  - 행동: 목표 인터뷰 질문을 끝까지 답하지 않은 상태에서 계획 생성/마무리 진행
  - 기대: 남은 질문에 답하도록 유도하거나, 미답변 상태로 만든 계획임을 명확히 표시하고 승인 위험을 낮춤
  - 실제: 미답변 질문이 남아 있는데도 draft가 생성되고 승인 버튼이 보임. 경고는 있지만 사용자는 바로 승인할 수 있어 계획 품질/의도 불일치 위험이 큼.
  - 증거: `/tmp/dive_cont7_finish_without_answer_after_wait.png`

- [ ] **D-37. 계획 승인 화면의 `Discard`에 확인 절차를 추가한다.**
  - 심각도: P1
  - 행동: 계획 승인 화면에서 `Discard` 클릭
  - 기대: 계획 폐기 확인 다이얼로그 또는 Undo 가능한 명확한 상태 전환
  - 실제: 확인 없이 draft가 즉시 사라짐.
  - 증거: `/tmp/dive_cont7_plan_approve_physical_clicked.png`

### 목표 인터뷰/검토 카드

- [ ] **D-07. 완료 기준 카드의 `예시 입력/출력 추가` 버튼을 실제 입력 보강 동작에 연결한다.**
  - 심각도: P1
  - 행동: 모호한 목표 `화면을 예쁘게 개선해줘` 입력 후 카드의 `예시 입력/출력 추가` 클릭
  - 기대: 예시 입력/출력 템플릿 추가 또는 인터뷰 질문 변화
  - 실제: 눈에 보이는 변화 없음.
  - 증거: `/tmp/dive_completion_card_add_io.png`

- [ ] **D-08. 완료 기준 카드의 `그대로 진행` 버튼 동작을 명확히 한다.**
  - 심각도: P1
  - 행동: 같은 카드에서 `그대로 진행` 클릭
  - 기대: 다음 단계 진행 또는 카드 dismiss
  - 실제: 눈에 보이는 변화 없음.
  - 증거: `/tmp/dive_completion_card_continue.png`

- [ ] **D-09. 완료 기준 카드의 체크 아이콘 dismiss가 입력/상태를 예기치 않게 지우지 않게 한다.**
  - 심각도: P1
  - 행동: 카드 체크 아이콘 클릭
  - 기대: 카드만 dismiss 또는 의도 설명
  - 실제: 카드/입력 상태가 사라짐.
  - 증거: `/tmp/dive_completion_card_check_icon.png`

- [ ] **D-10. Expert 모드에서 질문 상태와 입력 placeholder/버튼 라벨을 일치시킨다.**
  - 심각도: P1
  - 행동: Expert 모드 질문 답변 중 하단 입력 확인
  - 기대: 답변 중이면 답변 제출 UI
  - 실제: placeholder/button이 `I want to build...` / `Start`로 돌아왔지만 클릭하면 질문 답변처럼 처리됨.
  - 증거: `/tmp/dive_cont8_expert_second_answer_enter.png`, `/tmp/dive_cont8_expert_second_answer_start_clicked.png`

### 스텝 상세/검증/로드맵

- [ ] **D-11. step_1 상세의 완료 배너와 실제 로드맵 상태를 일치시킨다.**
  - 심각도: P1
  - 행동: DIVE TEST에서 step_1 `OPEN` 클릭
  - 기대: step_1 상세와 전체 02/05 진행 상태가 일관되게 표시
  - 실제: 상단은 `All steps complete`처럼 보였지만 로드맵은 `02/05 done`, step_3 진행 중.
  - 증거: `/tmp/dive_cont10_dive_test_step1_open_clicked.png`

- [ ] **D-12. DONE 스텝의 `위험 감수 승인` 칩 문구/상태를 재검토한다.**
  - 심각도: P2
  - 행동: DIVE TEST 로드맵 확인
  - 기대: 완료 상태와 승인 근거가 명확히 분리
  - 실제: 완료된 step_1/step_2 옆에 붉은 `위험 감수 승인`이 계속 표시되어 데모 관객에게 위험 상태처럼 보임.
  - 증거: `/tmp/dive_resume_current.png`

- [ ] **D-13. `계획 검토 필요`, `LOCKED`, dependency graph, refresh 컨트롤에 명확한 반응을 제공한다.**
  - 심각도: P2
  - 행동: 우측 로드맵 칩/버튼/refresh 클릭
  - 기대: 설명, 그래프 표시, 비활성 사유, 새로고침 피드백
  - 실제: 눈에 보이는 변화 없음.
  - 증거: `/tmp/dive_resume_plan_review_chip_clicked.png`, `/tmp/dive_resume_dependency_graph_clicked_current.png`, `/tmp/dive_resume_plan_refresh_clicked_current.png`

- [ ] **D-14. AI 자가보고 카드 버튼의 히트 영역/접근성 버튼 노출을 고친다.**
  - 심각도: P1
  - 행동: `미검증 상태로 승인`, `프리뷰 확인` 클릭 및 접근성 직접 버튼 클릭 시도
  - 기대: 버튼 단위로 클릭/키보드/보조기술 접근 가능
  - 실제: 카드 그룹으로만 잡히거나 최상위 button 이름으로 가져올 수 없음.
  - 증거: `/tmp/dive_resume_unverified_double_precise.png`, `/tmp/dive_resume_unverified_direct_click.png`

### 슬라이드인 코드/미리보기/터미널

- [ ] **D-15. 슬라이드인 패널의 한국어 잔존을 전부 i18n 처리한다.**
  - 심각도: P1
  - 행동: English 설정 후 `Code & preview` 열기
  - 기대: 영어 UI
  - 실제: 헤더/설명/탭/버튼/빈 상태 다수 한국어.
  - 증거: `/tmp/dive_resume_code_preview_three_clicks.png`, `/tmp/dive_resume_preview_tab_accessibility_center.png`

- [ ] **D-16. 미리보기 URL 칩 클릭 후 렌더링/오류 상태를 명확히 표시한다.**
  - 심각도: P1
  - 행동: 미리보기 탭에서 `http://127.0.0.1:5173` 칩 클릭
  - 기대: URL 입력 반영, 로딩/성공/실패 표시
  - 실제: 눈에 띄는 렌더링 변화 없음. 일부 클릭은 패널 뒤쪽 Project plan으로 전달되어 패널이 닫힘.
  - 증거: `/tmp/dive_resume_preview_127_access_center.png`

- [ ] **D-17. `결과 확인` / `열기` 버튼의 실제 클릭 영역을 시각 위치와 일치시킨다.**
  - 심각도: P1
  - 행동: 미리보기 패널 버튼 클릭
  - 기대: 결과 확인 또는 외부 열기 동작
  - 실제: 메뉴바/뒤쪽 영역으로 클릭이 빠지거나 눈에 보이는 효과 없음.
  - 증거: `/tmp/dive_cont9_result_open_clicked.png`, `/tmp/dive_resume_result_check_clicked.png`

- [ ] **D-18. no-session 상태에서 `View result` 오류를 프로젝트 선택 상태와 일치시킨다.**
  - 심각도: P1
  - 행동: Dashboard/no-session 상태에서 `View result`와 `결과 확인` 클릭
  - 기대: 선택 프로젝트 기준 프리뷰 또는 명확한 안내
  - 실제: `package.json이 있는 웹 프로젝트를 선택하세요.` 오류. 프로젝트 카드 선택 상태와 불일치.
  - 증거: `/tmp/dive_cont9_view_result_no_session_dashboard.png`, `/tmp/dive_cont9_result_check_clicked_no_session.png`

### 복구/Undo/롤백

- [ ] **D-19. Top `Undo` 버튼의 접근성 이름/클릭 대상 노출을 고친다.**
  - 심각도: P1
  - 행동: 상단 `Undo` 시각 버튼 클릭 및 `button "Undo"` 직접 접근 시도
  - 기대: Recovery/Undo 패널 열림
  - 실제: 시각 클릭이 메뉴바로 잡히거나 접근성 버튼으로 찾을 수 없음.
  - 증거: `/tmp/dive_resume_undo_panel_open.png`, `/tmp/dive_resume_undo_direct_open.png`

- [ ] **D-20. Recovery 패널의 `Restore checkpoint` 클릭이 뒤쪽 화면으로 전달되지 않게 한다.**
  - 심각도: P1
  - 행동: 체크포인트 복원 확인 카드에서 `Restore checkpoint` 클릭
  - 기대: 복원 실행 또는 확인 상태 변화
  - 실제: 패널이 닫히거나 뒤쪽 Project plan으로 클릭이 전달된 것처럼 보임.
  - 증거: `/tmp/dive_cont9_restore_checkpoint_clicked.png`

- [ ] **D-21. draft 손실 상태도 복구/체크포인트로 회복 가능하게 한다.**
  - 심각도: P1
  - 행동: draft가 사라진 뒤 Undo/Recovery 열기
  - 기대: 최근 draft 또는 작업 상태 복원 가능
  - 실제: 체크포인트 없음 또는 잃어버린 draft 회복 불가.
  - 증거: `/tmp/dive_cont8_undo_after_plan_disappeared_2.png`

### 설정/언어/연결

- [ ] **D-22. 앱 메뉴 `Settings…`와 View 메뉴 `설정…`의 동작을 통일한다.**
  - 심각도: P1
  - 행동: DIVE 메뉴 `Settings…`, View 메뉴 `설정…` 각각 클릭
  - 기대: 둘 다 Settings 진입
  - 실제: View 메뉴는 진입. DIVE 메뉴는 눈에 보이는 전환 없음.
  - 증거: `/tmp/dive_continue2_settings_menu_open.png`, `/tmp/dive_continue2_settings_view_menu.png`

- [ ] **D-23. English 설정 시 메뉴바와 Settings 내부 한국어를 제거한다.**
  - 심각도: P1/P2
  - 행동: English 설정 후 메뉴/설정 확인
  - 기대: File/View/Help/Settings 모두 영어
  - 실제: `새 프로젝트`, `프로젝트 열기…`, `설정…`, `문서 보기`, `모델`, `개발 전용 MCP 서버`, `Mock (개발 전용)` 등 혼재.
  - 증거: `/tmp/dive_continue2_settings_view_menu.png`, `/tmp/dive_continue2_settings_page_down.png`, `/tmp/dive_cont6_file_menu.png`

- [ ] **D-24. Guided help / Review cards 체크 UI를 실제 토글과 접근성 checkbox로 구현한다.**
  - 심각도: P1
  - 행동: 체크 아이콘 클릭 및 checkbox 접근성 조회
  - 기대: 체크 상태 변경, 키보드/보조기술 조작 가능
  - 실제: 화면상 상태 변화 없음. checkbox로 노출되지 않음.
  - 증거: `/tmp/dive_continue2_review_cards_off.png`

- [ ] **D-25. Theme 버튼의 시각 위치와 실제 클릭 대상 좌표를 맞춘다.**
  - 심각도: P2
  - 행동: `Switch to dark` 시각 위치 클릭, 접근성 좌표 클릭
  - 기대: 보이는 버튼 위치를 누르면 전환
  - 실제: 보이는 위치 클릭은 무반응처럼 보였고 접근성 좌표 중심을 눌러야 전환됨.
  - 증거: `/tmp/dive_continue2_settings_switch_dark.png`, `/tmp/dive_continue2_settings_dark_actual_center.png`

- [ ] **D-26. 빈 API key 저장 시 명확한 validation 메시지를 표시한다.**
  - 심각도: P1
  - 행동: Anthropic `Connect` 후 빈 `Save and connect`
  - 기대: API key 필요 오류, 필드 강조, 또는 버튼 비활성
  - 실제: 아무 오류/상태 변화 없음.
  - 증거: `/tmp/dive_continue2_anthropic_empty_save.png`

- [ ] **D-27. OpenRouter/Codex 모델 라벨 i18n과 dropdown overlay를 정리한다.**
  - 심각도: P2
  - 행동: 모델 dropdown 확인
  - 기대: English 라벨과 레이아웃 유지
  - 실제: `모델` 한국어 잔존, dropdown이 연결 카드 위에 겹쳐 보임.
  - 증거: `/tmp/dive_cont6_openrouter_model_dropdown.png`, `/tmp/dive_continue2_settings_page_down.png`

- [ ] **D-28. 내부/개발자용 설정을 공개 데모 빌드에서 숨기거나 명확히 격리한다.**
  - 심각도: P2
  - 행동: Settings 하단 Advanced 확인
  - 기대: 일반 사용자에게 필요한 설정만 노출
  - 실제: `개발 전용 MCP 서버`, `Internal diagnostics` 노출.
  - 증거: `/tmp/dive_continue2_settings_page_down.png`, `/tmp/dive_continue2_dev_mcp_open.png`

- [ ] **D-29. opencode `Details` 링크 클릭 영역을 명확히 한다.**
  - 심각도: P2
  - 행동: `Details` 텍스트 근처 클릭
  - 기대: 상세 설명 열림
  - 실제: 근처 `Connect` 폼이 열림. Details 자체 효과 확인 어려움.
  - 증거: `/tmp/dive_continue2_opencode_details_clicked.png`

### Help/About/외부 링크/Export

- [ ] **D-30. Export 기능을 File/View/Help 또는 명확한 앱 표면에 추가한다.**
  - 심각도: P1
  - 행동: File/View/Help/DIVE 메뉴 전수 확인
  - 기대: Export 실행 경로 존재
  - 실제: Export 항목 없음.
  - 증거: 메뉴 접근성 출력, `/tmp/dive_continue2_about_dive_menu.png`

- [ ] **D-31. Help > 문서 보기 / 문제 신고 링크가 404로 열리지 않게 한다.**
  - 심각도: P1
  - 행동: Help 메뉴 `문서 보기`, `문제 신고` 클릭
  - 기대: 문서/이슈 페이지 열림
  - 실제: Safari GitHub 404.
  - 증거: `/tmp/dive_cont6_help_docs_clicked_again.png`, `/tmp/dive_cont6_help_report_after_wait.png`

- [ ] **D-32. `About dive` 화면을 제품 앱답게 정리한다.**
  - 심각도: P2
  - 행동: DIVE 메뉴 `About dive` 클릭
  - 기대: 앱 아이콘/버전/제품 정보가 자연스러운 About 창
  - 실제: 폴더 아이콘 중심의 작은 어두운 창. 버전은 보이나 앱 정체성이 약함.
  - 증거: `/tmp/dive_continue2_about_dive_menu.png`

### 시각/접근성/히트 영역

- [ ] **D-33. Electron/Tauri WebView의 시각 좌표와 실제 클릭/접근성 좌표 불일치를 점검한다.**
  - 심각도: P1
  - 행동: 여러 버튼/탭/칩을 시각 위치 기준 클릭
  - 기대: 보이는 버튼이 그 위치에서 작동
  - 실제: `Code & preview`, 미리보기 탭, Settings theme, Undo, 로드맵 칩 등에서 실제 클릭 대상이 수십~100px 어긋나는 사례가 반복.
  - 증거: `/tmp/dive_resume_code_preview_clicked.png`, `/tmp/dive_resume_preview_tab_precise.png`, `/tmp/dive_continue2_settings_switch_dark.png`, `/tmp/dive_resume_undo_panel_open.png`

- [ ] **D-34. 키보드 Tab 순서를 카드/패널 내부 작업 흐름에 맞게 재정렬한다.**
  - 심각도: P1
  - 행동: 검증 카드와 Recovery 패널에서 Tab 반복
  - 기대: 현재 작업 카드의 주요 버튼으로 이동
  - 실제: 좌측 Workspace 탭이나 패널 밖으로 이동. 카드 내부 버튼 접근 어려움.
  - 증거: `/tmp/dive_resume_tab_card_3.png`, `/tmp/dive_recovery_tab_1.png`

- [ ] **D-35. Dashboard 탭과 중앙/우측 컨텍스트 분리를 해소한다.**
  - 심각도: P1
  - 행동: 좌측 Dashboard 클릭
  - 기대: 전체 앱이 Dashboard 컨텍스트로 전환
  - 실제: 좌측은 Dashboard지만 중앙/우측은 기존 프로젝트/세션 맥락 유지.
  - 증거: `/tmp/dive_cont9_dashboard_clicked.png`

- [ ] **D-38. Dashboard refresh 클릭에 로딩/갱신 결과 피드백을 제공한다.**
  - 심각도: P2
  - 행동: Dashboard의 refresh 아이콘 클릭
  - 기대: 목록 갱신, 로딩 표시, 마지막 갱신 시간, 또는 변경 없음 안내
  - 실제: 눈에 보이는 변화 없음.
  - 증거: `/tmp/dive_cont9_dashboard_refresh_clicked.png`

- [ ] **D-39. 프로젝트 행 클릭으로 세션 컨텍스트가 비는 상태를 막는다.**
  - 심각도: P1
  - 행동: QA 프로젝트/프로젝트 행을 클릭해 전환 시도
  - 기대: 해당 프로젝트의 세션 또는 시작 화면으로 일관되게 전환
  - 실제: 선택한 프로젝트/세션 맥락이 깨지고 중앙이 `No session / Get started`류 상태로 돌아가는 경우가 있음.
  - 증거: `/tmp/dive_cont7_qa_project_right_edge_clicked.png`

- [ ] **D-40. Recovery 패널 refresh 클릭에 패널 유지와 갱신 피드백을 보장한다.**
  - 심각도: P2
  - 행동: Recovery/Undo 패널에서 refresh 클릭
  - 기대: 체크포인트 목록 갱신 또는 변경 없음 안내. 패널은 유지.
  - 실제: 패널이 닫히거나 눈에 보이는 피드백이 없음.
  - 증거: `/tmp/dive_cont8_recovery_refresh_clicked.png`

## 우선 수정 순서 제안

1. P0-01 앱 실행 크래시.
2. P0-02/A4 AI 자가보고 카드의 검증/승인 버튼 동작.
3. P0-03/P0-04 프로젝트, 세션, draft 상태 모델 불일치.
4. D-36/D-37 미완성 인터뷰 계획 승인과 무확인 폐기.
5. D-33/D-34 클릭 히트 영역과 키보드 접근성. 이 문제가 남으면 다른 수정도 사용자에게 죽은 버튼처럼 보일 수 있음.
6. A2/D-15/D-23 언어 혼재. 공개 데모에서 신뢰도를 크게 깎음.
7. D-19/D-20/A5/D-40 Recovery/Undo 복구 흐름.
8. D-26/D-27/D-28 Settings 검증/개발 표면 정리.
9. D-30/D-31 Export/Help 링크 마무리.

## 재검증 체크리스트

- [ ] English 설정 후 메뉴바, Settings, 슬라이드인 패널, 오류/빈 상태가 모두 영어인지 확인.
- [ ] 새 QA 프로젝트 생성 → 새 세션 → 모호한 목표 → 검토 카드 → 계획 생성 → 승인 → 실행 → 검증 화면까지 한 번에 끊기지 않는지 확인.
- [ ] AI 자가보고 카드에서 `테스트 실행`, `프리뷰 확인`, `미검증 상태로 승인`이 각각 다른 눈에 보이는 결과를 만드는지 확인.
- [ ] 수동 완료 기준 체크 후 `승인` 버튼이 약속대로 활성화되는지 확인.
- [ ] Recovery/Undo 패널에서 마우스 없이 Tab/Enter만으로 체크포인트 복원 확인 다이얼로그까지 도달하는지 확인.
- [ ] Export를 실행하고 로컬 파일/결과 경로/성공 메시지가 보이는지 확인.
- [ ] Help 링크가 404가 아닌 실제 문서/이슈 페이지로 열리는지 확인.
- [ ] 다크/라이트 양쪽에서 Settings, 슬라이드인 패널, 검토 카드, 로드맵, Dashboard 레이아웃이 겹치거나 잘리지 않는지 확인.
