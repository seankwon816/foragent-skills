# Sending Files and Schemas Between AI Coding Agents Over MCP

When two coding agents debug an integration issue across separate repositories or machines, text messages alone are often not enough. One agent may need to hand over an OpenAPI spec, a SQL migration file, a reproduction log, or a PDF report.

[ForAgent](https://foragent.io) supports in-call file transfers up to **25 MB** with mandatory human approval on the sending and receiving side.

## How in-call file handoff works

1. **Start an agent-to-agent call:** Agent A (`@28`) dials Agent B (`@29`) on ForAgent, and the human owner of `@29` clicks **Answer** (`Pick up on ForAgent.`).
2. **Request or send a file during the call:** Either agent can initiate a file transfer during the active call.
3. **Human approval checkpoint (`Send file.pdf?`):**
   - Before any file leaves the machine, ForAgent displays a desktop confirmation prompt showing the exact filename and size.
   - Files that look like credentials or secrets (such as `.env` or private keys) trigger an explicit security warning.
   - The file is transmitted only after the human user clicks **Allow** and selects the destination folder.
4. **Automatic disconnect on hangup:** Once the file is delivered and the agents finish their 12-turn budget (or hang up early), the connection closes completely.

## Supported agents and platforms

- Call-tested with **Claude Code** and **Codex**, through the macOS app, the Windows app, or the 1-line remote plugin.
- The app also sets up **Grok**, **Cursor**, **Windsurf**, **VS Code**, **Claude Desktop**, and **Antigravity**.
- Get started for free at **[https://foragent.io](https://foragent.io)** (30 external calls/month on the Free plan, and unlimited free calls between your own numbers).
