# S-051 Research — Why "model not found: openrouter/anthropic/claude-sonnet-5" (2026-07-10)

Read-only root-cause investigation feeding the S-051 design. All refs verified
on branch `011-conference-demo-readiness` @ rc.8.

## Verdict

**Registration gap introduced in rc.7 (`4a97d10`) itself — not a later
regression.** rc.7 advertised Claude Sonnet 5 across DIVE's Rust catalogs and
frontend, but the Pi sidecar resolves models against the **pinned npm package
`@earendil-works/pi-ai@0.79.10`** (`dive/pi-sidecar/package.json:10-11`) whose
static registry tops out at Sonnet 4.6. The two catalogs are wired
independently and nothing cross-checks them before run time. `git log
4a97d10..HEAD` on `pi-sidecar/`, `parity.rs`, `factory.rs` is empty — no
regression window.

## Mechanism

1. **Sidecar resolution**: `dive/pi-sidecar/src/index.mjs:164` calls
   `getModel(provider, modelId)` from `@earendil-works/pi-ai` — a pure lookup
   into a static generated map (`dist/models.js:11-14`, built from
   `models.generated.js` at module load). Miss → throw
   `model not found: ${provider}/${modelId}` (`index.mjs:165-167`). The pinned
   catalog's `openrouter` section ends at `anthropic/claude-sonnet-4.6`; native
   `anthropic` ends at `claude-sonnet-4-6`. No dynamic registration exists;
   the sidecar never calls `getModels`.
2. **rc.7 change surface**: `4a97d10` touched only DIVE Rust catalogs +
   frontend — `providers/anthropic/mod.rs` native default →`claude-sonnet-5`,
   `providers/factory.rs` anthropic default + curated OpenRouter fallback →
   `anthropic/claude-sonnet-5`, and new
   `accepts_open_catalog_slug`/`is_well_formed_openrouter_slug` accepting ANY
   well-formed `vendor/model` slug ("OpenRouter enforces availability at call
   time" — true for OpenRouter's API, false for the sidecar's registry).
   Nothing in `pi-sidecar/` changed.
3. **Why capability says "ready"**: `parity.rs:23-48` is a provider-kind
   allowlist that never sees a model id. `select_runtime_at`
   (`ipc/chat.rs:191-262`) returns Ready on (provider kind allowed) ∧
   (provider config exists); `ready_runtime_capability` (`chat.rs:134-148`)
   echoes `model` as an opaque string. Mismatch surfaces only at run time.
4. **Frontend**: `ProviderModelSelector.tsx:52` → `provider_list_models` →
   live OpenRouter `/models` (rc.7) with static fallback. `ModelInfoDto`
   carries OpenRouter metadata only; **no Pi-executability field exists in the
   data path**.
5. **Preflight surface**: none today. The sidecar protocol
   (`index.mjs:261-298`) handles only `run`/`tool_result`/`turn_cancel`.
   The pinned pi-ai package *does* export `getModels(provider)`/
   `getProviders()` (`models.d.ts:7-8`) — unused. A preflight needs either a
   new sidecar command wrapping those, or importing the pinned registry into
   Rust at build time.

## Namespacing

No one prepends `openrouter/`. `build_run_message` (`pi_sidecar.rs:1020-1027`)
sends `provider:"openrouter"` and `model:"anthropic/claude-sonnet-5"` as
separate fields; the `openrouter/` in the error is the sidecar's
`${provider}/${modelId}` display template. Failing call =
`getModel("openrouter", "anthropic/claude-sonnet-5")`.

## Blast radius (raises S-051 severity)

**Native Anthropic default is broken the same way**: rc.7 set the factory
default and top-of-list to `claude-sonnet-5`, but the pinned registry ends at
`claude-sonnet-4-6` — a fresh native-Anthropic user hits
`model not found: anthropic/claude-sonnet-5` on their **default** model.
(The pinned catalog does contain `claude-fable-5`.) The fix must reconcile
DIVE's advertised catalogs with the sidecar's pinned pi-ai registry — bump and
*track* the package, map DIVE ids to pi-ai-resolvable ids, and/or add a real
preflight against the registry — not just patch the one OpenRouter slug.

## Design inputs for S-051

- Executable-model truth lives in exactly one place today: the pinned pi-ai
  registry. Any "Pi 지원" badge/filter/preflight must derive from it (sidecar
  `getModels` command or build-time import), never from a second hand-kept
  list (re-hardcoding is forbidden per the rc.7 live-catalog decision).
- The save-time/preflight check must cover **both** native and OpenRouter
  paths, and the factory defaults must be validated against the registry in CI
  so a catalog/default bump can never ship unexecutable again.
- Run-time `model not found` must surface as a user-visible cause + "switch to
  a compatible model" CTA instead of the silent PRD-screen bounce
  (report P0-02 observation).
