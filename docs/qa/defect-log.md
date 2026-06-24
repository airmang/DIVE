# DIVE Visual QA — Defect Log

Running log of defects found while driving the **real built `.app`** (rc.4, `/Applications/DIVE.app`) via macOS computer-use. One row per defect. Detailed entries appended below the table as found.

## Severity

| Sev | Meaning |
|-----|---------|
| **P0** | Crash, data loss, blocked critical path, security issue. Fix before any release. |
| **P1** | Important flow broken or visibly wrong; workaround may exist. Fix this cycle. |
| **P2** | Edge case, polish, copy, minor visual/i18n. Fix if cheap; else triage. |

## Status lifecycle

`Open` → `Fixing` → `Fixed (code)` → `Verified (rebuilt+re-run)` · or `Triaged/WontFix` (with reason)

## Index

| ID | Sev | Area | Scenario(s) | Title | Status | Fix ref |
|----|-----|------|-------------|-------|--------|---------|
| DEF-01 | P1 | XC/i18n | PROV-03, XC-02 | Agency-state badge labels (and broader supervised UI) hardcoded Korean — don't localize to English | Open | — |

---

## Details

### DEF-01 — Supervised-UI status labels hardcoded Korean (i18n regression)
- **Severity:** P1 (pervasive, user-visible in English; not function-breaking)
- **Area / Scenario:** XC/i18n · PROV-03, XC-02
- **Build:** rc.4 (HEAD f65a19b)
- **Repro:** 1. Settings → Language → English. 2. Open any project with a plan (e.g. project7). 3. Look at the right PROJECT PLAN step badges and the step-detail supply-chain tags.
- **Expected:** All UI labels render in English.
- **Actual:** Secondary status badges stay Korean: `실행 중` (running), `계획 검토 필요` (plan review needed), `승인 필요`, `변경 확인 필요`, `검증 필요`, `AI 자가보고만 있음`, etc. (the primary `IN PROGRESS`/`BLOCKED` badges DO translate.)
- **Root cause:** `src/features/roadmap/agencyStatus.ts` → `AGENCY_STATE_META` (lines 25–110) hardcodes all 12 `label:` strings in Korean instead of i18n keys. Because the map is a module-level const it never goes through `useT()`/`t()`. Broader scope (same regression class, hardcoded Korean in production code): `src/features/provocation/{rules.ts(126), adapters.ts(36), useProvocationActionResolver.ts(20), verificationStatus.ts(13)}`, `src/components/product/{PlanAddStepPanel.tsx(15), PlanDraftApprovalScreen.tsx(8), ApprovalJudgment.tsx(8), SocraticInterviewPanel.tsx(5), PrdAuthoringBoard.tsx(3)}`, `src/lib/{ambiguity.ts(10), test-command-help.ts(9)}`, `src/features/planning/projectSpec.ts(8)`. (Dev-only demo/showcase pages excluded.)
- **Fix (planned):** change `AGENCY_STATE_META` `label` → `labelKey` (i18n key); resolve via `t(labelKey)` in the consuming badge components; add `agency.*` keys to `i18n/en.json` + `ko.json`. Then sweep the broader files the same way. Verify by re-running PROV-03 in English.
- **Evidence:** screenshot of project7 plan badges in English (실행 중 / 계획 검토 필요 beside IN PROGRESS / BLOCKED).
- **Verified:** _pending fix + rebuild_

