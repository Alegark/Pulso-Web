// Own test build + loopback + sandboxed Chromium. No product build or dist writes.
// Reproduce: INSTABOX_HEADLESS=1 node tests/integration/check-pagination-focus.mjs
import assert from 'node:assert/strict';
import {build,preview} from 'vite';
import {chromium} from 'playwright-core';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const baselineMain=process.env.PULSO_FOCUS_BASELINE_MAIN;
const report={passed:false,command:`${baselineMain?'PULSO_FOCUS_BASELINE_MAIN='+baselineMain+' ':''}INSTABOX_HEADLESS=1 node tests/integration/check-pagination-focus.mjs`,environment:'Linux Chromium, sandbox, own loopback/context/IDB/synthetic WAV',cases:[],errors:[],external:[],limits:['No iPhone/VoiceOver or complete AC20/P0 acceptance.','Delay/no-op/storage failure/refresh failure are test-build injections around real APIs, not production hooks.','pagehide scope invalidation is synthetic; explicit cede is exercised through the real button.','No performance benchmark rerun.']};
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
async function tree(dir){const result={};for(const e of await readdir(dir,{withFileTypes:true})){const p=`${dir}/${e.name}`;if(e.isDirectory())Object.assign(result,await tree(p));else result[p]=await hash(p);}return result;}
const distBefore=await tree('dist');
const sources=['src/main.tsx','src/ui/LibraryPagination.tsx','src/library/pagination.ts','src/library/library.ts','src/style.css','tests/integration/check-library-pagination.mjs','tests/integration/check-pagination-focus.mjs'];
const servers=[];let browser,page;
const pass=name=>{report.cases.push(name);console.log('PASS '+name);};
const rows=p=>p.locator('.tracks>li');
const nav=p=>p.getByRole('navigation',{name:'Páginas de canciones'});
const next=p=>nav(p).getByRole('button',{name:'Página siguiente',exact:true});
const prev=p=>nav(p).getByRole('button',{name:'Página anterior',exact:true});
const view=p=>p.getByLabel(/^Vista/);
const search=p=>p.getByLabel('Buscar por título, artista o álbum',{exact:true});
const title=i=>`Pista ${String(i).padStart(3,'0')}`;
const button=(p,i,d)=>rows(p).getByRole('button',{name:`${d===-1?'Subir':'Bajar'} ${title(i)}`,exact:true});
async function frames(p){await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function active(p){return p.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement===document.body?null:document.activeElement?.textContent}));}
async function focused(locator){assert.equal(await locator.evaluate(e=>e===document.activeElement),true);}
async function snapshot(p){return p.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>r(q.result);});const tx=db.transaction(['tracks','playlists','settings']);const result=await Promise.all(['tracks','playlists','settings'].map(s=>new Promise(r=>{const q=tx.objectStore(s).getAll();q.onsuccess=()=>r(q.result);})));db.close();return {tracks:result[0],playlists:result[1],settings:result[2]};});}
async function mutateList(p,id,kind){await p.evaluate(async({id,kind})=>{const db=await new Promise(r=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>r(q.result);});const tx=db.transaction('playlists','readwrite'),s=tx.objectStore('playlists'),q=s.get(id);q.onsuccess=()=>{const l=q.result;l.revision++;if(kind==='conflict')l.name+=' externa';s.put(l,id);};await new Promise(r=>tx.oncomplete=r);db.close();},{id,kind});}
async function fixture(p,n,{duplicate=false,dangling=false}={}){return p.evaluate(async({n,duplicate,dangling})=>{
 const db=await new Promise(r=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>r(q.result);});
 const ids=Array.from({length:n},()=>crypto.randomUUID());
 const bytes=new Uint8Array(8044),d=new DataView(bytes.buffer),str=(o,s)=>[...s].forEach((c,i)=>d.setUint8(o+i,c.charCodeAt(0)));str(0,'RIFF');d.setUint32(4,8036,true);str(8,'WAVE');str(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,8000,true);d.setUint32(28,16000,true);d.setUint16(32,2,true);d.setUint16(34,16,true);str(36,'data');d.setUint32(40,8000,true);
 const asset={id:crypto.randomUUID(),namespace:'local',storageKey:crypto.randomUUID(),bytes:bytes.length,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join(''),mime:'audio/wav',chunks:1,state:'complete',revision:1,chunkSize:65536,retention:'kept',backend:'idb'};
 const entries=ids.map(trackId=>({id:crypto.randomUUID(),trackId}));if(duplicate)entries[50].trackId=ids[0];if(dangling)entries.unshift({id:crypto.randomUUID(),trackId:crypto.randomUUID()});
 const list={id:crypto.randomUUID(),name:'Lista foco',revision:1,entries},other={id:crypto.randomUUID(),name:'Lista intacta',revision:1,entries:[{id:crypto.randomUUID(),trackId:ids[0]}]};
 const tx=db.transaction(['tracks','playlists','assets','chunks'],'readwrite');for(let i=0;i<n;i++)tx.objectStore('tracks').put({id:ids[i],assetId:asset.id,audioFingerprint:null,title:`Pista ${String(i).padStart(3,'0')}`,artist:'Propio',album:'Prueba',duration:.5,favorite:i%3===0,revision:1,createdAt:`2026-01-01T00:00:00.${String(i).padStart(3,'0')}Z`,manualOverrides:{}},ids[i]);
 for(const l of [list,other])tx.objectStore('playlists').put(l,l.id);tx.objectStore('assets').put(asset,asset.id);tx.objectStore('chunks').put(bytes,[asset.storageKey,0]);await new Promise(r=>tx.oncomplete=r);db.close();return {ids,list,other};
 },{n,duplicate,dangling});}
async function server(baseline=false){
 const outDir=`.local/pagination-focus-${baseline?'baseline':'candidate'}-build`;
 await build({configFile:false,logLevel:'error',plugins:[{name:'pagination-focus-only-test',enforce:'pre',async transform(code,id){
  if(id.endsWith('/src/main.tsx')){
   if(baseline)code=await readFile(baselineMain,'utf8');
   code=code.replace('const act=(...args:Parameters<typeof actWork>)=>admitted(actWork,...args);','const act=(...args:Parameters<typeof actWork>)=>admitted(actWork,...args).finally(()=>{window.paginationFocus.settled=true;});');
   code=code.replace('if(force)artworkRefreshToken++;','if(force)artworkRefreshToken++;window.paginationFocus.refreshes=(window.paginationFocus.refreshes??0)+1;');
   code=code.replace('async function refresh(force=false,updateQueueTitles=true){',"async function refresh(force=false,updateQueueTitles=true){if(window.paginationFocus?.failRefresh){window.paginationFocus.failRefresh=false;throw Error('Injected refresh failure');}");
   code=code.replace("createRoot(document.getElementById('root')!).render(<App/>);","const testRoot=createRoot(document.getElementById('root')!);window.paginationFocus.unmount=()=>testRoot.unmount();testRoot.render(<App/>);");
   return code;
  }
  if(id.endsWith('/src/library/library.ts'))return code.replace('export async function changePlaylist(', 'async function realChangePlaylist(')+`
export async function changePlaylist(...args:Parameters<typeof realChangePlaylist>){
 const hook=window.paginationFocus;
 if(args[2].type!=='move')return realChangePlaylist(...args);
 const gate=hook.gate;hook.gate=null;
 if(gate){hook.entered=true;await new Promise(r=>hook.release=r);hook.entered=false;if(gate==='error'){hook.done=true;throw Error('Injected storage failure');}if(gate==='noop'){hook.done=true;return;}}
 try{await realChangePlaylist(...args);if(gate==='refresh-error')hook.failRefresh=true;}finally{hook.done=true;}
}
`;
 }}],build:{outDir,emptyOutDir:true,rolldownOptions:{input:'index.html'}}});
 const s=await preview({configFile:false,build:{outDir},preview:{host:'127.0.0.1',port:0,strictPort:true}});servers.push(s);return `http://127.0.0.1:${s.httpServer.address().port}`;
}
async function open(origin,n,options){
 const ctx=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:800}});
 await ctx.route('**/*',route=>{const u=route.request().url();if(u.startsWith(origin+'/')||u.startsWith('blob:'))return route.continue();report.external.push(u);return route.abort();});
 await ctx.addInitScript(()=>{window.paginationFocus={audio:[]};const Native=Audio;window.Audio=class extends Native{constructor(...args){super(...args);window.paginationFocus.audio.push(this);}};Object.defineProperty(navigator,'serviceWorker',{value:{getRegistration:async()=>undefined,register:async()=>{throw Error('Own Blob test');}}});});
 const p=await ctx.newPage();page=p;p.setDefaultTimeout(10000);p.on('pageerror',e=>report.errors.push(e.stack));await p.goto(origin);await p.getByRole('status').filter({hasText:'con-control'}).waitFor();const f=await fixture(p,n,options);await p.reload();await rows(p).nth(49).waitFor();await view(p).selectOption(f.list.id);await frames(p);return {p,f};
}
async function order(p,f,expected,revision){const s=await snapshot(p);const l=s.playlists.find(l=>l.id===f.list.id);assert.deepEqual(l.entries,expected);if(revision!==undefined)assert.equal(l.revision,revision);assert.deepEqual(s.playlists.find(l=>l.id===f.other.id),f.other);assert.equal(s.tracks.length,f.ids.length);assert.equal(new Set(l.entries.map(e=>e.id)).size,l.entries.length);return s;}
async function move(p,i,delta,destination){await button(p,i,delta).focus();await p.keyboard.press('Enter');await p.waitForFunction(text=>document.activeElement?.textContent===text,`${delta===-1?'Subir':'Bajar'} ${title(i)}`);await p.waitForFunction(page=>document.querySelector('#library-page-position')?.textContent.includes(`Página ${page} de`),destination);await frames(p);await focused(button(p,i,delta));}
async function arm(p,gate='delay'){await p.evaluate(gate=>{window.paginationFocus.gate=gate;window.paginationFocus.done=false;window.paginationFocus.settled=false;},gate);}
async function held(p,i=50,delta=-1){await next(p).click();await arm(p);await button(p,i,delta).focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>window.paginationFocus.entered);}
async function release(p){await p.evaluate(()=>window.paginationFocus.release());await p.waitForFunction(()=>window.paginationFocus.done&&window.paginationFocus.settled);await frames(p);}
try{
 await mkdir('.local/evidence',{recursive:true});browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();
 if(baselineMain){const baseline=await server(true);report.baselineMain={path:baselineMain,sha256:await hash(baselineMain)};
  const {p}=await open(baseline,51);await next(p).click();await button(p,50,-1).focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>document.querySelector('.tracks>li strong')?.textContent==='Pista 049');report.baseline=await active(p);assert.equal(report.baseline.tag,'BODY');await p.context().close();pass('baseline reproduced: 50→49 commits, focus BODY');
 }
 const candidate=await server();
 for(const n of [51,101]){
  const {p,f}=await open(candidate,n);await p.getByRole('button',{name:'Preparar cola de esta selección',exact:true}).click();await p.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();const initial=await snapshot(p),audio=await p.evaluate(()=>({src:window.paginationFocus.audio[0].src,paused:window.paginationFocus.audio[0].paused}));let expected=[...f.list.entries];
  await next(p).click();[expected[49],expected[50]]=[expected[50],expected[49]];await move(p,50,-1,1);await order(p,f,expected,2);
  [expected[48],expected[49]]=[expected[49],expected[48]];await p.keyboard.press('Enter');await p.waitForFunction(()=>document.querySelectorAll('.tracks>li strong')[48]?.textContent==='Pista 050');await focused(button(p,50,-1));await order(p,f,expected,3);
  [expected[48],expected[49]]=[expected[49],expected[48]];await move(p,50,1,1);await order(p,f,expected,4);
  [expected[49],expected[50]]=[expected[50],expected[49]];await p.keyboard.press('Enter');await p.waitForFunction(()=>document.querySelector('#library-page-position')?.textContent.includes('Página 2 de'));await frames(p);await focused(button(p,50,1));await order(p,f,expected,5);
  if(n===101){[expected[50],expected[51]]=[expected[51],expected[50]];await p.keyboard.press('Enter');await p.waitForFunction(()=>document.querySelectorAll('.tracks>li strong')[1]?.textContent==='Pista 050');await focused(button(p,50,1));await order(p,f,expected,6);}
  const after=await snapshot(p);assert.deepEqual(after.tracks,initial.tracks);assert.deepEqual(after.settings,initial.settings);assert.equal(await p.locator('#player ol>li').count(),n);assert.deepEqual(await p.evaluate(()=>({src:window.paginationFocus.audio[0].src,paused:window.paginationFocus.audio[0].paused})),audio);assert.equal(await p.evaluate(()=>window.paginationFocus.audio.length),1);assert.ok(await rows(p).count()<=50);
  await search(p).focus();const refreshes=await p.evaluate(()=>window.paginationFocus.refreshes);await p.getByRole('button',{name:'Comprobar archivos locales',exact:true}).evaluate(e=>e.click());await p.waitForFunction(n=>window.paginationFocus.refreshes>n,refreshes);await frames(p);await focused(search(p));assert.match(await nav(p).innerText(),/Página 2 de/);
  // Real boundary controls remain focusable, with guarded aria-disabled Enter.
  await prev(p).click();await button(p,0,-1).focus();assert.equal(await button(p,0,-1).getAttribute('aria-disabled'),'true');const before=await snapshot(p);await p.keyboard.press('Enter');await frames(p);await focused(button(p,0,-1));assert.deepEqual(await snapshot(p),before);
  while(await next(p).getAttribute('aria-disabled')!=='true')await next(p).click();await button(p,n-1,1).focus();assert.equal(await button(p,n-1,1).getAttribute('aria-disabled'),'true');await p.keyboard.press('Enter');await frames(p);await focused(button(p,n-1,1));assert.deepEqual(await snapshot(p),before);
  await next(p).focus();await p.keyboard.press('Enter');await focused(next(p));await p.context().close();pass(`${n} occurrences: both boundary directions, consecutive Enter, all IDs/organization/queue/engine intact, limits guarded`);
 }
 // Same title and track, distinct occurrence ID: DOM position and persisted occurrence both matter.
 for(const options of [{duplicate:true},{dangling:true}]){
  const {p,f}=await open(candidate,51,options);await next(p).click();let expected=[...f.list.entries],absolute=options.dangling?51:50;[expected[absolute-1],expected[absolute]]=[expected[absolute],expected[absolute-1]];
  const control=rows(p).first().getByRole('button',{name:options.duplicate?'Subir Pista 000':'Subir Pista 050',exact:true});await control.focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>document.querySelector('#library-page-position')?.textContent.includes('Página 1 de'));await frames(p);await focused(rows(p).last().getByRole('button',{name:options.duplicate?'Subir Pista 000':'Subir Pista 050',exact:true}));await order(p,f,expected,2);await p.keyboard.press('Enter');await p.waitForFunction(t=>document.querySelectorAll('.tracks>li strong')[48]?.textContent===t,options.duplicate?'Pista 000':'Pista 050');[expected[absolute-2],expected[absolute-1]]=[expected[absolute-1],expected[absolute-2]];await order(p,f,expected,3);await p.context().close();pass(options.duplicate?'repeated track follows the moved occurrence ID, consecutive move':'dangling record: absolute index 51 maps to visible page 1 after move');
 }
 for(const kind of ['filter','list','page','group','route','focus','away-back','cede','blur','scope','unmount']){
  const {p,f}=await open(candidate,101);await held(p);let expected=[...f.list.entries];[expected[49],expected[50]]=[expected[50],expected[49]];
  if(kind==='filter')await search(p).fill('Pista 100');
  if(kind==='list')await view(p).selectOption(f.other.id);
  if(kind==='page')await next(p).click();
  if(kind==='group')await p.getByLabel('Agrupación de biblioteca').selectOption('artists');
  if(kind==='route')await p.getByRole('button',{name:'Inicio',exact:true}).click();
  if(kind==='focus')await search(p).focus();
  if(kind==='away-back'){await search(p).fill('Pista');await search(p).fill('');await next(p).click();await button(p,50,-1).focus();}
  if(kind==='cede')await p.getByRole('button',{name:'Ceder control',exact:true}).click();
  if(kind==='blur')await p.evaluate(()=>window.dispatchEvent(new Event('blur')));
  if(kind==='scope')await p.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  if(kind==='unmount')await p.evaluate(()=>window.paginationFocus.unmount());
  const position=await nav(p).count()?await nav(p).innerText():null;const focus=await active(p);await release(p);
  if(position)assert.equal(await nav(p).innerText(),position);if(!['away-back','scope','blur'].includes(kind))assert.deepEqual(await active(p),focus);
  if(['away-back','blur'].includes(kind))assert.equal((await active(p)).tag,'BODY');
  await order(p,f,expected,2);await p.context().close();pass(`late response after ${kind}: no navigation/focus theft`);
 }
 for(const kind of ['conflict','error','noop','refresh-error']){
  const {p,f}=await open(candidate,51);await next(p).click();await arm(p,kind==='conflict'?'delay':kind);await button(p,50,-1).focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>window.paginationFocus.entered);
  if(kind==='conflict')await mutateList(p,f.list.id,kind);
  await release(p);await focused(button(p,50,-1));assert.match(await nav(p).innerText(),/Página 2 de 2/);
  const expected=[...f.list.entries];if(kind==='refresh-error')[expected[49],expected[50]]=[expected[50],expected[49]];
  await order(p,f,expected,kind==='error'||kind==='noop'?1:2);await p.context().close();pass(`${kind}: no false navigation, useful focus, durable order checked`);
 }
 {
  const {p,f}=await open(candidate,51);await next(p).click();await button(p,50,-1).focus();const before=await snapshot(p);
  // Refresh without a move must preserve an unrelated active control and its page.
  const refreshes=await p.evaluate(()=>window.paginationFocus.refreshes);await p.getByRole('button',{name:'Comprobar archivos locales',exact:true}).evaluate(e=>e.click());await p.waitForFunction(n=>window.paginationFocus.refreshes>n,refreshes);await frames(p);await focused(button(p,50,-1));assert.match(await nav(p).innerText(),/Página 2 de 2/);assert.deepEqual(await snapshot(p),before);
  await order(p,f,f.list.entries,1);await p.context().close();pass('refresh without a move does not navigate or autofocus');
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);assert.deepEqual(await tree('dist'),distBefore);report.distUntouched=true;report.passed=true;
}catch(error){report.failure={message:error.message,stack:error.stack,focus:page&&!page.isClosed()?await active(page):null,status:page&&!page.isClosed()?await page.getByRole('status').allTextContents():[]};process.exitCode=1;}
finally{await browser?.close();for(const s of servers)await new Promise(r=>s.httpServer.close(r));report.sources=Object.fromEntries(await Promise.all(sources.map(async p=>[p,await hash(p)])));report.dist=distBefore;await writeFile('.local/evidence/pagination-focus.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
