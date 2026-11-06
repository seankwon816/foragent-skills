# Four Hidden Config Settings That Stop Token Leaks and Unapproved Writes in OpenAI Codex and Claude Code

When you run OpenAI Codex CLI and Claude Code side by side across a real codebase, the biggest token drains and safety gaps come from default background settings that rarely show up in the terminal UI.

Here are four production configuration changes, verified against `codex-cli 0.166.0` and Claude Code `v2.1.277+`, that cut wasted polling turns and lock down unapproved writes.

## 1. Stop OpenAI Codex From Yielding Every 30 Seconds and Polling Every 1 Second

By default, when OpenAI Codex runs a build, test suite, or subagent task under `code_mode`, it yields control back to the model after 30,000 ms (`default_exec_yield_time_ms`) even if the command is still running. Every yield resends your entire conversation history. Worse, when the model calls `wait` to check on the running command, it frequently picks a 1,000 ms timeout and polls up to a hundred times during a single slow build.

Add these two blocks to `~/.codex/config.toml` (template: [`templates/codex/config.toml`](../templates/codex/config.toml)):

```toml
[features.code_mode]
default_exec_yield_time_ms = 300000

[features.multi_agent_v2]
min_wait_timeout_ms = 30000
default_wait_timeout_ms = 120000
max_wait_timeout_ms = 300000
```

Setting `default_exec_yield_time_ms = 300000` raises the initial command yield window to 5 minutes while still returning the instant the command exits. Under `[features.multi_agent_v2]`, `min_wait_timeout_ms = 30000` enforces a hard 30-second floor when waiting on subagents.

For shell builds that run longer than 5 minutes, add one line to your repository root `AGENTS.md`:

```markdown
When calling wait on a running command, always pass yield_time_ms >= 60000 (never poll at 1000ms).
```

## 2. Isolate Custom Claude Code Subagents From Main-Model Quota and Root Instruction Reloads

Claude Code's built-in `Explore` subagent skips your `CLAUDE.md` files on purpose so file lookups stay fast. However, two traps hit teams as soon as they use subagents heavily:

1. Built-in `Explore` inherits your main session model unless you override it, which burns Opus or Sonnet quota on simple `Glob` and `Grep` calls.
2. Any custom subagent you define in `.claude/agents/` reloads your full `CLAUDE.md` hierarchy on every spawn and inherits write permissions unless you lock down its frontmatter.

Create `.claude/agents/Explore.md` with these exact frontmatter fields (template: [`templates/subagents/Explore.md`](../templates/subagents/Explore.md)):

```yaml
---
name: Explore
description: Fast read-only codebase search and git history lookup
model: haiku
effort: low
omitClaudeMd: true
tools: Read, Grep, Glob, Bash(git log *), Bash(git blame *), Bash(git diff *)
---
```

Using an explicit `tools` allowlist instead of `disallowedTools: Write, Edit` prevents the search worker from mutating files via `sed` or shell redirection while still allowing read-only `git log` and `git blame` inspection.

## 3. Run Stateless Cross-Vendor Diff Reviews Before Opening a Pull Request

Asking the same coding agent session that wrote a feature branch to review its own changes misses obvious bugs because the agent still has its own reasoning trace and assumptions in context.

Run a stateless, read-only review pass on a second model vendor so the reviewer only sees the raw `git diff` and the files on disk.

When Claude Code writes the branch, run OpenAI Codex CLI's built-in `review` subcommand:

```bash
codex exec review --base main --ephemeral -o /tmp/codex-review.txt \
  "List only concrete bugs, race conditions, and unhandled edge cases with file:line references."
```

Example output from `/tmp/codex-review.txt`:

```text
[codex-review] Comparing feat/orders-v2 against main (4 files changed, +142 -19)
  1. [HIGH] src/routes/orders.ts:88: Missing await on releaseInventoryLock()
      inside catch block leaves row lock active until connection timeout.
  2. [MED]  src/schemas/order.ts:34: discountCents allows negative integers
      when promoCode is omitted; add .nonnegative() to Zod schema.
```

When Codex writes the branch, pipe the branch diff into Claude Code in non-interactive mode with write tools stripped:

```bash
git diff main...HEAD | claude -p \
  "Review this diff against the codebase. Report only concrete bugs and missing edge cases with file:line numbers." \
  --tools "Read,Grep,Glob"
```

## 4. Gate Destructive Commands and Cross-Repo Agent Handoffs

When two coding agents work across separate repositories or computers (for example, a frontend Claude Code session on a laptop and a backend Codex session on a desktop), you need both local execution guardrails and a structured channel for cross-agent questions:

1. For local shell commands in Claude Code, use a `PreToolUse` execution gate (`exit 2` + `stderr`). Returning `exit 1` from a `PreToolUse` hook only logs a non-blocking warning and lets the command run anyway. To block a destructive command and feed the reason back to the model, exit with code `2` and write the allowed alternative command to `stderr` (`>&2`). For full desktop runtime guardrails (`Security RA` through `RI` rules) across macOS and Windows, we built **[ClevAgent](https://clevagent.io)**.
2. For direct agent-to-agent calls over MCP (`12 messages per call`), **[ForAgent](https://foragent.io)** (`https://foragent.io/mcp`, listed in the Official MCP Registry as `io.foragent/foragent`) gives each coding agent a private phone number so you do not have to copy-paste stack traces between your frontend and backend terminals. One agent dials `@12`, you click **Accept** and **Copy** once to approve the incoming call, and the two agents resolve the schema mismatch directly within a hard cap of **12 messages per call** (plus file transfers up to **25 MB** with a 1-click desktop confirmation prompt). Self-calls between your own agent numbers are always free.
