import assert from 'node:assert/strict';
import {mkdir,open,readFile,realpath,statfs,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {build,preview} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {createTestWorkspace} from './test-workspace.mjs';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';
import {benchmarkPart,benchmarkBytes} from './playlist-benchmark-audio.mjs';
import {accountId,bots,playlistFixture,uuid} from './playlist-full-download-fixture.mjs';

const evidence=resolve(process.env.PULSO_TEST_EVIDENCE_DIR??'.local/test-evidence/playlist-full-download');
await mkdir(evidence,{recursive:true});
assert.equal(await realpath(evidence),evidence);
process.env.PULSO_TEST_EVIDENCE_DIR=evidence;
const work=await createTestWorkspace('playlist-full-download');
const checkpointKey='pulso:library-download:v1:'+accountId;
const modes=['full','resume','missing','stale-checkpoint','benchmark'];
const selectedMode=process.env.PLAYLIST_FULL_MODE;
const selectedEngine=process.env.PLAYLIST_FULL_ENGINE;
const repeatFrom=Number(process.env.PLAYLIST_FULL_REPEAT_FROM??'1');
const repeats=Number(process.env.PLAYLIST_FULL_REPEATS??'3');
assert.ok(!selectedMode||modes.includes(selectedMode));
assert.ok(!selectedEngine||['chromium','webkit'].includes(selectedEngine));
assert.ok(Number.isSafeInteger(repeatFrom)&&repeatFrom>=1&&Number.isSafeInteger(repeats)&&repeats>=1&&repeatFrom+repeats<=4);

const config={viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:'block'};
const report={cases:[],engines:{},errors:[],config,scope:'Compiled app, native clients/workers/driver/storage/player; synthetic account and Telegram transport. Loopback only.'};
const elapsed=start=>Math.round(performance.now()-start);
const runStart=performance.now();
const playlistName='Luces de noviembre';
const startLabel='Descargar playlist completa';
const resumeLabel='Continuar';
const reviewButtons='[aria-label="Revisión de descarga"], .download-dock__storage, .download-dock__review, [role="dialog"], dialog[open]';

const sdk=()=>({name:'playlist-full-download-sdk',enforce:'pre',resolveId(id){
 if(id==='./temporary-sdk')return resolve('tests/integration/playlist-full-download-sdk.ts');
}});

async function seed(page,origin,preexisting,oldCheckpoint){
 await page.goto(origin+'/testonly-seed');
 await page.evaluate(async ({accountId,bots})=>{
  localStorage.setItem('pulso:setup:v1:'+accountId,'complete');
  const db=await new Promise((ok,fail)=>{
   const request=indexedDB.open('pulso-web-telegram-session-v1',1);
   request.onupgradeneeded=()=>request.result.createObjectStore('authorization');
   request.onsuccess=()=>ok(request.result);request.onerror=()=>fail(request.error);
  });
  try{await new Promise((ok,fail)=>{
   const tx=db.transaction('authorization','readwrite'),store=tx.objectStore('authorization');
   store.put('TESTONLY_STORED_SESSION','session');
   store.put(crypto.randomUUID(),'epoch');
   store.put({version:1,bots},'bot-selection-v1');
   store.put(1,'bot-selection-revision-v1');
   tx.oncomplete=ok;tx.onabort=()=>fail(tx.error);
  });}finally{db.close();}
 },{accountId,bots});
 await page.goto(origin);
 await openPlaylist(page);
 if(!preexisting)return;
 await page.evaluate(async ({trackId,assetId,audio,sha256})=>{
  const db=await new Promise((ok,fail)=>{
   const request=indexedDB.open('pulso-web-local-v1');
   request.onsuccess=()=>ok(request.result);request.onerror=()=>fail(request.error);
  });
  try{await new Promise((ok,fail)=>{
   const tx=db.transaction(['tracks','assets','chunks'],'readwrite');
   const tracks=tx.objectStore('tracks'),request=tracks.get(trackId);
   const bytes=Uint8Array.from(atob(audio),char=>char.charCodeAt(0));
   request.onsuccess=()=>{
    tracks.put({...request.result,assetId,revision:request.result.revision+1,
     audioFingerprint:{algorithm:'sha256',sha256,bytes:bytes.length}},trackId);
    tx.objectStore('chunks').put(bytes,[assetId,0]);
    tx.objectStore('assets').put({id:assetId,namespace:'local',storageKey:assetId,bytes:bytes.length,sha256,
     mime:'audio/wav',chunks:1,state:'complete',revision:1,chunkSize:65536,backend:'idb',retention:'kept'},assetId);
   };
   tx.oncomplete=ok;tx.onabort=()=>fail(tx.error);
  });}finally{db.close();}
 },preexisting);
 if(oldCheckpoint)await page.evaluate(({key,checkpoint})=>{
  localStorage.setItem(key,JSON.stringify({id:crypto.randomUUID(),...checkpoint}));
 },{key:checkpointKey,checkpoint:oldCheckpoint});
 await page.reload();
 await openPlaylist(page);
}

async function openPlaylist(page){
 await page.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).tap();
 await page.locator('.library-grid button').filter({hasText:playlistName}).tap();
 await page.getByRole('heading',{name:playlistName,exact:true}).waitFor();
}

async function inspect(page,ids){
 return page.evaluate(async ids=>{
  const db=await new Promise((ok,fail)=>{
   const request=indexedDB.open('pulso-web-local-v1');
   request.onsuccess=()=>ok(request.result);request.onerror=()=>fail(request.error);
  });
  function read(store,method,...args){
   return new Promise((ok,fail)=>{
    const request=db.transaction(store).objectStore(store)[method](...args);
    request.onsuccess=()=>ok(request.result);request.onerror=()=>fail(request.error);
   });
  }
  try{
   const [assets,libraryTracks,jobs]=await Promise.all(['assets','tracks','jobs'].map(store=>read(store,'getAll')));
   const copies=await Promise.all(ids.map(async id=>{
    const track=libraryTracks.find(track=>track.id===id);
    if(!track)throw Error('Missing library track '+id);
    if(!track.assetId)return null;
    const asset=assets.find(asset=>asset.id===track.assetId);
    if(asset?.state!=='complete')throw Error('Missing complete asset '+id);
    let data;
    if(asset.backend==='opfs'){
     const root=await navigator.storage.getDirectory();
     const directory=await root.getDirectoryHandle('pulso-assets-v1');
     data=await (await (await directory.getFileHandle(asset.storageKey)).getFile()).arrayBuffer();
    }else{
     const chunks=await read('chunks','getAll',IDBKeyRange.bound([asset.storageKey,0],[asset.storageKey,Infinity]));
     data=await new Blob(chunks).arrayBuffer();
    }
    const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),byte=>byte.toString(16).padStart(2,'0')).join('');
    const bytes=data.byteLength;
    if(bytes!==asset.bytes||bytes!==track.audioFingerprint?.bytes||sha256!==asset.sha256||sha256!==track.audioFingerprint?.sha256)
     throw Error('Track fingerprint or asset manifest does not match stored bytes '+id);
    return {id:asset.id,bytes,sha256,mime:asset.mime,backend:asset.backend};
   }));
   return {copies,assetIds:assets.map(asset=>asset.id).sort(),trackCount:libraryTracks.length,
    unfinished:jobs.filter(job=>['writing','ready','committing','cleanup'].includes(job.state)).map(job=>job.state)};
  }finally{db.close();}
 },ids);
}

function verifyCopies({copies,assetIds,trackCount,unfinished},tracks,preexisting,expected){
 assert.equal(trackCount,tracks.length,'No duplicate or missing track records');
 assert.deepEqual(unfinished,[],'No unresolved import jobs after completion');
 const unique=new Set(copies.filter(Boolean).map(copy=>copy.id));
 assert.equal(unique.size,copies.filter(Boolean).length,'Different songs must link distinct assets');
 assert.deepEqual(assetIds,[...unique].sort(),'Every stored asset is linked exactly once');
 for(const [index,{track}] of tracks.entries()){
  const copy=copies[index];
  assert.deepEqual(copy&&{bytes:copy.bytes,sha256:copy.sha256,mime:copy.mime},expected(index),track.title);
  if(track.id===preexisting.trackId)assert.equal(copy.id,preexisting.assetId,'Reused original kept asset');
 }
}

function assertTransport(trace,tracks,served,mode){
 const seenSearches=trace.filter(({kind})=>kind==='search');
 const peerPlan={
  'preexisting':[],'bot-2':[101,102],'bot-3':[101,102,103],
  'corrupt-same-bot':[101,101],'empty-next-bot':[101,102],'truncated-next-bot':[101,102],
  flood:[101,101],network:mode==='resume'?[101,101,101]:[101,101],missing:[101,102,103],
 };
 for(const {track,scenario,expected,goodKey} of tracks){
  assert.deepEqual(seenSearches.filter(event=>event.trackId===track.id).map(event=>event.peer),peerPlan[scenario]??[101],track.title+' search sequence');
  const reads=trace.filter(event=>event.kind==='read'&&event.trackId===track.id);
  const callbacks=trace.filter(event=>event.kind==='callback'&&event.trackId===track.id);
  const failures={
   'corrupt-same-bot':['corrupt'],'empty-next-bot':['empty'],'truncated-next-bot':['truncated'],
   flood:['flood'],network:mode==='resume'?['interrupted','network']:['network'],
  };
  assert.deepEqual(reads.filter(event=>event.fault).map(event=>event.fault),failures[scenario]??[],track.title+' injected events');
  assert.deepEqual(callbacks.map(({key,option})=>[key,option]),scenario==='menu'?[[goodKey,2]]:[],track.title+' menu selection');
  const accepted=reads.filter(event=>event.key===goodKey&&!event.fault);
  if(scenario==='preexisting'||scenario==='missing')assert.equal(reads.length,0,track.title+' unexpected read');
  else{
   assert.deepEqual(served.get(goodKey),expected,track.title+' served bytes');
   assert.ok(accepted.length);
   if(scenario.startsWith('wrong-'))assert.equal(reads.length,accepted.length,'Mismatched version must never be read');
   if(scenario==='write')assert.equal(reads.length,1,'Write retry must reuse the audio already received');
   if(scenario==='truncated-next-bot'||scenario==='network')assert.deepEqual(accepted.slice(-2).map(event=>event.offset),[0,524288]);
   if(scenario==='flood')assert.ok(accepted[0].ms-reads[0].ms>=1950,'Must honor the observed flood wait');
  }
 }
}

async function checkCase(browser,engine,mode,repetition,origin,bundle){
 const context=await browser.newContext(config);
 const started=performance.now(),trace=[],errors=[],external=new Set(),served=new Map();
 const receipt={engine,mode,repetition,status:'FAIL'};
 const {tracks,entries,replies,candidates}=playlistFixture(mode);
 const trackById=new Map(tracks.map(row=>[row.track.id,row]));
 const ready=tracks.find(row=>row.scenario==='preexisting');
 const preexisting={trackId:ready.track.id,assetId:uuid(80),sha256:ready.expected.sha256,
  audio:candidates.get(ready.goodKey).payload.toString('base64')};
 const faulted=new Set(), transfers=new Map();
 const writeTitle=tracks.find(row=>row.scenario==='write')?.track.title;
 let sawWriteFailure=false,unblockRead,notifyBlocked,page;
 const blocked=new Promise(ok=>{notifyBlocked=ok;});
 const readGate=new Promise(ok=>{unblockRead=ok;});
 let cloud={accountId,revision:1,document:{version:1,tracks:tracks.map(row=>row.track),
  playlists:[{id:uuid(99),name:playlistName,entries:entries.map((trackId,i)=>({trackId,id:uuid(100+i)}))}]}};
 try{
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin){external.add(url.origin);return route.abort();}
   if(url.pathname==='/testonly-seed')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>seed</title>'});
   if(url.pathname==='/__setup-event')return route.fulfill({json:{}});
   if(url.pathname!=='/__playlist-full-rpc')return route.fallback();
   const {kind,peer,query,key,offset,limit,option}=route.request().postDataJSON();
   if(kind==='search'){
    const reply=replies.get(query);
    trace.push({kind,peer,trackId:reply?.trackId,ms:elapsed(started)});
    if(!reply?.plan[peer-101])return route.fulfill({status:400});
    return route.fulfill({json:reply.plan[peer-101]});
   }
   if(kind==='write-admit'){
    if(sawWriteFailure)return route.fulfill({json:{inject:false}});
    sawWriteFailure=true;
    return route.fulfill({json:{inject:true}});
   }
   const candidate=candidates.get(key);
   if(!candidate)return route.fulfill({status:400});
   const trackId=candidate.trackId;
   const event={kind,peer,trackId,key,offset,option,ms:elapsed(started)};
   trace.push(event);
   if(kind==='callback')return route.fulfill({json:{}});
   if(kind!=='read'||!Number.isSafeInteger(offset)||limit!==524288)return route.fulfill({status:400});
   const {payload,fault}=candidate;
   if(mode==='resume'&&fault==='network'&&!faulted.has('interrupted')){
    faulted.add('interrupted');event.fault='interrupted';notifyBlocked();
    await readGate;
    return route.abort().catch(()=>{});
   }
   if((fault==='flood'||fault==='network'&&offset>0)&&!faulted.has(fault)){
    faulted.add(fault);event.fault=fault;
    return route.fulfill({status:fault==='flood'?429:503});
   }
   if(fault==='corrupt'||fault==='empty'||fault==='truncated'&&offset>0)event.fault=fault;
   const body=event.fault==='empty'?Buffer.alloc(0):event.fault==='truncated'?payload.subarray(offset,offset+100):payload.subarray(offset,offset+limit);
   event.bytes=body.length;
   if(offset===0)transfers.set(key,{hash:createHash('sha256'),bytes:0});
   const transfer=transfers.get(key);
   if(!event.fault&&transfer&&transfer.bytes===offset){
    transfer.hash.update(body);
    transfer.bytes+=body.length;
    if(transfer.bytes===payload.length){
     served.set(key,{bytes:transfer.bytes,sha256:transfer.hash.digest('hex'),mime:trackById.get(trackId).expected.mime});
     transfers.delete(key);
    }
   }
   return route.fulfill({body,contentType:'application/octet-stream'});
  });
  await context.routeWebSocket('**/*', socket=>{external.add(new URL(socket.url()).origin);void socket.close();});
  await installRequiredAccountFixture(context,origin);
  await context.route(origin+'/api/account-library',async route=>{
   if(route.request().method()==='PUT'){
    const req=route.request().postDataJSON();
    if(req.revision!==cloud.revision)return route.fulfill({status:409,json:{code:'LIBRARY_CHANGED'}});
    cloud={...cloud,revision:cloud.revision+1,document:req.document};
   }
   return route.fulfill({json:cloud});
  });
  if(writeTitle){
   // Inject once inside the native import worker, at the same byte-write boundary
   // used by the backend. A durable quota exhaustion would intentionally stop the batch.
   await context.route(/\/assets\/import\.worker-[^/]+\.js$/,async route=>{
    const prefix = `
     let failNextWrite=false;
     const failWrite=()=>{
      if(!failNextWrite)return;
      failNextWrite=false;
      throw new DOMException('Synthetic transient write invalidation','InvalidStateError');
     };
     if(globalThis.FileSystemWritableFileStream?.prototype?.write){
      const originalWrite=FileSystemWritableFileStream.prototype.write;
      FileSystemWritableFileStream.prototype.write=function(...args){
       failWrite();
       return originalWrite.apply(this,args);
      };
     }
     const originalPut=IDBObjectStore.prototype.put;
     IDBObjectStore.prototype.put=function(...args){
      if(this.name==='chunks')failWrite();
      return originalPut.apply(this,args);
     };
     const intercepted=new WeakSet();
     addEventListener('message',async event=>{
      if(event.data?.type!=='import'||event.data.file?.name!==${JSON.stringify(writeTitle+'.wav')}||intercepted.has(event))return;
      event.stopImmediatePropagation();
      const response=await fetch('/__playlist-full-rpc',{method:'POST',body:JSON.stringify({kind:'write-admit'})});
      ({inject:failNextWrite}=await response.json());
      const replay=new MessageEvent('message',{data:event.data});
      intercepted.add(replay);
      dispatchEvent(replay);
     });
    `;
    const worker=await readFile(bundle+new URL(route.request().url()).pathname,'utf8');
    return route.fulfill({contentType:'text/javascript',body:prefix+worker});
   });
  }
  await context.addInitScript(({startLabel,resumeLabel,reviewButtons})=>{
   const data=window.__playlistFull={activations:[],review:[],dialogs:[],imports:[],finishedAt:null,closedAt:null,audio:null};
   addEventListener('click',event=>{
    const button=event.target.closest?.('button'),label=button?.getAttribute('aria-label')??button?.textContent;
    if(event.isTrusted&&[startLabel,resumeLabel].includes(label))data.activations.push(label);
   },true);
   for(const method of ['alert','confirm','prompt']){
    window[method]=()=>{data.dialogs.push(method);return false;};
   }
   const Audio=window.Audio;
   window.Audio=function(...args){data.audio=new Audio(...args);return data.audio;};
   window.Audio.prototype=Audio.prototype;
   const Worker=window.Worker;
   window.Worker=class extends Worker{
    constructor(url,...args){
     super(url,...args);
     this.addEventListener('message',({data:message})=>{
      if(message?.outcome)data.imports.push({code:message.outcome.primary?.code,phase:message.outcome.primary?.phase,writeState:message.outcome.writeState});
     });
    }
   };
   new MutationObserver(()=>{
    const dock=document.querySelector('[role="region"][aria-label="Descargas"], section[aria-label="Descargas"]');
    data.started||=!!dock?.querySelector('progress');
    if(!data.activations.length&&!data.started||data.closedAt!==null)return;
    for(const element of document.querySelectorAll(reviewButtons)){
     if(!element.getClientRects().length||getComputedStyle(element).visibility!=='visible')continue;
     const label=element.getAttribute('aria-label')??element.className;
     if(!data.review.includes(label))data.review.push(label);
    }
    if(dock&&Array.from(document.querySelectorAll('[role="status"]')).some(status=>status.textContent.startsWith('Descarga finalizada ·')))data.finishedAt??=performance.now();
    if(data.finishedAt!==null&&!dock)data.closedAt??=performance.now();
   }).observe(document,{childList:true,subtree:true,characterData:true,attributes:true});
  },{startLabel,resumeLabel,reviewButtons});
  page=await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('dialog',dialog=>{errors.push('Browser dialog: '+dialog.type());void dialog.dismiss();});
  const oldCheckpoint=mode==='stale-checkpoint'?{trackIds:entries,cursor:6,pending:null}:null;
  await seed(page,origin,preexisting,oldCheckpoint);
  if(oldCheckpoint){
   const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),checkpointKey);
   assert.deepEqual({trackIds:stored.trackIds,cursor:stored.cursor,pending:stored.pending},oldCheckpoint);
   const before=await inspect(page,entries);
   verifyCopies(before,tracks,preexisting,index=>tracks[index]===ready?ready.expected:null);
   receipt.legacyCheckpoint={cursor:stored.cursor,verifiedCopies:1};
  }
  await page.locator('.bot-providers-list li').nth(2).waitFor({state:'attached'});
  const checkNoReview=async()=>assert.deepEqual(await page.evaluate(()=>({
   review:window.__playlistFull.review,dialogs:window.__playlistFull.dialogs,
  })),{review:[],dialogs:[]});
  const collection=page.locator('.collection-header');
  const dock=page.getByRole('region',{name:'Descargas',exact:true});
  const handle=dock.locator('.download-dock__handle');
  // Inspect the final rows after completion with an untrusted DOM click.
  const openDetails=()=>handle.evaluate(button=>{if(button.getAttribute('aria-expanded')==='false')button.click();});
  const downloadStart=performance.now();
  const initialLabel=oldCheckpoint?resumeLabel:startLabel;
  await (oldCheckpoint?dock:collection).getByRole('button',{name:initialLabel,exact:true}).tap();
  const activationLog=[initialLabel];
  if(mode==='resume'){
   let waitTimer;
   try{await Promise.race([blocked,new Promise((_,fail)=>{waitTimer=setTimeout(()=>fail(Error('Mid-batch read was never reached')),100000);})]);}
   finally{clearTimeout(waitTimer);}
   const checkpoint=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),checkpointKey);
   assert.equal(checkpoint.cursor,15);
   assert.deepEqual(checkpoint.pending,{kind:'network',index:15});
   const prefix=await inspect(page,tracks.map(row=>row.track.id));
   assert.equal(prefix.copies.filter(Boolean).length,15);
   receipt.interruptedAtMs=elapsed(downloadStart);
   await checkNoReview();
   assert.deepEqual(await page.evaluate(()=>window.__playlistFull.activations),[startLabel]);
   await page.reload();
   unblockRead();
   await page.locator('.shell-nav').waitFor();
  }
  const hasMissing=mode==='missing'||mode==='stale-checkpoint';
  const expectedSummary=hasMissing?'9 de 10 guardadas · 1 no existe':'30 de 30 guardadas';
  await page.getByRole('status').filter({hasText:/^Descarga (finalizada|detenida) ·/}).waitFor({state:'attached',timeout:135000});
  assert.equal(await handle.getByText(expectedSummary,{exact:true}).count(),1,await handle.innerText());
  receipt.completedMs=elapsed(downloadStart);
  await openDetails();
  const rows=dock.locator('.download-dock__panel li');
  await rows.first().waitFor({state:'attached'});
  assert.doesNotMatch(await dock.innerText(),/Procesada anteriormente/);
  const actual=await rows.evaluateAll(rows=>rows.map(row=>({
   title:row.querySelector('strong').textContent,icon:row.querySelector('.download-dock__row-icon').textContent,
   reason:row.dataset.failed==='true'?row.querySelector('div>span')?.textContent:null,
  })));
  assert.deepEqual(actual,entries.map(id=>{
   const {track,expected}=trackById.get(id);
   return {title:track.title,icon:expected?'✓':'⚠',reason:expected?null:'No existe en tus bots'};
  }));
  await checkNoReview();
  assert.deepEqual(await page.evaluate(()=>window.__playlistFull.activations),mode==='resume'?[]:activationLog);
  assert.equal(await page.evaluate(()=>window.__playlistFull.audio.currentTime),0,'Download must not start playback');
  if(repetition===1&&(mode==='full'||mode==='missing'&&engine==='chromium'||mode==='stale-checkpoint')){
   await dock.screenshot({path:resolve(work.evidence,`${engine}-${mode}.png`)});
  }
  await dock.waitFor({state:'detached',timeout:6500});
  receipt.dismissedMs=await page.evaluate(()=>{
   const {finishedAt,closedAt}=window.__playlistFull;
   return finishedAt===null||closedAt===null?null:Math.round(closedAt-finishedAt);
  });
  assert.ok(receipt.dismissedMs>0&&receipt.dismissedMs<=6500,'Dock must dismiss on its own');
  await checkNoReview();
  assertTransport(trace,tracks,served,mode);
  const outcomes=await page.evaluate(()=>window.__playlistFull.imports);
  if(writeTitle){
   assert.equal(sawWriteFailure,true);
   assert.equal(outcomes.filter(outcome=>outcome.code==='storage-unavailable'&&outcome.phase==='write'&&outcome.writeState==='not-published').length,1,JSON.stringify(outcomes));
  }
  const expected=index=>{
   const {scenario,expected,goodKey}=tracks[index];
   return scenario==='preexisting'||!expected?expected:served.get(goodKey);
  };
  const ids=tracks.map(row=>row.track.id),before=await inspect(page,ids);
  verifyCopies(before,tracks,preexisting,expected);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),checkpointKey),null);
  receipt.preReloadStorageVerified=true;
  await page.reload();
  await openPlaylist(page);
  const after=await inspect(page,ids);
  assert.deepEqual(after,before,'Bytes and asset links survive reload');
  receipt.reloadStorageVerified=true;
  const traceCount=trace.length;
  const playable=[tracks[0],tracks.find(row=>row.scenario===(hasMissing?'empty-next-bot':'truncated-next-bot')),tracks.at(-1)];
  receipt.playback=[];
  for(const {track} of playable){
   const button=page.getByRole('button',{name:'Escuchar '+track.title,exact:true}).first();
   await button.tap();
   const advancing=await page.waitForFunction(title=>{
    const audio=window.__playlistFull.audio;
    const active=Array.from(document.querySelectorAll('button[aria-current="true"]')).some(el=>el.getAttribute('aria-label')==='Escuchar '+title);
    return active&&audio?.currentSrc.startsWith('blob:')&&!audio.paused&&audio.currentTime>0.2?audio.currentTime:false;
   },track.title,{timeout:12000});
   receipt.playback.push({trackId:track.id,seconds:await advancing.jsonValue()});
   await page.evaluate(()=>window.__playlistFull.audio.pause());
  }
  assert.equal(trace.length,traceCount,'Playback of stored copies must not contact Telegram');
  assert.deepEqual(errors,[]);
  receipt.status='PASS';
  receipt.activations=activationLog;
  receipt.summary=expectedSummary;
  receipt.assets=after.assetIds.length;
  receipt.writeFailureObserved=sawWriteFailure;
  receipt.backends=[...new Set(after.copies.filter(Boolean).map(copy=>copy.backend))];
  receipt.tracks=tracks.map(({track,scenario,expected})=>({title:track.title,scenario,status:'PASS',expected}));
 }catch(error){
  receipt.error=String(error.stack??error);
  receipt.pageErrors=errors;
  receipt.dock=await page?.getByRole('region',{name:'Descargas',exact:true}).allTextContents().catch(()=>[]);
  receipt.imports=await page?.evaluate(()=>window.__playlistFull.imports).catch(()=>[]);
 }finally{
  unblockRead();
  await context.close();
 }
 receipt.transport=trace;
 receipt.blockedExternalOrigins=[...external];
 receipt.totalMs=elapsed(started);
 return receipt;
}

async function checkBenchmark(browser,engine,origin,bundle,delayMs,backend){
 const ctx=await browser.newContext(config);
 const trace=[];
 const tracks=[1,2].map(n=>({id:uuid(n),title:`Silencio ${n}`,artist:'Prueba',album:null,duration:525,favorite:false,inLibrary:true,
  createdAt:'2026-11-21T00:00:00Z',localAlbum:null,catalog:null}));
 const audio=tracks.map((track,i)=>({key:i+1,title:track.title,artist:track.artist,duration:track.duration,mime:'audio/mpeg',bytes:benchmarkBytes}));
 const cloud={accountId,revision:1,document:{version:1,tracks,
  playlists:[{id:uuid(99),name:playlistName,entries:tracks.map((track,i)=>({trackId:track.id,id:uuid(100+i)}))}]}};
 try{
  await ctx.routeWebSocket('**/*',socket=>void socket.close());
  await ctx.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.abort();
   if(url.pathname==='/testonly-seed')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>seed</title>'});
   if(url.pathname==='/__setup-event')return route.fulfill({json:{}});
   if(url.pathname==='/__playlist-full-rpc'){
    const {kind,query,key,offset,limit}=route.request().postDataJSON();
    trace.push({kind,key,offset});
    if(kind==='search'){
     const descriptor=audio.find(item=>query===item.title+' '+item.artist);
     return route.fulfill({json:{delayMs,audio:[],menu:[{label:`1. ${descriptor.artist} - ${descriptor.title}`,
      audio:descriptor}]}});
    }
    if(kind==='callback')return route.fulfill({json:{}});
    return route.abort();
   }
   if(backend==='idb'&&/\/assets\/import\.worker-[^/]+\.js$/.test(url.pathname)){
    const worker=await readFile(bundle+url.pathname,'utf8');
    return route.fulfill({contentType:'text/javascript',body:`Object.defineProperty(navigator.storage,'getDirectory',{value:undefined});
`+worker});
   }
   return route.fallback();
  });
  await installRequiredAccountFixture(ctx,origin);
  await ctx.route(origin+'/api/account-library',route=>route.fulfill({json:cloud}));
  await ctx.addInitScript(()=>{
   window.benchmark={start:null,marks:[],failed:false};
   const scan=()=>{
    const dock=document.querySelector('.download-dock');
    const progress=dock?.querySelector('progress');
    if(progress?.value===1&&window.benchmark.marks.length===0)window.benchmark.marks.push(performance.now());
    const terminal=[...document.querySelectorAll('[role="status"]')].find(node=>node.textContent==='Descarga finalizada · 2 de 2 guardadas');
    if(terminal&&window.benchmark.marks.length===1)window.benchmark.marks.push(performance.now());
    if([...document.querySelectorAll('[role="status"]')].some(node=>/^Descarga (finalizada|detenida) ·/.test(node.textContent)&&node!==terminal))window.benchmark.failed=true;
   };
   new MutationObserver(scan).observe(document,{subtree:true,childList:true,characterData:true,attributes:true});
   document.addEventListener('click',event=>{
    if(event.target.closest('button')?.getAttribute('aria-label')==='Descargar playlist completa')window.benchmark.start??=performance.now();
   },true);
  });
  const page=await ctx.newPage();
  page.setDefaultTimeout(90000);
  await seed(page,origin,null,null);
  await page.locator('.bot-providers-list li').nth(2).waitFor({state:'attached'});
  await page.getByRole('button',{name:startLabel,exact:true}).evaluate(button=>button.click());
  await page.waitForFunction(()=>window.benchmark.marks.length===2||window.benchmark.failed,null,{timeout:180000}).then(async()=>{assert.equal(await page.evaluate(()=>window.benchmark.failed),false);}).catch(async error=>{
   const handle=page.locator('.download-dock__handle');
   await handle.evaluate(button=>{if(button.getAttribute('aria-expanded')==='false')button.click();}).catch(()=>{});
   const dock=await page.getByRole('region',{name:'Descargas',exact:true}).allTextContents();
   throw Error(JSON.stringify({dock,trace}),{cause:error});
  });
  const {copies}=await inspect(page,tracks.map(track=>track.id));
  const actualBackend=copies[0]?.backend;
  for(const [i,copy] of copies.entries()){
   assert.equal(copy?.sha256,createHash('sha256').update(benchmarkPart(i+1)).digest('hex'));
   assert.equal(copy?.bytes,benchmarkBytes);
   assert.equal(copy?.backend,actualBackend);
   if(backend==='idb')assert.equal(copy?.backend,'idb');
  }
  const {start,marks}=await page.evaluate(()=>window.benchmark);
  assert.notEqual(start,null);
  const samplesMs=[Math.round(marks[0]-start),Math.round(marks[1]-marks[0])];
  return {status:'PASS',engine,delayMs,rpcMs:200,requestedBackend:backend,backend:actualBackend,bytes:benchmarkBytes,
   samplesMs,meanMs:Math.round((marks[1]-start)/2)};
 }finally{await ctx.close();}
}

let server,browser,tempDirectory;
const oldTemp=process.env.TMPDIR;
const stop=()=>{report.errors.push('Interrupted');void browser?.close();};
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
try{
 tempDirectory=await open(work.dir,'r');
 process.env.TMPDIR=`/proc/${process.pid}/fd/${tempDirectory.fd}`;
 const bundle=resolve(work.dir,'bundle');
 await build({configFile:false,define:{__PLAYLIST_RPC_MS__:selectedMode==='benchmark'?'200':'0'},plugins:[tailwindcss(),sdk()],worker:{plugins:()=>[sdk()]},logLevel:'error',build:{outDir:bundle}});
 await writeFile(bundle+'/telegram-config.json',JSON.stringify({api_id:12345,api_hash:'0'.repeat(32)}));
 server=await preview({configFile:false,build:{outDir:bundle},preview:{host:'127.0.0.1',port:0}});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
  if(selectedEngine&&selectedEngine!==engine)continue;
  browser=await launcher.launch({headless:true,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false,...(engine==='chromium'?{executablePath:'/usr/bin/chromium'}:{})});
  report.engines[engine]=browser.version();
  try{
   for(const mode of modes){
    if(selectedMode&&selectedMode!==mode||!selectedMode&&mode==='benchmark')continue;
    if(mode==='benchmark'){
     for(const backend of ['opfs','idb'])for(const delayMs of [400,1200]){
      const result=await checkBenchmark(browser,engine,origin,bundle,delayMs,backend);
      report.cases.push(result);console.log(JSON.stringify(result));
     }
     continue;
    }
    const repetitions=mode==='full'?Array.from({length:repeats},(_,i)=>repeatFrom+i):[1];
    for(const repetition of repetitions){
     if(report.errors.length)break;
     console.log(`${engine} ${mode} #${repetition} running`);
     const result=await checkCase(browser,engine,mode,repetition,origin,bundle);
     report.cases.push(result);
     console.log(`${engine} ${mode} #${repetition}: ${result.status} (${result.totalMs} ms)`);
     if(result.error)console.error(result.error);
     if(process.env.PLAYLIST_FULL_FAIL_FAST==='1'&&result.status!=='PASS')throw Error('Stopped after failed case');
    }
   }
  }finally{await browser.close();browser=null;}
  if(report.errors.length)break;
 }
}catch(error){report.errors.push(String(error.stack??error));}
finally{
 if(server)await new Promise(ok=>server.httpServer.close(ok));
 if(oldTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTemp;
 await tempDirectory?.close();
 const beforeCleanup=await statfs('/data');
 report.cleanup={...await work.cleanup(),freeBeforeCleanup:beforeCleanup.bavail*beforeCleanup.bsize};
 report.totalMs=elapsed(runStart);
 report.status=report.cases.length&&report.cases.every(result=>result.status==='PASS')&&!report.errors.length?'PASS':'FAIL';
 await writeFile(resolve(work.evidence,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(`${report.status} ${work.evidence}/report.json`);
 if(report.status!=='PASS')process.exitCode=1;
 process.off('SIGTERM',stop);
 process.off('SIGINT',stop);
}
