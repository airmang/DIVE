# DIVE 콘솔 디자인 언어(T1) 전면 적용 + 채팅 tool-card 재설계

- 작성일: 2026-06-08
- 상태: 설계 합의 → 스펙 리뷰 대기
- 범위: 풀 마이그레이션(디자인 토큰 전역 교체 + 모든 표면 폴리시 + 채팅 활동 재설계)

## 1. 배경 / 문제

DIVE의 현재 UI 정체성은 `dive/tailwind.config.ts` + `dive/src/styles/globals.css`에서 옴:

- 폰트 `sans = Pretendard`(휴머니스트 한글체) → 부드럽고 "Claude스러운" 인상
- 액센트 `--color-accent: 177 156 217`(소프트 라벤더/퍼플) → Anthropic/Claude 계열 톤
- 모서리 `borderRadius` sm6 / DEFAULT8 / lg12 / xl16 → 둥근 느낌

또한 구현(Build) 단계 채팅이 **tool 1개 동작 = 3개의 분리된 박스**(의도 `ReasoningCard` → 호출 `ToolCallMessage` → 결과 `ToolResultMessage`)로 쌓여 산만하다(`dive/src/components/chat/MessageList.tsx`가 flat 리스트를 `gap-4`로 렌더).

**목표:** "코딩 감독 콘솔" 정체성에 맞는 각진/기술적 디자인 언어(T1)로 전면 전환하고, 채팅 tool 활동을 "조용한 활동 로그 + 결정적 순간만 카드"로 압축한다. **감독 학습성(왜 이 도구를 쓰는지)은 유지**한다.

## 2. 디자인 원칙

1. **각진 기하** — 둥근 모서리 최소화(2–6px).
2. **기술적 타이포** — 한글 본문 = IBM Plex Sans KR(기술적 그로테스크), 코드·숫자·도구명·라벨 = JetBrains Mono.
3. **콘솔 팔레트** — 쿨한 near-black 배경 + 민트 액센트 + 라인 아이콘.
4. **압축 + 감독성** — 진행/완료는 1줄로 흐르고, 승인·차단 같은 "행동/주의" 순간만 카드로 격상. "왜"는 가볍게 항상 노출.

## 3. 디자인 토큰 변경 (Foundation) — 전역 1차 전환의 핵심

색·폰트·모서리가 전부 토큰 + "raw hex 금지" 린트로 묶여 있어, 아래 두 파일 교체로 전 화면이 동시에 전환된다.

### 3.1 `globals.css` 팔레트 (dark = `:root, :root.dark`)

제안값(조정 가능). `rgb` 채널 표기는 기존 컨벤션 유지:

```
--color-bg:           10 14 18     /* #0A0E12  (was 26 26 31) */
--color-bg-panel:     15 20 25     /* #0F1419 */
--color-bg-panel2:    19 26 33     /* #131A21 */
--color-border:       29 38 47     /* #1D262F */

--color-fg:           215 224 232  /* #D7E0E8 */
--color-fg-muted:     111 125 138  /* #6F7D8A */
--color-fg-subtle:     79 90 102   /* #4F5A66 */

--color-accent:        58 214 160  /* #3AD6A0  민트 (was 라벤더 177 156 217) */
--color-accent-hover:  90 224 178
--color-accent-active: 42 184 136
--color-accent-subtle: 13 37 30    /* dark mint tint */
--color-accent-fg:      6 20 14    /* near-black on mint */

--color-success:       70 209 150  /* #46D196 */
--color-warn:         232 181  82  /* #E8B552 amber */
--color-danger:       255 107 107  /* #FF6B6B coral */
--color-info:          91 140 255  /* #5B8CFF cool blue */
--color-ring:          58 214 160  /* = accent */
```

> 주의: 액센트(민트)와 `success`가 모두 녹색 계열로 근접하다. 콘솔 미감에선 의도적 조화(녹색 = 성공/강조)지만, 의미 구분이 필요한 곳(예: success 토스트 vs accent 버튼)에서 혼동 가능. 필요 시 `success`를 살짝 다른 명도로 분리하거나 accent와 통일. 리뷰에서 결정.

### 3.2 `globals.css` 라이트 모드 (`:root.light`) — **리뷰 결정 필요**

콘솔 미감은 다크 native. 옵션:
- (권장) 쿨 뉴트럴 + 민트로 **재보정**해 기능 유지(밝은 회색 배경, 동일 민트 액센트, 각진 모서리). 폴리시는 다크 우선.
- (대안) 라이트를 이번 범위에서 **보류**하고 다크만 1급 지원.

→ 기본 권장은 "재보정해 동작 유지". 리뷰에서 확정.

### 3.3 `tailwind.config.ts`

```
fontFamily.sans = ["IBM Plex Sans KR", "IBM Plex Sans", <기존 system 폴백…>]
fontFamily.mono = ["JetBrains Mono", …]   // 유지

borderRadius: sm 6→2, DEFAULT 8→3, md 8→3, lg 12→4, xl 16→6
```

### 3.4 폰트 자산 (self-host 필수)

Tauri 오프라인 앱이라 CDN 불가. `dive/src/assets/fonts/`에 **IBM Plex Sans KR woff2 추가**(weight 400/500/600), `globals.css`에 `@font-face` 등록. 한글 웹폰트는 크므로 **서브셋(KR+Latin)** 적용해 번들 크기 관리.

### 3.5 스펙 동기화

`DIVE_SPEC.md §2.3`(팔레트 source of truth) 및 폰트 항목을 새 토큰으로 업데이트(린트/스펙 일관성 유지).

## 4. 아이콘

이모지 → lucide 라인 아이콘. 직접 이모지 사용은 4파일뿐, lucide는 이미 50파일에서 사용 중이라 작업 작음. 도구/상태 매핑 예: file→`FileText`, bash/run_process→`Terminal`/`SquareTerminal`, read→`Eye`, 성공→`Check`, 실패→`X`, 승인필요→`TriangleAlert`, 차단→`Ban`, 펼침→`ChevronDown`.

## 5. 채팅 tool-card 재설계 (A · 하이브리드)

### 5.1 상태별 표현

- **컴팩트 행** (running / done / failed / denied): `[상태] [도구아이콘] 도구명 · 인자 … 결과요약 ▾` 한 줄, 결과는 행 안에 인라인(`+12 −3`, `14 passed`, `exit 1`). 그 아래 `↳ 왜 …` 가벼운(faint) 서브라인. 펼침(▾)으로 args/diff/출력 노출.
- **격상 카드** (pending-approval / blocked): 기존 `PermissionCard`(승인/거부·diff·risk) 및 blocked 카드를 **유지**하되 새 토큰/각진 기하로. 감독 게이트는 오히려 더 또렷하게.

### 5.2 구현 매핑

현재 3개의 AgentEvent → ChatMessage(`reasoning`, `tool_call`, `tool_result`)는 그대로 저장하고, **렌더 단계에서 `tool_call_id` 기준으로 묶어** 단일 `ToolActivity` 컴포넌트로 표시한다(`MessageList`에서 그룹핑). 이 방식은 이벤트/스토어 파이프라인을 건드리지 않아 침습이 적고 기존 메시지 저장·셀렉터를 보존한다.

- 신규: `dive/src/components/chat/ToolActivity.tsx` — 입력: 왜(reasoning text) + 호출(name/args/risk/status/diff) + 결과(success/summary/full).
- `ReasoningCard` / `ToolCallMessage` / `ToolResultMessage`는 ToolActivity의 하위 표현으로 흡수(컴포넌트는 남기되 단독 렌더 경로 축소).
- pending/blocked는 ToolActivity가 `PermissionCard` / blocked 카드로 위임.

### 5.3 테스트 보존 (필수)

채팅 컴포넌트의 `data-testid`(`chat-message`, `data-kind="tool_call"`/`tool_result`, `data-message-kind="reasoning"`, permission 카드 testid 등)는 e2e가 의존한다. ToolActivity로 묶더라도 **동일 testid를 대응 하위 요소에 보존**해 기존 테스트가 깨지지 않게 한다.

### 5.4 밀도 토글 (선택)

"왜 표시 ON/OFF"(감독 모드 ↔ 순정 로그)는 nice-to-have. 기본 ON. 이번 범위에서는 선택 사항으로 두고 후속 가능.

## 6. 영향 범위 (표면 sweep)

토큰 변경으로 대부분 자동 전환되며, 아래는 화면별 점검 대상(`dive/src/components/` 디렉터리 기준):
shell(ChatArea/레이아웃), sidebar, product/cockpit, plan(plan-spine·blueprint grid 유틸 — `globals.css`의 `plan-*`가 accent 참조라 자동 반영), workmap, onboarding(get-started 체크리스트), permission-card(Safe/Warn/Danger), settings, prompt-helper, mcp, codex, toast, slide-in, ui(badge/button/input 프리미티브), demo 페이지.

sweep 작업의 실제 내용 = 이모지→lucide(4파일) + 대비/간격/보더 미세 조정 + 둥근/퍼플 가정이 박힌 곳 점검.

## 7. 단계 (Phasing)

- **P1 Foundation**: `globals.css`(dark+light 토큰) + `tailwind.config.ts`(폰트/모서리) + Plex Sans KR 자산/@font-face + `DIVE_SPEC.md §2.3` 동기화. → 전 화면 1차 전환.
- **P2 채팅 재설계**: `ToolActivity` 그룹핑 컴포넌트(컴팩트 행 + 왜 + 펼침), 격상 카드 위임, testid 보존.
- **P3 아이콘 + 표면 폴리시**: 이모지→lucide, 화면별 시각 점검/조정.
- **P4 검증**: 다크/라이트 전 화면 시각 패스, 접근성 대비(AA), 프론트 게이트(format:check·typecheck·lint) + 기존 테스트(특히 채팅 e2e) 그린, raw-hex 린트 위반 0.

## 8. 위험 / 주의

- **테스트 결합**: 채팅 `data-testid` 보존(§5.3).
- **오프라인 폰트**: Plex Sans KR self-host + 서브셋(번들 크기).
- **접근성**: 민트 액센트 위 텍스트(`accent-fg`)·muted 텍스트 대비 AA 확인.
- **라이트 모드 범위**: §3.2 결정 필요.
- **스펙 드리프트**: `DIVE_SPEC.md §2.3` 동기화 필수(no-raw-hex 린트와 일관).
- **블라스트 반경**: 전 화면 변경 → 머지 전 전수 시각 QA.

## 9. 수용 기준

1. 전 화면에서 Pretendard / 라벤더 / 큰 둥근 모서리 잔재 없음 — 콘솔(T1) 인상.
2. 한글=Plex Sans KR, 코드/숫자/라벨=JetBrains Mono, 둘 다 self-host.
3. 액센트 민트가 토큰으로 적용, `DIVE_SPEC §2.3` 갱신, raw-hex 린트 위반 0.
4. 채팅: tool 동작 = 1 컴팩트 행 + 왜 + 펼침; pending-approval/blocked 격상 카드; testid 보존; 기존 채팅 테스트 그린.
5. 프론트 게이트(format:check + typecheck + lint) 그린; 다크/라이트 동작; 대비 AA.

## 10. 리뷰에서 확정할 오픈 항목

- 라이트 모드: 재보정 vs 보류(§3.2)
- 정확한 민트 값/명도, 모서리 스케일 미세값(§3.1, §3.3)
- 밀도 토글 포함 여부(§5.4)
