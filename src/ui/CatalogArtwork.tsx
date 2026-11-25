import React from 'react';
import {catalogArtwork} from '../library/catalog-artwork';
import {readArtwork} from '../library/artwork';
import type {PlayerArtworkCache} from '../library/player-artwork-cache';

export const TrackCatalogArtwork=React.createContext<ReadonlyMap<string,string>>(new Map());
export const PlayerArtworkCacheContext=React.createContext<PlayerArtworkCache|null>(null);
const noSubscription=()=>()=>{};
const emptySnapshot=()=>undefined;

export function CatalogArtwork({url,trackId,className,fallback='♪',enabled=true,preferUrl=false,sharedArtworkKey,refreshToken}:{
 url?:string|null;trackId?:string;className:string;fallback?:string|null;enabled?:boolean;preferUrl?:boolean;sharedArtworkKey?:string;refreshToken?:number;
}){
 const trackArtwork=React.useContext(TrackCatalogArtwork),storedUrl=trackId?trackArtwork.get(trackId):undefined;
 const imageUrl=preferUrl?url??storedUrl:storedUrl??url;
 const cache=React.useContext(PlayerArtworkCacheContext);
 const readShared=enabled&&!imageUrl&&sharedArtworkKey;
 const shared=React.useSyncExternalStore(readShared&&cache?cache.subscribe:noSubscription,
  ()=>readShared?cache?.get(readShared):undefined,emptySnapshot);
 const [view,setView]=React.useState<{key:string;url:string;stamp?:symbol}|null>(null);
 const key=JSON.stringify([imageUrl,storedUrl,trackId,enabled,preferUrl,sharedArtworkKey,refreshToken]);
 React.useEffect(()=>{let alive=true,objectUrl:string|null=null;
  const publish=(blob:Blob)=>{if(!alive)return;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(blob);setView({key,url:objectUrl,stamp:shared?.stamp});};
  if(enabled)void (async()=>{try{
   if(trackId){
    const local=await readArtwork(trackId,!!imageUrl);
    if(!alive||local.state==='unavailable')return;
    if(local.state==='ready'){
     publish(local.blob);
     if(local.manual||!preferUrl||navigator.onLine===false)return;
    }else if('manual' in local&&local.manual)return;
   }
   if(shared){publish(shared.blob);return;}
   if(!imageUrl||navigator.onLine===false)return;
   const blob=await catalogArtwork(imageUrl);if(!alive||!blob)return;
   if(trackId){
    const latest=await readArtwork(trackId,!!imageUrl);
    if(!alive||latest.state==='unavailable')return;
    if(latest.state==='ready'&&(latest.manual||!preferUrl)){publish(latest.blob);return;}
    if('manual' in latest&&latest.manual)return;
   }
   publish(blob);
  }catch{/* Artwork is optional. */}})();
  return()=>{alive=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[key,shared]);
 const shown=enabled&&view?.key===key&&view.stamp===shared?.stamp?view:null;
 if(!shown&&fallback===null)return null;
 return <span className={className} aria-hidden="true">{shown?<img src={shown.url} alt="" onError={()=>setView(null)}/>:fallback}</span>;
}
