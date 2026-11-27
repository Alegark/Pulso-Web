import {chromium,webkit} from 'playwright-core';import {createServer} from 'node:http';import {readFile,writeFile} from 'node:fs/promises';import {resolve,extname} from 'node:path';import assert from 'node:assert/strict';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';import {createTestWorkspace} from './test-workspace.mjs';
const site=resolve(process.argv[2]??'');if(!process.argv[2])throw Error('Requires candidate site');
const work=await createTestWorkspace('download-dock-ui'),report={cases:[],errors:[],external:[],cleanup:false};let server;
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,user='11111111-1111-4111-8111-111111111111';
const initial=()=>({version:1,tracks:[1,2].map(n=>({id:id(n+10),title:'Nube propia '+n,artist:'Artista propio',album:n===1?'Disco Completo':'Tema Dos - Single',duration:45,favorite:n===1,inLibrary:true,createdAt:'2026-11-17T00:00:00Z',localAlbum:null,catalog:{source:'itunes',id:`itunes:777:1:${n}:${100+n}`,title:'Nube propia '+n,artist:'Artista propio',album:'Disco Completo',duration:45}})),playlists:[{id:id(50),name:'Playlist de mi cuenta',entries:[1,2].map(n=>({id:id(50+n),trackId:id(n+10)}))}]});
try{
 const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.wasm':'application/wasm','.webmanifest':'application/manifest+json','.txt':'text/plain'};
 server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;let relative=decodeURIComponent(path==='/'?'/index.html':path);const file=resolve(site,'.'+relative);if(!file.startsWith(site+'/'))throw Error('path');const b=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(b);}catch{res.writeHead(404);res.end('{}');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 for(const engine of ['chromium','webkit']){let browser,contexts=[];let cloud={accountId:user,revision:1,document:initial()},commands={search:0,download:0};try{
  browser=await (engine==='chromium'?chromium:webkit).launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true}:{headless:true});const pages=[];
  for(let device=0;device<2;device++){
   const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});contexts.push(c);c.setDefaultTimeout(12000);
   await c.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin||u.protocol==='blob:')return r.fallback();report.external.push({engine,origin:u.origin});return r.abort();});
   await installRequiredAccountFixture(c,origin);
   await c.route(origin+'/api/account-library',r=>{if(r.request().method()==='PUT'){const v=r.request().postDataJSON();if(v.accountId!==user||v.revision!==cloud.revision)return r.fulfill({status:409,json:{code:'LIBRARY_CHANGED'}});cloud={accountId:user,revision:cloud.revision+1,document:v.document};}return r.fulfill({json:cloud});});
   await c.route(origin+'/telegram-config.json',r=>r.fulfill({json:{}}));
   await c.addInitScript(()=>{try{delete Navigator.prototype.serviceWorker;}catch{}window.__libraryCommands={search:0,download:0};const original=Worker.prototype.postMessage;Worker.prototype.postMessage=function(value,...rest){if(value?.type==='bot-search.search')window.__libraryCommands.search++;if(value?.type==='bot-search.download')window.__libraryCommands.download++;return original.call(this,value,...rest);};});
   // Seed only setup presence so the real shell opens while Telegram stays offline.
   await c.route(origin+'/testonly-seed',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>TESTONLY setup seed</title>'}));
   const p=await c.newPage();p.on('pageerror',e=>report.errors.push({engine,error:String(e)}));
   await p.goto(origin+'/testonly-seed');
   await p.evaluate(async account=>{
    localStorage.setItem('pulso:setup:v1:'+account,'complete');
    const db=await new Promise((resolve,reject)=>{
     const open=indexedDB.open('pulso-web-telegram-session-v1',1);
     open.onupgradeneeded=()=>open.result.createObjectStore('authorization');
     open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);
    });
    try{await new Promise((resolve,reject)=>{
     const tx=db.transaction('authorization','readwrite');
     tx.objectStore('authorization').put('TESTONLY_OFFLINE_SETUP','session');
     tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
    });}finally{db.close();}
   },user);
   await p.goto(origin);await p.locator('.shell-nav').waitFor();pages.push(p);
  }
  const [a,b]=pages;for(const p of pages){await p.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();await p.locator('.library-grid button').filter({hasText:'Playlist de mi cuenta'}).waitFor();}
  report.cases.push({engine,test:'two actual app instances restore the same account library from metadata',status:'PASS'});
  await a.locator('.library-grid button').filter({hasText:'Playlist de mi cuenta'}).click();await a.getByRole('heading',{name:'Playlist de mi cuenta',exact:true}).waitFor();assert.equal(await a.locator('.library-detail .collection-track-main').count(),2);
  for(const p of pages){const data=await p.evaluate(async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('pulso-web-local-v1');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(Error('open'));});try{const tx=db.transaction(['tracks','assets'],'readonly');const read=n=>new Promise(res=>{const r=tx.objectStore(n).getAll();r.onsuccess=()=>res(r.result);});const [tracks,assets]=await Promise.all([read('tracks'),read('assets')]);return {tracks:tracks.length,assets:assets.length,allMissing:tracks.every(t=>t.assetId===null),commands:window.__libraryCommands};}finally{db.close();}});assert.equal(data.assets,0);assert.equal(data.tracks,2);assert.equal(data.allMissing,true);assert.deepEqual(data.commands,{search:0,download:0});commands=data.commands;}
  report.cases.push({engine,test:'restoration has zero audio assets or bot commands',status:'PASS',commands});
  await a.getByRole('button',{name:/Volver a Biblioteca/}).click();await a.getByText('Crear una playlist',{exact:true}).click();await a.getByLabel('Nueva playlist',{exact:true}).fill('Creada en dispositivo A');await a.locator('.create-playlist').getByRole('button',{name:'Crear playlist',exact:true}).click();
  await a.waitForFunction(()=>document.querySelector('.library-grid')?.textContent.includes('Creada en dispositivo A'));
  await a.locator('.library-grid button').filter({hasText:'Playlist de mi cuenta'}).click();
  const row=a.locator('.library-detail .tracks>li').first();await row.locator('.track-actions-trigger').click();await row.locator('.track-actions-playlist>summary').click();await row.getByLabel('Playlist de destino').selectOption({label:'Creada en dispositivo A'});await row.getByRole('button',{name:'Añadir a playlist',exact:true}).click();
  await a.waitForFunction(()=>document.querySelector('.library-detail .track-actions-playlist button')?.disabled);
  await a.keyboard.press('Escape');
  await a.getByRole('button',{name:'Volver a Biblioteca',exact:true}).click();
  await a.getByRole('button',{name:'Configuración',exact:true}).click();await a.getByRole('button',{name:'Sincronizar biblioteca',exact:true}).click();
  await a.waitForFunction(()=>document.querySelector('section[aria-label="Sincronización de biblioteca"] [role=status]')?.textContent==='Biblioteca sincronizada con tu cuenta.');
  await new Promise(resolve=>setTimeout(resolve,1000));assert.ok(cloud.revision>=2);assert.equal(cloud.document.playlists.find(p=>p.name==='Creada en dispositivo A')?.entries.length,1);
  // A third, clean browser context represents a device signing in after A's write.
  const fresh=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});contexts.push(fresh);fresh.setDefaultTimeout(12000);
  await fresh.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===origin||u.protocol==='blob:'?r.fallback():r.abort();});
  await installRequiredAccountFixture(fresh,origin);
  await fresh.route(origin+'/api/account-library',r=>{if(r.request().method()==='PUT'){const v=r.request().postDataJSON();if(v.revision!==cloud.revision)return r.fulfill({status:409,json:{code:'LIBRARY_CHANGED'}});cloud={accountId:user,revision:cloud.revision+1,document:v.document};}return r.fulfill({json:cloud});});
  await fresh.route(origin+'/telegram-config.json',r=>r.fulfill({json:{}}));
  await fresh.route(origin+'/testonly-seed',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>TESTONLY setup seed</title>'}));
  const clean=await fresh.newPage();await clean.goto(origin+'/testonly-seed');
  await clean.evaluate(async account=>{localStorage.setItem('pulso:setup:v1:'+account,'complete');const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pulso-web-telegram-session-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('authorization');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{await new Promise((resolve,reject)=>{const tx=db.transaction('authorization','readwrite');tx.objectStore('authorization').put('TESTONLY_OFFLINE_SETUP','session');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{db.close();}},user);
  const cleanApp=await fresh.newPage();await cleanApp.goto(origin);
  await cleanApp.locator('.home-view .home-playlists button').filter({hasText:'Creada en dispositivo A'}).waitFor();
  const homeAlbum=cleanApp.locator('.home-albums button').filter({hasText:'Disco Completo'});await homeAlbum.waitFor();assert.equal(await homeAlbum.count(),1);assert.match(await homeAlbum.innerText(),/2 canciones/);assert.equal(await cleanApp.locator('.home-albums button').filter({hasText:'Tema Dos - Single'}).count(),0);
  await cleanApp.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();const libraryAlbum=cleanApp.locator('.library-grid button').filter({hasText:'Disco Completo'});await libraryAlbum.waitFor();assert.equal(await libraryAlbum.count(),1);assert.match(await libraryAlbum.innerText(),/2 canciones/);assert.equal(await cleanApp.locator('.library-grid button').filter({hasText:'Tema Dos - Single'}).count(),0);
  report.cases.push({engine,test:'clean desktop groups synced catalog edition in Home and Library',status:'PASS'});
  await cleanApp.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();await cleanApp.locator('.library-grid button').filter({hasText:'Creada en dispositivo A'}).click();assert.equal(await cleanApp.locator('.library-detail .collection-track-main').count(),1);
  await cleanApp.getByRole('button',{name:'Volver a Biblioteca',exact:true}).click();await cleanApp.getByText('Crear una playlist',{exact:true}).click();await cleanApp.getByLabel('Nueva playlist',{exact:true}).fill('Creada en dispositivo B');await cleanApp.locator('.create-playlist').getByRole('button',{name:'Crear playlist',exact:true}).click();
  await cleanApp.waitForFunction(()=>document.querySelector('.library-grid')?.textContent.includes('Creada en dispositivo B'));await cleanApp.getByRole('button',{name:'Configuración',exact:true}).click();await cleanApp.getByRole('button',{name:'Sincronizar biblioteca',exact:true}).click();
  await cleanApp.waitForFunction(()=>document.querySelector('section[aria-label="Sincronización de biblioteca"] [role=status]')?.textContent==='Biblioteca sincronizada con tu cuenta.');
  await new Promise(resolve=>setTimeout(resolve,1000));assert.ok(cloud.document.playlists.some(p=>p.name==='Creada en dispositivo B'));
  await a.evaluate(()=>window.dispatchEvent(new Event('focus')));await a.waitForFunction(()=>document.querySelector('.library-grid')?.textContent.includes('Creada en dispositivo B'));
  report.cases.push({engine,test:'clean device restores playlist with track in Home and Library and syncs changes back',status:'PASS'});
  await b.evaluate(()=>window.dispatchEvent(new Event('focus')));await b.locator('.library-grid button').filter({hasText:'Creada en dispositivo A'}).waitFor();await b.reload();await b.locator('.shell-nav').waitFor();await b.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();await b.locator('.library-grid button').filter({hasText:'Creada en dispositivo A'}).waitFor();
  report.cases.push({engine,test:'playlist created through UI reaches another device and survives reload',status:'PASS'});
  await a.setViewportSize({width:320,height:568});
  await a.evaluate(({user,selection})=>localStorage.setItem('pulso:library-download:v1:'+user,JSON.stringify(selection)),
   {user,selection:{id:id(69),trackIds:[id(11),id(12)],cursor:1,pending:null}});
  await a.reload();await a.locator('.shell-nav').waitFor();
  const continueButton=a.getByRole('button',{name:'Continuar',exact:true});
  const discardButton=a.getByRole('button',{name:'Descartar selección pendiente',exact:true});
  await continueButton.waitFor();
  for(const tab of ['Buscar','Inicio']){
   await a.locator('.shell-nav').getByRole('button',{name:tab,exact:true}).click();
   await continueButton.waitFor();
  }
  await a.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();
  await a.locator('.library-grid button').filter({hasText:'Playlist de mi cuenta'}).click();
  await continueButton.waitFor();
  assert.equal(await continueButton.count(),1);
  assert.equal(await discardButton.count(),0);
  await a.getByRole('button',{name:'Volver a Biblioteca',exact:true}).click();
  await a.getByRole('button',{name:'Configuración',exact:true}).click();
  await a.getByRole('button',{name:'Gestionar descargas',exact:true}).click();
  const storage=a.getByRole('region',{name:'Almacenamiento',exact:true});
  await storage.getByRole('heading',{name:'Tus descargas',exact:true}).waitFor();
  assert.equal(await storage.getByRole('button',{name:'Continuar',exact:true}).count(),0);
  await discardButton.waitFor();
  assert.equal(await a.locator('.download-dock').count(),1);
  assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(await a.evaluate(()=>window.__libraryCommands),{search:0,download:0});
  report.cases.push({engine,test:'mobile shell offers one global resume and discard in Almacenamiento',status:'PASS'});

 }catch(e){report.cases.push({engine,status:'FAIL',error:String(e.stack||e)});}finally{for(const c of contexts)await c.close();await browser?.close();}}
}finally{if(server)await new Promise(r=>server.close(r));report.cleanup=await work.cleanup();report.status=report.cases.some(c=>c.status==='FAIL')||report.errors.length||report.external.length?'FAIL':'PASS';await writeFile(resolve(work.evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:resolve(work.evidence,'report.json'),...report},null,2));}
if(report.status!=='PASS')process.exitCode=1;
