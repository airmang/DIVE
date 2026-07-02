# S-048 Design — Supervised agent web access: DIVE-owned `web_fetch` tool + Rust egress guard (Theme 8)

**Status**: Approved (2026-07-02) — Constitution amendment 1.0.0→1.1.0 applied ([adr-s048-network-egress.md](adr-s048-network-egress.md) Accepted); the 8 open decisions below are **locked** per owner-directed round-2 completion: (1) approval reuse = default ask-again + disclosed on-card per-host session opt-in, guard runs every fetch; (2) GET-only; (3) https-only with optional per-project http opt-in; (4) no `connect-src` CSP change; (5) `web_fetch` exposed in Build run mode only; (6) option (b) — S-048 scoped to `web_fetch`, process-tool plain-GET egress gap filed as a tracked follow-up (see Out of scope); (7) bounds confirmed at 3 MiB / connect 5 s / total 25 s / 3 redirects; (8) amendment approved + 3 templates reviewed.
**Stage**: Wily `S-048` (dive-2; register via `design_stage` after owner approval) · **Spec**: [spec.md](spec.md) Theme 8 (spec.md:157-191) · **Branch**: `010-beginner-readiness-ux`
**Models on**: specs/008 runtime-tool boundary (DIVE-owned, Rust-validated, approval, bounded output, logging/export) extended with a network-egress tool. Distinct from the S-031 in-app preview fetch posture.
**Provenance**: authored via a design workflow (5 terrain maps + draft + constitution/beginner-UX lenses) then hardened by a dedicated adversarial **security audit** (findings C1–C4 critical, H1–H5 high, M1–M6 medium) — encoded below as explicit, testable acceptance criteria per the auditor's instruction ("most bypasses are 'the rule is right but the implementation detail defeats it'").

## Problem

Per Constitution III (constitution.md:54-68) Pi built-in tools + resource discovery are disabled and there is **no** DIVE-owned web tool, so the supervised agent cannot fetch live library docs / API responses / web examples a real beginner build needs (spec.md:159-165). Current egress posture precisely: the process tool already permits un-SSRF-guarded plain outbound GET — `classify_bash_command` asserts `curl -o /tmp/a.bin https://x` is **not** blocked (guard.rs:498-499) — so S-048 introduces the *first SSRF-validated* egress path, and the plan must decide whether to also tighten that pre-existing hole (Open decision 6). Separately, provider connectivity is an implicit assumption with **no distinct "network unavailable" state** (`RuntimeUnavailableReason`, `db/models.rs:348`, has none), so a dropped connection can hang a turn silently. Giving a novice-facing agent a live fetch tool opens the single hardest safety problem in this spec — **SSRF via confused deputy**: the model, steered by a poisoned page / hostile MCP tool description / its own hallucination, can be pointed at internal/loopback/link-local targets, cloud metadata (`169.254.169.254`), or the student's own `localhost` dev server and LAN devices (router admin, NAS).

## Decision (constitution-aligned)

Add exactly one DIVE-owned, model-visible tool **`web_fetch`** whose egress originates in **Rust** and crosses validate → permission → guard → bounds → logging before any byte leaves the machine (III, ADR clause 1.1.0). It reuses the real seams: the `Tool` trait (`tools/mod.rs:91`), `Tool::validate()` pre-flight (`tools/mod.rs:100`), `RiskLevel::Danger` (`tools/mod.rs:34`) so it can **never** be policy-auto-approved (`AutoApprovePolicy::decide` returns `None` for `Danger`, `agent/permission.rs:289`), the `PermissionHook`/`PendingApprovals` allow/deny flow, and `event_log.rs` redaction. Default-deny, GET-only, https-by-default, least-privilege. No Pi built-in web tool; no Node-side egress (III). Web content is **agent input, never evidence** (II). **The Danger card, primer, unavailable states, and reuse disclosure get web-specific beginner copy (below); `web_fetch` MUST NOT ship under the existing delete/command Danger framing.**

**Critical implementation reality (audit C4):** `web_fetch` MUST NOT be built on the current default client. `dive/src-tauri/Cargo.toml:28` has `reqwest = { default-features = false, features = ["json","stream","rustls-tls"] }` — **no `hickory-dns`**, so the default client resolves via the system resolver at connect time and *no pinning is possible*. And `tools/runtime.rs:634` `normalize_loopback_url` is the codebase's current URL gate — **pure host-string matching, no resolved-IP check** — which `web_fetch` MUST NOT reuse. The pin story is theater unless a custom resolver is wired.

## Data model (typed contracts — VI)

New typed domain concepts (Rust, `#[derive(Serialize/Deserialize)]`, snake_case tags mirroring `db/models.rs`):

```
// tools/egress_guard.rs
enum EgressScheme { Https, Http }              // Http only if project opt-in
struct EgressTarget { host: String, port: u16, scheme: EgressScheme, purpose: String }
enum EgressBlockReason {                        // sibling of guard::BlockReason
  DisallowedScheme(String), EmbeddedCredentials, NonAbsoluteUrl, ZoneIdInHost,
  NonCanonicalIpLiteral(String), DeniedResolvedIp { host: String, ip: IpAddr, rule: String },
  RedirectToDeniedTarget { hop: u8, ip: IpAddr }, TooManyRedirects, ResolvedIpChangedAtFetch,
  ResponseTooLarge { cap_bytes: u64 }, DeadlineExceeded, NonGetMethodDenied(String), HostNotAllowlisted(String),
}
struct ValidatedTarget { host: String, pinned_ip: IpAddr, port: u16, scheme: EgressScheme }
enum EgressDecision { Allow(ValidatedTarget), Block(EgressBlockReason) }

// web_fetch tool I/O
struct WebFetchInput { url: String, purpose: String }   // method fixed to GET (Open decision 2)
struct WebFetchOutput {                          // -> ToolOutput.full (plain ToolOutput)
  final_url: String, status: u16, content_type: Option<String>,
  body_snippet: String,          // bounded (<= cap), UTF-8 lossy
  truncated: bool, bytes_on_wire: u64,
  is_evidence: false,            // DOCUMENTATION marker only (real guarantee is structural — see II)
}
enum WebUnavailableReason { Offline, EgressDenied, Timeout, BlockedTarget } // NEW (internal, VI)
```

`WebFetchOutput.is_evidence` is documentation only. The **real** II guarantee is structural: a `web_fetch` result is plain `ToolOutput` and there is no `ExecutionEvidenceSource` web variant, so it cannot construct `ExecutionEvidence` at all (runtime.rs:96, confirmed closed).

## Architecture — where it plugs in (reuse the real seam; all coupled edits enumerated)

1. **Tool registration (coupled edits — all four required together, or the build/tests break):**
   - Register `Arc::new(WebFetch::new(client))` in `ToolRegistry::with_builtins()` (`tools/registry.rs:27-41`).
   - Add `("web_fetch", RiskLevel::Danger)` to the `expected[]` list in the `builtins_include_track0_tools_with_expected_risk` test (`tools/registry.rs:82-94`) — keeps the paired `assert_eq!(registry.list().len(), expected.len())` (registry.rs:95) passing.
   - Add a `web_fetch => "url: …"` arm to `params_preview` (`tools/mod.rs:108`).
   - Implement `WebFetch` (impl `Tool`, `tools/mod.rs:91`) with `risk_level() = RiskLevel::Danger`.
2. **Pi sidecar tool path** — `web_fetch` becomes a `ToolDef` via `ToolRegistry::tool_defs()` (`tools/registry.rs:56-65`), so it is the only model-visible web capability; Pi built-in web/discovery stays disabled (III). The model only ever sees the schema + bounded result; the socket is Rust-side.
3. **Run-mode visibility (II/V — Open decision 5):** tools are model-visible only in non-Interview modes (Interview returns empty `tool_defs`, `agent/mod.rs:272-276`). **Recommended: expose `web_fetch` only in `AgentRunMode::Build`** — gate it out of Verify (web content must never influence a verification judgment; II) and out of Plan (reason, don't fetch, while planning). Implement as a run-mode filter on `tool_defs()` for this tool, unit-tested per mode.
4. **Pre-flight guard** — `WebFetch::validate()` (`tools/mod.rs:100`) calls `egress_guard::classify_egress_url(url)` — the deterministic sibling of `classify_bash_command` (`tools/guard.rs:173`) — returning a typed `EgressBlockReason` **before** the permission card, exactly as `validate()` blocks destructive bash even if the student later clicks approve.
5. **Permission** — `Danger` → `AutoApprovePolicy::decide` returns `None` (`agent/permission.rs:289`); `PolicyAwareHook`/`AwaitUserHook` deliver the allow/deny card via `PendingApprovals`; approval resolves through the existing `tool_approve` IPC. `PermissionDecision::approved_with_metadata` (`agent/permission.rs:35`) carries the approved host **+ the validated pinned IP** for the fetch (audit H2). The card uses a **web-specific subtype/copy** (below).
6. **Execution client** — a Rust-only pinned-IP `reqwest` client (§Security) runs the request under bounds; result is bounded/masked and returned as `ToolOutput` (`tools/mod.rs:51`).
7. **Logging** — per attempt, append `web_fetch.*` events via `event_log::append_to_conn` (`dive/event_log.rs:61`), redacted (host only or hashed path, no query string).

## Security threat model + Rust egress guard (the core of S-048)

**Central rule (restated after the audit):** validate on the **DNS-resolved IP**, connect to the **exact validated IP** with **no re-resolution between check and connect at any hop**, and re-run the full cycle on **every redirect hop** using a **manual redirect loop** (never the HTTP client's built-in redirect engine). Keep 100% Rust-side (III). Fail closed.

### Client construction (audit C4 — mandatory, tested)
- Add a custom pinned DNS resolver: enable reqwest `hickory-dns` **or** implement `reqwest::dns::Resolve` by hand; add the dependency to `Cargo.toml`. A build/integration test MUST assert the `web_fetch` client is constructed with the custom resolver and **`redirect::Policy::none()`**, and is NOT the default system-resolver client.
- `web_fetch` MUST NOT reuse `normalize_loopback_url` (`tools/runtime.rs:634`, host-string only) or the `Policy::limited` pattern (`runtime.rs:662`).
- Keep reqwest default TLS verification; **never** `danger_accept_invalid_certs` (audit INFO-3).
- Do **not** enable transparent decompression (`gzip`/`brotli`) on this client; send `Accept-Encoding: identity` (audit H1). GET-only, no arbitrary request headers, no `Referer`/`Origin`/`Cookie`/`Authorization` ever sent (audit M2).

### Guard rules (each = a `classify_egress_url` / connect-time check with a unit test — "add a rule ⇒ add a test")
- **R0 Scheme allowlist (parse first):** allow `https` only; `http` opt-in per-project (Open decision 3), still subject to every IP rule. HARD-BLOCK `file:/ftp:/gopher:/data:/dict:/ws:/wss:/blob:/jar:/ldap:/tftp:/ssh:/smb:` and anything not http(s). Reject embedded creds (`user:pass@host`) and non-absolute URLs.
- **R1 Host normalization + literal rejection (audit M6, H4):** extract the **raw host token** and reject *before* trusting URL-crate canonicalization: reject any host that is all-digits (`2130706433`), contains `0x`, has leading-zero octets (`0177.0.0.1`), or fewer than 4 dotted octets while numeric (`127.1`). Reject any host containing `%` (IPv6 zone id, e.g. `fe80::1%eth0` — audit H4). Parse IP literals **only** via `IpAddr::from_str` on the canonical form. **If the host is an IP literal, run it straight through R3 — do NOT hand it to the DNS resolver** (reqwest connects to numeric hosts *without* invoking the custom resolver — Vaultwarden GHSA-72vh-x5jq-m82g). **Universal embedded-v4 canonicalization:** map every IPv6 literal to its embedded v4 for IPv4-mapped `::ffff:0:0/96`, IPv4-compat `::/96`, NAT64 `64:ff9b::/96`, **6to4 `2002::/16`**, and **Teredo `2001::/32`** (audit H4), and re-apply the full R3 v4 denylist to the decoded address.
- **R2 DNS resolve + pin (audit C1/C3):** resolve **once** via the custom resolver; collect all A+AAAA; validate **every** IP against R3; **if ANY is denied → BLOCK the whole request** (fail-closed on mixed answers — do NOT filter down to the "good" ones, audit C3/INFO-4). Then select exactly **one** validated IP and connect only to that single pinned IP via `resolve_to_addrs(host, &[that_one_ip])` — never pin the whole set (Happy-Eyeballs could open the denied family). The OS never re-resolves.
- **R3 Resolved-IP denylist (on the pinned IP, re-checked at connect):** BLOCK IPv4 `0.0.0.0/8, 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16` (incl. `169.254.169.254`), `100.64/10` (CGNAT), `192.0.0/24, 192.0.2/24, 198.51.100/24, 203.0.113/24` (TEST-NET), `198.18/15, 224/4, 240/4, 255.255.255.255/32`. BLOCK IPv6 `::1/128, ::/128, fe80::/10, fc00::/7, ff00::/8, 2001:db8::/32, fd00:ec2::254`; plus every embedded-v4 form from R1 re-checked against the v4 list. Use `ipnet` (already transitively present) for tested CIDR matching; supplement `std` `is_loopback/is_private/is_link_local` (std misses CGNAT, IPv4-mapped, NAT64, 6to4, Teredo, `169.254.169.254`).
- **R4 Redirect re-validation — MANUAL LOOP (audit C1/C2, mandatory):** set `redirect::Policy::none()`. On a 3xx, read **only** headers + `Location` (never the body — audit M4), then run R0→R3 on the new URL, select+pin its single validated IP, and issue the next hop as a fresh pinned request. Cap **3** hops. Any denied hop → `RedirectToDeniedTarget` BLOCK. Because it is GET-only with no arbitrary headers, no `Authorization`/`Cookie`/`Referer`/`Origin` is ever carried across hops (audit M2; strictly stronger than "strip on cross-origin"). Never use the client's built-in redirect engine (it connects to the next hop *before* a custom policy callback can reject, and re-resolves — audit C2).
- **R5 Port posture:** IP-gated not port-gated (audit INFO-2); typical 443 (80 iff http opt-in). **Surface non-{80,443} ports on the approval card** (audit INFO-2 → make mandatory, a weak-but-real novice signal).
- **R6 Bounds (audit H1/H3/M4):** `connect_timeout` 5 s; a **hard total wall-clock deadline** of 25 s wrapping the entire fetch-and-stream loop via `tokio::time::timeout` (an idle-read timeout alone does NOT stop slowloris — audit H3); plus an idle-read timeout. **Stream** the body and abort the connection the instant a hard cap of **3 MiB on the wire** is exceeded, regardless of a lying `Content-Length` — **never** `.bytes().await` unbounded; with transparent decompression disabled the wire cap is also the memory cap (audit H1). Optional Content-Type allowlist (`text/*, application/json, application/xml`). Cap concurrent `web_fetch` tasks. Any bound exceeded → typed `WebUnavailableReason` + distinct localized state.

### Approval-vs-fetch consistency (audit H2/M3)
Resolve + R3-validate at **card-build time**, carry the exact `ValidatedTarget.pinned_ip` through approval to the pinned connect, and **display the resolved IP on the card** ("example.com → 93.184.216.34"). If a re-resolve at fetch time (or any redirect hop) yields a different IP than the one approved, `ResolvedIpChangedAtFetch` → **BLOCK and re-prompt**, never silently proceed. The card's **trust anchor is the destination (host + resolved IP)**, rendered prominently; the LLM-authored `purpose` is visually subordinate and labeled agent-claimed/unverified (the model can be steered to write a benign purpose for an internal host — audit M3).

## Permission surface (V — a novice must understand it) + beginner copy

`web_fetch` is `RiskLevel::Danger` so it always hits an explicit allow/deny card, but **MUST NOT reuse the delete/command Danger card**, whose shipped S-045 framing mis-describes a read: the Danger card says "고위험 작업 승인 필요 / 명령 실행이나 삭제처럼 강한 작업" (ko.json:1278-1279) and the S-045 primer teaches "빨강 = 삭제·명령 실행" (ko.json:1288). A web read deletes nothing. **Give `web_fetch` its own web-specific card subtype + copy** (new key group `permission_card.web`), authored verbatim ko+en to the S-045/S-046 bar, no bare `host/egress/target/SSRF` jargon:

| key | ko | en |
|---|---|---|
| `.title` | AI가 인터넷에서 정보를 읽으려고 해요 | The AI wants to read something on the internet |
| `.frame` (always-Korean primary line, NOT model-dependent) | AI가 아래 주소에서 정보를 읽으려고 해요. 허용할지 직접 정하세요. | The AI wants to read from the address below. You decide whether to allow it. |
| `.host_label` | 접속할 주소(웹사이트) | Address (website) it will visit |
| `.ip_label` | 실제 연결되는 위치 | Where it actually connects |
| `.purpose_label` | AI가 적은 이유 (참고용, 확인되지 않음) | Reason the AI gave (for reference, unverified) |
| `.confirm` | 이 주소를 확인했고, AI가 여기서 정보를 읽는 것을 허용합니다 | I checked this address and allow the AI to read from it |
| `.allow` | 이 주소 읽기 허용 | Allow reading this address |
| `.deny` | 허용 안 함 | Don't allow |
| `.reuse_optin` | 이번 작업 동안 이 주소는 다시 묻지 않기 | Don't ask again for this address during this task |

**Model-language safety (II/V — the P2-21/P1-05 class S-045/S-046 fixed):** the primary, always-Korean content is `.frame` + the DIVE-extracted **host + resolved IP**; the raw model `purpose` renders only as clearly-labeled **secondary, unverified** text (styled like S-046's collapsed raw-error `<details>`) — never the sole explanation. A novice must be able to answer "what address + roughly why" from Korean UI chrome alone even if `purpose` is English/code-switched.

**Session-reuse disclosure (V + audit M1):** **Default = ask again every fetch.** Per-host session reuse is an **explicit opt-in** via the `.reuse_optin` checkbox (unchecked by default); when checked, an identical host+purpose skips the **UI prompt** within the session — **but R0–R4 (resolve, IP validation, pinned connect, redirect re-validation) run unconditionally on every fetch** (audit M1: reuse suppresses the card, NEVER the guard; a rebind under a reused grant must still BLOCK). Copy discloses the scope in plain Korean so the student's mental model matches the grant. (Owner may choose always-ask-only — Open decision 1.)

**One-time web-access primer (optional, recommended — mirrors S-045 `PermissionCardPrimer`):** before the first `web_fetch` card, a one-time opt-out primer (reuse `tutorialEnabled` + persisted-dismissed flag; no new EventLog IPC), key group `permission_card.web_primer`:

| key | ko |
|---|---|
| `.title` | AI가 인터넷을 찾아볼 수 있어요 |
| `.body` | 이제 AI가 필요한 정보를 인터넷에서 직접 찾아볼 수 있어요. 어떤 주소에 접속할지는 그때그때 당신이 허용해요. 안전하지 않은 주소는 DIVE가 미리 막아요. |
| `.dismiss` | 알겠어요 |

## Bounds (fail clearly)

Connect 5 s; **hard total deadline 25 s** (wall-clock, wraps streaming — audit H3); idle-read timeout; max response **3 MiB** streamed with on-the-wire abort + decompression disabled (audit H1); max **3** redirects, no body read on 3xx (audit M4); optional Content-Type allowlist; concurrent-fetch cap. Every exceeded bound → a typed `WebUnavailableReason` + localized copy, never a silent hang or OOM.

## Logging (IV) + EventLog export — precise redaction (audit M2/M3/L2)

Named object keys/params `authorization/token/apikey/secret/password` are **already** redacted (`is_sensitive_key`, event_log.rs:1420-1434; `SECRET_RE` branch 2 already catches `?api_key=`/`?token=`). Do **not** re-add that. Residual gaps + rules:
- **Drop the entire query string; log host only or a hashed/truncated path — never the raw path** (audit M2: secrets appear in paths too, e.g. `/reset/<token>`).
- Log the body only as a **bounded/hashed snippet**, never a raw body.
- **To the LLM/tool-output channel, a block is a single generic "fetch blocked by safety policy"** — do NOT leak which rule fired or the internal resolved IP to the agent (audit L2 mapping-oracle); the *human* card/log may show the distinct reason + IP (audit).
- New event types alongside `dive/event_log.rs:40-45`: `web_fetch.approval_requested`, `web_fetch.result`, `web_fetch.blocked`. Per attempt: host (no query, hashed/truncated path), purpose, decision, resolved IP, status, `bytes_on_wire`, elapsed, error class. Never log `Authorization`/`Cookie`/bearer/api-key/full bodies. All rows flow through `append_to_conn` so pilot JSONL export stays masked.

## Web-content-is-not-evidence enforcement (II) — anchored on the closed typed set (audit INFO-1)

`ExecutionEvidence` is built only from `ExecutionEvidenceSource {Preview, ProjectCommand, TerminalScript}` (runtime.rs:96) — a **closed enum with no web variant** — and `web_fetch` returns generic `ToolOutput` (tools/mod.rs:50-55), which has no path into `ExecutionEvidence`. **The plan MUST NOT add a web `ExecutionEvidenceSource` variant.** Keep the enum exhaustive (no `#[non_exhaustive]`) so a future `Web` variant trips compile-time review; add a test asserting no `From<WebFetchOutput>`→evidence path exists and that a `web_fetch` output cannot satisfy a criterion / pre-approve a step. Also (audit M5): fetched content is untrusted input — it must not silently become an instruction the agent obeys without a fresh gate.

## Capability state — distinct network/web-unavailable (NOT bolted onto RuntimeBadge)

`RuntimeBadge` (RuntimeBadge.tsx:17-70) is a single-purpose supervised-runtime indicator; merging "AI runtime down" with "internet lookup unavailable" would confuse a supervisor. **Add a separate sibling web-status inline chip** with its own icon + copy, shown only when a `web_fetch` attempt yields a web-unavailable state. Keep all four typed `WebUnavailableReason` variants internally (VI) + a `web_unavailable_reason_code` mapping mirroring `runtime_unavailable_reason_code` (`ipc/chat.rs:113-122`). **Beginner mapping — surface three states, not four** (S-046 anti-jargon; `EgressDenied`+`BlockedTarget` are both "DIVE protected me, nothing to fix"):

| internal reason | beginner key | ko | en |
|---|---|---|---|
| `Offline` | `web.unavailable.offline` | 인터넷에 연결되어 있지 않아요. 연결을 확인한 뒤 다시 시도하세요. | You're not connected to the internet. Check your connection and try again. |
| `Timeout` | `web.unavailable.timeout` | 응답이 너무 오래 걸려서 멈췄어요. 잠시 후 다시 시도해 보세요. | It took too long to respond, so it stopped. Try again in a moment. |
| `EgressDenied`+`BlockedTarget` (collapsed) | `web.unavailable.blocked` | AI가 접속하려던 주소는 안전하지 않아 DIVE가 막았어요. 따로 고칠 건 없어요. | The address the AI tried to visit wasn't safe, so DIVE blocked it. There's nothing you need to fix. |

en/ko parity enforced via `parity.test.ts`. The chip never renders as a silent hang (spec.md:179-184).

## tauri.conf.json CSP connect-src change

Agent egress happens in **Rust**, not the webview, so it does **not** traverse the webview CSP; **do NOT widen `connect-src` to `*`** (would re-open a webview-side exfil path — `tauri.conf.json:27`). Keep the webview allowlist; pass sanitized fetched text through IPC. Recommended: **no CSP change**; document the rationale in the plan (Open decision 4).

## Security acceptance criteria (MUST pass before merge — VI, encode as tests not prose)

Per the adversarial audit, the guard is defeated if any of these is wrong. Each is a required deterministic test:
1. **C4** — `web_fetch` client is built with the custom pinned resolver + `redirect::Policy::none()`; a test fails if it's the default system-resolver client. `web_fetch` does not reference `normalize_loopback_url`.
2. **C1/C2** — manual redirect loop: a redirect whose `Location` resolves to a denied IP is BLOCKED **without a socket to the internal target**; built-in redirect engine is not used.
3. **C1/H2** — DNS-rebind across resolve→connect and across each redirect hop: resolver returns a public IP for the check then a denied IP at connect (or a different IP than approved) ⇒ BLOCK (`ResolvedIpChangedAtFetch`); the socket connects only to the exact validated IP.
4. **C3** — mixed answer `A=public, AAAA=::1` (and `A=public, AAAA=fd00::1`) ⇒ BLOCK the whole request; the socket never opens to the denied family.
5. **H1** — server declares `Content-Length: 100` but streams 10 MiB ⇒ abort at 3 MiB wire; transparent decompression disabled (gzip bomb cannot inflate past the wire cap).
6. **H3** — server drips 1 byte / 19 s ⇒ aborts at the ~25 s total deadline, not never.
7. **H4** — every IPv6 embedding of `127.0.0.1`/`169.254.169.254`/`10.0.0.1` (IPv4-mapped `::ffff:…`, 6to4 `2002:…`, Teredo `2001:…`, NAT64 `64:ff9b:…`) ⇒ BLOCK; a host with `%zone` ⇒ BLOCK.
8. **M6** — every numeric-literal encoding (`2130706433`, `0x7f000001`, `0177.0.0.1`, `127.1`, `[::ffff:7f00:1]`) ⇒ BLOCK.
9. **M1** — a reused per-host grant + a rebind-to-internal on the next fetch ⇒ BLOCK (guard runs; UI-suppression does not skip R0–R4).
10. **M2** — a `?code=<oauth>` URL logs host+hashed-path only (query dropped, raw path not logged); an opaque body token is not persisted (snippet/hash only); `Authorization`/`Cookie`/`Referer` never sent or logged.
11. **II** — a `web_fetch` output cannot satisfy a criterion / pre-approve a step; no `ExecutionEvidenceSource` web variant exists (compile-time exhaustiveness).
12. **Permission/mode** — `web_fetch` is `Danger` ⇒ `AutoApprovePolicy::decide` returns `None`; appears in `tool_defs()` for Build only, absent in Verify/Plan/Interview (one test per mode).
13. **Registry** — all four coupled edits land; `list().len()` assertion (registry.rs:95) passes; `params_preview` arm present.
14. **Capability state / copy** — offline/timeout/blocked map to the correct localized chip; web card uses `permission_card.web.*` (not delete/command Danger keys); en/ko parity via `parity.test.ts`.

## Out of scope / preserve

- **Process-tool egress (Open decision 6):** plain `curl -o … https://x` via `run_process` is currently un-SSRF-guarded (guard.rs:498-499). Either (a) extend `classify_bash_command` to route `curl`/`wget` GET targets through the R3 denylist, or (b) scope S-048 to `web_fetch` and file the process-tool gap as a tracked follow-up. The plan MUST state which; until (a), do not claim `web_fetch` is the "only sanctioned egress."
- **Allowlist-only project mode (audit H5, optional):** a denylist can never cover routable-internal ranges (split-horizon / non-RFC1918 internal). Offer an optional per-project allowlist-only mode for high-assurance deployments; consider blocking the `.local` mDNS TLD outright (no legitimate novice `web_fetch` use). LAN/`.local` denylist correctness *depends on* the C4 custom-resolver fix — same work item.
- No Pi built-in web/fetch/discovery tool, no Node-side egress (III). No arbitrary request headers, no authenticated fetch, no non-GET (MVP). No CSP wildcard. No web `ExecutionEvidenceSource` variant. No `danger_accept_invalid_certs`.
- Do not add a "localhost is fine for dev" exception — blocking the student's own Vite/preview dev server (S-031) and LAN devices is **intentional** and distinct from the S-031 in-app preview posture.
- Web content is never verification evidence (II). Preserve all S-041–S-047 behavior; the `curl|bash`/upload process blocks (`tools/guard.rs:107-119, 140`) stay. No quizzes/badges/generic banners (I/V).

## Open decisions (owner) — locked before implementation

1. **Approval reuse scope** — recommend default ask-again, with a disclosed on-card opt-in checkbox for per-host session reuse (guard still runs every fetch). Alt: always-ask-only.
2. **GET-only vs non-GET** — recommend GET-only (non-GET mutates remote state, incompatible with II).
3. **http allowed?** — recommend https-only, optional per-project http opt-in (plaintext/MITM; scarier approval state if enabled — audit M5).
4. **CSP literalism** — recommend no `connect-src` change (egress is Rust-side).
5. **Run-mode exposure** — recommend Build-only (out of Verify for II, out of Plan for reasoning).
6. **Process-tool egress hole** — close now (extend `classify_bash_command`) or track as a follow-up.
7. **Bounds numbers** — recommend 3 MiB / connect 5 s / total 25 s / 3 redirects (audit M4 pinned exact values). Confirm.
8. **Constitution amendment** — approve III → 1.1.0 ([adr-s048-network-egress.md](adr-s048-network-egress.md)) + confirm the 3 template reviews. **Blocking gate.**

## Implementation validation (2026-07-02)

Implemented in-place under the existing 008 runtime-tool boundary:

- Rust `web_fetch` tool registered as `RiskLevel::Danger`, exposed to Pi only in
  Build mode, with Plan/Interview/Verify permission backstops.
- Deterministic `egress_guard` URL/IP checks: HTTPS-only default, credential and
  dangerous-scheme rejection, non-canonical numeric literal rejection,
  DNS-resolved IP denylist, mixed-answer fail-closed behavior, and IPv6 embedded
  IPv4 coverage.
- Pinned reqwest client path with a custom resolver, `redirect::Policy::none()`,
  manual redirect loop, 5 s connect/read timeouts, 25 s total deadline, 3 MiB
  streamed wire cap, `Accept-Encoding: identity`, and no arbitrary headers.
- EventLog/export rows for `web_fetch.approval_requested`,
  `web_fetch.result`, and `web_fetch.blocked`; query strings/raw paths and raw
  response bodies are not persisted.
- Frontend web-specific permission card and primer copy in ko/en showing host,
  resolved IP, and unverified AI purpose; the generic delete/command Danger
  primer is not shown for `web_fetch`.
- Per-host session reuse opt-in is stored only after explicit approval and
  suppresses the next card only when scheme/host/port/pinned IP/purpose still
  match; Rust egress validation and DNS pinning still run on every fetch.
- No `ExecutionEvidenceSource` web variant was added; `web_fetch` output remains
  tool input only, with `isEvidence: false` for display/export clarity.

Root adversarial-review hardening (2026-07-02, post-implementation): a 3-lens
worktree-isolated security review (SSRF, human-agency/evidence, log-hygiene)
returned zero SSRF and zero redaction findings; two low-severity agency-lens
items were fixed in place — (1) the model/tool channel now strips
`resolvedIp` as well as `errorClass` so the internal resolved IP is never
surfaced to the LLM on a successful fetch (audit L2; the human card/EventLog
still keep it); (2) the approval-prep DNS resolve is now bounded by a 5 s
`RESOLVE_TIMEOUT` so a slow/hung authoritative DNS for a model-chosen host
fails clear instead of stalling the turn outside the fetch deadline.

Validation run:

- `cargo fmt --check`
- `cargo test web_fetch --lib`
- `cargo test egress --lib`
- `cargo test builtins_include_track0_tools_with_expected_risk --lib`
- `cargo test pi_path_run_mode_gating_preserves_interview_plan_and_build_rules --lib`
- `cargo test --features dev-mock --test tool_guard`
- `cargo test --test export_jsonl export_distinguishes_008_runtime_events_and_redacts_outputs`
- `pnpm typecheck`
- `pnpm exec vitest run src/components/permission-card/PermissionCard.test.tsx src/i18n/parity.test.ts`

Remaining out of scope per locked decision 6: the pre-existing process-tool
plain-GET egress gap remains a tracked follow-up; this slice must not claim
`web_fetch` is the only reachable egress path until that follow-up lands.
