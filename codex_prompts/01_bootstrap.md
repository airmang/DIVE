# 작업 01: 프로젝트 부트스트랩 + ARM64 빌드 검증

## 컨텍스트
DIVE 프로젝트의 첫 작업. 빈 폴더에서 Tauri 2.x + React + TypeScript 보일러플레이트를 만들고 Windows x64·ARM64 양쪽 빌드를 검증합니다. 이 작업이 끝나면 빌드 가능한 빈 데스크톱 앱이 손에 들어옵니다.

## 이번 작업 범위
- Tauri 2.x + React 18 + TypeScript 5 + Vite 보일러플레이트
- 명세 §11.6 디렉터리 구조 (빈 폴더 포함)
- pnpm 워크스페이스, ESLint + Prettier
- Windows x64 + ARM64 NSIS 빌드 모두 성공
- 디자인 토큰·컴포넌트·도메인 로직은 다음 작업에서

## 명세 참조
- DIVE_SPEC.md §11.1 — 기술 스택
- DIVE_SPEC.md §11.3 — Windows x64 + ARM64 빌드
- DIVE_SPEC.md §11.6 — 폴더 구조
- DIVE_SPEC.md §A.1 — 권장 작업 순서

## 단계

1. `dive/` 디렉터리 생성, git 초기화
2. `pnpm create tauri-app dive --template react-ts`
3. 명세 §11.6에 맞춰 디렉터리 구조 정리:
   ```
   src-tauri/src/{agent,dive,providers,tools,mcp,auth,checkpoint,db,ipc}/
   src/components/{workmap,chat,slide-in,permission-card,sidebar}/
   src/{pages,hooks,stores,i18n}/
   ```
   빈 폴더는 `.gitkeep` 또는 `mod.rs`로 채움.
4. `package.json` 스크립트: `dev`, `build`, `tauri:dev`, `tauri:build:x64`, `tauri:build:arm64`, `tauri:build:all`, `lint`, `typecheck`
5. ESLint + Prettier 설정 (TypeScript 권장 룰)
6. `.gitignore` — Tauri/Rust/Node 표준 + `.dive/` 미리 제외
7. `tauri.conf.json` — `productName: "DIVE"`, `identifier: "com.coreelab.dive"`, `version: "0.0.1"`. ARM64는 NSIS 번들만.
8. `rustup target add aarch64-pc-windows-msvc`
9. 양쪽 빌드 시도, README에 명령 + 알려진 제약 기록

## 완료 조건
- [ ] `pnpm install` 에러 0
- [ ] `pnpm tauri:dev`로 데스크톱 창 실행
- [ ] `pnpm tauri:build:x64` NSIS 인스톨러 생성
- [ ] `pnpm tauri:build:arm64` NSIS 인스톨러 생성
- [ ] `pnpm typecheck` 에러 0
- [ ] `pnpm lint` 통과
- [ ] §11.6 디렉터리 모두 존재
- [ ] git 커밋이 conventional commits 형식
- [ ] README에 빌드 명령 문서화

## 확인 질문
- ARM64 빌드에서 의존성 에러 발생 시 — 대체 라이브러리 쓸지, feature flag로 분기할지?
- 코드 서명 인증서 없는 상태 — README에 SmartScreen 경고 안내만 적고 v1.0 정식 배포는 Phase 6에서 다룬다고 명시할지?

## 트러블슈팅 참고
- LNK2019 — VS "C++ ARM64 build tools" 컴포넌트 미설치
- `git2-rs` 빌드 실패 — `features = ["vendored-libgit2"]`
- `openssl-sys` — `rustls`로 대체

## 작업 후
- DIVE_PROGRESS.md의 1-1 항목 `[ ]` → `[x]`, 커밋 해시 기록
- ADR이 필요한 결정이 있었다면 DIVE_DECISIONS.md에 추가
