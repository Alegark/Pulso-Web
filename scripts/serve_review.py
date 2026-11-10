#!/usr/bin/env python3
"""Read-only server for a frozen Pulso build; loopback only, no publishing."""
import argparse
import mimetypes
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

if __package__:
    from .catalog_relay import CatalogRelay, RelayError
else:
    from catalog_relay import CatalogRelay, RelayError
import json

PROJECT = Path(__file__).resolve().parent.parent
REVIEW = PROJECT / '.local' / 'review'

class Handler(BaseHTTPRequestHandler):
    def __init__(self, *args, directory, catalog_relay=None, **kwargs):
        self.directory = directory
        self.catalog_relay = catalog_relay
        super().__init__(*args, **kwargs)

    def log_message(self, *_):
        pass  # No request paths, queries, private-link tokens or user content in logs.

    def do_GET(self):
        self.respond(False)

    def do_HEAD(self):
        self.respond(True)

    def relay_response(self, status, mime, body, head, retry_after=None):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        if retry_after:
            self.send_header('Retry-After', retry_after)
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def respond(self, head):
        parsed = urlsplit(self.path)
        path = unquote(parsed.path)
        if path == '/catalog-config.json':
            enabled = self.catalog_relay is not None
            self.relay_response(200, 'application/json', json.dumps({'version': 1, 'itunes': enabled, 'artwork': enabled}).encode(), head)
            return
        if path.startswith('/catalog/'):
            if not self.catalog_relay:
                self.relay_response(404, 'application/json', b'{}', head)
                return
            if head:
                self.relay_response(405, 'application/json', b'{}', head)
                return
            try:
                mime, body = self.catalog_relay.fetch(path, parsed.query)
                self.relay_response(200, mime, body, head)
            except RelayError as error:
                self.relay_response(error.status, 'application/json', b'{}', head, error.retry_after)
            return
        parts = path.split('/')
        if any(part.startswith('.') for part in parts if part) or '\\' in path or '\x00' in path:
            self.send_error(404)
            return
        target = self.directory / (path.lstrip('/') or 'index.html')
        try:
            resolved = target.resolve(strict=True)
            resolved.relative_to(self.directory)
            if target.is_symlink() or not resolved.is_file():
                raise ValueError('not a regular file')
        except (OSError, ValueError):
            self.send_error(404)
            return
        length = resolved.stat().st_size
        start, end, status = 0, length, 200
        header = self.headers.get('Range') if not head else None
        if header and ',' not in header:
            import re
            match = re.fullmatch(r'bytes=(\d*)-(\d*)', header)
            if not match or not any(match.groups()):
                self.send_error(400)
                return
            first, last = match.groups()
            if not first:
                suffix = int(last)
                start = max(0, length - suffix)
            else:
                start = int(first)
                end = min(length, int(last) + 1) if last else length
            if start >= end or start >= length:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{length}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            status = 206
        mime = {'m4a': 'audio/mp4', 'js': 'text/javascript'}.get(resolved.suffix[1:]) or mimetypes.guess_type(resolved.name)[0] or 'application/octet-stream'
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(end - start))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-store' if resolved.name == 'telegram-config.json' else 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        policy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        if resolved.suffix == '.html':
            policy = policy.replace("connect-src 'self';", "connect-src 'self' https://lrclib.net https://itunes.apple.com https://is1-ssl.mzstatic.com https://is2-ssl.mzstatic.com https://is3-ssl.mzstatic.com https://is4-ssl.mzstatic.com https://is5-ssl.mzstatic.com;")
        if resolved.name.startswith('session.worker-') and resolved.suffix == '.js':
            # Only this dedicated worker can open the five SDK WebSocket origins.
            # The document, import workers and SW keep the existing policy.
            policy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' wss://pluto.web.telegram.org wss://venus.web.telegram.org wss://aurora.web.telegram.org wss://vesta.web.telegram.org wss://flora.web.telegram.org; object-src 'none'; base-uri 'none'"
        self.send_header('Content-Security-Policy', policy)
        if resolved.name == 'sw.js':
            self.send_header('Service-Worker-Allowed', '/')
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end - 1}/{length}')
        self.end_headers()
        if not head:
            with resolved.open('rb') as stream:
                stream.seek(start)
                remaining = end - start
                while remaining:
                    data = stream.read(min(65536, remaining))
                    if not data:
                        break
                    self.wfile.write(data)
                    remaining -= len(data)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=REVIEW / 'iphone-v1')
    parser.add_argument('--port', type=int, default=4175)
    parser.add_argument('--catalog-relay', action='store_true')
    args = parser.parse_args()
    directory = args.directory.resolve(strict=True)
    directory.relative_to(REVIEW.resolve(strict=True))
    if not (directory / 'index.html').is_file():
        parser.error('Frozen review directory must contain index.html')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=directory, catalog_relay=CatalogRelay() if args.catalog_relay else None))
    print(f'Review server listening on loopback port {server.server_address[1]}; NOT published.', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
