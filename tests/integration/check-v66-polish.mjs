import assert from 'node:assert/strict';
import {mkdir,mkdtemp,open,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {build,preview} from 'vite';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';
import {createTestWorkspace} from './test-workspace.mjs';

const fixture='tests/integration/player-notice-fixture.html';
const albumFixture='tests/integration/v66-polish-fixture.html';
const workspace=await createTestWorkspace('v66-polish');
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
   const entries=[0,1,2].map((n)=>({id:n===0?'available':'entry-'+n,trackId:rows[n].track}));
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
 const searchFixture=resolve(workspace.dir,'search.html');
 await writeFile(searchFixture,'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/tests/integration/search-mobile-ui-fixture.tsx"></script>');
 await mkdir(profiles);profileDirectory=await open(profiles);
 await build({configFile:false,plugins:[tailwindcss()],logLevel:'error',build:{outDir:out,
  rolldownOptions:{input:[resolve('index.html'),resolve(fixture),resolve(albumFixture),searchFixture]}}});
 server=await preview({configFile:false,build:{outDir:out},preview:{host:'127.0.0.1',port:0}});
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 for(const [engine,launcher] of Object.entries({chromium,webkit})){
  process.env.TMPDIR=engine==='chromium'?`/proc/${process.pid}/fd/${profileDirectory.fd}`:profiles;
  const launch={headless:true,proxy:{server:'http://127.0.0.1:9',bypass:'127.0.0.1,localhost'}};
  const browser=engine==='chromium'?await launcher.launch({...launch,executablePath:'/usr/bin/chromium',chromiumSandbox:true}):null;
  async function check(requirement,run,{width=390,height=844,failKey=null}={}){
   const options={viewport:{width,height},hasTouch:width<600,isMobile:width<600,serviceWorkers:'block'};
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
  try{
   await check('v66-player-grabber',async page=>{
    await seedQueue(page,origin);await page.goto(origin);await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor({state:'attached'});
    const expand=page.locator('.mini-player__expand');
    assert.equal(await expand.locator('path').getAttribute('d'),'M15 4h5v5M9 20H4v-5M20 4l-6 6M4 20l6-6');
    await expand.click();const close=page.locator('.player-surface__grabber'),toolbar=page.locator('.player-surface__toolbar');
    const geometry=await page.evaluate(()=>{const toolbar=document.querySelector('.player-surface__toolbar').getBoundingClientRect(),close=document.querySelector('.player-surface__grabber').getBoundingClientRect(),art=document.querySelector('.np-art').getBoundingClientRect();return {width:close.width,height:close.height,center:Math.abs((close.left+close.right-toolbar.left-toolbar.right)/2),bottom:close.bottom,art:art.top,transport:document.querySelector('.np-transport').getBoundingClientRect().bottom,viewport:innerHeight,content:getComputedStyle(document.querySelector('.player-surface__grabber'),'::before').content};});
    assert.ok(geometry.width>=44&&geometry.height>=44&&geometry.center<1&&geometry.art>=geometry.bottom&&geometry.transport<=geometry.viewport,JSON.stringify(geometry));assert.notEqual(geometry.content,'"⌄"');
    await toolbar.dispatchEvent('pointerdown',{pointerId:8,isPrimary:true,pointerType:'touch',button:0,clientX:190,clientY:20});
    await close.click();await close.waitFor({state:'detached'});await expand.click();
    await toolbar.dispatchEvent('pointermove',{pointerId:8,isPrimary:true,pointerType:'touch',clientX:192,clientY:80});
    assert.equal(await close.count(),1,'Un gesto anterior no debe cerrar la reapertura');
    await toolbar.dispatchEvent('pointerdown',{pointerId:7,isPrimary:true,pointerType:'touch',button:0,clientX:190,clientY:20});
    await toolbar.dispatchEvent('pointermove',{pointerId:7,isPrimary:true,pointerType:'touch',clientX:192,clientY:80});
    await close.waitFor({state:'detached'});
   });
   await check('v66-album-cover-fallback',async page=>{
    await page.addInitScript(()=>{
     if(!location.pathname.endsWith('v66-polish-fixture.html'))return;
     const nativeRect=Element.prototype.getBoundingClientRect;
     Element.prototype.getBoundingClientRect=function(){
      if(this.classList.contains('collection-cover'))return {width:0,height:0,top:100000,bottom:100000,left:0,right:0,x:0,y:100000,toJSON(){return {};}};
      return nativeRect.call(this);
     };
     const callbacks=[];
     window.__v68False=()=>callbacks.forEach(callback=>callback([{isIntersecting:false}]));
     window.IntersectionObserver=class {
      constructor(callback){this.callback=callback;callbacks.push(callback);}
      observe(){queueMicrotask(()=>this.callback([{isIntersecting:true}]));}
      disconnect(){}
      unobserve(){}
      takeRecords(){return [];}
     };
    });
    await page.goto(`${origin}/${albumFixture}`);await page.waitForFunction(()=>typeof window.setupV66Albums==='function');await page.evaluate(()=>window.setupV66Albums());
    for(const selector of ['.fallback-cover img','.provider-cover img','.v68-album-fallback img'])await page.locator(selector).waitFor();
    assert.equal(await page.locator('.v68-track-hidden img').count(),0);
    assert.equal(await page.locator('.v68-manual-hidden img').count(),0);
    await page.locator('.v68-observed img').waitFor();
    await page.evaluate(()=>window.__v68False());
    await page.locator('.v68-observed img').waitFor();
    await page.goto(origin);await page.locator('.shell-nav').waitFor();
    const home=title=>page.locator('.home-albums button').filter({hasText:title});
    const library=title=>page.locator('.library-grid .collection-card').filter({hasText:title});
    const loaded=async card=>{await card.locator('img').waitFor();assert.equal(await card.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0),true);};
    for(const title of ['Álbum con portada','Álbum proveedor','Álbum sin archivo'])await loaded(home(title));
    await page.locator('.shell-nav').getByRole('button',{name:'Biblioteca'}).click();
    for(const title of ['Álbum con portada','Álbum proveedor','Álbum sin archivo'])await loaded(library(title));
    await page.locator('.mini-player__expand').click();await page.locator('.player-surface__grabber').click();
    for(const title of ['Álbum con portada','Álbum proveedor','Álbum sin archivo'])await loaded(library(title));
    await library('Álbum con portada').click();await page.locator('.library-detail:visible').waitFor();
    await page.getByRole('button',{name:'Volver a Biblioteca'}).click();
    for(const title of ['Álbum con portada','Álbum proveedor','Álbum sin archivo'])await loaded(library(title));
   });
  }finally{await browser?.close();}
 }
}catch(error){report.fatal=String(error.stack??error);}
finally{
 if(server)await new Promise((done,fail)=>server.httpServer.close(error=>error?fail(error):done()));
 if(previousTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTemp;
 await profileDirectory?.close();report.cleanup=await workspace.cleanup();
 await writeFile(resolve(workspace.evidence,'report.json'),JSON.stringify(report,null,2));console.log(workspace.evidence);
 if(report.fatal||report.errors.length||report.cases.length!==4||report.cases.some(item=>item.status==='FAIL'))process.exitCode=1;
}
