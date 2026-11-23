import type {Track,Playlist,LocalAsset} from './library';
import {trackCatalogRelease} from './catalog-release';
import {libraryAlbumCards,type SavedAlbum} from './saved-albums';
export interface StorageGroup {id:string;title:string;subtitle:string;kind:'playlist'|'album'|'other';assetIds:string[];trackIds:string[];bytes:number;favorite?:boolean;artworkUrl?:string}
/** Group memberships may overlap; physical bytes are unique within each group. */
export function groupStorageDownloads(tracks:readonly Track[],playlists:readonly Playlist[],assets:readonly LocalAsset[],savedAlbums:readonly SavedAlbum[]=[]):StorageGroup[]{
 const assetMap=new Map(assets.map(a=>[a.id,a])),trackMap=new Map(tracks.map(t=>[t.id,t])),used=new Set<string>(),groups:StorageGroup[]=[];
 function add(id:string,title:string,subtitle:string,kind:StorageGroup['kind'],ids:readonly string[],favorite=false,artworkUrl?:string){
  const trackIds=[...new Set(ids)].filter(id=>{const t=trackMap.get(id);return !!t?.assetId&&assetMap.has(t.assetId);});
  const assetIds=[...new Set(trackIds.map(id=>trackMap.get(id)!.assetId!))];if(!assetIds.length)return;
  assetIds.forEach(id=>used.add(id));groups.push({id,title,subtitle,kind,trackIds,assetIds,bytes:assetIds.reduce((n,id)=>n+assetMap.get(id)!.bytes,0),favorite,...(artworkUrl?{artworkUrl}:{})});
 }
 add('favorites','Favoritos','Playlist automática','playlist',tracks.filter(t=>t.favorite).map(t=>t.id),true);
 for(const p of playlists)add('playlist:'+p.id,p.name,'Playlist','playlist',p.entries.map(e=>e.trackId));
 for(const album of libraryAlbumCards(tracks,savedAlbums)){
  const artwork=album.saved?album.artworkUrl:album.trackIds.map(id=>trackCatalogRelease(trackMap.get(id)!)?.artworkUrl).find(Boolean);
  add('album:'+album.key,album.label,album.artist?'Álbum · '+album.artist:'Álbum','album',album.trackIds,false,artwork);
 }
 const others=assets.filter(a=>!used.has(a.id));
 if(others.length){
  const assetIds=others.map(a=>a.id),otherIds=new Set(assetIds);
  groups.push({id:'other',title:'Otras descargas',subtitle:'Sin playlist ni álbum',kind:'other',assetIds,trackIds:tracks.filter(t=>t.assetId&&otherIds.has(t.assetId)).map(t=>t.id),bytes:others.reduce((n,a)=>n+a.bytes,0)});
 }
 return groups;
}
