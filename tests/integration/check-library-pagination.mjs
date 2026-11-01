// Own isolated build/contexts/loopback. No external traffic, production dist or ODD writes.
// INSTABOX_HEADLESS=1 node tests/integration/check-library-pagination.mjs
import assert from 'node:assert/strict';
import {build,preview} from 'vite';
import {chromium} from 'playwright-core';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const outDir='.local/library-pagination-build';
const report={passed:false,environment:'Chromium Linux VM, sandbox, loopback, synthetic own IDB',iphoneVerified:false,cases:[],benchmarks:{},errors:[],external:[],limits:['Two requestAnimationFrame callbacks approximate a paint opportunity; no compositor presentation timestamp or exact CPU attribution.','Browser event to DOM mutation is a commit proxy, not React Profiler.','Baseline has null assets like audit r1; functional audio uses one shared synthetic WAV asset.','Benchmark uses injected DOM input/change/click events, not trusted hardware events; Playwright E2E is evaluate/wait overhead. Candidate includes parent CSS fix.','No heap measurement, physical iPhone, VoiceOver, or mobile AC23 PASS.']};
let browser,page;const servers=[];
const hashes=async dir=>{const result={};for(const e of await readdir(dir,{withFileTypes:true})){const p=`${dir}/${e.name}`;if(e.isDirectory())Object.assign(result,await hashes(p));else result[p]=createHash('sha256').update(await readFile(p)).digest('hex');}return result;};
const before=await hashes('dist');
const pass=name=>{report.cases.push(name);console.log('PASS '+name);};
const rows=p=>p.locator('.tracks>li');
const search=p=>p.getByLabel('Buscar por título, artista o álbum',{exact:true});
const view=p=>p.getByLabel(/^Vista/);
const pager=p=>p.getByRole('navigation',{name:'Páginas de canciones'});
const next=p=>pager(p).getByRole('button',{name:'Página siguiente',exact:true});
const prev=p=>pager(p).getByRole('button',{name:'Página anterior',exact:true});
const state=(p,text)=>p.getByRole('status').filter({hasText:text}).waitFor();
const title=i=>`Tema propio ${String(i).padStart(4,'0')}`;
async function snapshot(p){return p.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>r(q.result);});const tx=db.transaction(['tracks','playlists','settings','jobs']);const get=s=>new Promise(r=>{const q=tx.objectStore(s).getAll();q.onsuccess=()=>r(q.result);});const [tracks,playlists,settings,jobs]=await Promise.all(['tracks','playlists','settings','jobs'].map(get));db.close();return {tracks,playlists,settings,jobs};});}
async function seed(p,audio=false){return p.evaluate(async audio=>{
 const db=await new Promise((res,rej)=>{const r=indexedDB.open('pulso-web-local-v1',2);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
 const ids=Array.from({length:1000},()=>crypto.randomUUID());let asset=null,bytes=null;
 if(audio){bytes=new Uint8Array(8044);const d=new DataView(bytes.buffer);const str=(o,s)=>[...s].forEach((c,i)=>d.setUint8(o+i,c.charCodeAt(0)));str(0,'RIFF');d.setUint32(4,8036,true);str(8,'WAVE');str(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,8000,true);d.setUint32(28,16000,true);d.setUint16(32,2,true);d.setUint16(34,16,true);str(36,'data');d.setUint32(40,8000,true);for(let i=0;i<4000;i++)d.setInt16(44+i*2,Math.sin(i*2*Math.PI*220/8000)*1000,true);asset={id:crypto.randomUUID(),namespace:'local',storageKey:crypto.randomUUID(),bytes:bytes.length,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join(''),mime:'audio/wav',chunks:1,state:'complete',revision:1,chunkSize:65536,retention:'kept',backend:'idb'};}
 const tx=db.transaction(['tracks','playlists','assets','chunks'],'readwrite');
 for(let i=0;i<1000;i++)tx.objectStore('tracks').put({id:ids[i],assetId:asset?.id??null,audioFingerprint:null,title:`Tema propio ${String(i).padStart(4,'0')}`,artist:`Artista propio ${i%20}`,album:`Álbum propio ${i%10}`,duration:audio?.5:180,favorite:i%11===0,revision:1,createdAt:`2026-01-01T00:00:${String(Math.floor(i/100)).padStart(2,'0')}.${String(i).padStart(3,'0')}Z`,manualOverrides:{}},ids[i]);
 const lists=[];for(let i=0;i<20;i++){const list={id:crypto.randomUUID(),name:`Lista propia ${i}`,revision:1,entries:ids.slice(i*50,i*50+50).map(trackId=>({id:crypto.randomUUID(),trackId}))};lists.push(list);tx.objectStore('playlists').put(list,list.id);}
 if(asset){tx.objectStore('assets').put(asset,asset.id);tx.objectStore('chunks').put(bytes,[asset.storageKey,0]);}
 await new Promise((r,j)=>{tx.oncomplete=r;tx.onabort=()=>j(tx.error);});db.close();return {ids,lists,asset};
 },audio);}
async function open(server,path='/'){
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 const ctx=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
 await ctx.route('**/*',route=>{const u=route.request().url();if(u.startsWith(origin)||u.startsWith('blob:'))return route.continue();report.external.push(u);return route.abort();});
 await ctx.addInitScript(()=>{window.paginationTest={audio:[]};const Native=Audio;window.Audio=class extends Native{constructor(...args){super(...args);window.paginationTest.audio.push(this);}};Object.defineProperty(navigator,'serviceWorker',{value:{getRegistration:async()=>undefined,register:async()=>{throw Error('Test bounded Blob transport');}}});});
 const p=await ctx.newPage();p.setDefaultTimeout(60000);p.on('pageerror',e=>report.errors.push(e.stack));await p.goto(origin+path);await state(p,'con-control');return p;
}
async function ready(p,n){await p.waitForFunction(n=>document.querySelectorAll('.tracks>li').length===n,n);}
async function benchmark(p,paginated,listId,label){
 const result={search:[],navigation:[],playlist:[],pagination:[]};report.benchmarks[label]=result;
 // Event injection deliberately avoids Playwright actionability/layout waits. Timings start in the browser.
 await p.evaluate(()=>{window.paginationTest.arm=()=>{window.paginationTest.sample=null;const start=e=>{for(const type of ['input','change','click'])document.removeEventListener(type,start,true);const t=performance.now();const observer=new MutationObserver(()=>{observer.disconnect();const commit=performance.now()-t;requestAnimationFrame(()=>requestAnimationFrame(()=>{window.paginationTest.sample={eventToCommitMs:commit,eventToTwoFramesMs:performance.now()-t,event:e.type,trusted:e.isTrusted};}));});observer.observe(document.getElementById('root'),{subtree:true,childList:true,attributes:true,characterData:true});};for(const type of ['input','change','click'])document.addEventListener(type,start,true);};});
 const act=(kind,value)=>p.evaluate(({kind,value})=>{if(kind==='search'){const input=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}else if(kind==='playlist'){const select=[...document.querySelectorAll('select')].find(e=>e.closest('label')?.textContent.startsWith('Vista'));select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}else [...document.querySelectorAll('button')].find(e=>e.textContent===value).click();},{kind,value});
 async function sample(kind,value){console.log('SAMPLE '+label+' '+kind);await p.evaluate(()=>window.paginationTest.arm());const t=performance.now();await act(kind,value);await p.waitForFunction(()=>window.paginationTest.sample!==null);const e2e=performance.now()-t;const browserSample=await p.evaluate(()=>window.paginationTest.sample);result[kind].push({...browserSample,playwrightE2EMs:e2e,nonBrowserRemainderMs:e2e-browserSample.eventToTwoFramesMs});}
 for(let i=0;i<5;i++){
  await sample('search',title(999));await ready(p,1);await act('search','');await ready(p,paginated?50:1000);
  await sample('navigation','Buscar');await act('navigation','Biblioteca');
  await sample('playlist',listId);await ready(p,50);await act('playlist','');await ready(p,paginated?50:1000);
  if(paginated){await sample('pagination','Página siguiente');await act('pagination','Página anterior');}
 }
 return result;
}
try{
 await mkdir('.local/evidence',{recursive:true});
 await build({configFile:false,build:{outDir,emptyOutDir:true,rolldownOptions:{input:'index.html'}}});
 const candidate=await preview({configFile:false,build:{outDir},preview:{host:'127.0.0.1',port:0,strictPort:true}});servers.push(candidate);
 const baseline=await preview({configFile:false,build:{outDir:'.local/releases/quality-before'},preview:{host:'127.0.0.1',port:0,strictPort:true}});servers.push(baseline);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();
 for(const [label,server,path,paginated] of [['before',baseline,'/releases/7b973abc7dcf3ded.html',false],['after',candidate,'/',true]]){
  console.log('BENCH '+label);page=await open(server,path);const fixture=await seed(page);await page.reload();await ready(page,paginated?50:1000);report.benchmarks[label]=await benchmark(page,paginated,fixture.lists[0].id,label);await page.context().close();
 }
 page=await open(candidate);const fixture=await seed(page,true);await page.reload();await ready(page,50);
 const original=await snapshot(page);assert.equal(original.tracks.length,1000);assert.equal(original.playlists.length,20);assert.equal(original.tracks.filter(t=>t.favorite).length,91);assert.equal(original.playlists.reduce((n,l)=>n+l.entries.length,0),1000);
 await next(page).focus();await page.keyboard.press('Enter');assert.match(await pager(page).innerText(),/51–100/);assert.equal(await next(page).evaluate(e=>e===document.activeElement),true);await prev(page).focus();await page.keyboard.press('Enter');assert.match(await pager(page).innerText(),/1–50/);assert.equal(await prev(page).evaluate(e=>e===document.activeElement),true);
 const all=[];for(let i=0;i<20;i++){all.push(...await rows(page).locator('strong').allTextContents());assert.equal(await rows(page).count(),50);if(i<19)await next(page).click();}
 assert.deepEqual(all,Array.from({length:1000},(_,i)=>title(i)));assert.equal(await next(page).getAttribute('aria-disabled'),'true');assert.equal(await pager(page).getByText('951–1000 de 1000 canciones · Página 20 de 20').count(),1);
 await next(page).focus();await page.keyboard.press('Enter');assert.equal(await next(page).evaluate(e=>e===document.activeElement),true);
 pass('all 1000 tracks reachable, bounded 50 rows, last boundary and keyboard focus stable');
 await search(page).fill(title(999));await ready(page,1);assert.equal(await rows(page).locator('strong').innerText(),title(999));await search(page).fill('imposible');await ready(page,0);assert.match(await pager(page).innerText(),/0 de 0/);await search(page).fill('');await ready(page,50);assert.match(await pager(page).innerText(),/1–50/);
 await next(page).click();await page.getByLabel('Agrupación de biblioteca').selectOption('artists');assert.match(await pager(page).innerText(),/1–50/);await page.getByLabel('Grupo de artista',{exact:true}).selectOption({label:'Artista propio 19 · 50 pistas'});assert.equal(await rows(page).count(),50);assert.ok((await rows(page).locator('strong').allTextContents()).includes(title(999)));
 await page.getByLabel('Agrupación de biblioteca').selectOption('tracks');await next(page).click();await page.getByRole('button',{name:'Inicio',exact:true}).click();assert.match(await pager(page).innerText(),/1–50/);
 pass('search/group/navigation reset and filter across the whole library including track 999');
 // Extend one playlist with genuine occurrences while retaining total 1000 across all lists.
 await page.evaluate(async lists=>{const db=await new Promise(r=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>r(q.result);});const tx=db.transaction('playlists','readwrite');lists[0].entries.push(...lists[1].entries.splice(0,41));for(const l of lists.slice(0,2))tx.objectStore('playlists').put(l,l.id);await new Promise(r=>tx.oncomplete=r);db.close();},fixture.lists);
 await page.getByRole('button',{name:'Comprobar archivos locales',exact:true}).click();await view(page).selectOption(fixture.lists[0].id);await next(page).click();await ready(page,41);assert.match(await pager(page).innerText(),/51–91 de 91/);
 await rows(page).first().getByRole('button',{name:`Subir ${title(50)}`,exact:true}).click();await page.waitForFunction(t=>document.querySelector('.tracks>li strong')?.textContent===t,title(49));
 let current=await snapshot(page);let list=current.playlists.find(l=>l.id===fixture.lists[0].id);assert.equal(list.entries[49].id,fixture.lists[1].entries[0].id);assert.equal(list.entries[50].id,fixture.lists[0].entries[49].id);
 await prev(page).click();await rows(page).last().getByRole('button',{name:`Bajar ${title(50)}`,exact:true}).click();await page.waitForFunction(t=>[...document.querySelectorAll('.tracks>li strong')].at(-1)?.textContent===t,title(49));
 current=await snapshot(page);assert.deepEqual(current.playlists.find(l=>l.id===fixture.lists[0].id).entries,[...fixture.lists[0].entries,...fixture.lists[1].entries.slice(0,41)]);
 await next(page).click();assert.equal(await rows(page).last().getByRole('button',{name:`Bajar ${title(90)}`,exact:true}).isDisabled(),true);
 pass('partial page and absolute move indices cross page 50/51 in both directions with occurrence IDs preserved');
 // Full selection snapshot: 91, not the 41 rendered on this page.
 await page.getByRole('button',{name:'Preparar cola de esta selección',exact:true}).click();await state(page,'Cola lista y pausada.');assert.equal(await page.locator('#player ol>li').count(),91);await page.waitForFunction(()=>window.paginationTest.audio[0].readyState>=1);
 const queue91=(await snapshot(page)).settings.find(s=>s?.entries?.length===91);assert.ok(queue91);assert.deepEqual(queue91.entries.map(e=>e.trackId),[...fixture.ids.slice(0,91)]);
 assert.equal(await page.evaluate(()=>window.paginationTest.audio[0].paused),true);
 await search(page).fill('Tema propio 00');await ready(page,50);await page.getByRole('button',{name:'Preparar cola de esta selección',exact:true}).click();await state(page,'Cola lista y pausada.');assert.equal(await page.locator('#player ol>li').count(),91);
 await search(page).fill(title(90));await ready(page,1);await page.getByRole('button',{name:'Preparar cola de esta selección',exact:true}).click();await state(page,'Cola lista y pausada.');assert.equal(await page.locator('#player ol>li').count(),1);
 await page.locator('#player').getByLabel(/Repetición/).selectOption('one');await page.locator('#player').getByRole('button',{name:'Reproducir',exact:true}).click();await page.waitForFunction(()=>!window.paginationTest.audio[0].paused&&window.paginationTest.audio[0].currentTime>0);
 const audioSrc=await page.evaluate(()=>window.paginationTest.audio[0].src);
 await search(page).fill('');await ready(page,50);await next(page).click();const favoriteRow=rows(page).first();const pressed=await favoriteRow.getByRole('button',{name:'Favorito',exact:true}).count();await favoriteRow.getByRole('button',{name:pressed?'Favorito':'Quitar favorito',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.tracks>li button[aria-pressed]')?.getAttribute('aria-pressed')==='true');assert.match(await pager(page).innerText(),/51–91/);
 const edit=rows(page).first().locator('details').filter({has:page.locator('summary').filter({hasText:'Editar metadatos'})});await edit.locator('summary').click();await edit.getByLabel('Título',{exact:true}).fill('Título corregido');await edit.getByLabel('Artista',{exact:true}).fill('Artista corregido');await edit.getByRole('button',{name:'Guardar metadatos',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.tracks>li strong')?.textContent==='Tema propio 0000');assert.match(await pager(page).innerText(),/1–50/);
 await search(page).fill('Título corregido');await ready(page,1);assert.equal(await rows(page).locator('strong').innerText(),'Título corregido');
 const panel=page.getByRole('region',{name:'Verificar copias de la playlist completa',exact:true});await panel.getByRole('button',{name:'Verificar copias',exact:true}).click();await panel.getByText('91 de 91 verificadas en la última comprobación.',{exact:true}).waitFor({timeout:60000});
 current=await snapshot(page);const batch=current.settings.find(j=>j.entries?.length===91||j.snapshot?.entries?.length===91);assert.ok(batch);assert.deepEqual(batch.entries.map(e=>e.entryId),[...fixture.lists[0].entries,...fixture.lists[1].entries.slice(0,41)].map(e=>e.id));report.batchJobShape=current.settings.filter(j=>j?.playlistId).map(j=>({kind:j.kind,total:j.total,keys:Object.keys(j)}));
 assert.equal(await page.evaluate(src=>window.paginationTest.audio.length===1&&!window.paginationTest.audio[0].paused&&window.paginationTest.audio[0].src===src,audioSrc),true);
 assert.equal(await page.locator('#player ol>li').count(),1);
 assert.equal(current.tracks.length,1000);assert.equal(current.playlists.length,20);assert.equal(current.playlists.reduce((n,l)=>n+l.entries.length,0),1000);assert.equal(current.tracks.filter(t=>t.favorite).length,92);assert.equal(current.tracks.find(t=>t.id===fixture.ids[50]).title,'Título corregido');
 assert.deepEqual(current.tracks.filter(t=>t.id!==fixture.ids[50]),original.tracks.filter(t=>t.id!==fixture.ids[50]));assert.deepEqual(current.playlists.filter(l=>![fixture.lists[0].id,fixture.lists[1].id].includes(l.id)),original.playlists.filter(l=>![fixture.lists[0].id,fixture.lists[1].id].includes(l.id)));
 report.preserved={tracks:current.tracks.length,playlists:current.playlists.length,playlistEntries:1000,favoritesBefore:91,favoritesAfter:92,requestedEdits:'favorite/title/artist for track 50; playlist moves reversed; 41 occurrences transferred between lists for boundary fixture',audioEngineCount:1,queueAfterNonQueueActions:1,batchDetected:!!batch};
 pass('full filtered selection queue, paused preparation, full 91-entry batch despite single visible result; metadata/favorite persist and audio survives nonqueue actions');
 // Inspect timeupdate cost with 50 library rows and one queued entry, no hidden rebuild of 1000 rows.
 await search(page).fill('');await view(page).selectOption('');await ready(page,50);
 report.timeupdate=[];for(let i=0;i<5;i++)report.timeupdate.push(await page.evaluate(async()=>{const t=performance.now();window.paginationTest.audio[0].dispatchEvent(new Event('timeupdate'));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {eventToTwoFramesMs:performance.now()-t,libraryRows:document.querySelectorAll('.tracks>li').length};}));
 await page.locator('#player').getByRole('button',{name:'Pausar',exact:true}).click();
 // Persisted edits survive a new document and paused queue restoration.
 await page.reload();await ready(page,50);await search(page).fill('Título corregido');await ready(page,1);assert.equal(await rows(page).getByRole('button',{name:'Quitar favorito',exact:true}).count(),1);
 pass('persisted metadata/favorite survive reload and queue reopens paused');
 // Preparing the entire library must keep 1000 occurrences in order while rendering only 50 library rows.
 await search(page).fill('');await page.getByRole('button',{name:'Preparar cola de esta selección',exact:true}).click();await state(page,'Cola lista y pausada.');assert.equal(await page.locator('#player ol>li').count(),1000);await page.waitForFunction(()=>window.paginationTest.audio[0].readyState>=1);
 let fullQueue=(await snapshot(page)).settings.find(s=>s?.entries?.length===1000&&'currentEntryId'in s);assert.ok(fullQueue);assert.deepEqual(fullQueue.entries.map(e=>e.trackId),fixture.ids);assert.equal(new Set(fullQueue.entries.map(e=>e.id)).size,1000);assert.equal(await rows(page).count(),50);assert.equal(await page.evaluate(()=>window.paginationTest.audio[0].paused),true);
 report.timeupdateWith1000Queue=[];for(let i=0;i<5;i++)report.timeupdateWith1000Queue.push(await page.evaluate(async()=>{const t=performance.now();window.paginationTest.audio[0].dispatchEvent(new Event('timeupdate'));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {eventToTwoFramesMs:performance.now()-t,libraryRows:document.querySelectorAll('.tracks>li').length,queueRows:document.querySelectorAll('#player ol>li').length};}));
 pass('full 1000-entry library queue keeps order and distinct occurrence IDs, library DOM remains 50, preparation has no autoplay');
 // A separate tiny visual scope exercises shrink/identity changes without changing the queue.
 await page.context().close();page=await open(candidate);const small=await seed(page);await page.reload();await ready(page,50);
 await page.evaluate(async lists=>{const db=await new Promise(r=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>r(q.result);});const tx=db.transaction('playlists','readwrite');lists[0].entries.push(lists[1].entries.shift());for(const l of lists.slice(0,2))tx.objectStore('playlists').put(l,l.id);await new Promise(r=>tx.oncomplete=r);db.close();},small.lists);
 await page.getByRole('button',{name:'Comprobar archivos locales',exact:true}).click();await view(page).selectOption(small.lists[0].id);await next(page).click();await ready(page,1);
 // Changing identity with identical metadata must reset and remount the right form.
 const changedId=await page.evaluate(async id=>{const db=await new Promise(r=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>r(q.result);});const tx=db.transaction(['tracks','playlists'],'readwrite');const req=tx.objectStore('tracks').get(id);const nextId=crypto.randomUUID();req.onsuccess=()=>{const t=req.result;tx.objectStore('tracks').delete(id);tx.objectStore('tracks').put({...t,id:nextId},nextId);const all=tx.objectStore('playlists').getAll();all.onsuccess=()=>{for(const l of all.result){l.entries=l.entries.map(e=>e.trackId===id?{...e,trackId:nextId}:e);tx.objectStore('playlists').put(l,l.id);}};};await new Promise(r=>tx.oncomplete=r);db.close();return nextId;},small.ids[50]);
 await page.getByRole('button',{name:'Comprobar archivos locales',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.tracks>li strong')?.textContent==='Tema propio 0000');assert.match(await pager(page).innerText(),/1–50/);await next(page).click();await ready(page,1);assert.equal(await rows(page).locator('input[name=title]').inputValue(),title(50));
 await rows(page).getByRole('button',{name:'Quitar de playlist',exact:true}).click();await ready(page,50);assert.match(await pager(page).innerText(),/1–50 de 50/);let shrunk=await snapshot(page);assert.equal(shrunk.playlists.find(l=>l.id===small.lists[0].id).entries.length,50);assert.ok(shrunk.tracks.some(t=>t.id===changedId));
 // Add the removed track using the real destination control, then revisit the last page.
 await view(page).selectOption('');await search(page).fill(title(50));await ready(page,1);await page.getByLabel(/^Playlist de destino/).selectOption(small.lists[0].id);await rows(page).getByRole('button',{name:'Añadir a playlist',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('.tracks button')].find(b=>b.textContent==='Añadir a playlist')?.disabled);await search(page).fill('');await view(page).selectOption(small.lists[0].id);await ready(page,50);await next(page).click();await ready(page,1);
 shrunk=await snapshot(page);assert.equal(shrunk.tracks.length,1000);assert.equal(shrunk.playlists.length,20);assert.equal(shrunk.playlists.reduce((n,l)=>n+l.entries.length,0),1000);assert.equal(shrunk.tracks.filter(t=>t.favorite).length,91);
 pass('same-metadata identity replacement resets page/form; deleting last-page entry clamps; real playlist add restores all 1000 relations');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);assert.deepEqual(await hashes('dist'),before);report.distUntouched=true;report.summary={};for(const [phase,metrics] of Object.entries(report.benchmarks)){report.summary[phase]={};for(const [action,samples] of Object.entries(metrics)){if(!samples.length)continue;const median=key=>samples.map(x=>x[key]).sort((a,b)=>a-b)[Math.floor(samples.length/2)];report.summary[phase][action]={samples:samples.length,medianEventToCommitMs:median('eventToCommitMs'),medianEventToTwoFramesMs:median('eventToTwoFramesMs'),medianPlaywrightE2EMs:median('playwrightE2EMs'),medianNonBrowserRemainderMs:median('nonBrowserRemainderMs')};}}report.passed=true;
}catch(error){report.failure={message:error.message,stack:error.stack,status:page&&!page.isClosed()?await page.getByRole('status').allTextContents():[]};process.exitCode=1;}
finally{await browser?.close();for(const server of servers)await new Promise(r=>server.httpServer.close(r));report.sources=await hashes('src/ui').then(x=>Object.fromEntries(Object.entries(x).filter(([k])=>k.includes('LibraryPagination'))));for(const p of ['src/main.tsx','src/library/pagination.ts','tests/integration/check-library-pagination.mjs','tests/unit/pagination.test.ts','src/style.css','.local/releases/quality-before/releases/7b973abc7dcf3ded.html'])report.sources[p]=createHash('sha256').update(await readFile(p)).digest('hex');await writeFile('.local/evidence/library-pagination.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
