# SPDX-License-Identifier: Apache-2.0
"""A stand-in for api.github.com in deploy/test/gh-proxy.sh: answers every request with what it received (method,
path with query, headers) and with the kind of headers GitHub sends that the proxy must not pass on."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def _answer(self):
        body = json.dumps(
            {
                "total_count": 0,
                "incomplete_results": False,
                "items": [],
                "seen": {"method": self.command, "path": self.path, "headers": {k: v for k, v in self.headers.items()}},
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", "_gh_sess=secret; Path=/; HttpOnly")
        self.send_header("Cache-Control", "private, max-age=60, s-maxage=60")
        self.send_header("Content-Security-Policy", "default-src 'none'")
        self.send_header("X-RateLimit-Remaining", "29")
        self.send_header("X-GitHub-Request-Id", "ABCD:1234")
        self.send_header("X-OAuth-Scopes", "repo")
        self.send_header("ETag", 'W/"abc"')
        self.send_header("Link", '<https://api.github.com/search/issues?page=2>; rel="next"')
        self.end_headers()
        self.wfile.write(body)

    do_GET = _answer
    do_POST = _answer
    do_HEAD = _answer

    def log_message(self, *args):
        pass


HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
