import {copyLocalAlbumMetadata,type LocalAlbumMetadataV1} from './album-metadata';
/** Organization only: no storage records, audio bytes, availability or musical deduplication.
 * Pure v1 boundary for a future exporter/importer; does not migrate or write IDB v2.
 * Strings are inert text. Consumers must render them as text, never HTML or URLs.
 */
export const ORGANIZATION_LIMITS = Object.freeze({
  jsonBytes: 8 * 1024 * 1024, tracks: 5000, playlists: 500, entries: 50000,
  metadataCharacters: 300, playlistCharacters: 100, audioBytes: 100 * 1024 * 1024,
});
export interface OrganizationRef { libraryId: string; id: string }
export interface OrganizationAudio { algorithm: 'sha256'; sha256: string; bytes: number }
export interface OrganizationTrack {
  ref: OrganizationRef;
  title: string;
  artist: string | null;
  album: string | null;
  duration: number;
  createdAt: string;
  manualOverrides: Partial<{ title: string; artist: string | null; album: string | null }>;
  audio: OrganizationAudio | null;
}
export interface OrganizationPlaylist {
  ref: OrganizationRef;
  name: string;
  entries: { id: string; track: OrganizationRef }[];
}
export interface OrganizationTrackV2 extends OrganizationTrack {localAlbum:LocalAlbumMetadataV1|null}
export interface OrganizationExportV1 {
  format: 'pulso-web-organization';
  version: 1;
  exportId: string;
  libraryId: string;
  exportedAt: string;
  tracks: OrganizationTrack[];
  favorites: OrganizationRef[];
  playlists: OrganizationPlaylist[];
}
export interface OrganizationExportV2 extends Omit<OrganizationExportV1,'version'|'tracks'> {version:2;tracks:OrganizationTrackV2[]}
export type OrganizationExport=OrganizationExportV1|OrganizationExportV2;
export type OrganizationErrorCode = 'format' | 'version' | 'limits' | 'relations';
export class OrganizationFormatError extends Error {
  constructor(public readonly code: OrganizationErrorCode, public readonly path: string) {
    // Paths contain schema names/array indices only, never input values.
    super(`Organization ${code}: ${path}`);
    this.name = 'OrganizationFormatError';
  }
}
function fail(code: OrganizationErrorCode, path: string): never {
  throw new OrganizationFormatError(code, path);
}
type RecordValue = Record<string, unknown>;
function object(value: unknown, required: readonly string[], optional: readonly string[], path: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('format', path);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail('format', path);
  const keys = Reflect.ownKeys(value);
  if (keys.length > required.length + optional.length) fail('format', path);
  const result: RecordValue = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !required.includes(key) && !optional.includes(key)) fail('format', path);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) fail('format', path);
    result[key] = descriptor.value;
  }
  for (const key of required) if (!Object.hasOwn(result, key)) fail('format', `${path}.${key}`);
  return result;
}
function array(value: unknown, max: number, path: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('format', path);
  if (value.length > max) fail('limits', path);
  // Reject holes, getters and extra properties before reading elements.
  if (Reflect.ownKeys(value).length !== value.length + 1) fail('format', path);
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor)) fail('format', `${path}[${i}]`);
  }
  return value;
}
function uuid(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail('format', path);
  // UUID hex case cannot create a second identity.
  return value.toLowerCase();
}
function ref(value: unknown, path: string): OrganizationRef {
  const r = object(value, ['libraryId', 'id'], [], path);
  return { libraryId: uuid(r.libraryId, `${path}.libraryId`), id: uuid(r.id, `${path}.id`) };
}
function key(r: OrganizationRef): string { return `${r.libraryId}/${r.id}`; }
function text(value: unknown, max: number, nonempty: boolean, path: string): string {
  if (typeof value !== 'string') fail('format', path);
  // Character budgets follow the existing UI's UTF-16 string.length contract.
  if (value.length > max) fail('limits', path);
  if (nonempty && !value.trim()) fail('format', path);
  return value;
}
function nullableText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, ORGANIZATION_LIMITS.metadataCharacters, false, path);
}
function date(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > 29) fail('format', path);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m || m[0].length !== value.length) fail('format', path);
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59 ||
      m[7] !== 'Z' && (Number(m[7].slice(1, 3)) > 23 || Number(m[7].slice(4)) > 59) || !Number.isFinite(Date.parse(value))) fail('format', path);
  return value;
}
function audio(value: unknown, path: string): OrganizationAudio | null {
  if (value === null) return null;
  const a = object(value, ['algorithm', 'sha256', 'bytes'], [], path);
  if (a.algorithm !== 'sha256' || typeof a.sha256 !== 'string' || a.sha256.length !== 64 || !/^[a-f0-9]{64}$/.test(a.sha256) ||
      typeof a.bytes !== 'number' || !Number.isSafeInteger(a.bytes) || a.bytes < 1) fail('format', path);
  if (a.bytes > ORGANIZATION_LIMITS.audioBytes) fail('limits', `${path}.bytes`);
  return { algorithm: 'sha256', sha256: a.sha256, bytes: a.bytes };
}
function track(value: unknown, path: string, version:1|2): OrganizationTrack|OrganizationTrackV2 {
  const t = object(value, ['ref', 'title', 'artist', 'album', 'duration', 'createdAt', 'manualOverrides', 'audio', ...(version===2?['localAlbum']:[])], [], path);
  const title = text(t.title, ORGANIZATION_LIMITS.metadataCharacters, true, `${path}.title`);
  const artist = nullableText(t.artist, `${path}.artist`), album = nullableText(t.album, `${path}.album`);
  if (typeof t.duration !== 'number' || !Number.isFinite(t.duration) || t.duration <= 0) fail('format', `${path}.duration`);
  const o = object(t.manualOverrides, [], ['title', 'artist', 'album'], `${path}.manualOverrides`);
  const manualOverrides: OrganizationTrack['manualOverrides'] = {};
  for (const field of ['title', 'artist', 'album'] as const) {
    if (!Object.hasOwn(o, field)) continue;
    const effective = field === 'title' ? title : field === 'artist' ? artist : album;
    if (o[field] !== effective) fail('format', `${path}.manualOverrides.${field}`);
    if (field === 'title') manualOverrides.title = title;
    else manualOverrides[field] = effective;
  }
  const localAlbum=version===2?(t.localAlbum===null?null:copyLocalAlbumMetadata(t.localAlbum)):null;
  if(version===2&&t.localAlbum!==null&&!localAlbum)fail('format',`${path}.localAlbum`);
  return { ref: ref(t.ref, `${path}.ref`), title, artist, album, duration: t.duration,
    createdAt: date(t.createdAt, `${path}.createdAt`), manualOverrides, audio: audio(t.audio, `${path}.audio`), ...(version===2?{localAlbum}: {}) };
}
function unique(set: Set<string>, id: string, path: string): void {
  if (set.has(id)) fail('relations', path);
  set.add(id);
}
function checkBytes(json: string): void {
  if (json.length > ORGANIZATION_LIMITS.jsonBytes || new TextEncoder().encode(json).length > ORGANIZATION_LIMITS.jsonBytes) fail('limits', '$');
}
/** Strict validation plus a fresh field-by-field DTO; input/order are never mutated.
 * Accepts plain data objects only (not proxies or executable application objects).
 * Identity is the UUID pair, never metadata or an audio fingerprint.
 */
export function validateOrganization(input: unknown): OrganizationExport {
  const root = object(input, ['format', 'version', 'exportId', 'libraryId', 'exportedAt', 'tracks', 'favorites', 'playlists'], [], '$');
  if (root.format !== 'pulso-web-organization') fail('format', '$.format');
  if (root.version !== 1 && root.version !== 2) fail('version', '$.version');
  const exportId = uuid(root.exportId, '$.exportId'), libraryId = uuid(root.libraryId, '$.libraryId');
  const exportedAt = date(root.exportedAt, '$.exportedAt');
  const rawTracks = array(root.tracks, ORGANIZATION_LIMITS.tracks, '$.tracks');
  const rawFavorites = array(root.favorites, ORGANIZATION_LIMITS.tracks, '$.favorites');
  const rawPlaylists = array(root.playlists, ORGANIZATION_LIMITS.playlists, '$.playlists');
  const trackIds = new Set<string>(), playlistIds = new Set<string>(), favoriteIds = new Set<string>();
  const tracks = rawTracks.map((value, i) => {
    const t = track(value, `$.tracks[${i}]`,root.version as 1|2);
    unique(trackIds, key(t.ref), `$.tracks[${i}].ref`);
    return t;
  });
  function existing(value: unknown, path: string): OrganizationRef {
    const r = ref(value, path);
    if (!trackIds.has(key(r))) fail('relations', path);
    return r;
  }
  const favorites = rawFavorites.map((value, i) => {
    const path = `$.favorites[${i}]`, r = existing(value, path);
    unique(favoriteIds, key(r), path);
    return r;
  });
  let totalEntries = 0;
  const playlists = rawPlaylists.map((value, i): OrganizationPlaylist => {
    const path = `$.playlists[${i}]`, p = object(value, ['ref', 'name', 'entries'], [], path);
    const playlistRef = ref(p.ref, `${path}.ref`);
    unique(playlistIds, key(playlistRef), `${path}.ref`);
    const name = text(p.name, ORGANIZATION_LIMITS.playlistCharacters, true, `${path}.name`);
    const rawEntries = array(p.entries, ORGANIZATION_LIMITS.entries - totalEntries, `${path}.entries`);
    totalEntries += rawEntries.length;
    const entryIds = new Set<string>(), entryTracks = new Set<string>();
    const entries = rawEntries.map((value, j) => {
      const ep = `${path}.entries[${j}]`, e = object(value, ['id', 'track'], [], ep);
      const id = uuid(e.id, `${ep}.id`), track = existing(e.track, `${ep}.track`);
      unique(entryIds, id, `${ep}.id`);
      unique(entryTracks, key(track), `${ep}.track`);
      return { id, track };
    });
    return { ref: playlistRef, name, entries };
  });
  const result = { format: 'pulso-web-organization', version: root.version,
    exportId, libraryId, exportedAt, tracks, favorites, playlists } as OrganizationExport;
  checkBytes(JSON.stringify(result));
  return result;
}
/** Checks the UTF-8 budget before JSON.parse; no reviver or executable content. */
export function parseOrganization(json: string): OrganizationExport {
  if (typeof json !== 'string') fail('format', '$');
  checkBytes(json);
  let input: unknown;
  try { input = JSON.parse(json); } catch { return fail('format', '$'); }
  return validateOrganization(input);
}
/** Serializes only the explicit DTO fields produced by validation, never storage spreads. */
export function serializeOrganization(input: OrganizationExport): string {
  return JSON.stringify(validateOrganization(input));
}
