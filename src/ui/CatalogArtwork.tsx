import React from 'react';
import {catalogArtwork} from '../library/catalog-artwork';
import {readArtwork} from '../library/artwork';

export const TrackCatalogArtwork=React.createContext<ReadonlyMap<string,string>>(new Map());

export function CatalogArtwork({url,trackId,className,fallback='♪',enabled=true,preferUrl=false}:{url?:string|null;trackId?:string;className:string;fallback?:string;enabled?:boolean;preferUrl?:boolean}){
 const trackArtwork=React.useContext(TrackCatalogArtwork),storedUrl=trackId?trackArtwork.get(trackId):undefined;
 const imageUrl=preferUrl?url??storedUrl:storedUrl??url;
 const [view,setView]=React.useState<{key:string;url:string}|null>(null);
 const key=JSON.stringify([imageUrl,storedUrl,trackId,enabled,preferUrl]);
 React.useEffect(()=>{let alive=true,objectUrl:string|null=null;
  const publish=(blob:Blob)=>{if(!alive)return;objectUrl=URL.createObjectURL(blob);setView({key,url:objectUrl});};
  if(enabled)void (async()=>{try{
   if(preferUrl&&imageUrl){const blob=await catalogArtwork(imageUrl);if(!alive)return;if(blob){publish(blob);return;}}
   if(trackId){const local=await readArtwork(trackId,!!storedUrl);if(!alive)return;if(local.state==='ready'){publish(local.blob);return;}if(local.state==='unavailable'||'manual' in local&&local.manual)return;}
   if(!imageUrl||preferUrl)return;const blob=await catalogArtwork(imageUrl);if(!alive||!blob)return;
   if(trackId){const latest=await readArtwork(trackId,!!storedUrl);if(!alive||latest.state==='ready'||latest.state==='unavailable'||'manual' in latest&&latest.manual)return;}
   publish(blob);
  }catch{/* Artwork is optional. */}})();
  return()=>{alive=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[key]);
 return <span className={className} aria-hidden="true">{enabled&&view?.key===key?<img src={view.url} alt="" onError={()=>setView(null)}/>:fallback}</span>;
}
