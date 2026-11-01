import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORGANIZATION_LIMITS as L, OrganizationFormatError, parseOrganization,
  serializeOrganization, validateOrganization,
  type OrganizationExport, type OrganizationRef, type OrganizationTrack,
} from '../../src/library/organization-format';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const libraryId = id(1);
const ref = (n: number): OrganizationRef => ({ libraryId, id: id(n) });
const track = (n = 2): OrganizationTrack => ({
  ref: ref(n), title: 'Canción', artist: null, album: null, duration: 1.25,
  createdAt: '2026-10-31T00:00:00.000Z', manualOverrides: {}, audio: null,
});
function fixture(): OrganizationExport {
  return {
    format: 'pulso-web-organization', version: 1, exportId: id(3), libraryId,
    exportedAt: '2026-10-31T00:00:00Z', tracks: [track()], favorites: [ref(2)],
    playlists: [{ ref: ref(4), name: 'Lista', entries: [{ id: id(5), track: ref(2) }] }],
  };
}
function rejects(run: () => unknown, code: string) {
  assert.throws(run, (error: unknown) => error instanceof OrganizationFormatError && error.code === code);
}
function bad(change: (dto: OrganizationExport) => void, code = 'format') {
  const dto = fixture(); change(dto); rejects(() => validateOrganization(dto), code);
}

test('roundtrip uses explicit DTO fields, fresh objects and preserves Unicode/CRLF/order/inert text', () => {
  const dto = fixture();
  dto.tracks.push(track(6));
  dto.tracks[0].title = 'ñ e\u0301 😀\r\n<script>javascript:alert(1)</script>';
  dto.tracks[0].artist = '<img src=x onerror=alert(1)>';
  dto.tracks[0].manualOverrides = { title: dto.tracks[0].title, artist: dto.tracks[0].artist, album: null };
  dto.playlists[0].entries.unshift({ id: id(7), track: ref(6) });
  const before = structuredClone(dto);
  const json = serializeOrganization(dto), parsed = parseOrganization(json);
  assert.deepEqual(parsed, before);
  assert.deepEqual(dto, before);
  assert.notEqual(parsed, dto);
  assert.notEqual(parsed.tracks[0].ref, dto.tracks[0].ref);
  assert.notEqual(parsed.tracks[0].manualOverrides, dto.tracks[0].manualOverrides);
  assert.equal(serializeOrganization(parsed), json);
  assert.equal(json.includes('audioId'), false);
});

test('validation and serialization accept frozen input without mutating it', () => {
  function freeze(value: unknown) {
    if (!value || typeof value !== 'object') return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  const dto = fixture(); freeze(dto);
  assert.deepEqual(validateOrganization(dto), dto);
  assert.deepEqual(parseOrganization(serializeOrganization(dto)), dto);
});

test('fingerprints are optional byte evidence, never track identity or title deduplication', () => {
  const dto = fixture();
  dto.tracks.push(track(6), track(7));
  dto.tracks[0].audio = { algorithm: 'sha256', sha256: 'a'.repeat(64), bytes: 1 };
  dto.tracks[1].audio = { algorithm: 'sha256', sha256: 'b'.repeat(64), bytes: L.audioBytes };
  dto.tracks[2].audio = { algorithm: 'sha256', sha256: 'a'.repeat(64), bytes: 1 };
  assert.equal(parseOrganization(serializeOrganization(dto)).tracks.length, 3);
  for (const audio of [
    { algorithm: 'SHA256', sha256: 'a'.repeat(64), bytes: 1 },
    { algorithm: 'sha256', sha256: 'A'.repeat(64), bytes: 1 },
    { algorithm: 'sha256', sha256: 'a'.repeat(63), bytes: 1 },
    { algorithm: 'sha256', sha256: 'a'.repeat(64) + '\n', bytes: 1 },
    { algorithm: 'sha256', sha256: 'a'.repeat(64), bytes: 0 },
    { algorithm: 'sha256', sha256: 'a'.repeat(64), bytes: 1.5 },
  ]) bad(d => { d.tracks[0].audio = audio as OrganizationTrack['audio']; });
  bad(d => { d.tracks[0].audio = { algorithm: 'sha256', sha256: 'a'.repeat(64), bytes: L.audioBytes + 1 }; }, 'limits');
});

test('closed keys at every object reject storage/private fields rather than leaking them', () => {
  const fields = ['audioId', 'assetId', 'storageKey', 'revision', 'localRevision', 'manifest', 'queue',
    'settings', 'session', 'ticket', 'url', 'locator', 'provider', 'lyrics', 'artwork', 'albums', 'artists'];
  for (const field of fields) {
    const dto = fixture();
    Object.assign(dto, { [field]: 'forbidden sentinel' });
    rejects(() => parseOrganization(JSON.stringify(dto)), 'format');
    rejects(() => serializeOrganization(dto), 'format');
  }
  for (const select of [
    (d: OrganizationExport) => d.tracks[0], (d: OrganizationExport) => d.tracks[0].ref,
    (d: OrganizationExport) => d.tracks[0].manualOverrides, (d: OrganizationExport) => d.favorites[0],
    (d: OrganizationExport) => d.playlists[0], (d: OrganizationExport) => d.playlists[0].ref,
    (d: OrganizationExport) => d.playlists[0].entries[0], (d: OrganizationExport) => d.playlists[0].entries[0].track,
  ]) bad(d => { Object.assign(select(d), { storageKey: 'sentinel' }); });
  bad(d => { d.tracks[0].audio = Object.assign({ algorithm: 'sha256' as const, sha256: 'a'.repeat(64), bytes: 1 }, { storageKey: 'sentinel' }); });
});

test('own __proto__, prototype objects, accessors and toJSON are rejected without executing them', () => {
  const raw = JSON.stringify(fixture());
  rejects(() => parseOrganization(raw.replace('{', '{"__proto__":{"polluted":true},')), 'format');
  rejects(() => parseOrganization(raw.replace('"manualOverrides":{}', '"manualOverrides":{"__proto__":null}')), 'format');
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
  let calls = 0;
  const dto = fixture();
  Object.defineProperty(dto.tracks[0], 'title', { get() { calls++; throw new Error('executed'); } });
  rejects(() => serializeOrganization(dto), 'format');
  const withToJSON = Object.assign(fixture(), { toJSON() { calls++; return {}; } });
  rejects(() => serializeOrganization(withToJSON), 'format');
  rejects(() => validateOrganization(Object.create(fixture())), 'format');
  assert.equal(calls, 0);
});

test('syntax, discriminator and unsupported versions have distinct errors', () => {
  for (const json of ['{', '', 'null', '[]', 'true', '{"format":"pulso-web-organization"}']) rejects(() => parseOrganization(json), 'format');
  bad(d => { (d as { format: string }).format = 'other'; });
  for (const version of [0, 3, 999, '1', null]) bad(d => { Object.assign(d, { version }); }, 'version');
});

test('metadata/duration/override validation: exact character limits and effective values', () => {
  const dto = fixture();
  dto.tracks[0].title = 'a'.repeat(L.metadataCharacters);
  dto.tracks[0].artist = 'é'.repeat(L.metadataCharacters);
  dto.tracks[0].album = '😀'.repeat(L.metadataCharacters / 2);
  dto.playlists[0].name = 'n'.repeat(L.playlistCharacters);
  dto.tracks[0].manualOverrides = { title: dto.tracks[0].title, artist: dto.tracks[0].artist, album: dto.tracks[0].album };
  assert.deepEqual(validateOrganization(dto), dto);
  for (const field of ['title', 'artist', 'album'] as const) bad(d => { d.tracks[0][field] = 'a'.repeat(L.metadataCharacters + 1); }, 'limits');
  bad(d => { d.playlists[0].name = 'a'.repeat(L.playlistCharacters + 1); }, 'limits');
  for (const title of ['', ' \r\n\t']) bad(d => { d.tracks[0].title = title; });
  bad(d => { d.playlists[0].name = ' '; });
  for (const duration of [0, -1, NaN, Infinity, -Infinity]) bad(d => { d.tracks[0].duration = duration; });
  for (const manualOverrides of [{ title: '' }, { title: null }, { artist: 'different' }, { album: 'different' }, { artist: undefined }]) {
    bad(d => { Object.assign(d.tracks[0], { manualOverrides }); });
  }
  assert.doesNotThrow(() => validateOrganization(Object.assign(fixture(), { tracks: [{ ...track(), manualOverrides: { artist: null, album: null } }] })));
});

test('full UUID structure in every identity/reference, canonical case and pair identity', () => {
  for (const value of ['a'.repeat(36), '--------' + '0'.repeat(28), id(2) + 'x', 'x' + id(2), id(2).replace('-', '_'), id(2) + '\n']) {
    bad(d => { d.exportId = value; });
    bad(d => { d.libraryId = value; });
    bad(d => { d.tracks[0].ref.id = value; });
    bad(d => { d.favorites[0].libraryId = value; });
    bad(d => { d.playlists[0].ref.id = value; });
    bad(d => { d.playlists[0].entries[0].id = value; });
  }
  const dto = fixture();
  dto.tracks.push({ ...track(), ref: { libraryId: id(9), id: id(2) } });
  dto.playlists[0].ref = ref(2); // Track and playlist identity domains are separate.
  dto.tracks[0].ref.id = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
  dto.favorites = [];
  dto.playlists[0].entries = [];
  assert.equal(validateOrganization(dto).tracks[0].ref.id, dto.tracks[0].ref.id.toLowerCase());
  dto.tracks.push({ ...track(), ref: { libraryId, id: dto.tracks[0].ref.id.toLowerCase() } });
  rejects(() => validateOrganization(dto), 'relations');
});

test('ISO dates validate calendar, leap years, time and timezone rather than Date.parse normalization', () => {
  for (const value of ['2024-02-29T23:59:59.123Z', '2026-10-31T12:34:56+02:30', '2000-02-29T00:00:00Z']) {
    const dto = fixture(); dto.exportedAt = value; dto.tracks[0].createdAt = value;
    assert.equal(validateOrganization(dto).exportedAt, value);
  }
  for (const value of ['2026-02-29T00:00:00Z', '1900-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-00-01T00:00:00Z',
    '2026-10-31', '2026-10-31T24:00:00Z', '2026-10-31T00:60:00Z', '2026-10-31T00:00:60Z',
    '2026-10-31T00:00:00+24:00', '2026-10-31T00:00:00+00:60', '2026-10-31T00:00:00', '2026-10-31T00:00:00Z\n', 'invalid']) {
    bad(d => { d.exportedAt = value; }); bad(d => { d.tracks[0].createdAt = value; });
  }
});

test('all favorites and entries must refer to present tracks with unique scoped identities', () => {
  bad(d => { d.favorites.push(ref(99)); }, 'relations');
  bad(d => { d.playlists[0].entries[0].track.libraryId = id(99); }, 'relations');
  bad(d => { d.favorites.push(ref(2)); }, 'relations');
  bad(d => { d.tracks.push(track()); }, 'relations');
  bad(d => { d.playlists.push(structuredClone(d.playlists[0])); }, 'relations');
  bad(d => { d.playlists[0].entries.push({ id: id(6), track: ref(2) }); }, 'relations');
  bad(d => { d.tracks.push(track(6)); d.playlists[0].entries.push({ id: id(5), track: ref(6) }); }, 'relations');
  const dto = fixture();
  dto.playlists.push({ ref: ref(9), name: 'Otro', entries: [{ id: id(5), track: ref(2) }] });
  assert.doesNotThrow(() => validateOrganization(dto)); // Entry IDs scoped to playlist.
});

test('required fields, primitive types, sparse/executable arrays fail closed', () => {
  for (const field of Object.keys(fixture())) {
    const dto: Record<string, unknown> = { ...fixture() }; delete dto[field];
    rejects(() => validateOrganization(dto), 'format');
  }
  bad(d => { Object.assign(d.tracks[0], { title: 42 }); });
  bad(d => { Object.assign(d.tracks[0], { manualOverrides: null }); });
  bad(d => { Object.assign(d, { favorites: {} }); });
  bad(d => { d.tracks = new Array(1); });
  let called = false;
  const dto = fixture();
  Object.defineProperty(dto.tracks, '0', { get() { called = true; return track(); } });
  rejects(() => validateOrganization(dto), 'format');
  assert.equal(called, false);
  bad(d => { Object.assign(d.tracks, { secret: 'sentinel' }); });
});

test('exact track/playlist budgets accepted and +1 rejected before element inspection', () => {
  const dto = fixture(); dto.tracks = Array.from({ length: L.tracks }, (_, i) => track(i + 10));
  dto.favorites = dto.tracks.map(t => t.ref); dto.playlists = [];
  assert.equal(validateOrganization(dto).tracks.length, L.tracks);
  dto.tracks.push(track(99999)); rejects(() => validateOrganization(dto), 'limits');
  bad(d => { d.tracks = new Array(L.tracks + 1); }, 'limits');
  bad(d => { d.playlists = new Array(L.playlists + 1); }, 'limits');
  bad(d => { d.favorites = new Array(L.tracks + 1); }, 'limits');
  bad(d => { d.playlists[0].entries = new Array(L.entries + 1); }, 'limits');
});

test('50000 aggregate entries across 500 playlists accepted, 50001 rejected', () => {
  const dto = fixture(); dto.tracks = Array.from({ length: 101 }, (_, i) => track(i + 10)); dto.favorites = [];
  dto.playlists = Array.from({ length: L.playlists }, (_, i) => ({
    ref: ref(i + 1000), name: 'L',
    entries: dto.tracks.slice(0, 100).map((t, j) => ({ id: id(j + 10), track: t.ref })),
  }));
  const parsed = parseOrganization(serializeOrganization(dto));
  assert.equal(parsed.playlists.reduce((n, p) => n + p.entries.length, 0), L.entries);
  dto.playlists[L.playlists - 1].entries.push({ id: id(999), track: dto.tracks[100].ref });
  rejects(() => validateOrganization(dto), 'limits');
});

test('8 MiB UTF-8 limit is checked before parsing, including multibyte and exact boundary', () => {
  const json = serializeOrganization(fixture());
  const bytes = new TextEncoder().encode(json).length;
  assert.deepEqual(parseOrganization(json + ' '.repeat(L.jsonBytes - bytes)), fixture());
  rejects(() => parseOrganization(json + ' '.repeat(L.jsonBytes - bytes + 1)), 'limits');
  rejects(() => parseOrganization('é'.repeat(L.jsonBytes / 2 + 1)), 'limits');
  rejects(() => parseOrganization('{'.repeat(L.jsonBytes + 1)), 'limits');
  rejects(() => parseOrganization('{'.repeat(L.jsonBytes)), 'format');
  const dto = fixture(); dto.playlists = []; dto.favorites = [];
  dto.tracks = Array.from({ length: L.tracks }, (_, i) => ({
    ...track(i + 10), title: '\u0000'.repeat(L.metadataCharacters),
    artist: '\u0000'.repeat(L.metadataCharacters), album: '\u0000'.repeat(L.metadataCharacters),
  }));
  // Escaping text can exceed the JSON budget even when every collection is in range.
  rejects(() => serializeOrganization(dto), 'limits');
});
