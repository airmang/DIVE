# 작업 16: 차단 명령 블록리스트 + 경로 제한 + bash 도구

## 컨텍스트
보안 마지막 방어선. 명세 §9.2의 절대 차단 패턴을 구현하고, 파일 시스템 접근을 프로젝트 루트로 제한합니다. bash 도구도 이 작업에서 추가 — 블록리스트와 함께 안전하게.

## 이번 작업 범위
- 차단 명령 블록리스트 (정규식 + AST 매칭)
- 파일 시스템 경로 제한 (FsGuard)
- bash 도구 추가 + 블록리스트 적용
- 블록리스트 위반 시 권한 카드도 표시 안 됨, 시스템 메시지로 알림
- EventLog에 차단 기록

## 명세 참조
- DIVE_SPEC.md §9.1 — 권한 카드 강제
- DIVE_SPEC.md §9.2 — 차단 명령 블록리스트
- DIVE_SPEC.md §9.3 — 파일 시스템 경로 제한
- DIVE_SPEC.md §6.3.1 — bash 도구 위험도

## 단계

1. `src-tauri/src/security/blocklist.rs`:
   - 정규식 패턴 카탈로그 (명세 §9.2 예시 + 추가):
     - `rm -rf /`, `rm -rf /*`, `rm -rf ~`, `rm -rf ~/*`
     - `rmdir /s /q C:\`, `format C:`, `del /f /s /q C:\*`
     - `dd if=* of=/dev/sd?`, `mkfs.*`
     - `curl * | bash`, `curl * | sh`, `wget * -O - | bash`, `iwr * | iex`
     - `sudo *`, `runas *`
   - AST 매칭 — 단순 문자열 우회 방어 (예: `r m -rf /` 스페이스 삽입). bash 파서 또는 휴리스틱.
   - `is_blocked(command: &str) -> Option<String>` — 차단 시 사유 반환
2. `src-tauri/src/tools/builtin/bash.rs` — bash 도구:
   - `tokio::process::Command` 사용
   - 실행 전 블록리스트 검사
   - 실행 시간 제한 (기본 30초, 인자로 변경 가능)
   - stdout/stderr 캡처 → AI에게 반환
   - Tauri event로 슬라이드 인 패널 터미널 탭에 누적
3. `src-tauri/src/security/fs_guard.rs`:
   - `canonicalize`로 절대경로 정규화
   - 프로젝트 루트 외 경로 거부
   - 심볼릭 링크 거부 (canonicalize 후 확인)
   - write_file, edit_file, delete_file, mkdir 모두 FsGuard 통과 후 실행
4. Permission Hook 진입 시 블록리스트·경로 제한 검사:
   - 블록리스트 위반 → 권한 카드 X, 시스템 메시지로 사용자에게 알림
   - 경로 제한 위반 → 권한 카드 X, 시스템 메시지
   - 차단 사유와 시도된 명령을 EventLog에 기록
5. AI에게 차단 사실을 메시지로 전달 — "이 명령은 보안상 실행 불가. 다른 방법을 시도하세요"
6. 단위 테스트:
   - 차단 패턴 매칭 (변형 케이스 포함 — 스페이스, 줄바꿈, 따옴표 우회)
   - 경로 제한 (`../../`, 심볼릭 링크 등)
7. 통합 테스트 — AI에게 위험한 명령 시도시키고 차단 동작 확인

## 완료 조건
- [ ] 명세 §9.2의 모든 패턴이 차단됨
- [ ] 단순 우회 시도(스페이스, 줄바꿈)도 차단
- [ ] 프로젝트 루트 외 write 시도 거부
- [ ] 심볼릭 링크 거부
- [ ] 차단 시 권한 카드 표시 안 됨, 시스템 메시지로 알림
- [ ] EventLog에 차단 시도 기록
- [ ] bash 도구 정상 동작 (안전한 명령은 실행, 위험한 명령은 차단)
- [ ] 시간 초과 시 프로세스 강제 종료
- [ ] 단위 테스트 + 통합 테스트 통과

## 확인 질문
- AST 매칭 라이브러리 — Rust용 bash 파서 (`bash-parser` 등). 단순 정규식만으로 충분한지 vs AST. 둘 다 (정규식 우선, 모호하면 AST). 첫 버전은 정규식만으로도 무방.
- 파워셸 명령 vs cmd 명령 — Windows에서 둘 다 차단해야 함. 패턴에 양쪽 포함.
- 사용자 정의 블록리스트 — 학교/조직별 추가 패턴. 설정 파일로? 일단 하드코딩, 후속 작업에서 설정 가능.
- bash 도구의 작업 디렉터리 — 프로젝트 루트로 고정. AI가 다른 디렉터리 접근 시도 시 거부.
- bash 환경 변수 — 부모 프로세스 환경 그대로 vs 제한된 환경. 제한된 환경 추천 (PATH만 전달, 그 외 화이트리스트).

## 작업 후
- DIVE_PROGRESS.md 3-4 `[x]`
- ADR: 블록리스트 매칭 전략, bash 환경 변수 정책
