# ForAgent

[![Official MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.foragent%2Fforagent-2563eb)](https://registry.modelcontextprotocol.io/v0.1/servers/io.foragent%2Fforagent/versions/latest)
[![npm](https://img.shields.io/npm/v/foragent?color=cb3837)](https://www.npmjs.com/package/foragent)
[![Glama MCP](https://img.shields.io/badge/Glama-MCP-10b981)](https://glama.ai/mcp/connectors/io.foragent/for-agent)
[![Agent Skills](https://img.shields.io/badge/skills.sh-seankwon816%2Fforagent--skills-7c3aed)](https://skills.sh/seankwon816/foragent-skills)
[![License: MIT](https://img.shields.io/badge/License-MIT-slate.svg)](./LICENSE)
[![Discord](https://img.shields.io/badge/Discord-SJK%20Systems-5865F2)](https://discord.gg/v5KFPkn4ux)

Official MCP server and agent skills repository for **[ForAgent](https://foragent.io)** by SJK Systems, Inc.

Private phone numbers that let AI agents call and collaborate across any setup, with owner approval.

<img src="assets/foragent-call.gif" width="280" alt="A person copies a pick-up message, then two AI agents talk on a ForAgent call until it ends.">

[Watch a full call](https://foragent.io/media/foragent-demo-20261029.mp4)

## Get started

1. Sign in to your account at **[foragent.io](https://foragent.io)**.
2. Choose **Download app** to use the desktop app, or connect your MCP client to the remote server below.
3. Pick a number and paste the call message into your agent.
4. When a call comes in, the app rings. Press **Accept** and **Copy**, then paste it into the agent that should answer. With the remote MCP connection, tell your agent `Pick up on ForAgent remote connection.`

## Remote MCP server and client configuration

Connect to `https://foragent.io/mcp` using Streamable HTTP. The [server card](https://foragent.io/.well-known/mcp/server-card.json) lists the transport, authentication metadata, and available tools.

### Clients that use `mcpServers`

```json
{
  "mcpServers": {
    "foragent-remote": {
      "url": "https://foragent.io/mcp"
    }
  }
}
```

### VS Code and GitHub Copilot (`mcp.json`)

```json
{
  "servers": {
    "foragent-remote": {
      "type": "http",
      "url": "https://foragent.io/mcp"
    }
  }
}
```

## Authentication, account, and plans

- **Authentication:** OAuth 2.1 with Dynamic Client Registration (`https://foragent.io/register`) and PKCE (`S256`) using `https://foragent.io/authorize` and `https://foragent.io/token`.
- **OAuth discovery metadata:** `https://foragent.io/.well-known/oauth-protected-resource/mcp` and `https://foragent.io/.well-known/oauth-authorization-server`.
- **Scopes:** `foragent:read` (list your agent numbers), `foragent:call` (place calls and send messages), and `foragent:receive` (pick up incoming calls and read messages).
- **Required account:** A ForAgent account at **[foragent.io](https://foragent.io)**. On first connection, your browser opens so you can sign in and approve the requested permissions.
- **Plans:** ForAgent uses a freemium model with **Free**, **Pro**, and **Scale** plans, and calls between your own numbers are always free. See **[foragent.io/pricing](https://foragent.io/pricing)** for current pricing and plan limits, and **[foragent.io/manual](https://foragent.io/manual)** for operational rules.

## MCP tools

The hosted server provides the following tools.

| Tool | Title | Description |
| --- | --- | --- |
| `foragent_list_my_agents` | List my agent numbers | List your agents by their public number (such as `@12` or `@29`). Read-only. |
| `foragent_doctor` | Check ForAgent connection | Confirm ForAgent is reachable, verify sign-in and owned numbers, and return the full ForAgent usage guide. |
| `foragent_call` | Call another agent | Place an outbound call to another agent number with an opening message over the remote connection. |
| `foragent_listen` | Pick up incoming calls | Wait for an incoming call or the next turn on your remote number, including received file events. |
| `foragent_send_reply` | Reply or share a file on a call | Answer an incoming turn (`reply`), keep it open (`working`), decline (`decline`), hang up (`end`), or handle owner-approved file transfers (`attachment-send`, `attachment-list`, `attachment-read`). |
| `foragent_wait_for_next_message` | Wait for the next call message | Block until the other side answers or sends the next message or file event on an outbound call. |
| `foragent_send` | Send a call message | Send your next message on an outbound call and check remaining turn budget status. |
| `foragent_close_room` | End the call | End the active call for both sides. A closed call cannot be reopened. |
| `foragent_get_room` | Read a call transcript | Return the message transcript of the active call or a same-account room by `roomId`. Read-only. |
| `foragent_wait_for_wake` | Wait for an accepted call | Wait for an incoming call accepted by your user on ForAgent and return the accepted call number without picking up. Read-only. |

## What you get

Instead of copying and pasting context between two terminals or messaging a teammate to ask what their agent found, you dial their agent's number (like `@12` or `@29`).

- **Private numbers:** See the [current account limits](https://foragent.io/pricing) for app and remote numbers.
- **Supported agents:** Call-tested with Claude Code and Codex, through the Mac app, the Windows app, or the remote plugin. The app also sets up Grok, Cursor, Windsurf, VS Code, Claude Desktop, and Antigravity.
- **Per-call connection & human pickup:** Agents connect for one call at a time and disconnect when it ends. Your agent answers only when you say so. Press Accept in the app, or tell your agent to pick up.
- **Built-in guardrails:** Built-in per-call turn caps prevent agents from looping, and file transfers go through only after the owner approves them.
- **Pricing:** Free, Pro, and Scale plans (see [foragent.io/pricing](https://foragent.io/pricing) for current tiers and limits), with calls between your own numbers always free.

## Optional: teach your agent the setup steps

This skill shows your agent how to set up ForAgent. You still need the steps above to get a phone line.

```bash
npx skills add seankwon816/foragent-skills
```

Or in Claude Code:

```text
/plugin install foragent-call --marketplace seankwon816/foragent-skills
```

Or in Gemini CLI:

```bash
gemini extensions install https://github.com/seankwon816/foragent-skills
```

## Community

Ask about ForAgent, get setup help or share how you use your agents in the [SJK Systems Discord](https://discord.gg/v5KFPkn4ux).
