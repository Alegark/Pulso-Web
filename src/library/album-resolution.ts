import type {AlbumCatalog, AlbumEdition, AlbumRequest, AlbumResult} from './album-catalog';
import {musicCatalogKey} from './music-search-catalog';

/** Resolve only literal title and full credit. A successful empty result is not
 * proof that the release does not exist in the catalogue. */
export async function resolveAlbum(catalog: Pick<AlbumCatalog, 'search'|'searchArtists'|'artistAlbums'>, title: string, artist: string|null, request: AlbumRequest): Promise<AlbumResult<AlbumEdition[]>> {
 const active=()=>{try{return !request.signal.aborted&&request.current()===true;}catch{return false;}};
 const cancelled=():AlbumResult<AlbumEdition[]>=>({ok:false,reason:'cancelled'});
 if(!active())return cancelled();
 const found=await catalog.search(title,artist,request);
 if(!active())return cancelled();
 if(!found.ok)return found.reason==='cancelled'?found:{...found,stage:'album-search'};
 if(!artist?.trim())return found;
 const matches=(e:AlbumEdition)=>musicCatalogKey(e.title)===musicCatalogKey(title)&&musicCatalogKey(e.artist)===musicCatalogKey(artist);
 const exact=found.value.filter(matches);
 if(exact.length)return {ok:true,value:exact};
 const people=await catalog.searchArtists(artist,request);
 if(!active())return cancelled();
 if(!people.ok)return people.reason==='cancelled'?people:{...people,stage:'artist-search'};
 const exactPeople=people.value.filter(p=>musicCatalogKey(p.name)===musicCatalogKey(artist));
 if(exactPeople.length!==1)return {ok:true,value:[]};
 const releases=await catalog.artistAlbums(exactPeople[0].id,request);
 if(!active())return cancelled();
 if(!releases.ok)return releases.reason==='cancelled'?releases:{...releases,stage:'artist-albums'};
 return {ok:true,value:releases.value.filter(matches)};
}
