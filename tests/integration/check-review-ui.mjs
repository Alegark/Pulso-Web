import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {build} from 'vite';
import {chromium,webkit} from 'playwright-core';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';

const parent=resolve('.local/tmp');await mkdir(parent,{recursive:true});
const work=await mkdtemp(resolve(parent,'review-ui-'));
const dist=resolve('dist');
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.wasm':'application/wasm'};
let server;
try{
 await build({configFile:false,publicDir:false,logLevel:'error',build:{outDir:work,lib:{
  entry:'tests/integration/review-ui-fixture.ts',formats:['es'],fileName:()=> 'fixture.js',
 }}});
 server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/seed'){res.writeHead(200,{'Content-Type':'text/html'}).end('<script type="module" src="/__fixture/fixture.js"></script>');return;}
   const fixture=url.pathname.startsWith('/__fixture/'),root=fixture?work:dist;
   const path=resolve(root,'.'+(fixture?url.pathname.slice('/__fixture'.length):url.pathname));
   if(!path.startsWith(root+'/'))throw Error('Ruta inválida');
   const data=await readFile(path);
   res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream'}).end(data);
  }catch{if(!res.headersSent)res.writeHead(404);res.end();}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const {entry}=JSON.parse(await readFile(resolve(dist,'latest.json'),'utf8'));
 const results=[];
 for(const [engine,launcher] of [['Chromium',chromium],['WebKit',webkit]]){
  let browser;
  try{
   browser=await launcher.launch(engine==='Chromium'?{executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true}:{headless:true});
   for(const viewport of [{width:390,height:844},{width:1366,height:768}]){
    const name=`${engine} ${viewport.width}×${viewport.height}`;
    const context=await browser.newContext({viewport,serviceWorkers:'block'});context.setDefaultTimeout(9000);
    const errors=[],external=[];
    let stage='preparación';
    try{
     await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin===origin||url.protocol==='blob:')return route.fallback();
      external.push(url.origin);return route.abort();
     });
     await installRequiredAccountFixture(context,origin);
     await context.route('**/assets/session.worker-*.js',route=>route.fulfill({contentType:'text/javascript',body:`
      self.onmessage=({data:command})=>{
       if(command.type==='restore')postMessage({
        version:2,session:command.session,request:command.request,phase:'connected',error:null,retryAt:null,delivery:null,
        binding:{accountRef:crypto.randomUUID(),accountEpoch:1},
        saved:{peerRef:crypto.randomUUID(),kind:'saved',name:'Mensajes guardados'},
        bots:[{providerRef:crypto.randomUUID(),username:'ivkmbot',label:'Bot sintético',status:'verified-profile',compatibility:'unverified'}]
       });
       else if(command.type==='logout')postMessage({});
      };
     `}));
     await context.addInitScript(()=>{
      // A saved synthetic session permits the shell. Disable automatic reconnection.
      Object.defineProperty(navigator,'onLine',{get:()=>false});
      try{delete Navigator.prototype.serviceWorker;}catch{/* optional */}
      const nativeGet=IDBObjectStore.prototype.get,nativeGetKey=IDBObjectStore.prototype.getKey;
      const nativePut=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(value,key){
       const result=nativePut.call(this,value,key);
       if(this.name==='settings'&&key==='library-playback'&&value.entries.length===0&&window.reviewCloseOnClear){
        window.reviewCloseOnClear=false;
        const db=this.transaction.db;queueMicrotask(()=>db.dispatchEvent(new Event('close')));
       }
       return result;
      };
      IDBObjectStore.prototype.get=function(key){
       if(this.name==='assets'&&key===sessionStorage.getItem('TESTONLY_UNVERIFIED'))throw new DOMException('Synthetic read failure','UnknownError');
       return nativeGet.call(this,key);
      };
      IDBObjectStore.prototype.getKey=function(key){
       if(this.name==='authorization'&&key==='session'){
        window.reviewVaultReads=(window.reviewVaultReads??0)+1;
        if(window.reviewVaultAbsent)return nativeGetKey.call(this,'TESTONLY_NONEXISTENT');
       }
       return nativeGetKey.call(this,key);
      };
      const NativeAudio=window.Audio;
      window.Audio=class extends NativeAudio{constructor(...args){super(...args);window.reviewAudio=this;}};
      Math.random=()=>0;
     });
     const page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
     await page.goto(origin+'/seed');await page.waitForFunction(()=>!!window.reviewUiSeed);
     const {unknownAssetId,pagedTrackId}=await page.evaluate(()=>window.reviewUiSeed());
     await page.evaluate(id=>sessionStorage.setItem('TESTONLY_UNVERIFIED',id),unknownAssetId);
     const url=origin+entry;await page.goto(url);
     const nav=page.locator('.shell-nav'),settings=page.locator('.settings-view');
     await page.waitForFunction(()=>document.querySelector('.pulso-app')?.inert===false);
     stage='una copia desconocida no vacía la biblioteca';
     const globalStatus=page.locator('.mini-player [role=status]');
     await globalStatus.filter({hasText:/No se pudo comprobar la copia local de una canción/}).waitFor({state:'attached'});
     assert.ok(await page.getByText('Audio de prueba 3',{exact:true}).first().isVisible());
     await page.evaluate(()=>sessionStorage.removeItem('TESTONLY_UNVERIFIED'));
     await button(page,'Configuración').click();
     await page.getByText('Espacio del navegador y revisión de archivos',{exact:true}).click();
     await button(page,'Comprobar archivos locales').click();
     await globalStatus.locator('button').waitFor({state:'hidden'});
     await button(page,'Cerrar configuración').click();
     await page.waitForFunction(()=>!history.state?.pulsoShell);
     await button(nav,'Biblioteca').click();
     const open=title=>page.locator('.library-grid button').filter({hasText:title}).click();
     const tools=page.locator('.collection-tools');
     const prepare=button(tools,'Preparar cola de esta selección');
     const notice=page.locator('.mini-player [role=status]');
     if(viewport.width===1366){
      stage='la paginación sobrevive a un refresco de metadatos';
      await open('Selección paginada');
      await button(page,'Página siguiente').first().click();
      await button(page,'Escuchar Ficha 51').waitFor();
      await page.evaluate(async id=>{
       const db=await new Promise((resolve,reject)=>{
        const request=indexedDB.open('pulso-web-local-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
       });
       try{
        await new Promise((resolve,reject)=>{
         const tx=db.transaction('tracks','readwrite'),store=tx.objectStore('tracks'),request=store.get(id);
         request.onsuccess=()=>{const track=request.result;store.put({...track,title:'Ficha actualizada',revision:track.revision+1},id);};
         tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
        });
       }finally{db.close();}
      },pagedTrackId);
      await button(page,'Configuración').click();
      await page.getByText('Espacio del navegador y revisión de archivos',{exact:true}).click();
      await button(page,'Comprobar archivos locales').click();
      await button(page,'Cerrar configuración').click();
      await button(page,'Escuchar Ficha actualizada').waitFor();
      await button(page,'Volver a Biblioteca').click();
      await page.waitForFunction(()=>!history.state?.pulsoShell);
     }
     stage='selección sin copias';
     await open('Selección sin audio');await tools.locator('summary').first().click();
     assert.equal(await prepare.isDisabled(),true);
     assert.equal(await button(tools,'Añadir selección a continuación (0)').isDisabled(),true);
     assert.equal(await button(tools,'Añadir selección al final (0)').isDisabled(),true);
     await tools.getByText('1 sin copia se omitirán.',{exact:false}).waitFor();
     await button(page,'Volver a Biblioteca').click();
     await page.waitForFunction(()=>!history.state?.pulsoShell);
     stage='selección mixta y aviso fuera de Configuración';
     await open('Selección mixta');
     if(await tools.getAttribute('open')===null)await tools.locator('summary').first().click();
     await tools.getByText('1 sin copia se omitirán.',{exact:false}).waitFor();
     assert.equal(await button(tools,'Añadir selección a continuación (3)').isVisible(),true);
     assert.equal(await button(tools,'Añadir selección al final (3)').isVisible(),true);
     await prepare.click();await notice.filter({hasText:/Cola lista y pausada/}).waitFor({state:'attached'});
     assert.equal(await settings.isVisible(),false);
     const expand=button(page,'Abrir reproductor desde minirreproductor');
     assert.equal(await page.locator('.mini-player .shell-notice').count(),0);
     assert.equal(await page.locator('.mini-player').getByRole('button',{name:'Cerrar aviso'}).count(),0);
     stage='menús por fila';
     assert.equal(await page.locator('.track-actions-menu select').count(),0);
     await button(page,'Opciones de Audio de prueba 1').click();
     const menu=page.locator('dialog[open]');
     await menu.getByText('Añadir a una playlist',{exact:true}).click();
     await menu.getByLabel('Playlist de destino').selectOption({label:'Selección sin audio'});
     await button(menu,'Cerrar opciones de canción').click();
     await button(page,'Opciones de Audio de prueba 2').click();
     await menu.getByText('Añadir a una playlist',{exact:true}).click();
     assert.equal(await menu.getByLabel('Playlist de destino').inputValue(),'');
     await button(menu,'Cerrar opciones de canción').click();
     stage='inserción masiva';
     await button(tools,'Añadir selección al final (3)').click();
     await notice.filter({hasText:/3 entradas añadidas al final/}).waitFor({state:'attached'});
     stage='cola efectiva y selección por ocurrencia';
     const player=page.locator('#player');
     assert.equal(await page.locator('.player-queue ol li').count(),0);
     await expand.click();await button(player,'Reproducción aleatoria').click();
     await button(player,'Cola').click();
     const rows=player.locator('.player-queue ol li');
     const titles=async()=>rows.locator('button:first-child').allTextContents();
     assert.deepEqual(await titles(),[1,3,1,2,3,2].map(n=>'Audio de prueba '+n));
     assert.equal(await rows.nth(1).getByRole('button',{name:/Subir en cola/}).isDisabled(),true);
     assert.equal(await rows.nth(0).getByRole('button',{name:/Bajar en cola/}).isDisabled(),true);
     const readQueue=async()=>page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{
       const request=indexedDB.open('pulso-web-local-v1');
       request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      });
      try{
       const store=db.transaction('settings').objectStore('settings');
       const get=key=>new Promise((resolve,reject)=>{
        const request=store.get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
       });
       return await Promise.all([get('library-playback'),get('library-playback-position')]);
      }finally{db.close();}
     });
     const waitForQueue=async predicate=>{
      for(let i=0;i<75;i++){
       const checkpoint=await readQueue();
       if(predicate(checkpoint))return checkpoint;
       await new Promise(resolve=>setTimeout(resolve,40));
      }
      assert.fail('No se guardó el estado esperado de la cola');
     };
     const [base]=await waitForQueue(([structure])=>structure?.shuffleOrder);
     await rows.nth(1).locator('button:first-child').click();
     assert.equal(await rows.nth(1).locator('button[aria-current=true]').textContent(),'Audio de prueba 3');
     stage='Atrás y URL de release';
     const back=async()=>{await page.goBack();assert.equal(page.url(),url);};
     await back();await button(player,'Cola').waitFor();assert.equal(await rows.count(),0);
     await button(player,'Pausar').click();
     await page.waitForFunction(()=>window.reviewAudio.paused);
     stage='posición aparte sin reescribir la cola';
     const seek=player.getByRole('slider',{name:'Posición de reproducción'});
     await seek.press('Home');
     for(let i=0;i<8;i++)await seek.press('ArrowRight');
     await page.waitForFunction(()=>window.reviewAudio.currentTime>=0.7&&window.reviewAudio.currentTime<=1);
     const checkpoint=await waitForQueue(([,position])=>position?.currentEntryId===base.shuffleOrder[1]&&position?.position>=0.7);
     assert.deepEqual(checkpoint[0],base);
     assert.equal(checkpoint[1]?.currentEntryId,base.shuffleOrder[1]);assert.ok(checkpoint[1]?.position>=0.7);
     stage='Atrás y URL de release';
     await back();await player.waitFor({state:'hidden'});assert.equal(await page.locator('.library-detail').isVisible(),true);
     await back();await page.locator('.library-detail').waitFor({state:'hidden'});assert.equal(await page.locator('.library-overview').isVisible(),true);
     await button(page,'Configuración').click();await settings.waitFor();
     await back();await settings.waitFor({state:'hidden'});assert.equal(await page.locator('.library-overview').isVisible(),true);
     stage='posición restaurada y apertura tras interrumpir el vaciado';
     await page.reload();await notice.filter({hasText:/Cola lista y pausada/}).waitFor({state:'attached'});
     await page.waitForFunction(()=>window.reviewAudio.paused&&window.reviewAudio.currentTime>=0.7);
     await page.locator('.mini-player__title').getByText('Audio de prueba 3',{exact:true}).waitFor();
     await expand.click();await button(player,'Cola').click();
     await page.evaluate(()=>{window.reviewCloseOnClear=true;});
     await button(player,'Vaciar cola').click();
     await back();await button(player,'Cola').waitFor();await back();await player.waitFor({state:'hidden'});
     const retry=button(page,'Reintentar apertura');await retry.click();
     await retry.waitFor({state:'hidden'});
     stage='revalidación y error al cerrar Telegram';
     await button(page,'Configuración').click();await button(page,'Conexiones').click();
     const reads=await page.evaluate(()=>{
      const app=document.querySelector('.pulso-app');window.reviewInertChanges=0;
      new MutationObserver(records=>{window.reviewInertChanges+=records.length;}).observe(app,{attributes:true,attributeFilter:['inert']});
      return window.reviewVaultReads;
     });
     await button(page,'Reconectar Telegram').click();
     const logout=button(page,'Cerrar sesión en Telegram');await logout.waitFor();
     await page.waitForFunction(previous=>window.reviewVaultReads>previous,reads);
     assert.equal(await page.evaluate(()=>window.reviewInertChanges),0);
     await page.evaluate(()=>{window.reviewVaultAbsent=true;});
     await logout.click();
     const setup=page.locator('.required-setup');
     await setup.getByRole('alert').filter({hasText:'No se confirmó el cierre ni la eliminación de la sesión guardada.'}).waitFor();
     assert.equal(await button(setup,'Eliminar sesión guardada').isEnabled(),true);
     assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
     results.push({name,passed:true});
    }catch(error){results.push({name,stage,error:String(error),errors,external});}
    finally{await context.close();}
   }
  }finally{await browser?.close();}
 }
 console.log(JSON.stringify(results,null,2));if(results.some(result=>!result.passed))process.exitCode=1;
}finally{
 if(server?.listening)await new Promise(done=>server.close(done));
 await rm(work,{recursive:true,force:true});
}
