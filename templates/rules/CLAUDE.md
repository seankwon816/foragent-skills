# Surgical Changes & Secret Protection (`CLAUDE.md` / `AGENTS.md`)

## 1. Surgical Changes (Prevent Drive-By Refactoring)
- Touch only the lines required to solve the requested task.
- Do not reformat, reorder imports, or rename unrelated variables in files you are editing.
- Do not delete existing comments or dead code unless asked; list them in your final summary instead.
- Only clean up unused imports or helpers that your own edit made unused.
- Every changed line in `git diff` must trace directly to the user's prompt.

## 2. Secret Protection (`~/.claude/settings.json`)
Claude Code does not read `.claudeignore`. To block `.env` reads across monorepos while keeping `env.example` readable, add `permissions.deny` to `.claude/settings.json` and enable `/sandbox`:

```json
{
  "permissions": {
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./**/.env)",
      "Read(./**/.env.*)"
    ]
  }
}
```
