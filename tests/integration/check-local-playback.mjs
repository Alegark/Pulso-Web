import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {loadavg} from 'node:os';
import {mkdir,rm,statfs,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,webkit} from 'playwright-core';
import {preview} from 'vite';
import {benchmarkBytes,benchmarkPart} from './playlist-benchmark-audio.mjs';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';
import {createTestWorkspace} from './test-workspace.mjs';

const mode=process.env.PULSO_T27_MODE??'integrity';
const engines=(process.env.PULSO_T27_ENGINES??'chromium,webkit').split(',');
const backends=(process.env.PULSO_T27_BACKENDS??'idb,opfs').split(',');
const filter=process.env.PULSO_T27_CASE;
const versions=Object.fromEntries(process.argv.slice(2).map(argument=>{
 const split=argument.indexOf('=');
 return [argument.slice(0,split),resolve(argument.slice(split+1))];
}));
assert.ok(Object.keys(versions).length,'Pass label=path for each production build');
assert.ok(['integrity','timing'].includes(mode));
const runs=Number(process.env.PULSO_T27_RUNS??3);
assert.ok(Number.isInteger(runs)&&runs>=1);
const workspace=await createTestWorkspace('t27-local-playback');
const report={mode,runs,cases:[],loads:[]};
const accountId='11111111-1111-4111-8111-111111111111';
const shortBytes=3*65536;
const title=index=>`T27 pista ${String(index+1).padStart(2,'0')}`;
const fileWorker=`
onmessage=async({data:{key,bytes}})=>{
 try{
  const root=await navigator.storage.getDirectory();
  const directory=await root.getDirectoryHandle('pulso-assets-v1',{create:true});
  const file=await directory.getFileHandle(key,{create:true});
  if(typeof file.createWritable==='function'){
   const writer=await file.createWritable();await writer.write(bytes);await writer.close();
  }else{
   const writer=await file.createSyncAccessHandle();
   try{writer.truncate(0);if(writer.write(bytes,{at:0})!==bytes.length)throw Error('short OPFS write');writer.flush();}
   finally{writer.close();}
  }
  postMessage({ok:true});
 }catch(error){postMessage({ok:false,error:String(error)});}
};
`;
function serveFixture(req,res,next){
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/__t27/seed'){
  res.writeHead(200,{'Content-Type':'text/html'}).end('<title>T27</title>');return;
 }
 if(url.pathname==='/__t27/file-worker.js'){
  res.writeHead(200,{'Content-Type':'text/javascript'}).end(fileWorker);return;
 }
 if(url.pathname==='/__t27/audio'){
  const index=Number(url.searchParams.get('index'));
  const size=url.searchParams.get('short')==='1'?shortBytes:benchmarkBytes;
  const bytes=benchmarkPart(index+1,0,size);
  bytes[bytes.length-1]=index+1;
  res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':bytes.length}).end(bytes);return;
 }
 next();
}
async function waitForLoad(key){
 for(;;){
  const value=loadavg()[0];
  if(value<1.5){
   const uptime=execFileSync('uptime',{encoding:'utf8'}).trim();
   if(loadavg()[0]>=1.5)continue;
   report.loads.push({key,value,uptime});
   console.log(JSON.stringify(report.loads.at(-1)));
   return;
  }
  await delay(5000);
 }
}
async function setup(page,n,backend,short,playlistSize){
 await page.evaluate(async({n,backend,short,accountId,playlistSize})=>{
  const request=q=>new Promise((yes,no)=>{q.onsuccess=()=>yes(q.result);q.onerror=()=>no(q.error);});
  const open=indexedDB.open('pulso-web-local-v1',2);
  open.onupgradeneeded=()=>{
   for(const name of ['assets','chunks','jobs','tickets','settings','tracks','playlists'])open.result.createObjectStore(name);
  };
  const db=await request(open);
  const worker=backend==='opfs'?new Worker('/__t27/file-worker.js'):null;
  const write=(stores,apply)=>new Promise((yes,no)=>{
   const tx=db.transaction(stores,'readwrite');tx.oncomplete=yes;tx.onabort=()=>no(tx.error);apply(tx);
  });
  const writeFile=async(key,bytes)=>new Promise((yes,no)=>{
   worker.onmessage=({data})=>data.ok?yes():no(Error(data.error));worker.onerror=no;
   worker.postMessage({key,bytes},[bytes.buffer]);
  });
  const audio=async index=>new Uint8Array(await(await fetch(`/__t27/audio?index=${index}&short=${Number(short)}`)).arrayBuffer());
  const rows=[];
  try{
   for(let i=0;i<n;i++){
    const bytes=await audio(i),length=bytes.length;
    const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
    const asset={id:crypto.randomUUID(),storageKey:crypto.randomUUID(),backend,sha256,bytes:length,
     mime:'audio/mpeg',state:'complete',namespace:'local',revision:1,chunkSize:65536,chunks:Math.ceil(length/65536),retention:'kept'};
    const track={id:crypto.randomUUID(),assetId:asset.id,accountId,audioFingerprint:{algorithm:'sha256',sha256,bytes:length},
     title:`T27 pista ${String(i+1).padStart(2,'0')}`,artist:'Prueba sintética',album:null,duration:length/16000,
     favorite:false,revision:1,createdAt:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString(),manualOverrides:{}};
    if(worker)await writeFile(asset.storageKey,bytes);
    await write(['assets','chunks','tracks'],tx=>{
     tx.objectStore('assets').put(asset,asset.id);
     tx.objectStore('tracks').put(track,track.id);
     if(!worker)for(let chunk=0;chunk<asset.chunks;chunk++)
      tx.objectStore('chunks').put(bytes.slice(chunk*65536,(chunk+1)*65536),[asset.storageKey,chunk]);
    });
    rows.push({track,asset});
   }
   await write('playlists',tx=>{
    for(let offset=0;offset<n;offset+=playlistSize){
     const id=crypto.randomUUID(),name='T27 playlist '+(1+offset/playlistSize);
     const entries=rows.slice(offset,offset+playlistSize).map(({track})=>({id:crypto.randomUUID(),trackId:track.id}));
     tx.objectStore('playlists').put({id,name,revision:1,accountId,entries},id);
    }
   });
   sessionStorage.setItem('t27-fixture',JSON.stringify(rows));
  }finally{worker?.terminate();db.close();}
 },{n,backend,short,accountId,playlistSize});
}
async function corrupt(page,index,kind){
 await page.evaluate(async({index,kind})=>{
  const {asset}=JSON.parse(sessionStorage.getItem('t27-fixture'))[index];
  const request=q=>new Promise((yes,no)=>{q.onsuccess=()=>yes(q.result);q.onerror=()=>no(q.error);});
  const db=await request(indexedDB.open('pulso-web-local-v1'));
  const put=(store,key,value)=>new Promise((yes,no)=>{
   const tx=db.transaction(store,'readwrite');tx.oncomplete=yes;tx.onabort=()=>no(tx.error);
   tx.objectStore(store).put(value,key);
  });
  try{
   if(kind==='hash'){
    await put('assets',asset.id,{...asset,sha256:'0'.repeat(64)});return;
   }
   const bytes=new Uint8Array(await(await fetch(`/__t27/audio?index=${index}&short=1`)).arrayBuffer());
   const changed=kind==='truncated'?bytes.slice(0,-1):bytes;
   if(kind==='byte')changed[changed.length-4]^=1;
   if(asset.backend==='idb')await put('chunks',[asset.storageKey,asset.chunks-1],changed.slice((asset.chunks-1)*65536));
   else{
    const worker=new Worker('/__t27/file-worker.js');
    try{await new Promise((yes,no)=>{
     worker.onmessage=({data})=>data.ok?yes():no(Error(data.error));worker.onerror=no;
     worker.postMessage({key:asset.storageKey,bytes:changed},[changed.buffer]);
    });}finally{worker.terminate();}
   }
  }finally{db.close();}
 },{index,kind});
}
function installProbe(){
 const probe=window.t27={started:null,loads:[],playing:[],reads:{idb:0,blobBytes:0},actions:{}};
 const NativeAudio=window.Audio;
 window.Audio=class extends NativeAudio{
  constructor(...args){
   super(...args);probe.audio=this;
   this.addEventListener('playing',()=>{
    if(probe.started===null)return;
    probe.playing.push({ms:performance.now()-probe.started,loads:[...probe.loads],reads:{...probe.reads},
     url:this.currentSrc,title:document.querySelector('.collection-track-main[aria-current="true"] strong')?.textContent});
   });
  }
  load(){
   if(probe.started!==null)probe.loads.push(this.getAttribute('src'));
   return super.load();
  }
 };
 for(const method of ['get','getAll']){
  const get=IDBObjectStore.prototype[method];
  IDBObjectStore.prototype[method]=function(...args){
   if(probe.started!==null&&this.name==='chunks')probe.reads.idb++;
   return get.apply(this,args);
  };
 }
 const arrayBuffer=Blob.prototype.arrayBuffer;
 Blob.prototype.arrayBuffer=function(...args){
  if(probe.started!==null)probe.reads.blobBytes+=this.size;
  return arrayBuffer.apply(this,args);
 };
 if(navigator.mediaSession){
  const setHandler=MediaSession.prototype.setActionHandler;
  MediaSession.prototype.setActionHandler=function(action,handler){
   probe.actions[action]=handler;return setHandler.call(this,action,handler);
  };
 }
 addEventListener('click',event=>{
  if(event.target.closest('.collection-track-main')&&probe.started===null)probe.started=performance.now();
 },{capture:true});
}
const trackButton=(page,index)=>page.getByRole('button',{name:`Escuchar ${title(index)}`,exact:true});
const waitPlaying=(page,count=1,timeout=30000)=>page.waitForFunction(n=>window.t27.playing.length>=n,count,{timeout});
const playing=page=>page.evaluate(()=>window.t27.playing);
async function nextTrack(page){
 if(await page.evaluate(()=>{
  if(!window.t27.actions.nexttrack)return false;
  window.t27.actions.nexttrack();return true;
 }))return 'media-session';
 await page.getByRole('button',{name:'Abrir reproductor desde minirreproductor'}).click();
 await page.getByRole('button',{name:'Siguiente canción'}).click();
 await page.getByRole('button',{name:'Cerrar reproductor'}).click();
 return 'player';
}
async function openPlaylist(page,group,lastIndex){
 await page.getByRole('navigation',{name:'Principal',exact:true}).getByRole('button',{name:'Biblioteca',exact:true}).click();
 await page.getByRole('button',{name:'Playlists',exact:true}).click();
 await page.locator('.library-grid').getByRole('button',{name:new RegExp(`^T27 playlist ${group+1}\\b`)}).click();
 await trackButton(page,lastIndex).waitFor();
}

async function withPage(engine,origin,n,backend,short,run,playlistSize=n){
 const free=await statfs('/data');
 assert.ok(free.bavail*free.bsize>=2*1024**3,'Menos de 2 GiB libres en /data');
 const launch={headless:true,proxy:{server:'http://127.0.0.1:9',bypass:'127.0.0.1,localhost'},viewport:{width:390,height:844}};
 const profile=resolve(workspace.dir,'profile');
 await mkdir(profile);
 let context;
 try{
  const chromiumOptions={executablePath:'/usr/bin/chromium',chromiumSandbox:true};
  context=await ({chromium,webkit})[engine].launchPersistentContext(profile,engine==='chromium'?{...launch,...chromiumOptions}:launch);
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await installRequiredAccountFixture(context,origin);
  await context.addInitScript(installProbe);
  const page=context.pages()[0];
  page.setDefaultTimeout(45000);
  await page.goto(origin+'/__t27/seed',{waitUntil:'domcontentloaded'});
  await page.evaluate(async id=>{
   localStorage.setItem('pulso:setup:v1:'+id,'complete');
   const db=await new Promise((yes,no)=>{
    const q=indexedDB.open('pulso-web-telegram-session-v1',1);
    q.onupgradeneeded=()=>q.result.createObjectStore('authorization');
    q.onsuccess=()=>yes(q.result);q.onerror=()=>no(q.error);
   });
   try{await new Promise((yes,no)=>{
    const tx=db.transaction('authorization','readwrite');
    tx.oncomplete=yes;tx.onabort=()=>no(tx.error);
    const store=tx.objectStore('authorization');
    store.put('TESTONLY_OFFLINE_SETUP','session');store.put(crypto.randomUUID(),'epoch');
   });}finally{db.close();}
  },accountId);
  await setup(page,n,backend,short,playlistSize);
  try{
   await page.goto(origin,{waitUntil:'domcontentloaded'});
   await page.locator('.shell-nav').waitFor();
   await page.waitForFunction(async()=>(await navigator.locks.query()).held.some(lock=>lock.name==='pulso-web:local:playback'));
   await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  }catch(error){
   const screen=await page.locator('body').innerText({timeout:3000}).catch(()=>null);
   throw new Error(String(error)+' Pantalla: '+screen?.slice(0,400));
  }
  await run(page,context);
 }finally{try{await context?.close();}finally{await rm(profile,{recursive:true,force:true});}}
}
function summary(samples){
 const values=samples.map(sample=>sample.ms).sort((a,b)=>a-b);
 if(!values.length)return {median:null,min:null,max:null};
 const mid=Math.floor(values.length/2);
 return {median:values.length%2?values[mid]:(values[mid-1]+values[mid])/2,min:values[0],max:values.at(-1)};
}
const matches=name=>!filter||Object.values(name).join(':').includes(filter);
async function runCase(name,fn){
 if(!matches(name))return;
 try{report.cases.push({...name,...await fn(),passed:true});}
 catch(error){report.cases.push({...name,passed:false,error:String(error.message).slice(0,1500)});}
 console.log(JSON.stringify(report.cases.at(-1)));
}
try{
 for(const [version,outDir] of Object.entries(versions)){
  const server=await preview({configFile:false,build:{outDir},preview:{host:'127.0.0.1',port:0},plugins:[{
   name:'t27-local-fixtures',configurePreviewServer(server){server.middlewares.use(serveFixture);}
  }]});
  try{
   const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
   for(const engine of engines)for(const backend of backends){
    if(mode==='timing'){
     await runCase({version,engine,backend,case:'cold-start'},async()=>{
      const samples={single:[],playlist:[]};
      await waitForLoad({version,engine,backend});
      for(const [label,n] of [['single',1],['playlist',30]])for(let i=0;i<runs;i++){
       await withPage(engine,origin,n,backend,false,async page=>{
        const start=n===1?0:14;
        await openPlaylist(page,0,n-1);
        await trackButton(page,start).click();
        try{await waitPlaying(page);}catch{samples[label].push({timeout:true});return;}
        const [event]=await playing(page);
        assert.equal(event.title,title(start));
        assert.match(event.url,/\/_pulso\/media\//);
        samples[label].push({...event,url:undefined});
       });
      }
      const stats=Object.fromEntries(Object.entries(samples).map(([key,values])=>[key,summary(values.filter(sample=>!sample.timeout))]));
      const comparable=stats.single.median!==null&&samples.playlist.every(sample=>!sample.timeout&&sample.loads.length===1)&&stats.playlist.median<=2*stats.single.median;
      const noMainAudioReads=Object.values(samples).flat().every(sample=>!sample.timeout&&sample.reads.idb===0&&sample.reads.blobBytes===0);
      return {samples,stats,comparable,noMainAudioReads};
     });
     continue;
    }
    const prefix={version,engine,backend};
    const scenarios=[
     ...[0,1].flatMap(start=>['byte','truncated','hash'].map(fault=>({...prefix,case:'skip-corrupt',start,fault}))),
     {...prefix,case:'selected-offline-next'},
    ].filter(matches);
    if(!scenarios.length)continue;
    try{
     await withPage(engine,origin,scenarios.length*3,backend,true,async(page,context)=>{
      for(const [group,scenario] of scenarios.entries())await runCase(scenario,async()=>{
       const index=group*3;
       await openPlaylist(page,group,index+2);
       await page.evaluate(()=>{
        const probe=window.t27;
        probe.audio.pause();
        Object.assign(probe,{started:null,loads:[],playing:[],reads:{idb:0,blobBytes:0}});
       });
       if(scenario.case==='selected-offline-next'){
        await context.setOffline(true);
        await trackButton(page,index+1).click();
        await waitPlaying(page,1,12000);
        const [first]=await playing(page);
        assert.equal(first.title,title(index+1));
        assert.equal(first.loads.length,1);
        assert.deepEqual(first.reads,{idb:0,blobBytes:0});
        const nextControl=await nextTrack(page);
        await waitPlaying(page,2,12000);
        const observed=(await playing(page)).map(event=>event.title);
        assert.deepEqual(observed,[title(index+1),title(index+2)]);
        return {observed,nextControl};
       }
       const {start,fault}=scenario;
       if(start===0)await corrupt(page,index,fault);
       await trackButton(page,index).click();
       if(start===1){
        await waitPlaying(page,1,12000);
        await corrupt(page,index+start,fault);
        await nextTrack(page);
       }
       await waitPlaying(page,start+1,12000);
       const observed=(await playing(page)).map(event=>event.title);
       assert.deepEqual(observed,start===0?[title(index+1)]:[title(index),title(index+2)]);
       return {observed};
      });
     },3);
    }catch(error){
     const result={...prefix,case:'profile-setup',passed:false,error:String(error.message).slice(0,1500)};
     report.cases.push(result);
     console.log(JSON.stringify(result));
    }
   }
  }finally{await new Promise(done=>server.httpServer.close(done));}
 }
}finally{
 if(mode==='timing'&&versions.v62&&versions.head){
  report.comparison=engines.flatMap(engine=>backends.map(backend=>{
   const result=version=>report.cases.find(item=>item.engine===engine&&item.backend===backend&&item.version===version);
   const before=result('v62')?.stats?.single?.median,after=result('head')?.stats?.single?.median;
   const decrease=before&&after?1-after/before:null;
   const head=result('head');
   return {engine,backend,decrease,p01:decrease!==null&&decrease>=.5,p02:!!head?.comparable,p05:!!head?.noMainAudioReads};
  }));
 }
 report.cleanup=await workspace.cleanup();
 await writeFile(resolve(workspace.evidence,'summary.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({report:resolve(workspace.evidence,'summary.json'),comparison:report.comparison}));
}
if(report.cases.some(result=>!result.passed)||report.comparison?.some(result=>!result.p01||!result.p02||!result.p05))process.exitCode=1;
