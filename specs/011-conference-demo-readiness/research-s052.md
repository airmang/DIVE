# S-052 Research — False stall-timeout after successful edits (2026-07-10)

Read-only investigation feeding the S-052 design. Hook under scrutiny:
`dive/src/hooks/useChatSession.ts`.

## Mechanism (all refs verified)

- One `setTimeout` per hook instance (`stallTimerRef`, `useChatSession.ts:517`).
  `armStallTimer` (:590-595) arms 45 s; firing calls `appendErrorMessage` with
  `chat.stall_timeout`, `retryable: true`, id `err-${Date.now()}` — **no dedup,
  unstable id**, and the fired callback never nulls the stale handle.
- Arm/clear driver `applyEventSideEffects` (:720-731): only
  `done | error | assistant_end | tool_call_start | tool_call_approved` clear;
  **every other event re-arms**, including `tool_result`, `assistant_delta`,
  `reasoning`, and `agent_progress` heartbeats (Rust throttles heartbeats to
  ~1/5 s, `pi_sidecar.rs:64,865-872`; intended liveness is locked by the test
  at `useChatSession.test.ts:430`).
- **No durable terminal state**: the 5 clear types are momentary; the arm
  decision never consults `isStreaming`/`runStartedAt`; the next straggler
  re-arms. **No run identity**: only `sessionId` exists; a timer armed for run
  N can fire after N ended or during N+1.
- Bonus defect: the `agent_progress` reducer (:1431-1438) flips
  `isStreaming` back to `true` after `assistant_end`/`done` set it false.
- Why exactly twice in QA: single ref ⇒ one pending timer ⇒ two cards require
  fire → re-arm ≥45 s later → fire again; i.e. two separate straggler events
  (throttled heartbeat / second supervised turn) each survived a full 45 s
  after completion. Each fire mints a fresh id ⇒ both cards render.
  Not StrictMode (release build), not double-subscribe (single consumer at
  `useProductShellController.ts:803`).
- Retry surface: `ErrorMessage.tsx` renders a Retry button →
  `retryLastUserMessage` (:848-853) — the report's duplicate-change risk.

## Coverage gap

Only timer test is heartbeat-liveness (+45 s-of-silence fire) at
`useChatSession.test.ts:430-479`. Nothing covers terminal-then-straggler,
duplicate stall cards, or cross-run firing.

## Fix shape (S-052 design input)

Per-run generation counter (`runIdRef`, bumped on `sendUserMessage` and on
genuine new-run starts) + per-run terminal latch. `armStallTimer` captures the
run id; firing no-ops when that run is terminal or the id is stale; terminal
events set the latch so later stragglers cannot re-arm for that run. Extend the
terminal set with `tool_call_denied`/`tool_call_blocked`. Stall error gets a
stable per-run id (`stall-${runId}`) deduped through the message-merge path so
at most one stall card can exist per run. Also fix the `agent_progress` reducer
so stragglers can't flip `isStreaming` back on after terminal.

**Complication a naive fix misses**: a supervised edit is legitimately followed
by a second turn (supervisor/verify pass) on the same channel — the latch must
be keyed per run and reset when a genuine new run starts, or you either leak a
stall from run N into the idle gap or over-suppress a real stall in run N+1.
The existing heartbeat-liveness test behavior (:430) must be preserved for
in-flight runs.

Change surface: `dive/src/hooks/useChatSession.ts` + tests in
`dive/src/hooks/useChatSession.test.ts`.
