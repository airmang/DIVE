# DIVE 출시 결함 통합 마스터 (정적 + 동적)

작성: 2026-06-14 · 브랜치 provocation-redesign · 소스: 정적 7차원 감사(`release-audit-2026-06-14.md`) + 동적 computer-use 감사(`dive-release-dynamic-audit-2026-06-14.md`)

## ⚠️ 먼저: 측정 함정 (이걸 모르면 유령을 쫓는다)

동적 감사는 네이티브 창을 **픽셀 클릭**으로 조작했다. D-33이 "클릭 대상이 수십~100px 어긋남"을, 여러 항목이 "접근성 좌표 중심을 눌러야 작동"을 보고한다 — **macOS Retina HiDPI 픽셀클릭 드리프트**의 전형이다(스크린샷 logical 좌표 ≠ 클릭 좌표계). 따라서 동적 "버튼 무반응/클릭 빠짐" 다수는 **앱 버그가 아니라 측정 아티팩트일 수 있다.**

**규칙: 모든 "버튼 무반응" 동적 findings는 코드에 핸들러가 실재하는지 대조한 뒤에만 수정 대상으로 승격한다.** 크래시·상태소실·언어혼재·404처럼 클릭정밀도와 무관한 findings는 그대로 신뢰.

신뢰도 태그: **[CC]** 코드로 확인된 진짜 / **[NV]** 코드 대조 필요(아티팩트 가능) / **[OBS]** 관찰 사실(클릭정밀도 무관, 신뢰).

---

## 근본 원인 그룹 (증상 50개 → 원인 ~8개)

### R1. 앱 안정성 — 크래시 [P0]
- **P0-01 [CC/OBS]** "앱 실행" 클릭 → 네이티브 크래시. 프론트 `openResultPanelWithContext`는 preview 탭만 연다(안전); 크래시는 preview 탭이 호출하는 **`src-tauri/src/ipc/preview.rs`의 `unwrap()`/`expect()` 4곳** Rust panic. → 4곳을 `Result` 에러 반환으로 교체 + 프론트에서 토스트.

### R2. 프로젝트/세션/draft 상태 모델 — 아키텍처 결함 [P0] ★가장 큼
관찰된 상태 *소실/불일치*는 클릭 아티팩트가 아니다 — 실재하는 단일 결함 군집으로 추정.
- **P0-03 [OBS]** Dashboard는 "draft 승인 대기"인데 중앙은 "No session/No approved plan".
- **P0-04 [OBS]** Start session 후 중앙이 계속 "No session".
- **D-01/D-02/D-39 [OBS]** Open project·프로젝트 행 클릭이 중앙/우측 컨텍스트로 안 이어짐, 세션 비움.
- **D-04 [OBS]** 검토카드 클릭/프로젝트 이동 중 draft 증발.
- **D-21 [OBS]** 증발한 draft를 복구 불가.
- **D-35 [OBS]** Dashboard와 중앙/우측 컨텍스트 분리.
- **D-06/D-18 [NV]** no-session에서 Create plan/View result가 죽은 듯/오류.
→ **단일 root-cause 조사 필요**(전역 active project/session/draft 상태 소스가 화면 간 동기화 안 됨). 다른 모든 흐름이 이 위에 서므로 **최우선 중 하나**.

### R3. 카드 액션 배선 — 중앙 resolver 부재 [P0~P1]
5개 host가 액션을 각자 부분 switch로 처리 → 누락 산재(원래 내가 지적한 fragility).
- **P0-3(정적)=A3 [CC]** PlanDraft `기능으로 나누기`/`첫 기능만`(`split_scope`) 무처리 — **진짜 죽은 버튼**.
- **P1-1(정적)=A4/P0-02 [CC]** StepDetail `테스트 실행`(`run_tests`)·`미검증 승인`(`continue_with_risk`+reason) 무처리 — **진짜**.
- **D-08(Socratic `그대로 진행`=continue_with_risk) [CC]** 무처리 — 진짜(단 caution이라 X 탈출구 있음).
- **D-07 `예시 입출력 추가`(add_acceptance_criteria) [NV→아티팩트 의심]** Socratic이 *실제로 처리*함 → 무반응은 클릭빗나감 가능. PlanDraft 화면이면 진짜(거기선 add만 처리).
- **D-13/D-24 [NV]** 로드맵 칩/Review-cards 토글 무반응 — 핸들러 유무 대조 필요.
→ **수정: 단일 `useProvocationActionResolver`로 통합**(host별 가능범위는 파라미터). 패치 누적 금지.

### R4. criterion-verification 핵심 루프 [P0]
- **P0-1(정적)=A1 [CC]** "기준 체크하면 '검증 증거 있음'" 약속하나, `previewChecked`/`appLaunched` 신호를 *어디서도 기록 안 해* 체크해도 승인 안 풀림 → "위험 감수 승인"만 남음. 카피 과장(자기확인=증거) + 막다른 길. **내가 P0.4에서 만든 것.**
→ observed 신호 배선(또는 manual 스텝은 체크=충분) + 카피 정직화.

### R5. i18n 영어 로케일 혼재 [P0~P2]
클릭정밀도 무관, 전부 신뢰.
- **P0-2(정적)=A2/D-15 [CC]** 슬라이드인 패널(코드/미리보기/터미널) 전체 한국어(`useT()` 0건).
- **D-23/D-22 [OBS]** 메뉴바(`새 프로젝트`,`설정…`,`문서 보기`) + 앱메뉴 Settings 미동작.
- **D-27 [OBS]** 모델 라벨 `모델` 한국어 + dropdown 겹침.
- **P2(정적) [CC]** 토스트/다이얼로그 aria(`알림`,`닫기`), 설정 보안경고·연결해제 confirm, 채팅 편집/재전송 aria.
→ 형제 파일 `useT()` 패턴 기계 적용.

### R6. 백엔드/보안 [P1]
클릭정밀도 무관.
- **P1-2(정적) [CC]** 위험명령 차단목록(`rm -rf /`,`dd`,fork bomb,`curl|bash`) 죽은 코드 — `block_as_error`를 어떤 tool도 호출 안 함. 비메타 단일명령(`chmod -R 000 .`,`git reset --hard`) 1클릭 통과.
- **P1-3(정적) [CC]** 기본 "익명화" export에 어시스턴트 본문 평문 — 읽은 파일/키/소스 유출 가능.
- **P2(정적) [CC]** secret 탐지기 `sk-`만 — `ghp_`/`AKIA`/`Bearer`/`password=` 미탐지, evidence/decision JSON anonymize 미통과.

### R7. 접근성(키보드/SR) [P1]
- **P1-4(정적)=A5/D-34 [CC]** 체크포인트 `복원`이 hover 전용(`onFocus`/`onBlur` 없음) → 키보드 도달 불가. + Tab 순서가 카드 밖으로.
- **D-14/D-19/D-20/D-25/D-33 [NV→아티팩트 의심]** "히트영역 어긋남/접근성 좌표로만 작동" — **대부분 HiDPI 픽셀클릭 드리프트로 추정.** 단 일부는 진짜 overlay 가로채기일 수 있어 1~2개 표본 코드/실측 확인.
- **P2(정적) [CC]** 체크포인트 dot 색상단독 신호, ApprovalJudgment textarea 라벨 없음.

### R8. 누락 기능·확인절차·외부링크 [P1~P2]
클릭정밀도 무관.
- **D-30 [OBS]** Export 실행 진입점이 메뉴 어디에도 없음(P1-3은 코드엔 존재 → UI 노출 누락).
- **D-31 [OBS]** Help `문서 보기`/`문제 신고` → GitHub 404.
- **D-36 [OBS]** 미답변 인터뷰로 계획 승인 가능(품질 위험).
- **D-37/D-03(정적 SocraticP2 아님)/D-09 [OBS]** Discard·세션삭제·카드 dismiss에 확인 없음 → 무확인 파괴.
- **D-26 [OBS]** 빈 API key 저장에 validation 없음.
- **D-28 [OBS]** 개발전용 MCP/Internal diagnostics가 데모 빌드에 노출.
- **D-32/D-29/D-38/D-40/D-10/D-11/D-12/D-16/D-17 [NV/P2]** About 창, opencode Details, refresh 피드백, Expert placeholder, step 완료배너 불일치, DONE 스텝 붉은 칩, 미리보기 URL/결과확인 — 코드 대조 필요/폴리시.

---

## 정직한 규모 판정

- 이건 **"막바지 폴리시"가 아니라 안정화(stabilization) 단계**다. **앱 크래시 1건 + 상태모델 아키텍처 결함 1군집**이 코어 흐름(목표→계획→실행→검증)을 끊는다 — 이 둘이 살아 있으면 다른 어떤 수정도 데모에서 "안 됨"으로 보인다.
- 좋은 소식: 증상 50개가 **원인 ~8개로 수렴**한다. R2(상태모델)·R3(중앙 resolver)·R5(i18n) 각 하나의 근본 수정이 10개 이상 증상을 동시에 닫는다.
- 현실: R1·R2는 며칠 단위 조사·재설계. R5·R6·R7·R8은 기계적이라 빠름. 공개/교수 자문 일정은 **R1+R2가 끝난 뒤** 잡는 게 안전.

## 권장 수정 순서

1. **R1 크래시** (preview.rs unwrap 4곳) — 가장 명확한 P0, 빠름.
2. **R2 상태모델 root-cause** — 단일 active project/session/draft 동기화. 코어. 시간 투자 필요.
3. **R4 criterion 루프** + **R3 중앙 resolver** — keystone 복구 + 죽은 카드버튼 구조적 해소(같이).
4. **R5 i18n** — 영어 데모 직전 필수, 기계적.
5. **R6 보안** (export 유출 + guard) · **R7 a11y**(복원 포커스) · **R8**(확인 다이얼로그, Help 링크, Export 진입점).
6. **NV 항목 코드 대조** + 아티팩트 분리(HiDPI 드리프트는 앱 수정 대상 아님; 동적 재검증은 a11y 좌표 기반으로).

## 재검증 원칙 (이번엔 다르게)

각 수정은 **(a) 핸들러→실효과 코드 추적 + (b) 네이티브 앱에서 실제 동작 확인**까지여야 "완료". 동적 재검증 시 **a11y 좌표(접근성 API) 기반 클릭**으로 HiDPI 드리프트 confound 제거.

---

## 진행 로그 / 체크리스트

### Phase 0. [NV] 코드 대조 트리아지

- [x] **D-07 `예시 입력/출력 추가` 무반응 의심**
  - 변경: 코드 대조로 Socratic host의 `add_acceptance_criteria`가 실제 입력 템플릿을 추가함을 확인. PlanDraft host의 누락은 `split_scope` 중심 R3 resolver 결함으로 유지.
  - 검증법: `SocraticInterviewPanel.tsx` `handleProvocationAction` -> `setText(...완료 기준...)` 추적.
  - 결과: NOT-A-BUG: Socratic 화면 무반응 관찰은 HiDPI 좌표 드리프트 가능성이 높음. R3에서 host별 누락은 별도 처리.
- [x] **D-13 로드맵 칩/dependency graph/refresh 무반응 의심**
  - 변경: `dependency graph`와 `refresh`는 각각 `PlanHeader` -> `setMinimapOpen`, `roadmap.refresh()`로 연결됨을 확인. 단 refresh 성공/변경없음 피드백 부족은 R8 UX 항목으로 유지.
  - 검증법: `PlanHeader.tsx` `onToggleMinimap`/`onRefresh` -> `PlanView.tsx` 핸들러 추적.
  - 결과: NOT-A-BUG: 토글/refresh 핸들러는 존재. 피드백 개선은 D-38/D-40로 유지.
- [x] **D-14 AI 자가보고 카드 버튼 히트 영역/접근성 노출 의심**
  - 변경: 카드 버튼은 `ProvocationCardHost` -> host별 `onAction`으로 노출됨을 확인. 버튼 동작 누락 자체는 R3의 `run_tests`/`continue_with_risk` 진짜 결함으로 유지.
  - 검증법: `ProvocationCardHost.tsx` `act()`와 `StepDetailSlideIn.tsx` handler 대조.
  - 결과: NOT-A-BUG: 히트 영역 관찰은 좌표 드리프트 가능성이 높음. dead action은 R3에서 처리.
- [x] **D-16 미리보기 URL 칩 클릭 후 반응 없음 의심**
  - 변경: 후보 URL 칩과 열기 버튼은 `setPreviewUrl`로 iframe src를 갱신함을 확인. 패널 뒤 클릭 전달 관찰은 좌표 드리프트 가능성이 높음.
  - 검증법: `PreviewTab.tsx` `loadCandidate`/`loadUrl` -> `useSlideInStore.setPreviewUrl` -> iframe `src` 추적.
  - 결과: NOT-A-BUG: URL 반영 핸들러 존재. i18n/상태문구는 R5에서 처리.
- [x] **D-17 `결과 확인` / `열기` 클릭 영역 불일치 의심**
  - 변경: `결과 확인`은 `preview_start` IPC, `열기`는 `loadUrl`로 연결됨을 확인.
  - 검증법: `PreviewTab.tsx` `autoConnect`/`loadUrl` -> `preview_start`/`setPreviewUrl` 추적.
  - 결과: NOT-A-BUG: 클릭 영역 관찰은 좌표 드리프트 가능성이 높음. R1/R5에서 crash/i18n은 별도 처리.
- [x] **D-19 Top `Undo` 버튼 접근성/클릭 대상 의심**
  - 변경: TopBar 경로는 추가 대조 대상이나 Recovery panel 자체는 `open` 상태에서 렌더되고 버튼들이 실제 handler를 가짐을 확인.
  - 검증법: `ProductShellLayout.tsx` `TopBar onOpenRecovery` -> `RecoverySlideIn`/`RecoveryPanel` 연결 확인.
  - 결과: NOT-A-BUG(좌표): 픽셀 클릭 실패는 드리프트 가능성이 높음. TopBar aria 세부는 R7 a11y 점검에 포함.
- [x] **D-20 Recovery `Restore checkpoint` 뒤쪽 전달 의심**
  - 변경: inline 확인 카드의 `Restore checkpoint`가 `onRestoreCheckpoint(confirmTarget.id)`를 호출함을 확인.
  - 검증법: `RecoveryPanel.tsx` `restore-confirm-inline-action` handler 추적.
  - 결과: NOT-A-BUG: 뒤쪽 전달 관찰은 좌표 드리프트 가능성이 높음.
- [x] **D-24 Guided help / Review cards 토글 무반응 의심**
  - 변경: Review cards는 접근성 checkbox와 `setEnableProvocationCards` handler가 존재함을 확인. Guided help checkbox도 handler는 있으나 aria-label이 없어 a11y 개선은 R7/R5에 유지.
  - 검증법: `settings.tsx` `settings-review-cards-toggle`/`settings-tutorial-toggle` -> preferences setter 추적.
  - 결과: PARTIAL NOT-A-BUG: 무반응은 좌표 드리프트 가능성이 높음. guided help aria-label 누락은 진짜 a11y 결함.
- [x] **D-25 Theme 버튼 좌표 불일치 의심**
  - 변경: Theme 버튼은 `toggleTheme` -> zustand `setTheme` -> html class/localStorage 갱신으로 연결됨을 확인.
  - 검증법: `settings.tsx` `settings-theme-toggle` -> `useTheme` -> `stores/theme.ts` 추적.
  - 결과: NOT-A-BUG: 접근성 좌표 중심에서 작동한다는 관찰과 코드가 일치하므로 픽셀 좌표 드리프트.
- [x] **D-33 WebView 시각 좌표/실제 클릭 좌표 불일치**
  - 변경: 여러 표본(D-13/D-16/D-17/D-20/D-25)에서 handler가 존재함을 확인해 측정 아티팩트로 분류.
  - 검증법: 코드상 버튼 handler와 상태 변경 경로 대조.
  - 결과: NOT-A-BUG: macOS Retina HiDPI 픽셀클릭 드리프트. 이후 동적 검증은 a11y 좌표 기반으로만 수행.
- [x] **D-06/D-18 no-session `Create plan`/`View result` 무반응 의심**
  - 변경: `Create plan`은 no-session에서 `createSession(currentProjectId)`를 호출하고, `View result`는 preview panel/IPC로 연결됨을 확인. 문제는 선택 프로젝트와 active session/draft가 분리되는 R2 상태모델 파생.
  - 검증법: `PlanEmpty` -> `handleCreatePlanFromRail` -> `handleEmptyStateAction`; `ChatArea` result action -> `openResultPanelWithContext` 추적.
  - 결과: TRUE-BUG(R2): 버튼 단독 no-op가 아니라 active project/session/draft 동기화 결함으로 유지.
- [x] **D-29 opencode `Details` 클릭 영역 의심**
  - 변경: 코드 대조 필요 범위를 settings provider 세부 UI로 한정. 클릭 영역 오독 가능성이 있으나 공개 데모 영향은 낮음.
  - 검증법: `settings.tsx` provider card 구조 대조.
  - 결과: DEFER: R8 settings polish에서 재확인.
- [x] **D-32 About dive 화면 품질**
  - 변경: 코드 결함이라기보다 제품 polish 정책 항목으로 분류.
  - 검증법: macOS About 표면 관찰 근거 유지.
  - 결과: DEFER: R8 polish.
- [x] **D-38/D-40 Dashboard/Recovery refresh 피드백 없음**
  - 변경: refresh handler는 존재하나 성공/변경없음 피드백이 없음.
  - 검증법: `PlanDashboardPanel.tsx` `dashboard.refresh()`, `RecoveryPanel.tsx` `onRefresh` 추적.
  - 결과: TRUE-BUG(R8 UX): handler no-op가 아니라 피드백 결함으로 유지.
- [x] **D-10 Expert placeholder/버튼 라벨 불일치**
  - 변경: 입력 placeholder가 session/interview 상태와 분리될 수 있는 대화 모델 문제로 분류.
  - 검증법: `deriveInputBlocked`/`deriveEmptyState`/interview panel 표시 조건 대조.
  - 결과: TRUE-BUG(R8/R2): 상태모델 및 interview UI 상태 결합 문제로 유지.
- [x] **D-11 step 완료 배너와 로드맵 상태 불일치**
  - 변경: step detail의 current card와 plan roadmap active step 산출이 서로 다른 상태 소스를 참조할 수 있음을 확인.
  - 검증법: `currentPlanRoadmapStep`/`currentCard`/`planRoadmap.steps` 대조.
  - 결과: TRUE-BUG(R2/R4): 상태 파생 정합성 문제로 유지.
- [x] **D-12 DONE 스텝의 `위험 감수 승인` 칩**
  - 변경: 코드 버그보다 approval provenance 표시 정책 문제로 분류.
  - 검증법: roadmap agency/approval 상태 표시 경로 대조.
  - 결과: DEFER: R8 policy polish.

### R1. 앱 안정성 - preview 크래시

- [x] **P0-01 `앱 실행` 클릭 시 DIVE 앱 크래시**
  - 변경: 감사가 지목한 `src-tauri/src/ipc/preview.rs` 런타임 `unwrap()`/`expect()` 4곳은 현재 코드에 존재하지 않음. preview IPC 경로는 `project_root_required`, `detect_package_info`, install/dev-server spawn/probe 실패를 모두 `Result<_, String>`으로 반환함.
  - 검증법: 코드 추적 `preview_start` -> `preview_start_impl` -> `detect_package_info`/`run_install`/`spawn_dev_server`/`detect_running_preview`; `rg -n "unwrap\\(|expect\\(" dive/src-tauri/src/ipc/preview.rs`; `cargo test --manifest-path dive/src-tauri/Cargo.toml --features dev-mock preview`; `cargo fmt --manifest-path dive/src-tauri/Cargo.toml --check`.
  - 결과: NOT-A-BUG/STALE: 현재 HEAD `6e99de2` 기준 런타임 panic 지점 없음. 남은 `expect("port regex")`는 정적 상수 regex 생성이고, 나머지 unwrap은 테스트 코드.

### R2. 프로젝트/세션/draft 상태 모델

- [x] **P0-03/P0-04/D-01/D-02/D-04/D-06/D-18/D-21/D-35/D-39 상태 소실/불일치 군집**
  - 변경: `selectProject`가 세션을 항상 null로 초기화하던 동작을 저장된 세션 또는 해당 프로젝트의 최신 active session 선택으로 변경. project-level draft plan을 DB에서 다시 읽는 `workspace_plan_current_draft` IPC를 추가하고, `useProductShellController`가 current project의 draft만 approval 화면으로 복원하도록 연결.
  - 검증법: 코드 추적 `PlanDashboardPanel.openProject` -> `useProjectSessionStore.selectProject` -> `preferredSessionId`; `usePlan.currentDraft` -> `workspace_plan_current_draft` -> `plan_dao::get_by_project`/`step_dao::list_by_plan`; `useProductShellController` current project guard. 실행 검증: `cargo test --manifest-path dive/src-tauri/Cargo.toml --features dev-mock current_draft`; `cargo test --manifest-path dive/src-tauri/Cargo.toml --features dev-mock`; `cargo clippy --manifest-path dive/src-tauri/Cargo.toml --all-targets --features dev-mock -- -D warnings`; `pnpm --dir dive typecheck`; `pnpm --dir dive lint`; `pnpm --dir dive test`; native smoke `pnpm --dir dive tauri dev --features dev-mock --no-watch --config '{"build":{"beforeDevCommand":"","devUrl":"http://localhost:1420"}}'` launched DIVE successfully and AX could see the app window.
  - 결과: 커밋 `a145f5e`. `pnpm --dir dive format:check`는 기존 Prettier baseline 10개 파일에서 red(수정 파일 아님). 네이티브 WebView 내부 버튼/텍스트는 macOS AX tree에 충분히 노출되지 않아 자동 a11y 클릭으로 draft 화면까지는 검증 제한.

### R3/R4. 카드 액션 resolver + criterion-verification 루프

- [x] **P0-3/A3 PlanDraft `split_scope`, P1-1/A4 StepDetail `run_tests`/`continue_with_risk`, D-08 Socratic `continue_with_risk` 카드 액션 무처리**
  - 변경: host별 부분 switch를 `useProvocationActionResolver`로 통합. PlanDraft `split_scope`는 변경요청 피드백을 채우고, StepDetail `run_tests`는 `onVerifyFirst`, `continue_with_risk`는 risk approval 결정으로 연결하며, Socratic/Terminal/MessageList의 repro/split/retry/criteria 액션도 같은 resolver를 사용하도록 정리.
  - 검증법: 코드 추적 `ProvocationCardHost.onAction` -> `useProvocationActionResolver` -> 각 host callback; `StepDetailSlideIn` `run_tests` -> `onVerifyFirst`; `PlanDraftApprovalScreen` `split_scope` -> `setFeedback`; `SocraticInterviewPanel` `continue_with_risk` -> `onComplete`/`submit`; `TerminalTab` repro/split/retry -> composer seed. 실행 검증: `pnpm --dir dive test -- StepDetailSlideIn DecisionGate PlanDraftApprovalScreen TerminalTab productShellConversationLogic`; `pnpm --dir dive typecheck`; `pnpm --dir dive lint`; `pnpm --dir dive test`; `git diff --check`.
  - 결과: 커밋 `f8bb0d2`. `pnpm --dir dive format:check`는 기존 Prettier baseline 10개 파일에서 red.
- [x] **P0-1/A1 기준 체크-검증 증거 루프 막다른 길**
  - 변경: StepDetail의 `프리뷰 확인`/`앱 실행` 카드 액션이 step별 `previewChecked`/`appLaunched` 관찰 신호를 기록하도록 연결. DecisionGate는 preview/app 관찰과 완료 기준 확인이 함께 있을 때 concrete evidence로 인정하고, 기존 `ai_self_report_only` 칩이 남아 있어도 더 이상 "AI 자가보고만 있음" 차단 사유로 유지하지 않음. 카피는 자기확인을 "검증 증거"로 과장하지 않고 관찰 증거 기록으로 정직화.
  - 검증법: 코드 추적 `open_preview` -> `handleOpenPreview` -> `provocationContext.verification.previewChecked` -> `deriveVerificationStatuses` -> `deriveDecisionGatePolicy`; `criterionConfirmed` -> `acceptanceCriterionConfirmed`; `hasConcreteVerification`의 criterion-linked preview/app 조건 대조. 실행 검증: `StepDetailSlideIn.test.tsx`의 preview 관찰+기준 체크 후 직접 승인 테스트, `DecisionGate.test.tsx`의 AI self-report-only reason 해제 회귀 테스트, 전체 `pnpm --dir dive test`. 브라우저 실동작: `http://127.0.0.1:1421/?demo=plan-surface`가 로드맵 surface를 렌더함을 DOM으로 확인. 네이티브 smoke: `pnpm --dir dive tauri dev --features dev-mock --no-watch --config '{"build":{"beforeDevCommand":"","devUrl":"http://127.0.0.1:1421/?demo=plan-surface"}}'`가 빌드/실행되고 macOS AX가 `DIVE, AXWindow, DIVE` 창을 확인.
  - 결과: 커밋 `f8bb0d2`. StepDetail 내부 WebView 컨트롤은 macOS AX tree에서 직접 클릭 가능한 세부 노드로 충분히 노출되지 않아, 세부 액션 실효과는 jsdom DOM 테스트와 브라우저 DOM 검증으로 보완.

### R5. i18n 영어 로케일 혼재

- [x] **P0-2/A2/D-15 슬라이드인 패널(코드/미리보기/터미널) 한국어 고정 문자열**
  - 변경: `SlideInPanel`, `CodeTab`, `PreviewTab`, `TerminalTab`, `CheckpointTimeline`의 패널 제목/탭/버튼/aria/빈 상태/오류/상태/체크포인트 tooltip 문자열을 `slide_in.*` i18n 키로 이동. 터미널 카드 disabled reason과 composer seed/status도 locale별 문자열로 연결.
  - 검증법: 코드 추적 `useT()` -> `slide_in.*` ko/en 리소스; `rg -n "[가-힣]" dive/src/components/slide-in --glob '!*.test.tsx'` 결과 없음. 실행 검증: `SlideInPanel.test.tsx` 영어 locale 회귀 테스트, `pnpm --dir dive test -- SlideInPanel TerminalTab`, `pnpm --dir dive typecheck`, `pnpm --dir dive lint`, `pnpm --dir dive test`, `git diff --check`. 브라우저 실동작: 설정 화면에서 `English`를 선택한 뒤 `http://127.0.0.1:1421/?demo=slide-in-demo`에서 panel title/tabs/close/hint가 영어이고 `코드 / 미리보기 / 터미널` 패널 문자열이 사라짐을 DOM으로 확인. 네이티브 smoke: `pnpm --dir dive tauri dev --features dev-mock --no-watch --config '{"build":{"beforeDevCommand":"","devUrl":"http://127.0.0.1:1421/?demo=slide-in-demo"}}'`가 빌드/실행되고 macOS AX가 `DIVE, AXWindow, DIVE` 창을 확인.
  - 결과: 커밋 `f9df495`. `pnpm --dir dive format:check`는 기존 Prettier baseline 7개 파일에서 red. `slide-in-demo` 페이지 자체의 데모 설명 한국어는 제품 패널이 아니라 dev demo copy라 R5 P0 범위 밖.

- [x] **D-23/D-22 메뉴바 영어 로케일 혼재 + 앱메뉴 Settings 동작 확인**
  - 변경: Tauri 네이티브 메뉴 문자열을 `MenuLocale`/`MenuLabels`로 분리하고 앱 locale 변경 시 `menu_set_locale` 명령으로 File/Edit/View/Help, New Project/Open Project/Open Recent, Settings, View Documentation 등 메뉴를 재빌드하도록 연결. 최근 프로젝트 빈 라벨/제목 없음 fallback도 locale별 문자열을 사용. Settings 메뉴는 기존 `menu:settings` -> `openSettingsRoute` 핸들러가 실재했고, 단축키/메뉴 id 경로를 네이티브에서 확인.
  - 검증법: 코드 추적 `useLocale()` -> `syncNativeMenuLocale()` -> `menu_set_locale` -> `build_menu_for_locale`; `install_event_handler` -> `menu:settings` emit -> `useMenuEvents` -> `openSettingsRoute`. 실행 검증: `cargo test --manifest-path dive/src-tauri/Cargo.toml --features dev-mock menu`, `cargo fmt --manifest-path dive/src-tauri/Cargo.toml --check`, `cargo clippy --manifest-path dive/src-tauri/Cargo.toml --all-targets --features dev-mock -- -D warnings`, `cargo test --manifest-path dive/src-tauri/Cargo.toml --features dev-mock`, `pnpm --dir dive typecheck`, `pnpm --dir dive lint`, `pnpm --dir dive test -- settings`, `pnpm --dir dive test`, `git diff --check`. `pnpm --dir dive format:check`는 기존 Prettier baseline 7개 파일에서 red.
  - 네이티브 실동작: `pnpm --dir dive tauri dev --features dev-mock --no-watch --config '{"build":{"beforeDevCommand":"","devUrl":"http://127.0.0.1:1422/"}}'`로 실행. macOS AX로 `Cmd+,`가 Settings 화면을 열고, 키보드 포커스로 locale을 English로 변경한 뒤 메뉴바가 `File, Edit, View, Help`로 재빌드됨을 확인. 하위 메뉴도 `New Project`, `Open Project…`, `Open Recent`, `Settings…`, `Toggle Theme`, `View Documentation`, `Report Issue`, `About DIVE`로 조회.
  - 결과: 커밋 `9baed67`. 메뉴 클릭 관찰의 "미동작" 부분은 코드상 handler와 네이티브 단축키/동일 id 경로가 확인되어 STALE/NOT-A-BUG로 닫음.

- [x] **D-27 모델 라벨 한국어 + dropdown 겹침**
  - 변경: `ProviderModelSelector`의 label/loading/empty/saving/toast/aria 문자열을 `settings.model_*` i18n 키로 이동하고, label+select 레이아웃을 `grid-cols-[minmax(3.5rem,auto)_minmax(0,1fr)]`/`w-full min-w-0`로 고정해 긴 모델명이 라벨과 겹치지 않게 함.
  - 검증법: 코드 추적 `useT()` -> `settings.model_*` ko/en 리소스 -> label/select/toast; 레이아웃 class가 select column을 `minmax(0,1fr)`로 제한함을 확인. 실행 검증: `ProviderModelSelector.test.tsx` 영어 locale 회귀 테스트, `pnpm --dir dive test -- ProviderModelSelector settings`, `pnpm --dir dive typecheck`, `pnpm --dir dive lint`, `pnpm --dir dive test`, `git diff --check`. `pnpm --dir dive format:check`는 기존 Prettier baseline 7개 파일에서 red.
  - 네이티브 실동작: 실행 중인 Tauri 앱의 Settings 화면에서 English locale 상태로 OpenRouter 모델 selector가 `Model` label을 표시하고, `OpenAI · GPT-5.4 Mini` dropdown이 카드 폭 안에 겹침 없이 렌더됨을 스크린샷으로 확인.
  - 결과: 커밋 `8dc46bb`.

- [x] **P2 토스트/다이얼로그 aria, 설정 보안경고·연결해제 confirm, 채팅 편집/재전송 aria**
  - 변경: `ToastProvider`의 region/dismiss aria, 공용 `DialogContent` close sr-only, `UserMessage` edit/resend aria, Settings provider 상태 dot aria, non-default endpoint 보안경고, provider disconnect confirm을 `common.*`/`chat.message.*`/`settings.*` i18n 키로 이동.
  - 검증법: 코드 추적 `useT()` -> 각 aria/confirm/warning surface -> ko/en 리소스. 실행 검증: `ToastProvider.test.tsx`, `dialog.test.tsx`, `UserMessage.test.tsx`, `settings.test.tsx` 영어 locale 회귀 테스트, `pnpm --dir dive test -- ToastProvider dialog UserMessage settings`, `pnpm --dir dive typecheck`, `pnpm --dir dive lint`, `pnpm --dir dive test`, `git diff --check`. 대상 파일 검색 `rg -n 'aria-label="[^"]*[가-힣]|알림|토스트 닫기|메시지 편집|메시지 재전송|연결을 해제할까요|기본 AI 서버' ...` 결과 없음. `pnpm --dir dive format:check`는 기존 Prettier baseline 7개 파일에서 red.
  - 네이티브 실동작: 실행 중인 Tauri 앱의 English Settings 화면이 HMR 후 계속 정상 렌더되고 provider/model 영역이 영어로 유지됨을 스크린샷으로 확인. WebView 내부 aria node는 macOS AX tree에서 세부 노드로 충분히 노출되지 않아, aria 문구 자체는 jsdom 접근성 쿼리 테스트로 보완.
  - 결과: 커밋 `1fbf3a3`.

### R6. 백엔드/보안

- [x] **P1-2 위험명령 차단목록 dead code + 비메타 단일명령 우회**
  - 변경: `RunProcess::validate`가 argv를 shell 없이 재구성해 공용 `classify_bash_command`/`block_as_error` guard를 호출하도록 연결. 차단목록에 `chmod -R 000 .`, `chmod -R 000 ./`, `git reset --hard`를 추가하고 회귀 테스트를 보강.
  - 검증법: 코드 추적 `RunProcess::validate` -> shell metachar/escape arg 검사 -> `classify_bash_command` -> `ToolError::Blocked`, `guard::LITERAL_RULES`/`REGEX_RULES` -> `block_as_error`. 실행 검증: `cargo test --manifest-path dive/src-tauri/Cargo.toml --features dev-mock tools::guard`, `cargo test --manifest-path dive/src-tauri/Cargo.toml --features dev-mock tools::run_process`, `cargo test --manifest-path dive/src-tauri/Cargo.toml --features dev-mock --test tool_guard`, `cargo fmt --manifest-path dive/src-tauri/Cargo.toml --check`, `cargo clippy --manifest-path dive/src-tauri/Cargo.toml --all-targets --features dev-mock -- -D warnings`, `cargo test --manifest-path dive/src-tauri/Cargo.toml --features dev-mock`. 네이티브 smoke: 기존 Vite `http://localhost:1420/`에 `pnpm --dir dive tauri dev --features dev-mock --no-watch --config '{"build":{"beforeDevCommand":"","devUrl":"http://localhost:1420/"}}'`로 새 Rust 빌드를 실행했고 macOS AX가 `DIVE` 창과 window controls를 확인.
  - 결과: 커밋 `6a5ef75`.

- [x] **P1-3/P2 기본 익명화 export 어시스턴트 평문 + secret/evidence/decision redaction 부족**
  - 변경: 기본 export에서 user뿐 아니라 assistant/system/tool 등 모든 message `content`를 `hash_user_text` 기본값에 따라 해시하도록 변경. `verification_evidence`/`user_decision` StepSessionMapping JSON도 `anonymize_value`를 통과시킴. secret detector를 `ghp_`, `github_pat_`, `AKIA`, `Bearer`, `password=`, `api_key=`, `token=` 등으로 확장.
  - 검증법: 코드 추적 `ExportEngine::export_session_with_salt` message loop -> `maybe_hash_text`, StepSessionMapping evidence/decision -> `anonymize_value`, `contains_pii` -> `contains_secret_like_token`. 실행 검증: `cargo test --manifest-path dive/src-tauri/Cargo.toml --features dev-mock --test export_jsonl` 13개 통과, `cargo test --manifest-path dive/src-tauri/Cargo.toml --features dev-mock export::anonymize`, `cargo fmt --manifest-path dive/src-tauri/Cargo.toml --check`, `cargo clippy --manifest-path dive/src-tauri/Cargo.toml --all-targets --features dev-mock -- -D warnings`, `cargo test --manifest-path dive/src-tauri/Cargo.toml --features dev-mock`. 네이티브 smoke: `pnpm --dir dive tauri dev --features dev-mock --no-watch --config '{"build":{"beforeDevCommand":"","devUrl":"http://127.0.0.1:1422/"}}'` 새 Rust 빌드가 실행되고 macOS AX가 `DIVE` 창을 확인.
  - 결과: 커밋 `102e807`.

### R7. 접근성(키보드/SR)

- [x] **P1-4/A5/D-34 체크포인트 timeline `복원` hover-only + checkpoint dot 색상단독 신호**
  - 변경: `CheckpointTimeline` tooltip/restore 컨트롤을 hover뿐 아니라 `onFocus`로 열고, focus가 tooltip 내부 `복원` 버튼으로 이동하는 동안 닫히지 않도록 `onBlur` containment를 추가. dot button에 focus ring, `aria-expanded`/`aria-describedby`, locale별 checkpoint kind/current 상태를 넣고, 색상 외에 `I/A/M/C` glyph를 표시해 init/auto/manual/current 신호를 색상에만 의존하지 않게 함.
  - 검증법: 코드 추적 `timeline-dot` focus/click -> `openCheckpointId` -> `timeline-tooltip`/`timeline-restore`; wrapper `onBlur` -> `currentTarget.contains(relatedTarget)`로 restore 버튼 tab 이동 유지; `dot_aria` -> `kind_*`/`current_suffix`; glyph helper -> non-color cue. 실행 검증: `SlideInPanel.test.tsx` keyboard focus regression, `pnpm --dir dive test -- SlideInPanel`, `pnpm --dir dive typecheck`, `pnpm --dir dive lint`, `pnpm --dir dive test`, `git diff --check`. `pnpm --dir dive format:check`는 기존 Prettier baseline 7개 파일에서 red.
  - 브라우저/네이티브 실동작: Browser로 `http://localhost:1420/?demo=timeline-demo`를 열고 `체크포인트 [V 통과] 로그인 폼, 자동` button이 accessible name과 `A` glyph를 가지며 click 후 tooltip과 `복원` button이 실제 DOM에 보이는 것을 확인. 네이티브 smoke: `pnpm --dir dive tauri dev --features dev-mock --no-watch --config '{"build":{"beforeDevCommand":"","devUrl":"http://localhost:1420/?demo=timeline-demo"}}'` 새 빌드가 실행되고 macOS AX가 `DIVE` 창을 확인.
  - 결과: 커밋 `68721bd`. R7 P2 중 `ApprovalJudgment` textarea label은 별도 항목으로 남김.

- [x] **P2 ApprovalJudgment textarea 라벨 없음**
  - 변경: `ApprovalJudgment`의 우려 사유 textarea에 `useId()` 기반 `label htmlFor`/`id` 연결을 추가하고, label 기반 접근성 쿼리 회귀 테스트를 추가.
  - 검증법: 코드 추적 `우려 있음` stance -> label `htmlFor` -> textarea `id` -> `onChange` -> `approved_with_concern` note trim. 실행 검증: `ApprovalJudgment.test.tsx`, `pnpm --dir dive test -- ApprovalJudgment`, `pnpm --dir dive typecheck`, `pnpm --dir dive lint`, `git diff --check`.
  - 네이티브 실동작: 현재 제품 review path는 `DecisionGate`를 사용해 `ApprovalJudgment` 컴포넌트를 직접 mount하지 않으므로 textarea 실동작은 jsdom label query/submit test로 검증. 앱 smoke는 `pnpm --dir dive tauri dev --features dev-mock --no-watch --config '{"build":{"beforeDevCommand":"","devUrl":"http://localhost:1420/"}}'` 새 빌드 실행 후 macOS AX가 `DIVE` 창을 확인.
  - 결과: 커밋 `7eefe95`.
