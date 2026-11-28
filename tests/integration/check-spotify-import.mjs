import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {build,preview} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {CatalogRelay} from '../../deployment/cloudflare/relay.mjs';
import {spotifyPlaylist,spotifyTrackRelease} from '../../deployment/cloudflare/spotify-playlist.mjs';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';
import {createTestWorkspace} from './test-workspace.mjs';

const ws=await createTestWorkspace('spotify-import'),report={cases:[],errors:[],hashes:{}};
const account='11111111-1111-4111-8111-111111111111',otherAccount='22222222-2222-4222-8222-222222222222';
const anchorTrack='11111111-1111-4111-8111-111111111115';
const audioTrack='11111111-1111-4111-8111-111111111112',otherTrack='22222222-2222-4222-8222-222222222223';
const id='a'.repeat(22),publicId=process.argv[2],base='https://open.spotify.com/';
const fixtureRow=(title,artists,key,durationMs=3000)=>({title,artists,durationMs,url:base+'track/'+key.repeat(22)});
const local=fixtureRow('Copia guardada','Artista local','a'),pending=fixtureRow('Falta canción','Otro artista','b');
const unknown=fixtureRow('Crédito desconocido','', 'c',null),sameTags=fixtureRow(local.title,local.artists,'d');
const fixture={name:'Playlist de prueba',tracks:[pending,local,pending,unknown,sameTags],readCount:6,omitted:1,total:null,limited:false,complete:false};
const sharedAlbum='Álbum de prueba',appleAlbum='Álbum de catálogo';
const spotifyImage='https://image-cdn-fa.spotifycdn.com/image/'+'a'.repeat(40);
const appleImage='https://is1-ssl.mzstatic.com/image/100x100bb.png';
const localImage=await readFile('public/icons/pulso-192.png'),publicReleases=new Map();
const relay=new CatalogRelay(),publicAllowed=new Set();
const appleSong=(song,album,releaseId,trackId,num=1)=>({wrapperType:'track',kind:'song',collectionId:releaseId,trackId,
 discNumber:1,trackNumber:num,trackName:song.title,artistName:song.artists,collectionName:album,
 trackTimeMillis:song.durationMs,artworkUrl100:appleImage});
let server,publicData;
try {
 if(publicId){
  assert.match(publicId,/^[A-Za-z0-9]{22}$/);
  const response=await spotifyPlaylist(new Request('https://pulso.test/api/spotify-playlist/'+publicId));
  assert.equal(response.status,200);
  publicData=await response.json();
  for(const row of publicData.tracks.slice(0,4))publicAllowed.add(row.url.split('/').at(-1));
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
  const browser=await launcher.launch({headless:true,...(engine==='chromium'?{executablePath:'/usr/bin/chromium'}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},...(engine==='webkit'?{serviceWorkers:'block'}:{})});
  try {
   let mode='success',requests=0,appleCalls=0;
   await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    const response={headers:{'access-control-allow-origin':origin}};
    if(u.hostname==='itunes.apple.com'&&u.pathname==='/lookup'&&u.searchParams.get('id')==='21')return route.fulfill({...response,json:{resultCount:3,results:[
     {wrapperType:'collection',collectionType:'Album',collectionId:21,collectionName:sharedAlbum,artistName:pending.artists,trackCount:2,artworkUrl100:appleImage},
     {wrapperType:'track',kind:'song',collectionId:21,trackId:41,discNumber:1,discCount:1,trackNumber:1,trackCount:2,trackName:'Canción anterior',artistName:pending.artists,trackTimeMillis:3000},
     {wrapperType:'track',kind:'song',collectionId:21,trackId:43,discNumber:1,discCount:1,trackNumber:2,trackCount:2,trackName:pending.title,artistName:pending.artists,trackTimeMillis:3000},
    ]}});
    if(u.hostname==='itunes.apple.com'&&u.pathname==='/lookup'&&u.searchParams.get('id')==='22')return route.fulfill({...response,json:{resultCount:2,results:[
     {wrapperType:'collection',collectionType:'Album',collectionId:22,collectionName:appleAlbum,artistName:local.artists,trackCount:1,artworkUrl100:appleImage},
     {wrapperType:'track',kind:'song',collectionId:22,trackId:42,discNumber:1,discCount:1,trackNumber:1,trackCount:1,trackName:local.title,artistName:local.artists,trackTimeMillis:local.durationMs},
    ]}});
    if(u.hostname==='itunes.apple.com'&&u.pathname==='/search'){
     appleCalls++;
     const term=u.searchParams.get('term')??'';
     const results=term.includes(local.title)?[appleSong(local,appleAlbum,22,42)]:
      term.includes(pending.title)?[appleSong(pending,sharedAlbum,21,43,2),appleSong(pending,'Otra edición',23,44,2)]:[];
     return route.fulfill({...response,json:{resultCount:results.length,results}});
    }
    if(u.hostname==='is1-ssl.mzstatic.com')return route.fulfill({...response,body:localImage,contentType:'image/png'});
    if(u.origin!==origin)return route.abort();
    if(u.pathname==='/catalog/artwork'){
     if(u.searchParams.get('u')===spotifyImage)return route.fulfill({body:localImage,contentType:'image/png'});
     try{
      const image=await relay.get(u.pathname,u.search);
      return route.fulfill({body:Buffer.from(image.body),contentType:image.mime});
     }catch{return route.fulfill({status:502});}
    }
    if(u.pathname.startsWith('/api/spotify-track/')){
     const trackId=u.pathname.split('/').at(-1);
     if(publicAllowed.has(trackId)){
      if(!publicReleases.has(trackId))publicReleases.set(trackId,(async()=>{
       const resolved=await spotifyTrackRelease(new Request('https://pulso.test'+u.pathname));
       return {status:resolved.status,json:await resolved.json()};
      })());
      return route.fulfill(await publicReleases.get(trackId));
     }
     if(['b','d'].some(x=>trackId===x.repeat(22))){
      const second=trackId==='d'.repeat(22);
      return route.fulfill({json:{source:'spotify',releaseId:(second?'k':'j').repeat(22),trackId,
       position:2,title:second?'Otra edición':sharedAlbum,artist:pending.artists,artworkUrl:spotifyImage}});
     }
     return route.fulfill({status:502});
    }
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
   page.on('pageerror',error=>report.errors.push(publicData?error.name:error.message));
   page.setDefaultTimeout(12000);
   const button=name=>page.getByRole('button',{name,exact:true});
   const settings=async()=>{await button('Configuración').click();await button('Conexiones').click();};
   const openImport=id=>page.getByLabel('Enlace de la playlist',{exact:true}).fill(base+'playlist/'+id+'?si=discard');
   const submit=()=>button('Importar playlist').click();
   const result=()=>page.locator('.spotify-import__result');
   const stored=()=>page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
    try {
     const tx=db.transaction(['tracks','playlists','assets','settings'],'readonly');
     const read=store=>new Promise((resolve,reject)=>{const q=tx.objectStore(store).getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
     const [tracks,lists,assets,settings]=await Promise.all(['tracks','playlists','assets','settings'].map(read));
     const keys=await new Promise((resolve,reject)=>{const q=tx.objectStore('settings').getAllKeys();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
     const releases=Object.fromEntries(keys.flatMap((key,i)=>Array.isArray(key)&&key[0]==='spotify-catalog-release'?[[key[3],settings[i].release]]:[]));
     const membership=Object.fromEntries(keys.flatMap((key,i)=>Array.isArray(key)&&key[0]==='library-membership'?[[key[2],settings[i].added]]:[]));
     return {tracks,lists,assets:assets.length,releases,membership};
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
   await page.evaluate(async ({local,pending,account,otherAccount,audioTrack,otherTrack,anchorTrack,sharedAlbum})=>{
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
     tx.objectStore('tracks').put({...row,id:anchorTrack,accountId:account,title:'Canción anterior',artist:pending.artists,album:sharedAlbum,assetId:null,
      catalogChoice:{source:'itunes',id:'itunes:21:1:1:41',title:'Canción anterior',artist:pending.artists,album:sharedAlbum,duration:3}},anchorTrack);
     tx.objectStore('tracks').put({...row,id:otherTrack,accountId:otherAccount,title:pending.title,artist:pending.artists,assetId:null},otherTrack);
     tx.objectStore('assets').put({id:assetId,namespace:'local',storageKey:assetId,bytes:wav.length,sha256,mime:'audio/wav',chunks:1,
      state:'complete',revision:1,chunkSize:65536,backend:'idb',retention:'kept'},assetId);
     tx.objectStore('chunks').put(wav,[assetId,0]);
     await saved;
    }finally{db.close();}
   },{local,pending,account,otherAccount,audioTrack,otherTrack,anchorTrack,sharedAlbum});
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
   assert.deepEqual(songs.map(song=>saved.membership[song.id]),[false,undefined,false,false]);
   await button('Abrir en Biblioteca').click();await page.getByRole('heading',{name:fixture.name}).waitFor();
   assert.deepEqual(await page.locator('.library-detail .tracks > li strong').allTextContents(),[pending.title,local.title,unknown.title,sameTags.title]);
   await button('Opciones de playlist').click();
   try{await page.getByText('4/4 revisadas · 3 con álbum · 3 con portada',{exact:true}).waitFor({timeout:30000});}
   catch(e){report.catalogDiagnostic={status:await page.locator('.track-actions-menu[open] [role=status]').innerText().catch(()=>''),appleCalls,sources:Object.values((await stored()).releases).map(t=>t.source)};throw e;}
   await button('Cerrar opciones de colección').click();
   await page.waitForFunction(()=>[...document.querySelectorAll('.library-detail .tracks > li .collection-track-art img')].filter(i=>i.naturalWidth>0).length===3);
   const enriched=await stored();
   const enrichedRows=list.entries.map(({trackId})=>enriched.tracks.find(t=>t.id===trackId));
   assert.deepEqual(enrichedRows.map(t=>enriched.releases[t.id]?.source),['spotify','itunes',undefined,'spotify']);
   assert.equal(enriched.releases[enrichedRows[0].id].itunesReleaseId,21);
   assert.equal(enrichedRows[0].artist,pending.artists);
   assert.equal(enrichedRows[0].assetId,null);
   assert.ok(enrichedRows.every(t=>!Object.hasOwn(t,'catalogRelease')));
   if(engine==='chromium'){
    await button('Escuchar '+local.title).first().click();
    await page.waitForFunction(()=>window.fixtureAudio.some(audio=>!audio.paused&&audio.currentTime>0),null,{timeout:35000});
    await button('Abrir reproductor desde título').click();
    await page.waitForFunction(()=>document.querySelector('.player-surface .artwork-image')?.naturalWidth>0);
    assert.ok(await page.locator('.player-surface').getByText(appleAlbum,{exact:true}).isVisible());
   }
   // Recreate the old importer, where a Spotify-owned track had no membership record.
   await page.evaluate(async ids=>{
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
    try{
     const tx=db.transaction('settings','readwrite'),done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
     for(const id of ids)tx.objectStore('settings').delete(['library-membership',1,id]);
     await done;
    }finally{db.close();}
   },[songs[0].id,songs[2].id]);
   const albums=async()=>{
    await page.getByRole('navigation',{name:'Principal'}).getByRole('button',{name:'Biblioteca'}).click();
    const tab=button('Álbumes');if(await tab.getAttribute('aria-pressed')!=='true')await tab.click();
   };
   const openFixture=async()=>{
    await page.getByRole('navigation',{name:'Principal'}).getByRole('button',{name:'Biblioteca'}).click();
    const tab=button('Playlists');if(await tab.getAttribute('aria-pressed')!=='true')await tab.click();
    await page.locator('.library-grid .collection-card').filter({hasText:fixture.name}).click();
   };
   await page.reload();
   await albums();
   const existingAlbum=page.locator('.library-grid .collection-card').filter({hasText:sharedAlbum});
   await existingAlbum.waitFor();
   assert.equal(await existingAlbum.count(),1);
   assert.ok((await existingAlbum.innerText()).includes('1 canciones'));
   const cards=page.locator('.library-grid .collection-card:visible');
   assert.equal(await cards.count(),2);
   assert.equal(await cards.filter({hasText:/Sin álbum|Otra edición/}).count(),0);
   const migrated=await stored();
   assert.equal(migrated.membership[songs[0].id],false);
   assert.equal(migrated.membership[songs[2].id],false);
   assert.deepEqual(migrated.lists[0].entries,list.entries);
   await openFixture();
   await button('Opciones de '+pending.title).click();
   await button('Añadir a Biblioteca').click();
   await button('En Biblioteca').waitFor();
   await button('Cerrar opciones de canción').click();
   await albums();
   try{await existingAlbum.getByText('2 canciones',{exact:false}).waitFor();}
   catch(error){report.membershipDiagnostic={explicitSaved:(await stored()).membership[songs[0].id],cards:await cards.allTextContents()};throw error;}
   await existingAlbum.click();
   await button('Opciones del álbum').waitFor({timeout:30000});
   await button('Opciones del álbum').click();
   await button('Retirar álbum').click();
   const albumRemoval=page.locator('.collection-removal');
   await albumRemoval.getByText('Canciones de la colección').waitFor();
   assert.equal(await albumRemoval.locator('dl dd').first().textContent(),'2');
   await albumRemoval.getByRole('button',{name:'Cancelar'}).click();
   await albumRemoval.getByRole('button',{name:'Cerrar',exact:true}).click();
   await openFixture();
   // Model a playlist already imported by the previous release. Keep the exact
   // same Track and Playlist records, removing only its optional cache entry.
   await page.evaluate(async ({account,trackId})=>{
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
    try{
     const tx=db.transaction('settings','readwrite');
     const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
     tx.objectStore('settings').delete(['spotify-catalog-release',1,account,trackId]);await done;
    }finally{db.close();}
   },{account,trackId:songs[0].id});
   assert.equal((await stored()).releases[songs[0].id],undefined);
   await button('Opciones de playlist').click();
   await button('Actualizar álbumes y portadas de Spotify').click();
   await page.getByText('4/4 revisadas · 3 con álbum · 3 con portada',{exact:true}).waitFor({timeout:30000});
   assert.equal((await stored()).releases[songs[0].id].source,'spotify');
   await page.reload();
   await settings();await openImport(id);await submit();await result().waitFor();
   assert.ok((await result().innerText()).includes('4 canciones · 4 fichas reutilizadas · 1 disponible'));
   const reloaded=await stored();
   assert.deepEqual(reloaded.lists.map(({id,name,entries})=>({id,name,entries})),saved.lists.map(({id,name,entries})=>({id,name,entries})));
   const identity=({id,assetId,accountId,catalogChoice})=>({id,assetId,accountId,sourceId:catalogChoice?.id});
   assert.deepEqual(reloaded.tracks.map(identity),saved.tracks.map(identity));
   assert.equal(reloaded.assets,saved.assets);
   assert.equal(reloaded.membership[songs[0].id],true);
   assert.deepEqual(songs.slice(2).map(song=>reloaded.membership[song.id]),[false,false]);
   report.cases.push({engine,fixture:'PASS',failureAndClose:true,accountIsolation:true,order:true,refreshReuse:true,metadataAndImages:true,repairPreviousImport:true,catalogBridge:true,legacyPlaylistMembership:true,savedSingle:true,explicitLibrarySave:true,albumRemovalPreview:true,nativeAudio:engine==='chromium'?'PASS':'NOT_RUN'});
   if(publicData){
    await openImport(publicId);await submit();await result().waitFor();
    const after=await stored(),created=after.lists.find(candidate=>candidate.id!==list.id);
    assert.ok(created);
    const expected=[...new Set(publicData.tracks.filter(row=>row.title.trim()&&row.title.length<=300).map(row=>'spotify:'+row.url.split('/').at(-1)))];
    const actual=created.entries.map(({trackId})=>after.tracks.find(track=>track.id===trackId));
    assert.deepEqual(actual.map(track=>track.catalogChoice?.id),expected);
    assert.ok(actual.every(track=>track.assetId===null&&after.membership[track.id]===false));
    assert.equal(after.assets,saved.assets);
    await button('Abrir en Biblioteca').click();
    await button('Opciones de playlist').click();
    await page.getByText(/4\/4 revisadas · 4 con álbum/, {exact:false}).waitFor({timeout:30000});
    await page.waitForFunction(()=>[...document.querySelectorAll('.library-detail .tracks > li .collection-track-art img')].filter(i=>i.naturalWidth>0).length>=4);
    const withArtwork=await stored();
    const first=created.entries.slice(0,4).map(({trackId})=>withArtwork.tracks.find(track=>track.id===trackId));
    assert.ok(first.every(t=>withArtwork.releases[t.id]?.source==='spotify'&&withArtwork.releases[t.id].artworkUrl&&t.assetId===null));
    if(await button('Detener búsqueda de álbumes y portadas').isVisible())await button('Detener búsqueda de álbumes y portadas').click();
    report.cases.push({engine,public:'PASS',entries:actual.length,ordered:true,available:0,exactAlbumsAndDecodedImages:4});
   }
   const settingsClose=button('Cerrar configuración');
   if(await settingsClose.isVisible())await settingsClose.click();
   await albums();
   assert.equal(await cards.count(),2);
   const savedSingle=cards.filter({hasText:appleAlbum});
   await savedSingle.click();
   await button('Opciones del álbum').waitFor({timeout:30000});
   await button('Opciones del álbum').click();
   await button('Retirar álbum').click();
   await albumRemoval.getByRole('checkbox').check();
   await albumRemoval.getByRole('button',{name:'Eliminar álbum'}).click();
   await albumRemoval.getByText('La colección se eliminó.').waitFor();
   await albumRemoval.getByRole('button',{name:'Cerrar',exact:true}).click();
   const afterAlbum=await stored();
   assert.equal(afterAlbum.membership[audioTrack],false);
   assert.equal(afterAlbum.assets,saved.assets);
   assert.deepEqual(afterAlbum.lists.find(row=>row.id===list.id).entries,list.entries);
   await openFixture();
   if(engine==='chromium'){
    await button('Escuchar '+local.title).first().click();
    await page.waitForFunction(()=>window.fixtureAudio.some(audio=>!audio.paused&&audio.currentTime>0));
   }
   await button('Opciones de playlist').click();
   await button('Eliminar playlist').click();
   const removal=page.locator('.collection-removal');
   await removal.getByRole('checkbox').check();
   await removal.getByRole('button',{name:'Eliminar playlist'}).click();
   await removal.getByText('La colección se eliminó.').waitFor();
   const removed=await stored();
   assert.ok(!removed.lists.some(row=>row.id===list.id));
   assert.equal(removed.assets,saved.assets);
   report.cases.push({engine,deletion:'PASS',enrichedRowsParticipated:true,albumAndPlaylistRemoval:true,sharedAudioRetained:true});
   assert.ok(requests>=4);
  }finally{await context.close();await browser.close();}
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
