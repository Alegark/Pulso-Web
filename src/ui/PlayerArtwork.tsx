import {useContext,useEffect,useRef,useState} from 'react';
import type {Activity} from '../playback/ownership';
import {readSongArtworkIdentity} from '../library/selected-song';
import {readRecord} from '../storage/database';
import type {Track} from '../library/library';
import {readArtwork} from '../library/artwork';
import {catalogArtwork} from '../library/catalog-artwork';
import type {PlayerArtworkProvider} from '../library/player-artwork-provider';
import {PlayerArtworkCacheContext} from './CatalogArtwork';
import {artworkFreshness,artworkPriority} from '../cache/artwork-policy';
import './artwork.css';

export interface PlayerArtworkProps {
 provider:PlayerArtworkProvider;
 activity:Activity; trackId:string; title:string; artist:string|null; album:string|null;
 durationSeconds:number|null; scopeKey:string; enabled:boolean; current:()=>boolean;
 catalogCover?:string; sharedArtworkKey?:string; refreshToken:number; onArtwork?:(image:MediaImage|null,previousUrl?:string)=>void; onAlbum?:(album:string|null)=>void;
}
type View={key:string;current:()=>boolean;url:string|null};
export function PlayerArtwork({provider,activity,trackId,title,artist,album,durationSeconds,scopeKey,enabled,current,catalogCover,sharedArtworkKey,refreshToken,onAlbum,onArtwork}:PlayerArtworkProps){
 const cache=useContext(PlayerArtworkCacheContext);
 const [view,setView]=useState<View|null>(null);const currentRef=useRef(current);currentRef.current=current;
 const artworkRef=useRef(onArtwork);artworkRef.current=onArtwork;
 const albumRef=useRef(onAlbum);albumRef.current=onAlbum;
 const key=JSON.stringify([trackId,title,artist,album,durationSeconds,scopeKey,enabled,refreshToken,catalogCover,sharedArtworkKey]);
 useEffect(()=>{
  const scope=activity.scope(),controller=new AbortController();let objectUrl:string|null=null,displayed:Blob|null=null,cancelled=false;
  const active=()=>{try{return !cancelled&&!controller.signal.aborted&&!cache?.signal.aborted&&scope()&&currentRef.current();}catch{return false;}};
  const revoke=()=>{if(objectUrl){artworkRef.current?.(null,objectUrl);URL.revokeObjectURL(objectUrl);objectUrl=null;displayed=null;}};
  const publish=(blob:Blob)=>{if(!active()||blob===displayed)return;revoke();objectUrl=URL.createObjectURL(blob);if(active()){displayed=blob;setView({key,current:active,url:objectUrl});artworkRef.current?.({src:objectUrl,type:blob.type});}else revoke();};
  if(!enabled||!active())return ()=>{cancelled=true;controller.abort();revoke();};
  const operation=activity.begin();
  const retire=()=>{controller.abort();revoke();};
  cache?.signal.addEventListener('abort',retire,{once:true});
  let ended=false;
  const end=()=>{if(operation&&!ended){ended=true;operation.end();}};
  const localWins=async()=>{
   const local=await readArtwork(trackId,!!catalogCover);
   if(!active())return true;
   const priority=artworkPriority(local);
   if(local.state==='ready')publish(local.blob);
   if(priority==='hidden'){revoke();setView(null);}
   return priority!=='remote';
  };
  const publishRemote=async(blob:Blob,album?:string)=>{
   if(!active()||await localWins())return;
   publish(blob);
   if(active()&&album)albumRef.current?.(album);
  };
  if(operation)void (async()=>{
   try{
    if(await localWins()||!active()||!operation.current())return;
    if(catalogCover){
     end();
     const blob=await catalogArtwork(catalogCover,cache??undefined,blob=>{
      void publishRemote(blob).catch(()=>{});
     });
     if(blob){await publishRemote(blob);return;}
    }
    const cached=sharedArtworkKey?await cache?.readProvider(sharedArtworkKey):undefined;
    if(cached){
     await publishRemote(cached.blob,cached.album);
     if(artworkFreshness(cached.fetchedAt,Date.now(),navigator.onLine)!=='stale'||document.visibilityState==='hidden')return;
    }
    if(!active()||!navigator.onLine)return;
    // The catalog path released its operation during lookup. Any provider identity
    // lookup after a catalog miss needs its own admission.
    const lookup=ended?activity.begin():operation;
    if(!lookup)return;
    let identity;
    try{
     const track=await readRecord<Track>('tracks',trackId);if(!active()||!lookup.current())return;
     identity=track?await readSongArtworkIdentity(track,active):null;if(!active()||!lookup.current())return;
    }finally{if(lookup===operation)end();else lookup.end();}
    if(!identity&&(!artist||durationSeconds===null))return;
    const result=await provider.load(identity??{title,artist:artist!,album,durationSeconds:durationSeconds!},{signal:controller.signal,current:active});
    if(!result||!active()||await localWins())return;
    const blob=sharedArtworkKey&&cache?await cache.saveProvider(sharedArtworkKey,result.album,result.image):result.image.blob;
    if(blob)await publishRemote(blob,result.album);
   }catch{/* Optional artwork must never block playback. */}finally{end();}
  })();
  return ()=>{cancelled=true;cache?.signal.removeEventListener('abort',retire);retire();end();};
 },[activity,key,cache,provider]);
 const visible=enabled&&view?.key===key&&view.current()?view:null;
 return <div className="artwork-panel">{visible?.url?<img className="artwork-image" src={visible.url} alt={`Portada de ${title}`} onError={()=>setView(null)}/>:<div aria-hidden="true" className="artwork-placeholder">♪</div>}</div>;
}
