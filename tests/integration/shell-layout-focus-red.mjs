// Current-source test build, sandboxed Chromium, private loopback; never writes dist.
import assert from 'node:assert/strict';
import {build,preview} from 'vite';
import {chromium} from 'playwright-core';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {licenseGuard} from '../../scripts/third-party-notices.mjs';
const report={passed:false,command:'INSTABOX_HEADLESS=1 node tests/integration/shell-layout-focus-red.mjs',cases:[],errors:[],external:[],limits:['Chromium desktop sandbox with synthetic IDB WAV; not iPhone, VoiceOver, actual browser zoom, offline acceptance, final visual parity or complete T8/P0.','200% uses font-size, not browser zoom.','Async gates are test-build-only wrappers around real APIs. Mini artwork deliberately says Portada sin cargar.','No broad T18 benchmark repeated.']};
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
async function hold(p){await p.evaluate(()=>{window.realRAF=requestAnimationFrame;window.heldRAF=[];window.requestAnimationFrame=cb=>{window.heldRAF.push(cb);return window.heldRAF.length;};});}
async function flush(p){await p.evaluate(()=>{window.requestAnimationFrame=window.realRAF;const callbacks=window.heldRAF;window.heldRAF=[];for(const cb of callbacks)cb(performance.now());});await frames(p);}
async function geometry(p,loc){
 await loc.focus();await loc.evaluate(e=>e.scrollIntoView({block:'center',inline:'nearest'}));await frames(p);
 return loc.evaluate(e=>{const b=e.getBoundingClientRect();const points=[...e.getClientRects()].flatMap(r=>[[r.left+2,r.top+2],[r.right-2,r.top+2],[r.left+2,r.bottom-2],[r.right-2,r.bottom-2],[r.left+r.width/2,r.top+r.height/2]]);
 return {text:e.getAttribute('aria-label')||e.textContent?.slice(0,50),x:b.x,y:b.y,width:b.width,height:b.height,visible:b.top>=-1&&b.bottom<=innerHeight+1&&b.left>=-1&&b.right<=innerWidth+1,hit:points.every(([x,y])=>{const h=document.elementFromPoint(x,y);return h===e||e.contains(h);})};});
}
try{
 server=await preview({configFile:false,build:{outDir:'.local/functional-shell-build'},preview:{host:'127.0.0.1',port:0,strictPort:true}});const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();
 const {p,f,context}=await open(origin,3);await dbMutate(p,[[f.ids[0],{title:'Texto muy largo '.repeat(20).slice(0,300)}]]);await refresh(p);await prepare(p);
 await p.setViewportSize({width:568,height:320});await p.evaluate(()=>new Promise(r=>{const l=document.createElement('link');l.rel='stylesheet';l.href='/shell-test-200.css';l.onload=r;document.head.append(l);}));await frames(p);await search(p).focus();await frames(p);
 report.layout=await search(p).evaluate(e=>{const b=e.getBoundingClientRect(),m=document.querySelector('.mini-player').getBoundingClientRect(),n=document.querySelector('.shell-nav').getBoundingClientRect();return {input:{top:b.top,bottom:b.bottom,height:b.height},mini:{top:m.top,height:m.height},nav:{top:n.top,height:n.height},space:m.top,fullyVisible:b.top>=0&&b.bottom<=m.top};});assert.equal(report.layout.fullyVisible,false);assert.ok(report.layout.space<report.layout.input.height);pass('RED: frozen mini/nav leave less space than focused search border box');
 await p.setViewportSize({width:1280,height:800});
 const opener=p.getByRole('button',{name:'Abrir reproductor desde minirreproductor',exact:true});
 report.stolen=[];
 for(const direction of ['open','back']){const source=direction==='open'?opener:p.locator('#player').getByRole('button',{name:'Volver',exact:true});await source.focus();await hold(p);await p.keyboard.press('Enter');await p.keyboard.press('Tab');await p.evaluate(()=>window.shellTest.expectedFocus=document.activeElement);const prior=await p.evaluate(()=>document.activeElement.outerHTML);await flush(p);assert.equal(await p.evaluate(()=>window.shellTest.expectedFocus!==document.activeElement),true);report.stolen.push({direction,prior,after:await p.evaluate(()=>document.activeElement.outerHTML)});pass(`RED: frozen ${direction} steals newer Tab focus`);}
 await context.close();assert.deepEqual(await tree('dist'),before);report.distUntouched=true;report.passed=true;report.meaning='Expected defects reproduced, not a product PASS';report.frozenBuild=await tree('.local/functional-shell-build');
}catch(error){report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{await browser?.close();if(server)await new Promise(r=>server.httpServer.close(r));await writeFile('.local/evidence/shell-layout-focus-red.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,cases:report.cases,failure:report.failure}));}
