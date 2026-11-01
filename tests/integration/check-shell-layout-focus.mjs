// Current-source test build, sandboxed Chromium, private loopback; never writes dist.
import assert from 'node:assert/strict';
import {build,preview} from 'vite';
import {chromium} from 'playwright-core';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {licenseGuard} from '../../scripts/third-party-notices.mjs';
const report={passed:false,command:'INSTABOX_HEADLESS=1 node tests/integration/check-shell-layout-focus.mjs',cases:[],errors:[],external:[],limits:['Chromium desktop sandbox with synthetic IDB WAV; not iPhone, VoiceOver, actual browser zoom, offline acceptance, final visual parity or complete T8/P0.','200% uses font-size, not browser zoom.','Async gates are test-build-only wrappers around real APIs. Mini artwork deliberately says Portada sin cargar.','No broad T18 benchmark repeated.']};
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
async function tree(dir){const result={};for(const e of await readdir(dir,{withFileTypes:true})){const p=`${dir}/${e.name}`;if(e.isDirectory())Object.assign(result,await tree(p));else result[p]=await hash(p);}return result;}
const before=await tree('dist');let browser,server,page;const pass=name=>{report.cases.push(name);console.log('PASS '+name);};
const rows=p=>p.locator('.tracks>li');
const nav=p=>p.getByRole('navigation',{name:'Principal',exact:true});
const route=(p,name)=>nav(p).getByRole('button',{name,exact:true}).click();
const search=p=>p.getByLabel('Buscar por título, artista o álbum',{exact:true});
const view=p=>p.getByLabel(/^Vista/);
const pager=p=>p.getByRole('navigation',{name:'Páginas de canciones'});
const next=p=>pager(p).getByRole('button',{name:'Página siguiente',exact:true});
const frames=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const focus=async locator=>{await locator.page().waitForFunction(e=>e===document.activeElement,await locator.elementHandle());assert.equal(await locator.evaluate(e=>e===document.activeElement),true);};
async function state(p){return p.evaluate(()=>window.shellTest.state());}
async function refresh(p){await p.getByRole('button',{name:'Comprobar archivos locales',exact:true}).click();await p.waitForFunction(()=>window.shellTest.control.activity.count===0);await frames(p);}
async function dbMutate(p,changes){await p.evaluate(async changes=>{const db=await new Promise(r=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>r(q.result);});const tx=db.transaction('tracks','readwrite'),s=tx.objectStore('tracks');for(const [id,patch]of changes){const q=s.get(id);q.onsuccess=()=>s.put({...q.result,...patch},id);}await new Promise(r=>tx.oncomplete=r);db.close();},changes);}
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

async function open(origin,n=0,options={}){
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:800}});
 await context.route('**/*',r=>{const u=r.request().url();if(u.startsWith(origin+'/')||u.startsWith('blob:'))return r.continue();report.external.push(u);return r.abort();});
 await context.addInitScript(()=>{window.shellTest={audios:[],calls:{play:0,pause:0,load:0}};const Native=Audio;window.Audio=class extends Native{constructor(...args){super(...args);window.shellTest.audios.push(this);}play(){window.shellTest.calls.play++;return super.play();}pause(){window.shellTest.calls.pause++;super.pause();}load(){window.shellTest.calls.load++;super.load();}};Object.defineProperty(navigator,'serviceWorker',{value:{getRegistration:async()=>undefined,register:async()=>{throw Error('Own Blob test');}}});});
 const p=await context.newPage();page=p;p.setDefaultTimeout(12000);p.on('pageerror',e=>report.errors.push(e.stack));await p.goto(origin);await p.getByRole('status').filter({hasText:'con-control'}).waitFor();
 let f;if(n){f=await fixture(p,n,options);await p.reload();await rows(p).nth(Math.min(49,n-1)).waitFor();}return {p,f,context};
}
async function prepare(p){await p.getByRole('button',{name:'Preparar cola de esta selección',exact:true}).click();await p.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();}
async function arm(p,kind='delay'){await p.evaluate(kind=>{window.shellTest.gate=kind;window.shellTest.settled=false;},kind);}
async function release(p){await p.evaluate(()=>window.shellTest.release());await p.waitForFunction(()=>window.shellTest.settled);await frames(p);}
async function hold(p){await p.evaluate(()=>{window.shellTest.heldRAF=[];window.shellTest.raf=cb=>{window.shellTest.heldRAF.push(cb);return -window.shellTest.heldRAF.length;};});}
async function flush(p){await p.evaluate(()=>{window.shellTest.raf=cb=>requestAnimationFrame(cb);const callbacks=window.shellTest.heldRAF;window.shellTest.heldRAF=[];for(const cb of callbacks)cb(performance.now());});await frames(p);}
async function geometry(p,loc){
 await loc.focus();await frames(p);
 return loc.evaluate(e=>{const b=e.getBoundingClientRect();const points=[...e.getClientRects()].flatMap(r=>[[r.left+2,r.top+2],[r.right-2,r.top+2],[r.left+2,r.bottom-2],[r.right-2,r.bottom-2],[r.left+r.width/2,r.top+r.height/2]]);
 return {text:e.getAttribute('aria-label')||e.textContent?.slice(0,50),x:b.x,y:b.y,width:b.width,height:b.height,visible:b.top>=-1&&b.bottom<=innerHeight+1&&b.left>=-1&&b.right<=innerWidth+1,hit:points.every(([x,y])=>{const h=document.elementFromPoint(x,y);return h===e||e.contains(h);})};});
}
try{
 await mkdir('.local/evidence',{recursive:true});
 const outDir='.local/shell-layout-focus-build';
 await build({configFile:false,logLevel:'error',plugins:[licenseGuard(),{name:'shell-test-only',enforce:'pre',transform(code,id){
  if(id.endsWith('/src/main.tsx'))return code.replaceAll('requestAnimationFrame(','window.shellTest.raf(').replace("createRoot(document.getElementById('root')!).render(<App/>);",`window.shellTest.raf=cb=>requestAnimationFrame(cb);window.shellTest.control=control;window.shellTest.state=()=>({src:audio.src,sourceAttribute:audio.getAttribute('src'),position:audio.currentTime,paused:audio.paused,entries:player.entries.map(e=>({...e})),repeat:player.repeat,shuffle:player.shuffleOrder,owner:control.owner,proof:control.proof,audios:window.shellTest.audios.length});const testRoot=createRoot(document.getElementById('root')!);window.shellTest.unmount=()=>testRoot.unmount();testRoot.render(<App/>);`);
 }}],worker:{plugins:()=>[licenseGuard()]},build:{outDir,emptyOutDir:true,rolldownOptions:{input:'index.html'}}});
 await writeFile(`${outDir}/shell-test-200.css`,':root{font-size:200%}');
 await writeFile(`${outDir}/shell-test-100.css`,':root{font-size:100%}');
 server=await preview({configFile:false,build:{outDir},preview:{host:'127.0.0.1',port:0,strictPort:true}});const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();

 const {p,f,context}=await open(origin,101);
 await dbMutate(p,[[f.ids[0],{title:'Texto muy largo '.repeat(20).slice(0,300)}]]);await refresh(p);await prepare(p);
 report.layout=[];
 for(const [width,height]of [[320,568],[390,844],[568,320],[600,320],[844,390]])for(const scale of [100,200]){
  await p.setViewportSize({width,height});await p.evaluate(scale=>{document.getElementById('test-font')?.remove();const l=document.createElement('link');l.id='test-font';l.rel='stylesheet';l.href=`/shell-test-${scale}.css`;document.head.append(l);return new Promise(r=>l.onload=r);},scale);await frames(p);
  const targets=[search(p),p.locator('#player input[type=range]'),...await p.locator('#player .controls button').all(),p.getByLabel(/^Repetición/),p.getByRole('button',{name:'Aleatorio',exact:true}),...await nav(p).getByRole('button').all(),...await p.locator('.mini-player button').all(),p.getByRole('link',{name:'Licencias de terceros',exact:true})];
  const measured=[];for(const target of targets){const box=await geometry(p,target);assert.ok(box.visible&&box.hit,JSON.stringify({width,height,scale,box}));measured.push(box);}
  const bars=await p.evaluate(()=>({nav:getComputedStyle(document.querySelector('.shell-nav')).position,mini:getComputedStyle(document.querySelector('.mini-player')).position,navHeight:document.querySelector('.shell-nav').getBoundingClientRect().height,reserveNav:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')),miniHeight:document.querySelector('.mini-player').getBoundingClientRect().height,reserveMini:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mini-height')),overflow:document.documentElement.scrollWidth>innerWidth}));
  assert.equal(bars.overflow,false);if(width<=600)assert.equal(bars.nav,'fixed');assert.ok(Math.abs(bars.reserveNav-(bars.nav==='fixed'?bars.navHeight:0))<1);assert.ok(Math.abs(bars.reserveMini-(bars.mini==='fixed'?bars.miniHeight:0))<1);
  assert.equal(await p.locator('.mini-player strong').innerText(),'Texto muy largo '.repeat(20).slice(0,300));report.layout.push({width,height,scale,bars,targets:measured});
 }
 pass('10 viewport/text combinations: full search/player/nav/mini/footer border boxes reachable without interception, long title retained, measured fixed reserves');
 await p.setViewportSize({width:1280,height:800});await p.evaluate(()=>document.getElementById('test-font')?.remove());await frames(p);
 async function testResponses(p,directions){
 const opener=p.getByRole('button',{name:'Abrir reproductor desde minirreproductor',exact:true});const back=()=>p.locator('#player').getByRole('button',{name:'Volver',exact:true});const settings=p.getByText('Ajustes y límites de esta fase',{exact:true});
 for(const direction of directions)for(const kind of ['positive','tab','focusABA','pointer','blur','route','wheel','owner','unmount']){
  if(direction==='create'){await route(p,'Inicio');await p.locator('.home-view').getByRole('button',{name:'Crear playlist',exact:true}).focus();}
  else {await route(p,'Biblioteca');if(direction==='back'){await opener.click();await focus(p.locator('#player h2'));await back().focus();}else await opener.focus();}
  await hold(p);await p.keyboard.press('Enter');
  if(kind==='tab')await p.keyboard.press('Tab');
  if(kind==='focusABA'){await settings.focus();if(direction==='open')await opener.focus();else await search(p).focus();}
  if(kind==='pointer')await settings.dispatchEvent('pointerdown');
  if(kind==='blur')await p.evaluate(()=>window.dispatchEvent(new Event('blur')));
  if(kind==='route')await nav(p).getByRole('button',{name:'Buscar',exact:true}).dispatchEvent('click');
  if(kind==='wheel')await p.evaluate(()=>{window.dispatchEvent(new WheelEvent('wheel',{deltaY:120}));window.scrollTo(0,100);});
  const originalProof=await p.evaluate(()=>window.shellTest.control.proof);
  if(kind==='owner')await p.evaluate(()=>window.shellTest.control.proof='test-new-proof');
  if(kind==='unmount')await p.evaluate(()=>window.shellTest.unmount());
  const prior=await p.evaluate(()=>({active:document.activeElement,tag:document.activeElement?.outerHTML,y:scrollY}));
  // Keep the exact element reference in the page, including the ABA case.
  await p.evaluate(()=>window.shellTest.expectedFocus=document.activeElement);
  await flush(p);
  if(kind==='positive'){await focus(direction==='open'?p.locator('#player h2'):direction==='back'?opener:p.getByLabel('Nueva playlist',{exact:true}));}
  else {assert.equal(await p.evaluate(()=>window.shellTest.expectedFocus===document.activeElement||(!window.shellTest.expectedFocus.checkVisibility()&&document.activeElement===document.body)),true,`${direction}/${kind}: ${prior.tag}`);if(kind==='wheel')assert.equal(await p.evaluate(()=>scrollY),prior.y);}
  if(kind==='owner')await p.evaluate(proof=>window.shellTest.control.proof=proof,originalProof);
  if(kind==='unmount'){await p.reload();await p.getByRole('status').filter({hasText:'con-control'}).waitFor();}
  pass(`${direction}: ${kind} ${kind==='positive'?'legitimate focus':'cancels delayed shell response'}`);
 }
 }
 await testResponses(p,['open','back']);const empty=await open(origin);await testResponses(empty.p,['create']);await empty.context.close();page=p;await p.bringToFront();assert.equal(await p.evaluate(()=>document.hasFocus()),true);
 const opener=p.getByRole('button',{name:'Abrir reproductor desde minirreproductor',exact:true}),back=()=>p.locator('#player').getByRole('button',{name:'Volver',exact:true});
 // Route scroll must also yield to a later user scroll intention.
 await hold(p);await nav(p).getByRole('button',{name:'Inicio',exact:true}).dispatchEvent('click');await p.evaluate(()=>{window.dispatchEvent(new WheelEvent('wheel',{deltaY:123}));window.scrollTo(0,123);});await flush(p);assert.equal(await p.evaluate(()=>scrollY),123);pass('navigation RAF preserves newer scrolling');
 await route(p,'Biblioteca');await view(p).selectOption(f.list.id);await prepare(p);assert.equal((await state(p)).entries.length,101);assert.equal(await rows(p).count(),50);
 await next(p).click();const up=rows(p).first().getByRole('button',{name:'Subir Pista 050',exact:true});await up.focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>document.activeElement?.textContent==='Subir Pista 050'&&document.querySelector('#library-page-position')?.textContent.includes('Página 1 de'),null,{polling:50});const down=rows(p).last().getByRole('button',{name:'Bajar Pista 050',exact:true});await down.focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>document.activeElement?.textContent==='Bajar Pista 050'&&document.querySelector('#library-page-position')?.textContent.includes('Página 2 de'));
 await p.getByRole('button',{name:'Verificar copias',exact:true}).click();await p.getByRole('button',{name:'Volver a verificar',exact:true}).waitFor();const batch=await p.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>r(q.result);});const tx=db.transaction('settings');const all=await new Promise(r=>{const q=tx.objectStore('settings').getAll();q.onsuccess=()=>r(q.result);});db.close();return all.find(x=>x?.playlistId);});assert.equal(batch.entries.length,101);
 await p.getByLabel('Solo favoritos',{exact:true}).check();await p.getByLabel('Solo copias presentes',{exact:true}).check();const favorite=rows(p).first().getByRole('button',{name:'Quitar favorito',exact:true});await favorite.focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>document.activeElement?.textContent==='Quitar favorito'&&document.querySelector('.tracks>li strong')?.textContent==='Pista 003');await p.getByLabel('Solo favoritos',{exact:true}).uncheck();await p.getByLabel('Solo copias presentes',{exact:true}).uncheck();await next(p).click();await route(p,'Buscar');await search(p).fill('Pista 100');await route(p,'Biblioteca');assert.equal(await view(p).inputValue(),f.list.id);assert.match(await pager(p).innerText(),/Página 2 de 3/);await route(p,'Buscar');assert.equal(await search(p).inputValue(),'Pista 100');
 await route(p,'Biblioteca');await p.getByLabel(/^Repetición/).selectOption('all');await p.getByRole('button',{name:'Aleatorio',exact:true}).click();await p.evaluate(()=>window.shellTest.audios[0].playbackRate=.1);await p.getByRole('button',{name:'Reproducir desde minirreproductor',exact:true}).click();await p.waitForFunction(()=>!window.shellTest.state().paused);
 const initial=await state(p),calls=await p.evaluate(()=>({...window.shellTest.calls}));await route(p,'Inicio');await route(p,'Buscar');await route(p,'Biblioteca');await opener.click();await focus(p.locator('#player h2'));await back().click();await focus(opener);const after=await state(p);for(const key of ['src','sourceAttribute','entries','repeat','shuffle','owner','proof','audios','paused'])assert.deepEqual(after[key],initial[key],key);assert.ok(after.position>=initial.position);assert.deepEqual(await p.evaluate(()=>window.shellTest.calls),calls);assert.equal(after.audios,1);assert.equal(await p.evaluate(()=>window.shellTest.control.activity.count),0);pass('normal regression: 50 rows/full queue101/full playlist batch101, move focus both directions and favorite commit focus, filters and route query/list/pager, playing open/back same Audio/source/queue/proof/modes with no extra commands or pending activity');
 await context.close();assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);assert.deepEqual(await tree('dist'),before);report.distUntouched=true;report.passed=true;
}catch(error){report.failure={message:error.message,stack:error.stack,dom:page&&!page.isClosed()?await page.evaluate(()=>({focus:document.activeElement?.outerHTML.slice(0,200),focusText:document.activeElement?.textContent?.slice(0,200),predicate:document.activeElement?.textContent==='Subir Pista 050'&&document.querySelector('#library-page-position')?.textContent.includes('Página 1 de'),hasFocus:document.hasFocus(),pager:document.querySelector('#library-page-position')?.textContent})):null};process.exitCode=1;}
finally{await browser?.close();if(server)await new Promise(r=>server.httpServer.close(r));report.sources=Object.fromEntries(await Promise.all(['src/main.tsx','src/style.css','src/ui/MiniPlayer.tsx','src/ui/shell.css','tests/integration/check-shell-layout-focus.mjs','tests/integration/shell-layout-focus-red.mjs'].map(async p=>[p,await hash(p)])));report.dist=before;report.red={file:'.local/evidence/shell-layout-focus-red.json',sha256:await hash('.local/evidence/shell-layout-focus-red.json')};report.validation={typecheck:'npm run typecheck',lint:'npm run lint',unit:'node_modules/.bin/tsx --test tests/unit/shell-selectors.test.ts tests/unit/pagination.test.ts tests/unit/groups.test.ts tests/unit/player.test.ts tests/unit/ownership.test.ts',unitLog:'.local/shell-layout-focus-unit.log',tests:31};report.priorAttempts=['attempt1: trailing whitespace expectation in test corrected','attempt2: multiline inline link uses per-line client rects for hit testing','attempt3: create action correctly tested in its empty-library context','attempt4: Chromium rejected test playbackRate0.01; use supported0.1','attempt5: browser may drop focus from a newly hidden source to body; test permits only that natural transition, never another control','attempt6: return foreground to original page after separate empty-library context; row focus intentionally requires document.hasFocus','attempt7/8: global RAF gate also intercepted Playwright polling; scope the manual gate to main.tsx callbacks only in test transform','attempt9: copied repeat20 title was320chars; truncate synthetic title to exactly300 valid chars before full-batch regression'];await writeFile('.local/evidence/shell-layout-focus.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
