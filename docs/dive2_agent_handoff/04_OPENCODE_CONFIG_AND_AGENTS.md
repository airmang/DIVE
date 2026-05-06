# OpenCode Suggested Config and Agent Prompts for DIVE-2

This file contains optional OpenCode configuration snippets for safe DIVE-2 refactoring.

## 1. Recommended `opencode.json` for analysis/review sessions

Use this when you want OpenCode to inspect and plan without modifying files.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "read": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    },
    "glob": "allow",
    "grep": "allow",
    "edit": "deny",
    "bash": {
      "*": "ask",
      "git status*": "allow",
      "git diff*": "allow",
      "git log*": "allow",
      "rg *": "allow",
      "grep *": "allow",
      "find *": "allow",
      "pnpm typecheck": "ask",
      "pnpm lint": "ask",
      "pnpm build": "ask",
      "cargo test*": "ask",
      "cargo clippy*": "ask",
      "cargo fmt*": "ask",
      "git push*": "deny",
      "git commit*": "deny",
      "rm *": "deny",
      "del *": "deny"
    },
    "webfetch": "ask",
    "websearch": "ask",
    "external_directory": "deny"
  },
  "agent": {
    "dive-review": {
      "mode": "subagent",
      "permission": {
        "edit": "deny",
        "bash": {
          "*": "ask",
          "git status*": "allow",
          "git diff*": "allow",
          "rg *": "allow"
        },
        "webfetch": "deny"
      }
    }
  }
}
```

## 2. Recommended `opencode.json` for scoped build sessions

Use this only after approving a single PR-sized task.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "read": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    },
    "glob": "allow",
    "grep": "allow",
    "edit": "ask",
    "bash": {
      "*": "ask",
      "git status*": "allow",
      "git diff*": "allow",
      "rg *": "allow",
      "pnpm typecheck": "ask",
      "pnpm lint": "ask",
      "pnpm build": "ask",
      "cargo fmt --all -- --check": "ask",
      "cargo test*": "ask",
      "cargo clippy*": "ask",
      "git push*": "deny",
      "git commit*": "deny",
      "rm *": "deny",
      "del *": "deny"
    },
    "external_directory": "deny"
  }
}
```

## 3. OpenCode Plan Agent Prompt

```text
Use the Plan agent. Analyze DIVE-2 for the current requested PR only. Do not edit files.

Confirm:
- current file architecture
- exact files to change
- minimal implementation strategy
- acceptance criteria
- validation commands

Then stop and wait for approval.
```

## 4. OpenCode Build Agent Prompt

```text
Use the Build agent for this single scoped PR only.

Implement only the approved plan. Do not broaden scope. Ask before edits and before bash commands unless explicitly allowed by config. Do not run git push or git commit.

After implementation, run required checks and report results.
```
