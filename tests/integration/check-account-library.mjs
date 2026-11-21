import {chromium,webkit} from 'playwright-core';
import {createServer} from 'vite';
import {writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import assert from 'node:assert/strict';
import {createTestWorkspace} from './test-workspace.mjs';
const work=await createTestWorkspace('download-dock-ui'),report={cases:[],errors:[],cleanup:false};let server;
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
try{
 await writeFile(resolve(work.dir,'index.html'),'<html><body><h1>TESTONLY account library</h1><script type="module" src="/tests/integration/account-library-fixture.ts"></script></body></html>');
 server=await createServer({configFile:false,cacheDir:resolve(work.dir,'vite-cache'),optimizeDeps:{noDiscovery:true,include:['music-metadata','debug','react','react-dom','react-dom/client','react/jsx-dev-runtime']},server:{host:'127.0.0.1',port:0,strictPort:false,watch:null},logLevel:'error'});await server.listen();const address=server.httpServer.address(),origin=`http://127.0.0.1:${address.port}`;
 for(const engine of ['chromium','webkit']){let browser,contexts=[];try{
  browser=await (engine==='chromium'?chromium:webkit).launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true}:{headless:true});
  const cloud=new Map();const pages=[];
  for(let device=0;device<2;device++){
   const context=await browser.newContext();contexts.push(context);let user=id(100);
   await context.route(origin+'/api/account-library',async route=>{const req=route.request();const input=req.method()==='PUT'?req.postDataJSON():null;if(input)user=input.accountId;const old=cloud.get(user);if(input){if(input.revision!==(old?.revision??null))return route.fulfill({status:409,json:{code:'LIBRARY_CHANGED'}});cloud.set(user,{accountId:user,revision:(old?.revision??0)+1,document:input.document});}return route.fulfill({json:cloud.get(user)??{accountId:user,revision:null,document:{version:1,tracks:[],playlists:[]}}});});
   // All fixture traffic is loopback. No account, Telegram or public provider.
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.fallback():route.abort());
   const page=await context.newPage();page.on('pageerror',e=>report.errors.push({engine,message:String(e)}));await page.goto(origin+'/'+work.dir+'/index.html');await page.waitForFunction(()=>window.libraryFixture);pages.push(page);
  }
  const [a,b]=pages;
  await a.evaluate(async()=>{const f=window.libraryFixture;await f.seed(1);await f.seed(2);await f.seed(3,false,true);await f.prepare(100);await f.list(10,[1,2]);});
  const before=await a.evaluate(()=>window.libraryFixture.physical());assert.equal(await a.evaluate(()=>window.libraryFixture.sync()),'saved');assert.equal(cloud.get(id(100)).document.tracks.length,2);
  await b.evaluate(()=>window.libraryFixture.prepare(100));assert.equal(await b.evaluate(()=>window.libraryFixture.sync()),'saved');let restored=await b.evaluate(()=>window.libraryFixture.snapshot());
  assert.equal(restored.document.tracks.length,2);assert.equal(restored.document.playlists[0].entries.length,2);assert.equal(restored.albums.length,1);assert.equal(restored.artists.length,1);assert.equal((await b.evaluate(()=>window.libraryFixture.physical())).assets,0);assert.ok((await b.evaluate(()=>window.libraryFixture.rows('tracks'))).every(t=>t.assetId===null));report.cases.push({engine,test:'new device restores metadata, playlist, album and artist without any audio',status:'PASS'});
  await b.evaluate(async()=>{const f=window.libraryFixture;await f.seed(4,true);await f.list(10,[1,2,4]);});await a.evaluate(()=>window.libraryFixture.mutate('tracks',window.libraryFixture.id(1),{favorite:true}));
  await b.evaluate(()=>window.libraryFixture.sync());await a.evaluate(()=>window.libraryFixture.sync());restored=cloud.get(id(100)).document;assert.equal(restored.tracks.length,3);assert.equal(restored.tracks.find(t=>t.id===id(1)).favorite,true);assert.equal(restored.playlists[0].entries.length,3);report.cases.push({engine,test:'concurrent device addition and favorite both survive',status:'PASS'});
  await a.evaluate(()=>window.libraryFixture.deleteList(10));await a.evaluate(()=>window.libraryFixture.sync());await b.evaluate(()=>window.libraryFixture.sync());assert.equal(cloud.get(id(100)).document.playlists.length,0);assert.deepEqual(await a.evaluate(()=>window.libraryFixture.physical()),before);report.cases.push({engine,test:'playlist deletion propagates without touching local bytes',status:'PASS'});
  // Account B cannot read or upload A's local organization. B is seeded with an
  // empty independent cloud response; no browser auth is involved in this fixture.
  await a.evaluate(()=>window.libraryFixture.prepare(101));const isolated=await a.evaluate(()=>window.libraryFixture.snapshot());assert.equal(isolated.document.tracks.length,0);assert.equal(isolated.document.playlists.length,0);await a.evaluate(()=>window.libraryFixture.prepare(100));assert.equal((await a.evaluate(()=>window.libraryFixture.snapshot())).document.tracks.length,3);report.cases.push({engine,test:'account switch preserves and isolates each local metadata set',status:'PASS'});
  await b.evaluate(async()=>{const f=window.libraryFixture;await f.seed(5,true,true);});const physicalBefore=await b.evaluate(()=>window.libraryFixture.physical());const linked=await b.evaluate(()=>window.libraryFixture.attach(1,5));assert.equal(linked,id(1));assert.equal((await b.evaluate(()=>window.libraryFixture.rows('tracks'))).some(t=>t.id===id(5)),false);assert.deepEqual(await b.evaluate(()=>window.libraryFixture.physical()),physicalBefore);report.cases.push({engine,test:'redownload attaches bytes to the restored identity without a second asset or dangling playlist',status:'PASS'});
  await b.evaluate(()=>window.libraryFixture.stageDownload(80));
  const sealedCount=(await b.evaluate(()=>window.libraryFixture.rows('assets'))).length;
  await b.reload();await b.waitForFunction(()=>!!window.libraryFixture);
  assert.equal((await b.evaluate(()=>window.libraryFixture.resumeDownload(101))).state,'absent');
  const recovery=await b.evaluate(()=>window.libraryFixture.resumeDownload(100));
  assert.deepEqual(recovery,{state:'saved',trackId:id(80)});
  assert.deepEqual(await b.evaluate(()=>window.libraryFixture.resumeDownload(100)),recovery);
  assert.equal((await b.evaluate(()=>window.libraryFixture.rows('assets'))).length,sealedCount);
  assert.ok((await b.evaluate(()=>window.libraryFixture.rows('tracks'))).find(t=>t.id===id(80)).assetId);
  report.cases.push({engine,test:'reload reconciles exact native sealed receipt and binds the previous row without new audio',status:'PASS'});
  const ui=()=>b.evaluate(()=>window.libraryFixture.mountBatch());
  const button=name=>b.getByRole('button',{name,exact:true});
  await b.setViewportSize({width:320,height:568});
  await ui();await button('Descargar selección').click();await b.waitForFunction(()=>window.batchFixture.lookups()===1);
  const progress=b.getByRole('region',{name:'Descargas',exact:true});
  const summary=expected=>progress.locator('.download-dock__handle').getByText(expected,{exact:true}).waitFor();
  await progress.waitFor();
  assert.equal(await b.locator('[data-surface="playlist"] .download-dock').count(),0);
  assert.equal(await button('Descargar selección').count(),0);
  assert.equal(await progress.evaluate(el=>getComputedStyle(el.parentElement).position),'fixed');
  assert.equal(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await button('Ir a Inicio').click();await b.getByRole('heading',{name:'Inicio'}).waitFor();
  assert.equal(await progress.count(),1);
  await button('Gestionar descargas').press('Enter');
  await progress.locator('.download-dock__handle').click();
  await button('Detener').waitFor();
  await b.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));window.batchFixture.release();});
  await summary('3 de 3 guardadas');
  assert.equal(await b.evaluate(()=>window.batchFixture.lookups()),3);
  await b.reload();await b.waitForFunction(()=>!!window.libraryFixture);
  await ui();await button('Descargar selección').click();await b.waitForFunction(()=>window.batchFixture.lookups()===1);
  await b.reload();await b.waitForFunction(()=>!!window.libraryFixture);await ui();
  await button('Gestionar descargas').press('Enter');
  await button('Descartar selección pendiente').waitFor();
  await button('Continuar').waitFor();
  assert.equal(await button('Continuar').count(),1);
  assert.equal(await b.evaluate(()=>window.batchFixture.lookups()),0);
  await button('Continuar').press('Enter');await b.evaluate(()=>window.batchFixture.release());
  await summary('3 de 3 guardadas');
  assert.equal(await b.evaluate(()=>window.batchFixture.lookups()),3);
  report.cases.push({engine,test:'mobile dock survives navigation, exposes one global resume and only storage discards',status:'PASS'});
  await b.evaluate(()=>window.libraryFixture.stageMissingBatch());await b.reload();
  await b.waitForFunction(()=>!!window.libraryFixture);await ui();
  await button('Continuar').press('Enter');
  await progress.getByText('La selección cambió. Vuelve a elegirla.',{exact:true}).waitFor();
  await button('Gestionar descargas').press('Enter');await button('Descartar selección pendiente').click();
  await button('Abrir playlist').click();
  assert.deepEqual(await b.evaluate(()=>window.libraryFixture.missingBatchState()),{active:false,held:'save'});
  await button('Descargar selección').click();await b.evaluate(()=>window.batchFixture.release());
  await summary('3 de 3 guardadas');
  report.cases.push({engine,test:'missing track can be discarded while its uncertain receipt stays separate from future batches',status:'PASS'});
  const replacement=await b.evaluate(()=>window.libraryFixture.verifyReplacement(80));
  assert.equal(replacement.before.state,'uncertain');
  assert.equal(replacement.before.canPreserveRetry,true);
  assert.equal(replacement.reviewed,true);
  assert.equal(replacement.saved,id(80));
  assert.equal(replacement.kept,replacement.old);
  assert.equal(replacement.assetKept,true);
  assert.ok(replacement.newAsset&&replacement.newAsset!==replacement.old);
  report.cases.push({engine,test:'same hash as corrupt bytes creates a fresh valid asset while retaining the original shared generation',status:'PASS'});
  await b.evaluate(()=>window.libraryFixture.stageReview());await b.reload();await b.waitForFunction(()=>!!window.libraryFixture);
  await b.evaluate(()=>window.libraryFixture.mountReview());
  const review=async title=>{
   await b.locator('li').filter({has:b.getByRole('button',{name:new RegExp(title)})}).locator('.track-actions-trigger').click();
   await button('Revisar descarga de esta canción').click();
  };
  await review('Título corregido');await button('Reintentar esta canción').waitFor();
  assert.deepEqual(await b.evaluate(()=>window.trackReviewFixture.queries),[]);
  assert.equal(await b.evaluate(()=>window.trackReviewFixture.held(140).kind),'network');
  await button('Reintentar esta canción').click();
  await summary('0 de 1 guardadas · 1 no existe');
  assert.deepEqual(await b.evaluate(()=>window.trackReviewFixture.queries),['Título corregido']);
  assert.equal(await b.evaluate(()=>window.trackReviewFixture.held(140)),null);
  await review('Título corregido');
  await button('Reintentar esta canción').waitFor();
  assert.deepEqual(await b.evaluate(()=>window.trackReviewFixture.queries),['Título corregido']);
  await button('Cerrar revisión').click();
  await review('Guardado ambiguo');await button('Conservar archivos y reintentar').waitFor();
  assert.deepEqual(await b.evaluate(()=>window.trackReviewFixture.queries),['Título corregido']);
  assert.equal(await b.evaluate(()=>window.trackReviewFixture.held(141).kind),'save');
  const dataBefore=await b.evaluate(()=>window.libraryFixture.physical());
  await button('Conservar archivos y reintentar').click();
  await b.waitForFunction(()=>window.trackReviewFixture.queries.length===2);
  assert.deepEqual(await b.evaluate(()=>window.trackReviewFixture.queries),['Título corregido','Título corregido']);
  assert.deepEqual(await b.evaluate(()=>window.libraryFixture.physical()),dataBefore);
  assert.ok((await b.evaluate(()=>window.libraryFixture.rows('jobs'))).some(j=>j.fixture==='never delete'));
  assert.ok((await b.evaluate(()=>window.libraryFixture.rows('tracks'))).some(t=>t.id===id(141)&&t.assetId===null));
  await b.waitForFunction(()=>!Array.from(document.querySelectorAll('.download-dock__footer button')).some(b=>b.textContent.startsWith('Detener')));
  await review('Copia corrupta compartida');await button('Conservar archivos y reintentar').waitFor();
  await button('Conservar archivos y reintentar').click();
  await b.waitForFunction(()=>window.trackReviewFixture.queries.length===3);
  assert.deepEqual(await b.evaluate(()=>window.libraryFixture.physical()),dataBefore);
  const after=await b.evaluate(()=>window.libraryFixture.rows('tracks'));
  assert.ok(after.some(t=>t.id===id(144)&&t.assetId===null));
  assert.ok(after.some(t=>t.id===id(143)&&t.assetId===id(343)));
  report.cases.push({engine,test:'persisted network and unknown save reviews require explicit per-track retry, use corrected metadata and preserve native files and records',status:'PASS'});
  // Separate context so malformed receipts from the manual review fixture are not
  // mistaken for staging owned by this batch.
  for(const mode of ['alternate','exhausted','same-provider','transient','resume']){
   const automaticContext=await browser.newContext();contexts.push(automaticContext);
   await automaticContext.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   const page=await automaticContext.newPage();
   await page.goto(origin+'/'+work.dir+'/index.html');await page.waitForFunction(()=>!!window.libraryFixture);
   if(mode==='resume'){
    await page.evaluate(()=>window.libraryFixture.mountAutomaticBatch('resume',true));
    await page.reload();await page.waitForFunction(()=>!!window.libraryFixture);
   }
   await page.evaluate(mode=>window.libraryFixture.mountAutomaticBatch(mode),mode);
   await page.getByRole('button',{name:mode==='resume'?'Continuar':'Descargar playlist completa',exact:true}).click();
   const dock=page.getByRole('region',{name:'Descargas',exact:true});
   await dock.locator('.download-dock__handle').getByText(mode==='exhausted'?'3 de 4 guardadas · 1 sin archivo válido':'4 de 4 guardadas',{exact:true}).waitFor();
   assert.equal(await dock.locator('button').filter({hasText:'Revisar descarga'}).count(),0);
   const trace=await page.evaluate(async()=>({requests:window.automaticFixture.requests,downloads:window.automaticFixture.downloads,saves:window.automaticFixture.saves,receipt:await window.automaticFixture.receipt()}));
   const thirdRequests=mode==='same-provider'?['A Lote 3','A Lote 3']:mode==='transient'?['A Lote 3']:['A Lote 3','B Lote 3','C Lote 3'];
   const thirdDownloads=mode==='same-provider'?['A row','A alternate']:mode==='transient'?['A row']:
    mode==='resume'?['B row','C row']:['A row','B row','C row'];
   assert.deepEqual(trace.requests,[...thirdRequests,'A Lote 4']);
   assert.deepEqual(trace.downloads,[...thirdDownloads,'A row']);
   assert.deepEqual(trace.saves,mode==='exhausted'||mode==='resume'?['Lote 3','Lote 4']:['Lote 3','Lote 3','Lote 4']);
   assert.deepEqual(trace.receipt,{state:'discarded',chunks:0});
   const scenarios={
    alternate:'playlist recovers own staging, skips identical alternative and saves the third and fourth tracks without another gesture',
    exhausted:'playlist fourth track continues without a gesture after third track exhausts alternatives',
    'same-provider':'playlist uses another compatible row with only one configured provider',
    transient:'playlist retries one transient write with the verified blob and no second Telegram download',
    resume:'playlist continuation repairs staging and skips the recorded bad candidate before recovering track three and then four',
   };
   report.cases.push({engine,test:scenarios[mode],status:'PASS'});
   await page.close();
  }
 }catch(e){report.cases.push({engine,status:'FAIL',error:String(e.stack||e)});}finally{for(const c of contexts){for(const p of c.pages())await p.evaluate(()=>window.libraryFixture?.dispose()).catch(()=>{});await c.close();}await browser?.close();}}
}finally{await server?.close();report.cleanup=await work.cleanup();report.status=report.cases.some(c=>c.status==='FAIL')||report.errors.length?'FAIL':'PASS';await writeFile(resolve(work.evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:resolve(work.evidence,'report.json'),...report},null,2));}
if(report.status!=='PASS')process.exitCode=1;
