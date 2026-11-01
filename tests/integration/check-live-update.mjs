import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';

let server,browser;
const report={passed:false,iphoneVerified:false};
try{
 const oldRoot=await realpath(process.env.PULSO_UPDATE_BASELINE??'.local/releases/compat-before-groups'),newRoot=await realpath('dist');
 const oldEntrySHA256=createHash('sha256').update(await readFile(resolve(oldRoot,'index.html'))).digest('hex');
 const entry='/releases/'+createHash('sha256').update(await readFile('dist/index.html')).digest('hex').slice(0,16)+'.html';
 let updated=false;
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav'};
 server=createServer(async(req,res)=>{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname),name=path==='/'?'/index.html':path;
  for(const root of updated?[newRoot,oldRoot]:[oldRoot])try{
   const file=await realpath(resolve(root,'.'+name));if(!file.startsWith(root+sep))continue;
   const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Content-Length':bytes.length,'X-Content-Type-Options':'nosniff'});res.end(bytes);return;
  }catch{/* Try another authorized static root. */}
  res.writeHead(404).end();
 });
 await new Promise((ready,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',ready);});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 const context=await browser.newContext();await context.addInitScript(()=>{window.pulsoUpdateAudio=[];const NativeAudio=window.Audio;window.Audio=class extends NativeAudio{constructor(...args){super(...args);window.pulsoUpdateAudio.push(this);}};});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const previous=await context.newPage(),previousResponse=await previous.goto(origin+'/web.html');
 assert.equal(createHash('sha256').update(await previousResponse.body()).digest('hex'),oldEntrySHA256,'requires the selected frozen release as control');
 await previous.getByRole('button',{name:'Cargar música de prueba',exact:true}).click();await previous.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
 await previous.getByRole('region',{name:'Reproductor',exact:true}).getByRole('button',{name:'Reproducir',exact:true}).click();await previous.waitForFunction(()=>window.pulsoUpdateAudio[0]?.currentTime>0&&!window.pulsoUpdateAudio[0].paused);
 updated=true;
 const current=await context.newPage();await current.goto(origin+'/open.html');await current.waitForURL(origin+entry);await current.getByLabel('Agrupación de biblioteca',{exact:true}).waitFor();
 await current.getByRole('status').filter({hasText:'Hay una versión nueva preparada.'}).waitFor();
 const waiting=await current.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);assert.equal(waiting,true);
 const oldStillPlaying=await previous.evaluate(()=>window.pulsoUpdateAudio.length===1&&!window.pulsoUpdateAudio[0].paused);
 const newIsPaused=await current.evaluate(()=>window.pulsoUpdateAudio.length===1&&window.pulsoUpdateAudio[0].paused);assert.equal(oldStillPlaying,true);assert.equal(newIsPaused,true);
 await previous.close();await current.close();
 const reopened=await context.newPage();await reopened.goto(origin+'/open.html');await reopened.waitForURL(origin+entry);await reopened.getByLabel('Agrupación de biblioteca',{exact:true}).waitFor();
 await reopened.waitForFunction(async()=>{const r=await navigator.serviceWorker.getRegistration();return r?.active?.state==='activated'&&!r.waiting;});
 await reopened.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
 assert.equal(await reopened.evaluate(()=>window.pulsoUpdateAudio.length===1&&window.pulsoUpdateAudio[0].paused),true);
 report.result={oldEntrySHA256,newEntry:entry,newVersionBypassesOldShell:true,stableLauncherSelectsCurrentBuild:true,waitingBeforeClosingClients:waiting,oldStillPlaying,newIsPaused,activatedAfterClientClosure:true,restoredPaused:true};report.passed=true;
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));console.log(JSON.stringify(report));}
