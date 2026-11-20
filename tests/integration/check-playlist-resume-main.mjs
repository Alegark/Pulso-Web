import {build,preview} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {open,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTestWorkspace} from './test-workspace.mjs';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';

const work=await createTestWorkspace('download-autoheal');
const report={cases:[],external:[],errors:[],limits:'Compiled app, real TelegramSessionClient and worker/driver, synthetic SDK and account. Desktop browser engines.'};
const uuid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const user='11111111-1111-4111-8111-111111111111',ids=[1,2,3,4].map(uuid);
function fixtureWav(n){
 const audio=Buffer.alloc(32044);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);
 audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);
 audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);
 audio.writeUInt32LE(audio.length-44,40);audio[audio.length-1]=n;
 return audio;
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const readyCopies=[1,2].map(n=>{
 const audio=fixtureWav(n);
 return {id:uuid(80+n),trackId:ids[n-1],sha256:digest(audio),audio:audio.toString('base64')};
});
const fixture=()=>({name:'playlist-resume-sdk-test',enforce:'pre',resolveId(id){if(id==='./temporary-sdk')return resolve('tests/integration/playlist-resume-sdk.ts');}});
const allModes=['autoheal','missing','missing-metadata','invalid','cooldown','staging','parked','ack-lost','connected','single','album'];
const modes=process.env.PLAYLIST_RESUME_MODE?[process.env.PLAYLIST_RESUME_MODE]:allModes;
assert.ok(modes.every(mode=>allModes.includes(mode)),'Unknown playlist resume test case');
const reasons={
 missing:['1 no existe','No existe en tus bots'],
 'missing-metadata':['1 sin datos','Faltan datos para buscarla'],
 parked:['1 pendiente en Almacenamiento','Pendiente en Almacenamiento'],
 invalid:['1 sin archivo válido','Ningún bot entregó un archivo válido'],
};

async function checkHeader(page,header,engine,screenshots){
 const controls=header.locator('.collection-header__controls');
 const labels=()=>controls.locator('button:visible').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label')));
 const expected=['Reproducir playlist','Reproducción aleatoria','Descargar playlist completa','Opciones de playlist'];
 await controls.getByRole('button',{name:expected[2],exact:true}).waitFor();
 assert.deepEqual(await labels(),expected);
 assert.equal(await page.getByRole('button',{name:'Eliminar playlist',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:/portadas de Spotify/}).count(),0);
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:`${screenshots}/${engine}-390x844-cabecera.png`});
 for(const [width,height] of [[320,568],[844,390],[390,844]]){
  await page.setViewportSize({width,height});
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  assert.deepEqual(await labels(),expected);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await header.getByRole('button',{name:'Opciones de playlist',exact:true}).click();
  const menu=header.getByRole('dialog');
  await menu.getByRole('button',{name:'Eliminar playlist',exact:true}).waitFor();
  await menu.getByRole('button',{name:/portadas de Spotify/}).waitFor();
  for(const label of ['Editar nombre','Filtros de canciones'])await menu.getByText(label,{exact:true}).waitFor();
  await menu.getByRole('button',{name:'Cerrar opciones de colección'}).click();
 }
 await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
}

let server,tempDirectory;
const oldTemp=process.env.TMPDIR;
const screenshots=process.env.PULSO_TEST_EVIDENCE_DIR??work.evidence;
try{
 // Keep test profiles in the worktree using a path short enough for Unix sockets.
 tempDirectory=await open(work.dir,'r');
 process.env.TMPDIR=`/proc/${process.pid}/fd/${tempDirectory.fd}`;
 const bundle=work.dir+'/bundle';
 await build({configFile:false,plugins:[tailwindcss(),fixture()],worker:{plugins:()=>[fixture()]},logLevel:'error',build:{outDir:bundle}});
 await writeFile(bundle+'/telegram-config.json',JSON.stringify({api_id:12345,api_hash:'0'.repeat(32)}));
 server=await preview({configFile:false,build:{outDir:bundle},preview:{host:'127.0.0.1',port:0}});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
  if(process.env.PLAYLIST_RESUME_ENGINE&&process.env.PLAYLIST_RESUME_ENGINE!==engine)continue;
  const browser=await launcher.launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',headless:true}:{headless:true});
  report[engine]=browser.version();
  try{for(const mode of modes){
   const fresh=['autoheal','missing','missing-metadata','single','album'].includes(mode);
   const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
   const trace=[];let releaseRestore,releaseSearch,holdRestore=false,page;
   const restoration=new Promise(resolve=>{releaseRestore=resolve;});
   const searchGate=new Promise(resolve=>{releaseSearch=resolve;});
   try{
    await context.route('**/*',async route=>{
     const url=new URL(route.request().url());
     if(mode==='album'&&url.origin==='https://itunes.apple.com'){
      const album={wrapperType:'collection',collectionType:'Album',collectionId:201,collectionName:'Álbum de prueba',
       artistName:'Artista prueba',trackCount:2};
      const tracks=[3,4].map((n,index)=>({wrapperType:'track',kind:'song',collectionId:201,trackId:300+n,
       discNumber:1,discCount:1,trackNumber:index+1,trackCount:2,trackName:`Pista ${n}`,artistName:'Artista prueba',trackTimeMillis:2000}));
      const results=url.pathname==='/lookup'?[album,...tracks]:[album];
      return route.fulfill({headers:{'access-control-allow-origin':'*'},json:{resultCount:results.length,results}});
     }
     if(mode==='album'&&url.origin==='https://lrclib.net')return route.fulfill({headers:{'access-control-allow-origin':'*'},json:[]});
     if(url.origin!==origin){report.external.push(url.origin);return route.abort();}
     if(url.pathname==='/testonly-seed')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>seed</title>'});
     if(url.pathname==='/__setup-event'){
      if(holdRestore&&url.searchParams.get('kind')==='restore')await restoration;
      return route.fulfill({json:{}});
     }
     if(url.pathname==='/__playlist-event'){
      const event=route.request().postDataJSON();
      trace.push({...event,at:Date.now()});
      if(['missing','album'].includes(mode)&&event.kind==='search'&&event.title==='Pista 3')await searchGate;
      return route.fulfill({json:{mode:mode==='album'?'missing':mode}});
     }
     return route.fallback();
    });
    await installRequiredAccountFixture(context,origin);
    const tracks=ids.map((id,i)=>({id,title:'Pista '+(i+1),artist:mode==='missing-metadata'&&i===2?null:'Artista prueba',album:null,duration:2,favorite:false,inLibrary:true,createdAt:'2026-11-19T00:00:00Z',localAlbum:null,catalog:null}));
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
    const header=page.locator('.collection-header');
    const dock=page.getByRole('region',{name:'Descargas',exact:true});
    const handle=dock.locator('.download-dock__handle');
    const panel=dock.locator('.download-dock__panel');
    if(mode==='album'){
     await page.locator('.bot-providers-list li').first().waitFor({state:'attached'});
     await page.locator('.shell-nav').getByRole('button',{name:'Buscar',exact:true}).click();
     const input=page.getByRole('searchbox',{name:'Canción, álbum o artista'});
     await input.fill('Álbum de prueba');
     await input.press('Enter');
     await page.locator('[data-catalog-kind="album"]').filter({hasText:'Álbum de prueba'}).first().click();
     await page.getByRole('button',{name:'Añadir álbum',exact:true}).click();
     await handle.getByText('0/2',{exact:true}).waitFor();
     await page.locator('.album-actions').getByRole('button',{name:/Ver descargas/}).click();
     await dock.getByRole('button',{name:'Detener',exact:true}).waitFor();
     await panel.getByText('Álbum de prueba',{exact:true}).waitFor();
     releaseSearch();
     await handle.getByText('1 de 2 guardadas · 1 no existe',{exact:true}).waitFor();
     await handle.click();
     await panel.locator('li[data-failed=true]').getByText('No existe en tus bots',{exact:true}).waitFor();
     await panel.locator('li[data-failed=false]').getByText('Pista 4',{exact:true}).waitFor();
     const assets=await page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{
       const req=indexedDB.open('pulso-web-local-v1');
       req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      try{return await new Promise((resolve,reject)=>{
       const req=db.transaction('assets').objectStore('assets').getAll();
       req.onsuccess=()=>resolve(req.result.filter(asset=>asset.state==='complete').map(asset=>asset.sha256));
       req.onerror=()=>reject(req.error);
      });}finally{db.close();}
     });
     assert.deepEqual(assets,[digest(fixtureWav(14))]);
     assert.deepEqual(trace.filter(event=>event.kind==='search').map(event=>event.title),['Pista 3','Pista 3','Pista 4']);
     report.cases.push({engine,mode,status:'PASS'});
     continue;
    }
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
     await header.getByRole('button',{name:'Continuar descarga',exact:true}).click();
     if(mode!=='connected'){
      await dock.locator('.download-dock__message').getByText('Esperando a que Telegram termine de preparar tus bots…',{exact:true}).waitFor();
      assert.equal(trace.length,0);
      releaseRestore();
     }
    }else{
     await page.locator('.bot-providers-list li').first().waitFor({state:'attached'});
     if(mode==='missing'){
      assert.equal(await dock.count(),0);
      await checkHeader(page,header,engine,screenshots);
     }
     const start=mode==='single'?page.getByRole('button',{name:'Escuchar Pista 3',exact:true}):
      header.getByRole('button',{name:'Descargar playlist completa',exact:true});
     await start.click();
    }
    if(mode==='missing'){
     await handle.getByText('2/4',{exact:true}).waitFor();
     assert.equal(await handle.getAttribute('aria-expanded'),'false');
     await page.screenshot({path:`${screenshots}/${engine}-390x844-plegada.png`});
     await header.getByRole('button',{name:/Ver descargas/}).click();
     assert.equal(await handle.evaluate(el=>el===document.activeElement),true);
     await dock.getByRole('button',{name:'Detener',exact:true}).waitFor();
     await panel.getByText('Pista 3',{exact:true}).first().waitFor();
     await handle.click();
     assert.equal(await handle.getAttribute('aria-expanded'),'false');
     releaseSearch();
    }
    const allSaved=['autoheal','cooldown','ack-lost','single'].includes(mode);
    const [reasonCount,reasonText]=reasons[mode]??reasons.invalid;
    const summary=mode==='single'?'1 de 1 guardadas':allSaved?'4 de 4 guardadas':`3 de 4 guardadas · ${reasonCount}`;
    await handle.getByText(summary,{exact:true}).waitFor({timeout:45000});
    assert.equal(await handle.getAttribute('aria-expanded'),'false');
    await handle.click();
    await panel.getByText('Descarga finalizada',{exact:true}).waitFor();
    assert.equal(await panel.locator('li').count(),mode==='single'?1:4);
    assert.equal(await page.locator('.library-detail .download-dock, .library-detail [aria-label="Revisión de descarga"]').count(),0);
    for(const label of ['Ver canciones','Continuar descarga de Biblioteca']){
     assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),0);
    }
    assert.doesNotMatch(await panel.innerText(),/\[D\d+\]/);
    if(!allSaved){
     const failed=panel.locator('li[data-failed=true]').filter({hasText:'Pista 3'});
     await failed.getByText(reasonText,{exact:true}).waitFor();
     assert.equal(await panel.locator('li[data-failed=true]').count(),1);
    }
    const storage=dock.getByRole('button',{name:'Revisar en Almacenamiento',exact:true});
    assert.equal(await storage.count(),mode==='parked'?1:0);
    assert.equal(await dock.getByRole('button').count(),mode==='parked'?2:1);
    if(mode==='parked'){
     await storage.click();
     await dock.waitFor({state:'detached'});
     await page.locator('#download-copy-recovery, [aria-label="Almacenamiento"]').first().waitFor();
    }
    if(mode==='missing'){
     await page.screenshot({path:`${screenshots}/${engine}-390x844-final.png`});
     await dock.waitFor({state:'detached',timeout:6500});
    }
    const searches=trace.filter(e=>e.kind==='search');
    assert.deepEqual(searches.map(e=>e.title),mode==='single'?['Pista 3','Pista 3']:mode==='parked'?['Pista 4']:mode==='ack-lost'?['Pista 3','Pista 4']:mode==='missing-metadata'?['Pista 1','Pista 2','Pista 4']:[...(fresh?['Pista 1','Pista 2']:[]),'Pista 3','Pista 3','Pista 4']);
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
    assert.deepEqual(copies.map((copy,index)=>copy?.digest??null),linked.map((saved,index)=>
     saved?digest(fixtureWav(!fresh&&index<2?index+1:index+11)):null));
    report.cases.push({engine,mode,searches:searches.map(e=>e.title),linked,status:'PASS'});
   }catch(error){report.cases.push({engine,mode,status:'FAIL',error:String(error.stack??error),trace:trace.map(({kind,title})=>({kind,title})),outcomes:await page?.evaluate(()=>window.__TESTONLY_outcomes).catch(()=>[])});}
   finally{releaseRestore();releaseSearch();await context.close();}
  }}finally{await browser.close();}
 }
 assert.equal(report.external.length,0);
}catch(error){report.errors.push(String(error.stack??error));}
finally{
 if(server)await new Promise(resolve=>server.httpServer.close(resolve));
 if(oldTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTemp;
 await tempDirectory?.close();
 report.cleanup=await work.cleanup();
 report.status=report.cases.length===modes.length*(process.env.PLAYLIST_RESUME_ENGINE?1:2)&&report.cases.every(c=>c.status==='PASS')&&!report.errors.length?'PASS':'FAIL';
 await writeFile(work.evidence+'/report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({report:work.evidence+'/report.json',...report},null,2));
 if(report.status!=='PASS')process.exitCode=1;
}
