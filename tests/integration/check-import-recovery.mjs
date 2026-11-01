import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {preview} from 'vite';
import {chromium} from 'playwright-core';

let server,browser;
const report={passed:false,iphoneVerified:false,cases:[]};
try{
 server=await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 const context=await browser.newContext(),origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 try{
  // The file closes successfully, but the real import worker loses confirmation.
  await context.route(/\/assets\/import\.worker-[^/]+\.js$/,async route=>{
   const response=await route.fetch();const injection="const originalClose=FileSystemWritableFileStream.prototype.close; FileSystemWritableFileStream.prototype.close=async function(){await originalClose.call(this);FileSystemWritableFileStream.prototype.close=originalClose;throw new Error('test: close acknowledgement lost');};\n";
   await route.fulfill({response,body:injection+await response.text()});
  });
  await context.addInitScript(()=>{
   window.pulsoImportStarts=0;const WorkerBase=window.Worker;
   window.Worker=class extends WorkerBase{postMessage(message,...args){if(message?.type==='import')window.pulsoImportStarts++;return super.postMessage(message,...args);}};
  });
  let page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.name));await page.goto(origin);
  await page.waitForFunction(()=>{const input=document.querySelector('input[type=file]');return input instanceof HTMLInputElement&&!input.disabled;});
  await page.getByLabel('Importar audios',{exact:true}).setInputFiles([resolve('public/fixtures/A.mp3'),resolve('public/fixtures/B.m4a')]);
  await page.getByRole('region',{name:'Recuperación de importaciones'}).waitFor();
  assert.equal(await page.evaluate(()=>window.pulsoImportStarts),1,'uncertainty must stop the remaining batch');
  assert.equal(await page.getByLabel('Importar audios',{exact:true}).isDisabled(),true);
  await page.close();page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));await page.goto(origin);
  await page.getByRole('button',{name:'Verificar y recuperar copia',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Copia recuperada y verificada.'}).waitFor();
  assert.equal(await page.getByLabel('Importar audios',{exact:true}).isDisabled(),false);
  const readState=()=>page.evaluate(()=>new Promise((resolve,reject)=>{
   const request=indexedDB.open('pulso-web-local-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{
    const db=request.result,tx=db.transaction(['tracks','assets','jobs']);const tracks=tx.objectStore('tracks').getAll(),assets=tx.objectStore('assets').getAll(),jobs=tx.objectStore('jobs').getAll();
    tx.oncomplete=()=>{db.close();resolve({tracks:tracks.result.length,assets:assets.result.length,jobs:jobs.result.map(j=>j.state)});};tx.onabort=()=>{db.close();reject(tx.error);};
   };
  }));
  assert.deepEqual(await readState(),{tracks:1,assets:1,jobs:['sealed']});
  report.cases.push({name:'uncertain worker close stops batch; reopen and recover via UI worker',passed:true,confirmedTracks:1,secondFileStarted:false});
  await page.evaluate(()=>new Promise((resolve,reject)=>{
   const request=indexedDB.open('pulso-web-local-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{
    const db=request.result,tx=db.transaction(['jobs','chunks'],'readwrite');tx.objectStore('jobs').put({operation:'legacy-test',state:'writing',bytes:3},'legacy-test');tx.objectStore('chunks').put(new Uint8Array([7,8,9]),['legacy-test',0]);
    tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};
   };
  }));
  await page.reload();await page.getByRole('button',{name:'Conservar esos archivos y continuar',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Importar audios',{exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Conservar esos archivos y continuar',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('input[type=file]').disabled);
  const retained=await page.evaluate(()=>new Promise((resolve,reject)=>{
   const request=indexedDB.open('pulso-web-local-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{
    const db=request.result,tx=db.transaction(['jobs','chunks']);const job=tx.objectStore('jobs').get('legacy-test'),chunk=tx.objectStore('chunks').get(['legacy-test',0]);
    tx.oncomplete=()=>{db.close();resolve({state:job.result.state,bytes:[...chunk.result]});};tx.onabort=()=>{db.close();reject(tx.error);};
   };
  }));assert.deepEqual(retained,{state:'writing',bytes:[7,8,9]});
  assert.equal((await readState()).tracks,1);assert.deepEqual(errors,[]);
  report.cases.push({name:'legacy job blocks until explicit preserve review; job and bytes unchanged',passed:true});
  report.passed=true;
 }finally{await context.close();}
}finally{
 await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));console.log(JSON.stringify(report));
}
