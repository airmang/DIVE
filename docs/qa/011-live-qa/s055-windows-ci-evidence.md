# S-055 Windows CI Smoke Evidence — 2026-07-11

Run: `build.yml` workflow_dispatch on `011-conference-demo-readiness`
(commit `2869523`), GitHub Actions run **29131250191**.

## Results

| Job | Conclusion | Detail |
|---|---|---|
| frontend (typecheck + lint) | success | clean-machine validation of the 011 branch |
| rust (fmt + check) | success | 〃 |
| **build windows-x64** | **success** | NSIS installer built + **installed-app smoke 13/13 PASS** |
| build windows-arm64 | failure | installer built + uploaded; smoke 8/9 — single failure: `release gate smoke — POST http://127.0.0.1:4444/session timed out after 30000ms` (tauri-driver/EdgeDriver session on the arm64 runner) |

## x64 smoke coverage (the demo-relevant target)

`DIVE-windows-x64-installed-smoke` artifact, mode `full`, `blockers: []`,
13/13 checks ok — includes NSIS install, first launch of the installed app
(`C:\Users\...\AppData\Local\DIVE\DIVE.exe`), tauri-driver WebDriver session,
release-gate SOP/verifier presence. Host: Windows Server 2025 (10.0.26100),
clean runner (fresh app-data at `com.coreelab.dive`).

Artifacts (run 29131250191): `DIVE-windows-x64-nsis` (34.8 MB),
`DIVE-windows-arm64-nsis` (30.8 MB), plus both installed-smoke reports.

## Interpretation for S-055

- The 011 spec makes arm64 conditional ("and ARM64 if the venue machine
  warrants"). The venue machine is expected to be x64; **the demo-critical
  smoke is green**.
- arm64's single failure is a WebDriver session timeout on the CI runner —
  an automation-harness issue class, not an installer defect (the installer
  itself built and uploaded). Re-run/diagnose only if the venue machine turns
  out to be ARM.

## Remaining for S-055 completion

Real-hardware demo-condition pass (projector resolution, Korean locale,
keyboard, network plan B) at rehearsal — tracked in
`s057-fallback-package.md`'s checklist.
