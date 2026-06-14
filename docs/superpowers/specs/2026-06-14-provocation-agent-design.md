# Provocation "감독관 에이전트" 설계 — Pi SupervisorAgent

- **날짜**: 2026-06-14
- **상태**: v2 기준 SPEC 정렬 중 (구현 전 사용자 검토)
- **대체**: 정적 "質" reframe 스펙(`2026-06-14-provocation-quality-reframe-design.md`)은 폐기 아님 — 본 설계의 **few-shot 보이스 시드**로 흡수. v2 제품에는 정적 provocation fallback을 두지 않는다.

## 1. 배경 · 결정 경로

DIVE는 **초심자에게 감독 역량을 가르치는 앱**이고, provocation은 그 안에서 "멍청하게 버튼만 누르지" 않게 하는 *tool of thought*(Sarkar, CACM 2024)다. 구조①(plan·검증·DecisionGate=감독 비계)과 **분리 유지**한다.

기존 provocation 생성은 프런트엔드 **키워드 휴리스틱**(`rules.ts`의 `FEATURE_KEYWORDS` 등, `adapters.ts`의 `ASSISTANT_COMPLETION_TERMS` 등)이다. 사용자가 이 룰 게이트 방식을 **전면 거부** → Pi runtime 안의 별도 **LLM "감독관 에이전트"**로 전환한다. 근거: Sarkar의 도발 예시는 *상황 탐지*가 아니라 *실제 산출물에 대한 내용 비평*("이 auth는 토큰 만료를 가정 안 했네 — refresh는?")이며, 키워드는 후자를 못 한다.

트리거 선택지 (A)이벤트+LLM판단 / (B)완전자율관찰자 중 **(A) 확정.**

2026-06-14 v2 정리 결정: 새 레포 전면 재작성은 보류한다. 현재 레포에서 SPEC을 확정하고, Provocation/SupervisorAgent를 작은 vertical slice로 검증한 뒤 정리한다.

## 2. 목표

프런트엔드 룰 기반 provocation 생성을, **Pi runtime 안의 전용 SupervisorAgent**로 교체한다. 감독관은 작업의 구조적 라이프사이클 이벤트에 *호출*되어, DIVE가 수집한 실제 산출물(diff·plan·완료 기준·대화 요약·verify 로그)을 보고 **도발할지/무엇을 도발할지를 판단**한다.

SupervisorAgent는 최종 `ProvocationCard`를 직접 만들지 않는다. SupervisorAgent는 구조화된 `SupervisorDecision`만 반환하고, DIVE 백엔드가 evidence 검증·중복 제거·쿨다운·액션 allowlist 매핑을 통과한 결정만 기존 카드 UI에 맞는 `ProvocationCard`로 변환한다. 근거가 없으면 **침묵**한다.

## 3. 비목표 (범위 울타리)

- ❌ 카드 UI / `ProvocationCardHost` / 카드 표시 형태 변경 (= 형태축, 후속)
- ❌ DecisionGate·verificationStatus·구조① 변경
- ❌ (B) 완전 자율 백그라운드 관찰자 — 호출은 이벤트로 한정
- ❌ 강제 게이트·forcing function 추가 (도발은 비차단·무시 가능 유지)
- ❌ 키워드 룰 게이트 (전면 은퇴)
- ❌ 메인 코딩 에이전트가 자기 작업 도중 자율적으로 카드를 생성
- ❌ SupervisorAgent에 도구·파일시스템·프로젝트 resource discovery 제공
- ❌ LLM 실패/오프라인 시 정적 fallback 카드 생성

## 4. 아키텍처 (Pi SupervisorAgent 분리)

```
[프런트/백엔드] 라이프사이클 이벤트 발생
   → invoke("provocation_agent_evaluate", { event, artifactRef, uiEvidenceFlags })
[Rust 백엔드] SupervisorContext 수집
   → DIVE DB/plan/diff/verify log/message summary에서 evidence bundle 생성
   → evidenceRef ID와 contextHash 부여
[Pi sidecar] run_supervisor_turn(context)
   → 별도 no-tools, no-resource-discovery, one-shot SupervisorAgent session
   → 메인 코딩 agent history/session/memory와 분리
   → strict JSON 출력: SupervisorDecision
[Rust 백엔드] parse_supervisor_decision(text)
   → 위생 필터(근거 ref 검증, 질문 형태, action allowlist, 중복/쿨다운)
   → EventLog/provocation_log_event 기록 (입력 요약+출력+근거+drop/show)
   → 결정 통과 시 SupervisorDecision → ProvocationCard 매핑
   → 반환: Option<ProvocationCard>
[프런트] 결과 있으면 기존 ProvocationCardHost로 조용히 렌더
```

- **선례**: `workspace_plan_generate_draft` → `plan_router`(채팅 아닌 구조화 LLM 결정). 단, v2에서는 일반 provider 호출이 아니라 Pi runtime 안의 별도 supervisor turn으로 둔다.
- **호출 표면**: `pi_sidecar::run_supervisor_turn(...)` 신규. 메인 `run_supervised_turn`과 같은 sidecar/protocol 계층을 재사용하되 session 목적과 tool surface를 분리한다.
- **SupervisorAgent 격리**: custom tools 없음, Pi built-ins 없음, resource discovery 없음, filesystem/process 실행 없음, 장기 memory 없음, 메인 coding agent session 공유 없음.
- **모델 티어**: 메인 코딩 모델이 아닌 **빠르고 저렴한 supervisor tier**를 기본값으로 둔다. 단, provider fallback으로 legacy runtime을 사용하지 않는다. 모델이 unavailable이면 카드 없음 + 로그 기록.
- **비차단 async**: 작업 흐름을 막지 않고, 결과가 준비되면 해당 artifact 근처에 ambient하게 렌더한다.

## 5. 트리거 이벤트 (A안 — "언제 보는가")

키워드 매칭이 아니라 *감독관이 작업을 들여다보는 구조적 순간*. 각 이벤트에서 호출되고, **도발 여부는 LLM이 결정**.

| 이벤트 | 발생 시점 | 감독관이 보는 것 | 대응 관심사(은퇴하는 룰) |
|---|---|---|---|
| E1 plan_drafted | plan draft 생성 직후 | 목표·step들·완료 기준·검증 커버리지 | oversized_scope, missing_acceptance_criteria, missing_verification_step |
| E2 ai_claimed_done | assistant 턴 종료(완료 주장) | 주장 vs 관찰된 증거 | ai_self_report_only |
| E3 diff_ready | step 실행 후 변경 준비됨 | diff 본문 vs 목표/대상 파일 | diff_scope_drift |
| E4 verify_entered | verify/최종 승인 진입 | verify 로그·증거 플래그 | ai_self_report_only(승인 직전) |
| E5 retry_loop | 동일 오류 N회 재시도 감지 | 최근 오류·재시도·복구 언급 | regeneration_loop |

이벤트 감지는 이미 앱에 훅이 있음(plan draft 생성, assistant 턴 종료, changedFiles 준비, verify 진입). E5의 "N회 동일 오류"는 *카운팅*(결정론적 사실)이지 키워드 판정이 아님.

## 6. 감독관 계약 (contract)

**입력** `SupervisorContext` (기존 `ProvocationContext`를 seed로 삼되 Rust 백엔드가 canonical evidence bundle로 재구성):

event, artifactRef, contextHash, goalText, acceptanceCriteria, planSteps, changedFiles(+diff hunks), targetFiles, 최근 대화 요약, verifyLog, 관찰 증거 플래그(diffViewed/previewObserved/testObserved/...), mode, allowedActions, evidenceRefs.

`evidenceRefs`는 Rust가 부여한 ID 목록이다. SupervisorAgent는 이 ID만 근거로 인용할 수 있고, 입력에 없는 근거를 새로 만들 수 없다.

**출력** `SupervisorDecision` (구조화):
```json
{
  "provoke": false,
  "severity": "caution",
  "concern": "ai_self_report_only",
  "question": "AI는 완료라고 했어요. 당신은 무엇을 보고 확인했나요?",
  "evidenceRefs": [{ "id": "verify.test_result", "source": "verification", "note": "test_result가 skipped로 기록됨" }],
  "suggestedActionIds": ["open_preview", "run_tests"],
  "supervisionHabit": "능숙한 감독자는 AI의 말과 자기가 직접 본 것을 구분합니다.",
  "logRationale": "완료 주장은 있으나 독립 검증 증거가 없음"
}
```
- `provoke=false` = **침묵**(안전 기본값).
- `provoke=true`인데 `evidenceRefs`가 비거나 입력에 존재하지 않으면 → 백엔드가 **drop**(침묵 처리). = 환각 위생.
- `question`은 **반드시 질문**(단정 금지). `concern`은 로깅/택소노미 연속성용(기존 6 cardType 어휘 유지).
- `suggestedActionIds`는 allowlist에 있는 짧은 action id만 허용한다. 액션 label/behavior는 DIVE가 결정한다.
- `logRationale`은 EventLog/debug용이며 학생-facing 카드 본문으로 그대로 노출하지 않는다.

**프롬프트 설계 원칙**(시스템 프롬프트에 명시): 감독관은 코드를 *대신 쓰지 않고 비평만* 한다 / 질문으로만 말한다 / 입력 evidenceRef를 인용 못 하면 침묵한다 / 드물게(웬만하면 침묵) / 초심자가 스스로 묻게 만드는 게 목적 / 메인 코딩 에이전트의 답변을 검증 증거로 취급하지 않는다.

## 7. 위생 장치 (룰 게이트 아님 — 안전·희소성 보장)

1. **근거 강제** — 실제 코드/산출물 인용 없으면 도발 불가(초심자에게 틀린 도발 = 잘못된 학습). Sarkar: 비전문가에 LLM 설명 신뢰성 미입증.
2. **Anti-barrage** — 같은 산출물에 같은 concern 반복 금지(쿨다운/dedup), 동시 1개만 노출(host 기존 동작). Sarkar의 "constant barrage" 회피.
3. **질문 형태 강제** — 출력 검증에서 단정문이면 약화/drop.
4. **액션 allowlist** — LLM은 액션 ID를 제안만 한다. DIVE가 허용한 action만 카드에 매핑한다.
5. **카드 ID 결정론** — `event + artifactRef + concern + evidenceHash`로 deterministic card id를 만든다. 같은 근거에서 같은 카드가 반복 생성되지 않게 한다.
6. **Prompt-injection 방어** — diff/terminal/message 내용은 비신뢰 artifact로 취급한다. SupervisorAgent 시스템 프롬프트는 artifact 안의 지시를 따르지 말고 evidence 비평만 하도록 고정한다.

## 8. 보이스 · 실패 처리

이전 "質" 스펙 §5의 reframe 문구는 **few-shot 스타일 예시**로만 생존한다. 감독관에게 "이 톤·이 질문 결로 써"를 보여주는 seed이며, 런타임 실패 시 정적 fallback 카드로 사용하지 않는다.

SupervisorAgent 호출 실패, 모델 unavailable, JSON parse 실패, evidence 검증 실패, 질문 형태 실패, 중복/쿨다운 hit는 모두 **카드 없음**으로 처리한다. 단, EventLog에는 `provoke=false` 또는 `dropped` 결과와 이유를 남긴다.

## 9. 로깅 · 연구 타당성

기존 `provocation_log_event`/EventLog 확장 재사용: **이벤트명 + artifactRef + contextHash + 입력 컨텍스트 요약 + evidenceRefs + SupervisorDecision raw 요약 + 위생 필터 결과 + provoke/drop 여부 + 모델/토큰/latency**를 기록 → 비결정성을 **감사·재현 가능**하게(포스터 타당성 방어). 파일럿에서 "어떤 이벤트가 어떤 도발을 낳았나"와 "왜 침묵했나"를 함께 추적.

## 10. 영향 받는 코드

- **신규(백엔드)**: `dive/src-tauri/src/dive/provocation_agent.rs`(SupervisorContext 빌드+프롬프트+파싱+위생 필터), tauri command `provocation_agent_evaluate`(ipc), `SupervisorDecision -> ProvocationCard` mapper.
- **신규/수정(Pi sidecar)**: `run_supervisor_turn` protocol 추가. no-tools/no-resource-discovery one-shot supervisor session. 메인 `run_supervised_turn`과 분리.
- **신규/수정(프런트)**: 이벤트별 `invoke("provocation_agent_evaluate", { event, artifactRef, uiEvidenceFlags })` 호출부, 결과를 `ProvocationCardHost`로 전달. 프런트가 LLM prompt나 canonical evidence를 임의 구성하지 않는다.
- **은퇴**: `rules.ts`의 6개 생성 함수 + `FEATURE_KEYWORDS`/`SCOPE_*`/`VERIFICATION_TERMS` 등, `adapters.ts`의 키워드 리스트(`ASSISTANT_COMPLETION_TERMS`/`RETRY_REQUEST_PATTERNS` 등). 단 E5 재시도 *카운팅*과 `ProvocationContext`/`normalizeChangedFile`은 입력 수집용으로 유지.
- **유지**: `ProvocationCard`/`ProvocationCardHost`(UI), `priority.ts`(정렬·모드), `verificationStatus.ts`, 카드 타입/severity 어휘.
- **테스트**: 룰 단위테스트(`__tests__/rules.test.ts`) 대거 폐기/이전, 백엔드 파싱·위생 필터·evidenceRef 검증·action allowlist·dedup/cooldown·EventLog export 신규 테스트, Pi sidecar supervisor no-tools/resource-discovery 테스트.

## 11. 위험 · 열린 질문

- **품질 평가(eval)** — LLM 도발이 "좋은지"를 어떻게 아나? Sarkar도 *provocateur 벤치마크 부재*를 명시. → 골든 케이스 세트로 회귀(근거 강제·질문 형태·희소성 충족률) 측정.
- **지연 UX** — 싼 티어라도 수 초. 비차단 + "준비되면 조용히 등장"으로 흡수(ambient).
- **비용** — 이벤트당 호출. E1/E2/E4는 드물어 OK, E3(diff)·E5는 빈발 가능 → 쿨다운.
- **오프라인/실패** — 카드 없음 + drop/error 로그. v2에서는 정적 fallback 카드 없음.
- **프라이버시** — 코드를 모델에 보냄. 단 DIVE는 이미 AI 코딩 앱이라 코드는 이미 모델로 감 — 새 노출 아님.
- **역할 혼선** — 메인 코딩 agent가 자기 산출물을 스스로 감독하면 목적 충돌. SupervisorAgent는 별도 no-tools one-shot으로 분리한다.
- **AgentLoop 의존성** — 현재 Pi 경로가 `AgentLoop`를 supervision/tool bridge로 재사용한다. 구현 시 legacy model loop와 supervision boundary 역할을 분리해, v2 제품의 legacy fallback 제거와 DIVE supervision 재사용을 구분해야 한다.

## 12. 단계 (phasing)

큰 작업이라 수직 분할. 각 단계 독립 검증.

- **P0 (feasibility/spec)**: 현재 레포에서 진행. 새 레포 전면 재작성 없음. Pi sidecar에 no-tools SupervisorAgent one-shot이 가능한지 spike하고, `SupervisorDecision` 계약·EventLog 필드를 확정.
- **P1 (MVP)**: 백엔드 command + Pi `run_supervisor_turn` + 계약 + 위생 필터 + **E2 ai_claimed_done / E4 verify_entered** 두 트리거만. 정적 fallback 없음. 가장 고가치(자동화 편향 핵심) + 근거 명확.
- **P2**: `SupervisorDecision -> ProvocationCard` mapper로 기존 `ProvocationCardHost` 렌더. `rules.ts` 생성 경로를 feature flag 뒤에서 비활성화하고, P1 표면의 logging/export를 완성.
- **P3**: E1(plan_drafted), E3(diff_ready), E5(retry_loop) 트리거 추가. E3/E5는 쿨다운과 evidence volume limit을 먼저 검증.
- **P4**: 키워드 룰 생성 함수·리스트 은퇴, 프런트 `generateProvocationCards` 제거, eval 골든세트 + 로깅 분석(파일럿 준비).

## 13. 범위 밖 / 후속

- **타이밍축** — 트리거 설계에 일부 흡수. 파일럿 데이터로 쿨다운·이벤트 튜닝.
- **형태축(notation)** — 카드 → notation형 감독 도구. 본 설계 이후 최대 베팅.
