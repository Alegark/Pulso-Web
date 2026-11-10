import React from 'react';
import {catalogArtwork} from '../library/catalog-artwork';
import {readArtwork} from '../library/artwork';

export function CatalogArtwork({url,trackId,className,fallback='♪',enabled=true}:{url?:string|null;trackId?:string;className:string;fallback?:string;enabled?:boolean}){
 const [view,setView]=React.useState<{key:string;url:string}|null>(null);
 const key=JSON.stringify([url,trackId,enabled]);
 React.useEffect(()=>{let alive=true,objectUrl:string|null=null;
  const publish=(blob:Blob)=>{if(!alive)return;objectUrl=URL.createObjectURL(blob);setView({key,url:objectUrl});};
  if(enabled)void (async()=>{try{
   if(trackId){const local=await readArtwork(trackId);if(!alive)return;if(local.state==='ready'){publish(local.blob);return;}if(local.state==='unavailable'||'manual' in local&&local.manual)return;}
   if(!url)return;const blob=await catalogArtwork(url);if(!alive||!blob)return;
   if(trackId){const latest=await readArtwork(trackId);if(!alive||latest.state==='ready'||latest.state==='unavailable'||'manual' in latest&&latest.manual)return;}
   publish(blob);
  }catch{/* Artwork is optional. */}})();
  return()=>{alive=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[key]);
 return <span className={className} aria-hidden="true">{enabled&&view?.key===key?<img src={view.url} alt="" onError={()=>setView(null)}/>:fallback}</span>;
}
