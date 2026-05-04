# PHASE 6 완료 핸드오프

Phase 6 PHASE_GATE를 사용자가 승인하여 v1.0 정식 배포 진입 준비가 된 시점의 기준 문서.

---

## 현재 위치 (이 핸드오프 커밋 기준)

- **브랜치**: `main`
- **최종 Phase 6 커밋들**:
  - `(이 커밋)` docs(sot): close task 6-6 and mark [PHASE_GATE] for Phase 6 end
  - `feat(docs): user-guide tutorial + FAQ + troubleshooting + i18n-safe verify scripts (task 6-6)`
  - `494d706` docs(sot): close task 6-5 (release + LICENSE + README + CHANGELOG)
  - `feat(release): MIT LICENSE + public README + CHANGELOG + release.yml workflow (task 6-5)`
  - `e2242fc` docs(sot): close task 6-4 (NSIS packaging + v1.0.0-rc.1)
  - `09f8e1c` feat(bundle): NSIS metadata + WebView2 bootstrapper + v1.0.0-rc.1 version bump (task 6-4)
  - `4b60bb2` docs(sot): close task 6-3 (contrast polish)
  - `feat(a11y): motion-reduce + WCAG contrast polish + verify-contrast runtime check (task 6-3)`
  - `2d144cb` docs(sot): close task 6-2 (a11y shortcuts + ARIA)
  - `feat(a11y): global keyboard shortcuts + aria-live toast region (task 6-2)`
  - `b246153` docs(sot): close task 6-1 (i18n ko/en)
  - `5b71cb6` feat(i18n): add ko/en locale resources + custom t() hook + language switch (task 6-1)
- **Phase 6 상태**: 6-1 ~ 6-6 모두 완료 / Phase 7 미시작
- **Phase 6 종료 시 검증 수치 (Phase 7 회귀 기준선)**:
  - Rust `cargo test --all-targets`: **238 passed / 0 failed / 1 ignored**
  - `cargo fmt --all -- --check` / `cargo clippy --all-targets -- -D warnings`: clean
  - 프론트: `pnpm typecheck` / `pnpm lint --max-warnings 0` / `pnpm format:check` / `pnpm build` 전부 통과
  - Playwright **26 스위트 / 392 assertions** 전부 통과
  - 버전: **1.0.0-rc.1** (3곳 동기화)

---

## Phase 6 산출물 맵

| 영역 | 파일 경로 | 작업 | 핵심 계약 |
|---|---|---|---|
| i18n Core | `dive/src/i18n/index.ts` | 6-1 | `useT()` + `useLocale()` + `useLocaleStore` (Zustand persist) |
| i18n 리소스 | `dive/src/i18n/{ko,en}.json` | 6-1 | ~85 키 (sidebar, stage, card, checkpoint, a11y, keyboard) |
| Sidebar 언어 토글 | `dive/src/components/shell/Sidebar.tsx` | 6-1 | `role="group"` + `aria-pressed` + `data-testid="lang-{ko,en}"` |
| 전역 단축키 | `dive/src/hooks/useGlobalShortcuts.ts` | 6-2 | 6개 단축키 + 폼 필드 자동 억제 |
| Toast live region | `dive/src/components/toast/ToastProvider.tsx` | 6-2 | `role="region"` + `aria-live="polite"` + `aria-atomic="false"` |
| motion-reduce | `CardStateBadge.tsx` · `dialog.tsx` · `tooltip.tsx` | 6-3 | Tailwind `motion-reduce:animate-none` |
| Link 변경 | `dive/src/components/ui/button-variants.ts` | 6-3 | `text-accent` → `text-accent-active` (AA 3:1 + 밑줄) |
| NSIS 메타 | `dive/src-tauri/tauri.conf.json` | 6-4 | category/publisher/copyright/descriptions + webviewInstallMode |
| 릴리스 워크플로우 | `.github/workflows/release.yml` | 6-5 | 3곳 버전 검증 + Windows x64/ARM64 빌드 + CHANGELOG 추출 + Draft Release |
| LICENSE | `LICENSE` | 6-5 | MIT, DIVE 연구진 저작권 2026 |
| 공개 README | `README.md` | 6-5 | 설치/기능/스크린샷/연구진/로드맵 |
| CHANGELOG | `CHANGELOG.md` | 6-5 | Keep a Changelog, v0.0.1 → v1.0.0-rc.1 |
| 사용자 가이드 | `docs/user-guide/{tutorial,faq,troubleshooting,README}.md` | 6-6 | 역할별 읽기 순서 |
| a11y 대비 문서 | `docs/a11y-contrast.md` | 6-3 | 다크/라이트 토큰 대비율 표 + 수동 체크리스트 |
| 패키징 문서 | `docs/packaging-windows.md` | 6-4 | 타겟 매트릭스 + 필드 의도 + 서명 로드맵 + 릴리스 스모크 테스트 |
| Playwright 신규 | `verify-i18n.mjs` · `verify-a11y.mjs` · `verify-contrast.mjs` | 6-1/6-2/6-3 | 34 추가 assertions |

## 새 계약 (Phase 7이 준수해야 함)

- **i18n 키는 `section.snake_case` 패턴 유지**: `sidebar.new_project`, `stage.banner_verified` 등. 평면 구조에 `_`로 동사-목적어. 중첩 3단계 이상 금지.
- **`useT()`의 fallback chain**: 미번역 키는 ko 폴백 → 키 문자열. 테스트가 untranslated key를 탐지 가능해야 함.
- **`useGlobalShortcuts` 확장 시 form-field 억제 여부 고민**: 새 단축키가 폼 안에서도 의미 있는지(Ctrl+S처럼) vs 타이핑 방해인지(Ctrl+N처럼) 분류.
- **버전 동기화**: `package.json` + `Cargo.toml` + `tauri.conf.json` 3곳이 항상 같은 값. 릴리스 워크플로우가 CI에서 자동 검증.
- **CHANGELOG 섹션**: Keep a Changelog 표준 섹션(Added/Changed/Deprecated/Removed/Fixed/Security)만 사용. 릴리스 자동화가 `## [버전]` 헤더로 섹션을 찾음.
- **WCAG AA 대비**: 토큰 변경 시 `verify-contrast.mjs` 추가 케이스 등록. Link 같은 예외는 밑줄 병용 필수.
- **Playwright 스위트 간 locale 격리**: MainShell 기반 스위트는 시작 시 `localStorage`에서 `dive:locale`을 `ko`로 리셋(패턴 확립됨).

---

## Phase 6에서 의도적으로 미룬 항목 (v1.0 또는 v1.1에서 흡수)

- **EV 코드 서명 / Azure Trusted Signing**: v1.0 승격 직전 설정. `docs/packaging-windows.md` §4에 옵션 비교 표.
- **영어 전체 번역**: 현재 Sidebar + MainShell 배너만 i18n. Phase 5 feature들(PromptHelper 템플릿, PromptCheckDialog 문구, Codex OAuth 다이얼로그, MCP 설정 UI)의 하드코딩 한국어는 v1.1에서 i18n 키로 치환. **이유**: 파일럿 대상이 한국 학교 → 한국어 UX 완성도가 영어 대응보다 우선.
- **card-state-meta.ts 라벨 i18n**: 기존 Playwright 테스트가 `label: "대기"` 등의 문자열에 의존. data-* 기반 리팩터 후 번역은 v1.1.
- **macOS / Linux 빌드**: Tauri 가능하지만 QA 부담 + 학교 Windows 우선. v1.1 후보.
- **자동 업데이트 (Tauri Updater)**: v1.1. 현재는 GitHub Releases 수동 다운로드.
- **교사 대시보드**: v2.0 또는 별도 프로젝트. 익명화 export로 현 단계 대체 가능.
- **axe-core 통합**: 자동 a11y rule 검사. 가치 높음이지만 false positive 관리 비용 → v1.1.
- **IME 한글 입력 중 단축키 충돌**: `e.isComposing` 체크 추가 예정, v1.1 해결.
- **토큰 비용 $ 환산**: 프로바이더별 가격 테이블 유지 부담. v1.1 또는 v1.2.

---

## 검증 명령 레퍼런스 (Phase 7 세션 첫 단계에서)

```bash
# Rust 전체
cd dive/src-tauri
cargo test --all-targets                      # 238 passed / 0 failed / 1 ignored 이어야 함
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings

# 프론트 전체
cd dive
pnpm typecheck && pnpm lint --max-warnings 0 && pnpm format:check && pnpm build

# Playwright (dev :1420에서)
pnpm dev   # 한 터미널
for s in workmap chat permission slide-in integration state-machine tool-guard verify-engine \
         checkpoint provisioning export onboarding project-session settings timeline \
         error-toast polish codex-oauth mcp-setup mcp-integration prompt-helper \
         prompt-check phase5-integration i18n a11y contrast; do
  node scripts/verify-$s.mjs || break
done
# 26 스위트 / 392 assertions 전부 통과해야 함
```

---

## 릴리스 실행 순서 (사용자 수동)

Phase 6 PHASE_GATE 통과 후 v1.0 정식 배포:

1. **코드 서명 준비** (선택)
   - Azure Trusted Signing 구독 또는 EV 인증서 발급
   - `dive/src-tauri/tauri.conf.json`에 `bundle.windows.signCommand` 추가
2. **버전 승격**
   - `1.0.0-rc.1` → `1.0.0` (3곳 업데이트 + 커밋)
   - `CHANGELOG.md`에 `## [1.0.0] — <date>` 섹션 추가 (rc.1 블록 승격 또는 합병)
3. **릴리스 태그 푸시**
   ```bash
   git tag v1.0.0
   git push origin main v1.0.0
   ```
4. **GitHub Actions `release.yml` 자동 실행** → 3곳 버전 검증 → x64/ARM64 NSIS 빌드 → CHANGELOG 추출 → Draft Release 생성
5. **수동 검토** → 스모크 테스트 7가지 → GitHub UI에서 **Publish release**
6. **학교 전파** — `docs/student-quickstart.md` + 새 다운로드 링크를 협력 교사에게 전달

---

## 커밋 패턴 (Phase 2~6 계승, v1.0 이후 재검토)

작업당 2 커밋:

1. `feat(<scope>): <짧은 설명> (task N-N)` — 구현 + 테스트
2. `docs(sot): close task N-N (<제목>) and stage task ... [ADR-NNN]` — SoT 4파일 갱신

v1.0 이후 hotfix는 `fix(<scope>): <bug 요약> (v1.0.X)` + `docs(changelog): ...` 2 커밋 제안.

---

**Phase 6 완료. v1.0 정식 배포 진입 대기 중.**
