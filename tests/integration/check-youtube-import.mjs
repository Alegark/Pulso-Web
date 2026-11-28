// TESTONLY account, local API fixture, and synthetic audio. No real provider traffic.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {build} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';

const root=resolve('.local/tmp',`v70-youtube-it-${process.pid}`);
const report={status:'FAIL',engines:[],failedCases:[]};
const account='11111111-1111-4111-8111-111111111111';
const user={id:account,name:'Persona TESTONLY',email:'fixture@example.test',emailVerified:true};
const audioTrack='11111111-1111-4111-8111-111111111112';
const assetId='11111111-1111-4111-8111-111111111113';
const listId='PLymdogRYFRdJDRc2TzZnE5OCw-sRpyXEm';
const fixture={name:'H I G H & T R I P',total:5,truncated:false,items:[
 {title:'Copia guardada',channel:'Artista local - Topic'},
 {title:'Artista dos - Canción nueva (Official Video)',channel:'Canal de fans'},
 {title:'Tercera canción',channel:'Grupo Tres'},
 {title:'Copia guardada',channel:'Artista local - Topic'},
 {title:'¿Quién programó este juego? #shorts',channel:'Clips'},
]};
const errors={
 '503':{status:503,body:{error:'not-configured'},text:'no está disponible en este sitio'},
 '401':{status:401,body:{error:'sign-in-required'},text:'Inicia sesión en Pulso'},
 '403':{status:403,body:{error:'private'},text:'privada o no se puede leer'},
 '404':{status:404,body:{error:'not-found'},text:'No se encontró esa playlist'},
 '429':{status:429,body:{error:'rate-limited'},text:'Espera un minuto'},
};
let server;
let activeMode='success',youtubeCalls=0,accountLibrary;
const availableEngines=[['chromium',chromium],['webkit',webkit]];
const selectedEngine=process.env.PULSO_TEST_ENGINE;
if(selectedEngine&&!['chromium','webkit'].includes(selectedEngine))throw new Error('PULSO_TEST_ENGINE debe ser chromium o webkit');
const engines=selectedEngine?availableEngines.filter(([engine])=>engine===selectedEngine):availableEngines;

try{
 await rm(root,{recursive:true,force:true});await mkdir(root,{recursive:true});
 const sdk=()=>({name:'youtube-import-setup-test',enforce:'pre',resolveId(id){if(id==='./temporary-sdk')return resolve('tests/integration/required-setup-sdk.ts');}});
 const outDir=resolve(root,'bundle');
 await build({configFile:false,plugins:[tailwindcss(),sdk()],worker:{plugins:()=>[sdk()]},logLevel:'error',build:{outDir}});
 const shell=['/','/index.html',...(await readdir(resolve(outDir,'assets'))).map(name=>'/assets/'+name)];
 await build({configFile:false,define:{SHELL_FILES:JSON.stringify(shell)},logLevel:'error',build:{emptyOutDir:false,outDir,lib:{entry:'src/service-worker/sw.ts',formats:['es'],fileName:()=> 'sw.js'}}});
 await writeFile(outDir+'/telegram-config.json',JSON.stringify({api_id:12345,api_hash:'0'.repeat(32)}));
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
 server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url??'/', 'http://pulso.local');
   if(url.pathname==='/account-config.json'){
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({version:1,enabled:true,google:false}));return;
   }
   if(url.pathname==='/api/account-auth/get-session'){
    const now=new Date().toISOString();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({user,session:{id:'TESTONLY',token:'TESTONLY',userId:user.id,expiresAt:new Date(Date.now()+3600000).toISOString(),createdAt:now,updatedAt:now}}));return;
   }
   if(url.pathname==='/api/account-profile'){
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({accountId:user.id,telegramPhone:null,revision:null}));return;
   }
   if(url.pathname==='/api/account-library'){
    if(req.method==='PUT'){
     let input;try{input=JSON.parse(await new Promise((resolveBody,reject)=>{let body='';req.setEncoding('utf8');req.on('data',chunk=>body+=chunk);req.on('end',()=>resolveBody(body));req.on('error',reject);}));}catch{res.writeHead(400).end();return;}
     if(input.accountId!==user.id||input.revision!==accountLibrary.revision){res.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({code:'LIBRARY_CHANGED'}));return;}
     accountLibrary={accountId:user.id,revision:(accountLibrary.revision??0)+1,document:input.document};
    }
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(accountLibrary));return;
   }
   if(url.pathname==='/api/youtube-playlist'){
    youtubeCalls++;
    if(activeMode!=='success'){const failure=errors[activeMode];res.writeHead(failure.status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(failure.body));return;}
    if(url.searchParams.get('list')!==listId){res.writeHead(400).end();return;}
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(fixture));return;
   }
   if(!['GET','HEAD'].includes(req.method??'')){res.writeHead(405).end();return;}
   const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
   if(pathname.split('/').some(part=>part==='..'||part==='.')||pathname.includes('\\')||pathname.includes('\0'))throw Error('path');
   const file=resolve(outDir,'.'+pathname);if(!file.startsWith(outDir+sep))throw Error('path');
   const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file).toLowerCase()]??'application/octet-stream','Content-Length':bytes.length,'X-Content-Type-Options':'nosniff','Cache-Control':pathname==='/'?'no-store':'public, max-age=3600'}).end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404).end();}
 });
 await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolveListen);});
 const origin='http://127.0.0.1:'+server.address().port;

 for(const [engine,launcher] of engines){
  const entry={engine,cases:[],failedCases:[]};report.engines.push(entry);
  let browser,context,page;
  let activeCase='test setup';activeMode='success';youtubeCalls=0;
  accountLibrary={accountId:user.id,revision:null,document:{version:1,tracks:[],playlists:[]}};
  const pass=name=>entry.cases.push(name);
  try{
   browser=await launcher.launch({headless:true,...(engine==='chromium'?{executablePath:'/usr/bin/chromium',chromiumSandbox:true}:{}),env:{...process.env,INSTABOX_HEADLESS:'1'}});
   context=await browser.newContext({viewport:{width:1280,height:900}});context.setDefaultTimeout(15000);
   await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin!==origin){
     if(u.hostname==='itunes.apple.com')return route.fulfill({json:{resultCount:0,results:[]},headers:{'access-control-allow-origin':'*'}});
     return route.abort();
    }
    return route.fallback();
   });
   await context.addInitScript(()=>{
    window.dockTexts=[];setInterval(()=>{const value=[...document.querySelectorAll('.download-dock')].map(node=>node.innerText).join(' ').replace(/\s+/g,' ').trim();if(value&&window.dockTexts.at(-1)!==value)window.dockTexts.push(value);},150);
    const AudioConstructor=Audio;window.fixtureAudio=[];
    window.Audio=function(...args){const audio=new AudioConstructor(...args);window.fixtureAudio.push(audio);return audio;};
    window.Audio.prototype=AudioConstructor.prototype;
   });
   page=await context.newPage();page.on('pageerror',error=>entry.failedCases.push('page error: '+error.name));
   const button=name=>page.getByRole('button',{name,exact:true});
   const field=page.getByLabel('Enlace de la playlist',{exact:true});
   const result=page.locator('.spotify-import__result');
   const stored=()=>page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('pulso-web-local-v1');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    try{const tx=db.transaction(['tracks','playlists'],'readonly');
     const read=name=>new Promise((resolve,reject)=>{const req=tx.objectStore(name).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
     const [tracks,lists]=await Promise.all([read('tracks'),read('playlists')]);return {tracks,lists};
    }finally{db.close();}
   });

   activeCase='TESTONLY login and local library setup';
   await page.goto(origin);
   await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
   const setup=page.locator('.required-setup');
   await setup.getByLabel('Número de teléfono',{exact:true}).waitFor();
   await page.evaluate(async({account,audioTrack,assetId})=>{
    const wav=new Uint8Array(48044),view=new DataView(wav.buffer),ascii=(value,offset)=>[...value].forEach((char,index)=>wav[offset+index]=char.charCodeAt(0));
    ascii('RIFF',0);view.setUint32(4,wav.length-8,true);ascii('WAVEfmt ',8);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii('data',36);view.setUint32(40,wav.length-44,true);
    const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',wav))].map(value=>value.toString(16).padStart(2,'0')).join('');
    const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('pulso-web-local-v1');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    try{const tx=db.transaction(['tracks','assets','chunks'],'readwrite'),saved=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
     tx.objectStore('tracks').put({id:audioTrack,accountId:account,title:'Copia guardada',artist:'Artista local',album:null,duration:3,favorite:false,revision:1,createdAt:new Date().toISOString(),manualOverrides:{},assetId,audioFingerprint:{algorithm:'sha256',sha256,bytes:wav.length}},audioTrack);
     tx.objectStore('assets').put({id:assetId,namespace:'local',storageKey:assetId,bytes:wav.length,sha256,mime:'audio/wav',chunks:1,state:'complete',revision:1,chunkSize:65536,backend:'idb',retention:'kept'},assetId);
     tx.objectStore('chunks').put(wav,[assetId,0]);await saved;
    }finally{db.close();}
   },{account,audioTrack,assetId});
   await setup.getByLabel('Número de teléfono',{exact:true}).fill('+15555550123');
   await setup.locator('.telegram-consent input').check();
   await setup.getByRole('button',{name:'Enviar código de acceso'}).click();
   await setup.getByLabel('Código de Telegram',{exact:true}).fill('12345');
   await setup.getByRole('button',{name:'Confirmar código'}).click();
   await setup.getByLabel('Contraseña de verificación en dos pasos').fill('TESTONLY');
   await setup.getByRole('button',{name:'Verificar contraseña'}).click();
   await setup.getByRole('button',{name:'Empezar a escuchar'}).click();
   await page.getByRole('button',{name:'Configuración',exact:true}).waitFor();
   pass('TESTONLY login');

   activeCase='importer placement in Connections and text input';
   await button('Configuración').click();
   await button('General').click();
   assert.equal(await page.locator('.spotify-import').count(),0,'the playlist importer must not appear in General');
   await button('Conexiones').click();
   await page.getByRole('heading',{name:'Importar playlist de Spotify o YouTube'}).waitFor();
   assert.equal(await field.getAttribute('type'),'text');assert.equal(await field.getAttribute('inputmode'),'url');
   pass('importer is inside Settings → Connections and absent from General');

   activeCase='URL import summary, reuse, and no automatic download';
   await field.fill(`https://www.youtube.com/playlist?list=${listId}`);await button('Importar playlist').click();await result.waitFor();
   const summary=await result.innerText();
   assert.ok(summary.includes('3 canciones · 1 ficha reutilizada · 1 con copia local · 2 pendientes de copia local'),summary);
   assert.ok(summary.includes('1 entrada repetida · 1 video ignorado'),summary);
   assert.ok(await button('Abrir en Biblioteca').isVisible());
   assert.ok(await button('Descargar faltantes (2)').isVisible());
   await page.waitForTimeout(400);
   assert.equal(await page.evaluate(key=>localStorage.getItem(key),'pulso:library-download:v1:'+account),null,'import must not start downloads');
   assert.equal(youtubeCalls,1);
   pass('URL import creates a playlist, reuses the downloaded track, reports pending tracks and does not auto-download');

   activeCase='imported playlist data in IndexedDB';
   const before=await stored();const imported=before.lists.find(list=>list.name===fixture.name);assert.ok(imported);
   const importedIds=imported.entries.map(entry=>entry.trackId);
   const importedSongs=importedIds.map(id=>before.tracks.find(track=>track.id===id));
   assert.deepEqual(importedSongs.map(track=>[track.artist,track.title]),[['Artista local','Copia guardada'],['Artista dos','Canción nueva'],['Grupo Tres','Tercera canción']]);
   assert.equal(importedSongs[0].id,audioTrack);assert.ok(importedSongs.slice(1).every(track=>track.assetId===null&&track.accountId===account));

   activeCase='bare ID import and linked reimport';
   await field.fill(listId);await button('Importar playlist').click();await page.getByText('lista actualizada').waitFor();
   const afterId=await stored();assert.equal(afterId.lists.filter(list=>list.name===fixture.name).length,1);
   assert.equal(afterId.lists.find(list=>list.name===fixture.name).id,imported.id);
   assert.equal(youtubeCalls,2);pass('bare YouTube playlist IDs work and reimport updates the linked playlist');

   activeCase='manual download request';
   const download=button('Descargar faltantes (2)');await download.click();
   await page.waitForFunction(key=>!!localStorage.getItem(key),'pulso:library-download:v1:'+account,{timeout:20000});
   assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).title,'pulso:library-download:v1:'+account),fixture.name);
   assert.equal(await button('Descargas solicitadas').isDisabled(),true);
   pass('manual download button requests the missing tracks and becomes disabled');
   activeCase='open imported playlist in Library';
   await button('Abrir en Biblioteca').click();await page.getByRole('heading',{name:fixture.name}).waitFor();
   pass('Abrir en Biblioteca opens the imported playlist');

   for(const [code,fixtureError] of Object.entries(errors)){
    activeCase=`Spanish UI error ${code}`;
    activeMode=code;await page.getByRole('button',{name:'Configuración',exact:true}).click();
    await button('Conexiones').click();await field.fill(`https://www.youtube.com/playlist?list=${listId}`);await button('Importar playlist').click();
    const status=page.locator('.spotify-import [role="status"]');await status.getByText(fixtureError.text,{exact:false}).waitFor();
    entry.cases.push(`YouTube ${code} error is explained in Spanish`);
   }
   activeMode='success';

   activeCase='offline reopen and local playback';
   await page.getByRole('button',{name:'Biblioteca',exact:true}).first().click();
   await page.getByText(fixture.name).first().click();await page.getByRole('heading',{name:fixture.name}).waitFor();
   await context.setOffline(true);await page.close({runBeforeUnload:false});
   const offline=await context.newPage();offline.on('pageerror',error=>entry.failedCases.push('offline page error: '+error.name));
   await offline.goto(origin).catch(()=>{});await offline.waitForTimeout(1800);
   await offline.getByRole('button',{name:'Biblioteca',exact:true}).first().click();
   await offline.getByText(fixture.name).first().click();await offline.getByRole('heading',{name:fixture.name}).waitFor();
   await offline.locator('.library-detail .tracks > li').filter({hasText:'Copia guardada'}).locator('button').first().click();
   const playing=await offline.waitForFunction(()=>window.fixtureAudio.some(audio=>audio.currentSrc&&!audio.paused&&audio.currentTime>0),null,{timeout:15000}).then(()=>true).catch(()=>false);
   assert.equal(playing,true,'downloaded synthetic audio plays after offline reopen');
   pass('offline reopen plays the downloaded track');
   assert.deepEqual(entry.failedCases,[]);
  }catch(error){
   const detail=error instanceof Error?error.stack??error.message:String(error);
   await mkdir(resolve('.local/tmp/v70-impl'),{recursive:true});
   await writeFile(resolve('.local/tmp/v70-impl',`youtube-${engine}-failure.log`),detail);
   entry.failedCases.push(activeCase);
   if(engine==='webkit'&&page){
    const diagnostic={youtubeCalls,importerCount:await page.locator('.spotify-import').count().catch(()=>-1),
     status:await page.locator('.spotify-import [role="status"]').innerText().catch(()=>''),
     resultCount:await page.locator('.spotify-import__result').count().catch(()=>-1),bodyTail:(await page.locator('body').innerText().catch(()=>'' )).slice(-700)};
    await writeFile(resolve('.local/tmp/v70-impl/webkit-ui-diagnostic.txt'),JSON.stringify(diagnostic,null,2));
   }
   report.failedCases.push(`${engine}: ${activeCase}`);
  }finally{
   await context?.close().catch(()=>{});await browser?.close().catch(()=>{});
  }
 }
 report.status=report.failedCases.length?'FAIL':'PASS';
}catch(error){
 report.failedCases.push(error instanceof Error?error.message:'unknown setup failure');
}finally{
 if(server)await new Promise(resolveClose=>server.close(resolveClose));
 await rm(root,{recursive:true,force:true}).catch(()=>{});
 console.log(JSON.stringify({status:report.status,engines:report.engines.map(({engine,cases,failedCases})=>({engine,passed:cases.length,failedCases})),failedCases:report.failedCases}));
 if(report.status!=='PASS')process.exitCode=1;
}
