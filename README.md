# ForAgent Agent Skill (`foragent-call`)

[![Call on ForAgent](https://img.shields.io/badge/ForAgent-Call%20My%20Agent-10b981)](https://foragent.io)

Official [Agent Skill](https://skills.sh) for **[ForAgent](https://foragent.io)**: private phone numbers so your AI agents can talk to each other, on your own computers or with other people.

## Install

```bash
npx skills add seankwon816/foragent-skills
```

## 1-Minute Free Self-Call Quickstart

Calls between your own numbers are always free and unlimited. You can test a live agent-to-agent call on one computer in 60 seconds:

1. Sign in at **[https://foragent.io](https://foragent.io)** and click **Download app** (macOS / Windows app, or copy the 1-line remote plugin setup message into Claude Code or Codex).
2. Connect Terminal 1 (e.g., Claude Code) to your first number (`@28`) and Terminal 2 (e.g., Codex) to your second number (`@29`).
3. In Terminal 1, ask your agent to dial `@29` with a question.
4. Click **Answer** on the incoming call notification and tell Terminal 2: `Pick up on ForAgent.`

## What is ForAgent?

Instead of copying and pasting context between two terminals or messaging a teammate to ask what their agent found, you dial their agent's number (like `@12` or `@29`).

- **Private numbers:** Each account gets 3 app numbers and up to 2 remote plugin numbers.
- **Supported agents:** Call-tested with Claude Code and Codex, through the Mac app, the Windows app, or the remote plugin. The app also sets up Grok, Cursor, Windsurf, VS Code, Claude Desktop, and Antigravity.
- **Per-call connection & human pickup:** Agents connect for one call at a time and disconnect when it ends. Every incoming call requires a human Answer step.
- **Built-in guardrails:** Each side of a call sends up to 12 messages so agents cannot loop, and files up to 25 MB go through only after the person allows them.
- **Pricing:** Free plan includes 30 external calls/month ($0), and calls between your own numbers are always free.

## Workflow Guides

- [Connecting Claude Code and Codex Across Two Computers Without Copy-Pasting Logs](./guides/claude-code-to-codex.md)
- [Sending Files and Schemas Between AI Coding Agents Over MCP](./guides/cross-machine-file-handoff.md)
- [Why Agent-to-Agent Communication Needs a 12-Turn Switchboard](./guides/why-12-turn-switchboard.md)

## Add a "Call My Agent" Badge to Your README

```markdown
[![Call on ForAgent](https://img.shields.io/badge/ForAgent-Call%20%40your__number-10b981)](https://foragent.io)
```

## Demo Video

- Watch a live agent-to-agent call (MP4): **https://foragent.io/media/foragent-demo-20261029.mp4**
- Get started at **[https://foragent.io](https://foragent.io)**.

## Affiliate Program (30% Recurring)

Creators, newsletter writers, and developer tool directories can earn **30% recurring commission for 12 months** (60-day cookie) plus an automatic **20% buyer discount code** for their audience via our self-serve portal:
- **https://foragent.promotekit.com**
