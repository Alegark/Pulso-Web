import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAlbum} from '../../src/library/album-resolution';
import type {AlbumEdition,AlbumResult,CatalogArtist} from '../../src/library/album-catalog';
const album=(id:number,artist='Artist',title='Record'):AlbumEdition=>({id,title,artist,trackCount:17,releaseDate:null});
const ok=<T>(value:T):AlbumResult<T>=>({ok:true,value});
function setup(options:{search?:AlbumResult<AlbumEdition[]>;artists?:AlbumResult<CatalogArtist[]>;albums?:AlbumResult<AlbumEdition[]>}={}){
 const calls:string[]=[]; const abort=new AbortController();let current=true;
 const api={search:async()=>{calls.push('search');return options.search??ok([]);},searchArtists:async()=>{calls.push('artists');return options.artists??ok([{id:2,name:'artist'}]);},artistAlbums:async()=>{calls.push('albums');return options.albums??ok([album(42),album(43,'Artist, Guest'),album(44,'Artist','Record Live')]);}};
 return {api,calls,abort,request:{signal:abort.signal,current:()=>current},stop:()=>{current=false;}};
}
test('fallback uses one exact artist and full title and credit',async()=>{const s=setup();assert.deepEqual(await resolveAlbum(s.api,'Record','Artist',s.request),ok([album(42)]));assert.deepEqual(s.calls,['search','artists','albums']);});
test('exact editions retain all identities and skip fallback',async()=>{const s=setup({search:ok([album(1),album(2),album(3,'Other')])});assert.deepEqual(await resolveAlbum(s.api,'Record','Artist',s.request),ok([album(1),album(2)]));assert.deepEqual(s.calls,['search']);});
test('missing or ambiguous artist and absent credit cannot trigger lookup',async()=>{for(const artists of [[],[{id:1,name:'Artist'},{id:2,name:'ARTIST'}],[{id:1,name:'Other'}]]){const s=setup({artists:ok(artists)});assert.deepEqual(await resolveAlbum(s.api,'Record','Artist',s.request),ok([]));assert.deepEqual(s.calls,['search','artists']);}const s=setup();await resolveAlbum(s.api,'Record',null,s.request);assert.deepEqual(s.calls,['search']);});
test('failures never retry or dispatch later steps',async()=>{for(const reason of ['rate-limited','network','http','invalid'] as const){const s=setup({search:{ok:false,reason}});assert.deepEqual(await resolveAlbum(s.api,'Record','Artist',s.request),{ok:false,reason});assert.deepEqual(s.calls,['search']);}const s=setup({artists:{ok:false,reason:'rate-limited'}});assert.deepEqual(await resolveAlbum(s.api,'Record','Artist',s.request),{ok:false,reason:'rate-limited'});assert.deepEqual(s.calls,['search','artists']);});
test('cancellation after each await prevents later dispatch and publication',async()=>{for(const step of ['search','searchArtists','artistAlbums'] as const){const s=setup();const original=s.api[step];Object.assign(s.api,{[step]:async (...args:never[])=>{const result=await (original as (...args:never[])=>Promise<unknown>)(...args);s.stop();return result;}});assert.deepEqual(await resolveAlbum(s.api,'Record','Artist',s.request),{ok:false,reason:'cancelled'});assert.deepEqual(s.calls,['search','artists','albums'].slice(0,['search','searchArtists','artistAlbums'].indexOf(step)+1));}});
