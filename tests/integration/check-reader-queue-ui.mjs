// B1a focal integration only. No product functions replaced; fresh contexts, native IDB/OPFS, bounded Blob.
// Run: INSTABOX_HEADLESS=1 node tests/integration/check-reader-queue-ui.mjs
import assert from 'node:assert/strict';
import {build,preview} from 'vite';
import {chromium} from 'playwright-core';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {instrumentation,init,sources} from '../../.local/reader-queue-ui-r18/harness.mjs';
const dir='.local/reader-queue-ui-r18',sha=b=>createHash('sha256').update(b).digest('hex');
const report={project:'Pulso-Web',increment:'T18 B1a',passed:false,cases:[],failures:[],externalAttempts:[],pageErrors:[],USD:0,limits:['Chromium Linux sandbox only; iPhone physical deferred, T18/P0 pending.','No SW matrix: B1a changes main planning, verification and guards; bounded Blob exercises installation. SW protocol unchanged and not accepted here.','Native storage seeded with synthetic metadata and bundled authorized sample; boundary IO faults and timing gates are TESTONLY.','Synthetic scope/proof/activity ABA is explicitly labeled; no claim of real OS lifecycle or physical recovery.','No A reader loop, B1b Blob optimization, panels, SDK, external services, 4175, dist or broad suite work.']};
await mkdir(dir,{recursive:true});
async function hashes(path){const out={};for(const e of await readdir(path,{withFileTypes:true})){const p=path+'/'+e.name;if(e.isDirectory())Object.assign(out,await hashes(p));else out[p]=sha(await readFile(p));}return out;}
const bytes=await readFile('public/samples/Aurora.mp3');
const base={version:1,entries:['A','B','A'].map((trackId,i)=>({id:'q'+i,trackId})),currentEntryId:'q2',position:2,repeat:'all',shuffleOrder:['q2','q1','q0']};
const state=p=>p.evaluate(()=>window.r18.state());
async function drainedState(p){const h=await p.waitForFunction(()=>{const s=window.r18.state();return s.count===0?s:null;});try{return await h.jsonValue();}finally{await h.dispose();}}
const idle=p=>p.waitForFunction(()=>window.r18&&!window.r18.state().busy&&window.r18.state().count===0);
let server,browser,origin;
async function seed(p,backend,{missing=false,corrupt=false}={}){
 const assets=['A','B'].map(()=>({id:randomUUID(),storageKey:randomUUID(),namespace:'local',backend,bytes:bytes.length,sha256:sha(bytes),mime:'audio/mpeg',chunks:Math.ceil(bytes.length/65536),chunkSize:65536,state:'complete',revision:1,retention:'kept'}));
 const tracks=['A','B'].map((id,i)=>({id,assetId:assets[i].id,title:'R18_PRIVATE_CANARY '+id,artist:null,album:null,duration:15,favorite:true,revision:1,createdAt:'2026-10-31T00:00:00Z',manualOverrides:{}}));
 const playlist={id:'r18-list',name:'R18_PRIVATE_CANARY list',entries:base.entries,revision:1};
 await p.evaluate(async({assets,tracks,playlist,bytes,missing,corrupt})=>{
  const r=window.r18;
  for(let i=0;i<2;i++){const a=assets[i],b=new Uint8Array(bytes);if(i===1&&corrupt)b[0]^=1;
   await r.writeRecord('assets',a.id,a);await r.writeRecord('tracks',tracks[i].id,tracks[i]);
   if(i===1&&missing)continue;
   if(a.backend==='opfs'){const d=await(await navigator.storage.getDirectory()).getDirectoryHandle('pulso-assets-v1',{create:true});const f=await d.getFileHandle(a.storageKey,{create:true});const w=await f.createWritable();await w.write(b);await w.close();}
   else for(let off=0;off<b.length;off+=65536)await r.writeRecord('chunks',[a.storageKey,off/65536],b.slice(off,off+65536));
  }
  await r.writeRecord('playlists',playlist.id,playlist);await r.refresh(true);r.diagnostics.setEnabled(true);window.h.shared=0;
 },{assets,tracks,playlist,bytes:[...bytes],missing,corrupt});return assets;
}
async function durable(p){return p.evaluate(async()=>{
 const r=window.r18,mode=window.h.mode;window.h.mode=null;
 try{const tracks=await r.all('tracks'),assets=await r.all('assets'),playlists=await r.all('playlists'),snapshot=await r.readRecord('settings','library-playback'),data=[];
 for(const a of assets){if(a.backend==='idb'){for(let i=0;i<a.chunks;i++){const b=await r.readRecord('chunks',[a.storageKey,i]);data.push([a.id,i,b?[...b]:null]);}}
 else{const d=await(await navigator.storage.getDirectory()).getDirectoryHandle('pulso-assets-v1');try{const f=await(await d.getFileHandle(a.storageKey)).getFile();data.push([a.id,[...new Uint8Array(await f.arrayBuffer())]]);}catch(e){if(e.name!=='NotFoundError')throw e;data.push([a.id,null]);}}}
 return {tracks,assets,playlists,snapshot,data};}finally{window.h.mode=mode;}
 });}
async function saveBase(p){await p.evaluate(async b=>{await window.r18.writeRecord('settings','library-playback',b);window.h.writes=[];},base);}
async function fault(p,backend,asset,mode){await p.evaluate(({backend,key,mode})=>{window.h.mode=mode;window.h.key=key;},{backend,key:asset.storageKey,mode});}
async function diag(p,code,phase,backend){const events=await p.evaluate(()=>window.r18.diagnostics.getSnapshot().events);assert.ok(events.some(e=>e.code===code&&e.phase===phase&&e.backend===backend),JSON.stringify(events));assert.doesNotMatch(JSON.stringify(events),/R18_PRIVATE_CANARY|blob:|pulso-web:local:owner/);assert.equal(await p.evaluate(()=>window.h.getters),0);return events;}
async function test(name,backend,fn,seedOptions){const ctx=await browser.newContext();ctx.setDefaultTimeout(7000);await ctx.addInitScript(init);await ctx.route('**/*',route=>{const u=route.request().url();if(!u.startsWith(origin+'/')&&!u.startsWith('blob:')){report.externalAttempts.push(u);return route.abort();}return route.continue();});const p=await ctx.newPage();p.on('pageerror',e=>report.pageErrors.push(e.message));try{await p.goto(origin);await idle(p);const assets=await seed(p,backend,seedOptions);const details=await fn(p,assets);report.cases.push({name,backend,passed:true,...details});console.log('PASS',backend,name);}catch(e){report.failures.push({name,backend,error:e.stack,state:await state(p).catch(()=>null)});report.cases.push({name,backend,passed:false});await writeFile(dir+'/failure-'+Date.now()+'.html',await p.content());console.log('FAIL',backend,name,e.message);}finally{await ctx.close();}}
try{
 report.engram=JSON.parse(execFileSync('python3',['scripts/sync_odd_memory.py','--read-only'],{encoding:'utf8'}));assert.equal(report.engram.tasks.length,14);assert.equal(report.engram.FullContentVerified,true);assert.ok(report.engram.tasks.every(t=>t.FullContentVerified&&t.project==='Pulso-Web'));
 await build({configFile:false,publicDir:false,logLevel:'error',plugins:[instrumentation()],build:{outDir:dir+'/build',emptyOutDir:true,rolldownOptions:{input:'index.html'}}});report.builtSources={...sources};report.buildHashes=await hashes(dir+'/build');
 server=await preview({configFile:false,build:{outDir:dir+'/build'},preview:{host:'127.0.0.1',port:0,strictPort:true}});origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 for(const backend of ['idb','opfs']){
  for(const kind of ['missing','corrupt'])await test('reopen-A/B/A-'+kind+'-B',backend,async p=>{
   await saveBase(p);const before=await durable(p);await p.reload();await idle(p);const s=await state(p);
   assert.deepEqual(s.entries.map(e=>e.id),['q0','q2']);assert.equal(s.index,1);assert.match(s.status,/1 entradas sin audio/);
   await p.waitForFunction(()=>window.r18.audio.readyState>=1&&Math.abs(window.r18.audio.currentTime-2)<.15);
   assert.equal(await p.evaluate(()=>window.h.plays),0);assert.equal(await p.evaluate(()=>window.r18.audio.paused),true);
   assert.equal(await p.getByLabel('Repetición',{exact:false}).inputValue(),'all');assert.equal(await p.getByRole('button',{name:'Aleatorio',exact:true}).getAttribute('aria-pressed'),'true');
   const after=await durable(p);assert.deepEqual({...after,snapshot:undefined},{...before,snapshot:undefined});assert.deepEqual(after.snapshot.entries.map(e=>e.id),['q0','q2']);assert.equal(after.snapshot.currentEntryId,'q2');assert.deepEqual(after.snapshot.shuffleOrder,['q2','q0']);assert.equal((await drainedState(p)).count,0);
   return {realReopen:true,paused:true,autoplayCalls:0,organizationAndBytesIntact:true,occurrences:['q0','q2'],current:'q2'};
  },{[kind]:true});
  for(const mode of ['denied','hostile'])await test('plan-unknown-'+mode+'-preserves-full-snapshot',backend,async(p,assets)=>{
   await p.evaluate(b=>window.r18.queue([],b),base);await p.waitForFunction(()=>window.r18.audio.readyState>=1&&Math.abs(window.r18.audio.currentTime-2)<.15);await idle(p);const previous=await state(p);await saveBase(p);const before=await durable(p);await fault(p,backend,assets[1],mode);await p.evaluate(b=>window.r18.queue([],b),base);await idle(p);
   const s=await drainedState(p);assert.deepEqual(s.entries,previous.entries);assert.equal(s.index,previous.index);const revoked=await p.evaluate(()=>window.h.revoked);assert.ok(previous.entries.every(e=>!revoked.includes(e.src)));assert.match(s.status,/Se conserva la cola guardada/);assert.doesNotMatch(s.status,/entradas sin audio se omitieron/);assert.deepEqual(await durable(p),before);assert.deepEqual(await p.evaluate(()=>window.h.writes),[]);
   return {events:await diag(p,mode==='denied'?'storage-denied':'unknown',backend==='idb'?'read':'open',backend),admittedTokensAtExit:s.count,snapshotAndBytesIntact:true,syntheticBoundaryFault:true};
  });
  await test('plan-asset-changed-is-unknown-not-missing',backend,async(p,assets)=>{
   await saveBase(p);await p.evaluate(()=>{window.h.shared=0;window.h.gateAt=2;});const work=p.evaluate(b=>window.r18.queue([],b),base);await p.waitForFunction(()=>window.h.release!==null);
   await p.evaluate(async a=>{await window.r18.writeRecord('assets',a.id,{...a,revision:a.revision+1});},assets[1]);const before=await durable(p);
   await p.evaluate(()=>window.h.release());await work;await idle(p);assert.deepEqual(await durable(p),before);assert.deepEqual(await p.evaluate(()=>window.h.writes),[]);assert.deepEqual((await state(p)).entries,[]);
   return {events:await diag(p,'asset-changed','open',backend),realManifestRevisionChange:true,syntheticTimingGate:true};
  });
  await test('force-refresh-unknown-atomic-cache-pending-and-recovery',backend,async(p,assets)=>{
   await p.evaluate(()=>window.r18.queue(['A']));await p.waitForFunction(()=>window.r18.audio.readyState>=1);await idle(p);await p.evaluate(()=>window.r18.pending());const before=await state(p),storedBefore=await durable(p);
   await p.evaluate(async()=>{const r=window.r18,t=await r.readRecord('tracks','A');await r.writeRecord('tracks','A',{...t,assetId:null,title:'R18_PRIVATE_CANARY changed',revision:2});await r.writeRecord('playlists','new-list',{id:'new-list',name:'R18_PRIVATE_CANARY new',entries:[],revision:1});});
   const durableAfterEdit=await durable(p);await fault(p,backend,assets[1],'hostile');
   await p.getByRole('button',{name:'Comprobar archivos locales',exact:true}).click();await idle(p);const failed=await drainedState(p);
   assert.deepEqual(failed.tracks,before.tracks);assert.deepEqual(failed.playlists,before.playlists);assert.deepEqual(failed.availability,before.availability);assert.deepEqual(failed.pending,before.pending);assert.deepEqual(failed.blocks,before.blocks);assert.deepEqual(failed.entries,before.entries);assert.equal(failed.idle,false);assert.equal(failed.blocked,true);assert.equal(failed.count,0);assert.deepEqual(await durable(p),durableAfterEdit);
   const events=await diag(p,'unknown',backend==='idb'?'read':'open',backend);
   await p.evaluate(async assetId=>{window.h.mode=null;const r=window.r18,t=await r.readRecord('tracks','A');await r.writeRecord('tracks','A',{...t,assetId});},assets[0].id);const durableBeforeRecovery=await durable(p);await p.getByRole('button',{name:'Comprobar archivos locales',exact:true}).click();await idle(p);const recovered=await drainedState(p);
   assert.equal(recovered.tracks[0].title,'R18_PRIVATE_CANARY changed');assert.equal(recovered.playlists.length,2);assert.ok(recovered.availability.every(([,v])=>v.state==='available'));assert.deepEqual(recovered.pending,before.pending);assert.equal(recovered.blocked,true);assert.equal(recovered.idle,false);assert.equal(recovered.count,0);assert.deepEqual(await durable(p),durableBeforeRecovery);assert.deepEqual(durableAfterEdit.data,storedBefore.data);assert.deepEqual(recovered.blocks,['import-transport']);
   return {events,atomicPublication:true,oldCacheKept:true,explicitReviewRecoversView:true,pendingImportNotResolved:true,admittedTokensAtExit:0};
  });
 }
 for(const [stage,kind] of [['plan','scope'],['validation','proof'],['tickets','token']])await test('late-'+stage+'-synthetic-'+kind+'-invalidation','idb',async p=>{
  await p.evaluate(()=>window.r18.queue(['A']));await p.waitForFunction(()=>window.r18.audio.readyState>=1);await idle(p);const previous=await state(p);const oldUrls=previous.entries.map(e=>e.src);
  await p.evaluate(stage=>{window.h.shared=0;window.h.gateAt=stage==='tickets'?2:1;window.h.release=null;},stage);
  const work=p.evaluate(({stage,base})=>stage==='plan'?window.r18.queue([],base):window.r18.queue(['B']),{stage,base});await p.waitForFunction(()=>window.h.release!==null);
  await p.evaluate(kind=>window.r18.synthetic(kind),kind);const newer=await state(p);await p.evaluate(()=>window.h.release());await work;await p.waitForFunction(()=>window.r18.state().count===0);
  const after=await drainedState(p);assert.deepEqual(after.entries,previous.entries);assert.equal(after.busy,true);assert.equal(after.configuring,true);assert.equal(after.status,newer.status);assert.equal(after.count,0);assert.ok(oldUrls.every(u=>!after.entries.length||!u.startsWith('blob:')||u===after.entries[0].src));
  const revoked=await p.evaluate(()=>window.h.revoked);assert.ok(oldUrls.every(u=>!revoked.includes(u)));await p.evaluate(()=>window.r18.resetBusy());return {syntheticInvalidation:true,stage,guardKind:kind,newBusyAndStatusUntouched:true,previousQueueAndForeignUrlsIntact:true,admittedTokensAtExit:0};
 });
 await test('late-Blob-partial-materialization-token-ABA-cleans-only-attempt-URLs','idb',async p=>{
  await p.evaluate(()=>window.r18.queue(['A']));await p.waitForFunction(()=>window.r18.audio.readyState>=1);await idle(p);const previous=await state(p);const createdBefore=await p.evaluate(()=>window.h.created.length);
  await p.evaluate(()=>{window.h.shared=0;window.h.gateAt=4;window.h.release=null;});
  const work=p.evaluate(()=>window.r18.queue(['A','B']));await p.waitForFunction(()=>window.h.release!==null);
  const attemptUrls=await p.evaluate(n=>window.h.created.slice(n),createdBefore);assert.equal(attemptUrls.length,1);
  await p.evaluate(()=>window.r18.synthetic('token'));await p.evaluate(()=>window.h.release());await work;
  const after=await drainedState(p),revoked=await p.evaluate(()=>window.h.revoked);assert.deepEqual(after.entries,previous.entries);assert.equal(after.busy,true);assert.equal(after.status,'TESTONLY newer work');assert.equal(after.count,0);assert.ok(attemptUrls.every(u=>revoked.includes(u)));assert.ok(previous.entries.every(e=>!revoked.includes(e.src)));
  await p.evaluate(()=>window.r18.resetBusy());return {nativeBlobMaterialization:true,syntheticActivityInvalidationAndReopen:true,oneAttemptURLRevoked:true,previousURLsRetained:true,admittedTokensAtExit:0};
 });
 await test('late-refresh-activity-scope-discarded-after-synthetic-owner-reopen','idb',async p=>{
  const previous=await state(p);await p.evaluate(async()=>{const r=window.r18,t=await r.readRecord('tracks','A');await r.writeRecord('tracks','A',{...t,title:'R18_PRIVATE_CANARY late change'});window.h.shared=0;window.h.gateAt=2;window.h.release=null;});
  const work=p.evaluate(()=>window.r18.checkFiles());await p.waitForFunction(()=>window.h.release!==null);await p.evaluate(()=>window.r18.synthetic('token'));await p.evaluate(()=>window.h.release());await work;
  const after=await drainedState(p);assert.deepEqual(after.tracks,previous.tracks);assert.deepEqual(after.playlists,previous.playlists);assert.deepEqual(after.availability,previous.availability);assert.equal(after.status,'TESTONLY newer work');assert.equal(after.busy,true);assert.equal(after.count,0);await p.evaluate(()=>window.r18.resetBusy());
  return {nativeDelayedRead:true,syntheticActivityInvalidationAndReopen:true,oldRefreshNotPublished:true,newBusyAndStatusUntouched:true};
 });
 await test('real-cede-denied-during-plan-reopen-keeps-admitted-attempt','idb',async p=>{
  await p.evaluate(()=>{window.h.shared=0;window.h.gateAt=1;});const work=p.evaluate(b=>window.r18.queue([],b),base);await p.waitForFunction(()=>window.h.release!==null);
  const proof=(await state(p)).proof;await p.evaluate(()=>window.r18.cede());assert.equal((await state(p)).owner,true);assert.equal((await state(p)).proof,proof);
  await p.evaluate(()=>window.h.release());await work;await idle(p);assert.deepEqual((await state(p)).entries.map(e=>e.id),['q0','q1','q2']);return {realOwnershipCedeRefused:true,sameAcquisitionValid:true,admittedTokensAtExit:0};
 });
 const main=await readFile('src/main.tsx','utf8');assert.match(main,/localTickets\([\s\S]*?\),proof,current\)/);report.localTicketsGuard={staticVerified:true,limit:'Real tickets stage delayed at native reader lock; function is not replaced. No synthetic SW ticket callback claim.'};
 assert.deepEqual(report.externalAttempts,[]);assert.deepEqual(report.pageErrors,[]);report.passed=report.failures.length===0;
}catch(e){report.failures.push({harness:true,error:e.stack});}
finally{
 await browser?.close();if(server)await new Promise(r=>server.httpServer.close(r));report.concurrentSourceChanges={};for(const [p,h]of Object.entries(report.builtSources??{})){const now=sha(await readFile(p));if(now!==h)report.concurrentSourceChanges[p]={built:h,current:now};}
 report.sourceCurrent=Object.keys(report.concurrentSourceChanges).length===0;if(!report.sourceCurrent){report.passed=false;report.failures.push({sourceChanged:true,rebuildRequired:true});}
 report.verification={syntax:['node --check tests/integration/check-reader-queue-ui.mjs','node --check .local/reader-queue-ui-r18/harness.mjs'],typecheck:'npm run typecheck',broadSuitesRerun:false,productEdits:false};report.artifactHashes={runner:sha(await readFile('tests/integration/check-reader-queue-ui.mjs')),helper:sha(await readFile(dir+'/harness.mjs'))};report.command='INSTABOX_HEADLESS=1 node tests/integration/check-reader-queue-ui.mjs';report.status=report.passed?'FOCAL_PASS_NOT_GLOBAL_ACCEPTANCE':'FOCAL_FAILURE_REQUIRES_REVIEW';await writeFile(dir+'/attempt-'+Date.now()+'.json',JSON.stringify(report,null,2)+'\n');await writeFile('.local/evidence/reader-queue-ui-r18.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,failures:report.failures,sourceCurrent:report.sourceCurrent}));if(!report.passed)process.exitCode=1;
}
