// Final dist/private smoke with native media, storage and transport. No source
// transformation, fake capability or fixture DB. Private address never printed.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright-core';

const privateRun=process.env.PULSO_QUEUE_PRIVATE==='1';
const report={project:'Pulso-Web',passed:false,private:privateRun,iphoneVerified:false,cases:[],sourceTransformed:false};
const hash=b=>createHash('sha256').update(b).digest('hex');
const wav=n=>{const samples=22050*16,b=Buffer.alloc(44+samples*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(22050,24);b.writeUInt32LE(44100,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*(220+n*40)/22050)*2000),44+i*2);return b;};
const button=(p,name)=>p.getByRole('button',{name,exact:true});
let browser,server,context,stage='setup';
try{
 const entry='/releases/'+hash(await readFile('dist/index.html')).slice(0,16)+'.html';report.entry=entry;
 let address;
 if(privateRun){const access=JSON.parse(await readFile('.local/review/private-access.json','utf8'));address=new URL(access.tokenUrl);address.pathname='/open.html';}
 else{
  const root=await realpath('dist');server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),p=await realpath(resolve(root,'.'+(u.pathname==='/'?'/open.html':decodeURIComponent(u.pathname))));if(!p.startsWith(root+sep))throw Error('outside');const b=await readFile(p);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wav':'audio/wav','.mp3':'audio/mpeg','.m4a':'audio/mp4','.json':'application/json'})[extname(p)]??'application/octet-stream','X-Content-Type-Options':'nosniff'}).end(b);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));address=new URL(`http://127.0.0.1:${server.address().port}/open.html`);
 }
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();context=await browser.newContext();context.setDefaultTimeout(15000);
 await context.addInitScript(()=>{
  const state=window.queueSmoke={audios:[],calls:[],revoked:[],csp:[]};const AudioNative=window.Audio;
  window.Audio=class extends AudioNative{constructor(...args){super(...args);state.audios.push(this);for(const name of ['play','pause','load']){const original=this[name];this[name]=function(...args){state.calls.push(name);return original.apply(this,args);};}}};
  const revoke=URL.revokeObjectURL;URL.revokeObjectURL=function(url){state.revoked.push(url);return revoke.call(this,url);};
  document.addEventListener('securitypolicyviolation',e=>state.csp.push(e.violatedDirective));
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',()=>errors.push('pageerror'));
 stage='launcher';await page.goto(address.href);await page.getByLabel('Agrupación de biblioteca',{exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,entry);assert.equal(new URL(page.url()).searchParams.has('_token'),false);
 const files=['A','B','C'].map((letter,n)=>({name:`Entrega-cola-${letter}.wav`,mimeType:'audio/wav',buffer:wav(n)}));
 stage='import';await page.getByLabel('Importar audios',{exact:true}).setInputFiles(files);await page.getByRole('status').filter({hasText:'3 importadas, 0 ya existentes.'}).waitFor();
 stage='prepare';await button(page,'Escuchar Entrega-cola-A').click();await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();const player=page.locator('#player');await player.getByRole('button',{name:'Reproducir',exact:true}).click();await page.waitForFunction(()=>queueSmoke.audios.length===1&&!queueSmoke.audios[0].paused&&queueSmoke.audios[0].currentTime>.1);
 const inspect=()=>page.evaluate(()=>({count:queueSmoke.audios.length,src:queueSmoke.audios[0].src,time:queueSmoke.audios[0].currentTime,paused:queueSmoke.audios[0].paused,calls:[...queueSmoke.calls],revoked:[...queueSmoke.revoked],csp:[...queueSmoke.csp],controller:!!navigator.serviceWorker?.controller}));
 const before=await inspect();
 for(const [placement,title]of [['al final','Entrega-cola-B'],['a continuación','Entrega-cola-C']]){
  stage='append '+placement;const target=button(page,`Añadir ${placement} ${title}`);await target.scrollIntoViewIfNeeded();await target.click();await page.getByRole('status').filter({hasText:`1 entradas añadidas ${placement}.`}).waitFor();
 }
 stage='continuity';const after=await inspect();assert.equal(after.count,1);assert.equal(after.src,before.src);assert.deepEqual(after.calls,before.calls);assert.equal(after.paused,false);assert.ok(after.time>=before.time);assert.equal(after.revoked.includes(before.src),false);
 const queue=await player.locator('ol>li>button:first-child').allTextContents();assert.deepEqual(queue,['Entrega-cola-A','Entrega-cola-C','Entrega-cola-B']);
 stage='persisted-read';const persisted=await page.evaluate(async()=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('pulso-web-local-v1');q.onupgradeneeded=()=>q.transaction.abort();q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});try{return await new Promise((r,j)=>{const q=db.transaction('settings').objectStore('settings').get('library-playback');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});}finally{db.close();}});
 assert.equal(persisted.entries.length,3);assert.equal(new Set(persisted.entries.map(e=>e.id)).size,3);assert.equal(persisted.currentEntryId,persisted.entries[0].id);
 assert.deepEqual(after.csp,[]);assert.deepEqual(errors,[]);report.cases.push({name:'Native single Audio continues through next/end insertion; exact order, occurrence IDs and persisted selection',passed:true,controller:after.controller,transport:before.src.startsWith('blob:')?'bounded-blob':'service-worker',queue});
 stage='reopen';await player.getByRole('button',{name:'Pausar',exact:true}).click();await page.reload();await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();assert.equal(await page.evaluate(()=>queueSmoke.audios.length===1&&queueSmoke.audios[0].paused),true);assert.deepEqual(await page.locator('#player ol>li>button:first-child').allTextContents(),queue);
 report.cases.push({name:'Reopen restores all occurrences and selection paused',passed:true});report.passed=true;report.pageErrors=errors.length;
}catch(error){report.failure={stage,name:error?.name??'Error'};process.exitCode=1;}
finally{
 await context?.close();await browser?.close();if(server)await new Promise(r=>server.close(r));report.cleanup=true;
 await mkdir('.local/evidence',{recursive:true});await writeFile(`.local/evidence/queue-insertion-production${privateRun?'-private':''}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
