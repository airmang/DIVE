# DIVE 단일 프로젝트 플랜 뷰 재설계 — design spec

- date: 2026-06-05 · status: **🔒 LOCKED (v2 timeline 확정)** · 범위: 프론트엔드(UI/UX) only
- 근거 진단: 이 세션의 `/frontend-ui-engineering` 진단 (DAG·계획 관리 UI)
- **확정 비주얼(정전)**: `docs/superpowers/specs/mockups/2026-06-05-plan-view-mockup-v2.html` — timeline 척추 + 트윈레일 병렬 + 블루프린트 미니맵. 병렬은 `…-parallel-options.html` A/B/C/D 비교 후 **A(트윈 레일)** 채택.
- 결정(사용자 확정): ① **타임라인 척추(vertical timeline spine)를 1차 surface로** ② 통합 범위 = **단일 프로젝트 플랜만** ③ 그래프는 **경량 블루프린트 미니맵**으로 강등(Mermaid 제거) ④ 병렬 = **트윈 레일 그룹**(동급 스테이지 — 들여쓰기/노드 축소 금지)

## 0. 한 줄 요약

같은 플랜을 그래프(Mermaid)·수평 카드 캐러셀·리스트로 **3중 표현**하던 것을, **하나의 수직 타임라인 척추(spine)**로 통합한다. 각 단계는 척추 위의 노드 + 본문(제목·상태·의존성·액션)으로 표현되고, 진행도는 척추를 따라 차오른다(별도 거대 progress bar 없음). 병렬 단계는 **트윈 레일 그룹**으로 묶되 다른 단계와 동급이다. 전체 의존성 그래프가 필요할 때만 접이식 **경량 블루프린트 미니맵**을 펼친다. Mermaid·카드·왼쪽 색바는 제거한다.

## 1. 목적 & 사용자

- **목적**: 학생이 "지금 어디까지 됐고, 다음에 뭘 하면 되는지"를 한 화면에서 스캔으로 파악하게 한다. 플랜 = 본질적으로 순차/위계 구조이므로 수직 타임라인 척추가 1차.
- **사용자**: 교실 미성년 학습자(파일럿) + 일반 사용자. → 큰 히트 타깃, 키보드/스크린리더 접근성, 낮은 인지부하, 한국어 1차.
- **비목표**: 백엔드/IPC/플랜 생성 로직 변경 아님. 데이터 소스는 현행 유지, **표현 계층만** 재설계.

## 2. 범위

**In**
- `RoadmapDAG`(Mermaid 그래프), `RoadmapRail`/`RoadmapPanel`의 step 표현, `WorkmapCardList`(수평 카드 캐러셀)를 **하나의 수직 플랜 뷰**로 통합.
- 경량 접이식 미니맵 신규(Mermaid 대체).
- 디자인 토큰/타이포/a11y/i18n 정합.

**Out (이번 범위 아님)**
- `PlanDashboardPanel`(여러 프로젝트 포트폴리오 대시보드) — 레벨이 다름, 차후.
- 플랜 생성/승인 플로우(`PlanDraftApprovalScreen` 등) 로직.
- Rust/IPC, step 상태 머신, 검증 엔진.

## 3. 현행 문제 (진단 요약)

| 심각도 | 위치 | 문제 |
|---|---|---|
| 🔴 | `roadmap/RoadmapDAG.tsx:83-135`, `product/MermaidDiagram.tsx:113` | Mermaid 문자열→SVG `dangerouslySetInnerHTML`→DOM ID 역파싱(`RoadmapDAG.tsx:178`). 버전 취약·전체 재렌더 플래시·라벨 전각 치환(`:56`). |
| 🔴 | `RoadmapDAG.tsx:129-133` | classDef 하드코딩 hex — `tailwind.config.ts`의 "src/ raw hex 금지" 우회, 토큰 불일치. |
| 🔴 | `RoadmapDAG.tsx:258` | 그래프를 `max-h-56` 224px 스크롤 감옥에. 줌/팬/fit 없음. |
| 🔴 | 3개 컴포넌트 | 같은 플랜을 그래프·수평 캐러셀·리스트로 중복 → 단일 멘탈 모델 불가. |
| 🔴 | `workmap/WorkmapCardList.tsx:98` | 순서 있는 플랜에 수평 캐러셀(내용 숨김·스캔성 저하·세로스크롤 충돌). |
| 🟠 | `MermaidDiagram.tsx:74` | 모든 노드 `cursor:pointer`인데 ready/in_progress만 동작. SVG 키보드 내비 0. |
| 🟠 | `PlanDashboardPanel.tsx:303-395` 등 | `text-[10px]`/`text-[11px]` off-scale, 4종 폰트 적층, 회색 단독 위계. |
| 🟠 | `WorkmapCardList.tsx:77,148,164` | 한국어 하드코딩(i18n 우회). |

## 4. 핵심 결정 (재론 금지)

1. **타임라인 척추(vertical timeline spine)가 1차 surface.** 그래프는 보조.
2. **Mermaid 완전 제거.** 미니맵은 경량 블루프린트 자체 구현(아래 §11). **카드 컨테이너·왼쪽 색바·라운드 칩 금지**(AI-룩 제거).
3. **표현만 재설계.** 데이터 소스(`usePlanRoadmap` 등)·상태 enum·IPC 불변.
4. **디자인 토큰만 사용.** raw hex 금지(미니맵 SVG 포함, `currentColor`/토큰 클래스로).

## 5. 정보 구조 (타임라인 척추)

```
┌─ Plan view (타임라인 척추, 1차) ───────────────────┐
│ [헤더] eyebrow "PROJECT PLAN" · 프로젝트명          │
│        목표 한 줄                │ 카운터 02/07 mono │
│        세그먼트 진행바(척추와 같은 언어: done/now)  │
│        [의존성 그래프 보기 ▸] (기본 접힘)           │
├───────────────────────────────────────────────────┤
│ 척추(좌 54px): 노드 ○ + 연결선이 진행에 따라 차오름 │
│   (done=실선 / active=그라데 / future=점선)         │
│ │ ○done   S-002 · Done            [Open]           │
│ │ ◉now    S-003 · In Progress     [Resume] ← 강조  │
│ │ ○ready  S-004 · Ready           [Start]          │
│ ╎╎트윈레일: Parallel·동시 실행      [Run both ×2]   │
│ ╎╎○ready  S-005 · Ready · 병렬     [Start]   ← 동급 │
│ ╎╎○ready  S-006 · Ready · 병렬     [Start]   ← 동급 │
│ │ ○blk    S-007 · Blocked ⊘ S-005·S-006 [Locked]   │
└───────────────────────────────────────────────────┘
   [그래프 펼침] → 블루프린트 미니맵(§11), 같은 노드 언어 공유, 노드 클릭=해당 step으로
```

- **노드 언어(26px 동일 크기, 병렬도 동일)**: done=채움 ✓ / in_progress=accent 링 펄스 / ready=accent 링+점 / blocked=점선 회색 자물쇠.
- **상태 2중 인코딩**: 노드 모양·색 + mono 대문자 태그(Done/In&nbsp;Progress/Ready/Blocked). 색 단독 금지.
- **현재 단계 강조**: accent 본문 wash + accent 노드 펄스 + 주 CTA(Resume) accent 채움.
- **병렬(트윈 레일)**: 인접 step을 두 개의 점선 accent 레일로 묶고, 그룹 헤더에 "Parallel·동시 실행 · Run both ×N". **각 병렬 step은 일반 step과 완전 동급**(같은 척추 정렬·26px 노드·풀 메타/액션 + `병렬` 태그). 들여쓰기·노드 축소·서브그리드 **금지**.
- **순서**: `position`/의존 위상정렬. 현재 진행 step 자동 스크롤·강조.
- **밀도/위계**: 제목 `text-fg`, 보조만 `text-fg-muted`(회색 일변도 금지). 워크맵 카드/세션 디테일은 step 확장 시 하위로(§9 가정, P1 확인).

## 6. 컴포넌트 분해

신규 디렉터리 `dive/src/components/plan/` (colocate):
- `PlanView.tsx` — 컨테이너. 데이터(`usePlanRoadmap`)·상태 분기(loading/empty/error)·미니맵 토글.
- `PlanHeader.tsx` — eyebrow·프로젝트명·목표·mono 카운터·세그먼트 진행바·미니맵 토글.
- `PlanTimeline.tsx` — 척추 컨테이너(`.tl`). step·병렬그룹 스택.
- `PlanStep.tsx` — 1 step = 척추셀(연결선 + 26px 노드) + 본문(메타/제목/요약/의존성/액션). ≤200줄, 단일 책임.
- `PlanStepNode.tsx` — 상태별 노드(done/now/ready/blocked) 단일 출처. **미니맵과 노드 언어 공유**.
- `PlanParallelGroup.tsx` — 트윈 레일 그룹(헤더 + 동급 step 2+). 들여쓰기/축소 금지.
- `PlanStepActions.tsx` — 상태별 1차 액션(시작/이어하기/열기/그룹시작).
- `PlanMiniMap.tsx` — §11 블루프린트 미니맵(접이식, 기본 접힘).
- `plan-status-meta.ts` — `PlanRoadmapStatus`→{label,icon,nodeClass,lineToken} 토큰 매핑 단일 출처(`RoadmapPanel.tsx:14` STATUS_CLASS 패턴 계승).
- `index.ts`, `types.ts`.

**제거/대체 대상**: `roadmap/RoadmapDAG.tsx`, `product/MermaidDiagram.tsx`(다른 사용처 없으면), `workmap/WorkmapCardList.tsx`의 캐러셀 역할. `RoadmapRail`은 새 `PlanView`를 품도록 교체. mermaid 의존성 `package.json`에서 제거(다른 사용처 grep 확인 후).

## 7. 상태(states) — 전부 명시 (빈 화면 금지)

- **loading**: 스켈레톤(행 3개 pulse). 현행 `RoadmapDAG`처럼 `null` 반환 금지.
- **empty(플랜 없음)**: 아이콘+제목+안내+CTA("플랜 만들기"로 연결). i18n.
- **error**: 토큰 색 인라인 에러 + 재시도. 영어 하드코딩("Loading diagram…") 금지.
- **blocked step**: 죽은 클릭 금지 — 비활성 + 막은 의존성 명시("S-001 완료 후 가능").
- **부분 실패(그룹 시작)**: 현행 `RoadmapActionFailurePanel` 패턴 유지(토큰 색).

## 8. 인터랙션 & 키보드

- 행 전체가 하나의 `<button>`/`role` 또는 행 내 명시적 액션 버튼. **모든 인터랙티브 요소 Tab 도달 + Enter/Space 동작.**
- 상태별 1차 액션: ready→시작, in_progress(세션 有)→이어하기, done/shipped→열기, blocked→비활성.
- 미니맵 노드 클릭/Enter → 해당 행으로 스크롤 + 포커스 이동(SVG 노드도 `tabindex`/`role="button"`+`aria-label`).
- 포커스 링: 기존 `focus-visible:ring-ring ring-offset` 패턴 준수.

## 9. 데이터 소스 & 모델 (⚠️ 가정 — 확정 필요)

- 1차 소스: `usePlanRoadmap`의 `PlanRoadmapStep`(status: blocked/ready/in_progress/done/shipped, `step.step_id`/`title`/`dependencies`, `blockedDependencies`, `parallelBucket`, `mapping.session_id`). fallback roadmap(`ProductShellController["roadmap"]`)도 현행대로 지원.
- **가정 A (확인 요망)**: 현재 `WorkmapCardList`의 `CardTileData`(state: decomposed/instructed/verifying/verified/rejected/extended)는 *step 내부 실행 카드*로, **plan step과 다른 레이어**다. 통합안은 카드를 **step 행 확장 시 하위 디테일**로 중첩(병렬 캐러셀 폐기)한다. → 이 매핑이 맞는지(카드 1개=step 1개인지, N:1인지) 구현 전 코드로 확인.
- **가정 B**: 두 상태 enum을 억지로 하나로 합치지 않는다. 표현 레이어에서 각자 `*-status-meta`로 토큰 매핑만 정렬.

## 10. 디자인 시스템 / 타이포 규칙 (v2 확정)

- **폰트**: 제목·본문 = Pretendard(`--sans`). ID·상태태그·메타·eyebrow·카운터 = **JetBrains Mono(`--mono`) 대문자 + letter-spacing**(기술/원장 캐릭터).
- 색은 토큰만: `bg/fg/accent/success/warn/danger/info/border/ring`. **raw hex 0**(미니맵 SVG 포함; 토큰 rgb/`currentColor`).
- **accent(라벤더) 절제**: 현재 단계 + 주 CTA + 병렬 레일/태그에만. 전면 wash·글로우 남발 금지.
- **폰트 스케일**: 본문/제목은 토큰 스케일(≥`text-xs` 12px). 단 **mono 마이크로 라벨(상태태그·메타·eyebrow)은 정의된 9.5–11px 스케일** 허용(디자인 토큰의 일부). 그 외 임의 off-scale 금지.
- 상태는 **노드(모양·색) + mono 텍스트 태그** 2중 인코딩(색 단독 금지).
- **금지**: 카드 컨테이너, 왼쪽 색바, 라운드 칩/필, 무거운 그림자.

## 11. 경량 블루프린트 미니맵 (Mermaid 대체)

- 접이식, **기본 접힘**(헤더 "의존성 그래프 보기"로 펼침).
- **블루프린트 스타일**: 점선 그리드 배경 + 외곽선 노드(상태별 stroke/채움) + mono 라벨 + 곡선 엣지. **타임라인과 같은 노드 언어 공유**(done 채움/now accent/ready accent/blocked 점선).
- 레이아웃: 의존성 위상 레벨(열) 배치. **신규 무거운 그래프 lib 금지**(React Flow/dagre 미도입). 단순 레벨 배치 + SVG. 도입 필요 시 별도 결정.
- 줌/팬은 v1 범위 밖이지만 컨테이너는 `max-h` 감옥 금지 — 펼침 시 충분한 높이 + 스크롤.
- 노드 `tabindex`/`role="button"`/`aria-label`, 클릭·Enter → 해당 step으로(§8).

## 12. 접근성 (WCAG 2.1 AA)

- 전 인터랙티브 키보드 도달/조작. 아이콘 버튼 `aria-label`.
- 대비 4.5:1(본문)/3:1(큰 텍스트). 회색 위 회색 금지.
- 상태 색 단독 의존 금지(§10).
- 미니맵 SVG 노드 포커서블 + `aria-label`(현행 SVG는 키보드 0 → 회귀 방지).

## 13. i18n

- 모든 사용자 문자열 `useT()`. 신규 키는 `i18n/en.json`+`ko.json` 동시. 한국어 하드코딩 0(현행 `WorkmapCardList` 위반 제거).

## 14. testid 계약

- 검증 스크립트가 의존: `dive/scripts/verify-workmap.mjs`, `dive/scripts/verify-integration.mjs`.
- 사용 중 추정 testid: `plan-roadmap-dag`, `plan-dag`, `workmap-card-list`, `card-tile`, `plan-roadmap-start-group`, `workmap-scroll-*`, `workmap-add-card`.
- 규칙: **구현 전** 두 스크립트가 참조하는 testid를 grep으로 확정 → 신규 컴포넌트에 **동등 testid 매핑 표** 작성(예 `plan-view`, `plan-step-row`, `plan-step-action`, `plan-minimap`, `plan-minimap-node`). 스크립트도 함께 갱신해 **그린 유지**.

## 15. 수용 기준 (acceptance criteria)

1. 플랜이 **하나의 타임라인 척추 뷰**로 렌더되고, 그래프/수평 캐러셀/리스트 중복이 사라진다.
2. Mermaid 의존성과 `dangerouslySetInnerHTML` 그래프 경로가 **코드에서 제거**된다(grep 0).
3. 각 step 행에서 상태·스텝번호·제목·의존성·1차 액션이 보이고, blocked는 비활성+사유 표시.
4. loading/empty/error/blocked **4상태 모두** 처리(빈/널 화면 없음).
5. **키보드만으로** 모든 액션 수행 가능(Tab 순회 + Enter/Space), 미니맵 노드 포함.
6. **raw hex 0**, off-scale 폰트 0, 사용자 문자열 i18n 100%.
7. 미니맵 접이식 동작 + 노드 클릭 시 해당 행 포커스.
8. `verify-workmap.mjs`/`verify-integration.mjs` 및 기존 테스트 **그린**(testid 매핑/갱신 반영).
9. 320/768/1024/1440px에서 깨짐 없음.
10. **병렬 step이 일반 step과 동급**으로 렌더된다(같은 척추 정렬·26px 노드·풀 메타/액션). 들여쓰기·노드 축소·서브그리드 **금지**, 트윈 레일 그룹으로 묶인다.
11. 타임라인·미니맵이 **같은 노드 언어**(상태별 모양·색)를 공유한다.

## 16. 테스트 전략

- 단위/컴포넌트: 상태별 렌더(5 step 상태 × 4 화면상태), 액션 콜백, 의존성/blocked 표시, 미니맵 토글/노드클릭.
- a11y: axe-core 경고 0, Tab 순회 스냅샷.
- 회귀: `verify-workmap.mjs`/`verify-integration.mjs` 갱신 후 통과. 빌드(`pnpm -C dive build`)·테스트(`pnpm -C dive test`) 그린.
- 시각: 320~1440 브레이크포인트 수동 + 스크린샷.

## 17. 단계 (phasing) — 얇은 수직 슬라이스

- **P1**: 데이터/모델 확인(§9 가정 A/B 코드 검증) + `plan-status-meta` + 정적 `PlanStepRow`/`PlanStepList`(액션 없이 렌더).
- **P2**: 상태 4분기 + 액션 배선(시작/이어하기/열기/그룹), `RoadmapRail`을 `PlanView`로 교체.
- **P3**: 경량 미니맵 + 행 동기화. Mermaid/`RoadmapDAG`/`WorkmapCardList` 제거, 의존성 정리, testid/verify 스크립트 갱신.
- **P4**: a11y/반응형/i18n 마감 + 회귀 그린.

## 18. 경계 (boundaries)

- **Always**: 디자인 토큰만, i18n, 키보드/a11y, 기존 데이터 소스 보존, testid 그린 유지, 컴포넌트 ≤200줄.
- **Ask first**: 상태 enum/IPC/데이터 모델 변경, 신규 그래프 lib 도입, `PlanDashboardPanel`까지 확장, 플랜 생성/승인 플로우 손대기.
- **Never**: raw hex, off-scale 임의 폰트, 한국어 하드코딩, `dangerouslySetInnerHTML`로 그래프, 빈/널 화면, 색 단독 상태 인코딩, 백엔드 동작 변경.

## 19. 가정 & 미해결 질문

- (A) 카드(`CardTileData`)와 플랜 step(`PlanRoadmapStep`)의 관계(1:1 / N:1 / 별개 레이어)? → §9. **구현 P1에서 코드 확인**, 결과로 본 spec §5/§6 갱신.
- (B) `MermaidDiagram`의 다른 사용처 유무 → 제거 전 grep.
- (C) 미니맵 v1에 줌/팬 불필요 가정 — 큰 플랜(>30 step)에서 재검토.
- (D) 실행 주체: **spec 잠금 완료(v2 timeline)**. 구현은 Codex 위임 또는 본 세션 점진 구현 중 택1(다음 결정).
