// Own isolated test build; never reads/writes dist or opens external services.
// Run: INSTABOX_HEADLESS=1 node tests/integration/check-queue-restore-ui.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {build,preview} from 'vite';
import {chromium} from 'playwright-core';
const backend=process.env.PULSO_RESTORE_BACKEND??'idb';
const transport=process.env.PULSO_RESTORE_TRANSPORT??'blob';
const offlineFocus=process.env.PULSO_RESTORE_FOCUS==='offline';
const corruptionFocus=process.env.PULSO_RESTORE_FOCUS==='corruption';
assert.ok(['idb','opfs'].includes(backend));assert.ok(['blob','sw'].includes(transport));
const outDir=`.local/queue-restore-product-${backend}-${transport}`;
const report={passed:false,environment:'Chromium Linux sandbox, ephemeral loopback, isolated product test build',backend,transport,iphoneVerified:false,cases:[]};
let server,browser;
try{
 await build({configFile:false,build:{outDir,emptyOutDir:true,rolldownOptions:{input:'index.html'}}});
 if(transport==='sw'){
  const files=['/','/index.html',...(await readdir(`${outDir}/assets`)).map(name=>`/assets/${name}`)];
  await build({configFile:false,define:{SHELL_FILES:JSON.stringify(files)},build:{emptyOutDir:false,outDir,lib:{entry:'src/service-worker/sw.ts',formats:['es'],fileName:()=> 'sw.js'}}});
 }
 server=await preview({configFile:false,build:{outDir},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 const bytes=await readFile('public/samples/Aurora.mp3'),sha256=createHash('sha256').update(bytes).digest('hex');
 const assetIds=[randomUUID(),randomUUID()],storageKeys=[randomUUID(),randomUUID()];
 const assets=assetIds.map((id,i)=>({id,storageKey:storageKeys[i],namespace:'local',backend,bytes:bytes.length,sha256,mime:'audio/mpeg',chunks:Math.ceil(bytes.length/65536),chunkSize:65536,state:'complete',revision:1,retention:'kept'}));
 const tracks=['A','B'].map((id,i)=>({id,assetId:assetIds[i],title:`Sintética ${id}`,artist:null,album:null,duration:15,favorite:true,revision:1,createdAt:'2026-10-31T00:00:00.000Z',manualOverrides:{}}));
 const playlist={id:'list',name:'Lista intacta',entries:[{id:'p0',trackId:'A'},{id:'p1',trackId:'B'}],revision:1};
 const base={version:1,entries:['A','B','A'].map((trackId,i)=>({id:`q${i}`,trackId})),currentEntryId:'q2',position:2,repeat:'all',shuffleOrder:['q2','q1','q0']};
 async function run(name,{snapshot=base,available=['A'],corrupt=[],failure=null,expectedIds=['q0','q2'],current=1,position=2,warning='1 entradas sin audio',repeat='all',shuffle=true,preserve=false}={}){
  if(offlineFocus&&!name.startsWith('A/B/A with missing B'))return;
  if(corruptionFocus&&!name.startsWith('corruption:'))return;
  const context=await browser.newContext();const errors=[],outside=[];
  await context.addInitScript(({transport})=>{
   const NativeAudio=window.Audio;window.queueTest={audio:[],plays:0,mode:null,writes:[],violations:[]};
   window.Audio=function(...args){const audio=new NativeAudio(...args);window.queueTest.audio.push(audio);return audio;};window.Audio.prototype=NativeAudio.prototype;
   const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){window.queueTest.plays++;return play.call(this);};
   // The isolated build deliberately tests the supported bounded Blob transport.
   if(transport==='blob')Object.defineProperty(navigator,'serviceWorker',{value:{getRegistration:async()=>undefined,register:async()=>{throw new Error('Synthetic unsupported worker');}}});
   const get=IDBObjectStore.prototype.get,put=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.get=function(...args){if(window.queueTest.mode==='idb'&&this.name==='chunks')throw new Error('Synthetic storage unavailable');return get.apply(this,args);};
   IDBObjectStore.prototype.put=function(...args){if(this.name==='settings'&&args[1]==='library-playback')window.queueTest.writes.push(args[0]);return put.apply(this,args);};
   const create=URL.createObjectURL;URL.createObjectURL=function(...args){if(window.queueTest.mode==='transport')throw new Error('Synthetic transport unavailable');return create.apply(this,args);};
   const directory=navigator.storage.getDirectory.bind(navigator.storage);
   navigator.storage.getDirectory=function(){if(window.queueTest.mode==='opfs')return Promise.reject(new DOMException('Synthetic OPFS unavailable','SecurityError'));return directory();};
   document.addEventListener('securitypolicyviolation',e=>window.queueTest.violations.push(e.violatedDirective));
  },{transport});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(origin)&&!r.url().startsWith('blob:'))outside.push(r.url());});
  try{
   await page.goto(origin);await page.getByRole('status').filter({hasText:'Biblioteca local.'}).waitFor();
   await page.evaluate(async({snapshot,tracks,assets,playlist,available,corrupt,bytes,failure})=>{
    const storedBytes=id=>{const copy=new Uint8Array(bytes);if(corrupt.includes(id))copy[0]^=1;return copy;};
    if(assets[0].backend==='opfs'){
     const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('pulso-assets-v1',{create:true});
     for(let i=0;i<tracks.length;i++)if(available.includes(tracks[i].id)){const handle=await directory.getFileHandle(assets[i].storageKey,{create:true});const writable=await handle.createWritable();await writable.write(storedBytes(tracks[i].id));await writable.close();}
    }
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction(['settings','tracks','assets','chunks','playlists'],'readwrite');
     tx.objectStore('settings').put(snapshot,'library-playback');tracks.forEach(t=>tx.objectStore('tracks').put(t,t.id));assets.forEach(a=>tx.objectStore('assets').put(a,a.id));tx.objectStore('playlists').put(playlist,playlist.id);
     for(let i=0;i<tracks.length;i++)if(assets[i].backend==='idb'&&available.includes(tracks[i].id))for(let offset=0;offset<bytes.length;offset+=65536)tx.objectStore('chunks').put(storedBytes(tracks[i].id).slice(offset,offset+65536),[assets[i].storageKey,offset/65536]);
     tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
    });db.close();sessionStorage.setItem('queueFailure',failure??'');
   },{snapshot,tracks,assets,playlist,available,corrupt,bytes:[...bytes],failure});
   await page.addInitScript(()=>{window.queueTest.mode=sessionStorage.getItem('queueFailure');window.queueTest.writes=[];});
   await page.reload();await page.getByRole('status').filter({hasText:warning}).waitFor();
   const player=page.locator('#player');assert.equal(await player.locator('ol>li').count(),expectedIds.length);
   const observed=await page.evaluate(()=>({plays:window.queueTest.plays,audio:window.queueTest.audio.map(a=>({paused:a.paused,time:a.currentTime,duration:a.duration,src:a.src})),writes:window.queueTest.writes}));
   if(current<0)assert.equal(observed.audio[0].src,'');
   assert.equal(observed.plays,0);assert.equal(observed.audio.length,1);assert.equal(observed.audio[0].paused,true);
   if(current>=0){
    await page.waitForFunction(()=>window.queueTest.audio[0].readyState>=1);
    await page.waitForFunction(expected=>Math.abs(window.queueTest.audio[0].currentTime-(expected==='duration'?window.queueTest.audio[0].duration:expected))<.15,position);
    const selected=await player.locator('ol>li>button[aria-current=true]').evaluateAll(nodes=>nodes.map(n=>[...n.parentElement.parentElement.children].indexOf(n.parentElement)));assert.deepEqual(selected,[current]);
    assert.equal(await page.evaluate(()=>window.queueTest.audio[0].src.startsWith(location.origin+'/_pulso/media/')),transport==='sw');
    await player.getByRole('button',{name:'Reproducir',exact:true}).click();
    await page.waitForFunction(()=>!window.queueTest.audio[0].paused&&window.queueTest.audio[0].currentTime>0);
    await player.getByRole('button',{name:'Pausar',exact:true}).click();
   }else assert.equal(await player.locator('ol>li>button[aria-current=true]').count(),0);
   if(expectedIds.length){assert.equal(await player.getByLabel('Repetición',{exact:false}).inputValue(),repeat);assert.equal(await player.getByRole('button',{name:'Aleatorio',exact:true}).getAttribute('aria-pressed'),String(shuffle));}
   const stored=await page.evaluate(async()=>{
    window.queueTest.mode=null;
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    return new Promise((resolve,reject)=>{const tx=db.transaction(['settings','tracks','assets','chunks','playlists']);const s=tx.objectStore('settings').get('library-playback'),t=tx.objectStore('tracks').getAll(),a=tx.objectStore('assets').getAll(),p=tx.objectStore('playlists').getAll(),c=tx.objectStore('chunks').getAll();tx.oncomplete=()=>{db.close();resolve({snapshot:s.result,tracks:t.result,assets:a.result,playlists:p.result,chunks:c.result.map(c=>Array.from(c))});};tx.onabort=()=>reject(tx.error);});
   });
   assert.deepEqual(stored.tracks,tracks);assert.deepEqual(stored.assets.sort((a,b)=>a.id.localeCompare(b.id)),[...assets].sort((a,b)=>a.id.localeCompare(b.id)));assert.deepEqual(stored.playlists,[playlist]);
   const storedBytes=id=>{const copy=Buffer.from(bytes);if(corrupt.includes(id))copy[0]^=1;return copy;};
   const expectedChunks=[];if(backend==='idb')for(const t of tracks)if(available.includes(t.id))for(let offset=0;offset<bytes.length;offset+=65536)expectedChunks.push([...storedBytes(t.id).subarray(offset,offset+65536)]);
   // IDB ordering uses opaque storage keys, so compare byte values independent of key order.
   assert.deepEqual(stored.chunks.map(c=>JSON.stringify(c)).sort(),expectedChunks.map(c=>JSON.stringify(c)).sort());
   if(backend==='opfs'){
    const files=await page.evaluate(async()=>{const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('pulso-assets-v1');const files={};for await(const [key,handle]of directory.entries())files[key]=[...new Uint8Array(await(await handle.getFile()).arrayBuffer())];return files;});
    assert.deepEqual(Object.keys(files).sort(),tracks.flatMap((t,i)=>available.includes(t.id)?[assets[i].storageKey]:[]).sort());
    for(const [key,file]of Object.entries(files)){const i=assets.findIndex(a=>a.storageKey===key);assert.equal(createHash('sha256').update(Buffer.from(file)).digest('hex'),createHash('sha256').update(storedBytes(tracks[i].id)).digest('hex'));}
   }
   if(preserve){assert.deepEqual(stored.snapshot,snapshot);assert.deepEqual(observed.writes,[]);}
   else if(current>=0){assert.deepEqual(stored.snapshot.entries.map(e=>e.id),expectedIds);assert.equal(stored.snapshot.currentEntryId,expectedIds[current]);assert.equal(stored.snapshot.repeat,repeat);assert.deepEqual(stored.snapshot.shuffleOrder,shuffle?base.shuffleOrder.filter(id=>expectedIds.includes(id)):null);}
   let offlineAndRanges;
   if(offlineFocus){
    assert.equal(transport,'sw');
    const ranged=await page.evaluate(async()=>{
     const src=window.queueTest.audio[0].src;
     const range=await fetch(src,{headers:{Range:'bytes=0-1'}});
     const head=await fetch(src,{method:'HEAD'});
     const invalid=await fetch(src,{headers:{Range:'bytes=999999999-'}});
     return {status:range.status,bytes:[...new Uint8Array(await range.arrayBuffer())],contentRange:range.headers.get('content-range'),head:head.status,headBytes:(await head.arrayBuffer()).byteLength,invalid:invalid.status};
    });
    assert.equal(ranged.status,206);assert.deepEqual(ranged.bytes,[...bytes.subarray(0,2)]);assert.equal(ranged.contentRange,`bytes 0-1/${bytes.length}`);assert.equal(ranged.head,200);assert.equal(ranged.headBytes,0);assert.equal(ranged.invalid,416);
    await context.setOffline(true);await page.reload();
    await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
    assert.equal(await player.locator('ol>li').count(),2);
    assert.equal(await player.locator('ol>li>button[aria-current=true]').count(),1);
    assert.equal(await page.evaluate(()=>window.queueTest.plays===0&&window.queueTest.audio[0].paused),true);
    await player.getByRole('button',{name:'Reproducir',exact:true}).click();
    await page.waitForFunction(()=>!window.queueTest.audio[0].paused&&window.queueTest.audio[0].currentTime>0);
    offlineAndRanges={range:ranged,reopenedPausedWithoutNetwork:true,manualOfflinePlayback:true};
   }
   assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);assert.deepEqual(await page.evaluate(()=>window.queueTest.violations),[]);
   report.cases.push({name,passed:true,...(offlineAndRanges?{offlineAndRanges}:{})});
  }catch(error){report.diagnostic={case:name,status:await page.getByRole('status').allTextContents().catch(()=>[]),pageErrors:errors,externalRequests:outside};throw error;}
  finally{await context.close();}
 }
 await run('A/B/A with missing B preserves second A, position, repeat and filtered shuffle');
 await run('missing current B falls back to first A at zero',{snapshot:{...base,currentEntryId:'q1'},current:0,position:0});
 await run('unknown current reference falls back at zero',{snapshot:{...base,currentEntryId:'not-in-original'},current:0,position:0});
 await run('all present preserves A/B/A and second occurrence selection',{available:['A','B'],expectedIds:['q0','q1','q2'],current:2,warning:'Cola lista y pausada.'});
 await run('none available preserves original snapshot, organization and bytes',{available:[],expectedIds:[],current:-1,warning:'No hay audios disponibles',preserve:true});
 await run('null current remains unselected',{snapshot:{...base,currentEntryId:null},current:-1,preserve:true});
 await run('oversized position clamps on real loadedmetadata',{snapshot:{...base,position:1e100},position:'duration'});
 await run('invalid shuffle and repeat normalize off with warning',{snapshot:{...base,shuffleOrder:['q2','q0'],repeat:'bad'},warning:'El orden aleatorio guardado no era válido',repeat:'off',shuffle:false});
 await run('negative position and absent modes normalize',{snapshot:{...base,position:-20,repeat:undefined,shuffleOrder:undefined},position:0,repeat:'off',shuffle:false});
 for(const snapshot of [{...base,entries:[null]},{...base,entries:[base.entries[0],base.entries[0]]},null,{...base,currentEntryId:4}])await run('malformed snapshot preserved without preparing audio',{snapshot,expectedIds:[],current:-1,warning:'La cola guardada no es válida',preserve:true});
 if(backend==='idb')await run('global IDB chunk failure aborts restoration rather than marking songs absent',{failure:'idb',expectedIds:[],current:-1,warning:'Synthetic storage unavailable',preserve:true});
 else await run('global OPFS failure aborts restoration rather than marking songs absent',{failure:'opfs',expectedIds:[],current:-1,warning:'Synthetic OPFS unavailable',preserve:true});
 if(transport==='blob')await run('global transport failure preserves original snapshot',{failure:'transport',expectedIds:[],current:-1,warning:'Synthetic transport unavailable',preserve:true});
 await run('corruption: same-length B is omitted, second A stays selected and plays',{available:['A','B'],corrupt:['B']});
 await run('corruption: current B is omitted and first A starts paused at zero',{snapshot:{...base,currentEntryId:'q1'},available:['A','B'],corrupt:['B'],current:0,position:0});
 await run('corruption: all damaged bytes and original snapshot remain unchanged',{available:['A','B'],corrupt:['A','B'],expectedIds:[],current:-1,warning:'No hay audios disponibles',preserve:true});
 report.passed=true;
}catch(error){report.failure=error.message;throw error;}
finally{await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));await mkdir('.local/evidence',{recursive:true});await writeFile(`.local/evidence/queue-restore-ui-${backend}-${transport}${offlineFocus?'-offline':corruptionFocus?'-corruption':''}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
