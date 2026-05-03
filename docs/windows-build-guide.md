# Windows 빌드 & 설치 가이드 (파일럿 배포용)

개발자 또는 교사용 IT 지원 인력이 학교 PC에 DIVE를 배포하기 위한 단계. 코드 서명 인증서가 아직 없어(Phase 6에서 도입) **SmartScreen 경고**가 나타납니다 — 정상 동작입니다.

---

## 1. 빌드 환경 요구사항

### 빌드 머신 (Windows 11)

- Visual Studio 2022 Build Tools 이상 + **C++ 데스크톱 개발** 워크로드
- ARM64도 빌드하려면 **ARM64 빌드 도구** 컴포넌트 추가
- Rust stable (1.80+), `rustup target add x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc`
- Node.js 22+, pnpm 10+
- Git for Windows

### 빌드 명령

```powershell
cd dive
pnpm install
pnpm tauri:build:x64          # Windows x64 NSIS
pnpm tauri:build:arm64        # Windows ARM64 NSIS (MSI 미지원, NSIS only)
pnpm tauri:build:all          # 둘 다
```

산출물:

- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/dive_0.0.1_x64-setup.exe`
- `src-tauri/target/aarch64-pc-windows-msvc/release/bundle/nsis/dive_0.0.1_arm64-setup.exe`

### CI 빌드 (권장)

로컬 Windows가 없으면 `.github/workflows/build.yml`이 GitHub Actions에서 `windows-latest` + `windows-11-arm` 매트릭스로 빌드. artifact 다운로드 후 그대로 학교 배포.

---

## 2. 학교 PC 설치 (학생당 1회)

### 2.1 인스톨러 실행

1. `dive_0.0.1_x64-setup.exe` 더블클릭 (ARM64 기기면 ARM 인스톨러)
2. **Windows SmartScreen 경고** 표시:
   - "Windows가 PC를 보호했습니다" 화면 → **추가 정보** 클릭 → **실행** 클릭
   - 이는 EV 코드 서명 부재 때문이며, Phase 6에서 해결됩니다.
3. NSIS 설치 마법사:
   - 설치 경로 기본값 그대로 (`C:\Users\{username}\AppData\Local\Programs\dive\`)
   - **모든 사용자용 설치 체크 해제** (학교 공용 계정 방지)
   - "바로가기 생성" 체크
4. 설치 완료 후 바탕화면 아이콘으로 실행

### 2.2 첫 실행 체크

- 앱이 열리면 온보딩 모달 표시
- 프로바이더 선택 → API 키 입력 → 연결하기
- "연결됨" 초록 점 확인 후 모달 닫힘

### 2.3 방화벽 허용 (Windows Defender가 물어봄)

- "전용 네트워크" + "공용 네트워크" 둘 다 체크 → 허용
- 이는 WebView2가 외부 HTTPS 요청을 위해 필요

---

## 3. 대량 배포 (25대 일괄)

### 3.1 USB 배포

1. 인스톨러를 USB에 복사
2. 각 PC에서 USB 마운트 → `.exe` 실행 → SmartScreen 우회 → 설치
3. 교사가 순회하며 SmartScreen 버튼 클릭 지원 (학생 혼자 헷갈릴 수 있음)

### 3.2 네트워크 공유

1. 교실 파일 서버에 `\\school-pc\dive\dive_0.0.1_x64-setup.exe` 배치
2. 각 학생 PC에서 해당 경로로 접속해 실행

### 3.3 Intune / SCCM (IT 팀이 있는 학교)

- MSI가 아닌 NSIS `.exe` 기반이라 silent install은 `dive_0.0.1_x64-setup.exe /S`
- 배포 정책: "per-user install"로 학생 계정에만 설치 → 차시 끝나고 로그아웃 시 지워지지 않음

---

## 4. 설치 이후 검증

각 학생 PC에서:

- [ ] 앱 실행까지 < 5초
- [ ] 온보딩 모달 렌더링 정상 (로고 + 프로바이더 3종 보임)
- [ ] API 키 입력 후 "연결됨" 확인
- [ ] "+ 새 프로젝트" 클릭 → 다이얼로그에 폴더 경로 입력 → 생성 성공
- [ ] 사이드바에 프로젝트 표시
- [ ] "+ 새 세션" 활성화 → 세션 생성 → 채팅 입력창 활성
- [ ] 워크맵에 카드 1개 seed 시 채팅 입력 unblock

문제 발생 시 `docs/pilot-checklist.md` → "비상 대응" 섹션 참조.

---

## 5. 알려진 제약

- **코드 서명 없음** (Phase 6에서 해결)
- **자동 업데이트 없음** — 새 버전은 인스톨러 재배포 방식 (Phase 5 후반에 `tauri-plugin-updater` 검토)
- **오프라인 모드 없음** — LLM 호출은 항상 외부 API 필요 (파일럿 전제)
- **Windows 10 LTSC** WebView2 미포함 — 별도 설치 필요 (학교 PC는 Windows 11 가정)

---

## 6. 프로비저닝 (OpenRouter 자식 키)

§7.5 명세 참조. 교사용 DIVE 앱에서:

1. `?demo=provisioning` 화면 (Phase 4-5에서 설정 화면으로 승격 예정)
2. Main key 입력 → 25개 자식 키 발급 요청
3. Label prefix: `class-mon-1-` 등 (요일·교시 식별자)
4. 1인당 한도: $0.50 권장
5. QR 코드 출력 → 학생에게 배포

자식 키 일괄 폐기는 label prefix 기준 1-click. 예산 소진 실시간 모니터링은 OpenRouter 대시보드(`https://openrouter.ai/usage`).

---

## 개정 이력

- v0.1 (2026-05-04): Phase 4-5 초안. 실제 학교 배포 전.
