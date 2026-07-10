# S-051 Design — Provider+Model Pi Executability Preflight (011 Theme 2, P0-02 + P2-02)

**Stage**: wily `dive-2` S-051 (STG-084c9cfdb758) · **Status**: Designed 2026-07-11
**Evidence**: `research-s051.md` — verdict: rc.7 registration gap, not a
regression. The Pi sidecar resolves models against the pinned
`@earendil-works/pi-ai@0.79.10` static registry (tops out at Sonnet 4.6);
DIVE's catalogs/frontend advertise models the sidecar cannot execute,
capability checks are provider-granular, and run-time failure is swallowed.
Blast radius includes the native-Anthropic factory default (`claude-sonnet-5`).

## Decisions

### D1 — The pinned pi-ai registry is the single executability truth

"Can Pi run this model?" is answered ONLY by the registry inside the exact
pi-ai version the bundled sidecar loads. No hand-maintained model list may
reappear anywhere (re-hardcoding is forbidden — rc.7 live-catalog decision
stands). Mechanism: a new sidecar protocol command (`list_models`) wrapping the
package's existing `getProviders()`/`getModels(provider)` exports; Rust
queries it at sidecar handshake and caches the result per sidecar lifetime.
This is local IPC to the sidecar child process — no network egress; S-048
posture untouched.

Rationale for sidecar-command over build-time import: the answer must match
the *running* sidecar's package version exactly; importing a registry snapshot
into Rust at build time can drift from the bundled sidecar.

### D2 — Two enforcement points

1. **Selection surface** (`ProviderModelSelector` + provider config save):
   models from the live catalog are cross-marked against the cached registry —
   executable models get a "Pi 검증됨" group (recommended, default on top);
   non-executable ones are visibly marked `Pi 미지원` and demoted, not hidden
   (the catalog stays honest). Saving a `Pi 미지원` model is allowed only with
   the marking visible (beginner default never lands there). This absorbs
   P2-02's curation ask.
2. **Run preflight** (`select_runtime_at` / `ready_runtime_capability`): the
   capability check gains the model dimension — if the configured
   provider+model pair is not in the cached registry, return a distinct
   unavailable capability state (`model_not_executable`, localized) instead of
   Ready. The existing runtime-unavailable UI surfaces it with a one-click
   "호환 모델로 전환" CTA (switch to the recommended executable model for that
   provider). No silent PRD-screen bounce.

### D3 — Run-time failure stops being swallowed

Even with preflight, a sidecar `model not found` (registry drift mid-session,
future races) must surface: map the sidecar error to the same localized cause +
switch CTA instead of silently returning to the PRD screen (the P0-02
observation). EventLog: log the preflight verdict and any run-time
model-not-found under a deterministic event type so QA can audit occurrences.

### D4 — Fix the shipped breakage + lock the future

- Bump `@earendil-works/pi-ai` to the newest version whose registry resolves
  `claude-sonnet-5` (native + OpenRouter). If no published version has it yet,
  revert the factory defaults (`providers/factory.rs`, `providers/anthropic/`)
  to the newest registry-resolvable ids (Sonnet 4.6) until a bump lands —
  advertised defaults must never exceed the registry.
- **CI gate**: a test asserts every factory default + curated fallback model id
  resolves in the pinned registry, so a catalog/default bump can never ship
  unexecutable again. Mechanism options (implementer's choice, root reviews):
  a node-backed test in the pi-sidecar package asserting
  `getModel(provider, default)` for defaults exported to a shared JSON, or a
  script-generated registry manifest with a freshness check. Either way the
  source of truth remains the package — the manifest, if used, must be
  script-generated with a CI assertion that it matches `node_modules`, never
  hand-edited.

## Non-goals / preserve

- No new hardcoded model catalogs (rc.7 decision).
- OpenRouter live `/models` catalog fetch stays as-is (app-level connectivity,
  outside S-048 egress scope, per prior ruling).
- `accepts_open_catalog_slug` validation stays permissive for *saving* an
  OpenRouter slug (the registry marking/preflight now carries the
  executability truth); no return of restrictive slug allowlists.
- No sidecar protocol changes beyond the additive `list_models` command.
- Provider health_check semantics unchanged.

## Acceptance mapping

1. Pi-unexecutable model is identifiable at selection time (marking/filter) —
   selector test + live QA.
2. Run-time model-not-found surfaces cause + switch CTA; silent PRD bounce
   gone — integration test + live QA.
3. Root cause recorded (research-s051.md; this design) with regression guard:
   the D4 CI gate.
4. Preflight/marking unit tests + local CI green.
5. Live re-QA: selecting a claude-sonnet-5 variant either works (post-bump) or
   is marked `Pi 미지원` with working switch CTA; plan generation succeeds on
   the recommended model.

## Phases

- **P1**: sidecar `list_models` command + Rust handshake cache + capability
  model dimension (`model_not_executable` state).
- **P2**: selector marking/grouping + switch CTA + swallowed-error fix +
  EventLog events + i18n.
- **P3**: pi-ai bump (or default revert) + factory-default CI gate.
- **P4**: local CI + release rebuild + live re-QA (ko), stage evidence.
