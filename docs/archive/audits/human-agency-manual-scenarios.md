# DIVE Human Agency Manual Scenario Record

Date: 2026-06-13
Stage: Wily S-010

This record ties the Phase 9 scenarios to concrete product surfaces and automated/manual-proxy checks. A full connected-provider walkthrough was not run in this Codex session; the scenarios below are covered by deterministic rules, component tests, export tests, and the product surfaces named here.

| Scenario | Expected behavior | Verification basis | Result |
| --- | --- | --- | --- |
| Big request: `로그인, 회원가입, 관리자 페이지, 게시판, 결제까지 한번에 만들어줘.` | Oversized scope review card appears; continuing can log risk. | `src/features/provocation/__tests__/rules.test.ts` oversized scope cases. | Pass |
| Vague goal: `화면을 예쁘게 개선해줘.` | Missing acceptance criteria appears near the goal/plan surface, not as normal AI chat advice. | `SocraticInterviewPanel`, `PlanDraftApprovalScreen`, `missing_acceptance_criteria` rule, plan approval component test. | Pass |
| Plan with no verification | Missing verification review card appears before plan approval. | `PlanDraftApprovalScreen.test.tsx` missing-verification card and revision feedback action. | Pass |
| Goal-diff drift: `버튼 문구만 바꿔줘.` with `Button.tsx`, `package.json`, `auth.ts` changed | High-risk drift appears in Step detail; risk approval requires a reason. | `StepDetailSlideIn.test.tsx` expected-vs-actual bundle; `ToolActivity.test.tsx` high-risk reason gate. | Pass |
| AI self-report only | Shows `AI 자가보고만 있음`; no plain verified success label. | `rules.test.ts`, `agencyStatus.test.ts`, Rust IPC export/provenance tests. | Pass |
| Diff opened without tests | Shows `Diff 확인됨` as separate status; does not become `verified_with_evidence`. | `rules.test.ts` diff-only provenance; Rust IPC `diff_reviewed_only_approval_does_not_record_verified_evidence`. | Pass |
| Repeated failure | Recovery choices appear before another AI retry. | `rules.test.ts` regeneration-loop cases; `RecoveryPanel.test.tsx` checkpoint available/unavailable behavior. | Pass |
| Expert mode | Low-risk cards can be hidden; high-risk/self-report/failed states remain visible. | `rules.test.ts` expert-mode filtering cases; `ProvocationCardHost` mode filtering. | Pass |
| Export | Card exposure, diff/risk acceptance, rollback, approval provenance, and agency metadata export through local JSONL without raw code bodies. | `logging.test.ts`, Rust `ipc::tests::` export agency metadata tests. | Pass |

Notes:

- DIVE does not add a standalone Human Agency screen, quiz, score, badge, worksheet, or card deck for these scenarios.
- `Diff 확인됨` is evidence that the diff was opened, not evidence that the app works or tests passed.
- High-risk and unverified approvals preserve reason metadata through the existing EventLog/export path.
