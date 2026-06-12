# DIVE Agent Guidance

## Product Constraints

DIVE is a supervised AI coding workflow tool for novice users. It is not a quiz app, flashcard app, card deck, badge system, or generic educational worksheet.

When implementing supervision-related features:

- Keep interventions inside the real project workflow: Decompose, Instruct, Execute, Verify, Extend.
- Prefer contextual UI annotations over ordinary chat messages.
- Every warning, review card, or approval prompt must be grounded in concrete project state.
- Do not show generic AI warnings without evidence.
- Do not claim proven improvement in supervision skill, metacognition, critical thinking, or AI overreliance unless backed by empirical data.
- Separate AI self-report from verification evidence.
- Preserve local-first logging and exportability for later research analysis.
- Keep Work Mode low-friction. Add friction only for high-risk or unverified states.
- Guided Mode may show more explanation, but it must still operate on the user's real project.

## Provocation / Review Cards

Use "검토 카드" or "확인 필요 카드" for student-facing Korean UI unless an existing product surface uses different language. Avoid "도발카드" as the main user-facing label.

Review cards must:

- Use deterministic, rule-based triggers first.
- Appear near the relevant artifact: goal, prompt, plan, permission, diff, terminal error, verification gate, or final approval.
- Include evidence explaining why the card appeared.
- Offer short, immediate actions.
- Allow dismiss and mark-irrelevant actions.
- Log exposure and user response through the local EventLog/export path.

Review cards must not:

- Become quizzes, fake practice tasks, scoring, badges, or standalone card decks.
- Be inserted as normal AI chat messages.
- Treat "AI said it is done" as verification.
- Block ordinary low-risk approvals with mandatory long-form reflection.

## Engineering Preferences

- Follow existing Electron/Tauri + React + TypeScript patterns.
- Prefer typed domain models and small adapter seams over broad rewrites.
- Keep trigger logic deterministic and covered by unit tests.
- Use the existing logging/export system where possible.
- Keep feature flags or preferences for supervision surfaces that may need classroom tuning.
