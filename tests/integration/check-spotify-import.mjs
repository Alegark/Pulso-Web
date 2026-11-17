import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {build,preview} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {spotifyPlaylist} from '../../deployment/cloudflare/spotify-playlist.mjs';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';
import {createTestWorkspace} from './test-workspace.mjs';

const ws=await createTestWorkspace('spotify-import'),report={cases:[],errors:[],hashes:{}};
const account='11111111-1111-4111-8111-111111111111',otherAccount='22222222-2222-4222-8222-222222222222';
const audioTrack='11111111-1111-4111-8111-111111111112',otherTrack='22222222-2222-4222-8222-222222222223';
const id='a'.repeat(22),publicId=process.argv[2],base='https://open.spotify.com/';
const fixtureRow=(title,artists,key,durationMs=3000)=>({title,artists,durationMs,url:base+'track/'+key.repeat(22)});
const local=fixtureRow('Copia guardada','Artista local','a'),pending=fixtureRow('Falta canción','Otro artista','b');
const unknown=fixtureRow('Crédito desconocido','', 'c',null),sameTags=fixtureRow(local.title,local.artists,'d');
const fixture={name:'Playlist de prueba',tracks:[pending,local,pending,unknown,sameTags],readCount:6,omitted:1,total:null,limited:false,complete:false};
let server,publicData;
try {
 if(publicId){
  assert.match(publicId,/^[A-Za-z0-9]{22}$/);
  const response=await spotifyPlaylist(new Request('https://pulso.test/api/spotify-playlist/'+publicId));
  assert.equal(response.status,200);
  publicData=await response.json();
  report.public={status:response.status,read:publicData.readCount,omitted:publicData.omitted,total:publicData.total,complete:publicData.complete};
 }
 for(const file of ['src/main.tsx','src/playlists/spotify-import.ts','src/ui/SpotifyPlaylistImport.tsx','deployment/cloudflare/spotify-playlist.mjs']){
  report.hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
 }
 const sdk=()=>({name:'spotify-import-setup-test',enforce:'pre',resolveId(id){if(id==='./temporary-sdk')return resolve('tests/integration/required-setup-sdk.ts');}});
 const outDir=resolve(ws.dir,'bundle');
 await build({configFile:false,plugins:[tailwindcss(),sdk()],worker:{plugins:()=>[sdk()]},logLevel:'error',build:{outDir}});
 await build({configFile:false,define:{SHELL_FILES:'[]'},logLevel:'error',build:{emptyOutDir:false,outDir,lib:{entry:'src/service-worker/sw.ts',formats:['es'],fileName:()=> 'sw.js'}}});
 await writeFile(outDir+'/telegram-config.json',JSON.stringify({api_id:12345,api_hash:'0'.repeat(32)}));
 server=await preview({configFile:false,build:{outDir},preview:{host:'127.0.0.1',port:0}});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
  const context=await launcher.launchPersistentContext(resolve(ws.dir,engine+'-profile'),{
   headless:true,viewport:{width:390,height:844},...(engine==='chromium'?{executablePath:'/usr/bin/chromium'}:{serviceWorkers:'block'})
  });
  try {
   let mode='success',requests=0;
   await context.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.origin!==origin)return route.abort();
    if(!u.pathname.startsWith('/api/spotify-playlist/'))return route.continue();
    requests++;
    assert.equal(u.search,'');
    assert.equal(route.request().headers().authorization,undefined);
    if(mode==='slow')return new Promise(ok=>setTimeout(ok,450)).then(()=>route.fulfill({json:fixture})).catch(()=>{});
    if(mode==='failure')return route.fulfill({status:502,json:{error:'unavailable'}});
    return route.fulfill({json:publicData&&u.pathname.endsWith('/'+publicId)?publicData:fixture});
   });
   await installRequiredAccountFixture(context,origin);
   await context.addInitScript(()=>{
    const AudioConstructor=Audio;
    window.fixtureAudio=[];
    window.Audio=function(...args){const audio=new AudioConstructor(...args);window.fixtureAudio.push(audio);return audio;};
    window.Audio.prototype=AudioConstructor.prototype;
   });
   const page=await context.newPage();
   page.on('pageerror',error=>report.errors.push(error.message));
   page.setDefaultTimeout(12000);
   const button=name=>page.getByRole('button',{name,exact:true});
   const settings=()=>button('Configuración').click();
   const openImport=id=>page.getByLabel('Enlace de la playlist de Spotify').fill(base+'playlist/'+id+'?si=discard');
   const submit=()=>button('Importar playlist').click();
   const result=()=>page.locator('.spotify-import__result');
   const stored=()=>page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
    try {
     const tx=db.transaction(['tracks','playlists','assets'],'readonly');
     const read=store=>new Promise((resolve,reject)=>{const q=tx.objectStore(store).getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
     const [tracks,lists,assets]=await Promise.all(['tracks','playlists','assets'].map(read));
     return {tracks,lists,assets:assets.length};
    }finally{db.close();}
   });
   await page.goto(origin);
   if(engine==='chromium')await page.evaluate(async()=>{
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
   });
   const setup=page.locator('.required-setup');
   try{await setup.getByLabel('Número de teléfono',{exact:true}).fill('+15555550123');}
   catch(error){report.setupDiagnostic=(await page.locator('body').innerText()).slice(0,800);throw error;}
   await setup.locator('.telegram-consent input').check();
   await setup.getByRole('button',{name:'Enviar código de acceso'}).click();
   await setup.getByLabel('Código de Telegram',{exact:true}).fill('12345');
   await setup.getByRole('button',{name:'Confirmar código'}).click();
   await setup.getByLabel('Contraseña de verificación en dos pasos').fill('TESTONLY');
   await setup.getByRole('button',{name:'Verificar contraseña'}).click();
   await setup.getByRole('button',{name:'Empezar a escuchar'}).click();
   await page.evaluate(async ({local,pending,account,otherAccount,audioTrack,otherTrack})=>{
    const wav=new Uint8Array(48044),view=new DataView(wav.buffer);
    const ascii=(value,offset)=>[...value].forEach((char,i)=>wav[offset+i]=char.charCodeAt(0));
    ascii('RIFF',0);view.setUint32(4,wav.length-8,true);ascii('WAVEfmt ',8);view.setUint32(16,16,true);
    view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);
    view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
    ascii('data',36);view.setUint32(40,wav.length-44,true);
    const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',wav))].map(x=>x.toString(16).padStart(2,'0')).join('');
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
    const assetId='11111111-1111-4111-8111-111111111113';
    try {
     const tx=db.transaction(['tracks','assets','chunks'],'readwrite');
     const saved=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
     const row={createdAt:new Date().toISOString(),revision:1,duration:3,album:null,favorite:false,manualOverrides:{}};
     tx.objectStore('tracks').put({...row,id:audioTrack,accountId:account,title:local.title,artist:local.artists,assetId,
      audioFingerprint:{algorithm:'sha256',sha256,bytes:wav.length}},audioTrack);
     tx.objectStore('tracks').put({...row,id:otherTrack,accountId:otherAccount,title:pending.title,artist:pending.artists,assetId:null},otherTrack);
     tx.objectStore('assets').put({id:assetId,namespace:'local',storageKey:assetId,bytes:wav.length,sha256,mime:'audio/wav',chunks:1,
      state:'complete',revision:1,chunkSize:65536,backend:'idb',retention:'kept'},assetId);
     tx.objectStore('chunks').put(wav,[assetId,0]);
     await saved;
    }finally{db.close();}
   },{local,pending,account,otherAccount,audioTrack,otherTrack});
   await settings();
   mode='failure';await openImport(id);await submit();
   await page.locator('.spotify-import [role=status]').getByText(/No se pudo leer/).waitFor();
   assert.equal((await stored()).lists.length,0);
   mode='slow';await submit();await button('Cerrar configuración').click();
   await page.waitForTimeout(550);assert.equal((await stored()).lists.length,0);
   await settings();mode='success';await openImport(id);await submit();await result().waitFor();
   assert.ok((await result().innerText()).includes('4 canciones · 1 ficha reutilizada · 1 disponible'));
   assert.ok((await result().innerText()).includes('1 entrada repetida · 1 entrada omitida'));
   assert.equal(await button('Descargar CSV').count()+await button('Descargar TXT').count(),0);
   const saved=await stored(),list=saved.lists[0];
   const songs=list.entries.map(({trackId})=>saved.tracks.find(track=>track.id===trackId));
   assert.deepEqual(songs.map(track=>track.title),[pending.title,local.title,unknown.title,sameTags.title]);
   assert.equal(songs[1].id,audioTrack);assert.notEqual(songs[0].id,otherTrack);
   assert.ok(songs.every(track=>track.accountId===account));
   assert.equal(songs[0].assetId,null);assert.equal(songs[2].assetId,null);assert.equal(songs[2].duration,0);
   assert.notEqual(songs[3].id,audioTrack);assert.equal(songs[3].catalogChoice.id,'spotify:'+'d'.repeat(22));
   assert.equal(saved.assets,1);
   await button('Abrir en Biblioteca').click();await page.getByRole('heading',{name:fixture.name}).waitFor();
   assert.deepEqual(await page.locator('.library-detail .tracks > li strong').allTextContents(),[pending.title,local.title,unknown.title,sameTags.title]);
   if(engine==='chromium'){
    await button('Escuchar '+local.title).first().click();
    await page.waitForFunction(()=>window.fixtureAudio.some(audio=>!audio.paused&&audio.currentTime>0),null,{timeout:35000});
   }
   await page.reload();
   await settings();await openImport(id);await submit();await result().waitFor();
   assert.ok((await result().innerText()).includes('4 canciones · 4 fichas reutilizadas · 1 disponible'));
   const reloaded=await stored();
   assert.deepEqual(reloaded.lists.map(({id,name,entries})=>({id,name,entries})),saved.lists.map(({id,name,entries})=>({id,name,entries})));
   const identity=({id,assetId,accountId,catalogChoice})=>({id,assetId,accountId,sourceId:catalogChoice?.id});
   assert.deepEqual(reloaded.tracks.map(identity),saved.tracks.map(identity));
   assert.equal(reloaded.assets,saved.assets);
   report.cases.push({engine,fixture:'PASS',failureAndClose:true,accountIsolation:true,order:true,refreshReuse:true,nativeAudio:engine==='chromium'?'PASS':'NOT_RUN'});
   if(publicData){
    await openImport(publicId);await submit();await result().waitFor();
    const after=await stored(),created=after.lists.find(candidate=>candidate.id!==list.id);
    assert.ok(created);
    const expected=[...new Set(publicData.tracks.filter(row=>row.title.trim()&&row.title.length<=300).map(row=>'spotify:'+row.url.split('/').at(-1)))];
    const actual=created.entries.map(({trackId})=>after.tracks.find(track=>track.id===trackId));
    assert.deepEqual(actual.map(track=>track.catalogChoice?.id),expected);
    assert.ok(actual.every(track=>track.assetId===null));
    assert.equal(after.assets,saved.assets);
    report.cases.push({engine,public:'PASS',entries:actual.length,ordered:true,available:0});
   }
   assert.ok(requests>=4);
  }finally{await context.close();}
 }
 assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(error){
 report.status='FAIL';
 // The optional authorized listing may only contribute aggregate evidence.
 report.error=publicData?[error.name,...String(error.stack).split('\n').filter(line=>/^\s+at /.test(line))].join('\n'):String(error.stack);
}finally{
 if(server)await new Promise(ok=>server.httpServer.close(ok));
 report.removedBytes=Number(execFileSync('du',['-sb',ws.dir],{encoding:'utf8'}).split(/\s/)[0]);
 report.cleanup=await ws.cleanup();
 await writeFile(ws.evidence+'/report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({evidence:ws.evidence,...report},null,2));
 if(report.status!=='PASS')process.exitCode=1;
}
