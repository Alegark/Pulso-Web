// Isolated production builds only. Chromium sandbox, ephemeral loopback, no external requests.
// Run: INSTABOX_HEADLESS=1 node tests/integration/check-handoff-ui.mjs
import assert from 'node:assert/strict';
import {build,preview} from 'vite';
import {chromium} from 'playwright-core';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const focus=process.env.PULSO_HANDOFF_FOCUS??'all';
const outDir=`.local/t13-handoff-product-${focus}`;
const report={passed:false,environment:'Chromium Linux, sandbox enabled, own contexts and loopback, isolated build',iphoneVerified:false,cases:[],limitations:['No physical iPhone or real background shutdown guarantee','Existing authorized response streams may finish; no per-chunk revocation promised']};
let browser,server;
await mkdir('.local/evidence',{recursive:true});
const distBefore=await hashes('dist');
async function hashes(dir){const entries=await readdir(dir,{withFileTypes:true});const result={};for(const entry of entries){const path=`${dir}/${entry.name}`;if(entry.isDirectory())Object.assign(result,await hashes(path));else result[path]=createHash('sha256').update(await readFile(path)).digest('hex');}return result;}
try{
 await build({configFile:false,build:{outDir,emptyOutDir:true,rolldownOptions:{input:'index.html'}}});
 const files=['/','/index.html',...(await readdir(`${outDir}/assets`)).map(name=>`/assets/${name}`)];
 await build({configFile:false,define:{SHELL_FILES:JSON.stringify(files)},build:{emptyOutDir:false,outDir,lib:{entry:'src/service-worker/sw.ts',formats:['es'],fileName:()=> 'sw.js'}}});
 server=await preview({configFile:false,build:{outDir},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 const errors=[],outside=[];
 async function context(options={}){
  const ctx=await browser.newContext();ctx.setDefaultTimeout(12000);await ctx.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin)||url.startsWith('blob:'))return route.continue();outside.push(url);return route.abort();});
  await ctx.addInitScript(({noLocks,noBC,blob})=>{
   window.t13={audio:[],sent:[],received:[],released:[],held:[],media:[],ends:[],holdWorker:false,workerDone:[],holdBlob:false,blobDone:[],saveFail:false,loseAck:false,blockOpen:false,holdCommit:false,commitDone:[],holdTransport:false,transportDone:[],holdACK:false,ackDone:[],cancelBatchOnProgress:false,workerResults:[]};
   const nativeAudio=Audio;window.Audio=function(...args){const a=new nativeAudio(...args);window.t13.audio.push(a);return a;};window.Audio.prototype=nativeAudio.prototype;
   const add=HTMLMediaElement.prototype.addEventListener;HTMLMediaElement.prototype.addEventListener=function(type,fn,...args){if(type==='ended')window.t13.ends.push(fn);return add.call(this,type,fn,...args);};
   if(navigator.mediaSession){const handler=navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);navigator.mediaSession.setActionHandler=(name,fn)=>{if(fn)window.t13.media.push([name,fn]);return handler(name,fn);};}
   const query=navigator.locks?.query.bind(navigator.locks);if(query)navigator.locks.query=async()=>{const result=await query();if(window.t13.holdTransport)await new Promise(r=>window.t13.transportDone.push(r));return result;};
   if(noLocks)Object.defineProperty(navigator,'locks',{value:undefined});
   if(noBC)Object.defineProperty(window,'BroadcastChannel',{value:undefined});
   else{const BC=BroadcastChannel;window.BroadcastChannel=class extends BC{postMessage(m){window.t13.sent.push(m);return super.postMessage(m);}set onmessage(fn){super.onmessage=async e=>{window.t13.received.push({message:e.data,locks:(await navigator.locks.query()).held.map(l=>l.name)});if(window.t13.holdACK&&e.data?.type==='released')window.t13.ackDone.push(()=>fn(e));else fn(e);};}};}
   if(blob)Object.defineProperty(navigator,'serviceWorker',{value:{getRegistration:async()=>{if(window.t13.holdTransport)await new Promise(r=>window.t13.transportDone.push(r));return undefined;},register:async()=>{throw new Error('Synthetic unsupported SW');}}});
   const WorkerNative=Worker;window.Worker=class extends WorkerNative{set onmessage(fn){super.onmessage=e=>{if(window.t13.cancelBatchOnProgress&&e.data?.type==='progress'&&e.data.jobId){const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Cancelar verificación');if(button){window.t13.cancelBatchOnProgress=false;button.click();}}if(window.t13.holdWorker&&['complete','result','done','error'].includes(e.data?.type)){window.t13.workerResults.push(e.data);window.t13.workerDone.push(()=>fn(e));return;}if(window.t13.holdACK&&e.data?.type==='released')window.t13.ackDone.push(()=>fn(e));else fn(e);};}};
   const arrayBuffer=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=async function(){const result=await arrayBuffer.call(this);if(window.t13.holdBlob)await new Promise(r=>window.t13.blobDone.push(r));return result;};
   const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(window.t13.saveFail&&this.name==='settings'&&args[1]==='library-playback')throw new DOMException('Synthetic persist failure','QuotaExceededError');return put.apply(this,args);};
   const open=IDBFactory.prototype.open;IDBFactory.prototype.open=function(...args){if(window.t13.blockOpen)throw new Error('Synthetic unavailable reopen');return open.apply(this,args);};
   const descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(callback){const tx=this;descriptor.set.call(tx,tx.mode==='readwrite'?function(event){if(window.t13.holdCommit){window.t13.commitDone.push(()=>callback?.call(tx,event));return;}if(window.t13.loseAck&&tx.objectStoreNames.contains('tracks')){window.t13.loseAck=false;window.t13.blockOpen=true;tx.onabort?.call(tx,new Event('abort'));}else callback?.call(tx,event);}:callback);}});
  },options);return ctx;
 }
 async function page(ctx){const p=await ctx.newPage();p.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR '+e.message);});await p.goto(origin);await p.bringToFront();return p;}
 const state=(p,name)=>p.getByRole('status').filter({hasText:new RegExp(`^${name}$`)}).waitFor();
 const click=async(p,name)=>{await p.bringToFront();await p.getByRole('button',{name,exact:true}).click();};
 const waitIdle=p=>p.getByText('0 operaciones activas.',{exact:false}).waitFor();
 async function cede(p){await waitIdle(p);await click(p,'Ceder control');await state(p,'sin-control');}
 async function proof(p){return p.evaluate(async()=>(await navigator.locks.query()).held.filter(l=>l.name.startsWith('pulso-web:local:owner:')).map(l=>l.name));}
 async function audio(p){return p.evaluate(()=>window.t13.audio.map(a=>({paused:a.paused,time:a.currentTime,src:a.src})));}
 async function snap(p){return p.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('settings'),g=tx.objectStore('settings').get('library-playback');tx.oncomplete=()=>{db.close();resolve(g.result);};};}));}
 const pass=name=>{report.cases.push({name,passed:true});console.log('PASS '+name);};
 if(focus!=='activity'){
 const ctx=await context();const a=await page(ctx);await state(a,'con-control');
 await a.getByLabel('Importar audios',{exact:true}).setInputFiles(['public/samples/Aurora.mp3','public/samples/Brisa.m4a']);
 await a.getByRole('status').filter({hasText:'2 importadas'}).waitFor();
 await click(a,'Preparar cola de esta selección');await a.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
 await a.waitForFunction(()=>window.t13.audio[0].readyState>=1);await a.locator('#player').getByRole('button',{name:'Reproducir',exact:true}).click();await a.waitForFunction(()=>!window.t13.audio[0].paused);
 const oldTicket=(await audio(a))[0].src,firstProof=await proof(a);
 const b=await page(ctx);await state(b,'sin-control');await click(b,'Solicitar control');await a.getByText('1 pestañas solicitan',{exact:false}).waitFor();
 assert.equal((await audio(a))[0].paused,false);await click(a,'Conservar control');await state(b,'sin-control');assert.equal((await audio(a))[0].paused,false);
 pass('request/rejection do not pause owner; requester remains blocked');
 await click(b,'Solicitar control');await a.getByText('1 pestañas solicitan',{exact:false}).waitFor();await b.waitForTimeout(100);assert.equal(await b.getByRole('button',{name:'Ceder control',exact:true}).count(),0);
 pass('silence keeps requester blocked without timeout takeover');
 await b.evaluate(()=>{const req=window.t13.sent.at(-1),bc=new BroadcastChannel('pulso-web:local:handoff:v1');bc.postMessage({version:1,type:'released',tabId:req.tabId,requestId:'forged',sender:'forged'});bc.postMessage({...req,type:'released',sender:'forged'});bc.close();});
 await b.waitForTimeout(100);await state(b,'sin-control');assert.equal((await audio(a))[0].paused,false);assert.deepEqual(await proof(a),firstProof);
 pass('forged/stale ACK cannot grant ownership while real lock is held');
 // A fake ACK consumed this request: send a new real request.
 await click(b,'Solicitar control');await a.getByText('2 pestañas solicitan',{exact:false}).waitFor();await a.bringToFront();
 await a.locator('#player').getByLabel('Repetición',{exact:false}).selectOption('all');await a.locator('#player').getByRole('button',{name:'Aleatorio',exact:true}).click();
 await a.locator('#player').getByLabel('Posición en segundos',{exact:true}).fill('2');
 await cede(a);await state(b,'con-control');await b.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
 assert.equal((await audio(a))[0].paused,true);assert.ok((await audio(a))[0].src===origin+'/'||(await audio(a))[0].src==='');assert.equal((await audio(b))[0].paused,true);
 await b.waitForFunction(()=>window.t13.audio[0].currentTime>=1.9);const stored=await snap(b);assert.equal(stored.repeat,'all');assert.equal(stored.entries.length,2);assert.equal(stored.shuffleOrder.length,2);
 assert.notDeepEqual(await proof(b),firstProof);
 const released=await b.evaluate(()=>window.t13.received.filter(r=>r.message.type==='released'&&r.message.sender!=='forged'));
 assert.ok(released.length);assert.ok(released.every(r=>!r.locks.includes('pulso-web:local:playback')&&!r.locks.some(n=>n.startsWith('pulso-web:local:owner:'))));
 assert.equal(await a.evaluate(async ticket=>(await fetch(ticket,{headers:{Range:'bytes=0-1'}})).status,oldTicket),403);
 pass('handoff unloads old audio; ACK follows actual lock release; new owner restores position/modes paused; old ticket 403');
 await click(a,'Solicitar control');await b.getByText('1 pestañas solicitan',{exact:false}).waitFor();await cede(b);await state(a,'con-control');await a.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();assert.notDeepEqual(await proof(a),firstProof);
 assert.equal(await a.evaluate(async ticket=>(await fetch(ticket,{headers:{Range:'bytes=0-1'}})).status,oldTicket),403);
 await a.evaluate(()=>{const before=window.t13.audio[0].src;window.t13.ends.forEach(fn=>fn(new Event('ended')));window.t13.media.slice(0,5).forEach(([name,fn])=>fn({action:name,seekTime:9}));if(window.t13.audio[0].src!==before)throw new Error('stale callback changed source');});assert.equal((await audio(a))[0].paused,true);
 pass('same tab reacquires with fresh proof; old ticket and old ended/MediaSession callbacks remain revoked');
 // Two real requesters contend for a single actual lock.
 const c=await page(ctx);await state(c,'sin-control');await click(b,'Solicitar control');await click(c,'Solicitar control');await a.getByText('2 pestañas solicitan',{exact:false}).waitFor();await cede(a);
 await a.waitForTimeout(200);const owners=await Promise.all([b,c].map(p=>p.getByRole('button',{name:'Ceder control',exact:true}).count()));assert.equal(owners.reduce((x,y)=>x+y,0),1);
 const winner=owners[0]?b:c,loser=owners[0]?c:b;await state(loser,'sin-control');
 pass('two requesters produce exactly one owner, loser stays blocked');
 // Position write failure must retain both real locks and the original snapshot.
 const prior=await snap(winner);await winner.evaluate(()=>{window.t13.saveFail=true;});await waitIdle(winner);await click(winner,'Ceder control');await winner.getByRole('status').filter({hasText:'No se pudo guardar la cola.'}).waitFor();await state(winner,'con-control');assert.equal((await proof(winner)).length,1);assert.deepEqual(await snap(winner),prior);
 await winner.evaluate(()=>{window.t13.saveFail=false;});await cede(winner);pass('failed persistence retains real locks and queue snapshot; explicit retry releases');

 // A fresh third tab can acquire before a delayed, real ACK is delivered.
 await b.close();await c.close();await click(a,'Comprobar disponible');await state(a,'con-control');await a.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
 const requester=await page(ctx);await state(requester,'sin-control');const contender=await page(ctx);await state(contender,'sin-control');
 await requester.evaluate(()=>{window.t13.holdACK=true;});await click(requester,'Solicitar control');await a.getByText('1 pestañas solicitan',{exact:false}).waitFor();await cede(a);await requester.waitForFunction(()=>window.t13.ackDone.length>0);
 await click(contender,'Comprobar disponible');await state(contender,'con-control');await requester.bringToFront();await requester.evaluate(()=>{window.t13.holdACK=false;window.t13.ackDone.splice(0).forEach(fn=>fn());});await requester.waitForTimeout(100);await state(requester,'sin-control');
 pass('third tab can win the real lock before delayed ACK; ACK recipient remains blocked');
 await contender.close();if(await requester.getByRole('button',{name:'Comprobar disponible',exact:true}).count())await click(requester,'Comprobar disponible');await state(requester,'con-control');assert.equal((await audio(requester))[0].paused,true);pass('closing owner permits a real availability check and paused restore');
 await ctx.close();
 // Missing capabilities and manual path.
 const noLocks=await context({noLocks:true});const nl=await page(noLocks);await nl.getByRole('status').filter({hasText:'no dispone de Web Locks'}).waitFor();assert.equal(await nl.getByLabel('Importar audios',{exact:true}).isDisabled(),true);assert.equal(await nl.getByRole('button',{name:'Preparar exportación',exact:true,includeHidden:true}).isDisabled(),true);await noLocks.close();pass('without Web Locks playback, import, settings and export mutations stay blocked');
 const manual=await context({noBC:true,blob:true});const ma=await page(manual);await state(ma,'con-control');const mb=await page(manual);await state(mb,'sin-control');assert.equal(await mb.getByRole('button',{name:'Solicitar control',exact:true}).isDisabled(),true);await cede(ma);await click(mb,'Comprobar disponible');await state(mb,'con-control');await manual.close();pass('without BroadcastChannel manual release and real availability check work');

 }
 const ops=await context({blob:true});const op=await page(ops);await state(op,'con-control');
 const deny=async()=>{await click(op,'Ceder control');await op.getByRole('status').filter({hasText:'No se puede ceder:'}).waitFor();await state(op,'con-control');assert.equal((await proof(op)).length,1);};
 await op.evaluate(()=>{window.t13.holdWorker=true;});const wav=Buffer.alloc(44+4*1024*1024);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(32000,24);wav.writeUInt32LE(64000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=44;i<wav.length;i+=2)wav.writeInt16LE(Math.round(Math.sin((i-44)/2*440*2*Math.PI/32000)*1000),i);
 await op.getByLabel('Importar audios',{exact:true}).setInputFiles({name:'Sintetica.wav',mimeType:'audio/wav',buffer:wav});await op.waitForFunction(()=>window.t13.workerDone.length>0);
 assert.equal(await op.evaluate(async()=>(await navigator.locks.query()).held.some(l=>l.name.includes('asset-writer'))),false);
 await deny();await click(op,'Cancelar importación');await deny();await op.evaluate(()=>{window.t13.holdWorker=false;window.t13.workerDone.splice(0).forEach(fn=>fn());});await waitIdle(op);
 pass('full import remains active beyond writer lock, including optional result and cancellation acknowledgement');
 await click(op,'Preparar cola de esta selección');await op.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
 await op.getByText('Letras locales',{exact:true}).click();await op.getByRole('button',{name:'Guardar letras',exact:true}).waitFor();
 await op.evaluate(()=>{window.t13.holdBlob=true;});await op.getByLabel('Importar archivo .txt o .lrc',{exact:false}).setInputFiles({name:'local.txt',mimeType:'text/plain',buffer:Buffer.from('Letra propia sintética')});await op.waitForFunction(()=>window.t13.blobDone.length>0);await deny();await op.evaluate(()=>{window.t13.holdBlob=false;window.t13.blobDone.splice(0).forEach(fn=>fn());});await waitIdle(op);
 await op.evaluate(()=>{window.t13.holdCommit=true;});await click(op,'Guardar letras');await op.waitForFunction(()=>window.t13.commitDone.length>0);await deny();await op.evaluate(()=>{window.t13.holdCommit=false;window.t13.commitDone.splice(0).forEach(fn=>fn());});await waitIdle(op);
 pass('lyrics file read and pending lyrics persistence block cession until completion');
 const artwork=op.locator('.tracks .artwork-panel').first();await artwork.locator('summary').click();await artwork.getByRole('button',{name:'Ocultar portada',exact:true}).waitFor();
 await op.evaluate(()=>{window.t13.holdCommit=true;});await artwork.getByRole('button',{name:'Ocultar portada',exact:true}).click();await op.waitForFunction(()=>window.t13.commitDone.length>0);await deny();await op.evaluate(()=>{window.t13.holdCommit=false;window.t13.commitDone.splice(0).forEach(fn=>fn());});await waitIdle(op);
 pass('pending artwork persistence blocks cession');
 await op.getByLabel('Nueva playlist',{exact:true}).fill('Lista local');await click(op,'Crear playlist');await waitIdle(op);await op.getByLabel(/^Playlist de destino/).selectOption({label:'Lista local'});await click(op,'Añadir a playlist');await waitIdle(op);await op.getByLabel(/^Vista/).selectOption({label:'Lista local'});
 await op.evaluate(()=>{window.t13.holdWorker=true;window.t13.cancelBatchOnProgress=true;});await click(op,'Verificar copias');await op.waitForFunction(()=>window.t13.workerDone.length>0);assert.equal(await op.evaluate(()=>window.t13.workerResults.at(-1)?.batch?.state),'cancelled');await deny();await op.evaluate(()=>{window.t13.holdWorker=false;window.t13.workerDone.splice(0).forEach(fn=>fn());});await waitIdle(op);await cede(op);await click(op,'Comprobar disponible');await state(op,'con-control');await op.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
 pass('batch cancellation awaits actual terminal result; no automatic cession after completion');
 const org=op.locator('details').filter({has:op.locator('summary').filter({hasText:/^Exportar e importar organización$/})});await org.locator('summary').click();
 await op.evaluate(()=>{window.t13.holdCommit=true;});await click(op,'Preparar exportación');await op.waitForFunction(()=>window.t13.commitDone.length>0);await deny();await op.evaluate(()=>{window.t13.holdCommit=false;window.t13.commitDone.splice(0).forEach(fn=>fn());});await waitIdle(op);
 const downloadPromise=op.waitForEvent('download');await org.getByRole('link',{name:'Descargar organización',exact:true}).click();const exported=await readFile(await(await downloadPromise).path(),'utf8');
 await org.getByLabel('Importar organización',{exact:true}).setInputFiles({name:'organization.json',mimeType:'application/json',buffer:Buffer.from(exported)});await org.getByRole('button',{name:'Aplicar organización',exact:true}).waitFor();await click(op,'Aplicar organización');await deny();await click(op,'Volver');
 // Apply a real transaction but lose its completion and make re-opening unavailable.
 await click(op,'Aplicar organización');await op.evaluate(()=>{window.t13.loseAck=true;});await click(op,'Confirmar restauración');await org.getByRole('button',{name:'Comprobar resultado',exact:true}).waitFor();await deny();await op.evaluate(()=>{window.t13.blockOpen=false;});await click(op,'Comprobar resultado');await waitIdle(op);
 pass('export identity write, backup confirmation and uncertain apply block cession; inspection resolves real commit');
 await op.locator('#player').getByRole('button',{name:'Reproducir',exact:true}).click();await op.waitForFunction(()=>!window.t13.audio[0].paused);const beforeRefresh=(await audio(op))[0].src;
 // Repeat the backup roundtrip with active audio: onCommitted keeps queue titles and src.
 await org.getByLabel('Importar organización',{exact:true}).setInputFiles({name:'organization.json',mimeType:'application/json',buffer:Buffer.from(exported)});await org.getByRole('button',{name:'Aplicar organización',exact:true}).waitFor();await click(op,'Aplicar organización');await click(op,'Confirmar restauración');await waitIdle(op);assert.equal((await audio(op))[0].src,beforeRefresh);assert.equal((await audio(op))[0].paused,false);
 pass('backup commit refresh(true,false) preserves active audio source and independent queue');
 await op.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});assert.equal((await audio(op))[0].paused,false);await waitIdle(op);
 pass('visibility hidden saves position without pausing or releasing ownership');
 await op.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await state(op,'sin-control');assert.equal((await audio(op))[0].paused,true);await op.waitForFunction(async()=>(await navigator.locks.query()).held.every(l=>!l.name.startsWith('pulso-web:local:owner:')));
 await op.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await state(op,'sin-control');await click(op,'Comprobar disponible');await state(op,'con-control');await op.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();assert.equal((await audio(op))[0].paused,true);
 assert.equal(await op.locator('section[aria-labelledby=local-batch-heading]').count(),1);assert.equal(await org.count(),1);assert.equal((await audio(op)).length,1);
 pass('synthetic persisted pagehide unloads synchronously; persisted pageshow requires real reacquisition without autoplay');
 report.limitations.push('BFCache lifecycle handlers tested with synthetic persisted events, not a browser-confirmed BFCache restore');

 await op.evaluate(()=>{window.t13.holdTransport=true;});await click(op,'Preparar cola de esta selección');await op.waitForFunction(()=>window.t13.transportDone.length>0);
 await op.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await state(op,'sin-control');await op.evaluate(()=>{window.t13.holdTransport=false;window.t13.transportDone.splice(0).forEach(fn=>fn());});await op.waitForTimeout(100);assert.equal((await audio(op))[0].paused,true);assert.ok((await audio(op))[0].src===origin+'/'||(await audio(op))[0].src==='');
 pass('late transport response after pagehide cannot install a source or resume audio');
 report.limitations.push('Pagehide with an active/uncertain operation retains locks conservatively: close that entry to recover, no automatic release after completion');
 report.limitations.push('Importer test holds its final worker response after writer completion; separate delayed embedded-metadata subphase not injected');
 await ops.close();
 assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);assert.deepEqual(await hashes('dist'),distBefore);report.distUnchanged=true;report.passed=true;
} catch(error){report.failure=error.stack;throw error;}
finally{await browser?.close();if(server)await new Promise(r=>server.httpServer.close(r));await writeFile(`.local/evidence/t13-handoff-${focus}-ui.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
