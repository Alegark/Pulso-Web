// Updated Telegram-only baseline setup; native owned audio fixture, no device import picker.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';

let server,browser;
const report={passed:false,iphoneVerified:false};
try{
 const oldRoot=await realpath(process.env.PULSO_UPDATE_BASELINE??'.local/telegram-auth-integration/before-dist'),newRoot=await realpath('dist');
 const oldEntrySHA256=createHash('sha256').update(await readFile(resolve(oldRoot,'index.html'))).digest('hex');
 const entry='/releases/'+createHash('sha256').update(await readFile('dist/index.html')).digest('hex').slice(0,16)+'.html';
 let updated=false;
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav'};
 server=createServer(async(req,res)=>{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname),name=path==='/'?'/index.html':path;
  for(const root of updated?[newRoot,oldRoot]:[oldRoot])try{
   const file=await realpath(resolve(root,'.'+name));if(!file.startsWith(root+sep))continue;
   const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Content-Length':bytes.length,'X-Content-Type-Options':'nosniff'});res.end(bytes);return;
  }catch{/* Try another authorized static root. */}
  res.writeHead(404).end();
 });
 await new Promise((ready,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',ready);});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 const context=await browser.newContext();context.setDefaultTimeout(20000);await context.addInitScript(()=>{window.pulsoUpdateAudio=[];const NativeAudio=window.Audio;window.Audio=class extends NativeAudio{constructor(...args){super(...args);window.pulsoUpdateAudio.push(this);}};});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const previous=await context.newPage(),previousResponse=await previous.goto(origin+'/web.html');
 assert.equal(createHash('sha256').update(await previousResponse.body()).digest('hex'),oldEntrySHA256,'requires the selected frozen release as control');
 await previous.waitForFunction(()=>!!document.querySelector('.tracks'));
 await previous.evaluate(async()=>{
 const id='10000000-0000-4000-8000-000000000001',assetId='10000000-0000-4000-8000-000000000002',storageKey='10000000-0000-4000-8000-000000000003';
 const rate=22050,samples=rate*60,bytes=new Uint8Array(44+samples*2),v=new DataView(bytes.buffer);const text=(at,s)=>{for(let i=0;i<s.length;i++)bytes[at+i]=s.charCodeAt(i);};text(0,'RIFF');v.setUint32(4,bytes.length-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples*2,true);for(let i=0;i<samples;i++)v.setInt16(44+i*2,Math.round(Math.sin(i*2*Math.PI*330/rate)*1000),true);
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');const db=await new Promise((r,j)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>r(q.result);q.onerror=()=>j(Error('fixture-open'));});try{await new Promise((r,j)=>{const tx=db.transaction(['tracks','assets','chunks','playlists'],'readwrite');tx.oncomplete=r;tx.onabort=()=>j(Error('fixture-abort'));const chunks=Math.ceil(bytes.length/65536);tx.objectStore('tracks').put({id,assetId,title:'Tono propio de continuidad',artist:null,album:null,duration:60,favorite:true,revision:1,createdAt:'2026-11-02T00:00:00Z',manualOverrides:{}},id);tx.objectStore('assets').put({id:assetId,namespace:'local',backend:'idb',storageKey,bytes:bytes.length,sha256,mime:'audio/wav',chunks,chunkSize:65536,state:'complete',revision:1,retention:'kept'},assetId);for(let i=0;i<chunks;i++)tx.objectStore('chunks').put(bytes.slice(i*65536,(i+1)*65536),[storageKey,i]);tx.objectStore('playlists').put({id:'10000000-0000-4000-8000-000000000004',name:'Lista conservada',revision:1,entries:[{id:'10000000-0000-4000-8000-000000000005',trackId:id}]},'10000000-0000-4000-8000-000000000004');});}finally{db.close();}
 });
 await previous.reload();await previous.getByRole('button',{name:'Escuchar Tono propio de continuidad',exact:true}).click();await previous.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
 await previous.getByRole('region',{name:'Reproductor',exact:true}).getByRole('button',{name:'Reproducir',exact:true}).click();await previous.waitForFunction(()=>window.pulsoUpdateAudio[0]?.currentTime>0&&!window.pulsoUpdateAudio[0].paused);
 updated=true;
 const current=await context.newPage();await current.goto(origin+'/open.html');await current.waitForURL(origin+entry);await current.getByLabel('Agrupación de biblioteca',{exact:true}).waitFor();
 await current.getByRole('status').filter({hasText:'Hay una versión nueva preparada.'}).waitFor();
 const waiting=await current.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);assert.equal(waiting,true);
 const oldStillPlaying=await previous.evaluate(()=>window.pulsoUpdateAudio.length===1&&!window.pulsoUpdateAudio[0].paused);
 const newIsPaused=await current.evaluate(()=>window.pulsoUpdateAudio.length===1&&window.pulsoUpdateAudio[0].paused);assert.equal(oldStillPlaying,true);assert.equal(newIsPaused,true);
 await previous.close();await current.close();
 const reopened=await context.newPage();await reopened.goto(origin+'/open.html');await reopened.waitForURL(origin+entry);await reopened.getByLabel('Agrupación de biblioteca',{exact:true}).waitFor();
 await reopened.waitForFunction(async()=>{const r=await navigator.serviceWorker.getRegistration();return r?.active?.state==='activated'&&!r.waiting;});
 await reopened.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
 assert.equal(await reopened.evaluate(()=>window.pulsoUpdateAudio.length===1&&window.pulsoUpdateAudio[0].paused),true);
 report.result={oldEntrySHA256,newEntry:entry,newVersionBypassesOldShell:true,stableLauncherSelectsCurrentBuild:true,waitingBeforeClosingClients:waiting,oldStillPlaying,newIsPaused,activatedAfterClientClosure:true,restoredPaused:true};report.passed=true;
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await (await import('node:fs/promises')).writeFile('.local/telegram-auth-integration/update.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
