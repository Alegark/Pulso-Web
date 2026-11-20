import {createTestWorkspace} from './test-workspace.mjs';
import {build,preview} from 'vite';
import {chromium,webkit} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const workspace=await createTestWorkspace('download-dock-ui'),{dir,evidence}=workspace;

const report={cases:[],errors:[],external:[]};let server;
try{
await writeFile(`${dir}/fixture.html`,'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><div id="root"></div><script type="module" src="/tests/integration/download-feedback-fixture.tsx"></script>');
await build({configFile:false,logLevel:'error',build:{outDir:`${dir}/bundle`,rolldownOptions:{input:`${dir}/fixture.html`}}});if(process.env.PULSO_TEST_FAIL_AFTER_BUILD==='1')throw Error('Injected teardown verification failure after build');
server=await preview({configFile:false,build:{outDir:`${dir}/bundle`},preview:{host:'127.0.0.1',port:0}});const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
for(const [name,launcher]of [['chromium',chromium],['webkit',webkit]]){const browser=await launcher.launch(name==='chromium'?{executablePath:'/usr/bin/chromium',headless:true}:{headless:true});try{const page=await browser.newPage({viewport:{width:390,height:664},hasTouch:true});page.on('pageerror',e=>report.errors.push(String(e)));await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin)return r.continue();if(u.hostname==='itunes.apple.com'){const album={wrapperType:'collection',collectionType:'Album',collectionId:42,collectionName:'Synthetic',artistName:'Artist',trackCount:2};return r.fulfill({headers:{'access-control-allow-origin':'*'},json:{resultCount:3,results:[album,...[1,2].map(n=>({wrapperType:'track',kind:'song',collectionId:42,trackId:80+n,discNumber:1,discCount:1,trackNumber:n,trackCount:2,trackName:'Track '+n,artistName:'Artist',trackTimeMillis:60000}))]}});}report.external.push(u.origin);return r.abort();});
await page.goto(`${origin}/${dir}/fixture.html`);await page.locator('[data-suggestion-id="one"]').click();let row=page.locator('.catalog-mixed-list>li').first();await row.getByRole('progressbar').waitFor();assert.equal(await row.getByRole('progressbar').getAttribute('value'),null);await page.evaluate(()=>feedbackUI.progress({bytes:25,total:100}));await row.locator('progress[value="25"]').waitFor();await row.getByRole('button',{name:'Cancelar carga'}).click();assert.deepEqual(await page.evaluate(()=>feedbackUI.calls),['cancel']);assert.equal(await page.locator('.selected-song-actions').count(),1);report.cases.push(`${name}: search progress stays in selected row, indeterminate/bytes/cancel`);
await page.evaluate(()=>feedbackUI.view('album'));await page.locator('.album-tracks>li').first().getByRole('button').click();row=page.locator('.album-tracks>li').first();await row.getByRole('progressbar').waitFor();assert.equal(await page.locator('.album-tracks>li').nth(1).getByRole('progressbar').count(),0);await row.scrollIntoViewIfNeeded();report.cases.push(`${name}: album selection progress in matching row`);
const dock=page.getByRole('region',{name:'Descargas',exact:true}),handle=dock.locator('.download-dock__handle');
assert.equal(await dock.count(),0);
await page.evaluate(()=>feedbackUI.downloads());
await dock.waitFor();
assert.equal(await handle.getAttribute('aria-expanded'),'false');
assert.equal(await dock.locator('progress').getAttribute('value'),'1');
assert.equal(await dock.evaluate(el=>el.parentElement.parentElement===document.body),true);

const original=await handle.boundingBox();
const x=original.x+original.width/2,y=original.y+original.height/2;
await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-85,y-123,{steps:6});await page.mouse.up();
const moved=await handle.boundingBox();
assert.ok(original.x-moved.x>70&&original.y-moved.y>100,JSON.stringify({original,moved,stored:await page.evaluate(()=>localStorage.getItem('pulso:download-dock-position:v1'))}));
assert.equal(await handle.getAttribute('aria-expanded'),'false');

const tx=Math.round(moved.x+moved.width/2),ty=Math.round(moved.y+moved.height/2);
if(name==='chromium'){
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx-10,y:ty-10}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx-40,y:ty-50}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await cdp.detach();
}else{
 // Playwright exposes tap on WebKit, but no native touch-move API.
 // Untrusted pointers cannot enter native capture, so stub it for this gesture only.
 await handle.evaluate((el,{x,y})=>{
  el.setPointerCapture=()=>{};
  try{
   for(const [type,dx,dy] of [['pointerdown',0,0],['pointermove',-10,-10],['pointermove',-40,-50],['pointerup',-40,-50]]){
    el.dispatchEvent(new PointerEvent(type,{bubbles:true,isPrimary:true,pointerType:'touch',pointerId:3,button:0,clientX:x+dx,clientY:y+dy}));
   }
  }finally{delete el.setPointerCapture;}
 },{x:tx,y:ty});
}
await page.waitForFunction(y=>document.querySelector('.download-dock').getBoundingClientRect().top<y-40,moved.y);
assert.equal(await handle.getAttribute('aria-expanded'),'false');

await handle.focus();
const beforeKey=await handle.boundingBox();
await handle.press('ArrowLeft');
assert.ok((await handle.boundingBox()).x<beforeKey.x);
await handle.press('Enter');
await dock.getByText('Canción dos',{exact:true}).first().waitFor();
await dock.getByText('Preparando la siguiente canción…',{exact:true}).waitFor();
await dock.getByText('En espera',{exact:true}).waitFor();
assert.doesNotMatch(await dock.innerText(), /\[D\d{2}\]/);
await handle.press('Space');
await dock.locator('.download-dock__handle[aria-expanded=false]').waitFor();
const savedPosition=await handle.boundingBox();
await page.reload();
await page.waitForFunction(()=>!!window.feedbackUI);
assert.equal(await dock.count(),0);
await page.evaluate(()=>feedbackUI.downloads());
await dock.waitFor();
const restored=await handle.boundingBox();
assert.ok(Math.abs(restored.x-savedPosition.x)<=1&&Math.abs(restored.y-savedPosition.y)<=1,JSON.stringify({restored,savedPosition,stored:await page.evaluate(()=>localStorage.getItem('pulso:download-dock-position:v1'))}));
report.cases.push(`${name}: mouse, ${name==='chromium'?'CDP touch':'synthetic touch pointers'}, keyboard and position after reload`);

await page.evaluate(()=>feedbackUI.view('downloads'));
await page.getByRole('heading',{name:'Tus descargas'}).waitFor();
assert.equal(await dock.count(),1);
const point=await handle.boundingBox();
await page.touchscreen.tap(point.x+point.width/2,point.y+point.height/2);
assert.equal(await handle.getAttribute('aria-expanded'),'true');
for(const size of [{width:320,height:568},{width:568,height:320}]){
 await page.setViewportSize(size);
 await page.evaluate(()=>document.documentElement.style.fontSize='200%');
 await page.waitForFunction(()=>{const r=document.querySelector('.download-dock').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
}
await dock.getByRole('button',{name:'Detener',exact:true}).click();
assert.equal(await page.evaluate(()=>feedbackUI.aborted()),true);
await page.evaluate(()=>feedbackUI.finish());
await dock.getByText('1 de 2 guardadas · 1 no existe',{exact:true}).waitFor();
await handle.click();
await dock.locator('li[data-failed=true]').getByText('No existe en tus bots',{exact:true}).waitFor();
await dock.waitFor({state:'detached',timeout:6500});
report.cases.push(`${name}: route persistence, native tap, resize and 320px/text 200%, stop, localized failure, timed dismissal`);
}finally{await browser.close();}}
assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);report.status='PASS';}catch(e){report.status='FAIL';report.error=String(e.stack||e);}finally{
 let serverStopped=true;
 try{if(server)await new Promise((resolve,reject)=>server.httpServer.close(e=>e?reject(e):resolve()));}catch(e){serverStopped=false;report.status='FAIL';report.serverCleanupError=String(e);}
 if(serverStopped){try{report.cleanup=await workspace.cleanup();}catch(e){report.status='FAIL';report.cleanupError=String(e);}}else report.retainedTemporaryPath=dir;
 await writeFile(`${evidence}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({evidence,...report},null,2));if(report.status!=='PASS')process.exitCode=1;
}
