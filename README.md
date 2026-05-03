# DIVE 명세 + Ralph 자동 구현 패키지

이 폴더는 DIVE 프로젝트를 codex로 자동 구현하기 위한 **명세 + 자동화 운영 자료**입니다. ChatGPT 구독 기반 codex CLI와 ralph 루프를 사용해 며칠~몇 주 자율 진행하도록 설계되었습니다.

## 파일 구성

| 파일 | 역할 | 누가 수정하나 |
|---|---|---|
| `DIVE_SPEC.md` | 제품 명세 (Single Source of Truth) | 사용자만 |
| `DIVE_DECISIONS.md` | 의사결정 기록 (ADR 누적) | codex가 ADR 추가, 사용자가 검토 |
| `DIVE_PROGRESS.md` | 36개 작업 체크리스트 | codex가 갱신 |
| `DIVE_NEXT.md` | 이번 턴 단일 작업 | codex가 매 턴 갱신 |
| `RALPH_PROMPT.md` | ralph 루프 본체 (codex에 입력되는 프롬프트) | 사용자만 (드물게) |
| `ralph_run.sh` / `ralph_run.ps1` | ralph 루프 실행 스크립트 | 환경에 맞게 조정 |
| `images/` | 명세서가 참조하는 와이어프레임 18개 | 변경 없음 |

## 운영 흐름

```
[사용자]                              [Ralph 루프]
   │                                      │
   ├─ ralph_run.sh 실행 ──────────────────>│
   │                                      │
   │                                      ├─ 매 턴 fresh codex 호출
   │                                      │   ├─ SoT 4파일 읽기
   │                                      │   ├─ DIVE_NEXT.md 작업 수행
   │                                      │   ├─ 검증
   │                                      │   ├─ DIVE_PROGRESS.md 갱신
   │                                      │   ├─ DIVE_DECISIONS.md ADR 추가
   │                                      │   └─ DIVE_NEXT.md 다음 작업 작성
   │                                      │
   │                                      ├─ [PHASE_GATE] 또는 [BLOCKED] 감지
   │<──────── 정지 + 알림 ─────────────────┤
   │                                      │
   ├─ DIVE_NEXT.md 검토                   │
   ├─ 결정 후 사용자가 NEXT 갱신          │
   ├─ ralph_run.sh 재실행 ────────────────>│
```

## 시작하기

### 1. 사전 준비

- ChatGPT 구독 (Plus 이상)
- codex CLI 설치 및 OAuth 인증 완료
- Windows: PowerShell 5.1+ 또는 7+
- macOS/Linux: bash 4+

### 2. 첫 실행

```bash
# 폴더 구조 확인
ls dive_spec/

# ralph_run.sh의 codex 호출 부분을 실제 환경에 맞게 조정
# (codex CLI 명령 형식이 버전마다 다를 수 있음)

# 첫 실행
chmod +x ralph_run.sh
./ralph_run.sh

# 또는 Windows
.\ralph_run.ps1
```

### 3. 모니터링

- ralph는 `ralph_logs/turn_NNNN_*.log`에 매 턴 로그를 남김
- 사용자는 가끔 `DIVE_PROGRESS.md`를 확인해 진행 상황 점검
- `DIVE_NEXT.md`에 `[PHASE_GATE]` 또는 `[BLOCKED]` 표시가 뜨면 ralph가 자동 정지하고 사용자 결정 대기

### 4. 정지·재개

- 사용자가 직접 정지: `Ctrl+C`
- 자동 정지: Phase 게이트 도달, BLOCKED 발생, 1000턴 초과
- 재개: 결정을 `DIVE_NEXT.md`에 반영한 후 다시 `ralph_run.sh` 실행

## 36개 작업 — Phase 구성

| Phase | 시기 | 목표 | 작업 수 |
|---|---|---|---|
| 1 | 5월 | 기술 스파이크 — 빌드 가능한 골격 | 6 |
| 2 | 6월 | v0.1 — 채팅 + 권한 카드 + D 게이트 | 6 |
| 3 | 7월 | v0.2 — 모든 게이트 + 체크포인트 + 안전장치 | 6 |
| 4 | 8월 초 | 파일럿 직전 폴리싱 + 현장 검증 | 6 |
| 5 | 10월 | v0.3 — Codex OAuth + MCP + 프롬프트 도우미 | 6 |
| 6 | 11~12월 | v1.0 — 다국어 + 접근성 + 정식 배포 | 6 |

각 Phase 종료 시 `[PHASE_GATE]` — 사용자 확인 필수.

## 사용자 개입 시점

ralph는 다음 경우에만 멈춥니다. **그 외에는 자율 진행합니다.**

1. **Phase 게이트** — 한 Phase 6개 작업 완료 후
2. **BLOCKED** — 명세 모호함 / 의존성 미충족 / 외부 도구 실패 / 중대 결정 필요
3. **1000턴 초과** (안전장치)
4. **사용자가 Ctrl+C로 직접 정지**

## 사용자가 ralph에게 절대 안 시켜도 되는 것

- 명세 변경 — `DIVE_SPEC.md`는 사용자만 수정
- ADR 삭제·수정 — 폐기는 새 ADR로
- 변경 불가 결정 (RALPH_PROMPT.md 3단계 박스) 위반

## 트러블슈팅

### codex CLI가 OAuth 인증을 자꾸 요구할 때
- 토큰 만료 가능. `codex auth status`로 확인 후 `codex auth login` 재인증
- macOS는 keychain, Windows는 Credential Manager에 토큰 저장됨

### ralph가 같은 작업을 반복할 때
- `DIVE_NEXT.md`에 `상태: [DONE]`이 빠진 채로 다음 작업이 작성됐을 가능성
- 직접 `DIVE_PROGRESS.md`를 확인해 그 작업이 정말 끝났는지 점검 후 수동으로 NEXT 갱신

### 빌드/테스트가 깨졌는데 ralph가 인지 못 할 때
- RALPH_PROMPT.md의 4단계 (검증) 박스를 codex가 건너뛰고 있을 가능성
- 강제하려면 ralph_run.sh 안에서 매 턴 후 `pnpm typecheck && pnpm tauri:build:x64`를 직접 돌려서 실패 시 자동 [BLOCKED] 처리하도록 추가 가능

### Codex CLI 응답 형식이 바뀌어 ralph가 못 읽을 때
- ChatGPT 구독 codex CLI는 비공식이라 업데이트로 깨질 수 있음
- 명세 §7.4의 OpenAI 차단 위험 노트 참조
- fallback: Anthropic API 키로 전환해 Claude로 ralph 운영도 가능

## 참고 — 첫 작업

`DIVE_NEXT.md`에 첫 작업(1-1: 프로젝트 부트스트랩 + ARM64 빌드 검증)이 이미 작성되어 있습니다. ralph를 처음 실행하면 이 작업부터 시작합니다.
