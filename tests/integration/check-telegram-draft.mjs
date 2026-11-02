// Native Web Locks and production main. Fixture phone is only a local draft;
// auth workers are denied before construction, and no Telegram request is sent.
import {chromium,webkit} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,cp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const baseline=process.env.PULSO_DRAFT_BASELINE==='1';
const directory=resolve('.local/review/telegram-draft-test');
await rm(directory,{recursive:true,force:true});
await cp(baseline?'.local/telegram-safari-input/before-dist':'dist',directory,{recursive:true});
const report={baseline,physicalIphone:false,cases:[],errors:[],external:[],cleanup:false};
let server,browser;
const ready=page=>page.waitForFunction(()=>{
 const section=document.querySelector('.telegram-panel');
 let fiber=section?.[Object.keys(section).find(k=>k.startsWith('__reactFiber'))];
 while(fiber){if(typeof fiber.memoizedProps?.canConnect==='boolean')return fiber.memoizedProps.canConnect;fiber=fiber.return;}
 return false;
});
async function contextFor(browser,origin,unsupported=false){
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.route('**/*',route=>{
  const url=route.request().url();
  if(!url.startsWith(origin+'/')){report.external.push('blocked-http');return route.abort();}
  if(new URL(url).pathname==='/__test_blank')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Owned test setup</title>'});
  if(url.includes('/session.worker-'))throw Error('Auth worker must never reach network');
  return route.continue();
 });
 await context.addInitScript(({unsupported})=>{
  Reflect.deleteProperty(Object.getPrototypeOf(navigator),'serviceWorker');
  if(unsupported)Object.defineProperty(navigator,'locks',{value:undefined});
  const NativeWorker=Worker;globalThis.draftAuthWorkers=0;
  globalThis.Worker=class extends NativeWorker{constructor(url,options){
   if(String(url).includes('session.worker-')){++globalThis.draftAuthWorkers;throw Error('TESTONLY-auth-worker-denied-before-construction');}
   super(url,options);
  }};
 },{unsupported});
 context.on('page',page=>{page.on('pageerror',()=>report.errors.push('pageerror'));page.setDefaultTimeout(15000);});
 return context;
}
try{
 server=spawn('python3',['scripts/serve_review.py','--directory',directory,'--port','0'],{stdio:['ignore','pipe','pipe']});
 const port=await new Promise((r,j)=>{server.once('error',j);server.stdout.on('data',d=>{const m=/loopback port (\d+)/.exec(String(d));if(m)r(Number(m[1]));});server.once('exit',()=>j(Error('server-exited')));});
 const origin=`http://127.0.0.1:${port}`;
 for(const engine of baseline?['webkit']:['webkit','chromium']){
  browser=engine==='webkit'?await webkit.launch({headless:true}):await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});
  const version=browser.version();
  const context=await contextFor(browser,origin);try{
   const owner=await context.newPage();await owner.goto(origin);await ready(owner);
   const draft=await context.newPage();await draft.goto(origin);
   await draft.getByRole('status').filter({hasText:/^sin-control$/}).waitFor();
   const number=draft.locator('.telegram-panel input[type=tel]'),consent=draft.locator('.telegram-panel input[type=checkbox]'),send=draft.getByRole('button',{name:'Enviar código de acceso',exact:true});
   if(baseline){
    assert.equal(await number.isDisabled(),true);assert.equal(await consent.isDisabled(),true);
    report.cases.push({engine,version,name:'Original two-tab blocker reproduced with native ownership',passed:true,desiredBehavior:false,numberDisabled:true,consentDisabled:true});
   }else{
    await number.fill('+15555550123');await consent.check();assert.equal(await send.isDisabled(),true);
    await draft.evaluate(()=>{
     const form=document.querySelector('.telegram-panel form');
     const key=Object.keys(form).find(k=>k.startsWith('__reactProps'));
     globalThis.oldDraftSubmit=form[key].onSubmit;
     form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    });
    assert.equal(await draft.evaluate(()=>draftAuthWorkers),0);
    report.cases.push({engine,version,name:'Non-owner can type/check; submit bypass creates no worker',passed:true});
    await owner.close();await draft.getByRole('region',{name:'Conexión a Telegram'}).getByRole('button',{name:'Comprobar control',exact:true}).click();await ready(draft);
    assert.equal(await number.inputValue(),'+15555550123');assert.equal(await consent.isChecked(),true);assert.equal(await send.isEnabled(),true);
    await draft.evaluate(()=>oldDraftSubmit({preventDefault(){}}));assert.equal(await draft.evaluate(()=>draftAuthWorkers),0);
    report.cases.push({engine,version,name:'Explicit real acquisition preserves draft; old denied callback remains denied',passed:true});
   }
  }finally{await context.close();}
  if(!baseline){
   for(const kind of ['unsupported','future-storage']){
    const blocked=await contextFor(browser,origin,kind==='unsupported');try{
     const page=await blocked.newPage();
     if(kind==='future-storage'){
      await page.goto(origin+'/__test_blank');await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1',999);r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(Error('fixture-open'));}));
     }
     await page.goto(origin);await page.getByRole('heading',{name:'Tu cuenta de Telegram',exact:true}).waitFor();
     await page.locator('.telegram-panel input[type=tel]').fill('+15555550123');await page.locator('.telegram-panel input[type=checkbox]').check();
     assert.equal(await page.getByRole('button',{name:'Enviar código de acceso',exact:true}).isDisabled(),true);
     await page.locator('.telegram-panel form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
     assert.equal(await page.evaluate(()=>draftAuthWorkers),0);
     report.cases.push({engine,version,name:`${kind}: draft editable without granting send authority`,passed:true});
    }finally{await blocked.close();}
   }
  }
  await browser.close();browser=null;
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);report.passed=true;
}finally{
 await browser?.close();if(server){server.kill('SIGTERM');await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));}report.cleanup=true;
 await mkdir('.local/telegram-safari-input',{recursive:true});await writeFile(`.local/telegram-safari-input/${baseline?'baseline':'browser'}.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
