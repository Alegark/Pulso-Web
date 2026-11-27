import {createTestWorkspace} from './test-workspace.mjs';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';
import {build,preview} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {writeFile,readFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const ws=await createTestWorkspace('collection-current'),report={cases:[],errors:[],external:[],limits:['Main literal actual, Chromium nativo, datos WAV propios, IDB/OPFS reales; cuenta TESTONLY, SW ausente usa transporte Blob real. No Telegram, cuentas reales, iPhone ni P0.']};let server,browser;
const hash=b=>createHash('sha256').update(b).digest('hex');
try{
report.sources={};for(const p of ['src/main.tsx','src/library/collection-removal.ts','src/ui/collection-removal-state.ts','src/ui/CollectionRemovalPanel.tsx','src/library/song-copy-status.ts','src/library/selected-song.ts','tests/integration/collection-removal-current-fixture.ts']){const b=await readFile(p);report.sources[p]={bytes:b.length,sha256:hash(b)};}
await writeFile(`${ws.dir}/fixture.html`,'<script type="module" src="/tests/integration/collection-removal-current-fixture.ts"></script>');
const setupFixture={name:'testonly-completed-setup',enforce:'pre',transform(code,id){if(id.endsWith('/src/main.tsx'))return code.replaceAll('setupReadyFor!==account.user.id','false').replace('requiredSetup songAliases=','requiredSetup={false} songAliases=');}};
await build({configFile:false,plugins:[tailwindcss(),setupFixture],logLevel:'error',build:{outDir:`${ws.dir}/bundle`,rolldownOptions:{input:{main:'index.html',fixture:`${ws.dir}/fixture.html`}}}});
server=await preview({configFile:false,build:{outDir:`${ws.dir}/bundle`},preview:{host:'127.0.0.1',port:0}});const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
browser=await (process.env.PULSO_BROWSER==='webkit'?webkit.launch({headless:true}):chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true}));
for(const backend of ['idb','opfs'])for(const scenario of ['album-first','playlist-first','playlists','queue']){
if(process.env.PULSO_COLLECTION_FILTER&&!`${backend}:${scenario}`.includes(process.env.PULSO_COLLECTION_FILTER))continue;
const result={backend,scenario};let page,inspector,context;
try{
context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:664}});context.setDefaultTimeout(10000);
await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin||['blob:','data:'].includes(u.protocol))return r.continue();if(['itunes.apple.com','lrclib.net'].includes(u.hostname)){const album={wrapperType:'collection',collectionType:'Album',collectionId:201,collectionName:'Álbum propio',artistName:'Artista propio',artistId:101,trackCount:2};const tracks=['Compartida propia','Exclusiva propia'].map((title,i)=>({wrapperType:'track',kind:'song',collectionId:201,collectionName:'Álbum propio',artistName:'Artista propio',trackId:301+i,discNumber:1,discCount:1,trackNumber:i+1,trackCount:2,trackName:title,trackTimeMillis:10000}));const rows=u.pathname==='/lookup'?[album,...tracks]:u.searchParams.get('entity')==='musicArtist'?[]:[album];return r.fulfill({json:u.hostname==='lrclib.net'?[]:{resultCount:rows.length,results:rows},headers:{'access-control-allow-origin':'*'}});} report.external.push(u.origin);return r.abort();});
await installRequiredAccountFixture(context,origin);await context.addInitScript(()=>{delete Navigator.prototype.serviceWorker;});page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));inspector=await context.newPage();
await inspector.goto(`${origin}/${ws.dir}/fixture.html`);await inspector.waitForFunction(()=>!!window.setupCurrentCollection);
const fixture=await inspector.evaluate(({scenario,backend})=>window.setupCurrentCollection(scenario,backend),{scenario,backend});
const inspect=()=>inspector.evaluate(f=>window.inspectCurrentCollection(f),fixture);
result.before=await inspect();for(const row of result.before.rows){assert.equal(row.physical,true);assert.equal(row.status.state,'available');}
if(scenario==='album-first'&&backend==='idb'){result.admission=await inspector.evaluate(()=>window.checkBlockedCollectionAdmission());assert.equal(result.admission.started,true);assert.equal(result.admission.visible,true);assert.equal(result.admission.state,'blocked');assert.equal(result.admission.closed,true);assert.equal(result.admission.gates,0);assert.equal(result.admission.reads,0);assert.equal(result.admission.active,1);}
await page.bringToFront();await page.goto(origin);const nav=()=>page.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();await nav();
const open=async kind=>{await page.locator('.library-grid button').filter({hasText:kind==='album'?'Álbum propio':kind==='other'?'Otra lista':'Lista propia'}).click();};
const checkAlbumBadges=async expected=>{
 await page.locator('.shell-nav').getByRole('button',{name:'Buscar',exact:true}).click();await page.locator('.music-search input[type=search]').fill('Álbum propio');await page.locator('[data-suggestion-id="itunes:album:201"]').click();await page.waitForFunction(()=>document.querySelectorAll('.album-track-badges').length===2&&[...document.querySelectorAll('.album-track-badges')].every(e=>!e.textContent.includes('sin comprobar')));const badges=await page.locator('.album-track-badges').allTextContents();assert.deepEqual(badges,expected);await nav();return badges;
};
const panel=page.locator('.collection-removal');
const remove=async kind=>{const action=kind==='album'?'Retirar álbum':'Eliminar playlist';await page.locator('.library-detail').getByRole('button',{name:kind==='album'?'Opciones de colección':'Opciones de playlist',exact:true}).click();await page.locator('dialog.track-actions-menu').getByRole('button',{name:action,exact:true}).click();await panel.getByText('Canciones de la colección',{exact:true}).waitFor();await page.waitForFunction(()=>document.activeElement?.matches('.collection-removal h2'));await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:kind==='album'?'Eliminar álbum':'Eliminar playlist',exact:true}).click();await panel.getByText('La colección se eliminó.',{exact:true}).waitFor();const text=await panel.innerText();await panel.getByRole('button',{name:'Cerrar',exact:true}).click();return text;};
const first=scenario==='album-first'?'album':'list';await open(first);
if(scenario==='queue'){
 await page.getByRole('button',{name:'Escuchar Compartida propia',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.mini-player')?.textContent?.includes('Compartida propia'));
 const savedQueue=await inspector.evaluate(async()=>{for(let i=0;i<100;i++){const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});const value=await new Promise(resolve=>{const q=db.transaction('settings').objectStore('settings').get('library-playback');q.onsuccess=()=>{db.close();resolve(q.result);};});if(value?.entries?.length===2)return value;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('queue not persisted');});
 await page.locator('.library-detail').getByRole('button',{name:'Opciones de playlist',exact:true}).click();await page.locator('dialog.track-actions-menu').getByRole('button',{name:'Eliminar playlist',exact:true}).click();await panel.getByText('Al confirmar, las canciones de esta selección que estén en la cola se retirarán de la cola.').waitFor();
 await panel.getByRole('button',{name:'Cancelar',exact:true}).click();
 assert.deepEqual(await inspect(),result.before);assert.deepEqual(await inspector.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});return new Promise(resolve=>{const q=db.transaction('settings').objectStore('settings').get('library-playback');q.onsuccess=()=>{db.close();resolve(q.result);};});}),savedQueue);
 await panel.getByRole('button',{name:'Cerrar',exact:true}).click();
}
result.firstPanel=await remove(first);result.afterFirst=await inspect();
assert.equal(result.afterFirst.rows[0].physical,true);assert.equal(result.afterFirst.rows[0].linked,true);assert.equal(result.afterFirst.rows[0].status.state,'available');assert.equal(result.afterFirst.rows[0].status.inLibrary,scenario==='playlist-first');assert.equal(result.afterFirst.rows[0].reuseTrack,fixture.rows[0].track);assert.equal(result.afterFirst.jobs,result.before.jobs,'inspection/reuse creates no imports');
assert.equal(result.afterFirst.rows[1].physical,false);assert.equal(result.afterFirst.rows[1].asset,false);
assert.equal(result.afterFirst.rows[0].sha256,fixture.rows[0].asset.sha256);
if(scenario==='queue'){
 const queue=await inspector.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});return new Promise(resolve=>{const q=db.transaction('settings').objectStore('settings').get('library-playback');q.onsuccess=()=>{db.close();resolve(q.result);};});});
 assert.deepEqual(queue.entries.map(e=>e.trackId),[fixture.rows[0].track]);result.queueEvicted=true;
}
await page.reload();await nav();result.afterReload=await inspect();assert.deepEqual(result.afterReload,result.afterFirst,'reload retains availability, membership, bytes and organization');
if(scenario!=='queue'){
 if(scenario!=='playlists'){result.badgesAfterFirst=await checkAlbumBadges([scenario==='playlist-first'?'Descargada · En Biblioteca':'Descargada','Sin descarga']);}
 const second=scenario==='album-first'?'list':scenario==='playlist-first'?'album':'other';await open(second);result.secondPanel=await remove(second);result.final=await inspect();for(const row of result.final.rows){assert.equal(row.physical,false);assert.equal(row.asset,false);assert.equal(row.linked,false);assert.equal(row.status.state,'missing');assert.equal(row.status.inLibrary,false);}assert.equal(result.final.chunks,0);assert.equal(result.final.jobs,result.before.jobs);await page.reload();await nav();if(scenario!=='playlists')result.badgesAfterFinal=await checkAlbumBadges(['Sin descarga','Sin descarga']);assert.deepEqual(await inspect(),result.final,'final deletion remains after reload');
}
result.status='PASS';console.log('PASS',backend,scenario);
}catch(e){result.status='FAIL';result.error=String(e.stack||e);if(page&&!page.isClosed())result.body=await page.locator('body').innerText();console.log('FAIL',backend,scenario,String(e).slice(0,350));}
finally{await context?.close();report.cases.push(result);}
}
assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);assert.equal(report.cases.every(c=>c.status==='PASS'),true);report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e.stack||e);}
finally{await browser?.close();if(server)await new Promise(r=>server.httpServer.close(r));async function size(path){let bytes=0;for(const e of await readdir(path,{withFileTypes:true})){const p=path+'/'+e.name;if(e.isSymbolicLink())throw Error('Unexpected test symlink');bytes+=e.isDirectory()?await size(p):(await lstat(p)).size;}return bytes;}report.removedBuildBytes=await size(ws.dir);report.cleanup=await ws.cleanup();await writeFile(`${ws.evidence}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({evidence:ws.evidence,status:report.status,cleanup:report.cleanup,error:report.error},null,2));if(report.status!=='PASS')process.exitCode=1;}
