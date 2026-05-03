# 작업 34: NSIS 패키징 (x64 + ARM64)

## 컨텍스트
정식 배포용 인스톨러 빌드. Phase 1에서 기본 NSIS 빌드는 검증했지만, 이번 작업은 정식 출시용 — 코드 서명 옵션, 사용자 친화적 인스톨 흐름, 자동 업데이트 준비.

## 이번 작업 범위
- NSIS 인스톨러 옵션 — 설치 경로, 시작 메뉴, 바탕화면 바로가기
- 코드 서명 (사용자가 인증서 보유 시 옵션) — 미보유 시 SmartScreen 안내
- 인스톨러 다국어 (한국어/영어)
- 사용자 권한 — 관리자 권한 없이 설치 가능 (per-user)
- 언인스톨러 — `.dive/` 사용자 데이터 보존 옵션
- 자동 업데이트 준비는 미포함 (v1.1)

## 명세 참조
- DIVE_SPEC.md §11.3 — Windows x64 + ARM64 빌드
- DIVE_SPEC.md §12.6 — 자동 업데이트
- DIVE_SPEC.md §13.8 — 11~12월 v1.0 정식 배포

## 단계

1. **`tauri.conf.json` 인스톨러 설정**:
   ```json
   {
     "bundle": {
       "windows": {
         "nsis": {
           "displayLanguageSelector": true,
           "languages": ["Korean", "English"],
           "installMode": "perUser",
           "installerIcon": "./icons/installer.ico",
           "headerImage": "./icons/header.bmp",
           "sidebarImage": "./icons/sidebar.bmp"
         },
         "wix": null
       }
     }
   }
   ```
2. **인스톨러 아이콘·이미지** — DIVE 로고 기반:
   - `installer.ico` — 256x256 다중 해상도
   - `header.bmp` — 150x57 NSIS 형식
   - `sidebar.bmp` — 164x314 NSIS 형식
3. **다국어 NSIS 메시지** — `installer.ko.nsh`, `installer.en.nsh` 작성:
   - 환영 메시지
   - 라이선스 동의
   - 설치 경로 선택
   - 완료 메시지
4. **언인스톨러**:
   - 기본: 앱 파일만 제거
   - 옵션 체크박스: "사용자 데이터(`.dive/`)도 함께 제거"
   - 로그·설정도 함께 제거 (`%APPDATA%\dive\`)
5. **per-user 설치** — 관리자 권한 불필요:
   - 설치 경로: `%LOCALAPPDATA%\Programs\DIVE\`
   - 학교 PC에서 학생이 직접 설치 가능
6. **빌드 명령**:
   ```bash
   pnpm tauri:build:x64    # x64 NSIS 인스톨러
   pnpm tauri:build:arm64  # ARM64 NSIS 인스톨러
   ```
7. **코드 서명 (옵션)**:
   - `signtool` 통합 — 환경변수 `SIGN_CERT_PATH`, `SIGN_CERT_PASSWORD`
   - 인증서 미보유 시 빌드 스크립트가 경고 후 미서명 빌드 진행
   - README에 SmartScreen 경고 우회 방법 안내 ("자세히 → 무시하고 실행")
8. **빌드 산출물 검증**:
   - 인스톨러 크기 측정 (예상 50~100MB)
   - 깨끗한 Windows VM에서 설치·실행·언인스톨 동작 확인
   - SmartScreen 차단 확인 (미서명 시)
   - WebView2 자동 설치 동작 확인

## 완료 조건
- [ ] x64 NSIS 인스톨러 정상 생성
- [ ] ARM64 NSIS 인스톨러 정상 생성
- [ ] 인스톨러 한국어/영어 선택 가능
- [ ] per-user 설치 (관리자 권한 불필요)
- [ ] 언인스톨 시 데이터 보존 옵션 동작
- [ ] 깨끗한 VM에서 설치·실행·언인스톨 통과
- [ ] WebView2 자동 설치 동작
- [ ] 코드 서명 옵션 환경변수로 동작 (인증서 보유 시)

## 확인 질문
- 코드 서명 인증서 — EV 인증서 (즉시 신뢰) vs OV 인증서 (점진적 평판). 비용·시간 차이 큼. 일단 미서명 + SmartScreen 안내. 인증서 확보 시 추후 적용.
- 자동 업데이트 — Tauri Updater. v1.1로 미루는 게 명세 §12.6. 그대로.
- per-user vs per-machine — 학교 환경에서 IT 담당자가 일괄 설치할 수도. per-machine 옵션도 별도 빌드? 일단 per-user만, 요청 시 추가.
- 인스톨러 다국어 NSIS 메시지 — Tauri 2.x에서 어떻게 지원하는지 검증. NSIS 자체 다국어 + Tauri 통합 부분.

## 작업 후
- DIVE_PROGRESS.md 6-4 `[x]`
- ADR: 코드 서명 인증서 결정, per-machine 빌드 추가 시점
