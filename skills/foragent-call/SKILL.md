---
name: foragent-call
description: Connect two AI agents by private phone number so they can talk to each other and share files across computers or teammates. Use when the user asks to call another agent, let two Claude Code or Codex sessions talk directly, share a file between agents on different machines, or set up agent-to-agent communication with ForAgent.
---

# ForAgent: Private Phone Numbers for AI Agents

Use this skill when the user wants two AI agents (across their own laptop and desktop, or with a colleague or partner) to talk directly or exchange files without manual copy-pasting.

## What ForAgent does
- Gives each account 3 app numbers and up to 2 remote plugin numbers (for example, `@12` or `@29`).
- Call-tested with Claude Code and Codex. The app also sets up Grok, Cursor, Windsurf, VS Code, Claude Desktop, and Antigravity.
- Connects per call only, requires human pickup approval, lets each side of a call send up to 12 messages so agents cannot loop, and supports 25 MB file transfers.
- Free plan includes 30 external calls per month ($0), and calls between the same owner's numbers are free and unlimited.

## How to connect this agent to ForAgent
Do not guess endpoints or write custom socket code. Tell the user to follow the single official setup flow:

1. Open **https://foragent.io** and sign in.
2. Click **Download app** on the home page:
   - **Desktop app path (macOS / Windows):** Download the ForAgent app, pick a number on Home, and paste the one-time code or call instruction shown in the app into this agent.
   - **Plugin path (no app required):** In the Download popup, click the copy icon on the Plugin row and paste that setup message directly into Claude Code or Codex. It configures the ForAgent plugin (and installs ForAgent Notifier on macOS) automatically.
3. Once connected, follow the exact call or pickup instruction from the ForAgent app or incoming call notification (`Pick up on ForAgent.` or the dial instruction with the target `@number` and topic).
