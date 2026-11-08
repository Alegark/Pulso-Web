import test from 'node:test';
import assert from 'node:assert/strict';
import {musicSearchCatalog,musicCatalogKey,MUSIC_CATALOG_LIMITS} from '../../src/library/music-search-catalog';
import type {Track} from '../../src/library/library';
const row=(id:number,title='Hello',artist='Own Artist',album='Album',duration=200)=>({id,trackName:title,artistName:artist,albumName:album,duration});
test('same title/performer groups releases and durations without losing literal version qualifiers',()=>{
 const result=musicSearchCatalog('hello',[],[row(1),row(2,'HELLO','own artist','Compilation',199),row(3,'Hello','Own Artist','Deluxe',204),row(4,'Hello (Live)'),row(5,'Hello (Remix)'),row(6,'Hello','Another performer')]);
 assert.equal(result.filter(r=>r.kind==='track').length,4);
 assert.deepEqual(result.map(r=>r.id),['lrclib:1','lrclib:4','lrclib:5','lrclib:6']);
 assert.equal(result.some(r=>r.kind==='album'),false);
});
test('presentation keys normalize Unicode quotes/dashes and spacing, not words or accents',()=>{
 assert.equal(musicCatalogKey('  “ Hello  –  Live ”  '),musicCatalogKey('hello-live'));
 assert.notEqual(musicCatalogKey('Hello (Live)'),musicCatalogKey('Hello'));
 assert.notEqual(musicCatalogKey('El'),musicCatalogKey('Él'));
});
test('artist names are display context, never separate categories or local name-only matches',()=>{
 const local={id:'owned',title:'Hello',artist:'Own Artist',album:'Album',duration:200} as Track;
 assert.deepEqual(musicSearchCatalog('Own Artist',[local],[]),[]);
 const result=musicSearchCatalog('hello',[],[row(1)]);assert.equal(result[0].artist,'Own Artist');assert.equal(result.some(r=>(r.kind as string)==='artist'),false);
});
test('albums appear only for matching album names and group by title plus performer',()=>{
 const result=musicSearchCatalog('night',[],[row(1,'First','Own Artist','Night'),row(2,'Second','OWN ARTIST','NIGHT'),row(3,'Third','Another artist','Night')]);
 assert.equal(result.filter(r=>r.kind==='track').length,3);assert.equal(result.filter(r=>r.kind==='album').length,2);
});
test('local metadata wins the duplicate group and unknown performers are not silently merged',()=>{
 const local={id:'owned-track',title:'Hello',artist:'Own Artist',album:null,duration:200} as Track;
 const result=musicSearchCatalog('hello',[local,{...local,id:'unknown',artist:null}],[row(1)]);
 assert.equal(result.length,2);assert.equal(result[0].id,'local:owned-track');assert.equal(result[0].source,'local');assert.equal(result[1].artist,null);
});
test('empty queries stay empty; unrelated local records are excluded and local selection is bounded',()=>{
 assert.deepEqual(musicSearchCatalog(' ',[],[row(1)]),[]);assert.deepEqual(musicSearchCatalog('missing',[{id:'owned',title:'Hello',artist:null,album:null,duration:1} as Track],[]),[]);
 const local=Array.from({length:1000},(_,i)=>({id:String(i),title:'Song '+i,artist:'Own',album:null,duration:1} as Track));
 const out=musicSearchCatalog('song',local,[]);assert.equal(out.length,MUSIC_CATALOG_LIMITS.localMatches);
});

test('provider-ranked fuzzy/accent candidates survive without a stricter second filter',()=>{
 const result=musicSearchCatalog('besame mucho own artist',[],[row(99,'Bésame Mucho')]);assert.equal(result.length,1);assert.equal(result[0].title,'Bésame Mucho');
});
test('local title matching tolerates accents and punctuation without broad punctuation-only matches',()=>{
 const local={id:'owned',title:'Bésame, Mucho!',artist:'Own',album:null,duration:1} as Track;
 assert.equal(musicSearchCatalog('besame mucho',[local],[]).length,1);assert.deepEqual(musicSearchCatalog('---',[local],[]),[]);
});

test('cross-field words, order, punctuation and prefixes rank full title and performer first',()=>{
 const local=[{id:'wrong',title:'Yo siempre contesto',artist:'Otro',album:null,duration:1},{id:'right',title:'Yo siempre contesto',artist:'LATIN MAFIA',album:null,duration:1}] as Track[];
 for(const q of ['yo siempre contesto latin mafia','MAFIA, latin contésto siempre yo','yo siempre contes latin maf']){
  const out=musicSearchCatalog(q,local,[row(200,'Yo siempre contesto','Another')]);assert.equal(out[0].id,'local:right');assert.ok(out.findIndex(r=>r.id==='local:wrong')>0);
 }
});
test('best local match survives cap after a thousand earlier partial matches',()=>{
 const local=Array.from({length:1000},(_,i)=>({id:String(i),title:'Yo siempre contesto',artist:'Otro',album:null,duration:1} as Track));
 local.push({id:'best',title:'Yo siempre contesto',artist:'LATIN MAFIA',album:null,duration:1} as Track);
 assert.equal(musicSearchCatalog('yo siempre contesto latin mafia',local,[])[0].id,'local:best');
});


test('a title identical to the performer remains searchable',()=>{
 const t={id:'same-name',title:'Talk Talk',artist:'Talk Talk',album:null,duration:1} as Track;
 assert.equal(musicSearchCatalog('talk talk',[t],[])[0]?.id,'local:same-name');
});

test('canonical artist and edition identities remain distinct from song choices',()=>{
 const result=musicSearchCatalog('luna',[],[row(1,'Luna','Full Artist Credit')],[{id:42,title:'Luna',artist:'Album Credit',trackCount:3,releaseDate:null}],[{id:42,name:'Luna'}]);
 assert.deepEqual(result.map(item=>item.id),['lrclib:1','itunes:album:42','itunes:artist:42']);
 const album=result.find(item=>item.kind==='album');const artist=result.find(item=>item.kind==='artist');
 assert.equal(album?.kind==='album'&&album.editionId,42);assert.equal(artist?.kind==='artist'&&artist.artistId,42);
 assert.equal(result[0].artist,'Full Artist Credit');
});
