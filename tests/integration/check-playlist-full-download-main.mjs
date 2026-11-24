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
import {taggedM4a} from './tagged-audio-fixture.mjs';
import {accountId,bots,playlistFixture,uuid} from './playlist-full-download-fixture.mjs';

const evidence=resolve(process.env.PULSO_TEST_EVIDENCE_DIR??'.local/test-evidence/playlist-full-download');
await mkdir(evidence,{recursive:true});
assert.equal(await realpath(evidence),evidence);
process.env.PULSO_TEST_EVIDENCE_DIR=evidence;
const work=await createTestWorkspace('playlist-full-download');
const checkpointKey='pulso:library-download:v1:'+accountId;
const modes=['full','resume','missing','stale-checkpoint','benchmark','turnaround','queue','queue-cancel','queue-reload','queue-admission','queue-song-save','queue-song-order','queue-cancel-empty','tap-baseline','tap-active'];
const selectedMode=process.env.PLAYLIST_FULL_MODE;
const selectedModes=selectedMode?.split(',');
const selectedEngine=process.env.PLAYLIST_FULL_ENGINE;
const baseline=process.env.PLAYLIST_TURNAROUND_BASE==='1';
const cancelMode=mode=>mode==='queue-cancel'||mode==='queue-cancel-empty';
const isQueueMode=mode=>mode.startsWith('queue')||mode.startsWith('tap-');
const turnaroundScenarios=['mismatch','muted','reuse','tags-compound','tags-unrelated'];
const selectedScenarios=process.env.PLAYLIST_TURNAROUND_SCENARIOS?.split(',')??turnaroundScenarios;
const callbackTimeout=selectedScenarios.length===1&&selectedScenarios[0]==='callback-timeout';
assert.ok(callbackTimeout||selectedScenarios.every(scenario=>turnaroundScenarios.includes(scenario)));
const repeatFrom=Number(process.env.PLAYLIST_FULL_REPEAT_FROM??'1');
const repeats=Number(process.env.PLAYLIST_FULL_REPEATS??'3');
assert.ok(!selectedModes||selectedModes.every(mode=>modes.includes(mode)));
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
},transform(code,id){
 // Shorten the real callback timer only for the separate recovery regression run.
 if(callbackTimeout&&id.endsWith('/src/telegram/bot-search-protocol.ts')){
  assert.ok(code.includes('callbackBudgetMs:65000'));
  return code.replace('callbackBudgetMs:65000','callbackBudgetMs:1500');
 }
 if(selectedModes?.includes('queue-admission')&&id.endsWith('/src/main.tsx'))return code+
  "\nwindow.testMetadataAdmission=blocked=>setMetadataRescanBlocking(blocked,()=>true);";
 if(selectedModes?.includes('queue-song-save')&&id.endsWith('/src/ui/MusicSearchController.tsx')){
  const saveAudio='const saved=await f.attempt.save';
  assert.ok(code.includes(saveAudio));
  return code.replace(saveAudio,'window.testSongSaving=true; '+saveAudio);
 }
 if(selectedModes?.includes('queue-song-order')&&id.endsWith('/src/library/ordered-bot-acquisition.ts')){
  const beforeDownload='const prior=client.searchSnapshot(),allowed=client.captureSearchActionCurrent();';
  assert.ok(code.includes(beforeDownload));
  return code.replace(beforeDownload,'if(!p.accept)await window.testSongGap?.(); '+beforeDownload);
 }
 if(selectedMode==='turnaround'&&id.endsWith('/src/main.tsx'))return code+
  '\nwindow.testTurnaroundDiagnostics=()=>{diagnostics.setEnabled(true);return diagnostics.getSnapshot().songs;};';
}});

async function seed(page,origin,preexisting,oldCheckpoint,botPool=bots){
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
 },{accountId,bots:botPool});
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
  assert.deepEqual(reads.filter(event=>event.fault&&event.fault!=='interrupted-parallel').map(event=>event.fault),failures[scenario]??[],track.title+' injected events');
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
 const queued=isQueueMode(mode);
 const albumTitle='Pulso Luz B',artistName='Pulso Luz Artista',playlistC='Pulso Luz C';
 const album={wrapperType:'collection',collectionType:'Album',collectionId:421,collectionName:albumTitle,artistId:424,artistName,trackCount:2};
 const artist={wrapperType:'artist',artistId:424,artistName};
 const albumSongs=['Pulso Luz Uno','Pulso Luz Dos'].map((title,i)=>{
  const source=candidates.get([82,92][i]),key=701+i;
  candidates.set(key,{trackId:'album-'+i,payload:source.payload});
  replies.set(title+' '+artistName,{trackId:'album-'+i,plan:[{audio:[{key,title,artist:artistName,duration:2,mime:'audio/wav',bytes:source.payload.length}]}]});
  return {wrapperType:'track',kind:'song',collectionId:album.collectionId,trackId:800+i,discNumber:1,discCount:1,trackNumber:i+1,trackCount:2,
   trackName:title,collectionName:albumTitle,artistName,trackTimeMillis:2000};
 });
 const cTrack={...tracks[0].track,id:uuid(950),title:'Pulso Luz Tres'};
 const cAudio=candidates.get(92).payload;
 candidates.set(703,{trackId:cTrack.id,payload:cAudio});
 replies.set(cTrack.title+' '+cTrack.artist,{trackId:cTrack.id,plan:[{audio:[{key:703,title:cTrack.title,artist:cTrack.artist,duration:2,mime:'audio/wav',bytes:cAudio.length}]}]});
 let gateOn=false,resumeCommitted=false;
 let sawWriteFailure=false,unblockRead,notifyBlocked,page;
 const blocked=new Promise(ok=>{notifyBlocked=ok;});
 const readGate=new Promise(ok=>{unblockRead=ok;});
 let cloud={accountId,revision:1,document:{version:1,tracks:tracks.map(row=>row.track),
  playlists:[{id:uuid(99),name:playlistName,entries:entries.map((trackId,i)=>({trackId,id:uuid(100+i)}))},
   ...(queued?[{id:uuid(951),name:playlistC,entries:[{trackId:cTrack.id,id:uuid(952)}]}]:[])]}};
 if(queued)cloud.document.tracks.push(cTrack);
 try{
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(queued&&url.hostname.endsWith('lrclib.net'))return route.fulfill({headers:{'access-control-allow-origin':origin},json:[]});
   if(url.origin!==origin){external.add(url.origin);return route.abort();}
   if(url.pathname==='/testonly-seed')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>seed</title>'});
   if(queued&&url.pathname==='/catalog-config.json')return route.fulfill({json:{version:1,itunes:true,artwork:false}});
   if(queued&&url.pathname.startsWith('/catalog/itunes/')){
    const entity=url.searchParams.get('entity'),lookup=url.pathname.endsWith('/lookup');
    const results=entity==='musicArtist'?[artist]:entity==='album'?(lookup?[artist,album]:[album]):lookup?[album,...albumSongs]:albumSongs;
    return route.fulfill({json:{resultCount:results.length,results}});
   }
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
   if(queued&&gateOn&&trackId===tracks[cancelMode(mode)?2:0].track.id){
    notifyBlocked();await readGate;
    return route.fulfill({body:payload.subarray(offset,offset+limit),contentType:'application/octet-stream'}).catch(()=>{});
   }
   if(mode==='resume'&&fault==='network'&&!resumeCommitted){
    // Telegram may request both chunks concurrently. Keep the whole old
    // transfer interrupted so only a resumed transfer consumes the 503.
    if(!faulted.has('interrupted')){
     faulted.add('interrupted');event.fault='interrupted';notifyBlocked();
    }else event.fault='interrupted-parallel';
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
     served.set(key,{bytes:transfer.bytes,sha256:transfer.hash.digest('hex'),mime:trackById.get(trackId)?.expected.mime??'audio/wav'});
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
  if(writeTitle&&!queued){
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
  if(queued){
   const input=page.locator('.music-search input[type=search]');
   const search=async(query)=>{
    await page.locator('.shell-nav').getByRole('button',{name:'Buscar',exact:true}).tap();
    await input.fill(query);
   };
   const searchAlbum=page.locator('[data-catalog-kind=album]').filter({hasText:albumTitle});
   const searchArtist=page.locator('[data-catalog-kind=artist]').filter({hasText:artistName});
   const searchSong=page.locator('[data-catalog-kind=track]').filter({hasText:cTrack.title});
   const byHeading=name=>page.getByRole('heading',{name,exact:true});
   const tapAt=async(locator,x,y)=>{
    await locator.evaluate(button=>button.scrollIntoView({block:'center'}));
    const hit=await locator.evaluate((button,[x,y])=>{
     const box=button.getBoundingClientRect(),left=box.x+box.width*x,top=box.y+box.height*y;
     const target=document.elementFromPoint(left,top);
     return {x:left,y:top,hit:button.contains(target),target:target?.className,disabled:button.disabled};
    },[x,y]);
    assert.equal(hit.hit,true,JSON.stringify(hit));
    await page.touchscreen.tap(hit.x,hit.y);
    return hit;
   };
   const albumHeading=()=>byHeading(albumTitle).waitFor({timeout:4000});
   const artistHeading=()=>byHeading(artistName).waitFor({timeout:4000});
   const back=async name=>page.getByRole('button',{name,exact:true}).tap();
   const sweep=async(locator,onTap,afterTap)=> {
    for(const x of [.12,.5,.88])for(const y of [.14,.5,.86]){
     if(await input.isVisible())await input.evaluate(element=>element.focus({preventScroll:true}));
     await tapAt(locator,x,y);await onTap();await afterTap?.();
    }
   };
   const discography=async()=>{
    await searchArtist.tap();await artistHeading();
    await sweep(page.locator('.artist-album-grid button').filter({hasText:albumTitle}),albumHeading,()=>back('Volver al artista'));
   };
   const queueKey='pulso:collection-download-queue:v1:'+accountId;
   const queuedTitles=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]').map(job=>job.title),queueKey);
   const openNextPlaylist=async()=>{
    await page.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).tap();
    await page.getByRole('button',{name:'Playlists',exact:true}).tap();
    await page.locator('.library-grid button').filter({hasText:playlistC}).tap();
    await byHeading(playlistC).waitFor();
   };
   const enqueueNext=async()=>{
    await openNextPlaylist();
    await collection.getByRole('button',{name:startLabel,exact:true}).tap();
   };
   const verifyNext=async()=>{
    await page.waitForFunction(({queueKey,checkpointKey})=>!localStorage.getItem(queueKey)&&!localStorage.getItem(checkpointKey),{queueKey,checkpointKey});
    const {copies}=await inspect(page,[cTrack.id]);
    assert.equal(copies[0]?.sha256,createHash('sha256').update(cAudio).digest('hex'));
   };
   if(mode==='queue-admission'){
    await openNextPlaylist();
    await page.evaluate(()=>window.testMetadataAdmission(true));
    await collection.getByRole('button',{name:startLabel,exact:true}).tap();
    await page.getByRole('button',{name:'Gestionar descarga en cola de '+playlistC}).waitFor();
    // Give the normal dispatcher time to run its update and admission checks.
    await page.waitForTimeout(700);
    assert.deepEqual(await queuedTitles(),[playlistC]);
    assert.equal(trace.length,0);
    await page.evaluate(()=>window.testMetadataAdmission(false));
    await verifyNext();
   }
   if(mode==='queue-cancel-empty'){
    gateOn=true;await collection.getByRole('button',{name:startLabel,exact:true}).tap();await blocked;
    await collection.getByRole('button',{name:'Gestionar descarga de '+playlistName}).tap();
    await page.getByRole('button',{name:'Cancelar descarga',exact:true}).tap();
    gateOn=false;unblockRead();
    await page.waitForFunction(key=>!localStorage.getItem(key),checkpointKey,{timeout:4500});
    assert.equal(await page.getByRole('button',{name:resumeLabel,exact:true}).count(),0);
    const {copies}=await inspect(page,[tracks[0].track.id]);
    assert.equal(copies[0]?.sha256,tracks[0].expected.sha256);
    await enqueueNext();
    await verifyNext();
   }
   if(mode==='queue-song-save'||mode==='queue-song-order'){
    await search('Luz');
    await searchAlbum.waitFor();await searchArtist.waitFor();
    const song=page.locator('[data-catalog-kind=track]').filter({hasText:tracks[0].track.title});
    const saveAlbum=()=>page.getByRole('button',{name:'Guardar álbum',exact:true}).tap();
    if(mode==='queue-song-save'){
     // Pause a transaction after the owner's activity token is taken, without
     // holding the actual writer lock or blocking the Telegram worker.
     await page.evaluate(()=>{
      const original=navigator.locks.request.bind(navigator.locks);
      navigator.locks.request=async(name,...args)=>{
       if(name==='pulso-web:local:asset-writer'&&window.testHoldWriter){
        window.testHoldWriter=false;
        await new Promise(resolve=>{window.testReleaseWriter=resolve;});
       }
       return original(name,...args);
      };
     });
     gateOn=true;await song.tap();await blocked;
     await searchAlbum.tap();await albumHeading();
     await page.evaluate(()=>{window.testHoldWriter=true;});
     await saveAlbum();
     await page.waitForFunction(()=>!!window.testReleaseWriter);
     gateOn=false;unblockRead();
     await back('Volver a búsqueda');
     await page.waitForFunction(()=>window.testSongSaving===true);
     await page.evaluate(()=>window.testReleaseWriter());
     await page.getByText(/Reproduciendo la canción desde la copia|Canción disponible/).first().waitFor();
    }else{
     await page.evaluate(()=>{
      window.testSongGap=()=>new Promise(resolve=>{window.testReleaseSong=resolve;});
     });
     await song.tap();await page.waitForFunction(()=>!!window.testReleaseSong);
     await searchAlbum.tap();await albumHeading();
     await saveAlbum();await page.locator('.album-saved').waitFor();
     const otherSong=page.getByRole('button',{name:/Pulso Luz Uno/});
     const otherSongEnabled=await otherSong.isEnabled();
     await page.getByRole('button',{name:'Añadir álbum',exact:true}).tap();
     await back('Volver a búsqueda');await searchArtist.tap();await artistHeading();
     await page.getByRole('button',{name:'Guardar artista',exact:true}).tap();
     await page.getByRole('button',{name:'Quitar de mis artistas',exact:true}).waitFor();
     await enqueueNext();
     const during=trace.filter(event=>event.kind==='search').map(event=>event.trackId);
     assert.deepEqual(during,[tracks[0].track.id]);
     assert.deepEqual(await queuedTitles(),[albumTitle,playlistC]);
     assert.equal(otherSongEnabled,false);
     await page.evaluate(()=>{delete window.testSongGap;window.testReleaseSong();});
     await verifyNext();
     assert.deepEqual(trace.filter(event=>event.kind==='search').map(event=>event.trackId),
      [tracks[0].track.id,'album-0','album-1',cTrack.id]);
    }
    const {copies}=await inspect(page,[tracks[0].track.id]);
    assert.equal(copies[0]?.sha256,tracks[0].expected.sha256);
   }
   if(['queue-admission','queue-song-save','queue-song-order','queue-cancel-empty'].includes(mode)){
    assert.deepEqual(errors,[]);
    receipt.status='PASS';receipt.totalMs=elapsed(started);return receipt;
   }
   if(mode==='tap-baseline'||mode==='tap-active'){
    await search('Pulso Luz');await searchAlbum.waitFor();
    if(mode==='tap-active'){
     await sweep(searchAlbum,albumHeading,()=>back('Volver a búsqueda'));
     await sweep(searchArtist,artistHeading,()=>back('Volver a búsqueda'));
     await discography();await back('Volver a búsqueda');
     const title=ready.track.title;
     await search(title);
     const cached=page.locator('[data-catalog-kind=track]').filter({hasText:title});
     await sweep(cached,()=>cached.and(page.locator('[aria-pressed=true]')).waitFor());
     await page.getByText(/Reproduciendo la canción desde la copia|Esta canción ya se está reproduciendo|Canción disponible/).first().waitFor({state:'attached'});
    }else{
     await tapAt(searchAlbum,.12,.5);await albumHeading();await back('Volver a búsqueda');
    }
    await search('Luz');await searchAlbum.waitFor();
    await searchArtist.waitFor();await searchSong.waitFor();
    const aSong=page.locator('[data-catalog-kind=track]').filter({hasText:tracks[0].track.title});
    gateOn=true;await aSong.tap();await blocked;
    if(mode==='tap-baseline'){
     const hits=[];
     for(const x of [.12,.5,.88])for(const y of [.14,.5,.86])hits.push(await tapAt(searchAlbum,x,y));
     const navigated=await byHeading(albumTitle).isVisible();
     receipt.baseline={engine,navigated,hits,activeSongReads:trace.filter(event=>event.kind==='read').length};
     assert.equal(navigated,false);
     assert.ok(hits.every(hit=>hit.disabled));
    }else{
     await input.fill('Pulso Luz');
     await sweep(searchAlbum,albumHeading,()=>back('Volver a búsqueda'));
     await sweep(searchArtist,artistHeading,()=>back('Volver a búsqueda'));
     await sweep(searchSong,()=>page.locator('[data-suggestion-id][aria-pressed=true]').filter({hasText:cTrack.title}).waitFor());
     await discography();await back('Volver a búsqueda');
     gateOn=false;unblockRead();
     await page.getByText(/Reproduciendo la canción desde la copia|Canción disponible/).first().waitFor({state:'attached'});
     const playing=await inspect(page,[tracks[0].track.id]);
     assert.equal(playing.copies[0].sha256,tracks[0].expected.sha256);
     assert.equal(trace.filter(event=>event.kind==='read').length,1);
     receipt.tap={idle:{searchAlbum:9,searchArtist:9,searchTrack:9,discography:9},activeSong:{searchAlbum:9,searchArtist:9,searchTrack:9,discography:9},copyVerifiedAfterNavigation:true};
    }
    receipt.status='PASS';receipt.totalMs=elapsed(started);return receipt;
   }
   gateOn=true;
   await collection.getByRole('button',{name:startLabel,exact:true}).tap();
   let timer;
   try{await Promise.race([blocked,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Missing first playlist read')),15000);})]);}
   finally{clearTimeout(timer);}
   await search('Pulso Luz');
   if(mode==='queue'){
    // Use the same full card hit test with focus and a live collection.
    await sweep(searchAlbum,albumHeading,()=>back('Volver a búsqueda'));
    await sweep(searchArtist,artistHeading,()=>back('Volver a búsqueda'));
    const searchTrackSelected=()=>page.locator('[data-suggestion-id][aria-pressed=true]').filter({hasText:cTrack.title}).waitFor();
    await sweep(searchSong,searchTrackSelected);
    await discography();
    await page.getByRole('button',{name:'Guardar artista',exact:true}).tap();
    await page.getByRole('button',{name:'Quitar de mis artistas',exact:true}).waitFor();
    await back('Volver a búsqueda');
   }
   await searchAlbum.tap();await albumHeading();
   const save=page.getByRole('button',{name:'Guardar álbum',exact:true});
   await save.tap();await page.locator('.album-saved').getByText('En Biblioteca').waitFor();
   assert.equal(trace.some(event=>String(event.trackId).startsWith('album-')),false);
   assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).cursor,checkpointKey),mode==='queue-cancel'?2:0);
   await page.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).tap();
   await page.getByRole('button',{name:'Álbumes',exact:true}).tap();
   const savedCard=page.locator('.library-grid button').filter({hasText:albumTitle});
   if(mode==='queue'){
    await sweep(savedCard,albumHeading,()=>back('Volver a Biblioteca'));
    await page.getByRole('button',{name:'Artistas',exact:true}).tap();
    await page.locator('.library-grid button').filter({hasText:artistName}).tap();
    await artistHeading();
    const savedArtistAlbum=page.locator('.artist-album-grid button').filter({hasText:albumTitle});
    await sweep(savedArtistAlbum,albumHeading,()=>back('Volver al artista'));
    await back('Volver a Biblioteca');
    await page.getByRole('button',{name:'Álbumes',exact:true}).tap();
   }
   await savedCard.tap();await albumHeading();
   await page.getByRole('button',{name:'Descargar faltantes',exact:true}).tap();
   await page.getByText('En cola · posición 1',{exact:true}).first().waitFor({state:'attached'});
   await back('Volver a Biblioteca');
   await page.getByRole('button',{name:'Playlists',exact:true}).tap();
   const listC=page.locator('.library-grid button').filter({hasText:playlistC});
   await listC.tap();await byHeading(playlistC).waitFor();
   await collection.getByRole('button',{name:startLabel,exact:true}).tap();
   await openDetails();
   const queue=dock.getByRole('region',{name:'Cola de descargas'});
   assert.deepEqual(await queue.locator('li bdi').allTextContents(),[albumTitle,playlistC]);
   await handle.tap();
   await collection.getByRole('button',{name:'Gestionar descarga en cola de '+playlistC}).tap();
   const dialog=page.getByRole('dialog',{name:playlistC});
   const keep=dialog.getByRole('button',{name:'Mantener en cola'}),remove=dialog.getByRole('button',{name:'Quitar de la cola'});
   assert.equal(await keep.evaluate(button=>document.activeElement===button),true);
   await page.keyboard.press('Shift+Tab');
   assert.equal(await remove.evaluate(button=>document.activeElement===button),true);
   await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
   await collection.getByRole('button',{name:'Gestionar descarga en cola de '+playlistC}).tap();
   await remove.tap();
   await back('Volver a Biblioteca');
   await page.locator('.library-grid button').filter({hasText:playlistName}).tap();
   await collection.getByRole('button',{name:'Gestionar descarga de '+playlistName}).tap();
   if(mode==='queue-cancel'){
    await page.getByRole('button',{name:'Cancelar descarga',exact:true}).tap();
   }else{
    await page.getByRole('button',{name:'Seguir descargando',exact:true}).tap();
    if(mode==='queue-reload')await page.reload();
   }
   gateOn=false;unblockRead();
   await page.waitForFunction(account=>{
    const queue=localStorage.getItem('pulso:collection-download-queue:v1:'+account);
    const checkpoint=localStorage.getItem('pulso:library-download:v1:'+account);
    return queue===null&&checkpoint===null;
   },accountId,{timeout:135000});
   const queueSearches=trace.filter(event=>event.kind==='search').map(event=>event.trackId);
   assert.deepEqual(queueSearches.filter(id=>String(id).startsWith('album-')),['album-0','album-1']);
   assert.deepEqual(queueSearches.slice(-2),['album-0','album-1']);
   const albumIds=await page.evaluate(async titles=>{
    const db=await new Promise((ok,fail)=>{
     const request=indexedDB.open('pulso-web-local-v1');
     request.onsuccess=()=>ok(request.result);request.onerror=()=>fail(request.error);
    });
    try{
     const tracks=await new Promise((ok,fail)=>{
      const request=db.transaction('tracks').objectStore('tracks').getAll();
      request.onsuccess=()=>ok(request.result);request.onerror=()=>fail(request.error);
     });
     return titles.map(title=>tracks.find(track=>track.title===title&&track.assetId)?.id);
    }finally{db.close();}
   },albumSongs.map(song=>song.trackName));
   assert.ok(albumIds.every(Boolean),'Album songs have stored assets');
   const albumCopies=await inspect(page,albumIds);
   assert.deepEqual(albumCopies.copies.map(copy=>copy.sha256),[701,702].map(key=>createHash('sha256').update(candidates.get(key).payload).digest('hex')));
   const data=await inspect(page,[...tracks.map(row=>row.track.id),cTrack.id]);
   const verifiedIds=new Set(tracks.filter((_,index)=>data.copies[index]).map(({track})=>track.id));
   const verified=entries.filter(id=>verifiedIds.has(id)).length;
   if(mode==='queue-cancel'){
    assert.deepEqual([...verifiedIds],tracks.slice(0,2).map(({track})=>track.id));
    assert.equal(data.copies[0].sha256,tracks[0].expected.sha256,'Cancel keeps the copy made by the active playlist');
    assert.equal(verified,3);
   }
   else{
    assert.equal(verified,30);
    assert.equal(verifiedIds.size,tracks.length,'Repeated playlist occurrence reuses the verified asset');
   }
   assert.equal(data.copies.at(-1),null);
   assert.deepEqual(data.unfinished,[]);
   assert.deepEqual(errors,[]);
   receipt.summary={playlistVerified:verified,albumQueries:2,albumVerified:albumIds.length,removedPlaylistDownloaded:false};
   receipt.status='PASS';receipt.totalMs=elapsed(started);return receipt;
  }
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
   await page.reload({waitUntil:'commit'});
   resumeCommitted=true;unblockRead();
   await page.locator('.shell-nav').waitFor();
  }
  const hasMissing=mode==='missing'||mode==='stale-checkpoint';
  const expectedSummary=hasMissing?'9 de 10 guardadas · 1 no existe':'30 de 30 guardadas';
  const downloadState=page.getByRole('status').filter({hasText:mode==='full'?/^Descarga (finalizada|detenida|pendiente) ·/:/^Descarga (finalizada|detenida) ·/});
  await downloadState.waitFor({state:'attached',timeout:135000});
  const reportedState=await downloadState.textContent();
  assert.doesNotMatch(reportedState??'',/^Descarga pendiente ·/,reportedState??'');
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
  if(writeTitle&&!queued){
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
  if(queued)receipt.stage=await page?.evaluate(account=>({headings:[...document.querySelectorAll('h2')].filter(element=>element.getClientRects().length).map(element=>element.textContent),checkpoint:JSON.parse(localStorage.getItem('pulso:library-download:v1:'+account)??'null')?.cursor,queued:JSON.parse(localStorage.getItem('pulso:collection-download-queue:v1:'+account)??'[]').map(item=>item.title)}),accountId).catch(()=>null);
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

async function checkTurnaround(browser,engine,origin,scenario){
 const context=await browser.newContext(config);
 const trace=[],observed=new Set();
 const report={engine,scenario,baseline,status:'FAIL'};
 let page,restores=0;
 const {tracks:fixtures,candidates}=playlistFixture('full');
 const tagged=scenario.startsWith('tags-'),compound=scenario==='tags-compound';
 const timeout=scenario==='callback-timeout';
 const expectedSaved=!(baseline&&compound);
 const tracks=fixtures.slice(0,scenario==='muted'?6:timeout?4:1).map(({track})=>({...track,duration:tagged?4:track.duration}));
 const byId=new Map(tracks.map((track,i)=>[track.id,{...fixtures[i],payload:candidates.get(fixtures[i].goodKey).payload}]));
 const taggedFiles=new Map();
 if(tagged){
  const [track]=tracks;
  for(let variant=0;variant<=3;variant++){
   const title=variant===0?track.title:compound?`${track.artist} — ${track.title}`:`Otra canción ${variant}`;
   const artist=variant===0?track.artist:`Perfil sintético ${variant}`;
   taggedFiles.set(byId.get(track.id).goodKey+variant,taggedM4a(title,artist));
  }
 }
 const descriptor=(track,variant=0)=>({key:byId.get(track.id).goodKey+variant,title:track.title,artist:track.artist,
  duration:scenario==='mismatch'&&variant?52:track.duration,mime:tagged?'audio/mp4':'audio/wav',bytes:taggedFiles.get(byId.get(track.id).goodKey+variant)?.length??byId.get(track.id).payload.length});
 const cloud={accountId,revision:1,document:{version:1,tracks,
  playlists:[{id:uuid(99),name:playlistName,entries:tracks.map((track,i)=>({trackId:track.id,id:uuid(100+i)}))}]}};
 try{
  await context.routeWebSocket('**/*',socket=>void socket.close());
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin){observed.add(url.origin);return route.abort();}
   if(url.pathname==='/testonly-seed')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>seed</title>'});
   if(url.pathname==='/__setup-event'){
    if(url.searchParams.get('kind')==='restore')restores++;
    return route.fulfill({json:{}});
   }
   if(url.pathname!=='/__playlist-full-rpc')return route.fallback();
   const {kind,peer,query,key,offset,limit,option}=route.request().postDataJSON();
   const track=tracks.find(t=>query===t.title+' '+t.artist||[0,1,2,3].some(variant=>key===descriptor(t,variant).key));
   if(!track)return route.fulfill({status:400});
   trace.push({kind,peer,trackId:track.id,option,key,ms:performance.now()});
   if(kind==='callback')return route.fulfill({json:{silent:timeout}});
   if(kind==='search'){
    if(timeout){
     const index=tracks.indexOf(track);
     const menu=(index===1||index===2)&&peer===101?[{label:`${track.artist} - ${track.title}`,audio:descriptor(track)}]:undefined;
     return route.fulfill({json:{audio:peer===102&&(index===0||index===3)?[descriptor(track)]:[],menu}});
    }
    if(scenario==='muted')return route.fulfill({json:peer===101?{silent:true,audio:[]}:{audio:[descriptor(track)]}});
    if(tagged){
     if(peer===102)return route.fulfill({json:{audio:compound?[]:[descriptor(track)]}});
     return route.fulfill({json:{audio:[],delayMs:400,menu:[1,2,3].map(variant=>({
      label:`${variant}. ${track.artist} - ${track.title}`,audio:descriptor(track,variant),
     }))}});
    }
    return route.fulfill({json:{audio:[],delayMs:400,menu:[
     {label:`1. ${track.artist} - ${track.title}`,audio:descriptor(track,1)},
     {label:`2. ${track.artist} - ${track.title} (0:02)`,audio:descriptor(track)},
    ]}});
   }
   if(kind!=='read')return route.fulfill({status:400});
   await new Promise(ok=>setTimeout(ok,350));
   const bytes=taggedFiles.get(key)??byId.get(track.id).payload;
   return route.fulfill({contentType:'application/octet-stream',
    body:!tagged&&key===descriptor(track,1).key?Buffer.alloc(bytes.length):bytes.subarray(offset,offset+limit)});
  });
  await installRequiredAccountFixture(context,origin);
  await context.route(origin+'/api/account-library',route=>route.fulfill({json:cloud}));
  await context.addInitScript(({total,saved})=>{
   window.turnaround={start:null,marks:[],states:[],summary:null,endedAt:null};
   document.addEventListener('click',event=>{
    if(event.target.closest('button')?.getAttribute('aria-label')==='Descargar playlist completa')window.turnaround.start??=performance.now();
   },true);
   new MutationObserver(()=>{
    const sample=window.turnaround;
    if(sample.start===null)return;
    const dock=document.querySelector('.download-dock');
    if(!dock)return;
    const progress=dock.querySelector('progress')?.value??0;
    if(progress>sample.marks.length)sample.marks.push(performance.now());
    if([...document.querySelectorAll('[role="status"]')].some(node=>node.textContent.startsWith(`Descarga finalizada · ${saved} de ${total} guardadas`))){
     if(sample.marks.length<total)sample.marks.push(performance.now());
     sample.summary=dock.querySelector('.download-dock__handle')?.textContent;sample.endedAt??=performance.now();
    }
    const panel=dock.querySelector('.download-dock__panel');
    const text=panel?.textContent??'';
    for(const pattern of [/Consultando bot \d de \d…/,/Probando otro bot…/,/El bot prepara el archivo…/,
     /Descargando [\d,]+ de [\d,]+ MB…/,/La opción no coincide \(duración\) · probando otra…/,/Guardando copia…/,/Buscando canción…/,/Reconectando con Telegram…/,/Telegram no respondió a tiempo/]){
     const state=text.match(pattern)?.[0];
     if(state&&!sample.states.includes(state))sample.states.push(state);
    }
   }).observe(document,{subtree:true,childList:true,characterData:true,attributes:true});
  },{total:tracks.length,saved:timeout?2:expectedSaved?tracks.length:0});
  page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await seed(page,origin,null,null,bots.slice(0,2));
  await page.locator('.bot-providers-list li').nth(1).waitFor({state:'attached'});
  const initialRestores=restores;
  await page.evaluate(()=>window.testTurnaroundDiagnostics());
  await page.getByRole('button',{name:startLabel,exact:true}).evaluate(button=>button.click());
  const handle=page.locator('.download-dock__handle');
  await handle.evaluate(button=>{if(button.getAttribute('aria-expanded')==='false')button.click();});
  await page.waitForFunction(({timeout,total})=>window.turnaround.summary&&(timeout||window.turnaround.marks.length===total),
   {timeout,total:tracks.length},{timeout:timeout?30000:scenario==='muted'?200000:135000});
  const {copies}=await inspect(page,tracks.map(track=>track.id));
  for(const [i,copy] of copies.entries()){
   if(!expectedSaved||timeout&&(i===1||i===2))assert.equal(copy,null);
   else if(tagged)assert.equal(copy.sha256,createHash('sha256').update(taggedFiles.get(descriptor(tracks[i],compound?1:0).key)).digest('hex'));
   else assert.equal(copy.sha256,byId.get(tracks[i].id).expected.sha256);
  }
  assert.deepEqual(errors,[]);
  assert.deepEqual([...observed],[]);
  const {start,marks,states,endedAt}=await page.evaluate(()=>window.turnaround);
  const samplesMs=marks.map((mark,i)=>Math.round(mark-(marks[i-1]??start)));
  const searches=tracks.map(({id})=>trace.filter(e=>e.trackId===id&&e.kind==='search').map(e=>e.peer));
  const songs=await page.evaluate(()=>window.testTurnaroundDiagnostics());
  const callbacks=trace.filter(e=>e.kind==='callback');
  const betweenCallbacksMs=callbacks.length===2?Math.round(callbacks[1].ms-callbacks[0].ms):null;
  Object.assign(report,{songs,samplesMs,states,searches,betweenCallbacksMs,
   callbackOptions:callbacks.map(e=>e.option),saved:copies.filter(Boolean).length});
  if(timeout){
   report.elapsedMs=Math.round(endedAt-start);
   report.samplesMs=songs.map(song=>song.totalMs);
   report.restores=restores-initialRestores;
   assert.deepEqual(searches,[[101,102],[101,102],[101,102],[102]]);
   assert.deepEqual(callbacks.map(e=>e.option),[1,1]);
   assert.equal(report.saved,2);
   assert.equal(report.restores,0);
   assert.ok(!states.includes('Reconectando con Telegram…'));
   assert.deepEqual(songs.map(({timeoutCount,winningBotSlot})=>[timeoutCount,winningBotSlot]),[[0,1],[1,null],[1,null],[0,1]]);
   await handle.evaluate(button=>{if(button.getAttribute('aria-expanded')==='false')button.click();});
   assert.equal(await page.locator('.download-dock__panel li').filter({hasText:'Telegram no respondió a tiempo'}).count(),2);
  }else if(tagged){
   assert.deepEqual(searches,[baseline?[101,101,101,102]:compound?[101]:[101,102]]);
   assert.deepEqual(callbacks.map(e=>e.option),baseline?[1,2,3]:compound?[1]:[1,2]);
   if(!baseline){
    assert.equal(songs[0].candidatesDownloaded,compound?1:3);
    assert.equal(songs[0].winningBotSlot,compound?0:1);
    assert.deepEqual(songs[0].rejections,compound?{}:{'import-tag-mismatch':2});
    assert.ok(samplesMs[0]<15000,'The reserve must allow the backup to run promptly');
   }
  }else if(scenario==='muted'){
   if(!baseline)assert.ok(states.includes('Probando otro bot…'));
   assert.deepEqual(searches,tracks.map((_,i)=>baseline||i<2?[101,102]:[102]));
   if(!baseline)assert.deepEqual(songs.map(({botsTried,winningBotSlot,timeoutCount})=>[botsTried,winningBotSlot,timeoutCount]),
    tracks.map((_,i)=>[i<2?2:1,1,i<2?1:0]));
  }else{
   assert.deepEqual(searches,[baseline?[101,101]:[101]]);
   assert.deepEqual(callbacks.map(e=>e.option),[1,2]);
   if(!baseline){
    assert.ok(betweenCallbacksMs<8000);
    for(const state of [/Consultando bot 1 de 2/,/El bot prepara el archivo/,/Descargando .* MB/,/Guardando copia/])assert.ok(states.some(text=>state.test(text)),String(state));
    assert.equal(songs.length,1);
    assert.equal(songs[0].candidatesTried,2);
    assert.equal(songs[0].candidatesRejected,1);
    assert.equal(songs[0].candidatesDownloaded,1);
    if(scenario==='mismatch'){
     assert.ok(states.some(text=>text.includes('no coincide (duración)')));
     assert.equal(songs[0].rejections['mismatch-duration'],1);
    }
   }
  }
  report.status='PASS';
 }catch(error){
  report.error=String(error.stack??error);
  report.restores=restores;
  report.transport=trace.map(({kind,peer,key,option})=>({kind,peer,key,option}));
  report.dock=await page?.locator('.download-dock').allTextContents().catch(()=>[]);
  report.observed=await page?.evaluate(()=>window.turnaround).catch(()=>null);
 }finally{await context.close();}
 return report;
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
    if(selectedModes&&!selectedModes.includes(mode)||!selectedModes&&(['benchmark','turnaround'].includes(mode)||isQueueMode(mode)))continue;
    if(mode==='turnaround'){
     for(const scenario of selectedScenarios){
      const result=await checkTurnaround(browser,engine,origin,scenario);
      report.cases.push(result);console.log(JSON.stringify(result));
     }
     continue;
    }
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
