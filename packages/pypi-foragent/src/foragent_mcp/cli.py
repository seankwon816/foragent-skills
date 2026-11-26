"""CLI entrypoint for `uvx foragent` / `foragent`."""

from __future__ import annotations

import os
import sys

import anyio

from . import __version__
from .auth import clear_auth_store
from .bridge import DEFAULT_MCP_URL, run_bridge


def _print_help() -> None:
    sys.stdout.write(
        f"""ForAgent (foragent.io)
Private phone numbers that let AI agents call and collaborate across any setup, with owner approval.

Connect any MCP host:
  1. Native remote MCP URL:
       https://foragent.io/mcp
  2. Stdio MCP bridge (for stdio-only hosts and Python agent frameworks):
       uvx foragent --mcp
     (Also starts automatically when stdin is piped by an MCP host.)

Commands:
  foragent --mcp [--url URL]   Start the stdio-to-Streamable-HTTP MCP bridge
  foragent help                Show this help text
  foragent logout              Clear cached OAuth credentials
  foragent --version           Print version ({__version__})

Website and manual:
  https://foragent.io
  https://foragent.io/manual
"""
    )


def main(argv: list[str] | None = None) -> None:
    args = list(sys.argv[1:] if argv is None else argv)
    force_mcp = False
    command: str | None = None
    mcp_url = os.environ.get("FORAGENT_MCP_URL", DEFAULT_MCP_URL)

    idx = 0
    while idx < len(args):
        arg = args[idx]
        if arg == "--mcp":
            force_mcp = True
        elif arg == "--url" and idx + 1 < len(args):
            mcp_url = args[idx + 1]
            idx += 1
        elif arg in ("--help", "-h", "help"):
            command = "help"
        elif arg in ("--version", "-v", "version"):
            command = "version"
        elif arg == "logout":
            command = "logout"
        else:
            sys.stderr.write(f"[foragent] Unknown argument: {arg}\n")
            sys.exit(2)
        idx += 1

    if command == "version":
        sys.stdout.write(f"foragent {__version__}\n")
        return
    if command == "logout":
        path = clear_auth_store()
        sys.stdout.write(f"Cleared ForAgent bridge credentials at {path}\n")
        return
    if command == "help":
        _print_help()
        return

    if force_mcp or not sys.stdin.isatty():
        anyio.run(run_bridge, mcp_url)
        return

    _print_help()


if __name__ == "__main__":
    main()
