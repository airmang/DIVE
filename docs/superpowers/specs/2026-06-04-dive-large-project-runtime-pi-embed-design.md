# DIVE large-project runtime Pi embed design

Phase 1 scope: audit and design only. No runtime dependencies, product code, or packaging files were changed.

## 1. 9-capability runtime audit

| Capability | Evidence from code | Current limit | S-005 must change it? |
| --- | --- | --- | --- |
| Decomposition | Cards are DIVE-owned rows created through `card_create_impl` and logged as `card_create` (`dive/src-tauri/src/ipc/workmap.rs:34`, `dive/src-tauri/src/ipc/workmap.rs:46`, `dive/src-tauri/src/ipc/workmap.rs:71`). Workmap snapshots expose cards plus `current_card_id` (`dive/src-tauri/src/ipc/workmap.rs:124`, `dive/src-tauri/src/ipc/workmap.rs:130`). Active workspace-plan step context is loaded by Rust before the turn (`dive/src-tauri/src/ipc/mod.rs:1077`, `dive/src-tauri/src/ipc/mod.rs:1101`). | Decomposition is not an agent-runtime capability today; it is card/workmap state plus optional active step context. There is no Pi-owned task tree or autonomous decomposition loop. | Preserve DIVE ownership. Pi must receive active context but must not become the decomposition authority. |
| Ordering | Backend run-mode floor is derived from accepted-plan state (`dive/src-tauri/src/ipc/mod.rs:894`), then clamped by `safest_run_mode` (`dive/src-tauri/src/ipc/mod.rs:911`). `chat_send` computes effective plan acceptance and active step before building the loop (`dive/src-tauri/src/ipc/mod.rs:940`, `dive/src-tauri/src/ipc/mod.rs:948`, `dive/src-tauri/src/ipc/mod.rs:970`). | Ordering is enforced by card/step selection and run-mode floor, not by a durable agent planner. | Yes. The sidecar must take DIVE's run mode, accepted-plan bit, and active step as inputs and cannot reorder work outside that context. |
| Long-term state | `AgentLoop::load_history` reloads at most 200 message rows (`dive/src-tauri/src/agent/mod.rs:623`, `dive/src-tauri/src/agent/mod.rs:628`). Session CRUD persists DIVE sessions (`dive/src-tauri/src/ipc/session.rs:43`, `dive/src-tauri/src/ipc/session.rs:82`). UI message restore reads up to 500 rows (`dive/src-tauri/src/ipc/mod.rs:1125`, `dive/src-tauri/src/ipc/mod.rs:1128`). | Durable state is DIVE SQLite messages/cards, not a resumable runtime process. Large projects can hit history truncation and have no Pi session handle yet. | Yes in later phases. DIVE remains canonical, but Pi session metadata must be DIVE-owned and resumable only after parity is proven. |
| Artifact preservation | Mutating tool outputs feed `record_changed_files` (`dive/src-tauri/src/agent/mod.rs:383`, `dive/src-tauri/src/agent/mod.rs:681`), which appends paths to the current card and logs `card_changed_files` (`dive/src-tauri/src/agent/mod.rs:698`, `dive/src-tauri/src/agent/mod.rs:700`). Auto checkpoints are created by card transition, not by each tool (`dive/src-tauri/src/ipc/mod.rs:1505`, `dive/src-tauri/src/ipc/mod.rs:1553`, `dive/src-tauri/src/ipc/mod.rs:1557`). | Changed-file evidence is path-based and only for known mutating tools. Checkpoints are card-transition based, so a crash between a mutating tool and a transition can lack a fresh checkpoint. | Yes. Pi-routed DIVE tools must still call the same changed-file and checkpoint paths; do not add Pi-side artifact persistence. |
| Recovery | `chat_send` stores a cancel token per session (`dive/src-tauri/src/ipc/mod.rs:965`, `dive/src-tauri/src/ipc/mod.rs:968`), and `chat_cancel` flips it (`dive/src-tauri/src/ipc/mod.rs:1143`, `dive/src-tauri/src/ipc/mod.rs:1147`). The loop checks cancellation while streaming (`dive/src-tauri/src/agent/mod.rs:656`, `dive/src-tauri/src/agent/mod.rs:664`). Recoverable provider-limit errors mark active steps blocked (`dive/src-tauri/src/ipc/mod.rs:1026`, `dive/src-tauri/src/ipc/mod.rs:1048`). | Recovery covers cancellation and some provider errors. It does not yet handle sidecar crash, partial JSONL messages, or replay boundaries. | Yes. Sidecar cancellation, timeout, crash recovery, and no-replay semantics are required before default flip. |
| Verification loop | Verify uses a forced `verify_result` tool call (`dive/src-tauri/src/dive/verify.rs:142`, `dive/src-tauri/src/dive/verify.rs:148`, `dive/src-tauri/src/dive/verify.rs:155`). It parses the model's judgment (`dive/src-tauri/src/dive/verify.rs:199`, `dive/src-tauri/src/dive/verify.rs:203`) and only grounds in process output when a card has `test_command` (`dive/src-tauri/src/dive/verify.rs:220`, `dive/src-tauri/src/dive/verify.rs:227`, `dive/src-tauri/src/dive/verify.rs:281`). | Without `test_command`, verification is model self-report over instruction and changed files. With a command, it is grounded through DIVE `run_process`. | Preserve in Phase 2/3. Phase 4 should harden evidence, but Pi embed must not weaken this loop. |
| Approval history | Tool calls pass through the permission hook before execution (`dive/src-tauri/src/agent/mod.rs:322`). Approval/denial emits events and logs (`dive/src-tauri/src/agent/mod.rs:325`, `dive/src-tauri/src/agent/mod.rs:409`, `dive/src-tauri/src/agent/mod.rs:413`). Pending approvals are in-memory oneshots (`dive/src-tauri/src/agent/permission.rs:226`, `dive/src-tauri/src/agent/permission.rs:239`, `dive/src-tauri/src/agent/permission.rs:276`). Card approve/reject requires and persists an approval judgment (`dive/src-tauri/src/ipc/mod.rs:1319`, `dive/src-tauri/src/ipc/mod.rs:1366`). | Tool approval history is event-log/message-adjacent, not a normalized durable runtime ledger in the inspected AgentLoop path. Pending approvals disappear on process restart. | Yes. Pi custom tools must synchronously wait on the same DIVE permission hook and log the same approval/denial events. |
| Session resume | DIVE sessions can be created/listed/renamed/archived/deleted (`dive/src-tauri/src/ipc/session.rs:43`, `dive/src-tauri/src/ipc/session.rs:82`, `dive/src-tauri/src/ipc/session.rs:103`, `dive/src-tauri/src/ipc/session.rs:133`). Resume context is reconstructed from message history and workmap state (`dive/src-tauri/src/agent/mod.rs:623`, `dive/src-tauri/src/ipc/workmap.rs:124`, `dive/src-tauri/src/ipc/mod.rs:1125`). | Resume restores DIVE UI/history, but not a live agent process, queued tool call, or external runtime session. | Yes in later phases. Use DIVE sessions as the canonical resume surface; Pi session files must not become student-facing handoff artifacts. |
| Execution | DIVE registers only its eight built-in tools (`dive/src-tauri/src/tools/registry.rs:26`, `dive/src-tauri/src/tools/registry.rs:28`, `dive/src-tauri/src/tools/registry.rs:35`). Tools expose `validate` plus `run` through Rust (`dive/src-tauri/src/tools/mod.rs:88`, `dive/src-tauri/src/tools/mod.rs:97`, `dive/src-tauri/src/tools/mod.rs:100`). `run_process` uses a direct executable and argv under timeout (`dive/src-tauri/src/tools/run_process.rs:80`, `dive/src-tauri/src/tools/run_process.rs:84`). | Execution is bounded by AgentLoop iteration count and `run_process` timeout. The no-shell implementation does not itself prove that shell binaries like `sh` or `bash` cannot be passed as direct executables. | Yes. Pi must expose only DIVE custom tools, and later boundary tests must prove shell bypasses are blocked before model-visible execution. |

## 2. Current hard limits

- AgentLoop iteration cap: `DEFAULT_MAX_ITERATIONS` is `10` (`dive/src-tauri/src/agent/mod.rs:38`), the turn loop runs `for iter in 0..self.max_iterations` (`dive/src-tauri/src/agent/mod.rs:155`), and exhaustion emits `Done { reason: "max_iterations" }` then returns `AgentError::MaxIterations` (`dive/src-tauri/src/agent/mod.rs:431`, `dive/src-tauri/src/agent/mod.rs:440`).
- Provider streaming path: `AgentLoop::stream_assistant` calls `provider.chat` through retry (`dive/src-tauri/src/agent/mod.rs:455`, `dive/src-tauri/src/agent/mod.rs:461`, `dive/src-tauri/src/agent/mod.rs:463`), maps provider `TextDelta` into `AgentEvent::AssistantDelta` (`dive/src-tauri/src/agent/mod.rs:489`, `dive/src-tauri/src/agent/mod.rs:492`, `dive/src-tauri/src/agent/mod.rs:494`), accumulates tool-call start/delta/end (`dive/src-tauri/src/agent/mod.rs:499`, `dive/src-tauri/src/agent/mod.rs:506`, `dive/src-tauri/src/agent/mod.rs:514`), and uses the provider event enum (`dive/src-tauri/src/providers/types.rs:59`, `dive/src-tauri/src/providers/types.rs:63`, `dive/src-tauri/src/providers/types.rs:67`).
- Tool-call persistence model: the loop explicitly inserts user message rows (`dive/src-tauri/src/agent/mod.rs:551`, `dive/src-tauri/src/agent/mod.rs:561`) and assistant message rows with serialized `tool_calls` (`dive/src-tauri/src/agent/mod.rs:578`, `dive/src-tauri/src/agent/mod.rs:586`, `dive/src-tauri/src/agent/mod.rs:595`). Tool results are emitted and event-logged (`dive/src-tauri/src/agent/mod.rs:371`, `dive/src-tauri/src/agent/mod.rs:384`, `dive/src-tauri/src/agent/mod.rs:393`) rather than persisted as separate tool message rows by the inspected AgentLoop path.
- `run_process` timeout and no-shell behavior: schema accepts `command`, `args`, and `timeout_sec` (`dive/src-tauri/src/tools/run_process.rs:8`, `dive/src-tauri/src/tools/run_process.rs:14`); default timeout is 30 seconds and max is 60 seconds (`dive/src-tauri/src/tools/run_process.rs:17`, `dive/src-tauri/src/tools/run_process.rs:18`); validation rejects shell metacharacters (`dive/src-tauri/src/tools/run_process.rs:52`, `dive/src-tauri/src/tools/run_process.rs:117`); execution is `tokio::process::Command::new(command)` plus `.args(...)`, not `sh -c` (`dive/src-tauri/src/tools/run_process.rs:80`, `dive/src-tauri/src/tools/run_process.rs:81`, `dive/src-tauri/src/tools/run_process.rs:84`).
- Run-mode permission behavior: Interview removes all tool definitions before provider dispatch (`dive/src-tauri/src/agent/mod.rs:149`, `dive/src-tauri/src/agent/mod.rs:150`); `AgentRunMode` has Interview, Plan, Build, Verify (`dive/src-tauri/src/agent/permission.rs:41`); Interview/Plan deny mutating or non-safe tools (`dive/src-tauri/src/agent/permission.rs:75`, `dive/src-tauri/src/agent/permission.rs:80`); Build denies mutating tools until plan accepted and active step exist (`dive/src-tauri/src/agent/permission.rs:90`, `dive/src-tauri/src/agent/permission.rs:91`); Verify adds no run-mode denial (`dive/src-tauri/src/agent/permission.rs:99`); the hook delegates to the inner permission hook only after run-mode checks (`dive/src-tauri/src/agent/permission.rs:132`, `dive/src-tauri/src/agent/permission.rs:143`).
- Backend run-mode floor: `backend_run_mode_floor(false)` is Plan and accepted plans allow Build (`dive/src-tauri/src/ipc/mod.rs:894`, `dive/src-tauri/src/ipc/mod.rs:895`), then requested run mode is clamped through `safest_run_mode` (`dive/src-tauri/src/ipc/mod.rs:911`, `dive/src-tauri/src/ipc/mod.rs:950`).
- Checkpoint timing: `card_transition` invokes `card_transition_with_checkpoint_impl` (`dive/src-tauri/src/ipc/mod.rs:1474`, `dive/src-tauri/src/ipc/mod.rs:1483`); the implementation creates an auto checkpoint only after eligible card transitions and an initialized checkpoint dir (`dive/src-tauri/src/ipc/mod.rs:1505`, `dive/src-tauri/src/ipc/mod.rs:1550`, `dive/src-tauri/src/ipc/mod.rs:1555`, `dive/src-tauri/src/ipc/mod.rs:1557`). It is card-transition based, not per mutating tool.
- Verification grounding: `VerifyEngine::verify_card` asks the model for a structured `verify_result` (`dive/src-tauri/src/dive/verify.rs:113`, `dive/src-tauri/src/dive/verify.rs:142`, `dive/src-tauri/src/dive/verify.rs:155`). If a card has no `test_command`, `test_result` comes from parsed model output and can be `skipped` (`dive/src-tauri/src/dive/verify.rs:199`, `dive/src-tauri/src/dive/verify.rs:203`). If `test_command` exists, DIVE runs it via `RunProcess` with a 60 second timeout and overwrites pass/fail from process success (`dive/src-tauri/src/dive/verify.rs:227`, `dive/src-tauri/src/dive/verify.rs:229`, `dive/src-tauri/src/dive/verify.rs:292`, `dive/src-tauri/src/dive/verify.rs:297`).

## 3. Pi SDK surface and package choice

Official references resolved on 2026-06-04:

- Pi SDK docs: https://pi.dev/docs/latest/sdk
- Pi repository: https://github.com/earendil-works/pi

Package choice:

- Use `@earendil-works/pi-coding-agent` as the sidecar SDK package. The docs install and import the SDK from this package, and list `createAgentSession`, `createAgentSessionRuntime`, `AuthStorage`, `ModelRegistry`, `DefaultResourceLoader`, `defineTool`, `SessionManager`, and `SettingsManager` as main exports.
- Do not build Phase 2 directly on `@earendil-works/pi-agent-core`. The docs state that the core `Agent` class comes from `@earendil-works/pi-agent-core`, but is accessed through `session.agent`. Treat it as a lower-level surface for inspection and tests, not the integration entry point.
- `@earendil-works/pi-ai` remains the model/provider package used by `getModel` and model registry lookup. It is not the package that creates coding-agent sessions.

Required SDK surface for the sidecar:

| Surface | Design use |
| --- | --- |
| `createAgentSession` | Create one Pi session per DIVE sidecar runtime/session. The spike should start with `SessionManager.inMemory()` so DIVE remains the only durable state boundary. |
| `defineTool` | Wrap each DIVE tool name as a Pi custom tool. `execute` must not touch the filesystem or spawn processes in Node; it sends a JSONL tool callback to Rust and waits for Rust's result. |
| `customTools` | Register only DIVE-owned custom tools: `read_file`, `list_dir`, `search_files`, `write_file`, `edit_file`, `mkdir`, `delete_file`, `run_process`. |
| `noTools` | Set `noTools: "builtin"` at session creation. This disables Pi default built-ins while still allowing custom tools. Do not use `noTools: "all"` with custom tools unless a spike proves custom tools still register in the needed path. |
| `excludeTools` | Also pass a defense-in-depth denylist for Pi built-ins and likely extension names: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, plus any tool discovered by tests that is not DIVE-owned. |
| Provider registry | For **API-key** providers, drive Pi `AuthStorage`/`ModelRegistry` through runtime overrides (`setRuntimeApiKey`, not persisted) and do not persist Pi `auth.json`/`models.json` as student-facing state. **Exception — Codex/ChatGPT OAuth:** Pi exposes no in-memory/runtime OAuth API (`setRuntimeApiKey` and `"!command"` key resolution are API-key only), so OAuth must use a file-backed, **DIVE-owned** `auth.json` via `AuthStorage.create(diveOwnedPath)` (`0600`, outside the project tree, never a student handoff artifact). Pi auto-refreshes OAuth tokens from that file. Ref: https://pi.dev/docs/latest/providers#auth-file |
| Event stream | Subscribe to `session.subscribe(...)` and map Pi events into DIVE events: `message_update/text_delta` to assistant deltas, thinking deltas to reasoning deltas, `tool_execution_start/update/end` to tool-call start/delta/end, and `agent_start/end` or `turn_start/end` to lifecycle records. |
| Session persistence | Start with `SessionManager.inMemory()`. If later phases need Pi session files, store opaque handles under DIVE-owned app data and never expose Pi session export/import as the student handoff path. |
| Resource discovery | Do not allow default resource discovery. Pi docs say `DefaultResourceLoader` discovers project/global extensions, skills, prompts, context files, settings, credentials, custom models, and sessions. Provide a no-op/custom `ResourceLoader` or explicit overrides so `.pi`, `.agents`, global agent directories, extension factories, prompt templates, skills, and context files cannot add model-visible tools or instructions. |

Session creation shape for Phase 2 spike:

```ts
const { session } = await createAgentSession({
  cwd: diveProjectRoot,
  sessionManager: SessionManager.inMemory(),
  authStorage: diveRuntimeAuthStorage,
  modelRegistry: diveRuntimeModelRegistry,
  model: diveSelectedModel,
  customTools: diveCustomTools,
  noTools: "builtin",
  excludeTools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
  resourceLoader: diveNoopResourceLoader,
  settingsManager: SettingsManager.inMemory({
    compaction: { enabled: false },
  }),
});
```

The `settingsManager` choice is intentionally in-memory for the spike. Compaction, retry, and session persistence can be reopened only after Phase 3 invariants pass.

## 4. Sidecar protocol and packaging

Protocol decision: JSONL over stdin/stdout, with one JSON object per line and Rust-owned IDs. Stderr is diagnostics only and must be redacted. Stdout is protocol only.

Rust-to-sidecar messages:

| Type | Required fields | Behavior |
| --- | --- | --- |
| `hello` | `request_id`, `protocol_version`, `session_id` | Starts or checks the sidecar. The sidecar replies `ready` with package versions and enabled tool names. |
| `session.configure` | `request_id`, `session_id`, `cwd`, `provider_kind`, `model`, `run_mode`, `plan_accepted`, `active_step_id`, `tool_names` | Creates or reconfigures the Pi session with no built-ins and DIVE custom tools only. |
| `turn.prompt` | `request_id`, `turn_id`, `session_id`, `text`, `messages`, `card_id`, `step_context` | Starts one user turn. Rust passes DIVE-owned history/context; sidecar must not read extra project context through Pi discovery. |
| `tool.result` | `request_id`, `turn_id`, `tool_call_id`, `approved`, `success`, `content`, `details`, `error` | Resolves a pending custom-tool `execute` call. The sidecar returns this to Pi as the custom tool result. |
| `turn.cancel` | `request_id`, `turn_id`, `reason` | Calls `session.abort()` and stops emitting turn events. Rust escalates to process kill if the sidecar does not acknowledge within the timeout. |
| `shutdown` | `request_id` | Flushes pending protocol output and exits. |

Sidecar-to-Rust messages:

| Type | Required fields | Behavior |
| --- | --- | --- |
| `ready` | `request_id`, `protocol_version`, `sdk_version`, `enabled_tools` | Rust verifies `enabled_tools` equals the DIVE custom tool set and contains no Pi built-ins. |
| `assistant.delta` | `request_id`, `turn_id`, `delta` | Maps to `AgentEvent::AssistantDelta`. |
| `reasoning.delta` | `request_id`, `turn_id`, `delta` | Maps to DIVE reasoning output. If Pi only exposes thinking deltas, preserve them as reasoning deltas without persisting hidden chain-of-thought beyond current DIVE behavior. |
| `tool_call.start` | `request_id`, `turn_id`, `tool_call_id`, `tool`, `args_preview`, `args` | Rust builds the same permission card preview and logs `tool_call_start`. |
| `tool_call.delta` | `request_id`, `turn_id`, `tool_call_id`, `arguments_delta` | Optional stream of argument text for UI/debug; Rust waits for `tool.execute` before validation. |
| `tool_call.end` | `request_id`, `turn_id`, `tool_call_id` | Marks sidecar-side argument completion. |
| `tool.execute` | `request_id`, `turn_id`, `tool_call_id`, `tool`, `args` | Rust validates the tool through `ToolRegistry`, `Tool::validate`, `RunModePermissionHook`, `PermissionHook`, `ToolContext`, `FsGuard`, and command guard before execution. |
| `turn.done` | `request_id`, `turn_id`, `finish_reason`, `usage` | Rust persists the assistant message and emits `Done`. |
| `error` | `request_id`, `turn_id`, `source`, `message`, `retryable` | Rust logs a redacted runtime/provider/tool error and decides whether to mark the active step blocked. |
| `heartbeat` | `request_id`, `turn_id`, `ts` | Used to detect stalled sidecar output during long model/tool waits. |

Execution boundary:

- Pi custom tools never execute locally in Node. Their `execute` functions are blocking RPC shims back to Rust.
- Rust remains the only executor for filesystem and process actions. `run_process` stays direct-exec plus argv; no shell fallback is introduced for Pi compatibility.
- Rust owns request IDs. The sidecar echoes them and cannot introduce authoritative IDs except Pi tool-call IDs, which Rust treats as untrusted labels until validated.
- Rust remains the source of truth for message persistence, event log rows, changed files, active card, checkpoint labels, and approval state.

Cancellation and timeout:

- `chat_cancel` already flips the Rust cancel token (`dive/src-tauri/src/ipc/mod.rs:1143`, `dive/src-tauri/src/ipc/mod.rs:1147`). The Pi sidecar path must additionally send `turn.cancel`.
- Phase E uses a Pi turn wall-clock budget of 120 seconds. This is the Pi-side execution envelope that replaces the legacy `DEFAULT_MAX_ITERATIONS=10` loop bound for Pi turns; it covers the sidecar's internal multi-tool agentic loop from `run` until `turn_succeeded`.
- The sidecar emits `heartbeat` every 5 seconds during model waits and DIVE tool-result waits. Rust treats a 20-second heartbeat gap during an active turn as a retryable Pi runtime error, kills the sidecar, clears pending approvals for observed tool-call IDs, and marks the active step blocked when a step is in progress.
- Cancellation remains independent of the wall-clock budget and must interrupt a Pi turn mid-flight, including while Rust is parked on a user approval for a sidecar-requested tool.
- Rust enforces a sidecar response timeout for startup, session configure, and tool execution. Tool execution timeout must not exceed the existing DIVE tool timeout envelope without a separate plan change.
- If the sidecar ignores cancellation, Rust kills the sidecar process, logs a retryable runtime error, clears pending approvals, and leaves DIVE persisted state as the recovery point.

Crash recovery:

- Sidecar crash during assistant streaming: emit a retryable `Error`, log `error_occurred`, and keep the existing user message plus any completed assistant/tool evidence already persisted by Rust.
- Sidecar crash while waiting on a DIVE tool: Rust finishes or cancels the Rust-side tool according to current tool semantics, but must not replay a mutating tool automatically after restart.
- Restart creates a fresh sidecar and rehydrates from DIVE message/card/workmap state. Pi session resume can be added later only if DIVE owns the session handle and tests prove no extra tools/resources are loaded.

Redaction:

- Sidecar input can include provider/model identifiers and runtime API key handles, but not raw DIVE keyring secrets unless the selected Pi provider path requires an in-memory runtime override. If raw secrets cross the boundary in Phase 2, they must be process-memory only and redacted from logs.
- Sidecar stderr and Rust logs must pass through DIVE redaction before user-visible or durable storage. Protocol stdout must never include API keys, OAuth tokens, account tokens, or full environment dumps.

Packaging decision:

- Package the sidecar as a compiled standalone executable and list it under Tauri `externalBin` in a later implementation phase.
- Do not require Node on classroom PCs. Current `dive/package.json` has Node scripts for build/test but no Pi sidecar dependencies (`dive/package.json:6`, `dive/package.json:41`), and current `tauri.conf.json` has bundle settings but no sidecar `externalBin` entry (`dive/src-tauri/tauri.conf.json:26`, `dive/src-tauri/tauri.conf.json:53`).
- The implementation phase must add a reproducible build step for Windows x64/arm64 and macOS that compiles the TypeScript sidecar into platform binaries before `tauri build`.
- The sidecar binary is an internal runtime component, not a CLI exposed to students.

## 5. Supervision boundary tests to write later

These are implementation-phase tests. They are not Phase 1 changes.

| Test | Proof required |
| --- | --- |
| Pi built-ins absent | Create a sidecar session with `noTools: "builtin"`, explicit `excludeTools`, DIVE `customTools`, and no-op resource loading. Enumerate `session.agent.state.tools` and sidecar `ready.enabled_tools`; assert exact DIVE tool names only. Reject `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, extension tools, resource-loader tools, and unknown tools. |
| No extension/resource discovery | Seed temporary project/global `.pi`, `.agents`, prompts, skills, settings, and extensions containing tool registrations. Start sidecar with the no-op/custom resource loader. Assert none of those tools/instructions are visible in `session.agent.state.tools`, messages, or prompt expansion. |
| `bash`/`sh` direct executable blocked | Attempt `run_process` through the Pi custom tool path with `command: "bash"` and `command: "sh"` and benign args. The call must be rejected before model-visible execution. Add Windows equivalents (`cmd`, `powershell`, `pwsh`) if Windows packaging is in scope for the same test pass. |
| `run_process` remains no-shell | Attempt shell metacharacters such as `echo hello; rm -rf .`, `curl x | sh`, command substitution, redirects, and newline injection. Assert Rust validation rejects them and no sidecar fallback executes a shell. Also assert valid direct argv execution still works. |
| Permission hooks gate mutation | In Interview, assert no tools are sent to Pi. In Plan, assert `write_file`, `edit_file`, `mkdir`, `delete_file`, and `run_process` are denied. In Build without accepted plan/active step, assert mutation is denied. In Build with accepted plan/active step, assert the normal permission card path is used. |
| Tool execution callback is Rust-owned | For every DIVE custom tool, assert Pi `execute` sends `tool.execute` to Rust and waits for Rust `tool.result`. Add a failing test that tries to execute a custom tool entirely in Node and verify it cannot mutate files or spawn processes. |
| Event mapping parity | Feed synthetic Pi events for text deltas, thinking deltas, tool start/delta/end, tool result, done, and error. Assert DIVE emits the same UI-facing `AgentEvent` sequence currently used by `event.rs`. |
| Checkpoint and changed-file preservation | Run `write_file` or `edit_file` through the sidecar path. Assert `card_changed_files` is logged and the current card changed-files list updates. Assert auto checkpoints are still created on card transition only, matching current timing. |
| Cancellation and crash recovery | Cancel during model streaming and during a pending tool approval. Assert `session.abort()` is called, sidecar process is terminated if needed, pending approvals are cleared, and DIVE persisted state remains recoverable. Kill the sidecar mid-turn and assert no mutating tool is replayed automatically. |
| Provider parity before default flip | For each provider class below, run a minimal prompt plus one custom tool call through the Pi sidecar using DIVE settings. The default runtime cannot flip to Pi for providers that fail parity. |

## 6. Provider parity audit

DIVE provider surface from code:

- The provider module defines adapters for Anthropic, OpenAI, OpenRouter, Codex OAuth, and Custom (`dive/src-tauri/src/providers/mod.rs:3`). Current `ProviderKind` also includes `OpencodeZen` as an OpenAI-compatible local provider class (`dive/src-tauri/src/ipc/provider_runtime.rs:7`, `dive/src-tauri/src/ipc/provider_runtime.rs:14`).
- `build_provider` creates API-key providers for Anthropic (`dive/src-tauri/src/providers/factory.rs:76`), OpenAI/custom OpenAI-compatible (`dive/src-tauri/src/providers/factory.rs:84`), OpenRouter (`dive/src-tauri/src/providers/factory.rs:91`), and Opencode Zen (`dive/src-tauri/src/providers/factory.rs:98`).
- `codex` does not go through the API-key factory. Runtime hydration branches on `row.kind == "codex"`, loads DIVE keyring tokens, decodes account ID, and creates `CodexProvider` (`dive/src-tauri/src/ipc/mod.rs:342`, `dive/src-tauri/src/ipc/mod.rs:344`, `dive/src-tauri/src/ipc/mod.rs:357`, `dive/src-tauri/src/ipc/mod.rs:368`).
- `CodexProvider` uses ChatGPT OAuth tokens plus custom request headers, including `ChatGPT-Account-ID` and `OpenAI-Beta: responses=v1` (`dive/src-tauri/src/providers/codex/mod.rs:1`, `dive/src-tauri/src/providers/codex/mod.rs:94`, `dive/src-tauri/src/providers/codex/mod.rs:99`, `dive/src-tauri/src/providers/codex/mod.rs:100`).
- The Codex OAuth IPC path stores, loads, refreshes, and deletes Codex tokens through DIVE keyring APIs (`dive/src-tauri/src/ipc/codex_oauth.rs:102`, `dive/src-tauri/src/ipc/codex_oauth.rs:185`, `dive/src-tauri/src/ipc/codex_oauth.rs:205`, `dive/src-tauri/src/ipc/codex_oauth.rs:246`).

| DIVE provider | DIVE evidence | Pi support status | Default-flip decision |
| --- | --- | --- | --- |
| Anthropic API key | `build_provider` creates `AnthropicProvider` from API key and optional base URL (`dive/src-tauri/src/providers/factory.rs:76`, `dive/src-tauri/src/providers/factory.rs:79`). | Pi/`pi-ai` has first-class Anthropic model support per prior package audit and SDK model examples. | Likely clear after an in-memory runtime-key smoke test. |
| OpenAI API key | `build_provider` creates `OpenAiProvider` from API key and optional base URL (`dive/src-tauri/src/providers/factory.rs:84`, `dive/src-tauri/src/providers/factory.rs:86`). | Pi/`pi-ai` has first-class OpenAI model support per prior package audit. | Likely clear after an in-memory runtime-key smoke test. |
| OpenRouter | DIVE maps OpenRouter to `OpenAiProvider::openrouter` with `https://openrouter.ai/api/v1` (`dive/src-tauri/src/providers/openai/mod.rs:45`, `dive/src-tauri/src/providers/openai/mod.rs:47`, `dive/src-tauri/src/providers/factory.rs:91`). | Not cleared as first-class Pi provider in this audit. It may work as an OpenAI-compatible custom provider/model. | Block default flip for OpenRouter until a custom provider/model smoke test passes. |
| ChatGPT OAuth / `codex` | DIVE loads keyring tokens and creates `CodexProvider` outside the API-key factory (`dive/src-tauri/src/ipc/mod.rs:342`, `dive/src-tauri/src/ipc/mod.rs:357`). Requests use DIVE's access token and ChatGPT account headers (`dive/src-tauri/src/providers/codex/mod.rs:94`, `dive/src-tauri/src/providers/codex/mod.rs:99`). | **Supported by Pi.** Pi natively offers ChatGPT Plus/Pro (Codex) OAuth via `/login` (officially OpenAI-endorsed), persists it in `~/.pi/agent/auth.json`, and **auto-refreshes** it when expired (https://pi.dev/docs/latest/providers#auth-file). OAuth is **file-based only** — no in-memory/runtime override (`setRuntimeApiKey`/`"!command"` are API-key only). Open items (spike, not impossibility): the OAuth-entry JSON shape in `auth.json` is undocumented, so seeding DIVE's existing keyring token into a **DIVE-owned** `auth.json` (vs. Pi's interactive `/login`) needs verification, and account-id-header parity (`ChatGPT-Account-ID`) is unconfirmed. | **Parity spike required** — seed a DIVE-owned `auth.json` from the keyring token and verify account-id-header behavior. Same class as OpenRouter/custom, **not** a hard blocker. Keep legacy Rust runtime as fallback until the spike passes. |
| Custom OpenAI-compatible | DIVE treats `custom-openai` as `OpenAiProvider` with validated base URL (`dive/src-tauri/src/providers/factory.rs:84`, `dive/src-tauri/src/providers/factory.rs:115`, `dive/src-tauri/src/providers/factory.rs:122`). | Pi SDK docs expose model registry lookup for custom provider/model IDs and runtime API key overrides, but this audit did not prove DIVE-compatible in-memory custom provider construction. | Block default flip for custom providers until an in-memory Pi custom provider/model test passes. |

Resolved Phase 1 decisions:

- Pi package: use `@earendil-works/pi-coding-agent`; use `pi-agent-core` only through `session.agent` for inspection/tests.
- Tool surface: `noTools: "builtin"` plus DIVE-only `customTools`, explicit `excludeTools`, and no extension/resource discovery.
- IPC: JSONL stdin/stdout with Rust-owned request IDs and Rust-owned tool execution.
- Persistence: DIVE SQLite/cards/messages remain canonical. Pi session persistence starts in-memory; any later Pi session handles must be DIVE-owned.
- Packaging: compiled standalone sidecar shipped as Tauri `externalBin`; classroom PCs must not need Node.
- Runtime fallback: keep legacy Rust runtime available. Do not flip providers to Pi unless safety and provider parity tests pass.

Remaining blockers and risks:

- ChatGPT OAuth/Codex parity needs a **spike, not a verdict of impossible**. Pi natively supports Codex OAuth (file-based `auth.json`, auto-refresh — https://pi.dev/docs/latest/providers#auth-file). The real open items are (a) seeding DIVE's existing keyring OAuth token into a **DIVE-owned** `auth.json` — the OAuth-entry shape is undocumented and Pi's own path is interactive `/login` — and (b) account-id-header parity, since DIVE's `CodexProvider` sends `ChatGPT-Account-ID`. Reuse via in-memory/runtime override is unavailable for OAuth (API-key only), so the mechanism is a DIVE-owned `auth.json`, not a runtime key. Keep legacy Rust runtime as fallback until the spike clears these.
- OpenRouter and custom OpenAI-compatible support need explicit Pi custom provider/model tests using in-memory/runtime settings. The "avoid file-backed `auth.json`/`models.json`" rule applies to **API-key** providers; Codex/ChatGPT OAuth is the documented exception that **requires** a DIVE-owned file-backed `auth.json`.
- `run_process` is no-shell, but direct executable names such as `bash` and `sh` need explicit denial tests before Pi can be default.
- Resource discovery is a safety risk. Default Pi discovery can load extensions, skills, prompts, context files, settings, credentials, custom models, and sessions. A no-op/custom loader is required before any model-visible turn.
- Sidecar crash and cancellation semantics are unimplemented. Default flip is blocked until partial-turn, pending-tool, and mutating-tool no-replay behavior is tested.

## Provider parity - resolved 2026-06-08

- Pi SDK `0.78.0` exposes `AuthStorage.prototype.setRuntimeApiKey(provider, key)` and `removeRuntimeApiKey`, so API-key providers use an in-memory runtime override rather than a file-backed auth record.
- `getModel(provider, model)` resolves for `openai`, `anthropic`, `openai-codex`, `openrouter`, and `google`; OpenRouter is first-class, and only `CustomOpenAi` still needs `ModelRegistry.registerProvider` or `registerApiProvider` with the DIVE base URL.
- The current sidecar ignores `message.api_key`; `provider: "openai"` with a bogus key reaches `ready` and then fails with "No API key found for openai", so Phase A wires `setRuntimeApiKey` before model lookup.
- The parity allowlist still expands only after real-key end-to-end smokes. Phase A keeps Codex as the only eligible descriptor while building the shared API-key plumbing for later OpenAI, Anthropic, and OpenRouter rows.
