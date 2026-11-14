"""A door for the iPhone Shortcut during local testing.

Listens on its own port on the Wi-Fi, writes down what arrives (never the key itself),
passes the request to the API on 127.0.0.1:8000 and returns the answer. The Shortcut posts
to http://<laptop address>:3200/api/save.

Why it exists: on 2026-11-14 a real iPhone Shortcut got an empty answer when it posted
through the Next.js web server's /api proxy, and the API never saw the request. Posting
through this door worked first time. It also prints each request, which is the quickest way
to see what a hand-built Shortcut is really sending. A deployed site doesn't need it: Caddy
sends /api straight to the API.

Run from server/, next to the API:
  python -m scripts.phone_door            # port 3200
  python -m scripts.phone_door 3300       # another port
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API = "http://127.0.0.1:8000"
sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)


def describe_auth(v: str | None) -> str:
    if v is None:
        return "none"
    s = v.strip()
    has_bearer = s.lower().startswith("bearer")
    key = s.split(None, 1)[1] if has_bearer and " " in s else s
    return f"present (bearer={has_bearer}, key starts rl_={key.strip().startswith('rl_')}, key length {len(key.strip())})"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _handle(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            body = b""
            while True:
                size = int(self.rfile.readline().strip() or b"0", 16)
                if size == 0:
                    self.rfile.readline()
                    break
                body += self.rfile.read(size)
                self.rfile.readline()
        stamp = time.strftime("%H:%M:%S")
        print(f"\n[{stamp}] {self.client_address[0]} {self.command} {self.path}")
        for k, v in self.headers.items():
            shown = describe_auth(v) if k.lower() == "authorization" else v[:120]
            print(f"    {k}: {shown}")
        try:
            parsed = json.loads(body.decode("utf-8", "replace")) if body else None
        except ValueError:
            parsed = None
        if isinstance(parsed, dict):
            print("    body is JSON with fields:", {k: (str(v)[:90] if k.lower() != "token" else "...") for k, v in parsed.items()})
        else:
            print(f"    body ({len(body)} bytes): {body[:200]!r}")

        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in ("host", "content-length", "transfer-encoding", "connection", "accept-encoding")}
        req = urllib.request.Request(API + self.path, data=body if self.command in ("POST", "PUT", "PATCH") else None,
                                     headers=headers, method=self.command)
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                status, out, ctype = r.status, r.read(), r.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            status, out, ctype = e.code, e.read(), e.headers.get("Content-Type", "application/json")
        except Exception as e:  # noqa: BLE001
            status, out, ctype = 502, json.dumps({"message": f"The door couldn't reach the API: {e}"}).encode(), "application/json"
        print(f"    -> API answered {status}: {out[:160].decode('utf-8', 'replace')}")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(out)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(out)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _handle

    def log_message(self, *args) -> None:  # the lines above are the log
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3200
    print(f"listening on 0.0.0.0:{port}, passing requests to {API}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
