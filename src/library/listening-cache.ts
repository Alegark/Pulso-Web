import type {LocalAsset, Playlist, Track} from './library';

export interface ListeningCacheInput {
 readonly tracks:readonly Track[];
 readonly assets:readonly LocalAsset[];
 /** Include legacy tracks without an explicit membership record. */
 readonly libraryTrackIds:ReadonlySet<string>;
 readonly playlists:readonly Playlist[];
}

const fingerprintKey=(sha256:string,bytes:number)=>`${sha256}:${bytes}`;
/** A detached organizational reference protects every exact copy of its audio. */
export function indexCopyProtection(tracks:readonly Track[],protectedTrack:(track:Track)=>boolean):(asset:LocalAsset)=>boolean{
 const assetIds=new Set<string>(),fingerprints=new Set<string>();
 for(const track of tracks){
  if(!protectedTrack(track))continue;
  const {assetId,audioFingerprint}=track;
  if(assetId!==null)assetIds.add(assetId);
  else if(audioFingerprint?.algorithm==='sha256')fingerprints.add(fingerprintKey(audioFingerprint.sha256,audioFingerprint.bytes));
 }
 return asset=>assetIds.has(asset.id)||fingerprints.has(fingerprintKey(asset.sha256,asset.bytes));
}
/** Organization-only classification; the removal protocol also checks runtime protection. */
export function listeningCacheAssets({tracks,assets,libraryTrackIds,playlists}:ListeningCacheInput):LocalAsset[] {
 const listed=new Set(playlists.flatMap(p=>p.entries.map(e=>e.trackId)));
 const attached=new Set(tracks.map(t=>t.assetId));
 const protectedCopy=indexCopyProtection(tracks,t=>t.favorite||listed.has(t.id)||libraryTrackIds.has(t.id));
 return assets.filter(a=>attached.has(a.id)&&!protectedCopy(a));
}
export function summarizeListeningCache(input:ListeningCacheInput):{copies:number;bytes:number} {
 const assets=listeningCacheAssets(input);
 return {copies:assets.length,bytes:assets.reduce((total,a)=>total+a.bytes,0)};
}
