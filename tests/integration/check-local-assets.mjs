import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {preview} from 'vite';
import {chromium} from 'playwright-core';

// Synthetic PCM, deliberately crossing several storage chunk boundaries.
const bytes=Buffer.alloc(196608+44);
bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
bytes.writeUInt32LE(22050,24);bytes.writeUInt32LE(44100,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
for(let i=44;i<bytes.length;i+=2)bytes.writeInt16LE(Math.round(2000*Math.sin((i-44)*Math.PI/50)),i);
const expectedHash=createHash('sha256').update(bytes).digest('hex');
let server;
const report={passed:false,cases:[],iphoneVerified:false};
try{
 server=await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 await mkdir('.local/browser-profiles',{recursive:true});
 for(const backend of ['idb','opfs']){
  const profile=await mkdtemp(join('.local/browser-profiles','assets-'));
  const launch=()=>chromium.launchPersistentContext(profile,{executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});
  let context,page;
  try{
   context=await launch();report.browserVersion=context.browser().version();
   if(backend==='idb'){
    // Simulate the same missing capability in both window and dedicated worker.
    await context.addInitScript(()=>Object.defineProperty(StorageManager.prototype,'getDirectory',{configurable:true,value:undefined}));
    await context.route(/\/assets\/import\.worker-[^/]+\.js$/,async route=>{
     const response=await route.fetch();
     await route.fulfill({response,body:"Object.defineProperty(StorageManager.prototype,'getDirectory',{configurable:true,value:undefined});\n"+await response.text()});
    });
   }
   page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.name));
   await page.goto(origin);
   await page.waitForFunction(()=>{const input=document.querySelector('input[type=file]');return input instanceof HTMLInputElement&&!input.disabled;});
   await page.getByLabel('Importar audios',{exact:true}).setInputFiles({name:'Local propio.wav',mimeType:'audio/wav',buffer:bytes});
   await page.getByRole('status').filter({hasText:'1 importadas, 0 ya existentes.'}).waitFor();
   await page.getByRole('button',{name:'Escuchar Local propio',exact:true}).click();
   await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
   const check=async()=>page.evaluate(async({backend,expectedHash})=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1');r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result);});
    const collect=store=>new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const [assets,tickets]=await Promise.all([collect('assets'),collect('tickets')]);
    const keys=await new Promise(resolve=>{const r=db.transaction('tickets').objectStore('tickets').getAllKeys();r.onsuccess=()=>resolve(r.result);});db.close();
    const asset=assets.find(a=>a.backend===backend);if(!asset)throw new Error('Backend not exercised');
    const held=(await navigator.locks.query()).held.map(l=>l.name);
    const index=tickets.findIndex(t=>t.assetId===asset.id&&held.includes(t.ownerProof));if(index<0)throw new Error('Owner ticket missing');
    const path='/_pulso/media/'+keys[index],checks=[];
    const digest=async buffer=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
    const full=await fetch(path);const buffer=await full.arrayBuffer();checks.push({name:'full verified GET',pass:full.status===200&&buffer.byteLength===asset.bytes&&await digest(buffer)===expectedHash});
    for(const [range,status,size] of [['bytes=0-1',206,2],['bytes=65530-65548',206,19],['bytes=-3',206,3],['bytes=3-',206,asset.bytes-3],[`bytes=${asset.bytes}-`,416,0],['bytes=0-1,4-5',200,asset.bytes]]){
     const response=await fetch(path,{headers:{Range:range}});const body=new Uint8Array(await response.arrayBuffer());
     const start=range==='bytes=-3'?asset.bytes-3:range==='bytes=65530-65548'?65530:range==='bytes=3-'?3:0;
     const original=new Uint8Array(buffer).slice(start,start+size);
     checks.push({name:range.replace(String(asset.bytes),'EOF'),pass:response.status===status&&body.length===size&&body.every((b,i)=>b===original[i])&&response.headers.get('X-Content-Type-Options')==='nosniff'});
    }
    const head=await fetch(path,{method:'HEAD',headers:{Range:'bytes=0-1'}});checks.push({name:'HEAD full length empty body',pass:head.status===200&&head.headers.get('Content-Length')===String(asset.bytes)&&(await head.arrayBuffer()).byteLength===0});
    return {backend,checks,passed:checks.every(c=>c.pass),path};
   },{backend,expectedHash});
   const initial=await check();assert.equal(initial.passed,true,JSON.stringify(initial.checks));
   const other=await context.newPage();await other.goto(origin+'/samples.html');
   const foreignStatus=await other.evaluate(async path=>(await fetch(path)).status,initial.path);assert.equal(foreignStatus,403);await other.close();
   const cdp=await context.newCDPSession(page);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');
   const restarted=await check();assert.equal(restarted.passed,true);
   // Close Chromium completely and reuse only this test's private temporary profile.
   await context.close();context=await launch();await context.setOffline(true);
   page=await context.newPage();page.on('pageerror',e=>errors.push(e.name));await page.goto(origin,{waitUntil:'load'});
   await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
   const offline=await check();assert.equal(offline.passed,true);assert.deepEqual(errors,[]);
   report.cases.push({backend,passed:true,checks:initial.checks,foreignStatus,stopAllWorkersAcknowledged:true,nextFetchPassed:true,offlineAfterChromiumRestartPassed:true,pageErrors:0});
  }catch(error){report.failure={backend,error:error.message,status:page&&!page.isClosed()?await page.getByRole('status').allTextContents():[]};throw error;}finally{await context?.close();await rm(profile,{recursive:true,force:true});}
 }
 report.passed=true;
}finally{
 if(server)await new Promise(resolve=>server.httpServer.close(resolve));
 console.log(JSON.stringify(report));
}
