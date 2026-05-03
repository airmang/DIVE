# DIVE 순차 프롬프트 36개

이 폴더는 ralph 자동화 대신 **사람이 직접 한 작업씩 codex에 입력**해 진행하는 경우를 위한 프롬프트 모음입니다. ralph 운영(`../RALPH_PROMPT.md`)과 동일한 SoT 패턴(SPEC, DECISIONS, PROGRESS, NEXT)을 따르지만, 사람이 직접 다음 단계를 결정합니다.

## 사용 방법

1. **항상 시스템 프롬프트로 다음을 먼저 넣으세요** (한 번 설정 후 모든 작업에 공통):

```
당신은 DIVE 구현을 돕는 코딩 에이전트입니다. 다음 4개 파일이 단일 진실의 원천(SoT)입니다.
- DIVE_SPEC.md — 제품 명세 (변경 금지)
- DIVE_DECISIONS.md — 의사결정 기록 (ADR 누적, 새 결정만 추가)
- DIVE_PROGRESS.md — 작업 체크리스트
- DIVE_NEXT.md — 진행 중 작업 메모

각 작업 시작 전 위 4개 파일을 읽어 컨텍스트를 복원하세요. 명세에 어긋나는 결정은 절대 하지 마세요.

다음 결정은 변경 불가:
- 워크맵은 화면 하단 가로 띠
- 코드는 평소 보이지 않음 (IDE식 풀 패널 X)
- 사용자 호칭 X ("당신"·"학생"·이름 호명 X)
- DIVE 게이트는 백엔드 코드로 강제
- Monaco 에디터 미사용
- 다크 모드 기본
- 파스텔 보라 액센트 #B19CD9 (Claude 오렌지 X)

코드는 작은 커밋 단위, conventional commits 형식, 한국어 사용자 노출 텍스트, 호칭 없음.
```

2. 각 작업은 **이전 작업이 완료된 후에만** 시작합니다. 의존성 미충족 시 codex가 임의 결정을 내릴 수 있습니다.

3. 각 작업 종료 후:
   - 코드는 작은 커밋들로 commit
   - `DIVE_PROGRESS.md`에서 해당 항목 `[ ]` → `[x]`
   - 새 결정은 `DIVE_DECISIONS.md`에 ADR 추가

4. 막히면 멈추세요. 명세 모호함 → 명세 갱신 후 재개.

## 36개 작업 목록

### Phase 1 — 5월 기술 스파이크
- [01](01_bootstrap.md) 프로젝트 부트스트랩 + ARM64 빌드 검증
- [02](02_design_system.md) 디자인 시스템 + 베이스 컴포넌트
- [03](03_sqlite_schema.md) SQLite 스키마 + DAO + 마이그레이션
- [04](04_provider_trait.md) LlmProvider trait + Anthropic·OpenAI 어댑터
- [05](05_keyring_auth.md) Keyring 인증 + 설정 저장
- [06](06_app_shell.md) 메인 셸 레이아웃 (사이드바·채팅·하단 워크맵 빈 컨테이너)

### Phase 2 — 6월 v0.1 코어
- [07](07_workmap_tile.md) 워크맵 카드 타일 + 가로 띠
- [08](08_chat_stream.md) 채팅 영역 + 메시지 스트림
- [09](09_agent_loop.md) Agent Loop + 도구 호출
- [10](10_permission_card.md) 권한 카드 + diff 뷰어
- [11](11_slide_in_panel.md) 슬라이드 인 패널 (코드/미리보기/터미널 탭)
- [12](12_dive_gate_d.md) DIVE 게이트 D 단계 + 시나리오 A 통합 테스트

### Phase 3 — 7월 v0.2 게이트·체크포인트
- [13](13_dive_gate_full.md) DIVE 게이트 I·V·E 전체 + 카드 상태 머신
- [14](14_verify_stage.md) V 단계 — AI 자체검증 + 사용자 최종 승인
- [15](15_checkpoint.md) 체크포인트 (git2-rs)
- [16](16_blocklist.md) 차단 명령 블록리스트 + 경로 제한
- [17](17_openrouter_keys.md) OpenRouter Provisioning Keys (학생 키 분배)
- [18](18_export.md) 익명화 export (JSONL)

### Phase 4 — 8월 초 파일럿 직전
- [19](19_onboarding.md) 온보딩 모달
- [20](20_settings.md) 설정 화면 (프로바이더·자동 승인·테마)
- [21](21_error_handling.md) 에러 처리 + 네트워크 재시도
- [22](22_polish.md) 빈 상태·로딩·토스트 폴리싱
- [23](23_pilot_validation.md) 파일럿 환경 검증 (학교 PC)
- [24](24_manuals.md) 사용자·교사 매뉴얼 + 차시별 시나리오 테스트

### Phase 5 — 10월 v0.3
- [25](25_codex_oauth.md) Codex OAuth (PKCE)
- [26](26_mcp_client.md) MCP 클라이언트 (rmcp)
- [27](27_mcp_permission.md) MCP 도구 권한 카드 통합
- [28](28_prompt_helper.md) 프롬프트 도우미 + 모호함 감지
- [29](29_pre_send_check.md) 보내기 전 점검 + 템플릿 라이브러리
- [30](30_v03_integration.md) v0.3 통합 테스트

### Phase 6 — 11~12월 v1.0 정식
- [31](31_i18n.md) 다국어 (한국어/영어 리소스)
- [32](32_a11y.md) 접근성 (키보드·ARIA·스크린리더)
- [33](33_a11y_polish.md) 접근성 폴리싱 + 색상 대비 검증
- [34](34_packaging.md) NSIS 패키징 (x64 + ARM64)
- [35](35_release.md) GitHub 릴리스 + 라이선스 + README
- [36](36_user_docs.md) 사용자 문서화 (튜토리얼·FAQ·트러블슈팅)
