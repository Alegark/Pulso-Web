import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const dir='.local/music-suggestions-r140';await mkdir(dir,{recursive:true});await mkdir('.local/evidence',{recursive:true});
execFileSync('node_modules/.bin/tsc',['--ignoreConfig','--target','ES2022','--module','ES2022','--lib','ES2022,DOM,DOM.Iterable','--strict','--noUnusedLocals','--noUnusedParameters','--outDir',dir+'/compiled','src/library/music-suggestions.ts']);
const js=await readFile(dir+'/compiled/music-suggestions.js','utf8');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/adapter.js'?'text/javascript':'text/html');res.end(req.url==='/adapter.js'?js:'<!doctype html><title>Isolated metadata tests</title>');});
const report={scope:'Isolated adapter, synthetic injected fetch and real Response/ReadableStream; Chromium headless sandbox, loopback0; no external GET/preflight, UI/Telegram/product/iPhone not tested',cases:[],pageerrors:[],externalRequests:0,cleanup:false};let browser;
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();
 const context=await browser.newContext();await context.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){report.externalRequests++;return route.abort();}return route.continue();});
 const page=await context.newPage();page.on('pageerror',e=>report.pageerrors.push(String(e)));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const results=await page.evaluate(async()=>{
  const {createMusicSuggestionsClient,validateMusicSuggestions}=await import('/adapter.js');const cases=[];
  const check=(v,m)=>{if(!v)throw Error(m);};const row={id:1,trackName:'Órbita (Live Remix)',artistName:'Taller Δ',albumName:'Edición Uno',duration:123};const current=()=>true;
  const response=()=>new Response(JSON.stringify([row]),{headers:{'Content-Type':'application/json'}});const tick=()=>new Promise(r=>setTimeout(r,0));
  async function group(name,fn){try{await fn();cases.push({name,status:'PASS'});}catch(e){cases.push({name,status:'FAIL',error:String(e)});}}
  await group('B01 native streams: split UTF8, metadata projection, closed immutable groups',async()=>{
   let n=0;const bytes=new TextEncoder().encode(JSON.stringify([{...row,plainLyrics:'SYNTHETIC IGNORED',photoURL:'https://invalid.example'}]));const stream=new ReadableStream({pull(c){if(n===bytes.length)c.close();else c.enqueue(bytes.slice(n,n+=1));}});
   const client=createMusicSuggestionsClient({fetch:async()=>new Response(stream,{headers:{'Content-Type':'application/json'}})});const r=await client.search('Órbita Live',{current});check(r.state==='ready','ready');check(r.tracks[0].trackName===row.trackName,'literal');check(Object.keys(r.tracks[0]).length===5,'projection');check(Object.isFrozen(r.tracks[0]),'frozen');client.close();
  });
  await group('B02 deadline: noncooperative fetch retains slot and cancels late 503 body',async()=>{
   let resolve,cancelled=0,calls=0,n=0;const pending=new Promise(r=>resolve=r);const client=createMusicSuggestionsClient({timeoutMs:8,now:()=>n,fetch:()=>{calls++;return pending;}});
   check((await client.search('first',{current})).reason==='timeout','timeout');n=2000;check(client.getRateState().state==='busy','busy');check((await client.search('second',{current})).state==='busy','no reuse');check(calls===1,'one');
   resolve(new Response(new ReadableStream({cancel(){cancelled++;}}),{status:503,headers:{'Retry-After':'60'}}));await tick();check(cancelled===1,'late body cancel');check(client.getRateState().state==='cooldown','late cooldown');check(client.getRateState().retryAt>=62000,'absolute');client.close();
  });
  await group('B03 revocation during real stream read prevents cache publication',async()=>{
   let valid=true,n=0,calls=0;const client=createMusicSuggestionsClient({now:()=>n,fetch:async()=>{calls++;if(calls>1)return response();return new Response(new ReadableStream({pull(c){valid=false;c.enqueue(new TextEncoder().encode(JSON.stringify([row])));c.close();}}),{headers:{'Content-Type':'application/json'}});}});
   check((await client.search('abc',{current:()=>valid})).state==='cancelled','revoked');await tick();n=2000;valid=true;const r=await client.search('abc',{current});check(r.state==='ready'&&!r.cached&&calls===2,'not cached');client.close();
  });
  await group('B04 streaming over budget cancels and empty chunks are bounded',async()=>{
   for(const size of [65536,0]){let cancelled=0;const client=createMusicSuggestionsClient({fetch:async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(size));},cancel(){cancelled++;}}),{headers:{'Content-Type':'application/json'}})});check((await client.search('abc',{current})).reason==='protocol','bound');check(cancelled===1,'cancel');client.close();}
  });
  await group('B05 pending body cancellation keeps busy; close never permits reuse',async()=>{
   let release,cancelled=0;const hold=new Promise(r=>release=r);const client=createMusicSuggestionsClient({timeoutMs:8,fetch:async()=>new Response(new ReadableStream({cancel(){cancelled++;return hold;}}),{headers:{'Content-Type':'application/json'}})});
   check((await client.search('abc',{current})).reason==='timeout','deadline');check(cancelled===1&&client.getRateState().state==='busy','pending cleanup busy');client.close();check((await client.search('def',{current})).state==='closed','closed');release();await tick();
  });
  await group('B06 zero implicit IO, cache current gate and unknown Retry-After failclosed',async()=>{
   let calls=0,n=0;const client=createMusicSuggestionsClient({now:()=>n,fetch:async()=>{calls++;return calls===1?response():new Response('edge',{status:429});}});check(calls===0&&client.getRateState().state==='ready','no io');await client.search('abc',{current});check((await client.search('abc',{current:()=>false})).state==='cancelled','cache gate');check((await client.search('abc',{current})).cached,'hit');n=2000;await client.search('def',{current});check(client.getRateState().state==='blocked','unknown');n=999999;check((await client.search('ghi',{current})).state==='rate-limited'&&calls===2,'no retry');client.close();
   let access=0;check(validateMusicSuggestions([Object.defineProperty({...row},'duration',{get(){access++;return 1;}})])===null&&access===0,'no getters');
  });return cases;
 });report.cases=results;await context.close();assert.equal(results.length,6);assert.equal(results.filter(x=>x.status==='FAIL').length,0);assert.equal(report.pageerrors.length,0);assert.equal(report.externalRequests,0);
}catch(e){report.failure=String(e);process.exitCode=1;}finally{await browser?.close();await new Promise(r=>server.close(r));report.cleanup=true;await writeFile(dir+'/browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
