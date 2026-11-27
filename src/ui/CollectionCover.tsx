import {CatalogArtwork} from './CatalogArtwork';
import React,{useEffect,useState} from 'react';

/** Covers use known artwork only. They never search for editions. */
export function CollectionCover({trackIds,variant='playlist',artworkUrl,favorite=false,enabled=true,sharedArtworkKey}:{
 trackIds:readonly string[];variant?:'album'|'playlist';artworkUrl?:string;favorite?:boolean;enabled?:boolean;sharedArtworkKey?:string;
}){
 const ids=[...new Set(trackIds)].slice(0,4);
 const albumIds=[...new Set(trackIds)].slice(0,6);
 const mosaic=variant==='playlist'&&!favorite&&ids.length===4;
 const node=React.useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{
  if(!enabled||favorite){setVisible(false);return;}
  const rect=node.current?.getBoundingClientRect();
  if(rect&&rect.width>0&&rect.height>0&&rect.bottom>=-80&&rect.top<=window.innerHeight+80)setVisible(true);
  if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
  const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),{rootMargin:'80px'});
  if(node.current)observer.observe(node.current);return()=>observer.disconnect();
 },[enabled,favorite]);
 return <span ref={node} className={`collection-cover${favorite?' collection-cover--favorites':''}`} data-mosaic={mosaic?'true':undefined} aria-hidden="true">
  {favorite?<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21 3 12C-3 5 6-2 12 5c6-7 15 0 9 7Z"/></svg>:
   variant==='album'?<CatalogArtwork url={artworkUrl} trackId={albumIds[0]} fallbackTrackIds={albumIds.slice(1)} sharedArtworkKey={sharedArtworkKey} preferUrl className="collection-cover__tile" enabled={enabled&&visible}/>:
   ids.length?(mosaic?ids:[ids[0]]).map(id=><CatalogArtwork key={id} trackId={id} className="collection-cover__tile" enabled={enabled&&visible}/>):<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 17V5l11-2v12M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></svg>}
 </span>;
}
