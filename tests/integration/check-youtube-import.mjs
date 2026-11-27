// YouTube playlist link -> Pulso playlist -> collection download -> offline playback.
// TESTONLY account and Telegram SDK; the YouTube route is fulfilled locally. No real Telegram, YouTube or bot traffic.
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {build,preview} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium} from 'playwright-core';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';

const ws={dir:await mkdtemp(resolve(process.env.PULSO_TEST_TMP_DIR??tmpdir(),'pulso-youtube-import-'))},report={steps:[],errors:[]};
const account='11111111-1111-4111-8111-111111111111',audioTrack='11111111-1111-4111-8111-111111111112',assetId='11111111-1111-4111-8111-111111111113';
const listId='PLymdogRYFRdJDRc2TzZnE5OCw-sRpyXEm';
const fixture={name:'H I G H & T R I P',total:5,truncated:false,items:[
 {title:'Copia guardada',channel:'Artista local - Topic'},
 {title:'Artista dos - Canción nueva (Official Video)',channel:'Canal de fans'},
 {title:'Tercera canción',channel:'Grupo Tres'},
 {title:'Copia guardada',channel:'Artista local - Topic'},
 {title:'¿Quién programó este juego? #shorts',channel:'Clips'},
]};
const step=name=>{report.steps.push(name);console.log('·',name);};
let server,context;
try{
 const sdk=()=>({name:'youtube-import-setup-test',enforce:'pre',resolveId(id){if(id==='./temporary-sdk')return resolve('tests/integration/required-setup-sdk.ts');}});
 const outDir=resolve(ws.dir,'bundle');
 await build({configFile:false,plugins:[tailwindcss(),sdk()],worker:{plugins:()=>[sdk()]},logLevel:'error',build:{outDir}});
 // Same shell list the production build precaches (scripts/build-sw.mjs), so offline reopening is real.
 const shell=['/','/index.html',...(await readdir(resolve(outDir,'assets'))).map(name=>'/assets/'+name)];
 await build({configFile:false,define:{SHELL_FILES:JSON.stringify(shell)},logLevel:'error',build:{emptyOutDir:false,outDir,lib:{entry:'src/service-worker/sw.ts',formats:['es'],fileName:()=> 'sw.js'}}});
 await writeFile(outDir+'/telegram-config.json',JSON.stringify({api_id:12345,api_hash:'0'.repeat(32)}));
 server=await preview({configFile:false,build:{outDir},preview:{host:'127.0.0.1',port:0}});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 context=await chromium.launchPersistentContext(resolve(ws.dir,'profile'),{headless:true,viewport:{width:1280,height:900},executablePath:process.env.PULSO_CHROMIUM??'/usr/bin/chromium'});
 let youtubeCalls=0;
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin!==origin)return route.abort();
  if(u.pathname==='/api/youtube-playlist'){
   youtubeCalls++;
   assert.equal(u.searchParams.get('list'),listId);
   return route.fulfill({json:fixture});
  }
  return route.fallback();
 });
 await installRequiredAccountFixture(context,origin);
 await context.addInitScript(()=>{
  // Every distinct download-dock message, so a run that finishes quickly is still observed.
  window.dockTexts=[];setInterval(()=>{const t=[...document.querySelectorAll('.download-dock')].map(e=>e.innerText).join(' | ').replace(/\s+/g,' ').trim();if(t&&window.dockTexts.at(-1)!==t)window.dockTexts.push(t);},150);
  const AudioConstructor=Audio;window.fixtureAudio=[];
  window.Audio=function(...args){const audio=new AudioConstructor(...args);window.fixtureAudio.push(audio);return audio;};
  window.Audio.prototype=AudioConstructor.prototype;
 });
 const page=await context.newPage();
 page.on('pageerror',error=>report.errors.push(error.message));
 page.setDefaultTimeout(15000);
 const button=name=>page.getByRole('button',{name,exact:true});
 const stored=()=>page.evaluate(async()=>{
  const db=await new Promise((ok,ko)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>ok(q.result);q.onerror=()=>ko(q.error);});
  try{const tx=db.transaction(['tracks','playlists'],'readonly');
   const read=s=>new Promise((ok,ko)=>{const q=tx.objectStore(s).getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>ko(q.error);});
   const [tracks,lists]=await Promise.all([read('tracks'),read('playlists')]);return {tracks,lists};}finally{db.close();}
 });

 await page.goto(origin);
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});
 step('app abre con la cuenta TESTONLY y service worker');
 const setup=page.locator('.required-setup');
 await setup.getByLabel('Número de teléfono',{exact:true}).fill('+15555550123');
 await setup.locator('.telegram-consent input').check();
 await setup.getByRole('button',{name:'Enviar código de acceso'}).click();
 await setup.getByLabel('Código de Telegram',{exact:true}).fill('12345');
 await setup.getByRole('button',{name:'Confirmar código'}).click();
 await setup.getByLabel('Contraseña de verificación en dos pasos').fill('TESTONLY');
 await setup.getByRole('button',{name:'Verificar contraseña'}).click();
 await setup.getByRole('button',{name:'Empezar a escuchar'}).click();
 step('login de Telegram simulado completado');

 // One song already downloaded on this device (WAV, 3 s).
 await page.evaluate(async({account,audioTrack,assetId})=>{
  const wav=new Uint8Array(48044),view=new DataView(wav.buffer),ascii=(v,o)=>[...v].forEach((c,i)=>wav[o+i]=c.charCodeAt(0));
  ascii('RIFF',0);view.setUint32(4,wav.length-8,true);ascii('WAVEfmt ',8);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii('data',36);view.setUint32(40,wav.length-44,true);
  const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',wav))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const db=await new Promise((ok,ko)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>ok(q.result);q.onerror=()=>ko(q.error);});
  try{const tx=db.transaction(['tracks','assets','chunks'],'readwrite'),saved=new Promise((ok,ko)=>{tx.oncomplete=ok;tx.onabort=()=>ko(tx.error);});
   tx.objectStore('tracks').put({id:audioTrack,accountId:account,title:'Copia guardada',artist:'Artista local',album:null,duration:3,favorite:false,revision:1,
    createdAt:new Date().toISOString(),manualOverrides:{},assetId,audioFingerprint:{algorithm:'sha256',sha256,bytes:wav.length}},audioTrack);
   tx.objectStore('assets').put({id:assetId,namespace:'local',storageKey:assetId,bytes:wav.length,sha256,mime:'audio/wav',chunks:1,state:'complete',revision:1,chunkSize:65536,backend:'idb',retention:'kept'},assetId);
   tx.objectStore('chunks').put(wav,[assetId,0]);await saved;}finally{db.close();}
 },{account,audioTrack,assetId});
 await page.reload();await page.waitForLoadState('networkidle');
 step('canción ya descargada sembrada');

 await button('Configuración').click();
 await page.getByLabel('Enlace de la playlist',{exact:true}).fill(`https://www.youtube.com/playlist?list=${listId}`);
 await button('Importar playlist').click();
 const result=page.locator('.spotify-import__result');
 await result.waitFor();
 const text=await result.innerText();report.result=text;
 assert.equal(youtubeCalls,1);
 assert.ok(text.includes('3 canciones · 1 ya descargada'),text);
 assert.ok(text.includes('Descargando 2 en segundo plano'),text);
 assert.ok(text.includes('1 repetida · 1 video que no parece canción'),text);
 step('importar enlace: 3 canciones, 1 reutilizada, 2 a descargar, repetida y short descartados');

 const saved=await stored(),list=saved.lists.find(l=>l.name===fixture.name);
 assert.ok(list,'playlist creada');
 const songs=list.entries.map(({trackId})=>saved.tracks.find(t=>t.id===trackId));
 assert.deepEqual(songs.map(t=>[t.artist,t.title]),[['Artista local','Copia guardada'],['Artista dos','Canción nueva'],['Grupo Tres','Tercera canción']]);
 assert.equal(songs[0].id,audioTrack);assert.ok(songs.slice(1).every(t=>t.assetId===null&&t.accountId===account));
 step('playlist guardada en Biblioteca con la copia existente reutilizada');

 const checkpoint=await page.waitForFunction(key=>localStorage.getItem(key),'pulso:library-download:v1:'+account,{timeout:15000}).then(h=>h.jsonValue());
 const cp=JSON.parse(checkpoint);report.checkpoint={title:cp.title,autoResume:cp.autoResume};
 assert.equal(cp.title,fixture.name);
 step('descarga de la playlist iniciada sola (checkpoint con reanudación automática)');
 await page.waitForFunction(()=>window.dockTexts.some(t=>t.includes('0 de 2 guardadas')&&t.includes('2 no disponibles')),null,{timeout:30000}).catch(()=>{});
 await page.waitForFunction(key=>!localStorage.getItem(key),'pulso:library-download:v1:'+account,{timeout:30000}).catch(()=>{});
 report.dock=(await page.evaluate(()=>window.dockTexts)).join(' || ').slice(0,600);
 report.checkpointLater=await page.evaluate(key=>localStorage.getItem(key),'pulso:library-download:v1:'+account);
 console.log('dock:',report.dock,'\ncheckpoint:',report.checkpointLater);
 // With no real bot both new songs fail: the run must try every one of them and finish, not stop at the first.
 assert.ok(report.dock.includes('0 de 2 guardadas')&&report.dock.includes('2 no disponibles'),report.dock);
 assert.equal(report.checkpointLater,null);
 step('una canción que falla no detiene la descarga: se intentan todas y el lote termina');

 // Re-import updates the same playlist instead of duplicating it.
 await button('Importar playlist').click();await page.getByText('lista actualizada').waitFor();
 assert.equal((await stored()).lists.filter(l=>l.name===fixture.name).length,1);
 step('reimportar actualiza la misma playlist');

 await button('Abrir playlist').click();
 await page.getByRole('heading',{name:fixture.name}).waitFor();
 assert.deepEqual(await page.locator('.library-detail .tracks > li strong').allTextContents(),['Copia guardada','Canción nueva','Tercera canción']);
 step('abrir playlist muestra las 3 canciones');

 // Offline: close the app (as when the phone kills the tab) and open it again with no network.
 await context.setOffline(true);
 await page.close({runBeforeUnload:false});
 const offline=await context.newPage();
 offline.on('pageerror',error=>report.errors.push('offline: '+error.message));
 offline.setDefaultTimeout(20000);
 await offline.goto(origin).catch(error=>{report.offlineGoto=error.message;});
 await offline.waitForTimeout(3000);
 report.offlineDiagnostic=(await offline.locator('body').innerText()).replace(/\s+/g,' ').slice(0,700);
 await offline.getByRole('button',{name:'Biblioteca',exact:true}).first().click();
 await offline.getByText(fixture.name).first().click();
 await offline.getByRole('heading',{name:fixture.name}).waitFor();
 step('sin internet: la app abre y la playlist está');
 await offline.locator('.library-detail .tracks > li').filter({hasText:'Copia guardada'}).locator('button').first().click();
 const playing=await offline.waitForFunction(()=>window.fixtureAudio.some(a=>a.currentSrc&&!a.paused&&a.currentTime>0),null,{timeout:15000}).then(()=>true).catch(()=>false);
 report.offlinePlay=playing;
 if(!playing)report.offlineDiagnostic=(await offline.locator('body').innerText()).replace(/\s+/g,' ').slice(0,700);
 assert.ok(playing,'reproducción sin conexión');
 step('sin internet: la canción descargada suena desde la playlist');
 assert.deepEqual(report.errors,[]);
 console.log('PASS',JSON.stringify(report.checkpoint));
}catch(error){
 console.error('FAIL',error.message,'\nsteps:',report.steps,'\nerrors:',report.errors,'\noffline goto:',report.offlineGoto??'-','\noffline screen:',report.offlineDiagnostic??'-');
 process.exitCode=1;
}finally{
 await context?.close().catch(()=>{});
 await new Promise(r=>server?server.httpServer.close(r):r());
 await rm(ws.dir,{recursive:true,force:true}).catch(()=>{});
}
