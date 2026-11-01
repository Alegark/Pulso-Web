// Real navigation, distinct from synthetic persisted lifecycle events.
// Own context/server/build; never changes product dist or the owner's profile.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,readdir,realpath,mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {build} from 'vite';
import {chromium} from 'playwright-core';
const outDir='.local/t13-navigation-product';
const report={passed:false,iphoneVerified:false,cases:[],bfcache:{verified:false},environment:'Chromium headless sandbox, own context, temporary loopback, actual goBack navigation'};
let browser,server;
try{
 await build({configFile:false,build:{outDir,emptyOutDir:true,rolldownOptions:{input:'index.html'}}});
 const files=['/','/index.html',...(await readdir(`${outDir}/assets`)).map(name=>`/assets/${name}`)];
 await build({configFile:false,define:{SHELL_FILES:JSON.stringify(files)},build:{emptyOutDir:false,outDir,lib:{entry:'src/service-worker/sw.ts',formats:['es'],fileName:()=> 'sw.js'}}});
 const root=await realpath(outDir);
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.mp3':'audio/mpeg','.m4a':'audio/mp4','.wasm':'application/wasm','.json':'application/json'};
 server=createServer(async(req,res)=>{
  try{
   const path=new URL(req.url,'http://localhost').pathname;
   if(path==='/navigation-away.html'){res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><meta charset="utf-8"><title>Destino de prueba propio</title><p>Solo navegación local</p>');return;}
   const file=await realpath(resolve(root,'.'+(path==='/'?'/index.html':decodeURIComponent(path))));
   if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
   const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Content-Length':bytes.length,'X-Content-Type-Options':'nosniff'}).end(bytes);
  }catch{res.writeHead(404).end();}
 });
 await new Promise((ready,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',ready);});
 // Playwright disables BFCache by default; omit that one default flag in this own test browser.
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true,ignoreDefaultArgs:['--disable-back-forward-cache']});
 report.browserVersion=browser.version();
 const ctx=await browser.newContext();ctx.setDefaultTimeout(15000);
 await ctx.addInitScript(()=>{
  window.handoffNavigation={documentId:crypto.randomUUID(),events:[],audio:[],plays:0};
  const NativeAudio=Audio;window.Audio=class extends NativeAudio{constructor(...args){super(...args);window.handoffNavigation.audio.push(this);}};
  const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(...args){window.handoffNavigation.plays++;return play.apply(this,args);};
  for(const type of ['pagehide','pageshow'])window.addEventListener(type,event=>window.handoffNavigation.events.push({type,persisted:event.persisted}));
 });
 const origin=`http://127.0.0.1:${server.address().port}`,page=await ctx.newPage(),errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(origin)&&!r.url().startsWith('blob:'))external.push(r.url());});
 const state=name=>page.getByRole('region',{name:'Control de esta pestaña',exact:true}).getByRole('status').filter({hasText:new RegExp(`^${name}$`)}).waitFor();
 const control=()=>page.getByRole('region',{name:'Control de esta pestaña',exact:true});
 const read=()=>page.evaluate(()=>({documentId:window.handoffNavigation.documentId,events:window.handoffNavigation.events,audio:window.handoffNavigation.audio.map(a=>({paused:a.paused,src:a.src,time:a.currentTime})),plays:window.handoffNavigation.plays,reasons:performance.getEntriesByType('navigation')[0]?.notRestoredReasons?.toJSON?.()??null}));
 await page.goto(origin);await state('con-control');
 await page.getByLabel('Importar audios',{exact:true}).setInputFiles('public/samples/Aurora.mp3');await page.getByRole('status').filter({hasText:'1 importadas'}).waitFor();
 await page.getByRole('button',{name:'Preparar cola de esta selección',exact:true}).click();await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
 await page.locator('#player').getByLabel('Repetición',{exact:false}).selectOption('one');
 await page.locator('#player').getByRole('button',{name:'Reproducir',exact:true}).click();await page.waitForFunction(()=>!window.handoffNavigation.audio[0].paused&&window.handoffNavigation.audio[0].currentTime>0);
 await control().getByText('0 operaciones activas.',{exact:false}).waitFor();
 const before=await read();
 await page.goto(origin+'/navigation-away.html');
 await page.waitForFunction(async()=>!(await navigator.locks.query()).held.some(l=>l.name==='pulso-web:local:playback'));
 await page.goBack({waitUntil:'commit'});await control().waitFor();
 const returned=await read(),persisted=returned.documentId===before.documentId&&returned.events.some(e=>e.type==='pageshow'&&e.persisted);
 if(persisted){await state('sin-control');await control().getByRole('button',{name:'Comprobar disponible',exact:true}).click();}
 await state('con-control');await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
 assert.equal((await read()).audio[0].paused,true);assert.equal(await page.locator('#player ol>li').count(),1);
 if(!persisted)assert.equal((await read()).plays,0);
 report.cases.push({name:'Actual navigation away while playing releases control; back restores queue paused',passed:true,persisted});
 // An idle, explicitly released document gives BFCache an additional eligible attempt.
 await control().getByText('0 operaciones activas.',{exact:false}).waitFor();await control().getByRole('button',{name:'Ceder control',exact:true}).click();await state('sin-control');
 const idleBefore=await read();await page.goto(origin+'/navigation-away.html');await page.goBack({waitUntil:'commit'});await control().waitFor();
 const idleReturn=await read(),idlePersisted=idleReturn.documentId===idleBefore.documentId&&idleReturn.events.some(e=>e.type==='pageshow'&&e.persisted);
 if(idlePersisted){await state('sin-control');assert.equal(idleReturn.audio[0].paused,true);await control().getByRole('button',{name:'Comprobar disponible',exact:true}).click();}
 await state('con-control');await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();assert.equal((await read()).audio[0].paused,true);
 report.cases.push({name:'Back navigation after explicit release requires lock acquisition or a new document and stays paused',passed:true,persisted:idlePersisted});
 report.bfcache={verified:persisted||idlePersisted,playingNavigation:persisted,idleNavigation:idlePersisted,notRestoredReasons:idleReturn.reasons??returned.reasons};
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report.pageErrors=0;report.externalRequests=0;report.passed=true;
}catch(error){report.failure=error.stack;throw error;}
finally{await browser?.close();if(server)await new Promise(done=>server.close(done));await mkdir('.local/evidence',{recursive:true});await writeFile('.local/evidence/handoff-navigation.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
