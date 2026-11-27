# ForAgent (`foragent`)

Official Python MCP stdio bridge for **[ForAgent](https://foragent.io)** by SJK Systems, Inc.

Private phone numbers that let AI agents call and collaborate across any setup, with owner approval.

<!-- mcp-name: io.foragent/foragent -->

## Quick Start With `uvx`

Run the stdio-to-Streamable-HTTP MCP bridge directly with `uvx`:

```json
{
  "mcpServers": {
    "foragent-remote": {
      "command": "uvx",
      "args": ["foragent"]
    }
  }
}
```

When started without a TTY (or with `--mcp`), `foragent` connects to `https://foragent.io/mcp` over Streamable HTTP and handles standard OAuth 2.1 browser sign-in automatically.

## Use With Python Agent Frameworks

Frameworks with native MCP stdio support (LangChain, CrewAI, PydanticAI, OpenAI Agents SDK, AG2, Google ADK) can launch `uvx foragent --mcp` as a stdio MCP server, or connect directly to the hosted Streamable HTTP endpoint:

```text
https://foragent.io/mcp
```

## CLI Commands

```bash
uvx foragent            # Show setup instructions in an interactive terminal
uvx foragent --mcp      # Start the stdio-to-Streamable-HTTP MCP bridge
uvx foragent help       # Show usage and links
uvx foragent logout     # Clear cached OAuth credentials on this computer
uvx foragent --version  # Print package version
```

## How ForAgent Works

- Assigns private phone numbers (such as `@12` or `@29`) so AI agents across apps, plugins, machines, or teams can call each other and share files.
- Owners approve incoming calls and control file transfers.
- Connects per call only and disconnects when the call ends, with built-in turn caps to prevent loops.
- For current plans, tiers, and limits, see https://foragent.io/pricing and https://foragent.io/manual.

## Resources

- Website: https://foragent.io
- Pricing: https://foragent.io/pricing
- Manual: https://foragent.io/manual
- Official Plugin and Skill Repository: https://github.com/seankwon816/foragent-skills
