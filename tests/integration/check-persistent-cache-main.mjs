import assert from 'node:assert/strict';
import {mkdir,readdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {deflateSync} from 'node:zlib';
import {build,preview} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';
import {createTestWorkspace} from './test-workspace.mjs';

const timed=process.argv.includes('--measure');
const engineArg=process.argv.find(arg=>arg.startsWith('--engine='))?.slice(9);
const workspace=await createTestWorkspace('t26-inc1-cache');
const report={cases:[],measurements:[],interface:{},load:{},errors:[]};
const fixture='tests/integration/persistent-cache-fixture.html';
const cacheName='pulso-web-cache-v1';
const accountA='11111111-1111-4111-8111-111111111111';
const accountB='22222222-2222-4222-8222-222222222222';
const providerTitle='Descarga uno';
const artist='Intérprete de prueba';
const trackImage='https://is1-ssl.mzstatic.com/image/thumb/Music/provider/100x100bb.png';
const rowSelector='.library-detail .tracks>li .collection-track-art img';
const requests=[];
let server,context,offline=false,runEngine;
function png(width,height,rgba){
 const chunk=(type,bytes)=>{
  const payload=Buffer.concat([Buffer.from(type),bytes]),size=Buffer.alloc(4),crc=Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);let value=0xffffffff;
  for(const byte of payload){
   value^=byte;
   for(let i=0;i<8;i++)value=(value>>>1)^(value&1?0xedb88320:0);
  }
  crc.writeUInt32BE((value^0xffffffff)>>>0);
  return Buffer.concat([size,payload,crc]);
 };
 const header=Buffer.from([0,0,0,0,0,0,0,0,8,6,0,0,0]);
 header.writeUInt32BE(width);header.writeUInt32BE(height,4);
 const row=Buffer.alloc(width*4+1);row.fill(Buffer.from(rgba),1);
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),
  chunk('IDAT',deflateSync(Buffer.concat(Array.from({length:height},()=>row)))),chunk('IEND',Buffer.alloc(0))]);
}
const small=png(200,200,[20,200,70,255]);
const large=png(600,400,[240,30,50,255]);
const manual=png(2,2,[20,60,230,255]);
function catalog(req,res,next){
 const path=new URL(req.url,'http://127.0.0.1');
 function send(type,body,track=true){
  if(track)requests.push({path:path.pathname,bytes:offline?0:body.length});
  if(offline&&track){res.destroy();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',type);
  if(timed&&track)setTimeout(()=>res.end(body),120);else res.end(body);
 }
 const json=(value)=>send('application/json',Buffer.from(JSON.stringify(value)));
 if(path.pathname==='/catalog-config.json')return json({version:1,itunes:true,artwork:true});
 if(path.pathname==='/__artwork/manual.png')return send('image/png',manual,false);
 if(path.pathname==='/catalog/artwork'){
  const source=path.searchParams.get('u');
  return send('image/png',source?.includes('/provider/')?large:small);
 }
 if(path.pathname==='/catalog/itunes/search'){
  const results=[{wrapperType:'track',kind:'song',trackName:providerTitle,artistName:artist,collectionName:'Edición de prueba',
   collectionId:42,trackTimeMillis:45000,artworkUrl100:trackImage}];
  return json({resultCount:results.length,results});
 }
 next();
}
async function check(name,fn){
 try{await fn();report.cases.push({engine:runEngine,name,status:'PASS'});}
 catch(error){report.cases.push({engine:runEngine,name,status:'FAIL',error:String(error.stack??error)});}
 console.log(runEngine,report.cases.at(-1).status,name,report.cases.at(-1).error?.split('\n')[0]??'');
}
function newPage(){
 return context.newPage().then(page=>{
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  page.on('pageerror',e=>report.errors.push(String(e)));
  return page;
 });
}
async function navigate(page,origin){await page.goto(origin,{waitUntil:'domcontentloaded'});await page.locator('.shell-nav button').first().waitFor();}
async function library(page,title){
 await page.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();
 await page.locator('.library-grid button').filter({hasText:title}).click();
 await page.locator('.library-detail').getByRole('heading',{name:title,exact:true}).waitFor();
}
async function observe(page,origin,label){
 await navigate(page,origin);
 await page.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();
 const button=page.locator('.library-grid button').filter({hasText:'Treinta portadas'});
 await button.evaluate(node=>{
  node.addEventListener('click',()=>{window.coverStart=performance.now();},{capture:true,once:true});
 });
 await button.click();
 let ms=null;
 try{
  ms=await page.waitForFunction(selector=>{
   const images=[...document.querySelectorAll(selector)];
   return images.length===30&&images.every(img=>img.complete&&img.naturalWidth>0)&&performance.now()-window.coverStart;
  },rowSelector,{timeout:timed?5000:30000}).then(handle=>handle.jsonValue());
 }catch(error){if(error.name!=='TimeoutError')throw error;}
 const count=await page.locator(rowSelector).evaluateAll(nodes=>nodes.filter(img=>img.complete&&img.naturalWidth>0).length);
 const metric={engine:runEngine,label,ms:ms===null?null:Math.round(ms),count,
  requests:requests.length,bytes:requests.reduce((n,req)=>n+req.bytes,0),imageRequests:requests.filter(req=>req.path==='/catalog/artwork').length,
   attempts:await page.evaluate(()=>window.catalogAttempts.length)};
 report.measurements.push(metric);console.log(JSON.stringify(metric));
 return metric;
}
async function inspect(page,{opfs=false}={}){
 return page.evaluate(async({cacheName,opfs})=>{
  const databases=await indexedDB.databases();
  if(opfs){
   const db=await new Promise((ok,fail)=>{const req=indexedDB.open('pulso-web-local-v1');req.onsuccess=()=>ok(req.result);req.onerror=fail;});
   const read=async (store,select)=>{
    const req=db.transaction(store).objectStore(store).getAll();
    return new Promise((ok,fail)=>{req.onsuccess=()=>ok(select(req.result));req.onerror=fail;});
   };
   const library=await Promise.all([read('tracks',x=>x),read('playlists',x=>x),read('assets',x=>x),read('settings',x=>x.filter(row=>row?.provenance==='manual'||row?.audioSha256))]);
   db.close();
   return {library,caches:(await caches.keys()).sort(),opfs:navigator.storage.getDirectory?await inventory(await navigator.storage.getDirectory()):null};
  }
  async function inventory(dir){
   const files=[];for await(const [name,handle] of dir.entries())files.push([name,handle.kind==='file'?(await handle.getFile()).size:await inventory(handle)]);
   return files.sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  }
  if(!databases.some(row=>row.name===cacheName))return null;
  const db=await new Promise((ok,fail)=>{const req=indexedDB.open(cacheName);req.onsuccess=()=>ok(req.result);req.onerror=fail;});
  const data=await Promise.all([...db.objectStoreNames].map(name=>new Promise((ok,fail)=>{
   const req=db.transaction(name).objectStore(name).getAll();
   req.onsuccess=()=>ok([name,req.result.map(row=>{
    if(name!=='artwork')return row;
    const {bytes,...rest}=row;return {...rest,binary:bytes instanceof ArrayBuffer&&bytes.byteLength===row.byteLength};
   })]);req.onerror=fail;
  })));
  db.close();return Object.fromEntries(data);
 },{cacheName,opfs});
}
async function color(page,selector){
 return page.locator(selector).first().evaluate(async img=>{
  await img.decode();
  const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,1,1);
  return [...ctx.getImageData(0,0,1,1).data].slice(0,3);
 });
}
async function closeAndReopen(page){
 const next=await newPage();
 await page.close();
 return next;
}
async function accountChange(page){
 await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'pulso-account:changed:v1',
  newValue:JSON.stringify({version:1,type:'changed',source:crypto.randomUUID()})})));
}
async function ageArtwork(page,days){
 await page.evaluate(async({cacheName,days})=>{
  if(!(await indexedDB.databases()).some(db=>db.name===cacheName))return;
  const db=await new Promise((ok,fail)=>{const req=indexedDB.open(cacheName);req.onsuccess=()=>ok(req.result);req.onerror=fail;});
  try{
   await new Promise((ok,fail)=>{
    const tx=db.transaction('artwork','readwrite'),req=tx.objectStore('artwork').openCursor();
    tx.oncomplete=ok;tx.onabort=()=>fail(tx.error);
    req.onsuccess=()=>{
     const cursor=req.result;if(!cursor)return;
     cursor.update({...cursor.value,fetchedAt:Date.now()-days*86400000});cursor.continue();
    };
   });
  }finally{db.close();}
 },{cacheName,days});
}

try{
 const out=resolve(workspace.dir,'bundle');
 const profile=resolve(workspace.dir,'profiles');
 await mkdir(profile);
 await build({configFile:false,plugins:[tailwindcss()],logLevel:'error',build:{outDir:out,rolldownOptions:{input:[resolve('index.html'),resolve(fixture)]}}});
 if(timed){
  const shell=['/','/index.html','/manifest.webmanifest',...(await readdir(resolve(out,'assets'))).map(name=>'/assets/'+name)];
  await build({configFile:false,logLevel:'error',define:{SHELL_FILES:JSON.stringify(shell)},
   build:{emptyOutDir:false,outDir:out,lib:{entry:'src/service-worker/sw.ts',formats:['es'],fileName:()=> 'sw.js'}}});
 }
 server=await preview({configFile:false,build:{outDir:out},preview:{host:'127.0.0.1',port:0},
  plugins:[{name:'t26-cache-fixture',configurePreviewServer(vite){vite.middlewares.use(catalog);}}]});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 async function waitForLoad(engine){
  for(;;){
   const uptime=execFileSync('uptime',{encoding:'utf8',env:{...process.env,LC_ALL:'C'}}).trim();
   console.log(uptime);
   const load=Number(uptime.match(/load averages?:\s*([\d.]+)/)?.[1]);
   if(load<1.5){report.load[engine]=load;break;}
   if(!process.argv.includes('--wait-load')||!Number.isFinite(load))throw Error('Measurement postponed: 1 minute load '+load+' >= 1.5');
   await new Promise(resolve=>setTimeout(resolve,15000));
  }
 }
 for(const [engine,launcher] of Object.entries({chromium,webkit})){
  if(engineArg&&engineArg!==engine)continue;
  if(timed)await waitForLoad(engine);
  runEngine=engine;offline=false;requests.length=0;
  const options={headless:true,viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:timed?'allow':'block',
   proxy:{server:'http://127.0.0.1:9',bypass:'127.0.0.1,localhost'}};
  context=await launcher.launchPersistentContext(resolve(profile,engine),engine==='chromium'?
   {...options,executablePath:'/usr/bin/chromium',chromiumSandbox:true}:options);
  try{
   let user=accountA;
   await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
   await installRequiredAccountFixture(context,origin);
   await context.route(origin+'/telegram-config.json',r=>r.fulfill({json:{}}));
   await context.route(origin+'/api/account-auth/get-session',r=>{
    if(offline)return r.abort();
    const now=new Date().toISOString();
    return r.fulfill({json:user?{user:{id:user,name:'Cuenta sintética',email:'t26@example.test',emailVerified:true},
     session:{id:user,token:'TESTONLY',userId:user,expiresAt:new Date(Date.now()+3600000).toISOString(),createdAt:now,updatedAt:now}}:null});
   });
   await context.route(origin+'/api/account-auth/sign-out',r=>{user=null;return r.fulfill({json:{success:true}});});
   await context.route(origin+'/api/account-profile',r=>r.fulfill({json:{accountId:user,telegramPhone:null,revision:null}}));
   await context.route(origin+'/api/account-library',r=>{
    if(user===accountA)return r.fallback();
    const document=r.request().method()==='PUT'?r.request().postDataJSON().document:{version:1,tracks:[],playlists:[]};
    return r.fulfill({json:{accountId:user,revision:r.request().method()==='PUT'?1:null,document}});
   });
   await context.addInitScript(blockWorker=>{
    if(blockWorker)try{delete Navigator.prototype.serviceWorker;}catch{}
    window.catalogAttempts=[];
    const fetchNative=window.fetch.bind(window),revoke=URL.revokeObjectURL.bind(URL);window.revoked=[];
    window.fetch=(input,init)=>{
     const url=new URL(typeof input==='string'?input:input.url??input,location.href);
     if(url.pathname==='/catalog-config.json'||url.pathname.startsWith('/catalog/')||/itunes\.apple\.com|mzstatic\.com|lrclib\.net/.test(url.hostname))window.catalogAttempts.push(url.pathname);
     return fetchNative(input,init);
    };
    URL.revokeObjectURL=url=>{window.revoked.push(url);revoke(url);};
    if(!navigator.mediaSession)Object.defineProperty(navigator,'mediaSession',{value:{setActionHandler(){}}});
    if(!window.MediaMetadata)window.MediaMetadata=class{constructor(value){Object.assign(this,value);}};
   },!timed);
   let page=await newPage();
   await page.goto(origin+'/'+fixture);
   const ids=await page.evaluate(two=>window.seedPersistentCache(two),!timed);
   const initial=await observe(page,origin,'cold-online');
   if(timed)assert.equal(initial.count,30);
   if(timed)await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:10000});
   if(!timed)await check('Interfaz · navegación, playlist y biblioteca conservan su estructura',async()=>{
    const view=await page.evaluate(()=>{
     const text=q=>[...document.querySelectorAll(q)].map(node=>node.textContent.trim());
     return {navigation:text('.shell-nav button span'),playlist:text('.library-detail h2,.library-detail h3'),
      rows:text('.library-detail .collection-track-main strong'), rowActions:document.querySelectorAll('.library-detail .track-actions-trigger').length};
    });
    report.interface[engine]=view;
    assert.deepEqual(view.navigation,['Inicio','Buscar','Biblioteca']);
    assert.equal(view.rows.length,30);
    assert.deepEqual(view.rows,Array.from({length:30},(_,i)=>'Portada '+String(i+1).padStart(2,'0')));
   });
   if(!timed)await check('C01 · almacén independiente y representación binaria',async()=>{
    const store=await inspect(page);assert.ok(store,'falta IndexedDB dedicada');
    assert.deepEqual(Object.keys(store),['artwork','catalog','meta']);
    assert.equal(store.artwork.filter(x=>x.artworkKey.includes('/fixture/')).length,30);
    assert.ok(store.artwork.every(x=>x.binary&&x.accountId===accountA&&/^[0-9a-f]{64}$/.test(x.sha256)));
   });
   page=await closeAndReopen(page);requests.length=0;
   const online=await observe(page,origin,'reopen-online');
   if(!timed)await check('C03 · reapertura de playlist sin tráfico',async()=>{
    assert.equal(online.count,30);assert.equal(online.imageRequests,0);
   });
   if(!timed)await ageArtwork(page,120);
   page=await closeAndReopen(page);requests.length=0;offline=true;
   await page.addInitScript(()=>Object.defineProperty(navigator,'onLine',{get:()=>false}));
   if(timed)await context.setOffline(true);
   const disconnected=await observe(page,origin,'reopen-offline');
   if(!timed)await check('C05 · reapertura offline con cero intentos',async()=>{
    assert.equal(disconnected.count,30);assert.equal(disconnected.attempts,0);assert.equal(disconnected.requests,0);
   });
   if(timed)continue;
   await ageArtwork(page,0);
   offline=false;page=await closeAndReopen(page);await navigate(page,origin);
   await library(page,'Favoritos');
   const inventory=await inspect(page,{opfs:true});
   const rowFor=title=>'.library-detail li:has(button[aria-label="Escuchar '+title+'"]) .collection-track-art img';
   const openPlayer=()=>page.getByRole('button',{name:'Abrir reproductor desde minirreproductor'}).click();
   const playerImg='.now-playing-view .artwork-panel img';
   const start=async()=>{
    await page.getByRole('button',{name:'Opciones de '+providerTitle,exact:true}).click();
    const menu=page.locator('dialog[open]');
    await menu.getByText('Información de la canción',{exact:true}).click();
    await menu.getByText('Copia local presente; se comprobará al reproducir.',{exact:true}).waitFor();
    await menu.getByRole('button',{name:'Cerrar opciones de canción'}).click();
    await page.getByRole('button',{name:'Escuchar '+providerTitle,exact:true}).click();
    await page.locator('.mini-player__title').filter({hasText:providerTitle}).waitFor();
    await openPlayer();await page.locator(playerImg).waitFor({timeout:12000});
   };
   let oldUrl;
   await check('C02 · normalización real de proveedor y metadatos acotados',async()=>{
    await start();oldUrl=await page.locator(playerImg).getAttribute('src');
    const store=await inspect(page);
    assert.ok(store?.artwork.some(x=>x.width===300&&x.height===200&&x.byteLength<=262144&&x.binary));
   });
   await check('K05 · portadas externas separadas de Biblioteca, OPFS y Cache API',async()=>{
    const after=await inspect(page,{opfs:true});
    assert.deepEqual(after,inventory);
    assert.ok((await inspect(page))?.artwork.length);
   });
   page=await closeAndReopen(page);requests.length=0;
   await navigate(page,origin);
   await library(page,'Favoritos');
   await check('C03 · proveedor reaparece en fila sin reproducir y en reproductor sin red',async()=>{
    const row=page.locator(rowFor(providerTitle));await row.waitFor({timeout:2000});
    assert.ok((await color(page,rowFor(providerTitle)))[0]>220);
    await start();
    assert.ok((await color(page,playerImg))[0]>220);
    const metadata=await page.evaluate(()=>navigator.mediaSession.metadata?.artwork?.[0]?.src);
    assert.ok(metadata?.startsWith('blob:'));
    await page.getByRole('button',{name:'Cerrar reproductor',exact:true}).click();
    assert.ok((await color(page,'.mini-player__cover img'))[0]>220);
    await page.getByRole('button',{name:'Opciones de '+providerTitle,exact:true}).click();
    assert.ok((await color(page,'dialog[open] .track-actions-art img'))[0]>220);
    await page.getByRole('button',{name:'Cerrar opciones de canción'}).click();
    await page.locator('.shell-nav').getByRole('button',{name:'Inicio',exact:true}).click();
    assert.ok((await color(page,'.home-recent button[aria-label="Preparar Descarga uno en pausa"] img'))[0]>220);
    assert.equal(requests.length,0);
    assert.ok((await inspect(page)).catalog.some(x=>x.kind==='track-artwork-link'));
   });
   const closePlayer=page.getByRole('button',{name:'Cerrar reproductor',exact:true});
   if(await closePlayer.isVisible())await closePlayer.click();
   await library(page,'Favoritos');
   await check('C04 · manual visible u oculta gana con caché persistente caliente',async()=>{
    assert.deepEqual(await color(page,rowFor('Portada manual')),[20,60,230]);
    assert.equal(await page.locator(rowFor('Portada oculta')).count(),0);
    assert.ok((await inspect(page))?.artwork.some(x=>x.artworkKey.includes('/catalog/')));
   });
   await check('C04 · la portada incrustada gana incluso en una vista de edición',async()=>{
    const cover=await newPage();
    try{
     await cover.goto(origin+'/'+fixture);
     const from=requests.length;
     await cover.evaluate(([visible,hidden])=>window.showEmbedded(visible,hidden),[ids['Portada manual'],ids['Portada oculta']]);
     await cover.locator('.embedded img').waitFor();
     await cover.locator('.hidden').waitFor({state:'attached'});
     assert.deepEqual(await color(cover,'.embedded img'),[20,60,230]);
     assert.equal(await cover.locator('.hidden img').count(),0);
     assert.equal(requests.length,from);
    }finally{await cover.close();}
   });
   await check('C06 · cambio de cuenta y cierre de sesión purgan persistencia',async()=>{
    const localBefore=await inspect(page,{opfs:true});
    assert.ok((await inspect(page))?.artwork.some(x=>x.accountId===accountA));
    const previous=await page.locator(rowFor(providerTitle)).getAttribute('src');
    const from=requests.length;
    user=accountB;await accountChange(page);
    await page.waitForFunction(id=>JSON.parse(localStorage.getItem('pulso-account:confirmed-profile:v1'))?.user?.id===id,accountB);
    await page.waitForFunction(url=>window.revoked.includes(url),previous??oldUrl);
    assert.ok(Object.values(await inspect(page)).every(rows=>rows.every(x=>x.accountId!==accountA)));
    await library(page,'Favoritos');
    await page.locator(rowFor('Portada de la otra cuenta')).waitFor();
    assert.ok(requests.slice(from).some(x=>x.path==='/catalog/artwork'),'B obtiene su propia copia de la misma URL');
    assert.notEqual(await page.locator(rowFor('Portada de la otra cuenta')).getAttribute('src'),previous);
    await start();await page.locator(playerImg).waitFor();
    assert.ok((await inspect(page)).artwork.some(x=>x.accountId===accountB));
    if(await closePlayer.isVisible())await closePlayer.click();
    await page.locator('.shell-nav').getByRole('button',{name:'Inicio',exact:true}).click();
    await page.getByRole('button',{name:'Mi cuenta',exact:true}).click();
    await page.getByRole('button',{name:'Cerrar sesión de Pulso'}).click();
    await page.waitForFunction(()=>!JSON.parse(localStorage.getItem('pulso-account:confirmed-profile:v1')));
    assert.ok(Object.values(await inspect(page)).every(rows=>rows.every(x=>x.accountId!==accountB)));
    assert.deepEqual(await inspect(page,{opfs:true}),localBefore);
   });
   await check('C02 · desalojo real por cantidad y degradación ante cuota',async()=>{
    user=accountA;await accountChange(page);
    await page.waitForFunction(id=>JSON.parse(localStorage.getItem('pulso-account:confirmed-profile:v1'))?.user?.id===id,accountA);
    await library(page,'Treinta portadas');
    await page.waitForFunction(selector=>document.querySelectorAll(selector).length===30,rowSelector);
    const cache=await inspect(page);assert.ok(cache?.artwork.length,'falta la caché para sembrar la prueba de cota');
    await page.evaluate(async({cacheName,accountA})=>{
     const db=await new Promise((ok,fail)=>{const req=indexedDB.open(cacheName);req.onsuccess=()=>ok(req.result);req.onerror=fail;});
     try{
      await new Promise((ok,fail)=>{
       const tx=db.transaction(['artwork','catalog','meta'],'readwrite'),store=tx.objectStore('artwork');
       tx.oncomplete=ok;tx.onabort=()=>fail(tx.error);
       store.getAll().onsuccess=({target:{result:[sample]}})=>{
        store.clear();tx.objectStore('catalog').clear();
        for(let i=0;i<800;i++)store.put({...sample,artworkKey:'old-'+i,accountId:accountA,lastAccessedAt:i,fetchedAt:i,providerKey:undefined});
        tx.objectStore('meta').put({accountId:accountA,artworkCount:800,artworkBytes:800*sample.byteLength});
       };
      });
     }finally{db.close();}
    },{cacheName,accountA});
    page=await closeAndReopen(page);
    await observe(page,origin,'after-seeding-lru');
    const compact=await inspect(page);
    assert.ok(compact.artwork.length>=640&&compact.artwork.length<670);
    assert.ok(compact.artwork.some(x=>x.artworkKey==='old-799'));
    assert.ok(!compact.artwork.some(x=>x.artworkKey==='old-0'));
    page=await closeAndReopen(page);
    await page.addInitScript(()=>{
     const put=IDBObjectStore.prototype.put;
     IDBObjectStore.prototype.put=function(...args){
      if(this.transaction.db.name==='pulso-web-cache-v1'&&this.name==='artwork'){
       window.injectedCacheQuota=true;throw new DOMException('Cuota sintética','QuotaExceededError');
      }
      return put.apply(this,args);
     };
    });
    await navigate(page,origin);
    await page.evaluate(async cacheName=>{
     const db=await new Promise((ok,fail)=>{const req=indexedDB.open(cacheName);req.onsuccess=()=>ok(req.result);req.onerror=fail;});
     await new Promise((ok,fail)=>{
      const tx=db.transaction(['artwork','meta'],'readwrite');
      tx.objectStore('artwork').clear();tx.objectStore('meta').clear();tx.oncomplete=ok;tx.onabort=()=>fail(tx.error);
     });db.close();
    },cacheName);
    await library(page,'Treinta portadas');
    await page.waitForFunction(selector=>document.querySelectorAll(selector).length===30,rowSelector);
    assert.equal(await page.evaluate(()=>window.injectedCacheQuota),true);
   });
  }finally{await context.close();context=null;}
 }
}finally{
 await context?.close();await server?.close();
 report.cleanup=await workspace.cleanup();
 await writeFile(resolve(workspace.evidence,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log('Evidence',workspace.evidence);
}
if(report.errors.length||report.cases.some(x=>x.status==='FAIL'))process.exitCode=1;
