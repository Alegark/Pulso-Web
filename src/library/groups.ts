import {resolveLocalAlbumMetadata} from './album-metadata';
import type {Track} from './library';

export type MetadataProvenance = 'manual' | 'tags';

/** A disposable local view, never a Track/Asset/QueueEntry or verified artist/album ID. */
export interface LibraryGroup {
 readonly key: string;
 readonly kind: 'artist' | 'album';
 readonly label: string;
 readonly artist: string | null;
 /** Original spellings in encounter order, including canonically equivalent Unicode. */
 readonly labels: readonly string[];
 readonly artistLabels: readonly string[];
 readonly unknown: boolean;
 readonly completeness: 'unknown';
 readonly criterion?:'albumArtist';
 readonly albumArtistSource?:Extract<ReturnType<typeof resolveLocalAlbumMetadata>['albumArtist'],{state:'known'}>;
 readonly provenance: readonly MetadataProvenance[];
 readonly evidence: {
  readonly artist: readonly MetadataProvenance[];
  readonly album: readonly MetadataProvenance[];
 };
 /** Input occurrences, including repeated Track IDs; never deduplicated by asset/title. */
 readonly trackIds: readonly string[];
}

type MutableGroup = {
 -readonly [K in keyof LibraryGroup]: K extends 'labels' | 'artistLabels' | 'trackIds' ? string[]
  : K extends 'provenance' ? MetadataProvenance[]
  : K extends 'evidence' ? {artist: MetadataProvenance[]; album: MetadataProvenance[]}
  : LibraryGroup[K];
};

// Blank values are missing. Nonblank labels retain whitespace, case and punctuation:
// only canonical Unicode equivalence participates in identity (no fuzzy matching).
function identity(value: string | null): string | null {
 return value === null || value.trim() === '' ? null : value.normalize('NFC');
}

function addUnique<T>(values: T[], value: T): void {
 if (!values.includes(value)) values.push(value);
}

function fieldEvidence(track: Track, field: 'artist' | 'album'): MetadataProvenance | null {
 if (Object.prototype.hasOwnProperty.call(track.manualOverrides, field)) return 'manual';
 return identity(track[field]) === null ? null : 'tags';
}

function groupTracks(tracks: readonly Track[], kind: LibraryGroup['kind']): LibraryGroup[] {
 const groups = new Map<string, MutableGroup>();
 for (const track of tracks) {
  const artist = identity(track.artist);
  const album = identity(track.album);
  const unknown = (kind === 'artist' ? artist : album) === null;
  // JSON tuples are unambiguous even with delimiters, quotes or literal bucket labels.
  // All missing albums share an explicit bucket, rather than implying an album entity.
  const source=resolveLocalAlbumMetadata(track);
  const albumArtist=source.albumArtist.state==='known'?source.albumArtist.value:null;
  const key = JSON.stringify(kind === 'artist' ? ['artist', artist]
   : album!==null&&albumArtist!==null ? ['album-local-v1',album,'albumArtist',albumArtist.normalize('NFC'),source.compilation.state==='known'?source.compilation.value:null]
   : ['album', album, album === null ? null : artist]);
  let group = groups.get(key);
  if (!group) {
   group = {
    key, kind, unknown, completeness: 'unknown',
    label: unknown ? (kind === 'artist' ? 'Artista desconocido' : 'Sin álbum (agrupación local)')
     : (kind === 'artist' ? track.artist! : track.album!),
    artist: kind === 'album' && !unknown ? albumArtist??(artist!==null?track.artist:null) : null,
    ...(kind==='album'&&!unknown&&source.albumArtist.state==='known'?{criterion:'albumArtist' as const,albumArtistSource:source.albumArtist}:{}),
    labels: [], artistLabels: [], trackIds: [], provenance: [], evidence: {artist: [], album: []},
   };
   groups.set(key, group);
  }
  group.trackIds.push(track.id);
  if (!unknown) addUnique(group.labels, (kind === 'artist' ? track.artist : track.album)!);
  if (artist !== null) addUnique(group.artistLabels, track.artist!);
  for (const field of kind === 'artist' ? ['artist'] as const : ['artist', 'album'] as const) {
   const provenance = fieldEvidence(track, field);
   if (provenance !== null) {
    addUnique(group.evidence[field], provenance);
    addUnique(group.provenance, provenance);
   }
  }
 }
 return [...groups.values()];
}

/** Groups and their tracks follow first encounter order; no official track order is inferred. */
export function groupArtists(tracks: readonly Track[]): LibraryGroup[] {
 return groupTracks(tracks, 'artist');
}

/** Provisional grouping by exact NFC album title + available artist, with no completeness inference. */
export function groupAlbums(tracks: readonly Track[]): LibraryGroup[] {
 return groupTracks(tracks, 'album');
}

export function selectGroup(groups: readonly LibraryGroup[], key: string | null | undefined): LibraryGroup | undefined {
 return groups.find(group => group.key === key);
}

/**
 * Intersects a group snapshot with the supplied tracks (e.g. a playlist selection).
 * Preserves this input's order and repeated occurrences, returning original Track references.
 * Recompute groups after metadata edits; stale/missing keys should be selected again.
 */
export function getGroupTracks(tracks: readonly Track[], group: LibraryGroup): Track[] {
 const ids = new Set(group.trackIds);
 return tracks.filter(track => ids.has(track.id));
}

/** Apply only within an explicitly selected album, before pagination/queue snapshot. */
export function orderAlbumRows<R extends {track:Track}>(rows:readonly R[]):R[] {
 const ordinal=(t:Track,field:'disc'|'track')=>{const s=resolveLocalAlbumMetadata(t)[field];return s.state==='known'?s.value.current:null;};
 const compare=(a:number|null,b:number|null)=>a===b?0:a===null?1:b===null?-1:a-b;
 return rows.map((row,index)=>({row,index,disc:ordinal(row.track,'disc'),track:ordinal(row.track,'track')})).sort((a,b)=>compare(a.disc,b.disc)||compare(a.track,b.track)||a.index-b.index).map(x=>x.row);
}
