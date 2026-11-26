import assert from 'node:assert/strict';
import {mkdir,mkdtemp,open,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {build,preview} from 'vite';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';
import {createTestWorkspace} from './test-workspace.mjs';

const fixture='tests/integration/player-notice-fixture.html';
const workspace=await createTestWorkspace('startup-splash');
const report={cases:[],errors:[],engines:{}};
const checking='Comprobando tu sesión…';
const preparing='Preparando cola…';
const restored='Cola lista y pausada.';
const miniPlayer='Mini reproductor';
const previousTemp=process.env.TMPDIR;
let server,profileDirectory;

// Playwright considers a clipped 1 px region visible, so check its painted box.
function isPainted(node){
 const css=getComputedStyle(node),box=node.getBoundingClientRect();
 return css.visibility==='visible'&&box.width>0&&box.height>0&&css.clipPath==='none';
}

async function seedQueue(page,origin,partial=false){
 await page.goto(`${origin}/${fixture}`);
 await page.waitForFunction(()=>typeof window.setupCollectionFixture==='function');
 await page.evaluate(async partial=>{
  await window.setupCollectionFixture();
  const {rows}=JSON.parse(sessionStorage.getItem('test-own-fixture'));
  const db=await new Promise((done,fail)=>{
   const request=indexedDB.open('pulso-web-local-v1');
   request.onsuccess=()=>done(request.result);request.onerror=()=>fail(request.error);
  });
  try{await new Promise((done,fail)=>{
   const tx=db.transaction(['tracks','settings'],'readwrite');
   const entries=[{id:'available',trackId:rows[2].track}];
   if(partial){
    entries.push({id:'missing',trackId:rows[0].track});
    const store=tx.objectStore('tracks'),track=store.get(rows[0].track);
    track.onsuccess=()=>store.put({...track.result,assetId:null},rows[0].track);
   }
   tx.objectStore('settings').put({version:1,entries,currentEntryId:'available',position:2,repeat:'off',
    shuffleOrder:partial?['invalid']:null},'library-playback');
   tx.oncomplete=done;tx.onabort=()=>fail(tx.error);
  });}finally{db.close();}
 },partial);
}

const mini=page=>page.getByRole('region',{name:miniPlayer});
const announcement=(parent,text)=>parent.getByRole('status').filter({hasText:text});
const assertQuiet=async page=>{
 const trace=await page.evaluate(()=>window.startupNotices);
 assert.deepEqual(trace.filter(entry=>entry.painted),[],'Un aviso ocupó espacio sobre el minirreproductor');
 assert.equal(await mini(page).getByRole('button',{name:'Cerrar aviso',exact:true}).count(),0);
 return trace;
};

try{
 const profiles=resolve(workspace.dir,'profiles'),out=resolve(workspace.dir,'bundle');
 await mkdir(profiles);profileDirectory=await open(profiles);
 await build({configFile:false,plugins:[tailwindcss()],logLevel:'error',build:{outDir:out,
  rolldownOptions:{input:[resolve('index.html'),resolve(fixture)]}}});
 server=await preview({configFile:false,build:{outDir:out},preview:{host:'127.0.0.1',port:0}});
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 for(const [engine,launcher] of Object.entries({chromium,webkit})){
  process.env.TMPDIR=engine==='chromium'?`/proc/${process.pid}/fd/${profileDirectory.fd}`:profiles;
  const launch={headless:true,proxy:{server:'http://127.0.0.1:9',bypass:'127.0.0.1,localhost'}};
  const browser=engine==='chromium'?await launcher.launch({...launch,executablePath:'/usr/bin/chromium',chromiumSandbox:true}):null;
  async function check(requirement,run,{width=390,failKey=null}={}){
   const options={viewport:{width,height:844},hasTouch:true,isMobile:true,serviceWorkers:'block'};
   const profile=browser?null:await mkdtemp(resolve(profiles,'webkit-'));
   let context;
   try{
    context=browser?await browser.newContext(options):await launcher.launchPersistentContext(profile,{...launch,...options});
    context.setDefaultTimeout(20000);
    report.engines[engine]=context.browser().version();
    await context.route('**/*',route=>{
     const url=new URL(route.request().url());
     if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();
     const headers={'access-control-allow-origin':'*','access-control-allow-headers':'Lrclib-Client'};
     if(url.origin==='https://itunes.apple.com')return route.fulfill({json:{resultCount:0,results:[]},headers});
     if(url.origin==='https://lrclib.net')return route.fulfill({json:[],headers});
     report.errors.push({engine,external:url.origin});return route.abort();
    });
    await installRequiredAccountFixture(context,origin);
    await context.addInitScript(failKey=>{
     try{delete Navigator.prototype.serviceWorker;}catch{}
     if(location.pathname!=='/')return;
     window.startupNotices=[];
     window.failedQueueReads=0;
     const get=IDBObjectStore.prototype.get;
     IDBObjectStore.prototype.get=function(key){
      if(this.name==='settings'&&key===failKey){
       ++window.failedQueueReads;
       throw new DOMException('TESTONLY: queue read failed','UnknownError');
      }
      return get.call(this,key);
     };
     const NativeAudio=window.Audio;
     window.Audio=class extends NativeAudio{constructor(...args){super(...args);window.startupAudio=this;}};
     let previous='';
     new MutationObserver(()=>{
      const records=[...document.querySelectorAll('.mini-player [role="status"]')].flatMap(node=>{
       if(!node.textContent?.trim())return [];
       const {width,height}=node.getBoundingClientRect(),css=getComputedStyle(node);
       return [{text:node.textContent,painted:css.visibility==='visible'&&width>0&&height>0&&css.clipPath==='none'}];
      });
      const current=JSON.stringify(records);
      if(previous!==current){window.startupNotices.push(...records);previous=current;}
     }).observe(document,{subtree:true,childList:true,characterData:true,attributes:true});
    },failKey);
    const page=context.pages()[0]??await context.newPage();
    page.on('pageerror',error=>report.errors.push({engine,requirement,error:String(error)}));
    const details=await run(page,context);
    report.cases.push({engine,requirement,width,status:'PASS',details});
    console.log(engine,requirement,'PASS');
   }catch(error){
    report.cases.push({engine,requirement,width,status:'FAIL',error:String(error.stack??error)});
    console.log(engine,requirement,'FAIL',String(error).split('\n').slice(0,4).join(' '));
   }finally{
    await context?.close();
    if(profile)await rm(profile,{recursive:true});
   }
  }
  async function waitRestored(page){
   await announcement(mini(page),restored).waitFor({state:'attached'});
   await page.waitForFunction(()=>window.startupAudio.paused&&window.startupAudio.readyState>0&&
    Math.abs(window.startupAudio.currentTime-2)<.15);
  }
  async function openFavorites(page){
   await page.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();
   await page.locator('.library-grid').getByRole('button',{name:/Favoritos/}).click();
  }
  try{
   // Open at each device width. WebKit's mobile emulation can retain the
   // original layout viewport when a page already open is resized.
   for(const width of [320,390,430])await check('E01',async(page,context)=>{
    const firstResponse=Promise.withResolvers();
    let checks=0;
    // The fixture holds the real configuration response while measuring both
    // themes. Keep the production fetch deadline out of that measurement.
    await context.addInitScript(()=>{
     const fetch=window.fetch;
     window.fetch=(input,options)=>fetch(input,input==='/account-config.json'?{...options,signal:undefined}:options);
    });
    await context.route(`${origin}/account-config.json`,async route=>{
     if(++checks>1)return route.fallback();
     await firstResponse.promise;
     return route.fulfill({status:503});
    });
    await context.route(`${origin}/api/account-auth/get-session`,route=>route.fulfill({json:null}));
    try{
     await page.goto(origin);
     const dialog=page.getByRole('dialog',{name:'Tu acceso a Pulso'});
     const status=announcement(dialog,checking);
     await status.waitFor({state:'attached'});
     assert.match(await dialog.ariaSnapshot(),/status: Comprobando tu sesión/);
     assert.equal(await status.evaluate(isPainted),false,'El estado de sesión ocupa espacio visible');
     const logo=dialog.locator('img[src="/icons/pulso-192.png"]');
     await logo.waitFor();
     await page.waitForFunction(()=>document.querySelector('dialog[open] img')?.naturalWidth===192);
     // Mutate the existing same-origin stylesheet without relaxing the app's CSP.
     await page.evaluate(()=>{
      const sheet=[...document.styleSheets].find(sheet=>sheet.href?.startsWith(location.origin));
      sheet.insertRule('html { font-size: 200% !important; }',sheet.cssRules.length);
     });
     for(const colorScheme of ['light','dark']){
      await page.emulateMedia({colorScheme,reducedMotion:'reduce'});
      const geometry=await logo.evaluate(el=>{
       const {x,y,width,height}=el.getBoundingClientRect();
       return {x,y,width,height,vw:innerWidth,vh:innerHeight,scroll:document.documentElement.scrollWidth,
        font:getComputedStyle(document.documentElement).fontSize,animation:getComputedStyle(el).animationName,
        background:getComputedStyle(el.closest('dialog')).backgroundColor};
      });
      assert.ok(Math.abs(geometry.x+geometry.width/2-geometry.vw/2)<=1,JSON.stringify(geometry));
      assert.ok(Math.abs(geometry.y+geometry.height/2-geometry.vh/2)<=1,JSON.stringify(geometry));
      assert.equal(geometry.vw,width);
      assert.equal(geometry.scroll,width);
      assert.equal(geometry.font,'32px');
      assert.equal(geometry.animation,'none');
      assert.equal(geometry.background,colorScheme==='dark'?'rgb(17, 22, 32)':'rgb(244, 246, 250)');
     }
    }finally{firstResponse.resolve();}
    const retry=page.getByRole('button',{name:'Reintentar conexión de cuenta'});
    await retry.waitFor();
    await page.getByRole('alert').filter({hasText:'No pudimos completar la conexión'}).waitFor();
    await retry.click();
    await page.locator('.account-dialog .account-kit').waitFor();
    assert.equal(checks,2);
    return {schemes:['light','dark'],font:'200%',reducedMotion:true,retry:true};
   },{width});
   await check('E02',async page=>{
    await seedQueue(page,origin);
    await page.goto(origin);
    await waitRestored(page);
    const startup=await page.evaluate(()=>window.startupNotices);
    const dismissAtStartup=await mini(page).getByRole('button',{name:'Cerrar aviso',exact:true}).count();
    await openFavorites(page);
    await page.getByRole('button',{name:'Opciones de Sintética 2'}).click();
    await page.getByRole('button',{name:'Añadir a continuación Sintética 2',exact:true}).click();
    await page.getByRole('button',{name:'Cerrar opciones de canción',exact:true}).click();
    const added=announcement(mini(page),'1 entradas añadidas a continuación.');
    await added.waitFor({state:'attached'});
    assert.equal(await added.evaluate(isPainted),false,'El aviso no ocupa espacio visible');
    assert.equal(await mini(page).locator('.shell-notice').count(),0);
    assert.equal(await mini(page).getByRole('button',{name:'Cerrar aviso',exact:true}).count(),0);
    assert.ok(startup.some(entry=>entry.text===preparing),JSON.stringify(startup));
    assert.deepEqual(startup.filter(entry=>entry.painted),[],'Aparecieron avisos al iniciar con una cola');
    assert.equal(dismissAtStartup,0);
    return {startup,manualNoticeVisible:false};
   });
   await check('L02',async page=>{
    await seedQueue(page,origin);
    await page.goto(origin);
    await waitRestored(page);
    await openFavorites(page);
    await page.getByRole('button',{name:'Escuchar Sintética 2',exact:true}).click();
    await page.waitForFunction(()=>!window.startupAudio.paused&&window.startupAudio.currentTime>.1);
    const trace=await page.evaluate(()=>window.startupNotices);
    assert.equal(trace.some(entry=>entry.painted&&entry.text.includes('Cola lista y pausada')),false);
    assert.equal((await mini(page).textContent()).includes('Cola lista y pausada'),false);
    return {manualPlaybackAdvanced:true,noVisibleQueueNotice:true};
   });
   await check('E03',async page=>{
    await seedQueue(page,origin,true);
    await page.goto(origin);
    await waitRestored(page);
    const status=announcement(mini(page),restored);
    const tree=await mini(page).ariaSnapshot();
    assert.match(tree,/status: Cola lista y pausada.*entradas sin audio se omitieron.*El orden aleatorio guardado no era válido/);
    assert.equal(await status.getAttribute('aria-live'),'polite');
    assert.equal(await status.evaluate(isPainted),false);
    assert.equal((await status.boundingBox()).height,1);
    return {startup:await assertQuiet(page),accessible:true};
   });
   await check('E04',async page=>{
    await seedQueue(page,origin);
    await page.goto(origin);
    await announcement(mini(page),/No se pudo leer la última posición|No se pudo abrir el almacenamiento/).waitFor({state:'attached'});
    assert.equal(await page.evaluate(()=>window.failedQueueReads),1);
    assert.match(await mini(page).ariaSnapshot(),/status: Cola lista y pausada.*No se pudo leer la última posición/);
    await waitRestored(page);
    return {startup:await assertQuiet(page),position:await page.evaluate(()=>window.startupAudio.currentTime)};
   },{failKey:'library-playback-position'});
   await check('E05',async page=>{
    await seedQueue(page,origin);
    await page.goto(origin);
    await announcement(mini(page),/No se pudo leer la cola guardada|No se pudo abrir el almacenamiento/).waitFor({state:'attached'});
    const failure=await mini(page).ariaSnapshot();
    const startup=await page.evaluate(()=>window.startupNotices);
    assert.equal(await page.evaluate(()=>window.failedQueueReads),1);
    await openFavorites(page);
    await page.getByRole('button',{name:'Escuchar Sintética 2',exact:true}).click();
    await page.waitForFunction(()=>!window.startupAudio.paused);
    assert.match(failure,/status: No se pudo leer la cola guardada/);
    assert.deepEqual(startup.filter(entry=>entry.painted),[]);
    return {startup,newSelectionPlaying:true};
   },{failKey:'library-playback'});
  }finally{await browser?.close();}
 }
}catch(error){report.fatal=String(error.stack??error);}
finally{
 if(server)await new Promise((done,fail)=>server.httpServer.close(error=>error?fail(error):done()));
 if(previousTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTemp;
 await profileDirectory?.close();
 report.cleanup=await workspace.cleanup();
 await writeFile(resolve(workspace.evidence,'report.json'),JSON.stringify(report,null,2));
 console.log(workspace.evidence);
 if(report.fatal||report.errors.length||report.cases.length!==14||report.cases.some(item=>item.status==='FAIL')){
  console.error(report.fatal??JSON.stringify(report.errors));process.exitCode=1;
 }
}
