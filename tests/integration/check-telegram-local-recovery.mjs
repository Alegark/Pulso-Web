// Native local recovery records and production main; auth replies are synthetic.
// No configuration file, SDK client or Telegram network is used.
import {chromium,webkit} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,cp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const original=process.env.PULSO_AUTH_RECOVERY_BASELINE==='1';
const art=resolve('.local/telegram-send-access'),root=resolve(`.local/review/telegram-recovery-${original?'baseline':'candidate'}-test`);
await mkdir(art,{recursive:true});
if(original){try{await stat(resolve(art,'before-dist/index.html'));}catch{await cp('dist',resolve(art,'before-dist'),{recursive:true});}}
await rm(root,{recursive:true,force:true});await cp(original?resolve(art,'before-dist'):'dist',root,{recursive:true});
const report={original,entry:JSON.parse(await readFile(resolve(root,'latest.json'),'utf8')).entry,cases:[],pageErrors:[],external:[],realTelegramAuthentication:false,physicalIphone:false,cleanup:false};let browser,server;
const props=()=>{
 const element=document.querySelector('.telegram-panel');let fiber=element?.[Object.keys(element).find(k=>k.startsWith('__reactFiber'))];
 while(fiber){const p=fiber.memoizedProps;if(typeof p?.canConnect==='boolean')return {canConnect:p.canConnect,reason:p.blockedReason,count:p.activity.count,resolved:p.activity.resolved};fiber=fiber.return;}return null;
};
const readback=page=>page.evaluate(async()=>{
 const db=await new Promise((r,j)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>r(q.result);q.onerror=()=>j(Error('fixture-open'));});
 try{const result={};for(const name of ['settings','tracks','assets','chunks','jobs','playlists'])result[name]=await new Promise((r,j)=>{const tx=db.transaction(name),out=[];const q=tx.objectStore(name).openCursor();q.onsuccess=()=>{const c=q.result;if(c){out.push([c.key,c.value instanceof Uint8Array?[...c.value]:c.value]);c.continue();}};tx.oncomplete=()=>r(out);tx.onabort=()=>j(Error('fixture-readback'));});return result;}finally{db.close();}
});
try{
 server=spawn('python3',['scripts/serve_review.py','--directory',root,'--port','0'],{stdio:['ignore','pipe','pipe']});
 const port=await new Promise((r,j)=>{server.once('error',j);server.stdout.on('data',d=>{const m=/loopback port (\d+)/.exec(String(d));if(m)r(Number(m[1]));});server.once('exit',()=>j(Error('server-exited')));});
 const origin=`http://127.0.0.1:${port}`;
 for(const engine of ['webkit','chromium']){
  browser=engine==='webkit'?await webkit.launch({headless:true}):await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});
  for(const kind of ['removal-history','metadata-history','import-history']){
   const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
   try{
    await context.route('**/*',route=>{if(!route.request().url().startsWith(origin+'/')){report.external.push('blocked-http');return route.abort();}return route.continue();});
    await context.route(origin+'/__test_seed',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Owned fixture setup</title>'}));
    await context.route('**/assets/session.worker-*.js',route=>route.fulfill({contentType:'text/javascript',body:`self.onmessage=e=>{const c=e.data;self.postMessage({version:1,session:c.session,request:c.request,phase:'code',error:null,retryAt:null,delivery:'app'});};`}));
    await context.addInitScript(()=>{Reflect.deleteProperty(Object.getPrototypeOf(navigator),'serviceWorker');globalThis.authRecoveryTest={workers:0,audio:[],plays:0};const W=Worker;globalThis.Worker=class extends W{constructor(url,options){super(url,options);if(String(url).includes('session.worker-'))++authRecoveryTest.workers;}};const A=Audio;globalThis.Audio=class extends A{constructor(...args){super(...args);authRecoveryTest.audio.push(this);}play(){++authRecoveryTest.plays;return super.play();}};});
    context.on('page',p=>p.on('pageerror',()=>report.pageErrors.push({engine,kind})));
    const page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(origin);await page.getByRole('status').filter({hasText:'Biblioteca local. Puedes iniciar sesión en Telegram;'}).waitFor();
    await page.evaluate(async kind=>{
     const db=await new Promise((r,j)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>r(q.result);q.onerror=()=>j(Error('fixture-open'));});
     try{const expected=['settings','tracks','playlists','chunks','jobs'];if(expected.some(n=>!db.objectStoreNames.contains(n)))throw Error('fixture-stores-missing:v'+db.version+':'+[...db.objectStoreNames].join(','));await new Promise((r,j)=>{const tx=db.transaction(['settings','tracks','playlists','chunks','jobs'],'readwrite');tx.oncomplete=r;tx.onabort=()=>j(Error('fixture-abort'));
      if(kind==='import-history')tx.objectStore('jobs').put({ownFixture:true,preserveUnknown:true},'10000000-0000-4000-8000-000000000099');else tx.objectStore('settings').put({ownFixture:true,preserveUnknown:true},kind==='removal-history'?'local-copy-removal:v1:journal:10000000-0000-4000-8000-000000000099':'metadata-rescan:v1:slot');
      tx.objectStore('tracks').put({id:'10000000-0000-4000-8000-000000000001',assetId:null,title:'Ficha propia conservada',artist:null,album:null,duration:0,favorite:true,revision:1,createdAt:'2026-11-02T00:00:00Z',manualOverrides:{}},'10000000-0000-4000-8000-000000000001');
      tx.objectStore('playlists').put({id:'10000000-0000-4000-8000-000000000002',name:'Lista propia conservada',revision:1,entries:[{id:'10000000-0000-4000-8000-000000000003',trackId:'10000000-0000-4000-8000-000000000001'}]},'10000000-0000-4000-8000-000000000002');
      tx.objectStore('chunks').put(new Uint8Array([112,117,108,115,111]),['10000000-0000-4000-8000-000000000004',0]);
     });}finally{db.close();}
    },kind);
    await page.reload();await page.waitForFunction(()=>{const element=document.querySelector('.telegram-panel');let fiber=element?.[Object.keys(element).find(k=>k.startsWith('__reactFiber'))];while(fiber){const p=fiber.memoizedProps;if(typeof p?.canConnect==='boolean')return p.activity.admitted&&p.activity.count===0&&[...document.querySelectorAll('button')].some(b=>b.textContent==='Quitar favorito'&&b.disabled);fiber=fiber.return;}return false;});
    await page.getByLabel('País y prefijo',{exact:true}).selectOption('VE');await page.getByLabel('Número de teléfono',{exact:true}).fill('4121234567');await page.locator('.telegram-panel input[type=checkbox]').check();
    const before=await readback(page),send=page.getByRole('button',{name:'Enviar código de acceso',exact:true});
    const state=await page.evaluate(props);assert.equal(state.count,0);if(kind!=='import-history')assert.equal(state.resolved,false);
    assert.equal(await page.getByRole('button',{name:'Favorito',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Quitar favorito',exact:true}).isDisabled(),true);
    if(original){assert.equal(await send.isDisabled(),true);assert.equal(state.reason,'recovery');report.cases.push({engine,kind,name:'Original locally unresolved record blocks even temporary memory-only auth',passed:true,desiredBehavior:false});}
    else{
     assert.equal(await send.isEnabled(),true);await send.click();await page.getByLabel('Código de Telegram',{exact:true}).waitFor();
     assert.equal(await page.evaluate(()=>authRecoveryTest.workers),1);assert.deepEqual(await readback(page),before);
     assert.equal(await page.getByRole('button',{name:'Quitar favorito',exact:true}).isDisabled(),true);
     assert.equal(await page.evaluate(()=>authRecoveryTest.audio.length===1&&authRecoveryTest.plays===0),true);
     await page.getByRole('button',{name:'Detener conexión local',exact:true}).click();assert.deepEqual(await readback(page),before);
     report.cases.push({engine,kind,name:'Temporary synthetic auth allowed; unknown receipt, favorites, playlist and bytes unchanged; local mutations stay blocked',passed:true});
    }
   }finally{await context.close();}
  }
  await browser.close();browser=null;
 }
 assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.external,[]);report.passed=true;
}catch(error){report.failure=error.message;process.exitCode=1;}
finally{
 await browser?.close();if(server){server.kill('SIGTERM');await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));}report.cleanup=true;
 await writeFile(resolve(art,original?'baseline.json':'browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
