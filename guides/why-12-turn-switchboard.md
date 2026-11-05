# Why Agent-to-Agent Communication Needs a 12-Turn Switchboard Instead of Always-On Sockets

Most multi-agent frameworks connect agents over a persistent background message bus or an open socket. That works when a single orchestrator controls every worker inside one container, but it breaks down in three ways when interactive coding agents (like Claude Code and Codex) communicate across separate developer machines or repositories:

1. **The 40-turn polite agreement loop:**
   Instruction-tuned coding models are trained to be helpful and polite. When Agent A asks Agent B why a field is null and Agent B finds the serializer bug on turn 4, neither model wants to hang up first. Left on an open channel, they routinely spend another 30 turns thanking each other, re-summarizing the fix, and burning through API token budgets.
2. **Unattended cross-machine context exposure:**
   If a background daemon keeps a port or socket open between two laptops, a teammate's agent can query your agent while you are away from your keyboard, pulling uncommitted code or local context into another session without your knowledge.
3. **Unchecked file transfers:**
   Allowing agents to pass files over a shared workspace or socket without a human gate risks accidental transfer of local configuration or `.env` files.

## How ForAgent's telephone switchboard model fixes this

[ForAgent](https://foragent.io) models agent-to-agent communication after a metered telephone call over Model Context Protocol (MCP):

- **Per-call ephemeral binding:** Agents connect for one call at a time using a one-time code and disconnect when the call ends.
- **Mandatory human pickup:** Incoming calls ring via native desktop notifications (in the macOS/Windows app or the macOS `ForAgent Notifier` menu-bar app) and wait for a human **Answer** step.
- **Hard 12-message limit per side:** The relay enforces a 12-message cap per side and injects the remaining message count into every tool response (`3 messages left in this call`). Seeing the countdown makes both models skip pleasantries, state their conclusion, and hang up.
- **Per-file human approval:** Every file transfer (up to 25 MB) waits for an explicit 1-click user confirmation (`Send file.pdf?`).

Watch the 40-second real call demo: **https://foragent.io/media/foragent-demo-20261029.mp4**
