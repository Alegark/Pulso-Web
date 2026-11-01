// Current product build, own synthetic fixtures/context, sandboxed Chromium, own loopback.
import assert from 'node:assert/strict';
import {build,preview} from 'vite';
import {chromium} from 'playwright-core';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {licenseGuard} from '../../scripts/third-party-notices.mjs';
const dir='.local/diagnostics-r7',evidence='.local/evidence/diagnostics-r7.json';
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
async function tree(path){const rows={};for(const e of await readdir(path,{withFileTypes:true})){const p=`${path}/${e.name}`;if(e.isDirectory())Object.assign(rows,await tree(p));else rows[p]=await hash(p);}return rows;}
await mkdir(dir,{recursive:true});
/** @type {{passed:boolean,cases:string[],attempts:unknown[],pageErrors:number,externalAttempts:number,limits:string[],isolatedBuild?:Record<string,string>,browser?:string,distUntouched?:boolean,failure?:{message:string,stack?:string},sources?:Record<string,string>,distBefore?:Record<string,string>}} */
const report={passed:false,cases:[],attempts:[],pageErrors:0,externalAttempts:0,limits:['Primer incremento FOUNDATION/UI/MAIN/PLAYER; no migración de 17 módulos.','Clasificación precisa writer/close/commit/asset-reader/worker-import/recovery y conexión de paneles batch/backup requieren otro incremento necesario.','DOM quota inyectada en frontera main; no demuestra causa precisa de writer.','Chromium desktop sandbox, fixture propia, loopback; sin iPhone, VoiceOver, zoom real, auth/Telegram/red externa, SDK, publicación ni aceptación global T18/P0.']};
try{const prior=JSON.parse(await readFile(evidence));report.attempts=[...(prior.attempts??[]),...(prior.failure?[{failure:prior.failure,cases:prior.cases}]:[])];}catch{}
const distBefore=await tree('dist');
/** @type {import('playwright-core').Browser|undefined} */ let browser;
/** @type {import('vite').PreviewServer|undefined} */ let server;
/** @type {import('playwright-core').BrowserContext|undefined} */ let context;
/** @type {import('playwright-core').Page|undefined} */ let page;
function pass(name){report.cases.push(name);console.log('PASS '+name);}
/** @param {import('playwright-core').Page} p */
const frames=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
/** @param {import('playwright-core').Page} p */
const run=(p,method,...args)=>p.evaluate(({method,args})=>window.r7[method](...args),{method,args});
/** @param {import('playwright-core').Page} p */
const idle=p=>p.waitForFunction(()=>window.r7.control.activity.count===0);
/** @param {import('playwright-core').Page} p */
const panel=p=>p.getByRole('region',{name:'Privacidad y diagnóstico local'});
/** @param {import('playwright-core').Page} p */
const enable=async p=>{await panel(p).getByLabel('Activar diagnóstico de esta sesión',{exact:true}).check();};
/** @param {import('playwright-core').Page} p */
const choose=async(p,fields)=>{for(const field of fields)await panel(p).getByRole('checkbox',{name:field,exact:true}).check();};
/** @param {import('playwright-core').Page} p */
const review=async p=>{const button=panel(p).getByRole('button',{name:'Revisar selección',exact:true});await button.focus();await p.keyboard.press('Enter');await panel(p).getByRole('heading',{name:'Revisión exacta del diagnóstico'}).waitFor();return panel(p).getByLabel('JSON revisado').innerText();};
/** @param {import('playwright-core').Page} p */
const count=p=>p.evaluate(()=>window.r7.diagnostics.getSnapshot().events.length);
function wav(){const rate=8000,seconds=90,n=rate*seconds,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/rate)*1000),44+i*2);return b;}
const file={name:'r7-private-canary-file.wav',mimeType:'audio/wav',buffer:wav()};
try{
 const outDir=`${dir}/build`;
 await build({configFile:false,logLevel:'error',plugins:[licenseGuard(),{name:'diagnostics-r7-main-boundaries-only',enforce:'pre',transform(code,id){
  if(!id.endsWith('/src/main.tsx'))return;
  assert.ok(code.includes("const nextTracks=(await all<Track>('tracks'))"));
  code=code.replace("const nextTracks=(await all<Track>('tracks'))","const nextTracks=(await window.r7IO('read',()=>all<Track>('tracks')))");
  code=code.replace("writes=writes.then(()=>writeRecord('settings','library-playback',saved))","writes=writes.then(()=>window.r7IO('write',()=>writeRecord('settings','library-playback',saved)))");
  return code.replace("createRoot(document.getElementById('root')!).render(<App/>);",`
window.r7={diagnostics,control,refresh,savePosition,queue,player,workerHandlers:()=>({message:worker?.onmessage===null,error:worker?.onerror===null}),
 state:()=>({src:audio.src,entries:player.entries.map(e=>e.id),position:audio.currentTime,paused:audio.paused,generation:player.generation,audios:window.r7Test.audios.length,calls:{...window.r7Test.calls}}),
 empty:()=>queue([]),read:()=>admitted('refresh-library',checkFiles),
 committed:()=>act(()=>createPlaylist('r7 private canary list')),
 workerError:()=>worker?.onerror?.(new Event('error')),
 clear:()=>diagnostics.clear()};createRoot(document.getElementById('root')!).render(<App/>);`);
 }}],worker:{plugins:()=>[licenseGuard()]},build:{outDir,emptyOutDir:true,rolldownOptions:{input:['index.html']}}});
 report.isolatedBuild=await tree(outDir);
 server=await preview({configFile:false,build:{outDir},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const address=server.httpServer.address();if(!address||typeof address==='string')throw Error('expected own loopback TCP address');
 const origin=`http://127.0.0.1:${address.port}`;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();
 context=await browser.newContext({serviceWorkers:'block',acceptDownloads:true,viewport:{width:1280,height:900}});
 await context.route('**/*',r=>{const url=r.request().url();if(url.startsWith(origin+'/')||url.startsWith('blob:'))return r.continue();report.externalAttempts++;return r.abort();});
 await context.addInitScript(()=>{
  window.r7Test={audios:[],calls:{play:0,pause:0,load:0},opens:0,io:{read:0,write:0},mode:{},created:0,revoked:0,active:new Set(),failURL:false,failClick:false,failBlob:false};
  const t=window.r7Test;
  window.r7IO=async(kind,work)=>{t.io[kind]++;const mode=t.mode[kind];if(mode==='quota')throw new DOMException('r7-private-canary-exception','QuotaExceededError');const value=await work();if(mode==='delay'){t.mode[kind]=null;await new Promise(resolve=>t.release=resolve);if(t.delayedFailure)throw new Error('r7-private-canary-error');}return value;};
  const open=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{t.opens++;return open(...args);};
  const NativeWorker=Worker;window.Worker=class extends NativeWorker{postMessage(message,...args){
   if(message?.type==='import'&&t.workerMode){const mode=t.workerMode;t.workerMode=null;const id=message.operationId;
    const finish=()=>{if(mode==='root')this.onerror?.(new ErrorEvent('error'));else this.onmessage?.(new MessageEvent('message',{data:{version:1,operationId:id,type:'error',code:mode==='quota'?'quota':'import-failed',error:'r7-private-canary-worker-error'}}));};
    if(mode==='delay')t.workerRelease=finish;else queueMicrotask(finish);return;
   }return super.postMessage(message,...args);
  }};
  const Native=Audio;window.Audio=class extends Native {constructor(...args){super(...args);t.audios.push(this);}play(){t.calls.play++;return super.play();}pause(){t.calls.pause++;super.pause();}load(){t.calls.load++;super.load();}};
  Object.defineProperty(navigator,'serviceWorker',{value:{getRegistration:async()=>undefined,register:async()=>{throw Error('own Blob fixture');}}});
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
  URL.createObjectURL=blob=>{if('type' in blob&&blob.type.startsWith('application/json')){if(t.failURL)throw Error('own URL failure');const u=create(blob);t.created++;t.active.add(u);return u;}return create(blob);};
  URL.revokeObjectURL=u=>{if(t.active.delete(u))t.revoked++;revoke(u);};
  const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download==='pulso-diagnostico.json'&&t.failClick)throw Error('own click failure');return click.call(this);};
  const BlobNative=Blob;window.Blob=class extends BlobNative{constructor(parts,options){if(options?.type?.startsWith('application/json')&&t.failBlob)throw Error('own blob failure');super(parts,options);}};
 });
 page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',()=>report.pageErrors++);
 await page.goto(origin);await page.waitForFunction(()=>window.r7?.control.owner);await idle(page);
 await page.getByText('Ajustes y límites de esta fase',{exact:true}).click();await panel(page).waitFor();await frames(page);
 assert.equal(await panel(page).getByLabel('Activar diagnóstico de esta sesión',{exact:true}).isChecked(),false);assert.equal(await count(page),0);
 const beforeOpen=await page.evaluate(()=>window.r7Test.opens);await choose(page,['mode']);const emptyReview=await review(page);await frames(page);assert.equal(await page.evaluate(()=>window.r7Test.opens),beforeOpen);assert.equal(await page.evaluate(()=>window.r7.control.activity.count),0);assert.equal(JSON.parse(emptyReview).datasets.limits.mode,'local');
 await panel(page).getByRole('button',{name:'Cancelar revisión',exact:true}).click();pass('default OFF; passive panel/field selection/review does zero extra IDB IO and holds no Activity');
 await enable(page);await run(page,'empty');assert.equal(await count(page),1);assert.equal(await page.evaluate(()=>window.r7.diagnostics.getSnapshot().events[0].code),'empty-selection');
 await choose(page,['Código','Fase']);const exact=await review(page);assert.equal(await panel(page).getByRole('heading',{name:'Revisión exacta del diagnóstico'}).evaluate(e=>e===document.activeElement),true);
 await run(page,'empty');assert.equal(await panel(page).getByLabel('JSON revisado').innerText(),exact);
 let downloadPromise=page.waitForEvent('download');await panel(page).getByRole('button',{name:'Descargar diagnóstico revisado',exact:true}).click();let download=await downloadPromise;assert.equal(download.suggestedFilename(),'pulso-diagnostico.json');assert.equal(await readFile(await download.path(),'utf8'),exact);await page.waitForFunction(()=>window.r7Test.active.size===0);pass('issued exact snapshot excludes later records; real fixed-name download bytes exactly equal reviewed JSON; URL revoked');
 await panel(page).getByRole('checkbox',{name:'Orden',exact:true}).check();assert.equal(await panel(page).getByLabel('JSON revisado').count(),0);
 await review(page);await page.keyboard.press('Escape');assert.equal(await panel(page).getByLabel('JSON revisado').count(),0);assert.equal(await panel(page).getByRole('button',{name:'Revisar selección',exact:true}).evaluate(e=>e===document.activeElement),true);
 await review(page);await page.keyboard.press('Tab');const focusAfterTab=await page.evaluate(()=>document.activeElement?.textContent);await run(page,'empty');await frames(page);assert.equal(await page.evaluate(()=>document.activeElement?.textContent),focusAfterTab);pass('selection invalidates review; Escape restores intentional focus; Tab/later error never steals focus');
 for(const fail of ['failBlob','failURL','failClick']){
  await page.evaluate(f=>window.r7Test[f]=true,fail);await panel(page).getByRole('button',{name:'Descargar diagnóstico revisado',exact:true}).click();await panel(page).getByRole('status').filter({hasText:'download-unavailable'}).waitFor();assert.equal(await page.evaluate(()=>window.r7Test.active.size),0);await page.evaluate(f=>window.r7Test[f]=false,fail);
 }
 downloadPromise=page.waitForEvent('download');await panel(page).getByRole('button',{name:'Descargar diagnóstico revisado',exact:true}).click();download=await downloadPromise;assert.equal(await readFile(await download.path(),'utf8'),await panel(page).getByLabel('JSON revisado').innerText());pass('Blob/URL/click failures preserve review, revoke partial URLs and allow explicit real retry');
 await panel(page).getByRole('button',{name:'Borrar registros (mantiene activación)',exact:true}).click();assert.equal(await count(page),0);assert.equal(await panel(page).getByLabel('JSON revisado').count(),0);assert.equal(await panel(page).getByRole('checkbox',{name:'Código',exact:true}).isChecked(),false);
 await page.getByLabel('Importar audios',{exact:true}).setInputFiles(file);await page.getByRole('status').filter({hasText:'1 importadas'}).waitFor();await idle(page);assert.equal(await count(page),0);
 const rows=page.locator('.tracks>li');assert.equal(await rows.count(),1);await rows.getByRole('button',{name:/^Escuchar /}).click();await page.getByRole('status').filter({hasText:'Cola lista y pausada'}).waitFor();await idle(page);
 await page.getByRole('button',{name:'Reproducir desde minirreproductor',exact:true}).click();await page.waitForFunction(()=>!window.r7.state().paused);
 const playing=await run(page,'state');
 await page.evaluate(()=>{window.r7Test.mode.write='quota';});
 for(let i=0;i<5;i++){await run(page,'savePosition');await idle(page);}assert.equal(await count(page),1);
 const event=await page.evaluate(()=>window.r7.diagnostics.getSnapshot().events[0]);assert.equal(event.operation,'save-position');assert.equal(event.phase,'write');assert.equal(event.family,'quota');assert.equal(event.code,'quota-exceeded');
 await page.evaluate(()=>{window.r7Test.mode.write=null;});await run(page,'savePosition');await idle(page);await page.evaluate(()=>{window.r7Test.mode.write='quota';});await run(page,'savePosition');await idle(page);assert.equal(await count(page),2);pass('real main DOM quota boundary classified; repeated failed position writes coalesce until confirmed successful persistence');
 await choose(page,['Código','Fase','Operación','Correlación']);const activeReview=await review(page);assert.equal(activeReview.includes('r7-private-canary'),false);assert.equal(JSON.stringify(await page.evaluate(()=>window.r7.diagnostics.getSnapshot())).includes('r7-private-canary'),false);
 downloadPromise=page.waitForEvent('download');await panel(page).getByRole('button',{name:'Descargar diagnóstico revisado',exact:true}).click();download=await downloadPromise;assert.equal(await readFile(await download.path(),'utf8'),activeReview);await panel(page).getByRole('button',{name:'Borrar registros (mantiene activación)',exact:true}).click();
 await page.waitForFunction(pos=>window.r7.state().position>pos+.5,playing.position);const afterPlaying=await run(page,'state');for(const k of ['src','entries','paused','generation','audios','calls'])assert.deepEqual(afterPlaying[k],playing[k]);assert.equal(afterPlaying.audios,1);pass('capture/review/real export/clear/save errors retain same Audio/source/queue/generation and progressing playhead, no extra engine calls; synthetic canaries absent');
 await page.evaluate(()=>{window.r7Test.mode.write=null;window.r7Test.mode.read='delay';});const readPromise=run(page,'read');await page.waitForFunction(()=>!!window.r7Test.release);
 await panel(page).getByLabel('Activar diagnóstico de esta sesión',{exact:true}).uncheck();await enable(page);
 await page.evaluate(()=>{window.r7Test.delayedFailure=true;window.r7Test.release();window.r7Test.release=null;});await readPromise;assert.equal(await count(page),0);await page.evaluate(()=>window.r7Test.delayedFailure=false);pass('old async refresh failure after consent OFF/ON cannot populate new epoch');
 await page.evaluate(()=>{window.r7Test.mode.read='quota';});await run(page,'committed');assert.equal(await page.getByRole('status').filter({hasText:'Cambios guardados.'}).count(),1);assert.equal(await page.evaluate(async()=>{const db=await new Promise(/** @param {(db:IDBDatabase)=>void} resolve */(resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const r=db.transaction('playlists').objectStore('playlists').count();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}}),1);await page.evaluate(()=>window.r7Test.mode.read=null);pass('confirmed organization write survives secondary refresh failure; useful safe status and real IDB commit retained');
 await run(page,'clear');await page.evaluate(()=>window.r7.control.activity.close());await run(page,'empty');assert.equal(await count(page),0);await choose(page,['mode']);await review(page);assert.equal(await page.evaluate(()=>window.r7.control.activity.count),0);await page.evaluate(()=>window.r7.control.activity.reopen());pass('closed admission rejects work; review remains available without asset ownership or Activity');
 const second=await context.newPage();second.on('pageerror',()=>report.pageErrors++);await second.goto(origin);await second.waitForFunction(()=>window.r7?.control.state==='sin-control');await second.getByRole('button',{name:'Solicitar control',exact:true}).click();await page.waitForFunction(()=>window.r7.control.requests.length===1);
 await idle(page);await page.getByRole('button',{name:'Ceder control',exact:true}).click();await second.waitForFunction(()=>window.r7.control.owner);assert.equal(await panel(page).getByLabel('Activar diagnóstico de esta sesión',{exact:true}).isChecked(),false);assert.equal(await count(page),0);assert.equal(await panel(page).getByLabel('JSON revisado').count(),0);assert.equal(await page.evaluate(()=>window.r7Test.active.size),0);assert.equal(await second.evaluate(()=>window.r7.state().paused),true);pass('real handoff succeeds with review open (no durable Activity), clears old session/URLs, new owner restores paused and capture OFF');
 await page.reload();await page.getByText('Ajustes y límites de esta fase',{exact:true}).click();assert.equal(await panel(page).getByLabel('Activar diagnóstico de esta sesión',{exact:true}).isChecked(),false);assert.equal(await count(page),0);
 await enable(page);await choose(page,['mode']);await review(page);downloadPromise=page.waitForEvent('download');await panel(page).getByRole('button',{name:'Descargar diagnóstico revisado',exact:true}).click();download=await downloadPromise;assert.equal(JSON.parse(await readFile(await download.path(),'utf8')).datasets.limits.mode,'local');pass('reload resets capture/records; nonowner can review/download current passive scope');
 // Finish extra error-boundary cases in the actual current owner's product tab.
 await second.getByText('Ajustes y límites de esta fase',{exact:true}).click();await enable(second);
 for(const [mode,code,family]of [['root','worker-failed','internal'],['legacy','unknown','internal'],['quota','quota-exceeded','quota']]){
  await run(second,'clear');await second.evaluate(mode=>window.r7Test.workerMode=mode,mode);
  await second.getByLabel('Importar audios',{exact:true}).setInputFiles(file);await idle(second);
  await second.waitForFunction(()=>window.r7.diagnostics.getSnapshot().events.length===1);
  const row=await second.evaluate(()=>window.r7.diagnostics.getSnapshot().events[0]);assert.equal(row.code,code);assert.equal(row.family,family);assert.equal(row.phase,'write');
  assert.equal((await second.getByRole('region',{name:'Importación'}).innerText()).includes('r7-private-canary-worker-error'),false);
  assert.deepEqual(await run(second,'workerHandlers'),mode==='root'?{message:false,error:false}:{message:true,error:true});
 }
 pass('actual root import onerror and closed legacy codes: worker-failed/quota known, generic import-failed unknown; no m.error UI/diagnostic exposure; handlers detached');
 await run(second,'clear');await second.evaluate(()=>window.r7Test.workerMode='delay');await second.getByLabel('Importar audios',{exact:true}).setInputFiles(file);await second.waitForFunction(()=>!!window.r7Test.workerRelease);
 const activeBefore=await second.evaluate(()=>window.r7.control.activity.count);await panel(second).getByRole('button',{name:'Borrar registros (mantiene activación)',exact:true}).click();assert.equal(await second.evaluate(()=>window.r7.control.activity.count),activeBefore);
 await second.evaluate(()=>{window.r7Test.workerRelease();window.r7Test.workerRelease=null;});await idle(second);assert.equal(await count(second),0);pass('record clear preserves pending operation/loading/activity; delayed worker outcome from old epoch is excluded');
 // Real IDB relation with no bytes: legacy reader/null gives no trustworthy integrity/quota cause.
 await run(second,'clear');await second.evaluate(async()=>{
  const db=await new Promise(/** @param {(db:IDBDatabase)=>void} resolve */(resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{await new Promise((resolve,reject)=>{const tx=db.transaction('tracks','readwrite'),store=tx.objectStore('tracks'),r=store.getAll();r.onsuccess=()=>{const track=r.result[0];track.assetId=null;store.put(track,track.id);};tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}finally{db.close();}
 });await run(second,'read');await second.locator('.tracks>li').getByRole('button',{name:/^Escuchar /}).click();await idle(second);
 const legacyRow=await second.evaluate(()=>window.r7.diagnostics.getSnapshot().events.at(-1));assert.equal(legacyRow.operation,'prepare-queue');assert.equal(legacyRow.phase,'read');assert.equal(legacyRow.family,'internal');assert.equal(legacyRow.code,'unknown');pass('actual IDB missing-byte relation remains internal/unknown at queue read; no invented quota/integrity from legacy false/null');
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await frames(page);assert.equal(await page.evaluate(()=>window.r7.diagnostics.getSnapshot().enabled),false);assert.equal(await count(page),0);assert.equal(await panel(page).getByLabel('JSON revisado').count(),0);assert.equal(await page.evaluate(()=>window.r7Test.active.size),0);pass('pagehide immediately invalidates review/handles/URLs and disables capture (synthetic lifecycle event, not BFCache claim)');
 assert.equal(report.pageErrors,0);assert.equal(report.externalAttempts,0);assert.deepEqual(await tree('dist'),distBefore);report.distUntouched=true;report.passed=true;
}catch(error){report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 await browser?.close();if(server)await new Promise(r=>server.httpServer.close(r));
 report.sources=Object.fromEntries(await Promise.all(['src/diagnostics/contract.ts','src/diagnostics/session.ts','src/diagnostics/export.ts','src/ui/DiagnosticsPanel.tsx','src/ui/diagnostics.css','src/main.tsx','src/playback/player.ts','tests/unit/diagnostics.test.ts','tests/unit/player.test.ts','tests/integration/check-diagnostics-ui.mjs'].map(async p=>[p,await hash(p)])));
 report.distBefore=distBefore;await mkdir('.local/evidence',{recursive:true});await writeFile(evidence,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,failure:report.failure,evidence}));
}
