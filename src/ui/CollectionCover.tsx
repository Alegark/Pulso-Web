import {CatalogArtwork} from './CatalogArtwork';

/** Local artwork only. A playlist cover never triggers a catalogue search. */
export function CollectionCover({trackIds,favorite=false,enabled=true}:{trackIds:readonly string[];favorite?:boolean;enabled?:boolean}){
 const ids=[...new Set(trackIds)].slice(0,4);
 return <span className={`collection-cover${favorite?' collection-cover--favorites':''}`} data-mosaic={!favorite&&ids.length>=4?'true':undefined} aria-hidden="true">
  {favorite?<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21 3 12C-3 5 6-2 12 5c6-7 15 0 9 7Z"/></svg>:ids.length?(ids.length>=4?ids:[ids[0]]).map(id=><CatalogArtwork key={id} trackId={id} className="collection-cover__tile" enabled={enabled}/>):<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 17V5l11-2v12M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></svg>}
 </span>;
}
