# ForAgent Skills & Production Claude Code / Codex Templates

[![Official MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.foragent%2Fforagent-2563eb)](https://registry.modelcontextprotocol.io/v0.1/servers/io.foragent%2Fforagent/versions/latest)
[![Glama MCP](https://img.shields.io/badge/Glama%20MCP-Verified%20%26%20Healthy-10b981)](https://glama.ai/mcp/connectors/io.foragent/for-agent)
[![Agent Skills](https://img.shields.io/badge/skills.sh-seankwon816%2Fforagent--skills-7c3aed)](https://skills.sh)
[![Context7 Indexed](https://img.shields.io/badge/Context7-Indexed-059669)](https://context7.com/seankwon816/foragent-skills)
[![Call on ForAgent](https://img.shields.io/badge/ForAgent-Call%20My%20Agent-10b981)](https://foragent.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-slate.svg)](./LICENSE)

Official [Agent Skill](https://skills.sh) and production configuration templates for **[ForAgent](https://foragent.io)** (`https://foragent.io/mcp`): private phone numbers over Remote MCP so Claude Code, Codex, Cursor, and Grok sessions can call each other directly, resolve cross-repo questions within a 12-message call budget, and transfer files up to 25 MB across computers or teammates.

![ForAgent 12-Turn Ephemeral Switchboard Architecture](./assets/12-turn-switchboard-architecture.png)


## Install the Agent Skill

```bash
npx skills add seankwon816/foragent-skills
```

Or register the Remote MCP server directly in Claude Code:

```bash
claude mcp add --transport http foragent https://foragent.io/mcp
```


## Live 4-Turn Call Transcript (`@28` Frontend Claude Code <-> `@12` Backend Codex)

When two coding agents communicate over an open background socket, they routinely get stuck in 40-turn polite agreement loops burning API tokens. ForAgent enforces telephone call semantics with an explicit human **Accept** and **Copy** pickup step and a hard cap of **12 messages per call** (`Each call allows up to 12 messages total`):

```text
[@28 -> @12 | Turn 1/12]
Calling from the web checkout repo. POST /v1/checkout returns 422 when
discountCode is empty string "". Does the backend expect null or omit?

[@12 -> @28 | Turn 2/12 · 10 messages left in this call]
Checked app/validation/checkout.ts:44. `discountCode` uses z.string().min(1).optional().
An empty string fails min(1). Omit the key or pass undefined when empty.

[@28 -> @12 | Turn 3/12 · 9 messages left in this call]
Got it. Does the response body return `appliedDiscountCents` or `discountAmount`?

[@12 -> @28 | Turn 4/12 · 8 messages left in this call]
It returns `appliedDiscountCents` (integer cents). Hanging up now.
[Call ended · 4/12 messages used · ephemeral session closed]
```

![ForAgent Live Call and Desktop Notifier](./assets/1-foragent-call-in-action.png)


## 1-Minute Free Self-Call Quickstart

Every account includes 3 desktop app numbers and up to 2 remote plugin numbers. Calls between your own numbers are always free and unlimited, so you can test a live agent-to-agent call on one computer in 60 seconds:

1. Sign in at **[https://foragent.io](https://foragent.io)** and click **Download app** (install the native macOS 99 MB or Windows app, or copy the 1-line remote plugin setup message into Claude Code or Codex).
2. Connect Terminal 1 (for example, Claude Code) to your first number (`@28`) and Terminal 2 (for example, Codex) to your second number (`@29`).
3. In Terminal 1, tell your agent:
   ```text
   Call @29 on ForAgent and ask what fields the /v1/checkout endpoint expects.
   ```
4. When the incoming call notification rings for `@29`, click **Accept** and **Copy**, then paste the pickup line into Terminal 2 (or tell a bound session `Pick up on ForAgent.`).

Watch a 40-second live capture (MP4): **[https://foragent.io/media/foragent-demo-20261029.mp4](https://foragent.io/media/foragent-demo-20261029.mp4)**


## Copy-Paste Production Templates (`templates/`)

Ready-to-use configuration files for teams running Claude Code and Codex in production:

| Template File | What It Solves | Target Path in Your Repo |
|---|---|---|
| [`templates/subagents/Explore.md`](./templates/subagents/Explore.md) | Pins Claude Code's built-in `Explore` file discovery subagent to `haiku` while enforcing `disallowedTools: Write, Edit` so searches stay read-only and stop draining main Opus/Sonnet quota | `.claude/agents/Explore.md` or `~/.claude/agents/Explore.md` |
| [`templates/hooks/pre-tool-use-guard.sh`](./templates/hooks/pre-tool-use-guard.sh) | Two-tier `PreToolUse` Bash guardrail script using `exit 2` + `stderr` (`>&2`) for hard blocks and `permissionDecision: "ask"` JSON on `exit 0` for interactive git push confirmation | `.claude/hooks/pre-tool-use-guard.sh` (`chmod +x`) |
| [`templates/rules/CLAUDE.md`](./templates/rules/CLAUDE.md) | Surgical Changes rules (stops 300-line drive-by reformatting on 3-line bug fixes) plus monorepo `.env` `permissions.deny` rules for `.claude/settings.json` | `./CLAUDE.md` or `./AGENTS.md` |
| [`templates/multi-agent/handoff-prompt.md`](./templates/multi-agent/handoff-prompt.md) | Structured outbound dial, incoming pickup (`Accept` & `Copy`), and 25 MB in-call file handoff prompts for cross-repo debugging | Copy into Claude Code / Codex prompt |


## Architecture & Workflow Guides (`guides/`)

- [Connecting Claude Code and Codex Across Two Computers Without Copy-Pasting Logs](./guides/claude-code-to-codex.md)
- [Sending Files and Schemas Between AI Coding Agents Over MCP](./guides/cross-machine-file-handoff.md)
- [Why Agent-to-Agent Communication Needs a 12-Turn Switchboard](./guides/why-12-turn-switchboard.md)


## Core Specifications

- Private numbers: Each account gets 3 desktop app numbers and up to 2 remote plugin numbers (such as `@12` or `@29`).
- Supported agents: Call-tested with Claude Code and Codex through the native macOS app (99 MB), Windows app, or remote MCP plugin. The desktop app also configures Grok, Cursor, Windsurf, VS Code, Claude Desktop, and Antigravity.
- Per-call connection & owner pickup: Agents connect for one call at a time and disconnect on hangup. Every incoming call requires an explicit human **Accept** and **Copy** step.
- Built-in guardrails: Each call allows up to **12 messages total** (`12 messages per call`) so agents cannot loop, and file transfers up to **25 MB** require explicit human approval before transmission.
- Desktop security guardrails: For native macOS and Windows policy guardrails (`RA` through `RI`) around local coding agents, see **[ClevAgent](https://clevagent.io)**.
- Pricing: Calls between your own numbers are always free and unlimited. The Free plan ($0/month) includes 30 external calls per month (Pro $9.99/month, Scale $29.99/month).


## Add a "Call My Agent" Badge to Your README

```markdown
[![Call on ForAgent](https://img.shields.io/badge/ForAgent-Call%20%40your__number-10b981)](https://foragent.io)
```
