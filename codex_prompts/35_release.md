# 작업 35: GitHub 릴리스 + 라이선스 + README

## 컨텍스트
오픈소스 공개. 명세 §13.8, §14.1에 따른 정식 배포. 라이선스 결정, README 정비, GitHub Releases에 인스톨러 업로드, 의존성 라이선스 호환성 확인.

## 이번 작업 범위
- 라이선스 결정 (MIT 권장)
- 의존성 라이선스 호환성 검토
- README — 사용자용 + 개발자용 분리
- CONTRIBUTING.md, CODE_OF_CONDUCT.md
- GitHub Releases 자동화 (수동도 가능)
- 의존 라이브러리 attribution

## 명세 참조
- DIVE_SPEC.md §14.1 — 라이선스
- DIVE_SPEC.md §13.8 — 11~12월 v1.0 정식 배포

## 단계

1. **라이선스 결정**:
   - MIT 권장 — 가장 자유로운 OSS, 학교·기업 모두 사용 가능
   - 결정 후 ADR 기록
   - `LICENSE` 파일 추가 (MIT 표준 텍스트, Copyright (c) 2026 [고규현 또는 CORE LAB 정보교원 교사연구회])
2. **의존성 라이선스 검토**:
   - `cargo deny` 또는 `cargo-license` — Rust 의존성 라이선스 목록
   - `license-checker` — npm 의존성 라이선스 목록
   - GPL·AGPL 의존성 발견 시 — 대체 또는 분리
   - MIT/Apache-2.0/BSD 호환 라이선스 확인
   - 호환되지 않는 의존성은 제거 또는 격리
3. **README.md** (저장소 루트):
   - 한 문단 소개 — DIVE가 무엇인가
   - 스크린샷 (와이어프레임 또는 실제 화면)
   - 주요 기능 (DIVE 4단계, 권한 카드, 멀티 프로바이더)
   - 다운로드 링크 (GitHub Releases)
   - 빠른 시작 (3~5단계)
   - 시스템 요구사항 (Windows 10·11, x64·ARM64)
   - 라이선스 (MIT)
   - 기여 안내 (CONTRIBUTING.md 링크)
   - 학술 인용 형식 (CORE LAB 연구 산출물)
4. **CONTRIBUTING.md**:
   - 이슈 작성 가이드
   - PR 가이드 — conventional commits, 작은 단위, 테스트 포함
   - 개발 환경 설정 (`pnpm install`, Rust toolchain, ARM64 타겟)
   - 코드 스타일 (ESLint, rustfmt, clippy)
5. **CODE_OF_CONDUCT.md** — Contributor Covenant 표준 텍스트
6. **개발자 README** (`docs/development.md`) — 더 자세한 빌드·테스트·디버깅
7. **GitHub Actions (선택)** — CI 자동화:
   - Push 시 typecheck, lint, test 실행
   - 태그 push 시 양쪽 NSIS 빌드 + GitHub Releases 자동 업로드
   - 코드 서명은 비밀 인증서로 (옵션)
8. **첫 릴리스 준비**:
   - `v1.0.0` 태그
   - 릴리스 노트 — 주요 기능, 알려진 제약, 마이그레이션 안내
   - 인스톨러 첨부 — `DIVE_v1.0.0_x64.exe`, `DIVE_v1.0.0_arm64.exe`
   - SHA-256 체크섬 첨부

## 완료 조건
- [ ] LICENSE 파일 추가 (MIT)
- [ ] 모든 의존성 라이선스 호환 확인
- [ ] README.md 사용자용 작성
- [ ] CONTRIBUTING.md, CODE_OF_CONDUCT.md 작성
- [ ] 개발자 문서 작성
- [ ] GitHub 저장소 공개 (선택)
- [ ] 첫 릴리스 v1.0.0 태그 + 인스톨러 업로드
- [ ] CI 동작 (있을 시)

## 확인 질문
- 저작권 표기 — 고규현 개인 vs CORE LAB 정보교원 교사연구회 vs 광교고등학교. 가장 명확한 형식 선택 필요. 연구비 지원 명시도.
- 학술 인용 형식 — APA·KCI 양쪽? README에 BibTeX 또는 RIS 제공.
- GPL 의존성 처리 — 발견 시 대체 (예: `git2-rs`는 LGPL이지만 vendored libgit2는 BSD).
- 저장소 비공개 → 공개 전환 시점 — v1.0 릴리스 전에 공개? 동시? 동시 추천 (정리된 상태로).
- AGPL 검토 — 명세 §14.1. 상용 클라우드 fork 방지가 필요한 경우만. 현 시점에는 무리.

## 작업 후
- DIVE_PROGRESS.md 6-5 `[x]`
- ADR: 라이선스 최종 결정, 저작권 표기, GitHub Actions 도입 여부
