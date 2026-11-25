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

export function CatalogArtwork({url,trackId,className,fallback='♪',enabled=true,preferUrl=false,sharedArtworkKey,refreshToken}:{
 url?:string|null;trackId?:string;className:string;fallback?:string|null;enabled?:boolean;preferUrl?:boolean;sharedArtworkKey?:string;refreshToken?:number;
}){
 const trackArtwork=React.useContext(TrackCatalogArtwork),storedUrl=trackId?trackArtwork.get(trackId):undefined;
 const {keys,revision}=React.useContext(TrackArtworkIdentity);
 const identity=sharedArtworkKey??(trackId?keys.get(trackId):undefined);
 const imageUrl=preferUrl?url??storedUrl:storedUrl??url;
 const cache=React.useContext(PlayerArtworkCacheContext);
 const observeProvider=enabled&&identity;
 const shared=React.useSyncExternalStore(observeProvider&&cache?cache.subscribe:noSubscription,
  ()=>observeProvider?cache?.get(observeProvider):undefined,emptySnapshot);
 const [view,setView]=React.useState<{key:string;url:string;cache:PlayerArtworkCache|null}|null>(null);
 const key=JSON.stringify([imageUrl,trackId,enabled,identity,refreshToken??revision]);
 React.useEffect(()=>{
  let alive=true,objectUrl:string|null=null;
  const active=()=>alive&&!cache?.signal.aborted;
  const revoke=()=>{if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}};
  const publish=(blob:Blob)=>{
   if(!active())return;
   revoke();objectUrl=URL.createObjectURL(blob);setView({key,url:objectUrl,cache});
  };
  const localWins=async()=>{
   if(!trackId)return false;
   const local=await readArtwork(trackId,!!imageUrl);
   if(!active())return true;
   const priority=artworkPriority(local);
   if(local.state==='ready')publish(local.blob);
   if(priority==='hidden'){revoke();setView(null);}
   return priority!=='remote';
  };
  const publishRemote=async(blob:Blob)=>{
   if(active()&&!await localWins())publish(blob);
  };
  cache?.signal.addEventListener('abort',revoke,{once:true});
  if(enabled)void (async()=>{try{
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
  return()=>{alive=false;cache?.signal.removeEventListener('abort',revoke);revoke();};
 },[key,shared,cache]);
 const shown=enabled&&!cache?.signal.aborted&&view?.key===key&&view.cache===cache?view:null;
 if(!shown&&fallback===null)return null;
 return <span className={className} aria-hidden="true">{shown?<img src={shown.url} alt="" onError={()=>setView(null)}/>:fallback}</span>;
}
