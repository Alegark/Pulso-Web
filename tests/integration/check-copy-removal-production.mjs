// Production build only; native APIs, own synthetic audio and fresh contexts.
// The optional private smoke reads the existing invitation internally and never
// prints its URL, cookies, request paths, raw navigation errors or audio tickets.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {preview} from 'vite';
import {chromium} from 'playwright-core';

const privateMode=process.env.PULSO_REMOVAL_PRIVATE==='1';
const report={passed:false,privateMode,iphoneVerified:false,cases:[],errors:[],externalRequests:0,csp:[],cleanup:{},limits:['Own synthetic files in fresh desktop Chromium contexts; no owner library','No private offline, iPhone, physical erase or heap acceptance','Uncontrolled Service Worker transport must deny removal; it is not a fallback permission']};
const hash=b=>createHash('sha256').update(b).digest('hex');
let browser,server,context,stage='setup';
function wav(salt){const samples=8000*45,b=Buffer.alloc(44+samples*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(i*(.11+salt*.013))*2400),44+i*2);return b;}
function observe(){
 window.removalSmoke={audio:[],calls:[]};const Native=Audio;
 window.Audio=class extends Native{constructor(...args){super(...args);removalSmoke.audio.push(this);for(const name of ['play','pause','load']){const fn=this[name].bind(this);this[name]=(...a)=>{removalSmoke.calls.push(name);return fn(...a);};}}};
}
async function readLibrary(page){return page.evaluate(()=>new Promise((resolve,reject)=>{
 const req=indexedDB.open('pulso-web-local-v1');req.onerror=()=>reject(req.error);
 req.onsuccess=()=>{const db=req.result,tx=db.transaction([...db.objectStoreNames]),out={};
 for(const name of db.objectStoreNames){const keys=tx.objectStore(name).getAllKeys(),values=tx.objectStore(name).getAll();values.onsuccess=()=>{out[name]=values.result.map((value,i)=>({key:keys.result[i],value}));};}
 tx.oncomplete=()=>{db.close();resolve(out);};tx.onabort=()=>{db.close();reject(tx.error);};};
}));}
async function idle(page){await page.waitForFunction(()=>[...document.querySelectorAll('section[aria-label="Control de esta pestaña"] p')].some(p=>p.textContent?.startsWith('0 operaciones activas.')));}
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const stable=r=>({tracks:r.tracks,assets:r.assets,chunks:r.chunks,playlists:r.playlists,settings:r.settings.filter(x=>x.key!=='library-playback')});
try{
 report.entry='/releases/'+hash(await readFile('dist/index.html')).slice(0,16)+'.html';
 let address;
 if(privateMode){const access=JSON.parse(await readFile('.local/review/private-access.json','utf8'));address=new URL(access.tokenUrl);address.pathname='/open.html';}
 else{server=await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,strictPort:true}});address=new URL(`http://127.0.0.1:${server.httpServer.address().port}/open.html`);}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 for(const mode of privateMode?['actual-private']:['native-sw','native-uncontrolled']){
  stage=mode+':startup';context=await browser.newContext();context.setDefaultTimeout(15000);await context.addInitScript(observe);
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push({stage,name:error.name}));
  page.on('request',request=>{const u=new URL(request.url());if(u.origin!==address.origin&&!['blob:','data:'].includes(u.protocol))++report.externalRequests;});
  await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',e=>{window.removalSmokeCSP??=[];removalSmokeCSP.push(e.violatedDirective);}));
  await page.goto(address.href);await page.waitForFunction(()=>{const i=document.querySelector('input[aria-label="Importar audios"]');return i&&!i.disabled;});
  assert.equal(new URL(page.url()).pathname,report.entry);assert.equal(new URL(page.url()).searchParams.has('_token'),false);
  assert.equal((await readLibrary(page)).tracks.length,0);
  const files=[0,1].map(i=>({name:`Entrega-${i?'B':'A'}.wav`,mimeType:'audio/wav',buffer:wav(i)}));
  stage=mode+':import';await page.getByLabel('Importar audios',{exact:true}).setInputFiles(files);await page.getByRole('status').filter({hasText:'2 importadas, 0 ya existentes.'}).waitFor();
  for(const title of ['Entrega-A','Entrega-B']){const row=page.locator('ol.tracks>li').filter({has:button(page,'Escuchar '+title)});await row.scrollIntoViewIfNeeded();await row.getByText('Sin portada incrustada',{exact:true}).waitFor();}
  await idle(page);const player=page.locator('#player');
  if(mode!=='native-uncontrolled'){stage=mode+':playing';await button(page,'Escuchar Entrega-A').click();await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();await player.getByLabel(/Repetición/).selectOption('one');await player.getByRole('button',{name:'Reproducir',exact:true}).click();await page.waitForFunction(()=>removalSmoke.audio.length===1&&!removalSmoke.audio[0].paused&&removalSmoke.audio[0].currentTime>.05);}
  const controlled=await page.evaluate(()=>!!navigator.serviceWorker?.controller);if(mode==='native-sw')assert.equal(controlled,true);if(mode==='native-uncontrolled')assert.equal(controlled,false);
  const before=await readLibrary(page),target=before.tracks.find(x=>x.value.title==='Entrega-B').value,asset=before.assets.find(x=>x.key===target.assetId).value;
  const audioBefore=await page.evaluate(()=>({src:removalSmoke.audio[0].src,calls:removalSmoke.calls.slice(),time:removalSmoke.audio[0].currentTime}));
  await idle(page);stage=mode+':review';await button(page,'Revisar retirada de Entrega-B').click();const panel=page.locator('.copy-removal-panel');await panel.waitFor();
  if(!controlled){
   await panel.getByText('No podemos comprobar el estado de esta copia. Revisa su estado.',{exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'Quitar esta copia local',exact:true}).count(),0);assert.deepEqual(stable(await readLibrary(page)),stable(before));
   await button(page,'Cerrar revisión').click();report.cases.push({mode,passed:true,transport:mode==='native-uncontrolled'?'unprepared':'bounded-blob',controller:false,removal:'safely-blocked-runtime-unknown',allStoredDataPreserved:true});
  }else{
   stage=mode+':explicit-consent';const confirm=panel.getByRole('button',{name:'Quitar esta copia local',exact:true});await confirm.waitFor();assert.equal(await confirm.isDisabled(),true);assert.equal(await panel.locator('input:checked').count(),0);
   await panel.getByRole('radio',{name:'Declaro conservar una copia externa',exact:true}).check();assert.equal(await confirm.isDisabled(),true);await panel.getByRole('checkbox').check();await confirm.click();await panel.getByText(/^Copia local retirada\./).waitFor();await panel.getByRole('button',{name:'Cerrar revisión',exact:true}).waitFor({state:'visible'});
   stage=mode+':verified-removal';const after=await readLibrary(page),removed=after.tracks.find(x=>x.key===target.id).value;
   assert.deepEqual(removed,{...target,assetId:null,revision:target.revision+1});assert.equal(after.assets.some(x=>x.key===asset.id),false);assert.deepEqual(after.tracks.filter(x=>x.key!==target.id),before.tracks.filter(x=>x.key!==target.id));assert.deepEqual(after.playlists,before.playlists);
   assert.ok(after.settings.some(x=>typeof x.key==='string'&&x.key.startsWith('local-copy-removal:v1:journal:')&&x.value.state==='removed'));
   if(asset.backend==='opfs'){const absent=await page.evaluate(async storageKey=>{const d=await(await navigator.storage.getDirectory()).getDirectoryHandle('pulso-assets-v1',{create:false});try{await d.getFileHandle(storageKey,{create:false});return false;}catch(error){if(error.name==='NotFoundError')return true;throw error;}},asset.storageKey);assert.equal(absent,true);}
   else assert.equal(after.chunks.some(x=>Array.isArray(x.key)&&x.key[0]===asset.storageKey),false);
   await panel.getByRole('button',{name:'Cerrar revisión',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.tagName==='H2');assert.equal(await button(page,'Revisar retirada de Entrega-B').isDisabled(),true);
   const afterRemoval=await page.evaluate(()=>({count:removalSmoke.audio.length,src:removalSmoke.audio[0].src,calls:removalSmoke.calls.slice(),paused:removalSmoke.audio[0].paused,time:removalSmoke.audio[0].currentTime}));assert.equal(afterRemoval.count,1);assert.equal(afterRemoval.src,audioBefore.src);assert.deepEqual(afterRemoval.calls,audioBefore.calls);assert.equal(afterRemoval.paused,false);assert.ok(afterRemoval.time>=audioBefore.time);
   // Explicit import already pauses playback in the product. Its separate
   // contract is identity reconciliation, not uninterrupted listening.
   stage=mode+':exact-reimport';await page.getByLabel('Importar audios',{exact:true}).setInputFiles(files[1]);await page.getByRole('status').filter({hasText:/1 importadas, 0 ya existentes\.|0 importadas, 1 ya existentes\./}).waitFor();const relinked=(await readLibrary(page)).tracks;assert.equal(relinked.length,2);assert.ok(relinked.find(x=>x.key===target.id).value.assetId);
   report.cases.push({mode,passed:true,backend:asset.backend,controller:true,removal:'confirmed-exact-generation-absent',organizationPreserved:true,exactReimportSameTrack:true,explicitTwoControls:true,usefulReturnFocus:true});
  }
  const audioAfter=await page.evaluate(()=>({count:removalSmoke.audio.length,src:removalSmoke.audio[0].src,calls:removalSmoke.calls.slice(),paused:removalSmoke.audio[0].paused,time:removalSmoke.audio[0].currentTime}));assert.equal(audioAfter.count,1);assert.equal(audioAfter.src,audioBefore.src);if(controlled){assert.equal(audioAfter.paused,true);report.cases.at(-1).explicitReimportPaused=true;}else{assert.deepEqual(audioAfter.calls,audioBefore.calls);assert.equal(audioAfter.paused,mode==='native-uncontrolled');assert.ok(audioAfter.time>=audioBefore.time);}
  if(mode!=='native-uncontrolled')assert.equal(await player.getByLabel(/Repetición/).inputValue(),'one');report.cases.at(-1).audioPreservedDuringReviewAndRemoval=true;report.csp.push(...await page.evaluate(()=>window.removalSmokeCSP??[]));await context.close();context=null;
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.csp,[]);assert.equal(report.externalRequests,0);report.passed=true;
}catch(error){report.failure={stage,name:error?.name??'UnknownError'};if(!privateMode)report.failure.message=String(error?.message??error);process.exitCode=1;}
finally{await context?.close();report.cleanup.contextsClosed=true;await browser?.close();report.cleanup.browserClosed=true;if(server)await new Promise(resolve=>server.httpServer.close(resolve));report.cleanup.serverClosed=true;await mkdir('.local/evidence',{recursive:true});await writeFile(`.local/evidence/copy-removal-${privateMode?'private-smoke':'production'}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
