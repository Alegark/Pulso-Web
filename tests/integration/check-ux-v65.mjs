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
  rolldownOptions:{input:[resolve('index.html'),resolve(fixture),searchFixture]}}});
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
   await check('ux-v65-theme-oled',async page=>{
    await seedQueue(page,origin);await page.goto(origin);await page.locator('.shell-nav').waitFor();await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor({state:'attached'});
    assert.equal(await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const r=db.transaction('settings').objectStore('settings').get('theme');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}}),undefined);
    const colors=await page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return {background:getComputedStyle(document.documentElement).backgroundColor,surface:s.getPropertyValue('--pulso-surface').trim(),accent:s.getPropertyValue('--pulso-accent').trim(),text:s.getPropertyValue('--pulso-accent-text').trim()};});
    assert.equal(colors.background,'rgb(0, 0, 0)');assert.equal(colors.surface,'#0d0b0d');assert.equal(colors.accent,'#8c1630');assert.equal(colors.text,'#d84a67');
    const css=await page.evaluate(()=>[...document.styleSheets].flatMap(sheet=>{try{return [...sheet.cssRules].map(rule=>rule.cssText);}catch{return [];}}).join(' ').toLowerCase());
    for(const blue of ['#2444bc','#235ad7','#6558d3'])assert.ok(!css.includes(blue),blue);
    const legacy=await page.evaluate(()=>[...document.querySelectorAll('.pulso-app *')].flatMap(node=>{const css=getComputedStyle(node);return [css.color,css.backgroundColor,css.borderColor];}).filter(value=>['rgb(36, 68, 188)','rgb(35, 90, 215)','rgb(101, 88, 211)'].includes(value)));assert.deepEqual(legacy,[]);
    await page.getByRole('button',{name:'Configuración',exact:true}).click();const select=page.locator('.settings-appearance select');await select.selectOption('light');await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgb(250, 247, 248)');await select.selectOption('dark');await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgb(0, 0, 0)');
   });
   await check('ux-v65-miniplayer-seal',async page=>{
    await seedQueue(page,origin);await page.goto(origin);await page.locator('.mini-player__mobile-progress').waitFor();
    const g=await page.evaluate(()=>{const a=document.querySelector('.pulso-app'),m=a.querySelector('.mini-player'),p=m.querySelector('.mini-player__mobile-progress'),r=m.getBoundingClientRect(),q=p.getBoundingClientRect(),s=getComputedStyle(a,'::after');return {overflow:getComputedStyle(m).overflow,position:s.position,z:s.zIndex,left:q.left,right:q.right,top:q.top,bottom:q.bottom,ml:r.left,mr:r.right,mt:r.top,mb:r.bottom};});assert.equal(g.overflow,'hidden');assert.equal(g.position,'fixed');assert.equal(g.z,'18');assert.ok(g.left>=g.ml-1&&g.right<=g.mr+1&&g.top>=g.mt-1&&g.bottom<=g.mb+1,JSON.stringify(g));

   });
   await check('ux-v65-miniplayer-desktop',async page=>{
    await seedQueue(page,origin);await page.goto(origin);await page.locator('.shell-nav').waitFor();
    assert.notEqual(await page.evaluate(()=>getComputedStyle(document.querySelector('.pulso-app'),'::after').position),'fixed');
   },{width:1280,height:800});
   for(const font of [100,200])await check(`ux-v65-queue-compact-${font}`,async page=>{
    await seedQueue(page,origin);await page.goto(origin);await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor({state:'attached'});
    await page.locator('.mini-player').getByRole('button',{name:'Abrir reproductor desde minirreproductor'}).click();
    await page.locator('.player-surface').getByRole('button',{name:'Cola',exact:true}).click();
    if(font===200)await page.evaluate(()=>{const sheet=[...document.styleSheets].find(s=>{try{return !!s.cssRules}catch{return false}});sheet.insertRule('html { font-size: 200% !important; }',sheet.cssRules.length);});
    const rows=page.locator('.player-queue ol > li');assert.equal(await rows.count(),3);
    for(const row of await rows.all()){
     const actions=row.locator('.player-queue__actions button');assert.equal(await actions.count(),3);
     for(const label of ['Subir en cola','Bajar en cola','Quitar de cola'])assert.equal(await row.getByRole('button',{name:new RegExp('^'+label)}).count(),1);
     for(const button of await actions.all()){const box=await button.boundingBox();assert.ok(box.width>=44&&box.height>=44,JSON.stringify(box));assert.equal((await button.innerText()).trim(),'');}
    }
    const before=await rows.allTextContents();const down=rows.nth(0).getByRole('button',{name:/^Bajar en cola/});await down.focus();await page.keyboard.press('Enter');await page.waitForFunction(first=>document.querySelector('.player-queue ol>li')?.textContent!==first,before[0]);
    await rows.nth(0).getByRole('button',{name:/^Bajar en cola/}).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   },{width:320,height:568});
   await check('ux-v65-home-albums',async page=>{
    await seedQueue(page,origin);await page.goto(origin);await page.locator('.shell-nav').waitFor();assert.equal(await page.locator('.home-continue').count(),0);assert.equal(await page.getByText('Continuar escuchando',{exact:true}).count(),0);await page.locator('#home-albums-heading').waitFor();await page.locator('.home-albums button').first().click();await page.locator('.library-detail:visible').waitFor();
   });
   await check('ux-v65-home-empty',async page=>{
    await seedQueue(page,origin);await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction(['tracks','settings','playlists'],'readwrite');tx.objectStore('tracks').clear();tx.objectStore('playlists').clear();tx.objectStore('settings').delete('library-playback');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();});
    await page.goto(origin);await page.locator('.home-empty').waitFor();assert.equal(await page.locator('.home-continue').count(),0);
   });
   await check('ux-v65-search-rows',async page=>{
    await page.goto(`${origin}/${workspace.dir}/search.html`);await page.getByRole('searchbox').fill('Luna Norte');
    const track=page.locator('[data-suggestion-id="track"]').locator('..'),trigger=track.locator('.track-actions-trigger');const box=await trigger.boundingBox();assert.ok(box.width>=44&&box.height>=44);
    const menu=page.getByRole('dialog',{name:'Antes de salir'});await trigger.click();await menu.waitFor();await page.evaluate(()=>window.searchUI.set({resultsVisible:false}));await menu.waitFor({state:'hidden'});await page.evaluate(()=>window.searchUI.set({resultsVisible:true}));await trigger.click();await menu.waitFor();await menu.getByRole('button',{name:'Cerrar opciones de canción'}).click();
    const main=track.locator('[data-suggestion-id="track"]');await main.dispatchEvent('pointerdown',{pointerId:4,isPrimary:true,pointerType:'touch',button:0,clientX:50,clientY:100});await page.waitForTimeout(500);await menu.waitFor();await main.dispatchEvent('pointerup',{pointerId:4,isPrimary:true,pointerType:'touch'});await menu.getByRole('button',{name:'Cerrar opciones de canción'}).click();
    await main.dispatchEvent('pointerdown',{pointerId:5,isPrimary:true,pointerType:'touch',button:0,clientX:50,clientY:100});await main.dispatchEvent('pointermove',{pointerId:5,isPrimary:true,pointerType:'touch',clientX:50,clientY:120});await page.waitForTimeout(500);assert.equal(await menu.isVisible(),false);await main.dispatchEvent('pointerup',{pointerId:5,isPrimary:true,pointerType:'touch'});
    for(const kind of ['album','artist']){const row=page.locator(`[data-suggestion-id="${kind}"]`).locator('..');assert.equal(await row.locator('.track-actions-trigger').count(),0);assert.equal((await row.locator('.catalog-chevron').innerText()).trim(),'›');}
   });
  }finally{await browser?.close();}
 }
}catch(error){report.fatal=String(error.stack??error);}
finally{
 if(server)await new Promise((done,fail)=>server.httpServer.close(error=>error?fail(error):done()));
 if(previousTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTemp;
 await profileDirectory?.close();report.cleanup=await workspace.cleanup();
 await writeFile(resolve(workspace.evidence,'report.json'),JSON.stringify(report,null,2));console.log(workspace.evidence);
 if(report.fatal||report.errors.length||report.cases.length!==16||report.cases.some(item=>item.status==='FAIL'))process.exitCode=1;
}
