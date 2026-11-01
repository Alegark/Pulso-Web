import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readLrclib,validateLrclibRecord,contrastLrclib,parseRetryAfter,LRCLIB_LIMITS} from '../../src/library/lrclib';
const input={title:'Órbita (Live)',artist:'Taller Δ',album:'Luz',durationSeconds:120};
const fixture=(extra={})=>({id:57,trackName:input.title,artistName:input.artist,albumName:input.album,duration:120,instrumental:false,plainLyrics:'Texto original sintético <img src=x onerror=alert(1)>',syncedLyrics:'[00:01.00]Luz sintética',...extra});
const response=(value:unknown=fixture(),init:ResponseInit={})=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'},...init});
const run=(fetcher:typeof fetch,extra={})=>readLrclib(input,{enabled:true,current:()=>true,fetch:fetcher,...extra});
const transport=(r:Response):typeof fetch=>async()=>r;
const defer=<T>()=>{let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('U01 exact NFC contrast, preserved variants, unknowns and closed origin DTO',async()=>{
 const r=validateLrclibRecord(fixture({trackName:'Órbita (Live)',name:'ignored',lyricsfile:'ignored',hasWordSync:true,mbid:'ignored',artwork:'ignored'}))!;
 assert.equal(contrastLrclib(input,r).title,'metadata-consistent');assert.deepEqual(Object.keys(r.origin),['provider','recordId']);
 assert.equal(contrastLrclib({...input,title:'Órbita'},r).title,'conflict');
 assert.equal(contrastLrclib({...input,title:'órbita (Live)'},r).title,'conflict');
 assert.equal(contrastLrclib({...input,title:'Órbita (Remix)'},r).title,'conflict');
 assert.equal(contrastLrclib({...input,album:null,durationSeconds:null},r).album,'unknown');
 assert.equal(contrastLrclib({...input,durationSeconds:122},r).duration,'metadata-consistent');
 assert.equal(contrastLrclib({...input,durationSeconds:122.01},r).duration,'conflict');
 assert.equal((await run(transport(response(fixture({albumName:'Otra edición'}))))).state,'conflict');
 assert.equal((await run(transport(response([fixture(),fixture()])))).state,'unavailable');
 assert.equal(Object.hasOwn(r,'mbid'),false);
});

test('U02 own data only: input/response getters and inherited fields never execute',async()=>{
 let getters=0,fetches=0;const bad=Object.defineProperty({...input},'title',{get(){getters++;throw Error('private');}});
 assert.equal((await readLrclib({...input,title:'\u0344'.repeat(1024)},{enabled:true,current:()=>true,fetch:async()=>{fetches++;return response();}})).state,'missing-input');
 assert.deepEqual(await readLrclib(bad,{enabled:true,current:()=>true,fetch:async()=>{fetches++;return response();}}),{state:'missing-input'});
 for(const key of ['id','trackName','artistName','albumName','duration','instrumental','plainLyrics','syncedLyrics']){
  assert.equal(validateLrclibRecord(Object.defineProperty(fixture(),key,{get(){getters++;throw Error('private');}})),null);
 }
 assert.equal(validateLrclibRecord(Object.create(fixture())),null);
 const unknown=Object.defineProperty(fixture(),'unknown',{get(){getters++;throw Error('private');}});
 assert.ok(validateLrclibRecord(unknown));assert.equal(getters,0);assert.equal(fetches,0);
});

test('U03 field budgets, cues, invalid Unicode/JSON/MIME; text remains inert',async()=>{
 assert.equal(validateLrclibRecord(fixture({albumName:'x'.repeat(1025)})),null);
 assert.equal(validateLrclibRecord(fixture({plainLyrics:'x'.repeat(131073)})),null);
 assert.equal(validateLrclibRecord(fixture({plainLyrics:'😀'.repeat(32769)})),null);
 assert.equal(validateLrclibRecord(fixture({syncedLyrics:Array(4002).fill('[00:01]x').join('\n')})),null);
 assert.equal(validateLrclibRecord(fixture({syncedLyrics:'[99:99]x'})),null);
 assert.equal(validateLrclibRecord(fixture({trackName:'\ud800'})),null);
 assert.ok(validateLrclibRecord(fixture({trackName:'😀',plainLyrics:'[00:09] literal',syncedLyrics:null})));
 for(const r of [new Response('{'),new Response('{}',{headers:{'Content-Type':'text/html'}}),new Response(new Uint8Array([255]),{headers:{'Content-Type':'application/json'}})])assert.deepEqual(await run(transport(r)),{state:'unavailable',reason:'protocol-invalid'});
 const r=validateLrclibRecord(fixture())!;assert.equal(r.plainLyrics?.kind,'plain');
 assert.ok(r.plainLyrics&&'text' in r.plainLyrics&&r.plainLyrics.text.includes('<img'));
});

test('U04 cumulative chunk bounds, Content-Length untrusted, stream cancellation',async()=>{
 const empty=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array());}});
 assert.deepEqual(await run(transport(new Response(empty,{headers:{'Content-Type':'application/json'}}))),{state:'unavailable',reason:'protocol-invalid'});
 let cancelled=0;const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(65536));},cancel(){cancelled++;}});
 assert.deepEqual(await run(transport(new Response(stream,{headers:{'Content-Type':'application/json','Content-Length':'1'}}))),{state:'unavailable',reason:'protocol-invalid'});
 assert.equal(cancelled,1);
 const exact=' '.repeat(LRCLIB_LIMITS.responseBytes-new TextEncoder().encode(JSON.stringify(fixture())).length)+JSON.stringify(fixture());
 assert.equal((await run(transport(new Response(exact,{headers:{'Content-Type':'application/json'}})))).state,'candidate');
 assert.deepEqual(await run(transport(new Response(exact+' ',{headers:{'Content-Type':'application/json'}}))),{state:'unavailable',reason:'protocol-invalid'});
 assert.equal((await run(transport(response(fixture(),{headers:{'Content-Type':'application/json','Content-Length':'9999999'}})))).state,'unavailable');
});

test('U05 plain/LRC, instrumental, 404 and malformed absence remain distinct',async()=>{
 const plain=await run(transport(response(fixture({syncedLyrics:null}))));assert.equal(plain.state,'candidate');
 const timed=await run(transport(response(fixture({plainLyrics:null}))));assert.equal(timed.state,'candidate');
 if('record' in timed)assert.equal(timed.record.syncedLyrics?.kind,'timed');
 assert.equal((await run(transport(response(fixture({instrumental:true,plainLyrics:null,syncedLyrics:null}))))).state,'instrumental');
 assert.equal((await run(transport(new Response('not JSON',{status:404})))).state,'not-found');
 assert.equal((await run(transport(response(fixture({plainLyrics:null,syncedLyrics:null}))))).state,'unavailable');
 assert.equal((await run(transport(response(fixture({instrumental:true}))))).state,'unavailable');
});

test('U06 disabled/missing-input zero IO, one GET, optional valid params, no mutation',async()=>{
 let calls=0;const original=JSON.stringify(input);const fetcher:typeof fetch=async(url,init)=>{
  calls++;assert.ok(String(url).startsWith('https://lrclib.net/api/get?'));assert.equal(init?.method,'GET');assert.equal(init?.credentials,'omit');assert.equal(init?.referrerPolicy,'no-referrer');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');
  assert.equal(new URL(String(url)).searchParams.get('album_name'),null);assert.equal(new URL(String(url)).searchParams.get('duration'),null);return response();
 };
 assert.equal((await readLrclib(input,{enabled:false,current:()=>true,fetch:fetcher})).state,'disabled');
 assert.equal((await readLrclib({...input,title:''},{enabled:true,current:()=>true,fetch:fetcher})).state,'missing-input');assert.equal(calls,0);
 assert.equal((await readLrclib({...input,album:'x'.repeat(1025),durationSeconds:Infinity},{enabled:true,current:()=>true,fetch:fetcher})).state,'candidate');
 assert.equal(calls,1);assert.equal(JSON.stringify(input),original);
});

test('U07 signal/current before dispatch, after fetch and after body; no stale success',async()=>{
 let calls=0;const aborted=new AbortController();aborted.abort();const f:typeof fetch=async()=>{calls++;return response();};
 assert.deepEqual(await run(f,{signal:aborted.signal}),{state:'cancelled',reason:'signal'});
 assert.deepEqual(await run(f,{current:()=>false}),{state:'cancelled',reason:'stale'});assert.equal(calls,0);
 for(const mode of ['signal','stale'] as const){
  const d=defer<Response>(),signal=new AbortController();let current=true;
  const pending=run(async()=>d.promise,{signal:signal.signal,current:()=>current});
  if(mode==='signal')signal.abort();else current=false;d.resolve(response());
  assert.deepEqual(await pending,{state:'cancelled',reason:mode});
 }
 let current=true;const body=new ReadableStream<Uint8Array>({pull(c){current=false;c.enqueue(new TextEncoder().encode(JSON.stringify(fixture())));c.close();}});
 assert.deepEqual(await run(transport(new Response(body,{headers:{'Content-Type':'application/json'}})),{current:()=>current}),{state:'cancelled',reason:'stale'});
});

test('U08 timeout ignores noncooperative transport/body and retires late response',async()=>{
 const d=defer<Response>();assert.deepEqual(await run(async()=>d.promise,{timeoutMs:5}),{state:'unavailable',reason:'timeout'});
 let cancelled=0;d.resolve(new Response(new ReadableStream({cancel(){cancelled++;}})));await new Promise(r=>setTimeout(r,0));assert.equal(cancelled,1);
 let bodyCancel=0;const body=new ReadableStream<Uint8Array>({cancel(){bodyCancel++;return new Promise(()=>{});}});
 assert.deepEqual(await run(transport(new Response(body,{headers:{'Content-Type':'application/json'}})),{timeoutMs:5}),{state:'unavailable',reason:'timeout'});assert.equal(bodyCancel,1);
});

test('U09 first IO cause survives abort/cleanup, hostile errors disclose no payload',async()=>{
 const signal=new AbortController();const stream=new ReadableStream<Uint8Array>({pull(c){c.error({get name(){throw Error('private');},query:'private'});},cancel(){signal.abort();throw Error('private');}});
 assert.deepEqual(await run(transport(new Response(stream,{headers:{'Content-Type':'application/json'}})),{signal:signal.signal}),{state:'unavailable',reason:'network'});
 assert.deepEqual(await run(async()=>{throw {get name(){throw Error('secret');}};}),{state:'unavailable',reason:'network'});
 const d=defer<Response>();const p=run(async()=>d.promise,{signal:signal.signal});signal.abort();d.reject(Error('private'));assert.deepEqual(await p,{state:'cancelled',reason:'signal'});
});

test('U10 bounded Retry-After and 429/503 never retry; redirect/protocol denied',async()=>{
 assert.equal(parseRetryAfter('5'),5);assert.equal(parseRetryAfter('Wed, 01 Jan 2025 00:00:05 GMT',Date.UTC(2025,0,1)),5);
 for(const value of ['-1','1.5','99999999999999','x'.repeat(129),'604801','tomorrow'])assert.equal(parseRetryAfter(value),undefined);
 for(const status of [429,503]){let calls=0;const result=await run(async()=>{calls++;return new Response('edge HTML',{status,headers:{'Retry-After':'12'}});});assert.deepEqual(result,{state:'unavailable',reason:status===429?'rate-limited':'service-unavailable',retryAfterSeconds:12});assert.equal(calls,1);}
 assert.deepEqual(await run(transport(new Response(null,{status:302,headers:{Location:'https://elsewhere.invalid'}}))),{state:'unavailable',reason:'protocol-invalid'});
});


test('U11 stale fetch response ownership cancels body without waiting for cleanup',async()=>{
 for(const cleanup of ['resolved','rejected','pending'] as const){
  const d=defer<Response>();let current=true,cancelled=0;
  const body=new ReadableStream<Uint8Array>({cancel(){
   cancelled++;
   if(cleanup==='rejected')return Promise.reject(new Error('synthetic cleanup failure'));
   if(cleanup==='pending')return new Promise<void>(()=>{});
  }});
  const pending=run(async()=>d.promise,{current:()=>current});
  current=false;d.resolve(new Response(body,{headers:{'Content-Type':'application/json'}}));
  assert.deepEqual(await pending,{state:'cancelled',reason:'stale'});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(cancelled,1,cleanup);assert.equal(body.locked,false,cleanup);
 }
});
