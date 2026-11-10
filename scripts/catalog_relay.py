"""Bounded, opt-in public catalogue relay for the private review server."""
import json
import math
import re
import threading
import time
from collections import OrderedDict
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_ID = 9007199254740991
IMAGE_MAX = 2 * 1024 * 1024
JSON_MAX = 1024 * 1024

class RelayError(Exception):
    def __init__(self, status, retry_after=None):
        self.status, self.retry_after = status, retry_after

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def open_upstream(url, timeout):
    return build_opener(NoRedirect()).open(Request(url, headers={'User-Agent': 'Pulso-Web prototype', 'Accept': 'application/json, image/png, image/jpeg, image/webp'}), timeout=timeout)

def params(query):
    try:
        pairs = parse_qsl(query, keep_blank_values=True, strict_parsing=True, max_num_fields=8)
    except ValueError:
        raise RelayError(400)
    result = dict(pairs)
    if len(result) != len(pairs):
        raise RelayError(400)
    return result

def metadata_url(path, query):
    p = params(query)
    allowed = {'term', 'country', 'media', 'entity', 'limit'} if path.endswith('/search') else {'id', 'country', 'media', 'entity', 'limit'}
    if set(p) - allowed:
        raise RelayError(400)
    if path.endswith('/search'):
        if not p.get('term') or len(p['term']) > 300 or any(ord(c) < 32 for c in p['term']):
            raise RelayError(400)
    elif not re.fullmatch(r'[0-9]{1,16}', p.get('id', '')) or not 0 < int(p['id']) <= MAX_ID:
        raise RelayError(400)
    if p.get('country', 'US') != 'US' or p.get('media', 'music') != 'music':
        raise RelayError(400)
    p['country'] = 'US'
    entities = {'album', 'musicArtist', 'song'} if path.endswith('/search') else {'album', 'song'}
    if 'entity' in p and p['entity'] not in entities:
        raise RelayError(400)
    if 'limit' in p and (not re.fullmatch(r'[0-9]{1,3}', p['limit']) or not 1 <= int(p['limit']) <= 200):
        raise RelayError(400)
    return 'https://itunes.apple.com/' + path.rsplit('/', 1)[1] + '?' + urlencode(sorted(p.items()))

def artwork_url(query):
    p = params(query)
    if set(p) != {'u'}:
        raise RelayError(400)
    try:
        u = urlsplit(p['u'])
    except ValueError:
        raise RelayError(400) from None
    if (u.scheme != 'https' or not re.fullmatch(r'is[1-5]-ssl\.mzstatic\.com', u.netloc)
            or not u.path.startswith('/') or not re.search(r'\.(?:jpe?g|png|webp)$', u.path, re.I)
            or u.fragment or u.query or '%' in u.netloc or '\\' in u.path):
        raise RelayError(400)
    return p['u']

class CatalogRelay:
    def __init__(self, opener=open_upstream, spacing=3.1, timeout=10, clock=time.monotonic, sleep=time.sleep):
        self.opener, self.spacing, self.timeout, self.clock, self.sleep = opener, spacing, timeout, clock, sleep
        self.lock = threading.Lock()
        self.schedule = threading.Lock()
        self.slots = threading.BoundedSemaphore(8)
        self.last_metadata = None
        self.cooldown_until = 0
        self.cache = OrderedDict()
        self.inflight = {}

    def fetch(self, path, query):
        image = path == '/catalog/artwork'
        if not image and path not in ('/catalog/itunes/search', '/catalog/itunes/lookup'):
            raise RelayError(404)
        url = artwork_url(query) if image else metadata_url(path, query)
        key = (image, url)
        with self.lock:
            cached = self.cache.get(key)
            if cached and cached[0] > self.clock():
                self.cache.move_to_end(key)
                return cached[1]
            self.cache.pop(key, None)
            flight = self.inflight.get(key)
            if flight is None:
                if not self.slots.acquire(blocking=False):
                    raise RelayError(503, '5')
                flight = {'event': threading.Event()}
                self.inflight[key] = flight
                leader = True
            else:
                if not self.slots.acquire(blocking=False):
                    raise RelayError(503, '5')
                leader = False
        if not leader:
            try:
                if not flight['event'].wait(self.timeout + 2):
                    raise RelayError(503, '5')
                if 'error' in flight:
                    raise flight['error']
                return flight['value']
            finally:
                self.slots.release()
        try:
            deadline = self.clock() + self.timeout
            if not image:
                if not self.schedule.acquire(timeout=min(6, self.timeout)):
                    raise RelayError(503, '5')
                try:
                    now = self.clock()
                    with self.lock:
                        cooldown = self.cooldown_until - now
                    if cooldown > 0:
                        raise RelayError(429, str(math.ceil(cooldown)))
                    if self.last_metadata is not None:
                        delay = max(0, self.last_metadata + self.spacing - now)
                        if self.clock() + delay >= deadline:
                            raise RelayError(503, '5')
                        self.sleep(delay)
                    with self.lock:
                        cooldown = self.cooldown_until - self.clock()
                    if cooldown > 0:
                        raise RelayError(429, str(math.ceil(cooldown)))
                    self.last_metadata = self.clock()
                finally:
                    self.schedule.release()
            value = self._load(url, image, deadline)
            with self.lock:
                self.cache[key] = (self.clock() + 300, value)
                self.cache.move_to_end(key)
                limit = 16 if image else 32
                while sum(k[0] == image for k in self.cache) > limit:
                    self.cache.pop(next(k for k in self.cache if k[0] == image))
                flight['value'] = value
            return value
        except RelayError as exc:
            if not image and exc.status in (429, 503):
                delay = int(exc.retry_after) if exc.retry_after and exc.retry_after.isdigit() else 60
                with self.lock:
                    self.cooldown_until = max(self.cooldown_until, self.clock() + max(3.1, min(delay, 3600)))
            flight['error'] = exc
            raise
        except Exception:
            flight['error'] = RelayError(502)
            raise flight['error'] from None
        finally:
            with self.lock:
                self.inflight.pop(key, None)
                flight['event'].set()
                self.slots.release()

    def _load(self, url, image, deadline):
        try:
            remaining = deadline - self.clock()
            if remaining <= 0:
                raise RelayError(503, '5')
            # A socket read cannot consume a fresh full deadline after queuing.
            with self.opener(url, min(2, remaining)) as response:
                status = response.status
                if status != 200:
                    raise RelayError(502)
                mime = response.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
                limit = IMAGE_MAX if image else JSON_MAX
                chunks, size = [], 0
                while True:
                    if self.clock() >= deadline:
                        raise RelayError(502)
                    reader = getattr(response, 'read1', response.read)
                    chunk = reader(min(65536, limit + 1 - size))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    size += len(chunk)
                    if size > limit:
                        raise RelayError(502)
                raw = b''.join(chunks)
                if len(raw) > limit:
                    raise RelayError(502)
                if image:
                    valid = ((mime == 'image/png' and raw.startswith(b'\x89PNG\r\n\x1a\n')) or
                             (mime == 'image/jpeg' and raw.startswith(b'\xff\xd8\xff')) or
                             (mime == 'image/webp' and raw.startswith(b'RIFF') and raw[8:12] == b'WEBP'))
                    if not valid:
                        raise RelayError(502)
                    return mime, raw
                if mime not in ('application/json', 'text/json', 'text/javascript'):
                    raise RelayError(502)
                value = json.loads(raw.decode('utf-8'))
                if not isinstance(value, dict):
                    raise RelayError(502)
                encoded = json.dumps(value, ensure_ascii=True, separators=(',', ':'), allow_nan=False).encode()
                if len(encoded) > JSON_MAX:
                    raise RelayError(502)
                return 'application/json', encoded
        except HTTPError as exc:
            if exc.code in (429, 503):
                retry = exc.headers.get('Retry-After', '') if exc.headers else ''
                raise RelayError(exc.code, retry if re.fullmatch(r'[0-9]{1,4}', retry) and int(retry) <= 3600 else None) from None
            raise RelayError(exc.code if 400 <= exc.code <= 599 else 502) from None
        except (URLError, TimeoutError, OSError, UnicodeError, ValueError, RecursionError):
            raise RelayError(502) from None
