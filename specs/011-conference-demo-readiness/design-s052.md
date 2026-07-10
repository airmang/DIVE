# S-052 Design — Eliminate false stall-timeout after success (011 Theme 3, P1-01)

**Stage**: wily `dive-2` S-052 (STG-4b28ce2dbcd8) · **Status**: Designed 2026-07-10
**Evidence**: `research-s052.md` (mechanism fully traced). Change surface is
`dive/src/hooks/useChatSession.ts` + its test file only.

## Decisions

### D1 — Per-run identity + terminal latch

Introduce run tracking inside the hook: `runIdRef` (monotonic counter) and
`runTerminalRef` (latch for the current run).

- **Run start** (bump `runIdRef`, clear latch): `sendUserMessage` (user-
  initiated turn) and, when the current run is latched terminal, the genuine
  new-activity events `assistant_start` / `tool_call_start` / `user_message`
  (covers backend-initiated supervisor/verify turns arriving on the same
  channel — the complication in the research).
- **Terminal** (set latch): `done`, `error`. (`assistant_end`,
  `tool_call_*` remain in-run clear points, not terminal — a turn continues
  through tool calls.)
- **Arm/clear**: unchanged for in-flight runs (heartbeat liveness stays; the
  locked test at `useChatSession.test.ts:430` must keep passing). But when the
  latch is set, non-run-starting events (`agent_progress`, `tool_result`,
  `reasoning`, telemetry, preview/command results) must NOT re-arm the timer.
- **Fire guard**: the timer callback captures its run id at arm time; on fire
  it no-ops unless the captured id equals the current run id AND that run is
  not latched terminal. This kills both post-success firing and
  cross-run leakage regardless of how many stragglers arrive.
- Add `tool_call_denied` / `tool_call_blocked` to the clear set — a run
  waiting on user action must not accumulate stall time.

### D2 — Straggler must not resurrect streaming state

The `agent_progress` reducer currently flips `isStreaming` back to `true`
after a terminal event (`useChatSession.ts:1431-1438`). Gate it on the
terminal latch: post-terminal progress events update nothing user-visible.

### D3 — Stall error dedupe

The stall message id becomes stable per run (`stall-${runId}`) and is routed
through the existing message-merge/dedupe path so at most one stall card can
ever exist per run. (Today each fire mints `err-${Date.now()}` — the QA saw
two cards.)

## Non-goals / preserve

- Real stall detection stays: 45 s of true silence during an in-flight run
  still surfaces the retryable stall error (existing behavior + test).
- No change to Rust-side event emission or heartbeat throttling
  (`PROGRESS_EVENT_MIN_INTERVAL`), no change to retry semantics beyond the
  dedupe, no change to other error paths.
- `retryLastUserMessage` behavior untouched (duplicate-change risk is
  eliminated at the source by not showing false errors).

## Acceptance mapping → tests (all in `useChatSession.test.ts`)

1. done → straggler `agent_progress`/`tool_result` 45 s+ later → **no error
   card** (the QA scenario).
2. Two stragglers ≥45 s apart → still zero cards (the exactly-twice pattern).
3. Existing in-flight heartbeat-liveness test unchanged and passing; 45 s of
   true silence mid-run still fires exactly one card.
4. New run after a terminal run: latch resets; a genuine stall in run N+1
   fires exactly once with id `stall-${runId}`; a second fire attempt in the
   same run does not add a card.
5. `agent_progress` after `done` leaves `isStreaming === false`.
6. `tool_call_denied`/`tool_call_blocked` clear the timer (no stall while
   waiting on the user).

## Phases

- **P1**: implement D1-D3 + tests above.
- **P2**: local CI + rebuilt release `.app` live re-QA — step edit approve →
  success → observe ≥60 s with zero false errors (report acceptance), stage
  evidence note.
