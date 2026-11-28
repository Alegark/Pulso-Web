import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePlaylistId,youtubeItemsToSongs,loadYoutubePlaylist,youtubeFailureText} from '../../src/library/youtube-playlist';
import {importYoutubePlaylist} from '../../src/playlists/youtube-import';
import {validateAccountLibrary,type AccountLibraryDocument} from '../../src/accounts/library-document.mjs';
import {musicCatalogKey} from '../../src/library/music-search-catalog';

const ID='PLymdogRYFRdJDRc2TzZnE5OCw-sRpyXEm';
const ACCOUNT='11111111-1111-4111-8111-111111111111';
const uuid=(n:number)=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;

test('playlist parser accepts full links and bare IDs, and rejects malformed inputs',()=>{
 assert.equal(parsePlaylistId(`https://www.youtube.com/playlist?list=${ID}`),ID);
 assert.equal(parsePlaylistId(`https://www.youtube.com/watch?v=abc123&list=${ID}&index=2`),ID);
 assert.equal(parsePlaylistId(`https://music.youtube.com/playlist?list=${ID}#x`),ID);
 assert.equal(parsePlaylistId(` ${ID} `),ID);
 for(const bad of ['','hola','https://example.com/','https://www.youtube.com/watch?v=abc','list=corto','x'.repeat(80)])assert.equal(parsePlaylistId(bad),null,bad);
});

test('video titles and channel names become clean songs; mixes, shorts and invalid rows are ignored',()=>{
 const {songs,ignored}=youtubeItemsToSongs([
  {title:'Melatonin',channel:'TUZI - Topic'},
  {title:'Lana Del Rey - Say Yes To Heaven (Official Audio)',channel:'Lana Del Rey'},
  {title:'Night Tapes - Swordsman [Lyric Video]',channel:'Fan Uploads'},
  {title:'Suzume (feat. Toaka)',channel:'RADWIMPS'},
  {title:'Golden Brown',channel:'Release - Topic'},
  {title:'Golden Cats - Ivory (Shadow)',channel:'Golden Cats - Topic'},
  {title:'clip #shorts',channel:'X'},
  {title:'I WANT YOU | Late Night Lovers Playlist (pt.21)',channel:'OnlyYou'},
  {title:'Solo titulo',channel:''},
 ]);
 assert.deepEqual(songs,[
  {title:'Melatonin',artist:'TUZI'},
  {title:'Say Yes To Heaven',artist:'Lana Del Rey'},
  {title:'Swordsman',artist:'Night Tapes'},
  {title:'Suzume (feat. Toaka)',artist:'RADWIMPS'},
  {title:'Golden Brown',artist:'Release'},
  {title:'Ivory (Shadow)',artist:'Golden Cats'},
 ]);
 assert.equal(ignored,3);
});

const reply=(status:number,body:unknown)=>async()=>new Response(JSON.stringify(body),{status});
const signal=()=>new AbortController().signal;
test('client sends a same-origin uncached request and validates the response shape',async()=>{
 const ok={name:'HIGH & TRIP',total:2,truncated:false,items:[{title:'a',channel:'b'}]};
 let received:RequestInfo|URL|undefined,init:RequestInit|undefined;
 const fetcher=(async(input:RequestInfo|URL,options?:RequestInit)=>{received=input;init=options;return new Response(JSON.stringify(ok));}) as typeof fetch;
 const result=await loadYoutubePlaylist(ID,{signal:signal(),fetcher});
 assert.deepEqual(result,{ok:true,value:ok});
 assert.equal(received,`/api/youtube-playlist?list=${encodeURIComponent(ID)}`);
 assert.equal(init?.credentials,'same-origin');assert.equal(init?.cache,'no-store');assert.ok(init?.signal);
 const malformed=await loadYoutubePlaylist(ID,{signal:signal(),fetcher:reply(200,{...ok,items:[{title:1,channel:''}]}) as typeof fetch});
 assert.deepEqual(malformed,{ok:false,reason:'invalid'});
});

test('client maps all supported HTTP errors to distinct reasons',async()=>{
 const reason=async(status:number,body:unknown)=>(await loadYoutubePlaylist(ID,{signal:signal(),fetcher:reply(status,body) as typeof fetch}) as {reason:string}).reason;
 assert.equal(await reason(401,{error:'sign-in-required'}),'sign-in-required');
 assert.equal(await reason(429,{error:'rate-limited'}),'rate-limited');
 assert.equal(await reason(429,{error:'quota'}),'quota');
 assert.equal(await reason(503,{error:'not-configured'}),'not-configured');
 assert.equal(await reason(404,{error:'not-found'}),'not-found');
 assert.equal(await reason(403,{error:'private'}),'private');
 assert.equal(await reason(400,{error:'invalid'}),'invalid');
 assert.equal(await reason(502,{error:'unavailable'}),'unavailable');
 assert.deepEqual(await loadYoutubePlaylist('not a playlist',{signal:signal(),fetcher:reply(200,{}) as typeof fetch}),{ok:false,reason:'bad-link'});
 for(const reason of ['sign-in-required','rate-limited','not-configured','not-found','private','quota','invalid','bad-link','unavailable'] as const)
  assert.ok(youtubeFailureText[reason].length>12,`Spanish text for ${reason}`);
});

type Row={key:IDBValidKey;value:unknown};
function compareKey(a:IDBValidKey,b:IDBValidKey):number{
 if(Array.isArray(a)&&Array.isArray(b)){
  for(let i=0;i<Math.min(a.length,b.length);i++){const part=compareKey(a[i],b[i]);if(part)return part;}
  return Math.sign(a.length-b.length);
 }
 if(typeof a==='number'&&typeof b==='number')return Math.sign(a-b);
 if(typeof a==='string'&&typeof b==='string')return a<b?-1:a>b?1:0;
 return JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0;
}
function installDatabase(rows:{tracks:Row[];playlists:Row[];settings:Row[]}){
 const calls:string[]=[];
 const keyOf=(key:IDBValidKey)=>JSON.stringify(key);
 const rangeMatches=(key:IDBValidKey,range?:{lower:IDBValidKey;upper:IDBValidKey})=>!range||compareKey(key,range.lower)>=0&&compareKey(key,range.upper)<=0;
 const schedule=(tx:{oncomplete?:()=>void})=>setTimeout(()=>tx.oncomplete?.(),5);
 const requestFor=(tx:{oncomplete?:()=>void},action:()=>unknown)=>{
  const req:{result?:unknown;onsuccess?:()=>void;onerror?:()=>void;error?:DOMException|null}={};
  queueMicrotask(()=>{try{req.result=action();req.onsuccess?.();schedule(tx);}catch(error){req.error=error as DOMException;req.onerror?.();}});
  return req;
 };
 const db={
  transaction:(_stores:string|string[],_mode?:IDBTransactionMode)=>{
   const tx:{oncomplete?:()=>void;onabort?:()=>void;addEventListener:()=>void;abort:()=>void;objectStore:(name:string)=>unknown}={
    addEventListener:()=>{},abort(){setTimeout(()=>this.onabort?.(),0);},
    objectStore(name){
     const bucket=rows[name as keyof typeof rows];
     return {
      get(key:IDBValidKey){calls.push(`${name}.get`);return requestFor(tx,()=>bucket.find(row=>keyOf(row.key)===keyOf(key))?.value);},
      getAll(query?:{lower:IDBValidKey;upper:IDBValidKey}){calls.push(`${name}.getAll`);return requestFor(tx,()=>bucket.filter(row=>rangeMatches(row.key,query)).sort((a,b)=>compareKey(a.key,b.key)).map(row=>row.value));},
      getAllKeys(query?:{lower:IDBValidKey;upper:IDBValidKey}){calls.push(`${name}.getAllKeys`);return requestFor(tx,()=>bucket.filter(row=>rangeMatches(row.key,query)).sort((a,b)=>compareKey(a.key,b.key)).map(row=>row.key));},
      put(value:unknown,key:IDBValidKey){calls.push(`${name}.put`);return requestFor(tx,()=>{const old=bucket.findIndex(row=>keyOf(row.key)===keyOf(key));if(old>=0)bucket[old]={key,value};else bucket.push({key,value});return key;});},
      add(value:unknown,key:IDBValidKey){calls.push(`${name}.add`);return requestFor(tx,()=>{if(bucket.some(row=>keyOf(row.key)===keyOf(key)))throw Error('ConstraintError');bucket.push({key,value});return key;});},
     };
    },
   };
   return tx;
  },close(){},addEventListener(){},
 };
 const idb={open:()=>{const req:{result?:unknown;onsuccess?:()=>void;onerror?:()=>void;onupgradeneeded?:()=>void;error?:DOMException|null}={};queueMicrotask(()=>{req.result=db;req.onsuccess?.();});return req;}};
 const previous={indexedDB:Object.getOwnPropertyDescriptor(globalThis,'indexedDB'),IDBKeyRange:Object.getOwnPropertyDescriptor(globalThis,'IDBKeyRange'),navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')};
 Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:idb});
 Object.defineProperty(globalThis,'IDBKeyRange',{configurable:true,value:{bound:(lower:IDBValidKey,upper:IDBValidKey)=>({lower,upper})}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:(_name:string,callback:()=>Promise<unknown>)=>callback()}}});
 return {calls,restore(){for(const [name,descriptor] of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,name,{...descriptor,configurable:true});else Reflect.deleteProperty(globalThis,name);}}};
}

test('IDB alias reads are batched; reimport updates its linked playlist and preserves a same-name manual list',async()=>{
 const aliasTrack={id:uuid(1),accountId:ACCOUNT,assetId:null,title:'Alias Song',artist:'Alias Artist',album:null,duration:0,favorite:false,revision:1,createdAt:'2026-11-28T00:00:00.000Z',manualOverrides:{}};
 const unavailableCopy={id:uuid(2),accountId:ACCOUNT,assetId:uuid(22),title:'Chosen Song',artist:'Chosen Artist',album:null,duration:10,favorite:false,revision:1,createdAt:'2026-11-28T00:00:00.000Z',manualOverrides:{}};
 const availableCopy={id:uuid(3),accountId:ACCOUNT,assetId:null,title:'Chosen Song',artist:'Chosen Artist',album:null,duration:10,favorite:false,revision:1,createdAt:'2026-11-28T00:00:00.000Z',manualOverrides:{}};
 const manualTrack={id:uuid(4),accountId:ACCOUNT,assetId:null,title:'Manual Song',artist:'Manual Artist',album:null,duration:20,favorite:false,revision:1,createdAt:'2026-11-28T00:00:00.000Z',manualOverrides:{}};
 const songKey=JSON.stringify([musicCatalogKey('Alias Song'),musicCatalogKey('Alias Artist')]);
 const listKey=['youtube-playlist',1,ACCOUNT,ID];
 const manual={id:uuid(5),accountId:ACCOUNT,name:'Shared name',entries:[{id:uuid(6),trackId:manualTrack.id}],revision:1};
 const dbRows={tracks:[aliasTrack,unavailableCopy,availableCopy,manualTrack].map(track=>({key:track.id,value:track})),playlists:[{key:manual.id,value:manual}],settings:[
  {key:'pulso-account-library-active',value:ACCOUNT},
  {key:['youtube-track',1,ACCOUNT,songKey],value:aliasTrack.id},
 ]};
 const installed=installDatabase(dbRows);
 try{
  const first=await importYoutubePlaylist({listId:ID,name:'Shared name',songs:[
   {title:'Alias Song',artist:'Alias Artist'},
   {title:'Chosen Song',artist:'Chosen Artist'},
   {title:'New Song',artist:'New Artist'},
   {title:'New Song',artist:'New Artist'},
  ]},ACCOUNT,()=>true,id=>id===availableCopy.id);
  assert.equal(first.created,1);assert.equal(first.reused,2);assert.equal(first.repeated,1);assert.equal(first.updated,false);
  assert.equal(first.playlist.entries[0].trackId,aliasTrack.id);
  assert.equal(first.playlist.entries[1].trackId,availableCopy.id,'an available copy wins over a stale asset alias');
  assert.equal(dbRows.playlists.length,2,'manual playlist is not overwritten by a matching name');
  assert.deepEqual(dbRows.playlists[0].value,manual);
  assert.ok(installed.calls.includes('settings.getAllKeys')&&installed.calls.includes('settings.getAll'));
  assert.equal(installed.calls.filter(call=>call==='settings.get').length,2,'only account and playlist link are point reads');
  const second=await importYoutubePlaylist({listId:ID,name:'Shared name',songs:[
   {title:'Alias Song',artist:'Alias Artist'},{title:'New Song',artist:'New Artist'},{title:'Another Song',artist:'Other Artist'},
  ]},ACCOUNT,()=>true,id=>id===availableCopy.id);
  assert.equal(second.updated,true);assert.equal(second.playlist.id,first.playlist.id);
  assert.equal(dbRows.playlists.length,2);assert.deepEqual(dbRows.playlists[0].value,manual);
  assert.equal(dbRows.settings.find(row=>JSON.stringify(row.key)===JSON.stringify(listKey))?.value,first.playlist.id);
  const tracks=dbRows.tracks.map(({value})=>value as typeof aliasTrack);
  const dto:AccountLibraryDocument={version:1,tracks:tracks.filter(track=>track.accountId===ACCOUNT).map(track=>({
   id:track.id,title:track.title,artist:track.artist,album:track.album,duration:track.duration,favorite:track.favorite,
   inLibrary:true,createdAt:track.createdAt,localAlbum:null,catalog:null,
  })),playlists:dbRows.playlists.map(({value})=>{const list=value as typeof manual;return {id:list.id,name:list.name,entries:list.entries};})};
  assert.deepEqual(validateAccountLibrary(dto),dto,'metadata-only duration 0 passes Neon library validation');
 }finally{installed.restore();}
});
