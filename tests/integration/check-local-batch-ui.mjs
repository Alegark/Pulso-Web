import assert from 'node:assert/strict';
import {preview} from 'vite';
import {chromium} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
let server,browser,page;
const report={passed:false,cases:[],iphoneVerified:false};
try{
 server=await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 const context=await browser.newContext();const errors=[];
 await context.addInitScript(()=>{window.pulsoBatchUI={audio:[]};const NativeAudio=window.Audio;window.Audio=class extends NativeAudio{constructor(...args){super(...args);window.pulsoBatchUI.audio.push(this);}};});
 // Delay only verifier reads, to exercise real UI cancellation and playlist edits deterministically.
 await context.route(/\/assets\/local-batch\.worker-[^/]+\.js$/,async route=>{const response=await route.fetch();await route.fulfill({response,body:'const originalArrayBuffer=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=async function(){await new Promise(resolve=>setTimeout(resolve,20));return originalArrayBuffer.call(this);};\n'+await response.text()});});
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.name));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
 await page.waitForFunction(()=>{const input=document.querySelector('input[type=file]');return input instanceof HTMLInputElement&&!input.disabled;});
 const own=await page.evaluate(async()=>[...new Uint8Array(await(await fetch('/samples/Aurora.mp3')).arrayBuffer())]);
 await page.getByLabel('Importar audios',{exact:true}).setInputFiles({name:'Aurora-propia.mp3',mimeType:'audio/mpeg',buffer:Buffer.from(own)});
 await page.getByRole('status').filter({hasText:'1 importadas, 0 ya existentes.'}).waitFor();
 const row=page.locator('.tracks>li').first();await page.getByLabel('Nueva playlist',{exact:true}).fill('Copias propias');await page.getByRole('button',{name:'Crear playlist',exact:true}).click();
 await row.getByRole('button',{name:'Añadir a playlist',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('.tracks>li button')].find(b=>b.textContent==='Añadir a playlist')?.disabled);
 await page.getByLabel(/^Vista/).selectOption({label:'Copias propias'});
 await page.getByRole('button',{name:'Preparar cola de esta selección',exact:true}).click();await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
 const player=page.getByRole('region',{name:'Reproductor',exact:true});await player.getByLabel(/Repetición/).selectOption('one');await player.getByRole('button',{name:'Reproducir',exact:true}).click();await page.waitForFunction(()=>window.pulsoBatchUI.audio[0]?.currentTime>0&&!window.pulsoBatchUI.audio[0].paused);
 const panel=page.getByRole('region',{name:'Verificar copias de la playlist completa',exact:true});
 await page.getByLabel('Buscar por título, artista o álbum',{exact:true}).fill('sin coincidencias');assert.equal(await page.locator('.tracks>li').count(),0);
 await panel.getByRole('button',{name:'Verificar copias',exact:true}).click();await panel.getByText('1 de 1 verificadas en la última comprobación.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.pulsoBatchUI.audio.length===1&&!window.pulsoBatchUI.audio[0].paused),true);
 report.cases.push({name:'whole playlist verified despite empty visual filter; one engine continues playing',passed:true});
 await panel.getByRole('button',{name:'Volver a verificar',exact:true}).click();await panel.getByRole('button',{name:'Cancelar verificación',exact:true}).click();await page.getByRole('status').filter({hasText:'Verificación cancelada.'}).waitFor();
 assert.equal(await page.evaluate(()=>!window.pulsoBatchUI.audio[0].paused),true);
 // Selecting another view keeps the persisted job and does not replace the queue.
 await page.getByLabel(/^Vista/).selectOption('');await panel.getByText('Selecciona una playlist para crear una verificación.',{exact:true}).waitFor();assert.equal(await panel.locator('li').count(),1);
 await panel.getByRole('button',{name:'Volver a verificar',exact:true}).click();await panel.getByText('1 de 1 verificadas en la última comprobación.',{exact:true}).waitFor();assert.equal(await player.locator('ol>li').count(),1);
 report.cases.push({name:'explicit cancel persists; retry from zero works without selected playlist or audio interruption',passed:true});
 await player.getByRole('button',{name:'Pausar',exact:true}).click();
 // Simulate eviction of bytes, preserving all organization and the frozen selection.
 const eviction=await page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const tx=db.transaction(['assets','settings']);const assets=await new Promise((resolve,reject)=>{const r=tx.objectStore('assets').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();
  const a=assets.find(a=>a.backend==='opfs'||a.backend==='idb');if(!a)throw Error('Test asset absent');
  if(a.backend==='opfs'){const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('pulso-assets-v1');await directory.removeEntry(a.storageKey);}
  else {const db2=await new Promise(resolve=>{const r=indexedDB.open('pulso-web-local-v1');r.onsuccess=()=>resolve(r.result);});const t=db2.transaction('chunks','readwrite');t.objectStore('chunks').delete([a.storageKey,0]);await new Promise((resolve,reject)=>{t.oncomplete=resolve;t.onabort=()=>reject(t.error);});db2.close();}
  return {backend:a.backend};
 });
 await panel.getByRole('button',{name:'Volver a verificar',exact:true}).click();await page.getByRole('status').filter({hasText:'Verificación incompleta.'}).waitFor();await panel.getByText(/faltantes: 1/).waitFor();
 await page.reload();await panel.getByText(/faltantes: 1/).waitFor();await page.locator('.tracks>li').first().waitFor();assert.equal(await panel.locator('li').count(),1);assert.equal(await page.locator('.tracks>li').count(),1);
 assert.equal(await page.evaluate(()=>window.pulsoBatchUI.audio.length===1&&window.pulsoBatchUI.audio[0].paused),true);
 report.cases.push({name:'missing bytes are incomplete; reload preserves snapshot, playlist and track with paused engine',passed:true,...eviction});
 assert.deepEqual(errors,[]);report.pageErrors=errors.length;report.passed=true;
}catch(error){report.failure={error:error.message,status:page&&!page.isClosed()?await page.getByRole('status').allTextContents():[]};throw error;}
finally{await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));await writeFile('.local/local-batch-ui-result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
