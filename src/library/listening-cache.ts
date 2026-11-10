import type {LocalAsset, Playlist, Track} from './library';

export interface ListeningCacheInput {
 readonly tracks:readonly Track[];
 readonly assets:readonly LocalAsset[];
 /** Include legacy tracks without an explicit membership record. */
 readonly libraryTrackIds:ReadonlySet<string>;
 readonly playlists:readonly Playlist[];
}

/** Organization-only classification; the removal protocol also checks runtime protection. */
export function listeningCacheAssets({tracks,assets,libraryTrackIds,playlists}:ListeningCacheInput):LocalAsset[] {
 const listed=new Set(playlists.flatMap(p=>p.entries.map(e=>e.trackId)));
 return assets.filter(a=>{
  const attached=tracks.filter(t=>t.assetId===a.id);
  if(!attached.length)return false;
  const related=tracks.filter(t=>t.assetId===a.id||t.assetId===null&&t.audioFingerprint?.algorithm==='sha256'&&t.audioFingerprint.sha256===a.sha256&&t.audioFingerprint.bytes===a.bytes);
  return related.every(t=>!t.favorite&&!listed.has(t.id)&&!libraryTrackIds.has(t.id));
 });
}
export function summarizeListeningCache(input:ListeningCacheInput):{copies:number;bytes:number} {
 const assets=listeningCacheAssets(input);
 return {copies:assets.length,bytes:assets.reduce((total,a)=>total+a.bytes,0)};
}
