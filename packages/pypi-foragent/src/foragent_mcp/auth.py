"""File-backed OAuth 2.1 TokenStorage and loopback callback flow for ForAgent."""

from __future__ import annotations

import hashlib
import json
import os
import queue
import sys
import tempfile
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import anyio
from mcp.client.auth import TokenStorage
from mcp.shared.auth import (
    AuthorizationCodeResult,
    OAuthClientInformationFull,
    OAuthToken,
)


def get_auth_store_path() -> Path:
    override = os.environ.get("FORAGENT_AUTH_FILE")
    if override:
        return Path(override)
    xdg = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg) / "foragent" if xdg else Path.home() / ".config" / "foragent"
    return base / "bridge-auth-py.json"


def clear_auth_store(path: Path | None = None) -> Path:
    target = path or get_auth_store_path()
    try:
        target.unlink()
    except FileNotFoundError:
        pass
    return target


class FileTokenStorage(TokenStorage):
    """Stores OAuth tokens and dynamic client info per MCP URL with 0600 perms."""

    def __init__(self, mcp_url: str, path: Path | None = None) -> None:
        self.store_key = hashlib.sha256(mcp_url.encode()).hexdigest()
        self.path = path or get_auth_store_path()

    def _read_all(self) -> dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return {}

    def _write_all(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent, delete=False) as stream:
            tmp = Path(stream.name)
            try:
                json.dump(data, stream)
                stream.close()
                tmp.replace(self.path)
            finally:
                tmp.unlink(missing_ok=True)

    async def get_tokens(self) -> OAuthToken | None:
        raw = self._read_all().get(self.store_key, {}).get("tokens")
        return OAuthToken.model_validate(raw) if raw else None

    async def set_tokens(self, tokens: OAuthToken) -> None:
        store = self._read_all()
        entry = store.setdefault(self.store_key, {})
        entry["tokens"] = tokens.model_dump(mode="json", exclude_none=True)
        self._write_all(store)

    async def get_client_info(self) -> OAuthClientInformationFull | None:
        raw = self._read_all().get(self.store_key, {}).get("client_info")
        return OAuthClientInformationFull.model_validate(raw) if raw else None

    async def set_client_info(self, client_info: OAuthClientInformationFull) -> None:
        store = self._read_all()
        entry = store.setdefault(self.store_key, {})
        entry["client_info"] = client_info.model_dump(mode="json", exclude_none=True)
        self._write_all(store)


class LoopbackCallbackServer:
    """Ephemeral 127.0.0.1 HTTP server capturing the OAuth authorization code."""

    def __init__(self, timeout_seconds: float = 180.0) -> None:
        self.timeout_seconds = timeout_seconds
        self._result_queue: queue.Queue[AuthorizationCodeResult | Exception] = queue.Queue(maxsize=1)
        self.authorization_url: str | None = None
        self.expected_state: str | None = None
        callback = self
        result_queue = self._result_queue

        class CallbackHandler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                parsed = urlparse(self.path)
                if parsed.path == "/sign-in" and callback.authorization_url:
                    self.send_response(302)
                    self.send_header("Location", callback.authorization_url)
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Referrer-Policy", "no-referrer")
                    self.end_headers()
                    return
                if parsed.path != "/callback":
                    self.send_response(404)
                    self.end_headers()
                    self.wfile.write(b"Not found")
                    return
                params = parse_qs(parsed.query)
                error = params.get("error", [None])[0]
                code = params.get("code", [None])[0]
                state = params.get("state", [None])[0]
                iss = params.get("iss", [None])[0]

                if not state or state != callback.expected_state:
                    self._send_html(400, "Invalid sign-in response.")
                    return
                if error:
                    self._send_html(
                        400,
                        "<h2>ForAgent sign-in was cancelled.</h2><p>You can close this tab.</p>",
                    )
                    self._put_once(RuntimeError("Authorization was declined."))
                    return

                if not code:
                    self._send_html(
                        400,
                        "<h2>Invalid sign-in response.</h2><p>Please retry from your AI app.</p>",
                    )
                    return

                self._send_html(
                    200,
                    "<h2>Sign-in response received.</h2><p>You can close this tab and return to your AI app.</p>",
                )
                self._put_once(AuthorizationCodeResult(code=code, state=state, iss=iss))

            def _send_html(self, status: int, body: str) -> None:
                payload = f"<!doctype html><html><body>{body}</body></html>".encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def _put_once(self, item: AuthorizationCodeResult | Exception) -> None:
                try:
                    result_queue.put_nowait(item)
                except queue.Full:
                    pass

            def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
                return

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), CallbackHandler)
        self.port = self._server.server_address[1]
        self.redirect_uri = f"http://127.0.0.1:{self.port}/callback"
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    async def redirect_handler(self, authorization_url: str) -> None:
        self.authorization_url = authorization_url
        self.expected_state = parse_qs(urlparse(authorization_url).query).get("state", [None])[0]
        local_url = f"http://127.0.0.1:{self.port}/sign-in"
        sys.stderr.write(f"[foragent] Sign in to ForAgent in your browser: {local_url}\n")
        sys.stderr.flush()
        if os.environ.get("FORAGENT_NO_BROWSER") != "1":
            try:
                webbrowser.open(local_url)
            except Exception:
                pass

    async def callback_handler(self) -> AuthorizationCodeResult:
        def _wait() -> AuthorizationCodeResult:
            try:
                item = self._result_queue.get(timeout=self.timeout_seconds)
            except queue.Empty as exc:
                raise TimeoutError("Timed out waiting for ForAgent browser sign-in.") from exc
            if isinstance(item, Exception):
                raise item
            return item

        return await anyio.to_thread.run_sync(_wait)

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()
