import React from 'react';
import {catalogArtwork} from '../library/catalog-artwork';
import {readArtwork} from '../library/artwork';
import {artworkPriority} from '../cache/artwork-policy';
import type {PlayerArtworkCache} from '../library/player-artwork-cache';

export const TrackCatalogArtwork=React.createContext<ReadonlyMap<string,string>>(new Map());
export const TrackArtworkIdentity=React.createContext<{keys:ReadonlyMap<string,string>;revision?:number}>({keys:new Map()});
export const PlayerArtworkCacheContext=React.createContext<PlayerArtworkCache|null>(null);
const noSubscription=()=>()=>{};
const emptySnapshot=()=>undefined;

export function CatalogArtwork({url,trackId,className,fallback='♪',enabled=true,preferUrl=false,sharedArtworkKey,refreshToken,fallbackTrackIds}:{
 url?:string|null;trackId?:string;className:string;fallback?:string|null;enabled?:boolean;preferUrl?:boolean;sharedArtworkKey?:string;refreshToken?:number;fallbackTrackIds?:readonly string[];
}){
 const trackArtwork=React.useContext(TrackCatalogArtwork),storedUrl=trackId?trackArtwork.get(trackId):undefined;
 const {keys,revision}=React.useContext(TrackArtworkIdentity);
 const identity=sharedArtworkKey??(trackId?keys.get(trackId):undefined);
 const imageUrl=preferUrl?url??storedUrl:storedUrl??url;
 const cache=React.useContext(PlayerArtworkCacheContext);
 const observeProvider=enabled&&identity;
 const shared=React.useSyncExternalStore(observeProvider&&cache?cache.subscribe:noSubscription,
  ()=>observeProvider?cache?.get(observeProvider):undefined,emptySnapshot);
 const objectUrls=React.useRef(new Set<string>());
 const revokeAll=React.useCallback(()=>{for(const url of objectUrls.current)URL.revokeObjectURL(url);objectUrls.current.clear();},[]);
 React.useEffect(()=>{
  cache?.signal.addEventListener('abort',revokeAll,{once:true});
  return()=>{cache?.signal.removeEventListener('abort',revokeAll);revokeAll();};
 },[cache,revokeAll]);
 const [view,setView]=React.useState<{key:string;url:string;cache:PlayerArtworkCache|null}|null>(null);
 const key=JSON.stringify([imageUrl,trackId,enabled,identity,refreshToken??revision,fallbackTrackIds?.join(',')??'']);
 React.useEffect(()=>{
  let alive=true;
  const active=()=>alive&&!cache?.signal.aborted;
  const publish=(blob:Blob)=>{
   if(!active())return;
   const objectUrl=URL.createObjectURL(blob);objectUrls.current.add(objectUrl);setView({key,url:objectUrl,cache});
  };
  const localWins=async()=>{
   if(trackId){
    const local=await readArtwork(trackId,!!imageUrl);
    if(!active())return true;
    if(local.state==='ready'){publish(local.blob);return true;}
    if(artworkPriority(local)==='hidden'){revokeAll();setView(null);return true;}
   }
   for(const candidateId of [...new Set(fallbackTrackIds??[])].filter(id=>id!==trackId).slice(0,6)){
    const candidate=await readArtwork(candidateId,true);
    if(!active())return true;
    if(candidate.state==='ready'){publish(candidate.blob);return true;}
   }
   return false;
  };
  const publishRemote=async(blob:Blob)=>{
   if(active()&&!await localWins())publish(blob);
  };
  if(!enabled||cache?.signal.aborted){revokeAll();setView(null);return;}
  void (async()=>{try{
   if(await localWins()||!active())return;
   if(imageUrl){
    const blob=await catalogArtwork(imageUrl,cache??undefined,blob=>{
     void publishRemote(blob).catch(()=>{});
    });
    if(blob){await publishRemote(blob);return;}
   }
   if(identity&&cache&&active()){
    const provider=await cache.readProvider(identity);
    if(provider)await publishRemote(provider.blob);
   }
  }catch{/* Artwork is optional. */}})();
  return()=>{alive=false;};
 },[key,shared,cache,revokeAll]);
 const shown=enabled&&!cache?.signal.aborted&&view?.key===key&&view.cache===cache?view:null;
 const shownUrl=React.useRef<string|null>(null);shownUrl.current=shown?.url??null;
 if(!shown&&fallback===null)return null;
 return <span className={className} aria-hidden="true">{shown?<img src={shown.url} alt="" onLoad={event=>{
  const image=event.currentTarget,url=shown.url;
  const release=()=>{if(shownUrl.current!==url)return;for(const old of objectUrls.current)if(old!==url){URL.revokeObjectURL(old);objectUrls.current.delete(old);}};
  if(typeof image.decode==='function')void image.decode().then(release,release);else release();
 }} onError={()=>setView(null)}/>:fallback}</span>;
}
