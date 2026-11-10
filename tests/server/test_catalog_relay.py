import io
import struct
import zlib
import json
import sys
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from catalog_relay import CatalogRelay, RelayError, IMAGE_MAX
from serve_review import Handler

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
PNG = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)) +
       chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00')) + chunk(b'IEND', b''))
class Response(io.BytesIO):
    status = 200
    def __init__(self, body, mime):
        super().__init__(body)
        self.headers = {'Content-Type': mime}

class RelayTests(unittest.TestCase):
    def test_validation_and_ssrf(self):
        relay = CatalogRelay(opener=lambda *_: Response(b'{}', 'application/json'), spacing=0)
        invalid = [('/catalog/itunes/search', 'term=x&callback=alert'),
                   ('/catalog/itunes/search', 'term=x&country=GB'),
                   ('/catalog/itunes/search', 'term=x&limit=201'),
                   ('/catalog/itunes/lookup', 'id=9007199254740992'),
                   ('/catalog/itunes/lookup', 'id=1&entity=musicArtist'),
                   ('/catalog/artwork', urlencode({'u':'https://is1-ssl.mzstatic.com@127.0.0.1/x.png'})),
                   ('/catalog/artwork', urlencode({'u':'https://is1-ssl.mzstatic.com:443/x.png'})),
                   ('/catalog/artwork', urlencode({'u':'https://is1-ssl.mzstatic.com/x.mp3'})),
                   ('/catalog/artwork', urlencode({'u':'http://is1-ssl.mzstatic.com/x.png'}))]
        for path, query in invalid:
            with self.subTest(query=query), self.assertRaises(RelayError):
                relay.fetch(path, query)

    def test_valid_cache_singleflight_and_spacing(self):
        calls = []
        def opener(url, timeout):
            calls.append((url, time.monotonic()))
            time.sleep(.03)
            return Response(b'{"results":[]}', 'text/javascript')
        relay = CatalogRelay(opener=opener, spacing=.08)
        with ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(lambda _: relay.fetch('/catalog/itunes/search', 'term=x&entity=album'), range(5)))
        self.assertEqual(len(calls), 1)
        self.assertTrue(all(json.loads(x[1]) == {'results': []} for x in results))
        relay.fetch('/catalog/itunes/search', 'term=y&entity=album')
        self.assertGreaterEqual(calls[1][1] - calls[0][1], .075)
        self.assertTrue(calls[0][0].startswith('https://itunes.apple.com/search?'))

    def test_image_size_mime_and_timeout(self):
        q = urlencode({'u': 'https://is3-ssl.mzstatic.com/image.png'})
        relay = CatalogRelay(opener=lambda *_: Response(PNG, 'image/png'))
        self.assertEqual(relay.fetch('/catalog/artwork', q), ('image/png', PNG))
        for response in [Response(PNG + b'x' * IMAGE_MAX, 'image/png'), Response(b'audio', 'image/png')]:
            with self.assertRaises(RelayError):
                CatalogRelay(opener=lambda *_, r=response: r).fetch('/catalog/artwork', q)
        def timeout(*_):
            raise TimeoutError()
        with self.assertRaises(RelayError) as err:
            CatalogRelay(opener=timeout).fetch('/catalog/artwork', q)
        self.assertEqual(err.exception.status, 502)

    def test_http_status_sanitized(self):
        def opener(*_):
            raise HTTPError('https://example.invalid', 429, '', {'Retry-After':'7'}, None)
        with self.assertRaises(RelayError) as err:
            CatalogRelay(opener=opener).fetch('/catalog/itunes/search', 'term=x')
        self.assertEqual((err.exception.status, err.exception.retry_after), (429, '7'))

    def test_redirect_and_metadata_limits(self):
        def redirected(*_):
            raise HTTPError('https://itunes.apple.com/search', 302, '', {'Location': 'http://127.0.0.1/'}, None)
        for opener in (redirected, lambda *_: Response(b'{' + b' ' * (1024 * 1024) + b'}', 'application/json'),
                       lambda *_: Response(b'callback({})', 'text/javascript')):
            with self.assertRaises(RelayError) as err:
                CatalogRelay(opener=opener).fetch('/catalog/itunes/search', 'term=x')
            self.assertEqual(err.exception.status, 502)

    def test_bounded_flights(self):
        entered, release = threading.Event(), threading.Event()
        def opener(*_):
            entered.set()
            release.wait(2)
            return Response(b'{}', 'application/json')
        relay = CatalogRelay(opener=opener, spacing=0)
        with ThreadPoolExecutor(max_workers=9) as pool:
            first = pool.submit(relay.fetch, '/catalog/itunes/search', 'term=x')
            self.assertTrue(entered.wait(1))
            followers = [pool.submit(relay.fetch, '/catalog/itunes/search', 'term=x') for _ in range(7)]
            deadline = time.monotonic() + 1
            while relay.slots._value and time.monotonic() < deadline:
                time.sleep(.005)
            with self.assertRaises(RelayError) as err:
                relay.fetch('/catalog/itunes/search', 'term=x')
            self.assertEqual(err.exception.status, 503)
            release.set()
            first.result()
            for follower in followers:
                follower.result()

    def test_shared_cooldown_and_queue_timeout(self):
        for status in (429, 503):
            calls = []
            def opener(url, timeout):
                calls.append(url)
                raise HTTPError(url, status, '', {'Retry-After': '7'}, None)
            relay = CatalogRelay(opener=opener, spacing=0)
            with self.assertRaises(RelayError) as first:
                relay.fetch('/catalog/itunes/search', 'term=first')
            self.assertEqual(first.exception.status, status)
            with self.assertRaises(RelayError) as second:
                relay.fetch('/catalog/itunes/search', 'term=second')
            self.assertEqual(second.exception.status, 429)
            self.assertGreaterEqual(int(second.exception.retry_after), 1)
            self.assertEqual(len(calls), 1)
        calls = []
        relay = CatalogRelay(opener=lambda *args: calls.append(args), timeout=.05)
        relay.schedule.acquire()
        try:
            start = time.monotonic()
            with self.assertRaises(RelayError) as blocked:
                relay.fetch('/catalog/itunes/search', 'term=queued')
            self.assertEqual(blocked.exception.status, 503)
            self.assertLess(time.monotonic() - start, .5)
            self.assertFalse(calls)
        finally:
            relay.schedule.release()

    def test_distinct_metadata_requests_overlap_after_spacing(self):
        first_entered, second_entered, release = threading.Event(), threading.Event(), threading.Event()
        calls = []
        lock = threading.Lock()
        def opener(url, timeout):
            with lock:
                calls.append(time.monotonic())
                index = len(calls)
            if index == 1:
                first_entered.set()
                release.wait(2)
            else:
                second_entered.set()
            return Response(b'{}', 'application/json')
        relay = CatalogRelay(opener=opener, spacing=.08, timeout=1)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(relay.fetch, '/catalog/itunes/search', 'term=first')
            try:
                self.assertTrue(first_entered.wait(1))
                second = pool.submit(relay.fetch, '/catalog/itunes/search', 'term=second')
                self.assertTrue(second_entered.wait(.7), 'second upstream must start while first is blocked')
                self.assertGreaterEqual(calls[1] - calls[0], .075)
                second.result()
            finally:
                release.set()
            first.result()

    def test_browser_credentials_never_forwarded(self):
        captured = []
        class FakeOpener:
            def open(self, request, timeout):
                captured.append((request, timeout))
                return Response(b'{}', 'application/json')
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=Path('/tmp'), catalog_relay=CatalogRelay(spacing=0)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch('catalog_relay.build_opener', return_value=FakeOpener()):
                request = Request(f'http://127.0.0.1:{server.server_port}/catalog/itunes/search?term=example',
                                  headers={'Cookie': 'private=fixture', 'Authorization': 'Bearer fixture',
                                           'Proxy-Authorization': 'Basic fixture'})
                with urlopen(request) as response:
                    self.assertEqual(response.status, 200)
            self.assertEqual(len(captured), 1)
            upstream = captured[0][0]
            headers = {k.lower(): v for k, v in upstream.header_items()}
            self.assertNotIn('cookie', headers)
            self.assertNotIn('authorization', headers)
            self.assertNotIn('proxy-authorization', headers)
            self.assertEqual(headers['user-agent'], 'Pulso-Web prototype')
            self.assertTrue(upstream.full_url.startswith('https://itunes.apple.com/search?'))
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

    def test_server_config_default_and_enabled(self):
        for relay in (None, CatalogRelay(opener=lambda *_: Response(b'{"results":[]}', 'application/json'), spacing=0)):
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=Path('/tmp'), catalog_relay=relay))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            try:
                with urlopen(base + '/catalog-config.json') as resp:
                    self.assertEqual(json.load(resp), {'version':1, 'itunes':relay is not None, 'artwork':relay is not None})
                    self.assertEqual(resp.headers['Cache-Control'], 'no-store')
                if relay is None:
                    with self.assertRaises(HTTPError) as err:
                        urlopen(base + '/catalog/itunes/search?term=x')
                    self.assertEqual(err.exception.code, 404)
                else:
                    with urlopen(base + '/catalog/itunes/search?term=x') as resp:
                        self.assertEqual(json.load(resp), {'results':[]})
            finally:
                server.shutdown()
                thread.join()
                server.server_close()

if __name__ == '__main__':
    unittest.main()
