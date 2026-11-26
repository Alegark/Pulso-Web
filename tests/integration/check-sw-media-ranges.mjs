import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {build} from 'vite';

const tmp=resolve('.local/tmp');
await mkdir(tmp,{recursive:true});
const out=await mkdtemp(resolve(tmp,'review-playback-sw-'));
let server,browser;
try{
 await build({configFile:false,logLevel:'error',publicDir:false,define:{SHELL_FILES:JSON.stringify(['/','/index.html'])},build:{outDir:out,lib:{entry:'src/service-worker/sw.ts',formats:['es'],fileName:()=> 'sw.js'}},plugins:[{
  name:'testonly-sw-media-counters',enforce:'pre',transform(code,id){
   if(id.endsWith('/storage/database.ts'))return code.replace('req = indexedDB.open(DATABASE, 2);','req = indexedDB.open(DATABASE, 2); Reflect.set(globalThis,"testOpens",(Reflect.get(globalThis,"testOpens")??0)+1);');
   if(id.endsWith('/storage/asset-reader.ts'))return code.replace('const hash=integrity===true?sha256.create():null;', 'const hash=integrity===true?sha256.create():null; if(hash)Reflect.set(globalThis,"testHashes",(Reflect.get(globalThis,"testHashes")??0)+1);');
   if(id.endsWith('/service-worker/sw.ts'))return code+`
self.addEventListener('message',event=>{
 if(event.data==='test-close-database')event.waitUntil((async()=>{
  const connection=await openDatabase();connection.dispatchEvent(new Event('close'));
  event.ports[0].postMessage(true);
 })());
 if(event.data==='test-notification'){
  const {matchAll,openWindow}=self.clients;
  let closed=false,opened=null,work;
  self.clients.matchAll=async()=>[];self.clients.openWindow=async url=>{opened=new URL(url).pathname;};
  const click=Object.assign(new Event('notificationclick'),{notification:{data:{kind:'pulso-download',version:1,url:'/untrusted'},close(){closed=true;}},waitUntil(pending){work=pending;}});
  self.dispatchEvent(click);
  event.waitUntil(Promise.resolve(work).then(()=>event.ports[0].postMessage({closed,opened})).finally(()=>{
   self.clients.matchAll=matchAll;self.clients.openWindow=openWindow;
  }));
 }
 if(event.data==='test-client')event.ports[0].postMessage(event.source.id);
 if(event.data==='test-counters')event.ports[0].postMessage({opens:Reflect.get(globalThis,'testOpens')??0,hashes:Reflect.get(globalThis,'testHashes')??0});
});
`;
  }
 }]});
 const sw=await readFile(resolve(out,'sw.js'));
 server=createServer((req,res)=>{
  if(req.url==='/sw.js')res.writeHead(200,{'Content-Type':'text/javascript'}).end(sw);
  else res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Local SW media test</title>');
 });
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});
 for(const backend of ['idb','opfs']){
  const context=await browser.newContext();
  context.setDefaultTimeout(8000);
  try{
   const page=await context.newPage(),origin=`http://127.0.0.1:${server.address().port}`;
   await page.goto(origin);
   await page.evaluate(async backend=>{
    const data=Uint8Array.from({length:2*65536+11},(_,i)=>i%251);
    const id=crypto.randomUUID(),storageKey=crypto.randomUUID();
    const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
    const asset={id,storageKey,backend,sha256,bytes:data.length,mime:'audio/wav',state:'complete',namespace:'local',revision:1,chunkSize:65536,chunks:3,retention:'kept'};
    const db=await new Promise((resolve,reject)=>{
     const req=indexedDB.open('pulso-web-local-v1',2);
     req.onupgradeneeded=()=>{for(const name of ['assets','chunks','jobs','tickets','settings','tracks','playlists'])req.result.createObjectStore(name);};
     req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    const write=(stores,apply)=>new Promise((resolve,reject)=>{
     const tx=db.transaction(stores,'readwrite');apply(tx);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
    });
    const file=backend==='opfs'?await(await(await navigator.storage.getDirectory()).getDirectoryHandle('pulso-assets-v1',{create:true})).getFileHandle(storageKey,{create:true}):null;
    const writeFile=async bytes=>{const w=await file.createWritable();await w.write(bytes);await w.close();};
    await write(['assets','chunks'],tx=>{
     tx.objectStore('assets').put(asset,id);
     if(!file)for(let i=0;i<3;i++)tx.objectStore('chunks').put(data.slice(i*65536,(i+1)*65536),[storageKey,i]);
    });
    if(file)await writeFile(data);
    for(const name of ['pulso-shell-1111111111111111','pulso-shell-2222222222222222','media']){
     const cache=await caches.open(name);await cache.put('/index.html',new Response('<title>Previous shell</title>',{headers:{'Content-Type':'text/html'}}));
    }
    await caches.open('pulso-shell-3333333333333333'); // Failed install, empty cache.
    await navigator.serviceWorker.register('/sw.js',{type:'module'});
    if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
    const ownerProof='pulso-web:local:owner:'+crypto.randomUUID();
    await new Promise(resolve=>{
     void navigator.locks.request('pulso-web:local:playback',()=>navigator.locks.request(ownerProof,()=>new Promise(()=>resolve())));
    });
    const rpc=message=>new Promise((resolve,reject)=>{
     const channel=new MessageChannel();
     const timer=setTimeout(()=>{channel.port1.close();reject(Error('SW RPC timeout'));},5000);
     channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};
     navigator.serviceWorker.controller.postMessage(message,[channel.port2]);
    });
    const mint=async()=>{const tokens=[crypto.randomUUID()];const reply=await rpc({version:1,type:'pinned-local-sources',requestId:crypto.randomUUID(),ownerProof,expected:[asset],tokens});if(reply.status)throw Error(JSON.stringify(reply));return tokens[0];};
    const get=async(token,range,selection='')=>{const r=await fetch('/_pulso/media/'+token+selection,{headers:{Range:range}});const body=new Uint8Array(await r.arrayBuffer());return {status:r.status,length:body.length,first:body[0],last:body.at(-1),contentRange:r.headers.get('content-range')};};
    const corruptRevision=async(newRevision=true)=>{
     const bad=data.slice();bad[65536]^=255;if(newRevision)asset.revision++;
     if(file)await writeFile(bad);
     await write(['assets','chunks'],tx=>{
      tx.objectStore('assets').put(asset,id);
      if(!file)tx.objectStore('chunks').put(bad.slice(65536,2*65536),[storageKey,1]);
     });
    };
    const seedTickets=async deadOwner=>{
     const liveOwner=await rpc('test-client');
     await write('tickets',tx=>{
      const store=tx.objectStore('tickets'),ticket={owner:deadOwner,assetId:id,namespace:'local'};
      store.put({...ticket,version:2},'test-dead-v2');store.put(ticket,'test-dead-legacy');
      store.put({...ticket,version:2,owner:liveOwner},'test-live-v2');
     });
    };
    const ticketKeys=()=>new Promise((resolve,reject)=>{
     const req=db.transaction('tickets').objectStore('tickets').getAllKeys();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    const revalidate=()=>rpc({protocol:'pulso-idb-realm',version:1,type:'revalidate',requestId:crypto.randomUUID(),ownerProof});
    window.pulsoTest={mint,get,rpc,corruptRevision,seedTickets,ticketKeys,revalidate};
   },backend);
   assert.deepEqual(await page.evaluate(()=>caches.keys()),['pulso-shell-2222222222222222','media','pulso-shell-BUILD_ID']);
   const departed=await context.newPage();await departed.goto(origin);
   const deadOwner=await departed.evaluate(()=>new Promise(resolve=>{
    const channel=new MessageChannel();channel.port1.onmessage=event=>{channel.port1.close();resolve(event.data);};
    navigator.serviceWorker.controller.postMessage('test-client',[channel.port2]);
   }));
   const ownerToken=await page.evaluate(()=>window.pulsoTest.mint());
   const foreignStatus=await departed.evaluate(async token=>(await fetch('/_pulso/media/'+token)).status,ownerToken);
   assert.equal(foreignStatus,403);
   await page.evaluate(deadOwner=>window.pulsoTest.seedTickets(deadOwner),deadOwner);
   await departed.close();
   const result=await page.evaluate(async()=>{
    const {mint,get,rpc,corruptRevision,revalidate}=window.pulsoTest;
    const token=await mint(),before=await rpc('test-counters');
    const first=await get(token,'bytes=0-1'),afterFirst=await rpc('test-counters');
    const second=await get(token,'bytes=0-'),cross=await get(token,'bytes=65530-65545'),afterRanges=await rpc('test-counters');
    await rpc('test-close-database');
    const revoked=await get(token,'bytes=0-1'),retry=await revalidate(),beforeRetry=await rpc('test-counters');
    const recovered=await get(token,'bytes=0-1'),afterRetry=await rpc('test-counters');
    await corruptRevision(false);
    const badReselection=await get(token,'bytes=0-1','?selection='+crypto.randomUUID());
    await corruptRevision();
    const oldTicket=await get(token,'bytes=0-1'),bad=await get(await mint(),'bytes=0-1');
    return {before,first,afterFirst,second,cross,afterRanges,revoked,retry,beforeRetry,recovered,afterRetry,oldTicket,badReselection,bad,keys:await window.pulsoTest.ticketKeys()};
   });
   assert.deepEqual(result.first,{status:206,length:2,first:0,last:1,contentRange:'bytes 0-1/131083'});
   assert.equal(result.second.length,131083);
   assert.deepEqual(result.cross,{status:206,length:16,first:65530%251,last:65545%251,contentRange:'bytes 65530-65545/131083'});
   assert.equal(result.oldTicket.status,409);
   if(result.badReselection.status!==409)process.exitCode=1;
   assert.equal(result.bad.status,409,'the first read of a new revision verifies bytes outside the requested range');
   assert.deepEqual(result.afterFirst,{opens:result.before.opens+1,hashes:result.before.hashes+1});
   assert.deepEqual(result.afterRanges,{opens:result.afterFirst.opens+2,hashes:result.afterFirst.hashes});
   assert.equal(result.revoked.status,503);assert.equal(result.retry.state,'ready');
   assert.deepEqual(result.recovered,result.first);
   assert.deepEqual(result.afterRetry,{opens:result.beforeRetry.opens+1,hashes:result.beforeRetry.hashes+1});
   assert.deepEqual(result.keys.filter(key=>key.startsWith('test-')),['test-dead-legacy','test-live-v2']);
   const notification=await page.evaluate(()=>window.pulsoTest.rpc('test-notification'));
   assert.deepEqual(notification,{closed:true,opened:'/'});
   await context.setOffline(true);
   const offline=await page.goto(origin+notification.opened);
   assert.ok(offline?.ok()&&offline.fromServiceWorker());
   assert.equal(await page.title(),'Local SW media test');
   console.log(JSON.stringify({backend,passed:result.badReselection.status===409,reads:3,hashes:1,opens:3,foreignStatus,oldTicket:409,firstReadOfCorruptRevision:409,
    sameRevisionReselection:result.badReselection.status,orphanV2Pruned:true,obsoleteShellPruned:true,newHashAfterReadmission:true,notification,offlineRoot:true}));
  }finally{await context.close();}
 }
}finally{
 try{await browser?.close();if(server?.listening)await new Promise(done=>server.close(done));}
 finally{await rm(out,{recursive:true,force:true});}
}
