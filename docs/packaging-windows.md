# Windows 패키징 가이드 — DIVE v1.0 NSIS (x64 + ARM64)

이 문서는 **릴리스 관리자**가 DIVE를 NSIS 인스톨러로 패키징해 GitHub Releases에 게시하는 절차를 다룹니다. **학교 현장 배포 가이드**는 [`windows-build-guide.md`](./windows-build-guide.md)를, **학생 설치 매뉴얼**은 [`student-quickstart.md`](./student-quickstart.md)를 참조하세요.

---

## 1. 타겟 매트릭스 (명세 §11.3)

| 아키텍처 | Rust 타겟 | 번들 | 산출물 경로 |
|---|---|---|---|
| x64 | `x86_64-pc-windows-msvc` | NSIS | `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/DIVE_1.0.0-rc.1_x64-setup.exe` |
| ARM64 | `aarch64-pc-windows-msvc` | NSIS | `src-tauri/target/aarch64-pc-windows-msvc/release/bundle/nsis/DIVE_1.0.0-rc.1_arm64-setup.exe` |

**MSI는 ARM64 미지원** — NSIS만 양 아키텍처에서 동작합니다(Tauri 2.x 공식 제약).

## 2. 설정 요점 (`src-tauri/tauri.conf.json`)

v1.0 릴리스 후보 준비를 위해 Phase 6-4에서 다음 필드가 채워졌습니다:

```jsonc
{
  "productName": "DIVE",
  "version": "1.0.0-rc.1",          // SemVer + RC 접미사
  "identifier": "com.coreelab.dive",
  "bundle": {
    "category": "Education",
    "shortDescription": "AI 코딩 교육용 데스크톱 앱 (DIVE 4단계 워크플로우)",
    "longDescription": "DIVE는 바이브 코딩 입문자가 D→I→V→E 4단계 게이트로 AI 코딩 에이전트를 안전하게 사용하도록 안내하는 데스크톱 앱입니다.",
    "copyright": "© 2026 DIVE 연구진 (광교고·토평고·어정중·경인교대). MIT License.",
    "publisher": "DIVE 연구진",
    "homepage": "https://github.com/coreelab/dive",
    "windows": {
      "webviewInstallMode": {
        "type": "downloadBootstrapper",
        "silent": true
      },
      "nsis": {
        "installMode": "currentUser",
        "languages": ["Korean", "English"],
        "displayLanguageSelector": true
      }
    }
  }
}
```

### 필드별 의도

- **`webviewInstallMode: downloadBootstrapper`** — WebView2가 없는 Windows 10 초기 빌드에서 인스톨러가 설치 중 런타임을 자동 다운로드(약 120MB). 최신 Windows 11에는 기본 포함이므로 no-op.
- **`installMode: currentUser`** — 관리자 권한 UAC 팝업 없이 사용자 프로필에 설치. 학교 공용 PC에서 학생 본인 계정에만 영향. (명세 §11.3 + ADR-018 준수)
- **`displayLanguageSelector: true`** — 설치 마법사 시작 시 한국어/영어 선택. v1.0 i18n (작업 6-1) 범위 밖에서 한 번 더 확장.
- **`category: "Education"`** — Windows 앱 카테고리 메타데이터. Microsoft Store 미등록이지만 추후 선택지.

### 버전 번호 동기화 규칙

다음 3곳을 동일 버전으로 유지 (릴리스 스크립트에 포함할 것):

- `dive/package.json` `"version"`
- `dive/src-tauri/Cargo.toml` `[package] version`
- `dive/src-tauri/tauri.conf.json` `"version"`

## 3. 빌드 흐름

### 3.1 로컬 (Windows 11 x64 또는 ARM64)

```powershell
cd dive
pnpm install --frozen-lockfile
pnpm tauri:build:all       # x64 + ARM64 순차
```

**사전 요구사항**: VS 2022 Build Tools + C++ 데스크톱 개발 + ARM64 빌드 도구 + `rustup target add` 2개.

### 3.2 GitHub Actions (권장)

`.github/workflows/build.yml`의 `build-windows` 매트릭스가 `windows-latest`(x64) + `windows-11-arm`(ARM64) 두 러너에서 병렬 빌드 → artifact로 업로드. PR/Push/수동 디스패치 모두 작동.

```
매트릭스:
- windows-x64   → x86_64-pc-windows-msvc
- windows-arm64 → aarch64-pc-windows-msvc
```

**아티팩트 이름**: `DIVE-windows-x64-nsis` / `DIVE-windows-arm64-nsis` (14일 보관).

정식 릴리스 시(태그 `v1.0.0`)에는 별도 릴리스 워크플로우(작업 6-5)가 이 아티팩트를 GitHub Releases 자산으로 승격.

## 4. 코드 서명 현황 — v1.0.0-rc.1 시점 미적용

### 현재 상태

- EV 코드 서명 인증서 **미보유** — 예산·발급 과정(2~4주) 미확보
- Windows SmartScreen이 첫 설치 시 "게시자 확인 불가" 경고 표시 → **추가 정보 → 실행** 2클릭으로 진행
- 학교 현장 배포용 `docs/student-quickstart.md` + `docs/pilot-checklist.md` 에 이 동작을 사전 안내

### v1.0 정식 배포(2026-12) 전 의사결정 필요

| 옵션 | 비용 (연간) | 평판 리드 타임 | 결론 (잠정) |
|---|---|---|---|
| DigiCert EV Code Signing (물리 USB) | ~$400 | 발급 2-4주 / 평판 즉시 | 선호 |
| Sectigo/SSL.com EV | ~$300 | 2-4주 | 차선 |
| 자체 서명(Self-signed) | $0 | 평판 축적 없음 | 거부 — SmartScreen 통과 불가 |
| Microsoft Store 서명 위임 | 무료 (수익 30% 공제) | 스토어 심사 2-3주 | Phase 7 후보 |
| Azure Trusted Signing | ~$10/월 | 신규 구독 심사 수 주 | 유력 후보 (저비용) |

**잠정 결정**: Phase 6-5(릴리스) 시점에 Azure Trusted Signing 가입 + `tauri.conf.json`의 `bundle.windows.signCommand` 추가. 그 전까지는 SmartScreen 우회 안내를 공식 릴리스 노트에 포함.

## 5. WebView2 의존성

Tauri는 Windows에서 Microsoft Edge WebView2 런타임을 요구:

- **Windows 11**: 기본 포함 (자동)
- **Windows 10 22H2+**: 대부분 포함 (예: 교육청 이미지)
- **Windows 10 초기 LTSC·LTSB**: 수동 설치 필요 → 이번 작업에서 `downloadBootstrapper`로 자동 해결

**설치 중 인터넷 없으면**: bootstrapper가 실패 → `installMode`를 `"embedBootstrapper"`로 바꿔 이진 파일에 동봉(설치본 +170MB). 파일럿 학교에서 문제 보고되면 별도 오프라인 인스톨러 빌드 고려.

## 6. NSIS 언어·다국어

`tauri.conf.json`의 `bundle.windows.nsis.languages`에 `["Korean", "English"]` 지정. NSIS 설치 마법사의 **"Next"/"Cancel"** 같은 표준 버튼은 NSIS 공식 번역 사용. 커스텀 메시지(라이선스 텍스트 등)는 향후 별도 `.nsi` 템플릿에 추가 가능(현 시점 기본 템플릿).

`displayLanguageSelector: true`로 설치 시작 시 사용자가 언어 선택. 설치된 앱 자체의 언어는 **별도로** 첫 실행 시 OS 언어 감지 + 사이드바 토글(작업 6-1)로 전환.

## 7. 릴리스 스모크 테스트 (수동)

GitHub Actions artifact 다운로드 후 한 번에 확인:

- [ ] x64 머신에서 x64 인스톨러 실행 → SmartScreen → 추가 정보 → 실행 → 설치 완료
- [ ] ARM64 머신에서 ARM64 인스톨러 실행 동일 절차
- [ ] 앱 실행 시 시작 화면 표시 (§5.1 와이어프레임 참고)
- [ ] 첫 실행 언어 감지 (OS가 ko-KR이면 한국어 UI, 그 외는 영어)
- [ ] Ctrl+N으로 새 프로젝트 다이얼로그
- [ ] 체크포인트 생성 (Ctrl+S) 토스트
- [ ] 제어판 → 앱 제거 → DIVE → 정상 언인스톨
- [ ] 언인스톨 후 `%APPDATA%\dive\` 보존 여부 확인 (설정상 **보존**이 기본 — 사용자 데이터 분리, 명세 §12.6)

## 8. 체크리스트 — 6-5 릴리스 직전

- [ ] 3곳 버전 번호를 정식 `1.0.0`으로 (rc.1 → 1.0.0)
- [ ] `CHANGELOG.md` Phase 6 요약 블록 추가
- [ ] Azure Trusted Signing 구독 + `signCommand` 설정(또는 EV 인증서 도착)
- [ ] GitHub release 태그 `v1.0.0` + draft notes 작성
- [ ] 스모크 테스트 7가지 모두 통과
- [ ] 라이선스(MIT) + README + LICENSE 파일이 리포지토리 루트에 존재
