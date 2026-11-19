import {build,preview} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTestWorkspace} from './test-workspace.mjs';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';

const work=await createTestWorkspace('download-autoheal');
const report={cases:[],external:[],errors:[],limits:'Compiled app, real TelegramSessionClient and worker/driver, synthetic SDK and account. Desktop browser engines.'};
const uuid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const user='11111111-1111-4111-8111-111111111111',ids=[1,2,3,4].map(uuid);
const readyCopies=[1,2].map((n)=>{
 const audio=Buffer.alloc(32044);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);
 audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);
 audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);
 audio.writeUInt32LE(audio.length-44,40);audio[audio.length-1]=n;
 return {id:uuid(80+n),trackId:ids[n-1],sha256:createHash('sha256').update(audio).digest('hex'),audio:audio.toString('base64')};
});
const fixture=()=>({name:'playlist-resume-sdk-test',enforce:'pre',resolveId(id){if(id==='./temporary-sdk')return resolve('tests/integration/playlist-resume-sdk.ts');}});
let server;
const oldTemp=process.env.TMPDIR;
process.env.TMPDIR=resolve(work.dir);
try{
 const bundle=work.dir+'/bundle';
 await build({configFile:false,plugins:[tailwindcss(),fixture()],worker:{plugins:()=>[fixture()]},logLevel:'error',build:{outDir:bundle}});
 await writeFile(bundle+'/telegram-config.json',JSON.stringify({api_id:12345,api_hash:'0'.repeat(32)}));
 server=await preview({configFile:false,build:{outDir:bundle},preview:{host:'127.0.0.1',port:0}});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await launcher.launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',headless:true}:{headless:true});
  report[engine]=browser.version();
  try{for(const mode of ['autoheal','missing','invalid','cooldown','staging','parked','ack-lost','connected','single']){
   if(process.env.PLAYLIST_RESUME_ENGINE&&process.env.PLAYLIST_RESUME_ENGINE!==engine)continue;
   const fresh=['autoheal','missing','single'].includes(mode);
   const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
   const trace=[];let releaseRestore,holdRestore=false,page;
   const restoration=new Promise(resolve=>{releaseRestore=resolve;});
   try{
    await context.route('**/*',async route=>{
     const url=new URL(route.request().url());
     if(url.origin!==origin){report.external.push(url.origin);return route.abort();}
     if(url.pathname==='/testonly-seed')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>seed</title>'});
     if(url.pathname==='/__setup-event'){
      if(holdRestore&&url.searchParams.get('kind')==='restore')await restoration;
      return route.fulfill({json:{}});
     }
     if(url.pathname==='/__playlist-event'){
      trace.push({...route.request().postDataJSON(),at:Date.now()});
      return route.fulfill({json:{mode}});
     }
     return route.fallback();
    });
    await installRequiredAccountFixture(context,origin);
    const tracks=ids.map((id,i)=>({id,title:'Pista '+(i+1),artist:'Artista prueba',album:null,duration:2,favorite:false,inLibrary:true,createdAt:'2026-11-19T00:00:00Z',localAlbum:null,catalog:null}));
    let cloud={accountId:user,revision:1,document:{version:1,tracks,playlists:[{id:uuid(99),name:'Playlist pendiente',entries:ids.map((trackId,i)=>({trackId,id:uuid(100+i)}))}]}};
    await context.route(origin+'/api/account-library',async route=>{
     if(route.request().method()==='PUT'){
      const req=route.request().postDataJSON();
      if(req.revision!==cloud.revision)return route.fulfill({status:409,json:{code:'LIBRARY_CHANGED'}});
      cloud={...cloud,revision:cloud.revision+1,document:req.document};
     }
     return route.fulfill({json:cloud});
    });
    await context.addInitScript(({loseAck})=>{
     const locks=navigator.locks,request=locks.request.bind(locks);
     locks.request=(name,...args)=>name===sessionStorage.getItem('testonly-unavailable-lock')
      ?Promise.reject(new DOMException('Synthetic staging lock failure','SecurityError')):request(name,...args);
     const NativeWorker=window.Worker;
     window.__TESTONLY_outcomes=[];
     window.Worker=class extends NativeWorker{
      operationIdToHide;
      postMessage(message,...args){
       if(loseAck&&message?.type==='import'&&message.file.name==='Pista 3.wav')this.operationIdToHide=message.operationId;
       return super.postMessage(message,...args);
      }
      constructor(...args){
       super(...args);
       this.addEventListener('message',event=>{
        const {data}=event;
        if(data?.type==='complete'&&data.operationId===this.operationIdToHide){
         window.__TESTONLY_outcomes.push({type:'lost-ack',writeState:data.outcome.writeState});
         event.stopImmediatePropagation();
         this.dispatchEvent(new ErrorEvent('error'));
         return;
        }
        if(data?.outcome)window.__TESTONLY_outcomes.push({type:data.type,status:data.outcome.status,writeState:data.outcome.writeState,
         backend:data.outcome.primary?.backend,phase:data.outcome.primary?.phase,primary:data.outcome.primary?.code,cleanup:data.outcome.cleanup?.code,reconcile:data.outcome.reconcile?.code});
       });
      }
     };
    },{loseAck:mode==='ack-lost'});
    page=await context.newPage();page.setDefaultTimeout(18000);
    page.on('pageerror',e=>report.errors.push(String(e)));
    await page.goto(origin+'/testonly-seed');
    await page.evaluate(async ({user,ids})=>{
     localStorage.setItem('pulso:setup:v1:'+user,'complete');
     const db=await new Promise((resolve,reject)=>{
      const q=indexedDB.open('pulso-web-telegram-session-v1',1);
      q.onupgradeneeded=()=>q.result.createObjectStore('authorization');
      q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
     });
     try{await new Promise((resolve,reject)=>{
      const tx=db.transaction('authorization','readwrite'),store=tx.objectStore('authorization');
      store.put('TESTONLY_STORED_SESSION','session');store.put(crypto.randomUUID(),'epoch');
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
     });}finally{db.close();}
    },{user,ids});
    await page.goto(origin);
    await page.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();
    await page.locator('.library-grid button').filter({hasText:'Playlist pendiente'}).click();
    await page.getByRole('heading',{name:'Playlist pendiente',exact:true}).waitFor();
    const operationId=fresh?null:await page.evaluate(async ({user,ids,staging,parked,readyCopies})=>{
     const operationId=staging?crypto.randomUUID():null;
     const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
     try{await new Promise((resolve,reject)=>{
      const tx=db.transaction(['jobs','chunks','settings','tracks','assets'],'readwrite');
      const chunks=tx.objectStore('chunks'),tracks=tx.objectStore('tracks'),assets=tx.objectStore('assets');
      for(const copy of readyCopies){
       const bytes=Uint8Array.from(atob(copy.audio),char=>char.charCodeAt(0)),row=tracks.get(copy.trackId);
       chunks.put(bytes,[copy.id,0]);
       assets.put({id:copy.id,namespace:'local',storageKey:copy.id,bytes:bytes.length,sha256:copy.sha256,mime:'audio/wav',chunks:1,
        state:'complete',revision:1,chunkSize:65536,backend:'idb',retention:'kept'},copy.id);
       row.onsuccess=()=>tracks.put({...row.result,assetId:copy.id,revision:row.result.revision+1,
        audioFingerprint:{algorithm:'sha256',sha256:copy.sha256,bytes:bytes.length}},copy.trackId);
      }
      if(operationId){
       const owner=crypto.randomUUID();
       tx.objectStore('jobs').put({version:1,operationId,owner,accountId:user,revision:1,backend:'idb',
        storageKey:operationId,bytes:0,expectedBytes:32044,state:'writing',libraryMode:'cache'},operationId);
       chunks.put(new Uint8Array([1]),[operationId,0]);
       tx.objectStore('settings').put({operationId,owner,everPublished:false},['asset-ownership','idb',operationId]);
      }
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
     });}finally{db.close();}
     localStorage.setItem('pulso:library-download:v1:'+user,JSON.stringify({id:crypto.randomUUID(),trackIds:ids,cursor:2,
      pending:operationId?{kind:'save',index:2,operationId}:null}));
     if(parked)sessionStorage.setItem('testonly-unavailable-lock','pulso-web:local:asset:idb:'+operationId);
     return operationId;
    },{user,ids,staging:mode==='staging'||mode==='parked',parked:mode==='parked',readyCopies});
    if(!fresh){
     holdRestore=true;
     await page.reload();
     await page.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();
     await page.locator('.library-grid button').filter({hasText:'Playlist pendiente'}).click();
     if(mode==='connected'){
      releaseRestore();
      await page.getByText('Cuenta autenticada en esta pestaña.',{exact:false}).waitFor({state:'attached'});
      await page.locator('.bot-providers-list li').first().waitFor({state:'attached'});
     }
     await page.getByRole('button',{name:'Continuar descarga de Biblioteca',exact:true}).click();
     if(mode!=='connected'){
      await page.getByText('Esperando a que Telegram termine de preparar tus bots…',{exact:true}).waitFor();
      assert.equal(trace.length,0);
      releaseRestore();
     }
    }else{
     await page.locator('.bot-providers-list li').first().waitFor({state:'attached'});
     await page.getByRole('button',{name:mode==='single'?'Escuchar Pista 3':'Descargar playlist completa',exact:true}).click();
    }
    await page.waitForFunction(()=>document.body.textContent?.includes('Buscando canción'));
    const allSaved=['autoheal','cooldown','ack-lost','single'].includes(mode);
    const summary=allSaved?'Selección descargada en este dispositivo.':'Descarga parcial: revisa las canciones pendientes.';
    await page.getByText(summary,{exact:true}).waitFor({state:'attached',timeout:45000});
    if(!allSaved){
     await page.getByText('Ver canciones',{exact:true}).click();
     await page.getByText(mode==='parked'?'Pendiente en Almacenamiento':mode==='missing'?'No existe en tus bots':'Ningún bot entregó un archivo válido',{exact:true}).waitFor();
    }
    const searches=trace.filter(e=>e.kind==='search');
    assert.deepEqual(searches.map(e=>e.title),mode==='single'?['Pista 3','Pista 3']:mode==='parked'?['Pista 4']:mode==='ack-lost'?['Pista 3','Pista 4']:[...(fresh?['Pista 1','Pista 2']:[]),'Pista 3','Pista 3','Pista 4']);
    if(mode==='ack-lost'){
     const lost=await page.evaluate(()=>window.__TESTONLY_outcomes.filter(outcome=>outcome.type==='lost-ack'));
     assert.deepEqual(lost,[{type:'lost-ack',writeState:'published'}]);
    }
    if(mode==='missing')assert.equal(trace.some(e=>e.kind==='read'&&e.title==='Pista 3'),false);
    if(mode==='autoheal'||mode==='single')assert.deepEqual(trace.filter(e=>e.kind==='read'&&e.title==='Pista 3').map(e=>e.peer),[101,102]);
    if(mode==='cooldown')assert.ok(searches[1].at-trace.find(e=>e.kind==='read'&&e.title==='Pista 3').at>=1900);
    if(mode==='staging'||mode==='parked'){
     const staging=await page.evaluate(async operationId=>{
      const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
      try{return await new Promise((resolve,reject)=>{
       const tx=db.transaction(['jobs','chunks']),job=tx.objectStore('jobs').get(operationId),chunk=tx.objectStore('chunks').get([operationId,0]);
       tx.oncomplete=()=>resolve({state:job.result?.state,hasChunk:chunk.result!==undefined});tx.onabort=()=>reject(tx.error);
      });}finally{db.close();}
     },operationId);
     assert.deepEqual(staging,mode==='parked'?{state:'cleanup',hasChunk:true}:{state:'discarded',hasChunk:false});
    }
    const copies=await page.evaluate(async ids=>{
     const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
     const read=(store,key)=>new Promise((resolve,reject)=>{
      const q=db.transaction(store).objectStore(store).get(key);
      q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
     });
     try{return await Promise.all(ids.map(async id=>{
      const track=await read('tracks',id);
      if(!track?.assetId)return null;
      const asset=await read('assets',track.assetId);
      if(asset?.state!=='complete')throw Error('Missing complete asset');
      const data=asset.backend==='opfs'
       ?await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('pulso-assets-v1')).getFileHandle(asset.storageKey)).getFile().then(file=>file.arrayBuffer())
       :(await read('chunks',[asset.storageKey,0])).buffer;
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');
      if(data.byteLength!==32044||digest!==asset.sha256||digest!==track.audioFingerprint.sha256)throw Error('Invalid stored bytes');
      return {id:asset.id,digest};
     }));}finally{db.close();}
    },ids);
    const linked=copies.map(Boolean);
    assert.deepEqual(linked,mode==='single'?[false,false,true,false]:[true,true,allSaved,true]);
    if(mode==='single')assert.equal(await page.evaluate(({user,id})=>localStorage.getItem('pulso:library-download-held:v1:'+user+':'+id),{user,id:ids[2]}),null);
    assert.equal(new Set(copies.filter(Boolean).map(copy=>copy.id)).size,linked.filter(Boolean).length);
    report.cases.push({engine,mode,searches:searches.map(e=>e.title),linked,status:'PASS'});
   }catch(error){report.cases.push({engine,mode,status:'FAIL',error:String(error.stack??error),trace:trace.map(({kind,title})=>({kind,title})),outcomes:await page?.evaluate(()=>window.__TESTONLY_outcomes).catch(()=>[])});}
   finally{releaseRestore();await context.close();}
  }}finally{await browser.close();}
 }
 assert.equal(report.external.length,0);
}catch(error){report.errors.push(String(error.stack??error));}
finally{
 if(server)await new Promise(resolve=>server.httpServer.close(resolve));
 if(oldTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTemp;
 report.cleanup=await work.cleanup();
 report.status=report.cases.length===(process.env.PLAYLIST_RESUME_ENGINE?9:18)&&report.cases.every(c=>c.status==='PASS')&&!report.errors.length?'PASS':'FAIL';
 await writeFile(work.evidence+'/report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({report:work.evidence+'/report.json',...report},null,2));
 if(report.status!=='PASS')process.exitCode=1;
}
