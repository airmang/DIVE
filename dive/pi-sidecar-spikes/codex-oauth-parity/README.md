# Codex OAuth parity spike

Stage S-005 spike for seeding Pi's `AuthStorage.create(path)` with a DIVE-owned
temporary `auth.json` entry for ChatGPT Plus/Pro Codex OAuth.

## Confirmed Pi 0.78.0 credential shape

Source: `earendil-works/pi` tag `v0.78.0` and the npm packages
`@earendil-works/pi-coding-agent@0.78.0` / `@earendil-works/pi-ai@0.78.0`.

Pi stores Codex OAuth under provider key `openai-codex`:

```json
{
  "openai-codex": {
    "type": "oauth",
    "access": "<access token>",
    "refresh": "<refresh token>",
    "expires": 1790000000000,
    "accountId": "<chatgpt account id>"
  }
}
```

Evidence:

- `packages/ai/src/utils/oauth/types.ts` defines `OAuthCredentials` as
  `refresh`, `access`, `expires`, plus provider-specific fields.
- `packages/ai/src/utils/oauth/openai-codex.ts` returns `access`, `refresh`,
  `expires`, and `accountId`; provider id is `openai-codex`.
- `packages/coding-agent/src/core/auth-storage.ts` persists
  `{ type: "oauth", ...credentials }`, refreshes when `Date.now() >= expires`,
  and writes auth files with `0600`.

## Header parity

Pi's Codex provider extracts `chatgpt_account_id` from the access token and
sends `chatgpt-account-id` automatically. It also sets `originator: pi`.

Important mismatch: Pi 0.78.0 SSE path sets `OpenAI-Beta:
responses=experimental`, while DIVE's current `CodexProvider` sends
`OpenAI-Beta: responses=v1`.

Pi does not expose a public account-id injection option for OAuth. Provider or
model headers cannot override it because Pi computes and sets the account header
inside `openai-codex-responses`.

## Local spike result on 2026-06-04

Blocked before the live model turn: this machine has no DIVE Codex provider row
or DIVE Codex keyring entries to seed from.

Reproduction performed without printing raw secrets:

```sh
sqlite3 "$HOME/Library/Application Support/com.coreelab.dive/dive.db" \
  "SELECT id, kind, auth_type FROM ProviderConfig ORDER BY id;"
```

Observed only provider row `1|opencode_zen|api_key`; no `codex` row. Backup DBs
under `com.coreelab.dive/backups` and the QA DB also had no `codex` provider
row. A keychain account-name scan for DIVE Codex entries found none:
`codex-access-token:*`, `codex-refresh-token:*`, `codex-id-token:*`.

PoC execution:

```sh
node codex-oauth-parity.mjs --provider-config-id 1
```

Result:

```text
BLOCKED_NO_DIVE_CODEX_TOKENS: no DIVE Codex OAuth credentials were found.
Checked DIVE keyring provider_config_id and env fallback; no raw secrets were printed.
```

I also ran the script with fake JWT-shaped credentials to exercise the auth-file
seed and session-construction path. It created a temporary auth file with mode
`600`, used provider `openai-codex`, disabled built-in tools, and exposed
`enabledTools: []`. The fake turn produced no assistant text, so the script now
fails that case instead of claiming success.

Conclusion: the auth shape is seedable if DIVE supplies access/refresh tokens
and the access token contains the ChatGPT account claim. This local machine
cannot prove the live one-turn model call because the required existing DIVE
Codex OAuth keyring material is absent.

## Run

Install dependencies inside this spike directory:

```sh
npm install
```

Run using DIVE's macOS keyring entries:

```sh
node codex-oauth-parity.mjs --provider-config-id <codex-provider-config-id>
```

The local fallback below is only for reproducing in an isolated dev shell. Do
not put these values in logs or committed files.

```sh
DIVE_CODEX_ACCESS_TOKEN=... \
DIVE_CODEX_REFRESH_TOKEN=... \
DIVE_CODEX_ID_TOKEN=... \
node codex-oauth-parity.mjs
```

The script creates a temporary auth file outside the project tree with `0600`,
passes it to `AuthStorage.create(path)`, creates a session with
`noTools: "builtin"` and the built-in denylist, runs one model turn, redacts
secrets in stdout, and removes the temporary auth directory on exit.
