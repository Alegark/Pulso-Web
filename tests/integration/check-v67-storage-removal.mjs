import {build,preview} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createTestWorkspace} from './test-workspace.mjs';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';
const ws=await createTestWorkspace('v67-storage-removal');let server;const cases=[];
try{
 await writeFile(`${ws.dir}/seed.html`,'<script type="module" src="/tests/integration/v67-storage-fixture.ts"></script>');
 await build({configFile:false,plugins:[tailwindcss()],logLevel:'error',build:{outDir:`${ws.dir}/bundle`,rolldownOptions:{input:{main:'index.html',seed:`${ws.dir}/seed.html`}}}});
 server=await preview({configFile:false,build:{outDir:`${ws.dir}/bundle`},preview:{host:'127.0.0.1',port:0}});const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await launcher.launch(engine==='chromium'?{headless:true,executablePath:'/usr/bin/chromium'}:{headless:true});const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
  try{
   await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin||['blob:','data:'].includes(u.protocol))return r.continue();if(['itunes.apple.com','lrclib.net'].includes(u.hostname))return r.fulfill({json:u.hostname==='lrclib.net'?[]:{resultCount:0,results:[]},headers:{'access-control-allow-origin':'*'}});return r.abort();});
   await installRequiredAccountFixture(context,origin);await context.addInitScript(()=>{delete Navigator.prototype.serviceWorker;});const page=await context.newPage();page.setDefaultTimeout(15000);
   await page.goto(`${origin}/${ws.dir}/seed.html`);await page.waitForFunction(()=>!!window.setupCollectionFixture);await page.evaluate(()=>window.setupCollectionFixture());const preview=await page.evaluate(()=>window.checkV67QueuedPreview());assert.equal(preview.protectedCopies,0);assert.deepEqual(preview.protectedQueue,[]);assert.equal(preview.evictCopies,1);assert.deepEqual(preview.evictQueue,[preview.trackId]);await page.goto(origin);await page.getByRole('button',{name:'Configuración',exact:true}).click();
   const cache=page.getByRole('button',{name:'Limpiar caché de escucha',exact:true}),all=page.getByRole('button',{name:'Limpiar toda la caché',exact:true});await cache.waitFor();
   const seed=()=>page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-cache-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});await new Promise((resolve,reject)=>{const tx=db.transaction(['meta','artwork','catalog'],'readwrite'),accountId='11111111-1111-4111-8111-111111111111';tx.objectStore('meta').put({accountId,test:true});tx.objectStore('artwork').put({accountId,artworkKey:'test-only'});tx.objectStore('catalog').put({accountId,kind:'test-only',cacheKey:'test-only'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();});
   const count=()=>page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-cache-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});return await new Promise(resolve=>{const tx=db.transaction(['meta','artwork','catalog']);const requests=['meta','artwork','catalog'].map(name=>tx.objectStore(name).count());tx.oncomplete=()=>{db.close();resolve(requests.map(q=>q.result));};});});
   const preserved=()=>page.evaluate(async()=>{
    const read=async(name,stores)=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open(name);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});try{return await new Promise((resolve,reject)=>{const tx=db.transaction(stores),requests=stores.map(store=>tx.objectStore(store).getAll());tx.oncomplete=()=>resolve(requests.map(q=>q.result));tx.onabort=()=>reject(tx.error);});}finally{db.close();}};
    return {library:await read('pulso-web-local-v1',['tracks','playlists']),telegram:await read('pulso-web-telegram-session-v1',['authorization'])};
   });
   await seed();await cache.click();let dialog=page.locator('dialog.collection-removal-dialog[open]');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Limpiar caché de escucha',exact:true}).click();await dialog.getByRole('button',{name:'Cerrar'}).waitFor();assert.deepEqual(await count(),[1,1,1]);await dialog.getByRole('button',{name:'Cerrar'}).click();await page.waitForFunction(()=>document.querySelector('.settings-storage button:nth-child(2)')?.disabled===true);
   const beforeAll=await preserved();assert.equal(await all.isEnabled(),true);await all.click();dialog=page.locator('dialog.collection-removal-dialog[open]');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Limpiar toda la caché',exact:true}).click();await dialog.getByRole('button',{name:'Cerrar'}).waitFor();assert.deepEqual(await count(),[0,0,0]);assert.deepEqual(await preserved(),beforeAll);assert.equal(await dialog.getByText('La biblioteca y tus playlists se conservan.').count(),1);
   await dialog.getByRole('button',{name:'Cerrar'}).click();await page.evaluate(()=>{const original=IDBDatabase.prototype.transaction;window.__v67Transaction=original;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(this.name==='pulso-web-cache-v1'&&mode==='readwrite')throw new DOMException('test failure','UnknownError');return original.call(this,stores,mode,...rest);};});
   await all.click();dialog=page.locator('dialog.collection-removal-dialog[open]');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Limpiar toda la caché',exact:true}).click();await dialog.getByText('No se pudo confirmar la limpieza.',{exact:false}).first().waitFor();await page.evaluate(()=>{IDBDatabase.prototype.transaction=window.__v67Transaction;});cases.push(`${engine}: audio-only preserves artwork, full mode purges when empty`);
  }finally{await context.close();await browser.close();}
 }
 console.log('PASS',cases.length,cases.join('; '));
}catch(error){console.error('FAIL',error.stack||error);process.exitCode=1;}
finally{if(server)await new Promise(r=>server.httpServer.close(r));await ws.cleanup();}
