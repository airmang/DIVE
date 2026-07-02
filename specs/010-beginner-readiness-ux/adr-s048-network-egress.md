# ADR — Amendment: Rust-Validated Network Egress as a DIVE-Owned Capability Class (Principle III)

**Status**: Accepted (2026-07-02 — owner-directed round-2 completion; affected-template review confirmed: plan-template.md updated with the III(1.1.0) egress guidance line, spec-template.md and tasks-template.md reviewed with no change required. Constitution amended to 1.1.0 in the same commit.)
**Constitution version**: 1.0.0 → **1.1.0** (MINOR — materially expanded Principle III guidance / one new tightly-scoped capability class)
**Driver**: Stage **S-048** (spec `specs/010-beginner-readiness-ux/spec.md:157-191`, Theme 8) — supervised agent web access
**Affected principle**: III "Pi Runtime Is The Only Runtime" (constitution.md:54-68); cross-refs II (constitution.md:38-49), IV (constitution.md:73-86), V (constitution.md:88-101), VI (constitution.md:103-116)
**Date**: 2026-07-02

---

## 1. Context — why this ADR exists

S-048 adds a DIVE-owned, model-visible web tool (`web_fetch`) so the supervised agent can retrieve live docs / API responses / web examples during a real build (spec.md:159-168). Constitution III today is the binding fact that governs which actions the model may cause and how they must be validated. The S-048 `plan` cannot pass its mandatory **Constitution Check** (Governance, constitution.md:176-178) without first resolving a scope gap in III, because III's enumerated crossings do **not** include network egress. This ADR is that resolution.

## 2. The current Principle III boundary (verbatim obligations)

Principle III (constitution.md:62-68) requires:

- "Pi built-in tools and resource discovery MUST be disabled. Only DIVE-owned custom tools may be model-visible…"
- "…every **filesystem or process action** MUST cross Rust-owned validation, permission, guard, logging, changed-file, and checkpoint paths before execution."
- "Node-side custom tools MUST NOT mutate files or spawn processes directly, and no shell fallback may be introduced…"

The enumerated crossing set is **{filesystem, process}**. The whole enforcement apparatus in the codebase reflects exactly those two: `FsGuard` + `reject_symlink_components` for filesystem (`tools/guard.rs`), `classify_bash_command` for process (`tools/guard.rs:173`), the `Tool::validate()` pre-flight (`tools/mod.rs:100`), the `PermissionHook` approval gate (`agent/permission.rs`), and checkpoint/changed-file paths. There is **no** network-egress **safety** guard (see §3 for the pre-existing plain-GET hole), no egress permission surface, and no network-unavailable capability state (`RuntimeUnavailableReason`, `db/models.rs:348`, has no network variant).

## 3. Why NETWORK EGRESS is a genuinely new capability class III does not cover — and the pre-existing hole this amendment must also close

Network egress is not a filesystem action and not a process action, so it falls **outside** III's enumerated crossings. It is not merely "another file op." The threat surface is categorically different and none of the existing guards address it:

1. **The confused-deputy / SSRF surface is unique and currently UNGUARDED.** A model steered by a poisoned page, a hostile MCP tool description, or its own hallucination can direct egress at internal/loopback/link-local targets (`169.254.169.254` cloud metadata, the student's own `localhost:5173` Vite/preview dev server from S-031, RFC1918 router/NAS). No filesystem or process rule contemplates "connect to an IP." **Posture correction:** `classify_bash_command` does *not* block plain outbound egress — it blocks only `curl … | bash` pipe-to-shell (guard.rs:107-119) and `curl/wget` upload/POST flags (guard.rs:140). The guard's own test **asserts that `curl -o /tmp/a.bin https://x` is NOT blocked** (guard.rs:498-499). Because `run_process`/`bash` are already-registered `Danger` tools (registry.rs:90-93), **the agent can already perform arbitrary, un-SSRF-guarded outbound GET via the process tool after a single Danger approval.** So this amendment does not "open egress for the first time" — it introduces the *first SSRF-validated* egress path and, per §5, requires the S-048 plan to also decide the fate of the pre-existing plain-`curl`/`wget` GET allowance. It is not accurate to claim `web_fetch` is the "only sanctioned egress" while `curl -o` remains reachable.
2. **DNS/TOCTOU and redirect re-validation have no analog.** Filesystem safety is path-string + symlink checks; egress safety requires validating the **resolved IP after DNS**, pinning the exact connect target (DNS-rebinding defense), and re-validating **every redirect hop** — behaviors with no existing counterpart, and (per the S-048 security audit) ones that are silently defeated by an HTTP client's default redirect/resolve behavior unless implemented as a manual, per-hop-pinned loop.
3. **Bounds semantics differ.** "Max response size / connect+read timeout" (fail-clear, not hang/OOM) is a network concept; the filesystem/process paths have no size-on-the-wire cap, no decompression-bomb surface, and no slowloris surface.
4. **A new failure/capability state is required.** III's "surface as explicit setup or capability states, not silent fallback" (constitution.md:67-68) presently maps only to runtime reasons; network-unavailable/egress-denied/timeout/blocked-target is a new distinct state (spec.md:179-184).

Because III literally enumerates only filesystem/process, silently treating egress as "covered" would be an **unjustified reading**, and Governance (constitution.md:170-178) requires an explicit ADR + rationale + user approval for expanded guidance. Hence this MINOR amendment rather than a plan-level footnote.

## 4. Decision

### Old decision (III, 1.0.0)
Only DIVE-owned tools are model-visible; **filesystem and process** actions must cross Rust-owned validation/permission/guard/logging/changed-file/checkpoint paths; Node-side tools must not mutate files or spawn processes; no shell fallback. (Network egress unaddressed; plain outbound GET reachable via the process tool with no SSRF guard.)

### New decision (III, 1.1.0)
Extend Principle III with one tightly-scoped, default-deny capability class — **Rust-validated network egress** — under the *same discipline*, by adding the following clause:

> **Network egress (added 1.1.0).** DIVE MAY expose exactly one DIVE-owned, model-visible network-egress tool for the supervised agent. Its egress MUST cross Rust-owned **validation (safe-egress guard on the DNS-resolved IP, scheme allowlist, per-hop redirect re-validation, DNS-rebind pinning of the exact validated IP), permission (explicit per-destination allow/deny surface), guard, logging, and bounds (connect timeout, total wall-clock deadline, max on-the-wire response size)** before any byte leaves the machine — the identical crossing discipline required for filesystem/process actions. The same safe-egress policy MUST also govern any outbound network reachable through the process tool: pre-existing plain-`curl`/`wget` GET (guard.rs:498-499) is not exempt from the SSRF denylist and MUST be tightened or filed as a tracked egress-hardening follow-up. Pi built-in web/fetch/resource-discovery tools remain disabled; **Node-side / Pi-side direct egress remains forbidden** — the network syscall MUST originate in Rust. Egress is **default-deny, opt-in per project and per turn**, least-privilege (GET-only and https-by-default unless a project explicitly opts in), and MUST fail to a distinct explicit capability state, never a silent hang. Web-fetched content is **agent input, never verification evidence** (II): it MUST NOT satisfy a criterion or pre-approve a step, and the evidence pipeline's closed `ExecutionEvidenceSource` set MUST NOT gain a web variant. All egress activity MUST be logged local-first and exportable (IV) with secrets/tokens/auth headers, full response bodies, and the URL query string **masked, dropped, or bounded**.

No other principle text changes. II, IV, V, VI are unchanged in wording; this clause explicitly re-binds them to the new class.

## 5. Migration consequence

- **Product**: introduces `web_fetch` (S-048). No existing behavior is removed. The `curl|bash` and upload blocks (guard.rs:107-119, 140) stay, but plain outbound GET via `run_process` (guard.rs:498-499) is currently un-SSRF-guarded; the S-048 plan MUST either (a) extend `classify_bash_command` to route `curl`/`wget` GET targets through the same egress denylist, or (b) explicitly scope S-048 to `web_fetch` only and file the process-tool egress gap as a tracked follow-up. The plan MUST state which. Do not describe `web_fetch` as the "only sanctioned egress" until (a) lands.
- **Code**: adds a `tools::egress_guard` sibling to `classify_bash_command`; a **pinned-IP reqwest client built on a custom DNS resolver with `redirect::Policy::none()` + a manual redirect loop** (the audit shows the default client cannot enforce the pin — see design §Security); a new `web_fetch` tool registered in `ToolRegistry::with_builtins()` (registry.rs:27-41) at `RiskLevel::Danger` (with the paired `expected[]`/`list().len()` registry-test and `params_preview` edits); a new `WebUnavailableReason`; and a documented (default: no-op) `tauri.conf.json` CSP note. Adds a new build dependency (`hickory-dns` reqwest feature, or a hand-rolled `dns::Resolve`) — the pin is inoperable without it (audit C4). No migration of stored data.
- **Research ledger**: new `web_fetch.*` EventLog event types; existing exports remain valid (additive).
- **Reversibility**: the class is opt-in and default-deny; disabling the tool returns behavior to 1.0.0 exactly (modulo the §5(a) process-tool hardening, which is a strict tightening and independently reversible).

## 6. Rationale

Least-privilege and honesty are already the constitution's spine (II/V/VI). Admitting egress as a *named, bounded, Rust-owned* class — rather than smuggling it through the process tool or leaving III silent — keeps the single-runtime, single-validation-boundary property that III exists to protect (constitution.md:70-71), while making the new risk auditable and testable (VI). A MINOR bump is correct: this is materially expanded guidance for an existing principle plus one new capability class, not an incompatible governance/principle redefinition (which would be MAJOR).

## 7. Affected-template review note

Per Governance (constitution.md:170-171), amendments require affected-template review:

- `.specify/templates/plan-template.md` — Constitution Check section: add a line "If the feature performs network egress, cite the III(1.1.0) egress clause and the safe-egress guard/permission/bounds/logging evidence, AND state how pre-existing process-tool egress (guard.rs:498-499) is handled." (guidance-only; no structural change).
- `.specify/templates/spec-template.md` — no change required (network egress is captured by existing "capability/setup state" and "non-goals" prompts).
- `.specify/templates/tasks-template.md` — deterministic-test requirement already covers "runtime boundaries + EventLog"; egress guard tests fall under it. No change required.

Reviewer confirmation that these three templates were reviewed is part of approving this ADR.

## 8. Constitution Check for S-048 (filled in)

| Principle | Check | Verdict |
|---|---|---|
| I. Real Project Workflow Only | `web_fetch` helps the agent do real build work (fetch live docs/data); no quiz/badge/deck theater. | PASS |
| II. Evidence Before Intervention | `web_fetch` returns plain `ToolOutput`; the evidence pipeline is a **closed typed set** — `ExecutionEvidence` is constructed only from `ExecutionEvidenceSource {Preview, ProjectCommand, TerminalScript}` (runtime.rs:96), which has **no web variant**, so a web result *structurally cannot* become evidence. Plan MUST NOT add a web variant. `is_evidence:false` on the output is documentation only; the guarantee rests on the closed enum + a unit test that a `web_fetch` result cannot satisfy a criterion. | PASS (structural) |
| III. Pi Runtime Is The Only Runtime | Egress originates in Rust, crosses validate→permission→guard→bounds→logging; Pi built-in web tools stay off; no Node-side egress; pre-existing process-tool GET hole tightened or tracked per §5. **Requires this 1.1.0 clause** to be in-bounds. | PASS *contingent on this amendment* |
| IV. Local-First Research Ledger | Per-attempt EventLog (host + path only — **full query string dropped, path bounded/hashed**, purpose, decision, resolved IP, status, bytes, elapsed, error class); auth headers/tokens/full bodies masked or bounded before persist; body logged only as a bounded/hashed snippet; exportable. Named keys/params are already redacted (event_log.rs:1420-1434, SECRET_RE branch 2); residual OAuth-style query params (`?code=`, `?sig=`) handled by dropping the query string; path secrets handled by logging host-only-or-hashed-path (audit M2). | PASS |
| V. Low-Friction Guided Supervision | `Danger` tier → always an explicit allow/deny card, but with **web-specific plain-Korean copy** (not the delete/command Danger framing — see design), showing host **+ resolved IP** (the trust anchor, audit H2/M3) and an always-Korean purpose frame; the model-authored purpose is visually subordinate/untrusted; reuse scope disclosed on the card; blocking is grounded in a concrete destination/policy reason. | PASS |
| VI. Typed Seams And Testable Determinism | Typed `EgressDecision`/`EgressBlockReason`/`WebFetchOutput`/`WebUnavailableReason`; the guard (scheme allowlist, resolved-IP denylist incl. IPv6 embeddings, per-hop redirect re-validation, IP-literal normalization, bounds) is deterministic and unit-tested "add a rule ⇒ add a test" like `classify_bash_command`. LLM only *chooses* a URL; validation/dedup/logging are deterministic. The S-048 security audit's C1–C4/H1–H5 findings are encoded as explicit, testable acceptance criteria in the design (not prose). | PASS |

**Result**: S-048 passes the Constitution Check **iff** this amendment (III → 1.1.0) is approved. Absent approval, the egress class is out-of-bounds and implementation is blocked (Governance, constitution.md:176-178).

## 9. Version bump

`**Version**: 1.0.0 → 1.1.0 | Ratified: 2026-06-14 | Last Amended: 2026-07-02`
Sync-Impact note to prepend to constitution.md header: "1.0.0 → 1.1.0 (MINOR): Principle III expanded with a Rust-validated network-egress capability class (S-048), which also binds pre-existing process-tool egress to the safe-egress policy; templates reviewed: plan (updated guidance), spec/tasks (no change)."

## 10. Security-hardening acceptance criteria (from the S-048 adversarial audit)

Approval of this amendment is coupled to the design encoding the adversarial security audit's must-fix findings as **explicit, testable acceptance criteria** (design-s048.md §Security). The load-bearing ones: no built-in redirect following (`Policy::none()` + manual per-hop-pinned loop, audit C1–C3); a custom pinned DNS resolver must actually exist in the build (audit C4 — `hickory-dns`/hand-rolled `dns::Resolve`); fail-closed on any denied resolved IP across all address families; transparent decompression disabled with the cap on wire bytes (audit H1); a hard total wall-clock deadline (audit H3); resolve-and-show-the-IP at approval time with re-resolve-mismatch → block (audit H2); IPv6 6to4/Teredo/zone-id coverage (audit H4); session reuse suppresses the UI prompt only, never the guard (audit M1). These are not optional polish — several bypasses defeat the guard entirely if the implementation detail is wrong.
