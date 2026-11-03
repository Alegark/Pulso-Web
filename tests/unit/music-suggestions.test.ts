import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMusicSuggestionsClient,normalizeMusicSuggestionsQuery,validateMusicSuggestions,deriveMusicSuggestionGroups,MUSIC_SUGGESTIONS_CLIENT} from '../../src/library/music-suggestions';
const row=(extra={})=>({id:1,trackName:'Órbita (Live Remix)',artistName:'Taller Δ',albumName:'Edición Uno',duration:123,...extra});
const ok=(v:unknown=[row()])=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
const current=()=>true;
const defer=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setTimeout(r,0));

test('U01 conservative Unicode query / closed metadata / no accessor execution / groups',()=>{
 assert.equal(normalizeMusicSuggestionsQuery('  Órbita  Live  '),'Órbita Live');
 for(const q of ['ab','😀😀','https://a.test','/start','@bot','javascript:alert(1)','a\nb','x'.repeat(161),'\ud800ab'])assert.equal(normalizeMusicSuggestionsQuery(q),null,q);
 assert.equal(normalizeMusicSuggestionsQuery('音楽の歌'),'音楽の歌');
 let called=0;for(const k of ['id','trackName','artistName','albumName','duration'])assert.equal(validateMusicSuggestions([Object.defineProperty(row(),k,{get(){called++;throw 0;}})]),null);
 assert.equal(validateMusicSuggestions([Object.create(row())]),null);
 const projected=validateMusicSuggestions([Object.defineProperty(row(),'plainLyrics',{get(){called++;throw 0;}})])!;
 assert.equal(called,0);assert.deepEqual(Object.keys(projected[0]),['id','trackName','artistName','albumName','duration']);assert.equal(projected[0].trackName,'Órbita (Live Remix)');
 assert.equal(validateMusicSuggestions([row({duration:Infinity})]),null);assert.equal(validateMusicSuggestions([row({trackName:'x'.repeat(1025)})]),null);
 assert.equal(validateMusicSuggestions(Array.from({length:21},(_,id)=>row({id:id+1}))),null);
 const tracks=validateMusicSuggestions([row(),row(),row({id:2}),row({id:3,artistName:'Otro'}),row({id:4,albumName:''})])!;
 const groups=deriveMusicSuggestionGroups(tracks);assert.equal(tracks.length,4);assert.equal(groups.artists.length,2);assert.equal(groups.albums.length,2);assert.equal(groups.albums[0].tracks.length,2);assert.ok(Object.isFrozen(tracks[0]));
});
test('U02 no implicit IO; exact GET policy and closed errors',async()=>{
 let calls=0;const c=createMusicSuggestionsClient({fetch:async(url,init)=>{calls++;assert.equal(new URL(String(url)).origin,'https://lrclib.net');assert.equal(new URL(String(url)).pathname,'/api/v2/search');assert.deepEqual([...new URL(String(url)).searchParams.keys()],['q']);assert.equal(new Headers(init?.headers).get('Lrclib-Client'),MUSIC_SUGGESTIONS_CLIENT);assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'error');assert.equal(init?.referrerPolicy,'no-referrer');assert.equal(init?.cache,'no-store');return ok();}});
 assert.equal(c.getRateState().state,'ready');assert.equal(calls,0);assert.equal((await c.search('abc',{current:()=>false})).state,'cancelled');assert.equal((await c.search('ab',{current})).state,'invalid-query');assert.equal(calls,0);
 const result=await c.search('Órbita Live',{current});assert.equal(result.state,'ready');assert.equal(calls,1);c.close();assert.equal((await c.search('abc',{current})).state,'closed');assert.equal(c.getRateState().state,'closed');
 for(const response of [new Response('<secret>',{headers:{'Content-Type':'text/html'}}),ok({secret:'unknown'}),new Response('{',{headers:{'Content-Type':'application/json'}}),new Response(null,{status:500}),new Response(new Uint8Array([255]),{headers:{'Content-Type':'application/json'}})]){
  const x=createMusicSuggestionsClient({fetch:async()=>response});const r=await x.search('abc',{current});assert.equal(r.state,'unavailable');assert.ok(!JSON.stringify(r).includes('secret'));x.close();
 }
});
test('U03 actual streaming boundaries, exact byte budget, empty chunks and cancel',async()=>{
 const payload=JSON.stringify([row()]);const exact=' '.repeat(262144-new TextEncoder().encode(payload).length)+payload;
 for(const [body,expected] of [[exact,'ready'],[exact+' ','unavailable']] as const){
  let offset=0,cancelled=0;const bytes=new TextEncoder().encode(body);const stream=new ReadableStream<Uint8Array>({pull(c){if(offset===bytes.length){c.close();return;}const end=Math.min(offset+73,bytes.length);c.enqueue(bytes.slice(offset,end));offset=end;},cancel(){cancelled++;}});
  const client=createMusicSuggestionsClient({fetch:async()=>new Response(stream,{headers:{'Content-Type':'application/json','Content-Length':'1'}})});assert.equal((await client.search('abc',{current})).state,expected);// A source already closed by stream prefetch need not invoke underlying cancel.
  assert.ok(cancelled<=1);client.close();
 }
 let oversizedCancel=0;const oversized=createMusicSuggestionsClient({fetch:async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(65536));},cancel(){oversizedCancel++;}}),{headers:{'Content-Type':'application/json'}})});assert.equal((await oversized.search('abc',{current})).state,'unavailable');assert.equal(oversizedCancel,1);oversized.close();
 let cancelled=0;const c=createMusicSuggestionsClient({fetch:async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array());},cancel(){cancelled++;}}),{headers:{'Content-Type':'application/json'}})});assert.equal((await c.search('abc',{current})).state,'unavailable');assert.equal(cancelled,1);c.close();
});
test('U04 timeout keeps noncooperative fetch busy; late response canceled and late cooldown retained',async()=>{
 for(const status of [200,429,503]){
  let n=10000,calls=0,cancelled=0;const d=defer<Response>();const c=createMusicSuggestionsClient({now:()=>n,timeoutMs:5,fetch:async()=>{calls++;return d.promise;}});
  assert.deepEqual(await c.search('first',{current}),{state:'unavailable',reason:'timeout'});n+=2000;assert.equal(c.getRateState().state,'busy');assert.equal((await c.search('second',{current})).state,'busy');assert.equal(calls,1);
  d.resolve(new Response(new ReadableStream({cancel(){cancelled++;}}),{status,headers:{'Retry-After':'60'}}));await tick();assert.equal(cancelled,1);assert.equal(c.getRateState().state,status===200?'ready':'cooldown');if(status!==200)assert.ok(c.getRateState().retryAt!>=n+60000);c.close();
 }
});
test('U05 new query epoch/current invalidation prevents old cache publication; cancellation holds cleanup slot',async()=>{
 let n=0,calls=0,valid=true,cancelled=0;const d=defer<Response>();const c=createMusicSuggestionsClient({now:()=>n,fetch:async()=>{calls++;return calls===1?d.promise:ok();}});
 const first=c.search('first',{current:()=>valid});assert.equal((await c.search('second',{current})).state,'busy');assert.equal((await first).state,'cancelled');
 d.resolve(new Response(new ReadableStream({cancel(){cancelled++;}})));await tick();assert.equal(cancelled,1);n=2000;assert.equal((await c.search('first',{current})).state,'ready');assert.equal(calls,2);c.close();
 const body=new ReadableStream<Uint8Array>({pull(controller){valid=false;controller.enqueue(new TextEncoder().encode(JSON.stringify([row()])));controller.close();}});valid=true;
 const b=createMusicSuggestionsClient({fetch:async()=>new Response(body,{headers:{'Content-Type':'application/json'}})});assert.equal((await b.search('abc',{current:()=>valid})).state,'cancelled');b.close();
 const controller=new AbortController();const hold=defer<void>();let cancel=0;const stream=new ReadableStream<Uint8Array>({cancel(){cancel++;return hold.promise;}});const x=createMusicSuggestionsClient({timeoutMs:5,fetch:async()=>new Response(stream,{headers:{'Content-Type':'application/json'}})});
 assert.equal((await x.search('abc',{signal:controller.signal,current})).state,'unavailable');await tick();assert.equal(cancel,1);assert.equal(x.getRateState().state,'busy');hold.resolve();await tick();assert.equal(x.getRateState().state,'cooldown');x.close();
});
test('U06 Retry-After absolute date / delta / unknown fail closed / no retries',async()=>{
 for(const header of ['60','Wed, 01 Jan 2031 00:01:00 GMT','tomorrow',null]){
  let n=Date.UTC(2031,0,1),calls=0;const c=createMusicSuggestionsClient({now:()=>n,fetch:async()=>{calls++;return new Response('edge private error',{status:429,headers:header?{'Retry-After':header}:{}});}});
  const result=await c.search('abc',{current});assert.equal(result.state,'rate-limited');assert.equal(calls,1);const valid=header==='60'||header?.startsWith('Wed');assert.equal(c.getRateState().state,valid?'cooldown':'blocked');assert.equal((await c.search('def',{current})).state,'rate-limited');assert.equal(calls,1);n+=65000;if(valid)assert.equal(c.getRateState().state,'ready');else assert.equal(c.getRateState().state,'blocked');c.close();
 }
});
test('U07 RAM LRU30 TTL5min; hits require current; query epoch invalidates pending even on hit',async()=>{
 let n=0,calls=0;let pending:ReturnType<typeof defer<Response>>|undefined;
 const c=createMusicSuggestionsClient({now:()=>n,fetch:async()=>{calls++;return pending?pending.promise:ok();}});
 for(let i=0;i<31;i++){n+=1001;assert.equal((await c.search('query '+i,{current})).state,'ready');}
 assert.equal(calls,31);n+=1001;const hit=await c.search('query 30',{current});assert.equal(hit.state,'ready');if(hit.state==='ready')assert.equal(hit.cached,true);assert.equal(calls,31);
 assert.equal((await c.search('query 30',{current:()=>false})).state,'cancelled');assert.equal(calls,31);
 await c.search('query 0',{current});assert.equal(calls,32);n+=1001;pending=defer<Response>();const first=c.search('pending',{current});const cached=await c.search('query 30',{current});assert.equal(cached.state,'ready');assert.equal((await first).state,'cancelled');pending.resolve(ok());await tick();pending=undefined;n+=300001;await c.search('query 30',{current});assert.equal(calls,34);c.close();
});
test('U08 1s spacing, preaborted, close midstream, stale callback and network failures',async()=>{
 let n=0,calls=0;const c=createMusicSuggestionsClient({now:()=>n,fetch:async()=>{calls++;return ok();}});const a=new AbortController();a.abort();assert.equal((await c.search('abc',{signal:a.signal,current})).state,'cancelled');await c.search('abc',{current});assert.equal((await c.search('def',{current})).state,'rate-limited');assert.equal(calls,1);n=1000;await c.search('def',{current});assert.equal(calls,2);c.close();
 const d=defer<Response>();const x=createMusicSuggestionsClient({fetch:async()=>d.promise});const p=x.search('abc',{current});x.close();assert.equal((await p).state,'closed');let cancelled=0;d.resolve(new Response(new ReadableStream({cancel(){cancelled++;}})));await tick();assert.equal(cancelled,1);
 const bad=createMusicSuggestionsClient({fetch:async()=>{throw {get message(){throw 0;}};}});assert.deepEqual(await bad.search('abc',{current}),{state:'unavailable',reason:'network'});bad.close();
});
test('U09 protocol failure survives cleanup revocation and hanging cancellation retains slot',async()=>{
 const a=new AbortController();let cancelled=0;const hold=defer<void>();
 const c=createMusicSuggestionsClient({fetch:async()=>new Response(new ReadableStream({cancel(){cancelled++;a.abort();return hold.promise;}}),{headers:{'Content-Type':'text/html'}})});
 assert.deepEqual(await c.search('abc',{signal:a.signal,current}),{state:'unavailable',reason:'protocol'});assert.equal(cancelled,1);assert.equal(c.getRateState().state,'busy');hold.resolve();await tick();assert.equal(c.getRateState().state,'cooldown');c.close();
});
