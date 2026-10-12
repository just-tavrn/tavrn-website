# SPDX-License-Identifier: Apache-2.0
"""A stand-in for api.github.com in deploy/test/gh-proxy.sh. Every request is answered with what it received (method,
path with query, headers) and with the kind of headers GitHub sends that the proxy must not pass on. The one
exception is the release list the update feeds read (/repos/<org>/tavrn-web/releases?per_page=100): it answers a fixed
release list chosen by the token, so the test knows which release each channel must pick."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

FEEDS = ["latest.json", "latest.yml", "latest.yml.minisig", "latest-linux.yml", "latest-linux.yml.minisig"]


def release(tag, prerelease=False, draft=False, assets=FEEDS):
    v = tag.lstrip("v")
    names = list(assets) + [f"tavrn-web-{v}.tar.gz"]
    return {
        "tag_name": tag,
        "draft": draft,
        "prerelease": prerelease,
        "body": "notes",
        "assets": [
            {"name": n, "browser_download_url": f"https://github.com/example-org/tavrn-web/releases/download/{tag}/{n}"}
            for n in names
        ],
    }


# Deliberately not in version order. Expected (gh-proxy.sh): stable latest.json v0.5.1, latest.yml and
# latest-linux.yml v0.5.0; beta latest.json v0.5.1 (a release counts for beta too), the two .yml v0.5.1-rc.10.
RELEASES = {
    "faketoken_for_tests": [
        release("v0.4.2"),
        release("v0.6.0", draft=True),  # a draft never counts
        release("v0.5.2-rc.1", prerelease=True, assets=[]),  # web only: no feed
        release("v0.5.1-rc.9", prerelease=True),
        release("v0.5.1", assets=["latest.json"]),  # only the Windows feed so far
        release("v0.5.1-rc.10", prerelease=True),  # rc.10 > rc.9: numeric identifiers compare as numbers
        release("v0.5.0"),
        release("nightly", prerelease=True),  # not a version tag
        release('v9.9.9-rc.1"x', prerelease=True),  # characters a tag in a URL must not have
        release("v9.9.9", prerelease=False, assets=["Latest.json", "latest.json.bak"]),  # no feed by that exact name
    ],
    # Only pre-releases: the stable channel has no release.
    "faketoken_prereleases_only": [release("v0.5.0-rc.2", prerelease=True), release("v0.5.0-rc.1", prerelease=True)],
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload, github_headers=True):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if github_headers:
            self.send_header("Set-Cookie", "_gh_sess=secret; Path=/; HttpOnly")
            self.send_header("Cache-Control", "private, max-age=60, s-maxage=60")
            self.send_header("Content-Security-Policy", "default-src 'none'")
            self.send_header("X-RateLimit-Remaining", "29")
            self.send_header("X-GitHub-Request-Id", "ABCD:1234")
            self.send_header("X-OAuth-Scopes", "repo")
            self.send_header("ETag", 'W/"abc"')
            self.send_header("Link", '<https://api.github.com/search/issues?page=2>; rel="next"')
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _answer(self):
        if self.path.endswith("/tavrn-web/releases?per_page=100"):
            token = (self.headers.get("Authorization") or "").removeprefix("Bearer ")
            if self.command == "GET" and token in RELEASES and self.headers.get("Accept") == "application/vnd.github+json":
                self._send(200, RELEASES[token])
            else:
                self._send(401, {"message": "Bad credentials", "documentation_url": "https://docs.github.com/rest"})
            return
        self._send(
            200,
            {
                "total_count": 0,
                "incomplete_results": False,
                "items": [],
                "seen": {"method": self.command, "path": self.path, "headers": {k: v for k, v in self.headers.items()}},
            },
        )

    do_GET = _answer
    do_POST = _answer
    do_HEAD = _answer

    def log_message(self, *args):
        pass


HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
