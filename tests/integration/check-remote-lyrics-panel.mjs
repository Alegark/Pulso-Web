// R59 standalone: native browser fetch, LRCLIB fulfilled/aborted by Playwright only.
// INSTABOX_HEADLESS=1 node tests/integration/check-remote-lyrics-panel.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {build,preview} from 'vite';
import {chromium} from 'playwright-core';
const dir='.local/remote-lyrics-r59',runDir=dir+'/run-'+Date.now();await mkdir(runDir,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
async function hashes(path){const out={};for(const e of await readdir(path,{withFileTypes:true})){const p=path+'/'+e.name;if(e.isDirectory())Object.assign(out,await hashes(p));else{const b=await readFile(p);out[p]={bytes:b.length,sha256:sha(b)};}}return out;}
function memory(){const result=JSON.parse(execFileSync('python3',['scripts/sync_odd_memory.py','--read-only'],{encoding:'utf8'}));assert.equal(result.FullContentVerified,true);assert.equal(result.tasks.length,14);for(const t of result.tasks){assert.equal(t.project,'Pulso-Web');assert.equal(t.FullContentVerified,true);const b=execFileSync('cat',[t.file]);assert.equal(t.bytes,b.length);assert.equal(t.ContentSHA256,sha(b));}return result;}
const report={project:'Pulso-Web',revision:59,runDir,passed:false,cases:[],pageErrors:[],externalBlocked:[],builds:[],limits:['Isolated React panel, caller Activity real; scope/proof changes driven by fixture, not integrated main or tab ownership.','Native fetch route.fulfill/abort is synthetic HTTP/CORS evidence only, not live LRCLIB identification or provider compatibility.','TESTONLY barrier after adapter returns preserves native fetch and tests consumer post-await publication.','No audio fixture or playback guarantee; no product build/dist/4175/CSP change; no iPhone, publication or D08 activation.'],memoryStart:memory()};
const protectedBefore={...await hashes('src'),...await hashes('dist'),...await hashes('public')};
let server,browser,context,page,origin,observed=false,plan,requests=[];
const record=(overrides={})=>({id:59,trackName:'Canción de prueba',artistName:'Autor de prueba',albumName:'',duration:120,instrumental:false,plainLyrics:'Texto original de prueba\nSegunda línea',syncedLyrics:null,...overrides});
const search=()=>page.getByRole('button',{name:'Buscar letras de esta canción',exact:true});
const cancel=()=>page.getByRole('button',{name:'Cancelar consulta',exact:true});
const consent=()=>page.getByRole('checkbox');
const panel=()=>page.getByRole('region',{name:'Letras externas opcionales'});
async function idle(){await page.waitForFunction(()=>window.r59.activity.count===0&&!document.querySelector('section[aria-busy="true"]'));}
async function patch(value){await page.evaluate(value=>window.r59.patch(value),value);}
async function fresh(next={}){
 await context?.close();context=await browser.newContext({serviceWorkers:'block'});context.setDefaultTimeout(3500);requests=[];plan={status:200,json:record()};
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===origin)return route.continue();
  if(url.origin==='https://lrclib.net'&&url.pathname==='/api/get'){
   requests.push({url:req.url(),at:Date.now(),headers:req.headers()});const own=plan;
   if(own.wait){await new Promise(resolve=>own.release=resolve);}
   if(own.abort)return route.abort('failed').catch(()=>{});
   return route.fulfill({status:own.status??200,headers:{'Content-Type':own.mime??'application/json','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Retry-After',...own.headers},body:own.body??JSON.stringify(own.json??record())}).catch(()=>{});
  }
  report.externalBlocked.push(req.url());return route.abort();
 });
 page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.goto(origin+'/.local/remote-lyrics-r59/remote-lyrics-r59.html');await page.waitForFunction(()=>window.r59);await patch(next);return page;
}
async function start(){await consent().check();await search().click();}
async function compile(instrumented){
 await server?.close();
 const input=dir+'/remote-lyrics-r59.html',outDir=runDir+(instrumented?'/observed':'/native');
 const plugin={name:'remote-lyrics-r59-consumer-barrier',enforce:'pre',transform(code,id){if(!id.endsWith('/src/ui/RemoteLyricsPanel.tsx'))return;const needle='// Respect server cooldown';assert.ok(code.includes(needle));return code.replace(needle,'await (window as any).r59.after(result);\n   '+needle);}};
 const sources={...await hashes('src/ui'),adapter:{sha256:sha(await readFile('src/library/lrclib.ts'))}};
 await build({configFile:false,publicDir:false,logLevel:'error',plugins:instrumented?[plugin]:[],build:{outDir,emptyOutDir:true,minify:false,rolldownOptions:{input}}});
 report.builds.push({instrumented,outDir,sources,output:await hashes(outDir)});
 server=await preview({configFile:false,build:{outDir},preview:{host:'127.0.0.1',port:0,strictPort:true}});origin='http://127.0.0.1:'+server.httpServer.address().port;observed=instrumented;
}
async function check(name,fn){const n=report.cases.length;try{await fn();report.cases.push({name,passed:true,instrumented:observed});console.log('PASS',name);}catch(e){report.cases.push({name,passed:false,error:e.stack,instrumented:observed});console.log('FAIL',name,e.message);if(page&&!page.isClosed())await writeFile(runDir+'/failure-'+n+'.txt',await page.locator('body').innerText());}}
try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();report.chromiumSandbox=true;
 await compile(false);
 await check('G01 unavailable / unchecked / missing input / Activity denied: zero fetch',async()=>{
  await fresh({available:false});assert.equal(await consent().isDisabled(),true);assert.equal(await search().isDisabled(),true);assert.match(await panel().innerText(),/todavía no están habilitadas/);
  await patch({available:true});assert.equal(await consent().isChecked(),false);await patch({timeSeconds:10});assert.equal(requests.length,0);
  await consent().check();await patch({artist:null});assert.equal(await search().isDisabled(),true);await patch({artist:'Autor de prueba'});await page.evaluate(()=>window.r59.activity.close());await search().click();assert.equal(requests.length,0);assert.equal(await page.evaluate(()=>window.r59.activity.count),0);
 });
 await check('G02 explicit gesture plain / LRC metadata unknown / real time highlights, no 20 tick IO',async()=>{
  await fresh();await start();await idle();assert.equal(requests.length,1);assert.match(await panel().innerText(),/Texto original/);assert.match(await panel().innerText(),/registro de letras 59/);assert.match(await panel().innerText(),/desconocido/);assert.ok(!(await panel().innerText()).includes('verificado'));const u=new URL(requests[0].url);assert.equal(u.searchParams.get('track_name'),'Canción de prueba');assert.equal(u.searchParams.get('artist_name'),'Autor de prueba');assert.equal(requests[0].headers.authorization,undefined);assert.equal(requests[0].headers.cookie,undefined);assert.equal(requests[0].headers.referer,undefined);
  await fresh();plan.json=record({syncedLyrics:'[00:01]Uno\n[00:02]Dos\n[00:02]Otra',plainLyrics:null});await start();await idle();assert.equal(await panel().locator('[aria-current="true"]').count(),0);await patch({timeSeconds:2.2});assert.equal(await panel().locator('[aria-current="true"]').count(),2);await page.locator('#focus-canary').focus();for(let i=0;i<20;i++)await patch({timeSeconds:i});assert.equal(requests.length,1);assert.equal(await page.evaluate(()=>document.activeElement.id),'focus-canary');
 });
 await check('G03 cancel native pending fetch and discard; token released, no late success',async()=>{
  await fresh();plan.wait=true;await start();await page.waitForFunction(()=>window.r59.activity.count===1);while(!plan.release)await new Promise(resolve=>setTimeout(resolve,5));await cancel().click();await idle();plan.release();assert.equal(await panel().locator('pre,ol').count(),0);assert.ok(!(await page.evaluate(()=>window.r59.statuses)).some(s=>s.startsWith('Candidato')));assert.equal(requests.length,1);
 });
 await check('G04 inert React text / conflict hidden / track change discards / no automatic fetch',async()=>{
  await fresh();const hostile='<img src="https://external.invalid/x" onerror="window.bad=1">';plan.json=record({plainLyrics:hostile});await start();await idle();assert.equal(await panel().locator('pre').textContent(),hostile);assert.equal(await panel().locator('img,script,a').count(),0);assert.equal(await page.evaluate(()=>window.bad),undefined);for(let i=0;i<20;i++)await patch({timeSeconds:i});await patch({trackId:'B',title:'Otra canción'});await patch({trackId:'A',title:'Canción de prueba'});assert.equal(await panel().locator('pre,ol').count(),0);assert.equal(requests.length,1);
  await fresh();plan.json=record({trackName:'Otra canción',plainLyrics:'OTRA_PISTA_NO_MOSTRAR'});await start();await idle();assert.match(await panel().innerText(),/difiere/);assert.ok(!(await panel().innerText()).includes('OTRA_PISTA_NO_MOSTRAR'));assert.equal(await panel().locator('pre,ol').count(),0);
 });
 await check('G05 instrumental / 404 / invalid / network safe Spanish, no raw errors',async()=>{
  for(const [variant,expected] of [[{json:record({instrumental:true,plainLyrics:null})},/instrumental/],[{status:404,body:'edge private'},/no encontró/],[{body:'<private raw>',mime:'text/html'},/no válida/],[{abort:true},/No se pudo conectar/]]){
   await fresh();plan=variant;await start();await idle();assert.match(await panel().innerText(),expected);assert.ok(!(await panel().innerText()).includes('private'));assert.equal(requests.length,1);assert.equal(await page.evaluate(()=>window.r59.activity.count),0);
  }
 });
 await check('G06 cadence >=2100ms, Retry-After retained over disable/enable/track and invalid delay blocks',async()=>{
  await fresh();await start();await idle();assert.equal(await search().isDisabled(),true);await consent().uncheck();await consent().check();assert.equal(await search().isDisabled(),true);await search().waitFor({state:'visible'});await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Buscar letras de esta canción').disabled);await search().click();await idle();assert.equal(requests.length,2);assert.ok(requests[1].at-requests[0].at>=2100);
  await fresh();plan.wait=true;await start();while(!plan.release)await new Promise(resolve=>setTimeout(resolve,5));await page.waitForTimeout(2200);assert.equal(await search().isDisabled(),true);const responseReleasedAt=Date.now();plan.release();await idle();assert.equal(await search().isDisabled(),true);await page.waitForTimeout(300);assert.equal(await search().isDisabled(),true);assert.equal(requests.length,1);await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Buscar letras de esta canción').disabled);plan={json:record()};await search().click();await idle();assert.equal(requests.length,2);assert.ok(requests[1].at-responseReleasedAt>=500);report.slowResponsePacing={responseHeldMs:2200,gapAfterReleaseMs:requests[1].at-responseReleasedAt,requests:2};
  await fresh();plan={status:429,headers:{'Retry-After':'3'}};await start();await idle();await consent().uncheck();await consent().check();await patch({trackId:'B'});await patch({available:false});await patch({available:true});assert.equal(await consent().isChecked(),false);await consent().check();assert.equal(await search().isDisabled(),true);await page.evaluate(()=>{window.r59.unmount();window.r59.mount();});await consent().check();assert.equal(await search().isDisabled(),true);await page.waitForTimeout(2200);assert.equal(requests.length,1);assert.equal(await search().isDisabled(),true);await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Buscar letras de esta canción').disabled);assert.equal(requests.length,1);await search().click();await idle();assert.equal(requests.length,2);assert.ok(requests[1].at-requests[0].at>=3000);
  await fresh();plan={status:503,headers:{'Retry-After':'nonsense'}};await start();await idle();await consent().uncheck();await consent().check();await patch({available:false});await patch({available:true});await consent().check();await page.evaluate(()=>{window.r59.unmount();window.r59.mount();});await consent().check();await page.waitForTimeout(2200);assert.equal(await search().isDisabled(),true);assert.match(await panel().innerText(),/bloqueadas durante esta sesión/);assert.equal(requests.length,1);
 });
 // Consumer barrier build: no adapter edits, native fetch unchanged.
 await compile(true);
 await check('G07 post-await Cancel with canRequest false / first adapter failure / Activity until settlement',async()=>{
  await fresh();await page.evaluate(()=>window.r59.hold=true);await start();await page.waitForFunction(()=>window.r59.entered===1);assert.equal(await page.evaluate(()=>window.r59.activity.count),1);await patch({canRequest:false});assert.equal(await cancel().isDisabled(),false);await cancel().click();assert.equal(await page.evaluate(()=>window.r59.activity.count),1);await page.evaluate(()=>window.r59.release());await idle();await patch({canRequest:true});assert.equal(await panel().locator('pre,ol').count(),0);assert.ok(!(await page.evaluate(()=>window.r59.statuses)).some(s=>s.startsWith('Candidato')));
  await fresh();plan={abort:true};await page.evaluate(()=>window.r59.hold=true);await start();await page.waitForFunction(()=>window.r59.entered===1);await cancel().click();await page.evaluate(()=>window.r59.release());await idle();assert.match(await panel().innerText(),/No se pudo conectar/);assert.equal(await page.evaluate(()=>window.r59.statuses.at(-1)),'No se pudo conectar con LRCLIB. Puedes reintentar expresamente.');
  await fresh();await page.evaluate(()=>window.r59.hold=true);await start();await page.waitForFunction(()=>window.r59.entered===1);await page.getByRole('button',{name:'Descartar resultado',exact:true}).click();await page.evaluate(()=>window.r59.release());await idle();assert.equal(await panel().locator('pre,ol').count(),0);
 });
 await check('G08 post-await track ABA / unmount / scope / proof / available / consent revocation cannot publish',async()=>{
  for(const mode of ['track','unmount','scope','proof','available','consent']){
   await fresh();await page.evaluate(()=>window.r59.hold=true);await start();await page.waitForFunction(()=>window.r59.entered===1);
   if(mode==='track'){await patch({trackId:'B'});await patch({trackId:'A'});}
   if(mode==='unmount')await page.evaluate(()=>window.r59.unmount());
   if(mode==='scope')await page.evaluate(()=>window.r59.scope());
   if(mode==='proof')await page.evaluate(()=>window.r59.revoke());
   if(mode==='available'){await patch({available:false});await patch({available:true});await consent().check();}
   if(mode==='consent'){await consent().uncheck();await consent().check();}
   assert.equal(await page.evaluate(()=>window.r59.activity.count),1);await page.evaluate(()=>window.r59.release());await page.waitForFunction(()=>window.r59.activity.count===0);if(mode==='unmount')await page.evaluate(()=>window.r59.mount());await idle();assert.equal(await panel().locator('pre,ol').count(),0,mode);assert.ok(!(await page.evaluate(()=>window.r59.statuses)).some(s=>s.startsWith('Candidato')),mode);assert.equal(requests.length,1);
  }
 });
 await check('G09 readonly native environment canaries / keyboard / narrow layout / caller status failure cleanup',async()=>{
  await fresh();
  // Own isolated origin, no production DB; writes here seed canaries before panel action.
  const before=await page.evaluate(async()=>{
   localStorage.setItem('r59-canary','untouched');const db=await new Promise((res,rej)=>{const r=indexedDB.open('remote-lyrics-r59-canary',1);r.onupgradeneeded=()=>r.result.createObjectStore('tracks');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});await new Promise(res=>{const t=db.transaction('tracks','readwrite');t.objectStore('tracks').put({title:'Canario',lyrics:'LOCAL',queue:['A','B','A']},'one');t.oncomplete=res;});db.close();
   const root=await navigator.storage.getDirectory();const f=await root.getFileHandle('remote-lyrics-r59-canary',{create:true});const writer=await f.createWritable();await writer.write('OPFS canary');await writer.close();const cache=await caches.open('remote-lyrics-r59-canary');await cache.put('/canary',new Response('CACHE canary'));
   window.r59.snapshot=async()=>{const db=await new Promise(res=>{const r=indexedDB.open('remote-lyrics-r59-canary');r.onsuccess=()=>res(r.result);});const track=await new Promise(res=>{const r=db.transaction('tracks').objectStore('tracks').get('one');r.onsuccess=()=>res(r.result);});db.close();return {track,local:localStorage.getItem('r59-canary'),opfs:await (await (await navigator.storage.getDirectory()).getFileHandle('remote-lyrics-r59-canary')).getFile().then(f=>f.text()),cache:await (await (await caches.open('remote-lyrics-r59-canary')).match('/canary')).text()};};return window.r59.snapshot();
  });
  await consent().focus();await page.keyboard.press('Space');await search().focus();await page.keyboard.press('Enter');await idle();assert.deepEqual(await page.evaluate(()=>window.r59.snapshot()),before);assert.equal(await page.evaluate(()=>window.r59.activity.count),0);
  await page.setViewportSize({width:320,height:640});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.equal(await panel().locator('textarea,input[type="text"]').count(),0);await page.evaluate(()=>window.r59.patch({onStatus:()=>{throw Error('private caller');}}));await page.getByRole('button',{name:'Descartar resultado',exact:true}).click();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Buscar letras de esta canción').disabled);await search().click();await idle();assert.equal(await page.evaluate(()=>window.r59.activity.count),0);assert.deepEqual(await page.evaluate(()=>window.r59.snapshot()),before);
 });
 report.passed=report.cases.length===9&&report.cases.every(c=>c.passed)&&report.pageErrors.length===0&&report.externalBlocked.length===0;
} catch(error){report.fatal=error.stack;report.passed=false;}
finally{
 await context?.close();await browser?.close();await server?.close();
 report.memoryFinal=memory();const after={...await hashes('src'),...await hashes('dist'),...await hashes('public')};report.protectedChanges=Object.keys(protectedBefore).filter(p=>JSON.stringify(protectedBefore[p])!==JSON.stringify(after[p]));if(report.protectedChanges.length)report.passed=false;
 report.finalSources={panel:sha(await readFile('src/ui/RemoteLyricsPanel.tsx')),css:sha(await readFile('src/ui/remote-lyrics.css')),adapter:sha(await readFile('src/library/lrclib.ts'))};
 report.finishedUTC=new Date().toISOString();await writeFile(runDir+'/report.json',JSON.stringify(report,null,2));await writeFile('.local/evidence/remote-lyrics-r59.json',JSON.stringify(report,null,2));console.log('Receipt',runDir+'/report.json');if(!report.passed)process.exitCode=1;
}
