// r11: isolated real main + actual v2 product workers; fresh origins/contexts only.
// Run: INSTABOX_HEADLESS=1 node tests/integration/check-import-v2-ui.mjs [case substring]
import assert from 'node:assert/strict';
import {build,preview} from 'vite';
import {chromium} from 'playwright-core';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {licenseGuard} from '../../scripts/third-party-notices.mjs';
import {annotateReport} from '../../.local/import-v2-ui-r11/finalize-report.mjs';
import {instrumentation,init,workerPrelude} from '../../.local/import-v2-ui-r11/harness.mjs';
const dir='.local/import-v2-ui-r11',evidence='.local/evidence/import-v2-ui-r11.json',filter=process.argv[2]??'';
const digest=b=>createHash('sha256').update(b).digest('hex');
async function hashes(path){const rows={};for(const e of await readdir(path,{withFileTypes:true})){const p=path+'/'+e.name;if(e.isDirectory())Object.assign(rows,await hashes(p));else rows[p]=digest(await readFile(p));}return rows;}
const report={format:'pulso-import-v2-ui-r11',passed:false,cases:[],failures:[],attempts:[],pageErrors:[],externalAttempts:0,USD:0,limits:[
 'Chromium Linux sandbox/ephemeral loopback/fresh synthetic contexts; no iPhone/Safari/physical quota/process-kill/offline/private delivery/global T18/P0 acceptance.',
 'Worker response corruption/error/ACK loss, quota and secondary IO faults are TESTONLY injections at named actual boundaries; no functional product protocol changes.',
 'Blob transport only; import intentionally pauses current audio. No claim that import keeps playing. No SDK/auth/Telegram/network or other project/storage access.',
 'Synthetic scope/proof tests exercise callback guards; not real logout/account switching. No exhaustive core matrix, decode fuzz, or cross-product claim.'
]};
try{const prior=JSON.parse(await readFile(evidence));report.attempts=[...(prior.attempts??[]),{date:prior.date,passed:prior.passed,cases:prior.cases,failures:prior.failures}];}catch{}
report.date=new Date().toISOString();
await mkdir(dir,{recursive:true});await mkdir('.local/evidence',{recursive:true});
const before={...await hashes('src'),...await hashes('dist'),...await hashes('odd'),...await hashes('docs'),...await hashes('doc')};
report.sourceHashes=Object.fromEntries(Object.entries(before).filter(([p])=>p==='src/main.tsx'||p==='src/imports/import.worker.ts'||p==='src/imports/recovery.worker.ts'));
const receipt=execFileSync('python3',['scripts/sync_odd_memory.py','--read-only'],{encoding:'utf8'});report.engram=JSON.parse(receipt);assert.equal(report.engram.tasks.length,14);assert.equal(report.engram.FullContentVerified,true);await writeFile(dir+'/engram-read-only.json',receipt);
function wav(seed=1){const rate=8000,n=rate*2,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*(200+seed*37)/rate)*2000),44+i*2);return b;}
await writeFile(dir+'/own.wav',wav());
for(const [ext,codec]of [['mp3','libmp3lame'],['m4a','aac']])execFileSync('node_modules/@ffmpeg-installer/linux-x64/ffmpeg',['-y','-i',dir+'/own.wav','-codec:a',codec,...(ext==='m4a'?['-profile:a','aac_low']:[]),dir+'/own.'+ext],{stdio:'ignore'});
const file=(seed=1)=>({name:`PRIVATE_CANARY_${seed}.wav`,mimeType:'audio/wav',buffer:wav(seed)});
let browser,server,origin;
const state=p=>p.evaluate(()=>window.r11.state());
const idle=p=>p.waitForFunction(()=>window.r11&&!window.r11.state().busy&&window.r11.control.activity.count===0);
const input=p=>p.getByLabel('Importar audios',{exact:true});
const events=p=>p.evaluate(()=>window.r11.diagnostics.getSnapshot().events);
const status=p=>p.evaluate(()=>window.r11.state().status);
const enable=p=>p.evaluate(()=>window.r11.diagnostics.setEnabled(true));
async function importFile(p,files){await input(p).setInputFiles(files);await idle(p);}
async function release(p){await p.evaluate(()=>{window.h.hold=false;const held=window.h.held.splice(0);window.h.delivered=held;held.forEach(x=>x.deliver());});await idle(p);}
const held=p=>p.waitForFunction(()=>window.h.held.length>0);
async function denied(p){const proof=(await state(p)).proof;await p.getByRole('button',{name:'Ceder control',exact:true}).click();assert.match(await status(p),/No se puede ceder/);assert.equal((await state(p)).proof,proof);assert.equal((await state(p)).owner,true);}
async function stored(p){return p.evaluate(async()=>{
 const {all,readRecord}=window.r11,tracks=await all('tracks'),assets=await all('assets'),playlists=await all('playlists'),jobs=await all('jobs');const bytes=[];
 for(const a of assets){let b;if(a.backend==='opfs'){const d=await(await navigator.storage.getDirectory()).getDirectoryHandle('pulso-assets-v1');b=new Uint8Array(await(await(await d.getFileHandle(a.storageKey)).getFile()).arrayBuffer());}else{b=new Uint8Array(a.bytes);for(let i=0;i<a.chunks;i++)b.set(await readRecord('chunks',[a.storageKey,i]),i*65536);}
 bytes.push({id:a.id,length:b.length,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(b=>b.toString(16).padStart(2,'0')).join('')});}
 return {tracks,assets,playlists,jobs,bytes};
 });}
function kept(s){return {tracks:s.tracks,assets:s.assets,playlists:s.playlists,bytes:s.bytes};}
function safe(value){assert.doesNotMatch(JSON.stringify(value),/PRIVATE_CANARY|storageKey|manualOverrides|error\.message/);}
async function start(backend,fault=''){
 const ctx=await browser.newContext();ctx.setDefaultTimeout(10000);
 await ctx.addInitScript(init,{backend,workerFault:fault});
 await ctx.route('**/*',async route=>{const u=route.request().url();if(!u.startsWith(origin+'/')&&!u.startsWith('blob:')){report.externalAttempts++;return route.abort();}
 if(/\/assets\/(import|recovery)\.worker-[^/]+\.js/.test(u)){const r=await route.fetch();return route.fulfill({response:r,body:workerPrelude()+'\n'+await r.text()});}return route.continue();});
 const p=await ctx.newPage();p.on('pageerror',e=>report.pageErrors.push({name:e.name}));await p.goto(origin);await p.waitForFunction(()=>window.r11?.control.owner);await idle(p);return {ctx,p};
}
async function test(name,backend,fn,fault=''){
 if(filter&&!name.includes(filter))return;
 const {ctx,p}=await start(backend,fault);try{const details=await fn(p,ctx);report.cases.push({name,backend,passed:true,...details});console.log('PASS '+backend+' '+name);}catch(e){report.cases.push({name,backend,passed:false});report.failures.push({name,backend,error:e.stack,status:await status(p).catch(()=>null)});console.log('FAIL '+backend+' '+name+': '+e.message);await writeFile(dir+`/failure-${backend}-${name}.json`,JSON.stringify(report.failures.at(-1),null,2));}finally{await ctx.close();}}
try{
 await build({configFile:false,logLevel:'error',plugins:[licenseGuard(),instrumentation()],worker:{plugins:()=>[licenseGuard(),instrumentation()]},build:{outDir:dir+'/build',emptyOutDir:true,rolldownOptions:{input:'index.html'}}});report.buildHashes=await hashes(dir+'/build');
 server=await preview({configFile:false,build:{outDir:dir+'/build'},preview:{host:'127.0.0.1',port:0,strictPort:true}});origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();
 for(const backend of ['idb','opfs']){
 await test('formats-dedup-manual-legacy',backend,async p=>{
  await enable(p);for(const ext of ['mp3','m4a','wav'])await importFile(p,{name:'PRIVATE_CANARY.'+ext,mimeType:ext==='mp3'?'audio/mpeg':ext==='m4a'?'audio/mp4':'audio/wav',buffer:await readFile(dir+'/own.'+ext)});
  await p.evaluate(hash=>window.h.mp3Hash=hash,digest(await readFile(dir+'/own.mp3')));let s=await stored(p);assert.equal(s.tracks.length,3);assert.ok(s.assets.every(a=>a.backend===backend));assert.ok(s.bytes.every(b=>s.assets.some(a=>a.id===b.id&&a.sha256===b.sha256&&a.bytes===b.length)));
  await p.evaluate(async()=>{const r=window.r11,t=(await r.all('tracks')).find(t=>r.state().tracks.some(x=>x.id===t.id)&&t.audioFingerprint?.sha256===window.h.mp3Hash);await r.editTrack(t.id,t.revision,{title:'PRIVATE_CANARY manual',artist:'PRIVATE_CANARY artist',album:'PRIVATE_CANARY album',favorite:true});const changed=await r.readRecord('tracks',t.id);changed.audioFingerprint=null;await r.writeRecord('tracks',t.id,changed);const list=await r.createPlaylist('PRIVATE_CANARY list');await r.changePlaylist(list.id,list.revision,{type:'add',trackId:t.id});await r.refresh();});
  s=await stored(p);await importFile(p,{name:'PRIVATE_CANARY.mp3',mimeType:'audio/mpeg',buffer:await readFile(dir+'/own.mp3')});assert.match(await status(p),/0 importadas, 1 ya existentes/);const after=await stored(p);assert.deepEqual(kept(after),kept(s));await p.evaluate(async()=>{const r=window.r11,t=(await r.all('tracks')).find(t=>t.audioFingerprint===null);delete t.audioFingerprint;await r.writeRecord('tracks',t.id,t);await r.refresh();});const legacy=kept(await stored(p));await importFile(p,{name:'PRIVATE_CANARY.mp3',mimeType:'audio/mpeg',buffer:await readFile(dir+'/own.mp3')});assert.deepEqual(kept(await stored(p)),legacy);safe(await events(p));return {formats:3,duplicate:2,manualNullAndMissingFingerprintPreserved:true};
 });
 await test('postcommit-ack-confirmed-primary',backend,async p=>{
  await enable(p);await importFile(p,file());assert.match(await status(p),/^1 importadas, 0 ya existentes/);const s=await stored(p);assert.equal(s.tracks.length,1);assert.equal(s.jobs[0].state,'sealed');assert.equal(s.bytes[0].sha256,s.assets[0].sha256);const e=await events(p);assert.equal(e.length,1);assert.equal(e[0].phase,'commit');assert.equal(e[0].code,'unknown');assert.equal(e[0].backend,'idb');assert.equal(e[0].outcome,'recovered');assert.equal((await state(p)).blocked,false);safe(e);return {actualCommitThenAckThrow:true,confirmedCountRetained:true,ring:e};
 },'commit-ack');
 await test('protocol-preserves-manual-playlist',backend,async p=>{
  await importFile(p,file());await p.evaluate(async()=>{const r=window.r11,t=r.state().tracks[0];await r.editTrack(t.id,t.revision,{title:'PRIVATE_CANARY manual',artist:'PRIVATE_CANARY artist',favorite:true});const l=await r.createPlaylist('PRIVATE_CANARY list');await r.changePlaylist(l.id,l.revision,{type:'add',trackId:t.id});await r.refresh();});const prior=kept(await stored(p));await enable(p);await p.evaluate(()=>window.h.mode='extras');await importFile(p,[file(2),file(3)]);assert.equal((await state(p)).pending,1);await p.evaluate(()=>window.r11.refresh(true));assert.equal((await state(p)).pending,1);await p.evaluate(()=>window.r11.checkFiles());assert.equal((await state(p)).pending,0);const s=await stored(p);assert.deepEqual(s.tracks.filter(t=>t.id===prior.tracks[0].id),prior.tracks);assert.deepEqual(s.playlists,prior.playlists);assert.deepEqual(s.bytes.filter(b=>b.id===prior.bytes[0].id),prior.bytes);assert.equal(s.tracks.length,2);assert.equal(await p.evaluate(()=>window.h.starts),2);safe(await events(p));return {priorManualAndListAndHashIntact:true,realNewCommitKept:true};
 });
 await test('invalid-zero-large-then-valid',backend,async p=>{
  await enable(p);await importFile(p,{name:'PRIVATE_CANARY.wav',mimeType:'audio/wav',buffer:Buffer.alloc(0)});assert.equal(await p.evaluate(()=>window.h.starts),0);assert.equal((await stored(p)).jobs.length,0);
  await p.evaluate(()=>window.r11.importFiles([new File([new Uint8Array(100*1024*1024+1)],'PRIVATE_CANARY.wav',{type:'audio/wav'})]));await idle(p);assert.equal(await p.evaluate(()=>window.h.starts),0);assert.equal((await stored(p)).jobs.length,0);
  const e=await events(p);assert.deepEqual(e.map(e=>[e.phase,e.code]),[['validate','input-invalid'],['validate','limit-exceeded']]);await importFile(p,file());assert.equal((await stored(p)).tracks.length,1);return {workersBeforeValid:0,validationEvents:2};
 });
 for(const mode of ['normal','quota-cleanup','quota-reconcile',...(backend==='opfs'?['quota-combined']:[])])await test('quota-'+mode,backend,async p=>{
  await importFile(p,file());await p.evaluate(async()=>{const r=window.r11,t=r.state().tracks[0];await r.editTrack(t.id,t.revision,{title:'PRIVATE_CANARY kept',favorite:true});const l=await r.createPlaylist('PRIVATE_CANARY list');await r.changePlaylist(l.id,l.revision,{type:'add',trackId:t.id});await r.refresh();});const prior=kept(await stored(p));await enable(p);
  await importFile(p,[file(2),file(3)]);assert.equal(await p.evaluate(()=>window.h.starts),2);assert.deepEqual(kept(await stored(p)),prior);assert.match(await status(p),/espacio/);
  const e=await events(p);assert.equal(e[0].family,'quota');assert.equal(e[0].phase,'write');assert.equal(e[0].backend,backend);assert.equal(e[0].code,'quota-exceeded');if(mode!=='normal'){assert.equal(e.length,2);assert.equal(e[0].correlationId,e[1].correlationId);assert.equal(e[1].phase,mode.includes('reconcile')||mode==='quota-combined'?'reconcile':'cleanup');assert.equal((await state(p)).blocked,true);}
  safe(e);safe(await p.evaluate(()=>window.h.terminal));return {ring:e,keptHashConserved:true,secondBatchFileStarted:false};
 },mode==='normal'?'quota':mode);
 await test('cancel-after-commit',backend,async p=>{
  await enable(p);await p.evaluate(()=>window.h.hold=true);await input(p).setInputFiles([file(),file(2)]);await held(p);assert.equal((await stored(p)).tracks.length,1);await p.getByRole('button',{name:'Cancelar importación',exact:true}).click();await release(p);assert.match(await status(p),/1 importadas, 0 ya existentes.*Lote cancelado/);assert.equal(await p.evaluate(()=>window.h.starts),1);assert.equal((await stored(p)).tracks.length,1);assert.equal((await events(p)).length,1);return {commitKept:true,secondNotStarted:true};
 });
 for(const epoch of ['off-on','clear'])await test('consent-'+epoch,backend,async p=>{
  if(epoch==='clear')await enable(p);await p.evaluate(()=>window.h.hold=true);await input(p).setInputFiles(file());await held(p);if(epoch==='clear')await p.evaluate(()=>window.r11.diagnostics.clear());else await enable(p);await release(p);assert.deepEqual(await events(p),[]);assert.equal((await stored(p)).tracks.length,1);return {noRetroactiveCapture:true};
 });
 for(const mode of ['oldversion','extras','badcomplete','workererror','messageerror','hostile'])await test('protocol-'+mode,backend,async p=>{
  await enable(p);await p.evaluate(mode=>window.h.mode=mode,mode);await importFile(p,[file(),file(2)]);assert.equal(await p.evaluate(()=>window.h.starts),1);assert.equal(await p.evaluate(()=>window.h.reads),0);assert.equal((await state(p)).pending,1);const prior=kept(await stored(p));assert.equal(prior.tracks.length,1);await denied(p);
  await p.evaluate(()=>window.r11.refresh(true));assert.equal((await state(p)).pending,1);assert.equal(await input(p).isDisabled(),true);await denied(p);await p.evaluate(()=>window.r11.checkFiles());assert.equal((await state(p)).pending,0);assert.deepEqual(kept(await stored(p)),prior);assert.equal(await input(p).isDisabled(),false);const e=await events(p);assert.equal(e[0].code,mode==='workererror'?'worker-failed':'worker-protocol');assert.equal(e[0].outcome,'uncertain');safe(e);return {unverifiedSurvivesRefresh:true,explicitValidatedSealedReviewClears:true,rawReads:0};
 });
 await test('duplicate-terminal-and-foreign-progress',backend,async p=>{
  await enable(p);await p.evaluate(()=>{window.h.mode='foreign-progress';window.h.hold=true;});await input(p).setInputFiles(file());await held(p);const x=await p.evaluate(()=>{const h=window.h,x=h.held[0];x.fn({data:{version:2,type:'progress',operationId:crypto.randomUUID(),bytes:0}});return window.r11.state().status;});assert.match(x,/100 %/);await p.evaluate(()=>window.h.mode='duplicate');await release(p);assert.match(await status(p),/^1 importadas, 0 ya existentes/);assert.equal((await events(p)).length,1);return {count:1,foreignIgnored:true};
 });
 await test('refresh-failure-keeps-confirmed',backend,async p=>{
  await enable(p);await p.evaluate(()=>window.h.hold=true);await input(p).setInputFiles([file(),file(2)]);await held(p);await p.evaluate(()=>window.h.refresh='fail');await release(p);assert.match(await status(p),/^1 importadas, 0 ya existentes.*confirmadas/);assert.equal(await p.evaluate(()=>window.h.starts),1);const s=await stored(p);assert.equal(s.tracks.length,1);assert.equal(s.bytes[0].sha256,s.assets[0].sha256);const e=await events(p);assert.equal(e.length,2);assert.equal(e[0].count,1);assert.equal(e[0].correlationId,e[1].correlationId);assert.equal(e[1].phase,'read');assert.equal(e[1].family,'quota');safe(e);return {ring:e,noRollback:true};
 });
 await test('refresh-barrier-handoff-audio-export',backend,async(p,ctx)=>{
  await importFile(p,file());await p.evaluate(()=>window.r11.queue(window.r11.state().tracks.map(t=>t.id)));await idle(p);await p.locator('#player').getByRole('button',{name:'Reproducir',exact:true}).click();await p.waitForFunction(()=>!window.r11.state().paused);
  const before=await state(p);await enable(p);await p.evaluate(()=>{window.h.hold=true;});await input(p).setInputFiles(file(2));await held(p);let s=await state(p);assert.equal(s.src,before.src);assert.deepEqual(s.entries,before.entries);assert.equal(s.paused,true);assert.equal(await p.evaluate(()=>window.h.audios.length),1);await denied(p);
  await p.evaluate(()=>{window.h.refresh='hold';window.h.hold=false;window.h.held.splice(0).forEach(x=>x.deliver());});await p.waitForFunction(()=>!!window.h.releaseRefresh);await denied(p);await p.evaluate(()=>window.h.releaseRefresh());await idle(p);s=await state(p);assert.equal(s.src,before.src);assert.deepEqual(s.entries,before.entries);
  await p.getByText('Ajustes y límites de esta fase',{exact:true}).click();const panel=p.getByRole('region',{name:'Privacidad y diagnóstico local'});for(const name of ['Fase','Familia','Código','Backend','Cantidad'])await panel.getByRole('checkbox',{name,exact:true}).check();await panel.getByRole('button',{name:'Revisar selección',exact:true}).click();const json=await panel.getByLabel('JSON revisado').innerText();safe(json);for(const row of JSON.parse(json).datasets.errors)assert.deepEqual(Object.keys(row),['phase','family','code','backend','count']);assert.doesNotMatch(json,/operationId|requestId|correlationId|proof|file|title|tags|message/i);
  const download=p.waitForEvent('download');await panel.getByRole('button',{name:'Descargar diagnóstico revisado',exact:true}).click();const dl=await download;assert.equal(dl.suggestedFilename(),'pulso-diagnostico.json');assert.equal(await readFile(await dl.path(),'utf8'),json);
  const q=await ctx.newPage();await q.goto(origin);await q.waitForFunction(()=>window.r11?.control.state==='sin-control');await q.getByRole('button',{name:'Solicitar control',exact:true}).click();await p.waitForFunction(()=>window.r11.control.requests.length>0);await p.getByRole('button',{name:'Ceder control',exact:true}).click();await q.waitForFunction(()=>window.r11.control.owner);await idle(q);assert.equal((await state(q)).paused,true);assert.equal(await p.evaluate(()=>window.h.audios[0].getAttribute('src')),'');assert.equal((await state(p)).paused,true);assert.equal(await q.evaluate(()=>window.r11.diagnostics.getSnapshot().enabled),false);assert.equal(await p.evaluate(()=>window.r11.diagnostics.getSnapshot().enabled),false);await panel.getByLabel('JSON revisado').waitFor({state:'detached'});await q.evaluate(()=>window.h.hold=true);await input(q).setInputFiles(file(3));await held(q);const pending=await state(q);await p.evaluate(()=>{const x=window.h.delivered?.[0];x?.fn({data:x.m});});assert.equal((await state(q)).busy,true);assert.equal((await state(q)).count,pending.count);assert.equal((await state(q)).status,pending.status);await release(q);return {sameAudioUntilCession:true,restoredPaused:true,selectedExportExact:true};
 });
 await test('progress-regression-gates',backend,async p=>{
  await enable(p);await p.evaluate(()=>window.h.hold=true);await input(p).setInputFiles(file());await held(p);await p.evaluate(()=>{const x=window.h.held[0];x.fn({data:{version:2,type:'progress',operationId:x.m.operationId,bytes:1}});});await idle(p);assert.equal((await state(p)).pending,1);assert.equal((await events(p))[0].code,'worker-protocol');assert.equal((await stored(p)).tracks.length,1);return {regressingMatchingProgressRejected:true};
 });
 await test('no-record-requires-reopen',backend,async p=>{
  await importFile(p,file());const prior=kept(await stored(p));await enable(p);await p.evaluate(()=>window.h.mode='no-job');await importFile(p,file(2));await p.evaluate(()=>window.r11.checkFiles());assert.equal((await state(p)).pending,1);assert.match(await status(p),/cierra esta entrada y vuelve a abrir/);assert.deepEqual(kept(await stored(p)),prior);await denied(p);return {testOnlyMissingJobResponse:true,noReplayOrDelete:true};
 });
 await test('old-worker-callbacks-during-new-attempt',backend,async p=>{
  await enable(p);await p.evaluate(()=>{window.h.mode='extras';window.h.hold=true;});await input(p).setInputFiles(file());await held(p);await p.evaluate(()=>window.h.old=window.h.held[0]);await release(p);await p.evaluate(()=>window.r11.checkFiles());await p.evaluate(()=>{window.h.mode='normal';window.h.hold=true;});await input(p).setInputFiles(file(2));await held(p);const before=await state(p),ring=await events(p);
  await p.evaluate(()=>{const x=window.h.old;x.fn({data:x.m});x.fn({data:{version:1,type:'error',operationId:x.m.operationId}});});const after=await state(p);assert.equal(after.busy,true);assert.equal(after.count,before.count);assert.equal(after.status,before.status);assert.deepEqual(await events(p),ring);await release(p);assert.match(await status(p),/^1 importadas/);return {exactOldWorkerCannotFinishNewAttempt:true};
 });
 await test('synthetic-scope-old-finally',backend,async p=>{
  await enable(p);await p.evaluate(()=>window.h.hold=true);await input(p).setInputFiles(file());await held(p);await p.evaluate(()=>{window.h.old=window.h.held.splice(0)[0];window.r11.syntheticScope();void window.r11.importFiles([new File([new Uint8Array([1,2,3])],'PRIVATE_CANARY bad.wav',{type:'audio/wav'})]);});await held(p);const before=await state(p);assert.equal(before.busy,true);await p.evaluate(()=>window.h.old.deliver());await p.waitForFunction(()=>window.r11.control.activity.count===2);const after=await state(p);assert.equal(after.busy,true);assert.equal(after.status,before.status);await release(p);assert.equal((await state(p)).count,0);return {syntheticScopeOnly:true,oldFinallyLeavesNewActivity:true};
 });
 await test('optional-metadata-barrier',backend,async p=>{
  await enable(p);await p.evaluate(async()=>{window.h.metadataEvents=0;const bc=new BroadcastChannel('r11-metadata');bc.onmessage=()=>window.h.metadataEvents++;await new Promise(ready=>{window.h.metadataLock=navigator.locks.request('r11-metadata',()=>new Promise(release=>{window.h.releaseMetadata=release;ready();}));});});
  await input(p).setInputFiles(file());await p.waitForFunction(()=>window.h.metadataEvents===1);const s=await stored(p);assert.equal(s.jobs[0].state,'sealed');assert.equal(s.tracks.length,1);assert.equal(await p.evaluate(async()=>(await navigator.locks.query()).held.some(l=>l.name==='pulso-web:local:asset-writer')),false);await denied(p);await p.evaluate(async()=>{window.h.releaseMetadata();await window.h.metadataLock;});await idle(p);assert.match(await status(p),/^1 importadas/);return {actualOptionalExtractorAfterSealedBlocksHandoff:true};
 });
 await test('closed-optional-warning',backend,async p=>{
  const raw=await readFile(dir+'/own.mp3');let offset=0;if(raw.subarray(0,3).toString()==='ID3')offset=10+raw[6]*2097152+raw[7]*16384+raw[8]*128+raw[9];const syn=n=>Buffer.from([n>>>21&127,n>>>14&127,n>>>7&127,n&127]);const apic=Buffer.concat([Buffer.from([3]),Buffer.from('image/png\0'),Buffer.from([3,0]),Buffer.from('PRIVATE_CANARY bad image')]);const frame=Buffer.concat([Buffer.from('APIC'),syn(apic.length),Buffer.alloc(2),apic]);const bytes=Buffer.concat([Buffer.from('ID3'),Buffer.from([4,0,0]),syn(frame.length),frame,raw.subarray(offset)]);
  await enable(p);await importFile(p,{name:'PRIVATE_CANARY warning.mp3',mimeType:'audio/mpeg',buffer:bytes});assert.match(await status(p),/^1 importadas/);assert.equal((await state(p)).pending,0);assert.equal((await stored(p)).bytes[0].sha256,digest(bytes));assert.ok((await status(p)).length>'1 importadas, 0 ya existentes. Copias completas verificadas.'.length);safe(await events(p));return {actualInvalidAPICWarningAudioConfirmed:true};
 });
 }
 for(const action of ['resume','discard'])await test('nonterminal-protocol-recovery-'+action,'opfs',async p=>{
  await enable(p);await p.evaluate(()=>window.h.mode='extras');await importFile(p,[file(),file(2)]);assert.equal(await p.evaluate(()=>window.h.starts),1);assert.equal((await state(p)).pending,1);assert.equal((await stored(p)).tracks.length,0);assert.equal((await stored(p)).jobs[0].state,'uncertain');
  await p.evaluate(()=>window.r11.checkFiles());assert.equal((await state(p)).pending,1);await denied(p);
  await p.evaluate(()=>{window.h.mode='normal';window.h.hold=true;});const job=(await state(p)).operations[0];await p.evaluate(({job,action})=>{void window.r11.recover(job,action);},{job,action});await held(p);
  await p.evaluate(()=>{const x=window.h.held[0];x.fn({data:{...x.m,requestId:crypto.randomUUID(),state:'writing'}});});assert.equal((await state(p)).busy,true);await release(p);assert.equal((await state(p)).pending,0);assert.equal((await stored(p)).jobs[0].state,action==='resume'?'sealed':'discarded');assert.equal((await stored(p)).tracks.length,action==='resume'?1:0);assert.equal((await state(p)).blocked,false);safe(await events(p));return {realCloseAckLost:true,manualCheckPreservesNonterminal:true,oldRecoveryRequestIgnored:true,actualRecoveryV2:action};
 },'close-ack');
 await test('matching-bad-recovery-state','opfs',async p=>{
  await enable(p);await importFile(p,file());await p.evaluate(()=>window.h.mode='badstate');const job=(await state(p)).operations[0];await p.evaluate(job=>window.r11.recover(job,'resume'),job);await idle(p);assert.equal((await state(p)).pending,1);const prior=kept(await stored(p));assert.equal(prior.tracks.length,1);await p.evaluate(()=>window.r11.refresh(true));assert.equal((await state(p)).pending,1);await denied(p);await p.evaluate(()=>window.r11.checkFiles());assert.equal((await state(p)).pending,0);assert.deepEqual(kept(await stored(p)),prior);const e=await events(p);assert.ok(e.some(e=>e.code==='worker-protocol'&&e.operation==='recover-import'));safe(e);return {actualRecoverySealsButMalformedStateCannotConfirm:true};
 },'close-ack');
 await test('real-recovery-discard','opfs',async p=>{
  await enable(p);await importFile(p,file());const region=p.getByRole('region',{name:'Recuperación de importaciones'});await region.getByRole('button',{name:'Descartar copia incompleta',exact:true}).click();await region.getByRole('button',{name:'Confirmar descarte del parcial',exact:true}).click();await idle(p);assert.equal((await stored(p)).tracks.length,0);assert.equal((await stored(p)).jobs[0].state,'discarded');assert.equal((await state(p)).blocked,false);assert.equal(await p.evaluate(()=>window.h.recoveries),1);safe(await events(p));return {actualRecoveryV2Discard:true};
 },'close-ack');
 assert.equal(report.externalAttempts,0);assert.deepEqual(report.pageErrors,[]);report.passed=report.failures.length===0&&report.cases.length>0;
}catch(e){report.failures.push({harness:true,error:e.stack});process.exitCode=1;}
finally{
 await browser?.close();if(server)await new Promise(r=>server.httpServer.close(r));const after={...await hashes('src'),...await hashes('dist'),...await hashes('odd'),...await hashes('docs'),...await hashes('doc')};report.protectedTreesUnchanged=JSON.stringify(before)===JSON.stringify(after);if(!report.protectedTreesUnchanged){report.passed=false;report.failures.push({error:'Protected trees changed concurrently; inspect hashes, no attribution to runner.'});report.protectedChanges=Object.keys(after).filter(p=>before[p]!==after[p]);}
 if(!report.passed)process.exitCode=1;await annotateReport(report);await writeFile(evidence,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,failures:report.failures,protectedTreesUnchanged:report.protectedTreesUnchanged}));
}
