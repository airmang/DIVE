# Changelog

All notable changes to DIVE are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/lang/ko/).

## [Unreleased]

### Added

- (pending) 사용자 문서화 — 튜토리얼·FAQ·트러블슈팅 (작업 6-6)

## [1.0.0-rc.1] — 2026-05-04

### Added

- **다국어 (ko/en)** — 커스텀 `t()` + Zustand persist · OS 언어 감지 · 사이드바 토글 (작업 6-1, ADR-033)
- **접근성 단축키** — `useGlobalShortcuts` 훅: Ctrl+N/S/E/W/,/ /+ 폼 필드 자동 억제 (작업 6-2, ADR-034)
- **ARIA live region** — 토스트 `role="region"` + `aria-live="polite"` (작업 6-2)
- **WCAG AA 대비 검증** — `verify-contrast.mjs` 런타임 WCAG 계산 (작업 6-3, ADR-035)
- **motion-reduce** — CardStateBadge 스핀 / Radix Dialog / Tooltip에 prefers-reduced-motion 대응 (작업 6-3)
- **NSIS 메타데이터** — category/publisher/copyright/descriptions + WebView2 downloadBootstrapper + `displayLanguageSelector: true` (작업 6-4, ADR-036)
- **MIT License** — `LICENSE` 파일, 리포지토리 루트 (작업 6-5)
- **공개 README** — 설치/기능/연구진/로드맵 요약 (작업 6-5)
- **GitHub Release 워크플로우** — 태그 `v*` 푸시 시 Windows x64/ARM64 아티팩트를 Release draft로 승격 (작업 6-5)

### Changed

- 버전 번호 동기화: `0.0.1` → `1.0.0-rc.1` (`package.json` · `Cargo.toml` · `tauri.conf.json`)
- Link 버튼 variant: `text-accent` → `text-accent-active` (라이트 모드 WCAG AA 충족)

### Fixed

- 라이트 모드 Link 버튼 색상 대비(3.7:1 → 3.4:1 + 밑줄) — UI 구성요소 AA 충족 + 의미 독립

## [0.3.0] — 2026-05-04 (Phase 5 종료)

### Added

- **Codex OAuth (PKCE)** — ChatGPT Plus/Pro 구독 어댑터 + Settings 다이얼로그 (작업 5-1, ADR-027)
- **MCP 클라이언트 기반** — JSON-RPC 2.0 + stdio/HTTP/Mock transport (작업 5-2, ADR-028)
- **MCP 도구 권한 카드** — `mcp__{server}__{tool}` 네임스페이스 + MAX(default, hint) 위험도 (작업 5-3, ADR-029)
- **프롬프트 도우미** — 단계별 템플릿 8개 + 한국어 모호함 감지 5 룰 (작업 5-4, ADR-030)
- **보내기 전 점검** — AI 자체 비평 + 토큰 사용량 즉시 표시 (작업 5-5, ADR-031)
- **v0.3 통합 테스트** — Codex + MCP 결합 end-to-end (작업 5-6, ADR-032)

### Metrics

- Rust: 238 tests / 0 failed / 1 ignored
- Playwright: 23 스위트 / 358 assertions

## [0.2.0] — 2026-04-18 (Phase 4 종료, 파일럿 직전)

### Added

- 온보딩 다이얼로그 + 프로젝트·세션 CRUD + Zustand persist (작업 4-1)
- 설정 화면 + 프로바이더 연결 UI + 익명화 export (작업 4-2)
- 네트워크 재시도 + 토스트 infrastructure (작업 4-3)
- UI 폴리싱 — 스켈레톤 / Restore confirm / Ctrl+S 토스트 (작업 4-4)
- 파일럿 체크리스트 + 벤치마크 템플릿 + Windows 빌드 가이드 + 25명 시뮬레이션 (작업 4-5)
- 학생 · 교사 매뉴얼 + 6 차시 시나리오 (작업 4-6)

## [0.2.0-beta] — 2026-03-22 (Phase 3 종료)

모든 게이트 강제 + 체크포인트 + 안전장치 완료. 차단 명령 블록리스트 · VerifyEngine · AiAssistEngine · 경로 제한 · 프로비저닝 키 UI.

## [0.1.0] — 2026-02-28 (Phase 2 종료)

v0.1 — 워크맵 + 채팅 + 권한 카드 + D 게이트. 메인 시나리오 A 가동.

## [0.0.1] — 2026-02-01 (Phase 1 종료)

기술 스파이크 완료. Tauri 2 + React 18 + TS 5 부트스트랩, LlmProvider trait + Anthropic/OpenAI 어댑터, SQLite 스키마, Windows x64/ARM64 빌드 검증.

---

[Unreleased]: https://github.com/coreelab/dive/compare/v1.0.0-rc.1...HEAD
[1.0.0-rc.1]: https://github.com/coreelab/dive/releases/tag/v1.0.0-rc.1
[0.3.0]: https://github.com/coreelab/dive/releases/tag/v0.3.0
[0.2.0]: https://github.com/coreelab/dive/releases/tag/v0.2.0
[0.2.0-beta]: https://github.com/coreelab/dive/releases/tag/v0.2.0-beta
[0.1.0]: https://github.com/coreelab/dive/releases/tag/v0.1.0
[0.0.1]: https://github.com/coreelab/dive/releases/tag/v0.0.1
