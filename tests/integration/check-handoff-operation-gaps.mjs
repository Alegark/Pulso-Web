// Run: INSTABOX_HEADLESS=1 node tests/integration/check-handoff-operation-gaps.mjs
// Optional PULSO_GAPS_FOCUS=extractors|batch|backup. No product/dist mutation.
import assert from 'node:assert/strict';
import {build,preview} from 'vite';
import {chromium} from 'playwright-core';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
const focus=process.env.PULSO_GAPS_FOCUS??'all';
assert.ok(['all','extractors','batch','backup'].includes(focus));
const outDir=`.local/handoff-operation-gaps-${focus}`,evidence='.local/evidence/handoff-operation-gaps.json';
const report={passed:false,focus,command:'INSTABOX_HEADLESS=1 node tests/integration/check-handoff-operation-gaps.mjs',environment:'Chromium Linux; sandbox enabled; private contexts; temporary loopback; isolated Vite production build',memory:'Engram read-only: 12 files; FullContentVerified=true, project/bytes/SHA-256 verified',fixtureProvenance:'Repository synthetic A.wav/A.mp3; own USLT text and canvas PNG APIC assembled in this runner',cases:[],hooks:{},externalRequests:[],pageErrors:[],limitations:['Test-only Vite API wrappers delay before effects and after settled effects; no await added inside IDB transactions.','Batch interrupted record and foreign backup operation are synthetic durable fixtures; recovery, retry, preview, inspect and worker implementations are real.','Blob transport and OPFS bytes used; import intentionally pauses audio at admission (existing main.tsx behavior); tests preserve that source/paused state and both ownership locks. Other operation tests preserve active playback. No BFCache, iPhone, Telegram or P0 acceptance.']};
let browser,server,current;
await mkdir('.local/evidence',{recursive:true});
async function hashes(dir){const result={};for(const e of await readdir(dir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})){const path=`${dir}/${e.name}`;if(e.isDirectory())Object.assign(result,await hashes(path));else result[path]=createHash('sha256').update(await readFile(path)).digest('hex');}return result;}
const before=await hashes('dist');
const originalUIHash=createHash('sha256').update(await readFile('tests/integration/check-handoff-ui.mjs')).digest('hex');
const targets={
 '/src/imports/artwork.ts':['inspectEmbeddedArtwork'],
 '/src/imports/lyrics.ts':['inspectEmbeddedLyrics'],
 '/src/library/local-batches.ts':['recoverLocalBatch','retryLocalBatch'],
 '/src/library/organization-backup.ts':['previewOrganization','inspectOrganizationApply','startOrganizationRecovery'],
};
// Exact module suffix + exactly one declaration match. Both window and real worker
// builds install the same plugin. Wrappers preserve arguments/results/errors.
function instrumentation(){return {name:'handoff-operation-gaps-only',enforce:'pre',transform(code,id){
 const names=Object.entries(targets).find(([suffix])=>id.endsWith(suffix))?.[1];if(!names)return;
 for(const name of names){
  const declaration=new RegExp(`export (async function|function|const) ${name}(?=[(=])`,'g');
  assert.equal([...code.matchAll(declaration)].length,1,`exact declaration ${id}:${name}`);
  code=code.replace(declaration,(_,kind)=>`${kind} __gaps_${name}`);
  code+=`\nexport async function ${name}(...args:Parameters<typeof __gaps_${name}>){await __gapsBarrier('${name}:before');const result=await __gaps_${name}(...args);await __gapsBarrier('${name}:after');return result;}\n`;
  report.hooks[name]=(report.hooks[name]??0)+1;
 }
 code+=`\nconst __gapsBC=new BroadcastChannel('pulso-web:test:gaps-events');async function __gapsBarrier(key:string){__gapsBC.postMessage({key});await navigator.locks.request('pulso-web:test:'+key,{mode:'shared'},()=>{});}\n`;
 return {code,map:null};
}};}
try{
 report.sourceSHA256=Object.fromEntries(await Promise.all([...Object.keys(targets).map(p=>p.slice(1)),'src/main.tsx','src/ui/LocalBatchPanel.tsx','src/ui/OrganizationPanel.tsx'].map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
 await build({configFile:false,plugins:[instrumentation()],worker:{plugins:()=>[instrumentation()]},build:{outDir,emptyOutDir:true,rolldownOptions:{input:'index.html'}}});
 assert.deepEqual(report.hooks,{inspectEmbeddedArtwork:2,inspectEmbeddedLyrics:1,recoverLocalBatch:2,retryLocalBatch:2,previewOrganization:1,inspectOrganizationApply:1,startOrganizationRecovery:1},'exact hook build counts (shared modules also built in workers)');
 server=await preview({configFile:false,build:{outDir},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 async function start(){const ctx=await browser.newContext();ctx.setDefaultTimeout(12000);
  await ctx.route('**/*',r=>{if(r.request().url().startsWith(origin+'/')||r.request().url().startsWith('blob:'))return r.continue();report.externalRequests.push(r.request().url());return r.abort();});
  await ctx.addInitScript(()=>{
   window.gaps={audio:[],events:[],releases:{},locks:{}};const Native=Audio;window.Audio=class extends Native{constructor(...a){super(...a);window.gaps.audio.push(this);}};
   const NativeWorker=Worker;window.Worker=class extends NativeWorker{set onmessage(fn){super.onmessage=e=>{if(window.gaps.failBatch&&e.data?.type==='done'&&e.data?.jobId){const code=window.gaps.failBatch;window.gaps.failBatch=null;window.gaps.failedBatch=code;fn({data:{...e.data,type:'error',code}});return;}fn(e);};}};
   const bc=new BroadcastChannel('pulso-web:test:gaps-events');bc.onmessage=e=>window.gaps.events.push(e.data.key);
   Object.defineProperty(navigator,'serviceWorker',{value:{getRegistration:async()=>undefined,register:async()=>{throw new Error('Test Blob transport');}}});
  });
  const p=await ctx.newPage();current=p;p.on('pageerror',e=>report.pageErrors.push(e.stack));await p.goto(origin);await state(p,'con-control');await idle(p);
  await p.getByLabel('Importar audios',{exact:true}).setInputFiles('public/fixtures/A.wav');await idle(p);
  await click(p,'Preparar cola de esta selección');await p.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
  await p.evaluate(()=>{window.gaps.audio[0].loop=true;});await p.locator('#player').getByRole('button',{name:'Reproducir',exact:true}).click();await p.waitForFunction(()=>!window.gaps.audio[0].paused);
  return {ctx,p};
 }
 const state=(p,name)=>p.getByRole('status').filter({hasText:new RegExp(`^${name}$`)}).waitFor();
 const click=(p,name)=>p.getByRole('button',{name,exact:true}).click();
 const idle=p=>p.getByText('0 operaciones activas.',{exact:false}).waitFor();
 const locks=p=>p.evaluate(async()=>(await navigator.locks.query()).held.map(l=>l.name).filter(n=>n==='pulso-web:local:playback'||n.startsWith('pulso-web:local:owner:')).sort());
 const audio=p=>p.evaluate(()=>window.gaps.audio.map(a=>({src:a.src,paused:a.paused})));
 async function hold(p,key){await p.evaluate(async key=>{let ready;const started=new Promise(r=>ready=r);window.gaps.locks[key]=navigator.locks.request('pulso-web:test:'+key,()=>new Promise(r=>{window.gaps.releases[key]=r;ready();}));await started;},key);}
 async function release(p,key){await p.evaluate(async key=>{window.gaps.releases[key]();await window.gaps.locks[key];},key);}
 async function pending(p,key){await p.waitForFunction(async key=>(await navigator.locks.query()).pending.some(l=>l.name==='pulso-web:test:'+key),key);await p.waitForFunction(key=>window.gaps.events.includes(key),key);assert.equal(await p.evaluate(key=>window.gaps.events.filter(k=>k===key).length,key),1,`runtime hook once ${key}`);}
 async function denied(p,proof,sound){await click(p,'Ceder control');await p.getByRole('status').filter({hasText:'No se puede ceder:'}).waitFor();await state(p,'con-control');assert.deepEqual(await locks(p),proof);assert.deepEqual(await audio(p),sound);}
 async function available(p,proof,sound){await idle(p);await state(p,'con-control');assert.deepEqual(await locks(p),proof);assert.deepEqual(await audio(p),sound);}
 async function cede(p){await click(p,'Ceder control');await state(p,'sin-control');assert.deepEqual(await locks(p),[]);assert.equal((await audio(p))[0].paused,true);}
 async function snapshot(p){return p.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const rows=await new Promise((resolve,reject)=>{const tx=db.transaction(['tracks','assets','playlists','settings','jobs']);const requests=Object.fromEntries(['tracks','assets','playlists','settings','jobs'].map(n=>[n,tx.objectStore(n).getAll()]));const playback=tx.objectStore('settings').get('library-playback');tx.oncomplete=()=>resolve({...Object.fromEntries(Object.entries(requests).map(([n,r])=>[n,r.result])),playback:playback.result});tx.onabort=()=>reject(tx.error);});db.close();
  rows.bytes=[];for(const a of rows.assets){let bytes;if(a.backend==='opfs'){const root=await navigator.storage.getDirectory();const dir=await root.getDirectoryHandle('pulso-assets-v1');bytes=await(await(await dir.getFileHandle(a.storageKey)).getFile()).arrayBuffer();}else throw new Error('Unexpected backend: add actual IDB bytes reader');rows.bytes.push({id:a.id,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(''),length:bytes.byteLength});}return rows;
 });}
 const conserved=s=>({tracks:s.tracks,assets:s.assets,playlists:s.playlists,bytes:s.bytes,playback:s.playback});
 const pass=(name,details={})=>{report.cases.push({name,passed:true,...details});console.log('PASS '+name);};
 if(focus==='all'||focus==='extractors')for(const name of ['inspectEmbeddedArtwork','inspectEmbeddedLyrics']){
  const {ctx,p}=await start(),proof=await locks(p),prior=await snapshot(p);const beforeImportAudio=await audio(p);
  const cover=Buffer.from(await p.evaluate(async()=>{const c=document.createElement('canvas');c.width=8;c.height=6;c.getContext('2d').fillRect(0,0,8,6);return [...new Uint8Array(await(await new Promise(r=>c.toBlob(r,'image/png'))).arrayBuffer())];}));
  const raw=await readFile('public/fixtures/A.mp3');let offset=0;while(raw.subarray(offset,offset+3).toString()==='ID3')offset+=10+raw[offset+6]*2097152+raw[offset+7]*16384+raw[offset+8]*128+raw[offset+9];
  const sync=n=>Buffer.from([n>>>21&127,n>>>14&127,n>>>7&127,n&127]);const frame=(id,b)=>Buffer.concat([Buffer.from(id),sync(b.length),Buffer.alloc(2),b]);
  const text='Letra propia de la barrera '+name;const body=Buffer.concat([frame('USLT',Buffer.concat([Buffer.from([3]),Buffer.from('spa\0'+text)])),frame('APIC',Buffer.concat([Buffer.from([3]),Buffer.from('image/png\0'),Buffer.from([3,0]),cover]))]);
  const fixture=Buffer.concat([Buffer.from('ID3'),Buffer.from([4,0,0]),sync(body.length),body,raw.subarray(offset)]);
  // Seed import already called both extractors; measure this import only.
  await p.evaluate(()=>{window.gaps.events=[];});await hold(p,name+':before');
  await p.getByLabel('Importar audios',{exact:true}).setInputFiles({name:name+'.mp3',mimeType:'audio/mpeg',buffer:fixture});await pending(p,name+':before');
  const sound=await audio(p);assert.equal(sound.length,1);assert.equal(sound[0].src,beforeImportAudio[0].src);assert.equal(sound[0].paused,true); // Import intentionally pauses in main.tsx before worker admission.
  const mid=await snapshot(p);assert.equal(mid.jobs.filter(j=>j.state==='sealed').length,2);assert.equal(mid.assets.length,2);
  assert.equal(await p.evaluate(async()=>(await navigator.locks.query()).held.some(l=>l.name==='pulso-web:local:asset-writer')),false);
  await denied(p,proof,sound);await release(p,name+':before');await available(p,proof,sound);
  const final=await snapshot(p);assert.deepEqual(final.playback,mid.playback);assert.deepEqual({...mid.playback,position:prior.playback.position},prior.playback);assert.ok(Number.isFinite(mid.playback.position)&&mid.playback.position>=0);assert.equal(final.tracks.length,2);assert.equal(final.assets.length,2);assert.deepEqual(final.tracks.filter(t=>prior.tracks.some(x=>x.id===t.id)),prior.tracks);assert.deepEqual(final.assets.filter(a=>prior.assets.some(x=>x.id===a.id)),prior.assets);assert.deepEqual(final.bytes.filter(b=>prior.bytes.some(x=>x.id===b.id)),prior.bytes);assert.deepEqual(final.playlists,prior.playlists);
  assert.ok(final.bytes.some(b=>b.hash===createHash('sha256').update(fixture).digest('hex')&&b.length===fixture.length));
  const track=final.tracks.find(t=>t.title===name);assert.ok(track);const lyric=final.settings.find(v=>v?.trackId===track.id&&v?.provenance==='embedded');assert.equal(lyric?.text,text);const artwork=final.settings.find(v=>v?.trackId===track.id&&v?.provenance==='embedded-id3');assert.equal(artwork?.state,'ready');assert.equal(artwork.sha256,createHash('sha256').update(cover).digest('hex'));assert.equal(artwork.width,8);assert.equal(artwork.height,6);
  const row=p.locator('.tracks>li').filter({hasText:name});await row.scrollIntoViewIfNeeded();await row.locator('img').first().waitFor();await p.waitForFunction(title=>{const img=[...document.images].find(i=>i.alt==='Portada de '+title);return img?.complete&&img.naturalWidth===8&&img.naturalHeight===6;},name);
  assert.equal(await p.evaluate(n=>window.gaps.events.filter(k=>k===n+':after').length,name),1);await cede(p);pass(name+' entry blocks cession after sealed audio and free writer; actual USLT/APIC and bytes finish; explicit cession only');await ctx.close();
 }
 if(focus==='all'||focus==='batch'){
  const {ctx,p}=await start();await p.getByLabel('Nueva playlist',{exact:true}).fill('Lista barreras');await click(p,'Crear playlist');await idle(p);await p.getByLabel(/^Playlist de destino/).selectOption({label:'Lista barreras'});await click(p,'Añadir a playlist');await idle(p);await p.getByLabel(/^Vista/).selectOption({label:'Lista barreras'});await click(p,'Verificar copias');await idle(p);
  // Real completed snapshot becomes an abandoned verifier fixture, no live worker.
  await p.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1');r.onsuccess=()=>{const db=r.result,tx=db.transaction('settings','readwrite'),s=tx.objectStore('settings'),get=s.getAll(IDBKeyRange.bound('local-batch:v1:','local-batch:v1:\uffff'));get.onsuccess=()=>{const b=get.result[0];b.state='verifying';b.owner=crypto.randomUUID();b.operationId=crypto.randomUUID();b.revision++;s.put(b,'local-batch:v1:'+b.id);};tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};}));
  await click(p,'Actualizar historial');await p.getByRole('button',{name:'Revisar interrupción',exact:true}).waitFor();
  const proof=await locks(p),sound=await audio(p),prior=conserved(await snapshot(p));
  for(const [name,button,expected] of [['recoverLocalBatch','Revisar interrupción','interrupted'],['retryLocalBatch','Volver a verificar','queued']]){
   await hold(p,name+':before');await hold(p,name+':after');await click(p,button);await pending(p,name+':before');await denied(p,proof,sound);await release(p,name+':before');await pending(p,name+':after');
   assert.equal((await snapshot(p)).settings.find(v=>v?.namespace==='local'&&v?.entries)?.state,expected);await denied(p,proof,sound);await release(p,name+':after');await available(p,proof,sound);assert.deepEqual(conserved(await snapshot(p)),prior);pass(name+' blocks before effect and after durable effect before response; preserves organization/bytes/audio');
  }
  const final=(await snapshot(p)).settings.find(v=>v?.namespace==='local'&&v?.entries);assert.equal(final.state,'complete');assert.ok(final.entries.every(e=>e.state==='ready'));assert.equal(final.attempt,2);await cede(p);await ctx.close();
 }
 if(focus==='all'||focus==='batch'){
  // No injection: the r5 empty-playlist regression must really release both locks.
  const {ctx,p}=await start();await p.getByLabel('Nueva playlist',{exact:true}).fill('Vacía');await click(p,'Crear playlist');await idle(p);await p.getByLabel(/^Vista/).selectOption({label:'Vacía'});const prior=conserved(await snapshot(p));
  await click(p,'Verificar copias');await p.getByRole('status').filter({hasText:'La playlist está vacía.'}).waitFor();await click(p,'Actualizar historial');await idle(p);await p.getByText('No hay verificaciones guardadas.',{exact:true}).waitFor();assert.deepEqual(conserved(await snapshot(p)),prior);await cede(p);await click(p,'Comprobar disponible');await state(p,'con-control');await idle(p);assert.equal((await locks(p)).length,2);assert.equal((await audio(p)).length,1);assert.equal((await audio(p))[0].paused,true);pass('r5 real empty playlist rejects without uncertainty; history empty; explicit release frees both locks and reacquisition works');await ctx.close();
  for(const code of ['storage','worker']){
   const {ctx,p}=await start();await p.getByLabel('Nueva playlist',{exact:true}).fill('Fallo '+code);await click(p,'Crear playlist');await idle(p);await p.getByLabel(/^Playlist de destino/).selectOption({label:'Fallo '+code});await click(p,'Añadir a playlist');await idle(p);await p.getByLabel(/^Vista/).selectOption({label:'Fallo '+code});const proof=await locks(p),sound=await audio(p),prior=conserved(await snapshot(p));
   // Actual worker completes; inject a typed lost/failed response, preserving durable bytes.
   await p.evaluate(code=>{window.gaps.failBatch=code;},code);await click(p,'Verificar copias');await p.waitForFunction(code=>window.gaps.failedBatch===code,code);await p.getByRole('status').filter({hasText:'No se pudo terminar la verificación.'}).waitFor();await idle(p);await denied(p,proof,sound);await click(p,'Actualizar historial');await idle(p);await denied(p,proof,sound);
   // A subsequent confirmed domain rejection must not clear previous uncertainty.
   await p.getByLabel('Nueva playlist',{exact:true}).fill('Vacía después '+code);await click(p,'Crear playlist');await idle(p);await p.getByLabel(/^Vista/).selectOption({label:'Vacía después '+code});await click(p,'Verificar copias');await p.getByRole('status').filter({hasText:'La playlist está vacía.'}).waitFor();await idle(p);await denied(p,proof,sound);
   const now=await snapshot(p);assert.deepEqual(now.tracks,prior.tracks);assert.deepEqual(now.assets,prior.assets);assert.deepEqual(now.bytes,prior.bytes);assert.deepEqual(now.playback,prior.playback);assert.deepEqual(now.playlists.filter(p=>prior.playlists.some(x=>x.id===p.id)),prior.playlists);assert.equal(now.playlists.find(p=>p.name==='Vacía después '+code)?.entries.length,0);
   await click(p,'Volver a verificar');await idle(p);await available(p,proof,sound);await cede(p);pass(code+' injected worker response retains uncertainty through refresh and empty-domain rejection; explicit retry resolves and releases');await ctx.close();
  }
 }
 if(focus==='all'||focus==='backup'){
  const {ctx,p}=await start();const org=p.locator('details').filter({has:p.locator('summary').filter({hasText:/^Exportar e importar organización$/})});await org.locator('summary').click();await click(p,'Preparar exportación');await idle(p);const download=p.waitForEvent('download');await org.getByRole('link',{name:'Descargar organización',exact:true}).click();const json=await readFile(await(await download).path());
  let proof=await locks(p),sound=await audio(p),prior=conserved(await snapshot(p));
  await hold(p,'previewOrganization:before');await hold(p,'previewOrganization:after');await org.getByLabel('Importar organización',{exact:true}).setInputFiles({name:'propia.json',mimeType:'application/json',buffer:json});await pending(p,'previewOrganization:before');await denied(p,proof,sound);await release(p,'previewOrganization:before');await pending(p,'previewOrganization:after');await denied(p,proof,sound);await release(p,'previewOrganization:after');await available(p,proof,sound);await org.getByRole('button',{name:'Aplicar organización',exact:true}).waitFor();assert.deepEqual(conserved(await snapshot(p)),prior);pass('preview actual export blocks at entry and after real plan creation; never auto-applies or cedes');
  const foreign=randomUUID()+':'+randomUUID();await p.evaluate(id=>sessionStorage.setItem('pulso-web:organization:pending-operation',id),foreign);await p.reload();await state(p,'con-control');await p.locator('details').filter({has:p.locator('summary').filter({hasText:/^Exportar e importar organización$/})}).locator('summary').click();await p.evaluate(()=>{window.gaps.audio[0].loop=true;});await p.locator('#player').getByRole('button',{name:'Reproducir',exact:true}).click();await p.waitForFunction(()=>!window.gaps.audio[0].paused);proof=await locks(p);sound=await audio(p);prior=conserved(await snapshot(p));
  for(const [name,button] of [['inspectOrganizationApply','Comprobar resultado'],['startOrganizationRecovery','Confirmar abandono del seguimiento']]){
   if(name==='startOrganizationRecovery')await click(p,'Restaurar en este almacenamiento');
   await hold(p,name+':before');await hold(p,name+':after');await click(p,button);await pending(p,name+':before');await denied(p,proof,sound);await release(p,name+':before');await pending(p,name+':after');await denied(p,proof,sound);await release(p,name+':after');
   if(name==='inspectOrganizationApply'){await p.getByRole('button',{name:'Restaurar en este almacenamiento',exact:true}).waitFor();await denied(p,proof,sound);assert.equal(await p.evaluate(()=>sessionStorage.getItem('pulso-web:organization:pending-operation')),foreign);}
   else{await available(p,proof,sound);assert.equal(await p.evaluate(()=>sessionStorage.getItem('pulso-web:organization:pending-operation')),null);assert.deepEqual(await p.evaluate(()=>JSON.parse(sessionStorage.getItem('pulso-web:organization:unknown-history'))),[foreign]);assert.equal(await p.getByRole('button',{name:'Aplicar organización',exact:true}).count(),0);}
   assert.deepEqual(conserved(await snapshot(p)),prior);pass(name+' awaits before/after real API; unresolved inspection retains gate; explicit recovery archives unknown without replay');
  }
  await cede(p);await ctx.close();
 }
 assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.externalRequests,[]);assert.deepEqual(await hashes('dist'),before);report.distUnchanged=true;assert.equal(createHash('sha256').update(await readFile('tests/integration/check-handoff-ui.mjs')).digest('hex'),originalUIHash);report.originalRunnerUnchanged=true;report.passed=true;
}catch(error){report.failure=error.stack;if(current&&!current.isClosed()){report.status=await current.getByRole('status').allTextContents().catch(()=>[]);report.body=await current.locator('body').innerText().catch(()=>null);report.locks=await current.evaluate(()=>navigator.locks.query()).catch(()=>null);await current.screenshot({path:'.local/evidence/handoff-operation-gaps-failure.png',fullPage:true}).catch(()=>{});}process.exitCode=1;console.error(error);}
finally{await browser?.close();if(server)await new Promise(r=>server.httpServer.close(r));await writeFile(evidence,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
