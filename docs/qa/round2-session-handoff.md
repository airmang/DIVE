# Round-2 (spec 010) — new macOS session handoff

Pick-up brief for a fresh macOS Claude session that will run round-2 with live
computer-use. Canonical plan: [`specs/010-beginner-readiness-ux/spec.md`](../../specs/010-beginner-readiness-ux/spec.md);
evidence: [`round2-audit-findings.md`](round2-audit-findings.md); context also in auto-memory
`project-dive-round2-010`.

## State on resume
- Branch: `010-beginner-readiness-ux` (off rc.5 `4bffb38`). Uncommitted: `specs/010-...`,
  `docs/qa/round2-audit-findings.md`, the neutralized PRD placeholder in `dive/src/i18n/{en,ko}.json`.
- wily project `dive-2` bound. Round-2 stages register as S-041+ (claim→complete with commit evidence).
- Phase: planning done → **next is S-041 implementation** (PRD interview dead-end).
- Order: S-041 → S-048. S-048 (agent web access) is LAST — needs a Constitution Check/ADR
  (network egress = new DIVE-owned capability class) + a security-auditor pass before code.

## Permissions — already set so this session won't be blocked
- `.claude/settings.local.json`: `defaultMode: acceptEdits` + allow-list for build/test/git/
  sqlite/launchctl/open + `mcp__computer-use__*` + `mcp__plugin_wily-client_wily-client__*`.
- **The one unavoidable manual click**: the computer-use server's own `request_access(["DIVE"])`
  consent dialog (and "Finder" if you need the folder picker). Approve once per session.

## DIVE keychain bypass — live (no keychain prompts)
launchd GUI env is set for this login session:
- `DIVE_SECRET_BACKEND=local-file`
- `DIVE_LOCAL_SECRET_PATH=/Users/wilycastle/Library/Application Support/com.coreelab.dive/qa-secrets.json`

If DIVE ever prompts for the keychain (e.g. after a reboot — the LaunchAgent's `$HOME` setenv is
flaky), re-run:
```
launchctl setenv DIVE_SECRET_BACKEND local-file
launchctl setenv DIVE_LOCAL_SECRET_PATH "/Users/wilycastle/Library/Application Support/com.coreelab.dive/qa-secrets.json"
```
Then launch DIVE fresh (only newly-launched apps inherit the env).

## Live-QA launch recipe
```
# 1. build current branch HEAD (after S-041+ land)
cd dive && pnpm build:sidecar && pnpm tauri build --bundles app
# 2. install for LaunchServices + computer-use open_application
cp -R src-tauri/target/release/bundle/macos/DIVE.app /Applications/
# 3. back up app data before live interactions
mkdir -p ../.qa-backups/com.coreelab.dive-$(date +%Y%m%d-%H%M%S) && \
  cp -R ~/Library/Application\ Support/com.coreelab.dive/dive.db* "$_"
# 4. in-session: request_access(["DIVE"]) → open_application "DIVE" → drive (ko + en)
```
Provider for AI scenarios: OpenRouter `claude-sonnet-4.6` (creds in qa-secrets.json, auto-connect).
Clean-state (ONB/first-run) scenarios: back up then remove `dive.db*`, run, restore.
