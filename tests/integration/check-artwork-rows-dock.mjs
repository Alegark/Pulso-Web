import assert from 'node:assert/strict';
import {mkdir,mkdtemp,open,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {deflateSync} from 'node:zlib';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {build,preview} from 'vite';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';
import {createTestWorkspace} from './test-workspace.mjs';

const fixture='tests/integration/artwork-rows-dock-fixture.html';
const workspace=await createTestWorkspace('artwork-rows-dock');
const report={cases:[],errors:[],requests:[],geometry:[],engines:{}};
const colors={remote:[240,30,50,255],catalog:[20,200,70,255],manual:[20,60,230,255],secondAccount:[160,50,220,255]};
function png(rgba){
 function chunk(type,bytes){
  const payload=Buffer.concat([Buffer.from(type),bytes]),size=Buffer.alloc(4),crc=Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);let value=0xffffffff;
  for(const byte of payload){
   value^=byte;
   for(let i=0;i<8;i++)value=(value>>>1)^(value&1?0xedb88320:0);
  }
  crc.writeUInt32BE((value^0xffffffff)>>>0);
  return Buffer.concat([size,payload,crc]);
 }
 const dimensions=Buffer.from([0,0,0,2,0,0,0,2,8,6,0,0,0]),row=Buffer.from([0,...rgba,...rgba]);
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',dimensions),
  chunk('IDAT',deflateSync(Buffer.concat([row,row]))),chunk('IEND',Buffer.alloc(0))]);
}
const images=Object.fromEntries(Object.entries(colors).map(([key,rgba])=>[key,png(rgba)]));
const titles=['Descarga uno','Descarga dos'];
const provider='https://is1-ssl.mzstatic.com/image/thumb/Music/remote/100x100bb.png';
const artist='Intérprete de prueba';
let server,engine,tempDirectory;
let remoteCover='remote';
const previousTemp=process.env.TMPDIR;
function mockProvider(req,res,next){
 const url=new URL(req.url,'http://127.0.0.1');
 const send=(type,body)=>{res.setHeader('Content-Type',type);res.end(body);};
 const json=value=>send('application/json',JSON.stringify(value));
 if(url.pathname==='/catalog-config.json'){
  report.requests.push({engine,kind:'config'});
  return json({version:1,itunes:true,artwork:true});
 }
 if(url.pathname==='/__artwork/manual.png')return send('image/png',images.manual);
 if(url.pathname==='/catalog/itunes/search'){
  const term=url.searchParams.get('term'),title=titles.find(title=>term===title+' '+artist);
  report.requests.push({engine,kind:'search',term});
  const results=title?[{wrapperType:'track',kind:'song',trackName:title,artistName:artist,collectionName:'Edición de prueba',
   collectionId:42,trackTimeMillis:45000,artworkUrl100:provider}]:[];
  return json({resultCount:results.length,results});
 }
 if(url.pathname==='/catalog/artwork'){
  const source=url.searchParams.get('u');
  report.requests.push({engine,kind:'image',source});
  return send('image/png',source?.includes('/catalog/')?images.catalog:images[remoteCover]);
 }
 next();
}

async function check(name,run){
 try{await run();report.cases.push({engine,name,status:'PASS'});}
 catch(error){report.cases.push({engine,name,status:'FAIL',error:String(error.stack??error)});}
 console.log(engine,report.cases.at(-1).status,name,report.cases.at(-1).error?.split('\n')[0]??'');
}

async function pixel(page,image,expected,timeout=2500){
 const locator=page.locator(image);
 await locator.waitFor({state:'attached',timeout});
 const rgba=await locator.evaluate(async img=>{
  await img.decode();
  const canvas=document.createElement('canvas');canvas.width=canvas.height=2;
  const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
  return [...ctx.getImageData(0,0,1,1).data];
 });
 assert.deepEqual(rgba,expected,image);
 return locator.getAttribute('src');
}

async function artworkState(page,ids){
 return page.evaluate(async ids=>{
  const db=await new Promise((resolve,reject)=>{
   const req=indexedDB.open('pulso-web-local-v1');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  const settings=db.transaction('settings').objectStore('settings');
  const rows=await Promise.all(ids.map(id=>new Promise((resolve,reject)=>{
   const req=settings.get('artwork:v1:'+id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  })));
  db.close();
  async function inventory(dir,prefix=''){
   const entries=[];
   for await(const [name,handle] of dir.entries()){
    const path=prefix+name;
    if(handle.kind==='directory')entries.push(...await inventory(handle,path+'/'));
    else entries.push([path,(await handle.getFile()).size]);
   }
   return entries.sort();
  }
  const opfs=navigator.storage?.getDirectory?await inventory(await navigator.storage.getDirectory()):null;
  return {idb:rows.map(row=>[row?.revision,row?.state,row?.blob?.size]),opfs,cacheNames:await caches.keys()};
 },ids);
}

try{
 const profile=resolve(workspace.dir,'profiles');
 await mkdir(profile);
 tempDirectory=await open(profile);
 const out=resolve(workspace.dir,'bundle');
 await build({configFile:false,plugins:[tailwindcss()],logLevel:'error',build:{outDir:out,
  rolldownOptions:{input:[resolve('index.html'),resolve(fixture)]}}});
 server=await preview({configFile:false,build:{outDir:out},preview:{host:'127.0.0.1',port:0},
  plugins:[{name:'loopback-catalog-fixture',configurePreviewServer(server){server.middlewares.use(mockProvider);}}]});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 for(const [name,launcher] of Object.entries({chromium,webkit})){
  engine=name;
  process.env.TMPDIR=name==='chromium'?`/proc/${process.pid}/fd/${tempDirectory.fd}`:profile;
  const launch={headless:true,proxy:{server:'http://127.0.0.1:9',bypass:'127.0.0.1,localhost'}};
  const browser=name==='chromium'?await launcher.launch({...launch,executablePath:'/usr/bin/chromium',chromiumSandbox:true}):null;
  const inPage=async(run,offline=false)=>{
   const options={viewport:{width:390,height:844},serviceWorkers:'block',hasTouch:true,isMobile:true};
   // WebKit ephemeral contexts reject Blob records in IndexedDB on this runner.
   const browserProfile=browser?null:await mkdtemp(resolve(profile,'webkit-'));
   let context;
   try{
    context=browser?await browser.newContext(options):await launcher.launchPersistentContext(browserProfile,{...launch,...options});
    report.engines[engine]=context.browser()?.version();
    await context.route('**/*',route=>{
     const url=new URL(route.request().url());
     if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();
     if(url.origin==='https://lrclib.net')return route.fulfill({json:[],headers:{'access-control-allow-origin':'*'}});
     report.errors.push({engine,external:url.origin});return route.abort();
    });
    await installRequiredAccountFixture(context,origin);
    await context.addInitScript(offline=>{
     try{delete Navigator.prototype.serviceWorker;}catch{}
     window.fixtureOffline=offline;
     Object.defineProperty(navigator,'onLine',{get:()=>!window.fixtureOffline});
     if(!navigator.mediaSession)Object.defineProperty(navigator,'mediaSession',{value:{setActionHandler(){}}});
     if(!window.MediaMetadata)window.MediaMetadata=class{constructor(value){Object.assign(this,value);}};
     const revoke=URL.revokeObjectURL.bind(URL);window.revokedArtworkUrls=new Set();
     URL.revokeObjectURL=url=>{window.revokedArtworkUrls.add(url);revoke(url);};
    },offline);
    const page=await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(25000);
    page.on('pageerror',error=>report.errors.push({engine,error:String(error)}));
    await run(page);
   }finally{
    await context?.close();
    if(browserProfile)await rm(browserProfile,{recursive:true});
   }
  };
  const favorites=async page=>{
   await page.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();
   await page.locator('.library-grid button').filter({hasText:'Favoritos'}).click();
   await page.getByRole('heading',{name:'Favoritos',exact:true}).waitFor();
  };
  const seed=async(page,secondAccountId)=>{
   await page.goto(origin+'/'+fixture);
   const ids=await page.evaluate(id=>artworkDockFixture.seed(id),secondAccountId);
   await page.goto(origin);await favorites(page);
   return ids;
  };
  const rowArt=title=>`.library-detail .tracks>li:has(button[aria-label="Escuchar ${title}"]) .collection-track-art img`;
  const playerArt='.now-playing-view .artwork-panel img',miniArt='.mini-player__cover img';
  const start=async(page,title)=>{
   await page.getByRole('button',{name:'Opciones de '+title,exact:true}).click();
   const menu=page.locator('dialog[open]');
   await menu.getByText('Información de la canción',{exact:true}).click();
   await menu.getByText('Copia local presente; se comprobará al reproducir.',{exact:true}).waitFor();
   await menu.getByRole('button',{name:'Cerrar opciones de canción'}).click();
   await page.getByRole('button',{name:'Escuchar '+title,exact:true}).click();
   await page.locator('.mini-player__title').filter({hasText:title}).waitFor();
  };
  const open=page=>page.getByRole('button',{name:'Abrir reproductor desde minirreproductor'}).click();
  const close=page=>page.getByRole('button',{name:'Cerrar reproductor',exact:true}).click();
  const requests=()=>report.requests.slice().filter(req=>req.engine===engine);
  const disconnect=page=>page.evaluate(()=>{window.fixtureOffline=true;window.dispatchEvent(new Event('offline'));});
  try{
   await check('A01 · Favoritos, reproductor, MediaSession, mini y acciones comparten carátula temporal',()=>inPage(async page=>{
    const ids=await seed(page),trackIds=titles.map(title=>ids[title]),before=await artworkState(page,trackIds);
    assert.equal(requests().filter(req=>req.kind==='search').length,0);
    await start(page,titles[0]);await open(page);
    const playerUrl=await pixel(page,playerArt,colors.remote);
    await page.waitForFunction(url=>navigator.mediaSession.metadata?.artwork?.[0]?.src===url,playerUrl);
    await close(page);
    assert.equal(await page.locator(rowArt(titles[1])).count(),0);
    const views=await Promise.allSettled([pixel(page,rowArt(titles[0]),colors.remote),pixel(page,miniArt,colors.remote)]);
    await page.getByRole('button',{name:'Opciones de '+titles[0],exact:true}).click();
    views.push(...await Promise.allSettled([pixel(page,'dialog[open] .track-actions-art img',colors.remote)]));
    const failures=views.flatMap((view,i)=>view.status==='rejected'?[['fila','mini','acción'][i]+': '+view.reason.message]:[]);
    assert.deepEqual(failures,[]);
    await page.getByRole('button',{name:'Cerrar opciones de canción'}).click();
    const rowUrl=await page.locator(rowArt(titles[0])).getAttribute('src');
    await page.locator('.shell-nav').getByRole('button',{name:'Inicio',exact:true}).click();
    await page.waitForFunction(url=>revokedArtworkUrls.has(url),rowUrl);
    await favorites(page);
    await pixel(page,rowArt(titles[0]),colors.remote);
    assert.deepEqual(requests().filter(req=>req.kind==='search').map(req=>req.term),[titles[0]+' '+artist]);
    assert.deepEqual(await artworkState(page,trackIds),before);
   }));
   await check('A02 · Manual visible u oculta, catálogo y ausencia de red offline',()=>inPage(async page=>{
    const from=requests().length;
    await seed(page);
    for(const [title,color] of [['Portada de catálogo',colors.catalog],['Portada manual',colors.manual]]){
     await pixel(page,rowArt(title),color);
     await start(page,title);await open(page);await pixel(page,playerArt,color);await close(page);
     await pixel(page,miniArt,color);
    }
    await start(page,'Portada oculta');await open(page);
    assert.equal(await page.locator(playerArt).count(),0);
    await close(page);
    assert.equal(await page.locator(rowArt('Portada oculta')).count(),0);
    assert.equal(await page.locator(miniArt).count(),0);
    await disconnect(page);
    await start(page,titles[1]);await open(page);
    await page.waitForTimeout(1200);
    assert.deepEqual(requests().slice(from).filter(req=>req.kind==='search'||req.source?.includes('/remote/')),[]);
    assert.equal(await page.locator(playerArt).count(),0);
   }));
   await check('A02a · Una carátula de catálogo fría no abre la red offline',()=>inPage(async page=>{
    const from=requests().length,title='Portada de catálogo';
    await seed(page);
    assert.equal(await page.evaluate(()=>navigator.onLine),false);
    await start(page,title);await open(page);
    await page.waitForTimeout(1200);
    assert.deepEqual(requests().slice(from),[]);
    assert.equal(await page.locator(playerArt).count(),0);
    await close(page);
    assert.equal(await page.locator(rowArt(title)).count(),0);
    assert.equal(await page.locator(miniArt).count(),0);
   },true));
   await check('A02b · Las vistas recuperan la carátula de catálogo en RAM offline',()=>inPage(async page=>{
    const title='Portada de catálogo';
    await seed(page);
    const rowUrl=await pixel(page,rowArt(title),colors.catalog);
    assert.ok(requests().some(req=>req.kind==='image'&&req.source.includes('/catalog/')));
    const from=requests().length;
    await page.locator('.shell-nav').getByRole('button',{name:'Inicio',exact:true}).click();
    await page.waitForFunction(url=>revokedArtworkUrls.has(url),rowUrl);
    await disconnect(page);await favorites(page);
    await start(page,title);await open(page);
    await pixel(page,playerArt,colors.catalog);await close(page);
    const views=await Promise.allSettled([pixel(page,rowArt(title),colors.catalog),pixel(page,miniArt,colors.catalog)]);
    await page.getByRole('button',{name:'Opciones de '+title,exact:true}).click();
    views.push(...await Promise.allSettled([pixel(page,'dialog[open] .track-actions-art img',colors.catalog)]));
    assert.deepEqual(views.flatMap((result,i)=>result.status==='rejected'?[['fila','mini','acción'][i]]:[]),[]);
    assert.deepEqual(requests().slice(from),[]);
   }));
   await check('A02c · Un cambio de cuenta en el mismo documento descarta la memoria del proveedor',()=>inPage(async page=>{
    const users=[
     {id:'11111111-1111-4111-8111-111111111111',name:'Cuenta A TESTONLY',email:'fixture@example.test',emailVerified:true},
     {id:'22222222-2222-4222-8222-222222222222',name:'Cuenta B TESTONLY',email:'fixture-b@example.test',emailVerified:true},
    ];
    let user=users[0];
    const context=page.context();
    await context.route(origin+'/api/account-auth/get-session',route=>{
     const now=new Date().toISOString();
     return route.fulfill({json:{user,session:{id:user.id,token:'TESTONLY',
      userId:user.id,expiresAt:new Date(Date.now()+3600000).toISOString(),createdAt:now,updatedAt:now}}});
    });
    await context.route(origin+'/api/account-profile',route=>route.fulfill({json:{accountId:user.id,telegramPhone:null,revision:null}}));
    let library={accountId:users[1].id,revision:null,document:{version:1,tracks:[],playlists:[]}};
    await context.route(origin+'/api/account-library',route=>{
     if(user!==users[1])return route.fallback();
     if(route.request().method()==='PUT'){
      const input=route.request().postDataJSON();
      if(input.accountId!==user.id||input.revision!==library.revision)return route.fulfill({status:409,json:{code:'LIBRARY_CHANGED'}});
      library={accountId:user.id,revision:(library.revision??0)+1,document:input.document};
     }
     return route.fulfill({json:library});
    });
    try{
     const title=titles[0],from=requests().length;
     await seed(page,users[1].id);
     const documentId=await page.evaluate(()=>window.fixtureDocumentId=crypto.randomUUID());
     await start(page,title);await open(page);
     const oldUrl=await pixel(page,playerArt,colors.remote,8000);await close(page);
     user=users[1];
     remoteCover='secondAccount';
     // Deliver the same session-change notification as another tab.
     await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{
      key:'pulso-account:changed:v1',
      newValue:JSON.stringify({version:1,type:'changed',source:crypto.randomUUID()}),
     })));
     await page.waitForFunction(id=>JSON.parse(localStorage.getItem('pulso-account:confirmed-profile:v1'))?.user?.id===id,user.id);
     await page.waitForFunction(url=>revokedArtworkUrls.has(url),oldUrl);
     await favorites(page);
     assert.equal(await page.evaluate(()=>window.fixtureDocumentId),documentId);
     assert.equal(await page.locator(rowArt(title)).count(),0);
     await start(page,title);await open(page);
     await pixel(page,playerArt,colors.secondAccount,8000);
     assert.deepEqual(requests().slice(from).filter(req=>req.kind==='search').map(req=>req.term),
      [title+' '+artist,title+' '+artist]);
    }finally{remoteCover='remote';}
   }));
   await check('A03 · 53/72 en una sola línea y dentro del dock a 100 % y 200 %',()=>inPage(async page=>{
    const failures=[];
    for(const width of [320,375,390,430]){
     await page.setViewportSize({width,height:844});
     await page.goto(origin+'/'+fixture+'?dock');
     await page.evaluate(()=>localStorage.removeItem('pulso:download-dock-position:v1'));
     await page.reload();
     const handle=page.locator('.download-dock__handle');
     await page.evaluate(()=>artworkDockFixture.showDownload(1,2));
     await handle.getByText('1/2',{exact:true}).waitFor();
     await handle.press('ArrowRight');
     await page.evaluate(()=>artworkDockFixture.showDownload(53,72));
     const counter=handle.getByText('53/72',{exact:true});
     for(const scale of [100,200]){
      await page.evaluate(scale=>{document.documentElement.style.fontSize=scale+'%';},scale);
      const geometry=await counter.evaluate(async node=>{
       await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
       const range=new Range();range.selectNodeContents(node);
       const lines=[...range.getClientRects()],dock=node.closest('.download-dock'),box=dock.getBoundingClientRect();
       return {lines:lines.map(({left,right,top,bottom})=>({left,right,top,bottom})),left:box.left,right:box.right,
        scroll:dock.scrollWidth,client:dock.clientWidth,numerals:getComputedStyle(node).fontVariantNumeric,
        fontSize:parseFloat(getComputedStyle(document.documentElement).fontSize),viewport:innerWidth};
      });
      report.geometry.push({engine,width,scale,...geometry});
      if(new Set(geometry.lines.map(line=>line.top)).size!==1||geometry.fontSize!==16*scale/100||geometry.viewport!==width||
         !geometry.numerals.split(' ').includes('tabular-nums')||geometry.left<0||geometry.right>width+.5||
         geometry.scroll>geometry.client+1||geometry.lines.some(line=>line.left<geometry.left||line.right>geometry.right))
       failures.push({width,scale,geometry});
     }
    }
    assert.deepEqual(failures,[]);
   }));
  }finally{await browser?.close();}
 }
}catch(error){report.fatal=String(error.stack??error);}
finally{
 if(server)await new Promise((done,reject)=>server.httpServer.close(error=>error?reject(error):done()));
 if(previousTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTemp;
 await tempDirectory?.close();
 report.cleanup=await workspace.cleanup();
 await writeFile(resolve(workspace.evidence,'report.json'),JSON.stringify(report,null,2));
 console.log(workspace.evidence);
 if(report.fatal||report.errors.length||report.cases.length!==12||report.cases.some(row=>row.status==='FAIL')){
  console.error(report.fatal??JSON.stringify(report.errors));process.exitCode=1;
 }
}
