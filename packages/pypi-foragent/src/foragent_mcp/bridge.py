"""Bidirectional MCP stdio-to-Streamable-HTTP bridge built on the official mcp SDK."""

from __future__ import annotations

import os
import sys

import anyio
from mcp.client.auth import OAuthClientProvider
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client
from mcp.server.stdio import stdio_server
from mcp.shared.auth import OAuthClientMetadata
from mcp.shared.message import SessionMessage

from .auth import FileTokenStorage, LoopbackCallbackServer

DEFAULT_MCP_URL = "https://foragent.io/mcp"


async def run_bridge(mcp_url: str = DEFAULT_MCP_URL) -> None:
    target_url = mcp_url or os.environ.get("FORAGENT_MCP_URL") or DEFAULT_MCP_URL
    static_token = os.environ.get("FORAGENT_ACCESS_TOKEN")

    callback_server: LoopbackCallbackServer | None = None
    headers: dict[str, str] | None = None
    oauth_provider: OAuthClientProvider | None = None

    if static_token:
        headers = {"Authorization": f"Bearer {static_token}"}
    else:
        callback_server = LoopbackCallbackServer()
        storage = FileTokenStorage(target_url)
        client_metadata = OAuthClientMetadata(
            client_name="ForAgent MCP Bridge (PyPI)",
            client_uri="https://foragent.io",
            redirect_uris=[callback_server.redirect_uri],
            grant_types=["authorization_code", "refresh_token"],
            response_types=["code"],
            token_endpoint_auth_method="none",
        )
        oauth_provider = OAuthClientProvider(
            server_url=target_url,
            client_metadata=client_metadata,
            storage=storage,
            redirect_handler=callback_server.redirect_handler,
            callback_handler=callback_server.callback_handler,
        )

    try:
        async with create_mcp_http_client(headers=headers, auth=oauth_provider) as http_client:
            async with streamable_http_client(target_url, http_client=http_client) as (
                remote_read,
                remote_write,
            ):
                async with stdio_server() as (stdio_read, stdio_write):
                    async with anyio.create_task_group() as tg:
                        async def forward_stdio_to_remote() -> None:
                            async with remote_write:
                                async for item in stdio_read:
                                    if isinstance(item, Exception):
                                        sys.stderr.write("[foragent] Invalid MCP input.\n")
                                        sys.stderr.flush()
                                        continue
                                    await remote_write.send(item)
                            tg.cancel_scope.cancel()

                        async def forward_remote_to_stdio() -> None:
                            async with stdio_write:
                                async for item in remote_read:
                                    if isinstance(item, Exception):
                                        sys.stderr.write("[foragent] Remote MCP transport error.\n")
                                        sys.stderr.flush()
                                        continue
                                    if isinstance(item, SessionMessage):
                                        await stdio_write.send(item)

                        tg.start_soon(forward_stdio_to_remote)
                        tg.start_soon(forward_remote_to_stdio)
    finally:
        if callback_server is not None:
            callback_server.close()
