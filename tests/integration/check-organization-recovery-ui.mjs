// Requires a fresh parent-owned product build in dist. Does not build/deploy.
// Only synthetic organization, sandboxed Chromium and ephemeral loopback.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {preview} from 'vite';
import {chromium} from 'playwright-core';
let browser,server,page;
const report={passed:false,cases:[],iphoneVerified:false,requiresFreshParentBuild:true};
const pendingKey='pulso-web:organization:pending-operation',historyKey='pulso-web:organization:unknown-history';
const libraryId=randomUUID(),trackRef={libraryId,id:randomUUID()};
const backup={format:'pulso-web-organization',version:1,libraryId,exportId:randomUUID(),exportedAt:'2026-10-31T00:00:00.000Z',tracks:[{ref:trackRef,title:'Recuperación sintética',artist:null,album:null,duration:1,createdAt:'2026-10-31T00:00:00.000Z',manualOverrides:{},audio:null}],favorites:[trackRef],playlists:[{ref:{libraryId,id:randomUUID()},name:'Lista recuperada',entries:[{id:randomUUID(),track:trackRef}]}]};
try {
 server=await preview({configFile:false,build:{outDir:process.env.PULSO_ORGANIZATION_UI_DIST??'dist'},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 const context=await browser.newContext();
 await context.addInitScript(()=>{
  window.organizationRecoveryTest={loseAck:false,blockOpen:false};
  const descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete'),open=IDBFactory.prototype.open;
  IDBFactory.prototype.open=function(...args){if(window.organizationRecoveryTest.blockOpen)throw new Error('Synthetic unavailable reopen');return open.apply(this,args);};
  Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(callback){const tx=this;descriptor.set.call(tx,tx.mode==='readwrite'&&tx.objectStoreNames.contains('tracks')?function(event){
   if(window.organizationRecoveryTest.loseAck){window.organizationRecoveryTest.loseAck=false;window.organizationRecoveryTest.blockOpen=true;tx.onabort?.call(tx,new Event('abort'));}else callback?.call(tx,event);
  }:callback);}});
 });
 page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
 const panel=()=>page.locator('details').filter({has:page.locator('summary').filter({hasText:/^Exportar e importar organización$/})});
 const button=name=>panel().getByRole('button',{name,exact:true});
 async function openPanel(){await page.waitForFunction(()=>document.querySelector('input[type=file]')&&!document.querySelector('input[type=file]').disabled);await panel().locator('summary').click();}
 async function selectBackup(){await panel().getByLabel('Importar organización',{exact:true}).setInputFiles({name:'recuperar.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await button('Aplicar organización').waitFor();}
 async function snapshot(){return page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction(['tracks','playlists','assets','settings']),t=tx.objectStore('tracks').getAll(),p=tx.objectStore('playlists').getAll(),a=tx.objectStore('assets').getAll(),s=tx.objectStore('settings').getAll();tx.oncomplete=()=>{db.close();resolve({tracks:t.result,playlists:p.result,assets:a.result,settings:s.result});};tx.onabort=()=>{db.close();reject(tx.error);};};}));}
 await openPanel();await selectBackup();await button('Aplicar organización').click();await page.evaluate(()=>{window.organizationRecoveryTest.loseAck=true;});await button('Confirmar restauración').click();await button('Comprobar resultado').waitFor();
 const operation=await page.evaluate(key=>sessionStorage.getItem(key),pendingKey);assert.match(operation,/^[a-f0-9-]+:[a-f0-9-]+$/);
 await button('Comprobar resultado').click();await panel().getByRole('alert').filter({hasText:'El resultado sigue sin conocerse.'}).waitFor();assert.equal(await button('Restaurar en este almacenamiento').count(),0);assert.equal(await button('Preparar exportación').isDisabled(),true);
 report.cases.push({name:'real apply with lost acknowledgement persists operation; unavailable same-library inspection has no recovery bypass',passed:true});
 // Restore access then corrupt only the receipt to produce genuine same-incarnation uncertainty.
 await page.evaluate(async operation=>{window.organizationRecoveryTest.blockOpen=false;await new Promise((resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('settings','readwrite');tx.objectStore('settings').put({broken:true},'organization-backup:v1:receipt:'+operation);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};});},operation);
 await button('Comprobar resultado').click();await panel().getByRole('alert').filter({hasText:'El resultado sigue sin conocerse.'}).waitFor();assert.equal(await button('Restaurar en este almacenamiento').count(),0);
 report.cases.push({name:'same-incarnation corrupt receipt remains unknown and cannot abandon tracking through unsafe button',passed:true});
 // Real eviction in the same tab, preserving sessionStorage and the pending UI operation.
 await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('pulso-web-local-v1');r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('delete blocked'));}));
 await button('Comprobar resultado').click();await button('Restaurar en este almacenamiento').waitFor();assert.equal(await button('Preparar exportación').isDisabled(),true);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey),operation);
 report.cases.push({name:'delete IndexedDB in same tab detects unavailable original incarnation without declaring not committed or releasing gate',passed:true});
 await page.reload();await panel().locator('summary').click();await button('Comprobar resultado').click();await button('Restaurar en este almacenamiento').waitFor();assert.equal(await panel().getByLabel('Importar organización',{exact:true}).isDisabled(),true);
 await button('Restaurar en este almacenamiento').click();await button('Volver al seguimiento').click();assert.equal(await button('Preparar exportación').isDisabled(),true);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey),operation);
 await button('Restaurar en este almacenamiento').click();await button('Confirmar abandono del seguimiento').click();await panel().getByText('Resultado desconocido · Operación '+operation,{exact:true}).waitFor();assert.equal(await button('Preparar exportación').isEnabled(),true);assert.equal(await button('Aplicar organización').count(),0);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);assert.deepEqual(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),historyKey),[operation]);
 let stored=await snapshot();assert.equal(stored.tracks.length,0);assert.equal(stored.assets.length,0);const incarnation=stored.settings.find(v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v));assert.notEqual(incarnation,operation.split(':')[0]);
 report.cases.push({name:'reload preserves pending operation; cancel retains gate; explicit confirmation archives unknown ID and requires a new preview',passed:true});
 await selectBackup();await button('Aplicar organización').click();await button('Confirmar restauración').click();await button('Crear nueva vista previa').waitFor();stored=await snapshot();assert.equal(stored.tracks.length,1);assert.equal(stored.tracks[0].assetId,null);assert.equal(stored.tracks[0].favorite,true);assert.equal(stored.playlists[0].entries[0].trackId,stored.tracks[0].id);assert.equal(stored.assets.length,0);
 assert.equal(stored.settings.some(v=>v?.operationId===operation),false);assert.deepEqual(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),historyKey),[operation]);
 await page.reload();await panel().locator('summary').click();await panel().getByText('Resultado desconocido · Operación '+operation,{exact:true}).waitFor();assert.equal(await button('Preparar exportación').isEnabled(),true);assert.equal(await button('Comprobar resultado').count(),0);assert.equal((await snapshot()).tracks[0].id,stored.tracks[0].id);assert.deepEqual(errors,[]);
 report.cases.push({name:'explicit new restore commits organization without bytes; reload preserves musical IDs and historical unknown result separately',passed:true});report.passed=true;
} catch(error) {report.failure=error.message;throw error;}
finally {await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));await writeFile('.local/evidence/organization-recovery-ui.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
