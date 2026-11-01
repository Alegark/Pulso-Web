import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {preview} from 'vite';
import {chromium} from 'playwright-core';

// Real product/worker/IDB, with cancellation precisely between durable commit
// and delivery of its success to the UI. Only synthetic fixtures are imported.
let server, browser;
try {
  server = await preview({configFile:false, build:{outDir:'dist'}, preview:{host:'127.0.0.1',port:0,strictPort:true}});
  browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.pulsoCancelRace = {started:0,completed:0,cancelled:false};
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          if(event.data?.version!==1||event.data.type!=='complete')return;
          window.pulsoCancelRace.completed++;
          if(window.pulsoCancelRace.cancelled)return;
          const button = [...document.querySelectorAll('button')].find(b=>b.textContent==='Cancelar importación');
          if(!button||button.disabled)throw new Error('Cancellation was not exercisable');
          window.pulsoCancelRace.cancelled=true;
          button.click();
        });
      }
      postMessage(message,...args) {
        if(message?.version===1&&message.type==='import')window.pulsoCancelRace.started++;
        return super.postMessage(message,...args);
      }
    };
  });
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.name));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  const input=page.getByLabel('Importar audios',{exact:true});
  await page.waitForFunction(()=>{const input=document.querySelector('input[type=file]');return input instanceof HTMLInputElement&&!input.disabled;});
  await input.setInputFiles([resolve('public/fixtures/A.mp3'),resolve('public/fixtures/B.m4a')]);
  await page.getByRole('status').filter({hasText:/\d+ importadas, \d+ ya existentes/}).waitFor({timeout:30000});
  const race=await page.evaluate(()=>window.pulsoCancelRace);
  const records=await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('pulso-web-local-v1');
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result;const tx=db.transaction(['tracks','assets']);
      const tracks=tx.objectStore('tracks').getAll();const assets=tx.objectStore('assets').getAll();
      tx.oncomplete=()=>{db.close();resolve({tracks:tracks.result.length,assets:assets.result.length,complete:assets.result.every(a=>a.state==='complete')});};
      tx.onabort=()=>{db.close();reject(tx.error);};
    };
  }));
  console.log(JSON.stringify({environment:'Chromium desktop headless loopback',version:browser.version(),race,records,pageErrors:errors,iphoneVerified:false}));
  assert.equal(race.cancelled,true,'cancellation must occur after first commit');
  assert.equal(race.started,1,'the second file must never start after cancelling the batch');
  assert.equal(race.completed,1,'confirmed first import must be retained');
  assert.deepEqual(records,{tracks:1,assets:1,complete:true});
  assert.deepEqual(errors,[]);
} finally {
  await browser?.close();
  if(server)await new Promise(resolve=>server.httpServer.close(resolve));
}
