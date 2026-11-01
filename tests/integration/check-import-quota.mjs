import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {preview} from 'vite';
import {chromium} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
let server,browser;
const report={passed:false,cases:[],iphoneVerified:false};
try{
 server=await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 for(const backend of ['opfs','idb']){
  const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.name));
  try{
   const injection=backend==='opfs'?`let testWrites=0;const originalWrite=FileSystemWritableFileStream.prototype.write;FileSystemWritableFileStream.prototype.write=function(...args){if(++testWrites===2)throw new DOMException('Injected quota','QuotaExceededError');return originalWrite.apply(this,args);};`:`Object.defineProperty(navigator.storage,'getDirectory',{value:undefined});let testWrites=0;const originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='chunks'&&++testWrites===2)throw new DOMException('Injected quota','QuotaExceededError');return originalPut.apply(this,args);};`;
   await context.route(/\/assets\/import\.worker-[^/]+\.js$/,async route=>{const response=await route.fetch();await route.fulfill({response,body:injection+'\n'+await response.text()});});
   await context.addInitScript(()=>{window.pulsoQuotaStarts=0;const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{postMessage(message,...args){if(message?.version===1&&message.type==='import')window.pulsoQuotaStarts++;return super.postMessage(message,...args);}};});
   await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
   const input=page.getByLabel('Importar audios',{exact:true});await page.waitForFunction(()=>!document.querySelector('input[type=file]').disabled);
   await input.setInputFiles(resolve('public/fixtures/C.mp3'));await page.getByRole('status').filter({hasText:'1 importadas, 0 ya existentes.'}).waitFor();
   await input.setInputFiles([resolve('public/fixtures/A.mp3'),resolve('public/fixtures/B.m4a')]);await page.getByRole('status').filter({hasText:'No hay espacio suficiente.'}).waitFor();
   await page.waitForFunction(()=>!document.querySelector('input[type=file]').disabled);
   const state=await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const tx=db.transaction(['assets','tracks','jobs','chunks']);const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const [assets,tracks,jobs,chunks]=await Promise.all(['assets','tracks','jobs','chunks'].map(name=>req(tx.objectStore(name).getAll())));db.close();
    const kept=assets.find(a=>a.state==='complete');let bytes;
    if(kept.backend==='opfs'){const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('pulso-assets-v1');bytes=new Uint8Array(await(await(await dir.getFileHandle(kept.storageKey)).getFile()).arrayBuffer());}
    else{bytes=new Uint8Array(kept.bytes);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}}
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    return {started:window.pulsoQuotaStarts,tracks:tracks.length,assets:assets.length,backend:kept.backend,keptHashValid:hash===kept.sha256,jobStates:jobs.map(j=>j.state).sort()};
   });
   report.cases.push({backend,state,pageErrors:errors.length});
   assert.equal(state.started,2,'quota must stop remaining files after the failed one');assert.equal(state.tracks,1);assert.equal(state.assets,1);assert.equal(state.backend,backend);assert.equal(state.keptHashValid,true);assert.deepEqual(state.jobStates,['discarded','sealed']);assert.deepEqual(errors,[]);
  }finally{await context.close();}
 }
 report.passed=true;
}finally{await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));await writeFile('.local/import-quota-result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
