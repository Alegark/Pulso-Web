// U-V68-01 and the Inicio artwork preload portion of U-V68-04.
import {build,preview} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createTestWorkspace} from './test-workspace.mjs';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';

const ws=await createTestWorkspace('v68-continuous-album');let server;const cases=[];
try{
 await writeFile(`${ws.dir}/seed.html`,'<script type="module" src="/tests/integration/v68-continuous-fixture.ts"></script>');
 await build({configFile:false,plugins:[tailwindcss()],logLevel:'error',build:{outDir:`${ws.dir}/bundle`,rolldownOptions:{input:{main:'index.html',seed:`${ws.dir}/seed.html`}}}});
 server=await preview({configFile:false,build:{outDir:`${ws.dir}/bundle`},preview:{host:'127.0.0.1',port:0}});
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await launcher.launch(engine==='chromium'?{headless:true,executablePath:'/usr/bin/chromium'}:{headless:true});
  try{for(const entry of ['Inicio','Biblioteca','offline']){
   const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
   try{
    await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin||['blob:','data:'].includes(u.protocol))return r.continue();
     if(u.hostname==='itunes.apple.com'&&entry!=='offline'){
      const album={wrapperType:'collection',collectionType:'Album',collectionId:201,collectionName:'Álbum sintético',artistName:'Artista sintético',trackCount:3};
      const tracks=[0,1,2].map(i=>({wrapperType:'track',kind:'song',collectionId:201,collectionName:'Álbum sintético',artistName:'Artista sintético',trackId:301+i,discNumber:1,discCount:1,trackNumber:i+1,trackCount:3,trackName:`Sintética ${i}`,trackTimeMillis:30000}));
      const rows=u.pathname==='/lookup'?[album,...tracks]:[];return r.fulfill({json:{resultCount:rows.length,results:rows},headers:{'access-control-allow-origin':'*'}});
     }return r.abort();});
    await installRequiredAccountFixture(context,origin);await context.addInitScript(()=>{delete Navigator.prototype.serviceWorker;});
    const page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(`${origin}/${ws.dir}/seed.html`);await page.waitForFunction(()=>!!window.setupV68SyncedAlbum);await page.evaluate(()=>window.setupV68SyncedAlbum());await page.goto(origin);
    if(entry!=='Inicio')await page.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();
    const card=page.locator(entry==='Inicio'?'.home-albums button':'.library-grid button').filter({hasText:'Álbum sintético'});await card.click();
    assert.equal(await page.getByRole('button',{name:'Ver álbum completo'}).count(),0);
    if(entry==='offline'){await page.getByRole('button',{name:'Ver pistas locales'}).click();await page.getByText('Sintética 0',{exact:true}).first().waitFor();}
    else{await page.locator('.album-page').waitFor();await page.locator('.album-page').getByRole('button',{name:'Opciones del álbum'}).click();await page.getByRole('button',{name:'Retirar álbum',exact:true}).waitFor();}
    cases.push(`${engine}: ${entry}`);
   }finally{await context.close();}
  }
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
  try{
   let remoteRequests=0;
   await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin||['blob:','data:'].includes(u.protocol))return r.continue();remoteRequests++;return r.abort();});
   await installRequiredAccountFixture(context,origin);
   const page=await context.newPage();page.setDefaultTimeout(15000);
   await page.goto(`${origin}/${ws.dir}/seed.html`);await page.waitForFunction(()=>!!window.setupV68SyncedAlbum);
   await page.evaluate(async()=>{await window.setupV68SyncedAlbum();await window.seedV68Artwork();});
   await page.addInitScript(()=>{
    Object.defineProperty(Navigator.prototype,'onLine',{get:()=>false,configurable:true});
    delete Navigator.prototype.serviceWorker;
    const get=IDBObjectStore.prototype.get;const transactions=new WeakMap();window.v68ArtworkReads=[];
    IDBObjectStore.prototype.get=function(...args){
     const request=get.apply(this,args);
     if(this.transaction.db.name==='pulso-web-cache-v1'&&this.name==='artwork'&&this.transaction.mode==='readonly'){
      let entry=transactions.get(this.transaction);if(!entry){entry={keys:[],hits:0};transactions.set(this.transaction,entry);window.v68ArtworkReads.push(entry);}
      entry.keys.push(args[0]);request.addEventListener('success',()=>{if(request.result)entry.hits++;});
     }
     return request;
    };
   });
   await page.goto(origin);await page.locator('.home-albums button').filter({hasText:'Álbum sintético'}).waitFor();
   await page.waitForFunction(()=>window.v68ArtworkReads.some(x=>x.hits>0));
   assert.equal(await page.locator('.shell-nav').getByRole('button',{name:'Inicio',exact:true}).getAttribute('aria-current'),'page');
   const reads=await page.evaluate(()=>window.v68ArtworkReads.filter(x=>x.hits>0));
   assert.ok(reads.some(x=>x.keys.length>1),'la precarga debe agrupar lecturas en una transacción');
   assert.equal(remoteRequests,0);cases.push(`${engine}: U-V68-04 Inicio offline`);
  }finally{await context.close();}

  for(const scenario of ["02a","02a-album-cache","02b-next","02b-pause","02c-rate","02c-preempt","02c-album-preempt"]){
   console.log("RUN",engine,scenario);const context=await browser.newContext({serviceWorkers:"block",viewport:{width:1200,height:844}});
   try{
    await context.route("**/*",r=>{const u=new URL(r.request().url());if(u.origin===origin||["blob:","data:"].includes(u.protocol))return r.continue();if(u.hostname==='itunes.apple.com'){
     const album={wrapperType:'collection',collectionType:'Album',collectionId:901,collectionName:'Álbum remoto',artistName:'Artista remoto',trackCount:2};
     const tracks=[0,1].map(i=>({wrapperType:'track',kind:'song',collectionId:901,collectionName:'Álbum remoto',artistName:'Artista remoto',trackId:911+i,discNumber:1,discCount:1,trackNumber:i+1,trackCount:2,trackName:`Remota ${i}`,trackTimeMillis:2000}));
     const rows=u.pathname==='/lookup'?[album,...tracks]:u.searchParams.get('entity')==='album'?[album]:tracks;return r.fulfill({json:{resultCount:rows.length,results:rows},headers:{'access-control-allow-origin':'*'}});
    }return r.abort();});
    await installRequiredAccountFixture(context,origin);
    const page=await context.newPage();page.setDefaultTimeout(15000);
    await page.goto(`${origin}/${ws.dir}/seed.html`);await page.waitForFunction(()=>!!window.seedV68ContinuousPlaylist);await page.evaluate(()=>window.seedV68ContinuousPlaylist());
    await page.addInitScript(({scenario})=>{
     delete Navigator.prototype.serviceWorker;
     window.v68Membership=title=>new Promise((resolve,reject)=>{const open=indexedDB.open('pulso-web-local-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['tracks','settings'],'readonly'),request=tx.objectStore('tracks').getAll();request.onsuccess=()=>{const track=request.result.find(row=>row.catalogChoice?.title===title||row.title===title);if(!track){resolve(null);return;}const membership=tx.objectStore('settings').get(['library-membership',1,track.id]);membership.onsuccess=()=>resolve(membership.result??null);};tx.oncomplete=()=>db.close();tx.onabort=()=>reject(tx.error);};});
     const native=window.Worker, log=window.__v68Log={search:[],download:[],cancel:[],active:0,max:0,events:[]};
     window.__v68HoldDownload=scenario.includes("next")||scenario.includes("pause")||scenario==="02c-preempt";
     window.__v68BotMode=scenario.includes("rate")?"rate-limit":"normal";
     const bytes=new Uint8Array(32044),v=new DataView(bytes.buffer);const put=(s,p)=>[...s].forEach((c,i)=>bytes[p+i]=c.charCodeAt(0));
     put("RIFF",0);v.setUint32(4,bytes.length-8,true);put("WAVEfmt ",8);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);put("data",36);v.setUint32(40,bytes.length-44,true);bytes[100]=7;
     const envelope=m=>Object.fromEntries(["protocol","version","sessionId","accountRef","accountEpoch","providerRevision","queryId","requestId"].map(k=>[k,m[k]]));
     window.Worker=class{
      constructor(url,options){if(!String(url).includes("session.worker-"))return new native(url,options);this.pending=null;}
      postMessage(m){
       const send=(command,extra,retryAt=null)=>queueMicrotask(()=>this.onmessage?.({data:{protocol:"pulso-bot-search",version:1,reply:{...envelope(command),...extra},sessionClosed:false,retryAt,retryBlocked:false}}));
       if(m.type==="restore"){log.restored=true;queueMicrotask(()=>this.onmessage?.({data:{version:2,session:m.session,request:m.request,phase:"connected",error:null,retryAt:null,delivery:null,binding:{accountRef:crypto.randomUUID(),accountEpoch:1},saved:{peerRef:crypto.randomUUID(),kind:"saved",name:"Mensajes guardados"},bots:[{providerRef:crypto.randomUUID(),username:"ivkmbot",label:"Bot sintético",status:"verified-profile",compatibility:"unverified"}]}}));}
       else if(m.type==="bot-search.search"){log.search.push({queryId:m.queryId,target:m.target});log.active++;log.max=Math.max(log.max,log.active);
        if(window.__v68BotMode==="rate-limit"){log.active--;const retryAt=Date.now()+60000;send(m,{type:"bot-search.error",error:"rate-limit",delivery:"acknowledged",retryAt,retryBlocked:false},retryAt);}
        else send(m,{type:"bot-search.result",delivery:"acknowledged",rows:[{rowRef:crypto.randomUUID(),kind:"audio",title:m.target.title,performer:m.target.artist,durationSeconds:Math.round(m.target.durationSeconds||2),mimeType:"audio/wav",bytes:bytes.length,correlation:"reply"}],expiresAt:Date.now()+60000,expectedTarget:m.target});
       }else if(m.type==="bot-search.download"){
        log.download.push(m.target);let cancelled=false;this.pending={m,cancel:()=>{cancelled=true;}};
        window.__v68ReleaseDownload=async()=>{if(cancelled)return;const audioBytes=bytes.slice();audioBytes[101]=m.target.title.endsWith('1')?1:2;const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',audioBytes)),x=>x.toString(16).padStart(2,'0')).join('');if(cancelled)return;this.pending=null;log.active--;send(m,{type:"bot-search.downloaded",audio:{blob:new Blob([audioBytes],{type:"audio/wav"}),bytes:audioBytes.length,mime:"audio/wav",sha256,target:m.target}});};
        if(!window.__v68HoldDownload&&!(scenario==='02c-album-preempt'&&log.download.length===2))void window.__v68ReleaseDownload();
       }else if(m.type==="bot-search.cancel"){log.cancel.push(m.targetRequestId);if(this.pending){const original=this.pending.m;this.pending.cancel();this.pending=null;log.active--;send(original,{type:"bot-search.error",error:"cancelled",delivery:"acknowledged",retryAt:null,retryBlocked:false});}send(m,{type:"bot-search.cancelled",targetRequestId:m.targetRequestId});}
      }
      terminate(){}
     };
     const NativeAudio=window.Audio;window.Audio=function(...args){const audio=new NativeAudio(...args);window.__v68Audio=audio;for(const type of ["play","pause","playing","ended"])audio.addEventListener(type,()=>log.events.push(type));return audio;};
    },{scenario});
    await page.goto(origin);
    if(scenario==='02a-album-cache'||scenario==='02c-album-preempt'){
     await page.waitForFunction(()=>window.__v68Log.restored);await page.locator('.shell-nav').getByRole('button',{name:'Buscar',exact:true}).click();await page.locator('.music-search input[type=search]').fill('Álbum remoto');await page.locator('.music-search-catalog [data-catalog-kind=album]').filter({hasText:'Álbum remoto'}).first().click();
     await page.locator('.album-track-main').filter({hasText:'Remota 0'}).click();await page.locator('.album-track-main').filter({hasText:'Remota 0'}).getByLabel('Reproduciendo').waitFor();
     await page.evaluate(()=>{const a=window.__v68Audio;a.currentTime=a.duration*0.7;a.dispatchEvent(new Event('timeupdate'));});
     if(scenario==='02c-album-preempt'){
      await page.waitForFunction(()=>window.__v68Log.download.length===2);await page.locator('.album-track-main').filter({hasText:'Remota 1'}).click();await page.waitForFunction(()=>window.__v68Log.cancel.length===1&&window.__v68Log.download.length===3);await page.locator('.mini-player').getByText('Remota 1',{exact:true}).waitFor();await page.waitForFunction(()=>window.__v68Log.events.filter(e=>e==='playing').length>=2);assert.ok(await page.evaluate(()=>window.__v68Log.max<=1));assert.equal(await page.locator('.album-track-error').count(),0);assert.equal(await page.getByText('Conecta Telegram para conseguir esta canción.',{exact:false}).count(),0);cases.push(`${engine}: U-V68-${scenario}`);continue;
     }
     await page.waitForFunction(()=>window.__v68Log.download.length===2&&window.__v68Log.active===0);await page.locator('.album-tracks li').filter({hasText:'Remota 1'}).locator('svg').first().waitFor();
     assert.equal(await page.evaluate(()=>window.__v68Log.events.includes('pause')),false);const membership=await page.evaluate(async()=>{for(let i=0;i<100;i++){const value=await window.v68Membership('Remota 1');if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}return null;});assert.equal(membership?.added,false);
     await page.evaluate(()=>{const a=window.__v68Audio;a.currentTime=a.duration;a.dispatchEvent(new Event('ended'));});await page.locator('.mini-player').getByText('Remota 1',{exact:true}).waitFor();await page.waitForFunction(()=>window.__v68Log.events.filter(e=>e==='playing').length>=2);cases.push(`${engine}: U-V68-${scenario}`);continue;
    }
    await page.locator(".home-playlists button").filter({hasText:"Continuidad sintética"}).click();
    await page.waitForFunction(()=>window.__v68Log.restored);await page.waitForTimeout(1500);await page.getByRole("button",{name:"Escuchar Sintética 0"}).click();
    await page.waitForFunction(()=>window.__v68Log.events.includes("playing"));
    await page.waitForFunction(()=>window.__v68Log.restored);await page.waitForTimeout(500);await page.evaluate(()=>{window.__v68Audio.currentTime=window.__v68Audio.duration*0.7;window.__v68Audio.dispatchEvent(new Event("timeupdate"));});await page.waitForFunction(()=>window.__v68Log.search.length===1).catch(async e=>{console.error(await page.evaluate(()=>({log:window.__v68Log,paused:window.__v68Audio.paused,time:window.__v68Audio.currentTime,body:document.body.innerText.slice(-500)})));throw e;});
    if(scenario==="02a"){
     await page.waitForFunction(()=>window.__v68Log.download.length===1&&window.__v68Log.active===0);
     await page.locator(".collection-track-main").filter({hasText:"Sintética 1"}).locator(".collection-track-download").waitFor();await page.waitForTimeout(500);const before=await page.evaluate(()=>window.__v68Log.events.slice());
     assert.equal(before.filter(x=>x==="pause").length,0);assert.equal(before.filter(x=>x==="play").length,1);
     await page.evaluate(()=>{const a=window.__v68Audio;a.currentTime=a.duration;a.dispatchEvent(new Event("ended"));});
     await page.waitForFunction(()=>document.querySelector(".collection-track-main[aria-current=true]")?.getAttribute("aria-label")==="Escuchar Sintética 1").catch(async e=>{console.error(await page.evaluate(()=>({log:window.__v68Log,current:document.querySelector(".collection-track-main[aria-current=true]")?.getAttribute("aria-label"),body:document.body.innerText.slice(-1200)})));throw e;});
     assert.equal(await page.evaluate(()=>window.__v68Log.search.length),1);
    }else if(scenario==="02b-next"||scenario==="02b-pause"){
     await page.waitForFunction(()=>window.__v68Log.download.length===1);const next=page.getByRole("button",{name:"Siguiente",exact:true});assert.equal(await next.isEnabled(),true);await next.click();await page.getByText("Preparando siguiente canción…").first().waitFor({state:"attached"}).catch(async e=>{console.error(await page.evaluate(()=>({log:window.__v68Log,body:document.body.innerText.slice(-1800)})));throw e;});
     if(scenario==="02b-pause")await page.getByRole("button",{name:"Pausar desde minirreproductor"}).click();
     await page.evaluate(()=>window.__v68ReleaseDownload());
     if(scenario==="02b-next")await page.waitForFunction(()=>document.querySelector(".collection-track-main[aria-current=true]")?.getAttribute("aria-label")==="Escuchar Sintética 1").catch(async e=>{console.error(await page.evaluate(()=>({log:window.__v68Log,current:document.querySelector(".collection-track-main[aria-current=true]")?.getAttribute("aria-label"),body:document.body.innerText.slice(-1200)})));throw e;});
     else{await page.waitForTimeout(500);assert.notEqual(await page.locator(".collection-track-main[aria-current=true]").getAttribute("aria-label"),"Escuchar Sintética 1");}
    }else if(scenario==="02c-rate"){
     for(let i=0;i<4;i++)await page.evaluate(()=>window.__v68Audio.dispatchEvent(new Event("timeupdate")));
     await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.__v68Log.search.length),1);assert.equal(await page.evaluate(()=>window.__v68Audio.paused),false);
    }else{
     await page.waitForFunction(()=>window.__v68Log.download.length===1);await page.getByRole("button",{name:"Escuchar Sintética 1"}).click();await page.waitForFunction(()=>window.__v68Log.cancel.length===1);assert.ok(await page.evaluate(()=>window.__v68Log.max<=1));
    }
    cases.push(`${engine}: U-V68-${scenario}`);
   }finally{await context.close();}
  }
  const warmContext=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
  try{
   await warmContext.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===origin||['blob:','data:'].includes(u.protocol)?r.continue():r.abort();});
   await installRequiredAccountFixture(warmContext,origin);
   const page=await warmContext.newPage();page.setDefaultTimeout(15000);
   await page.goto(`${origin}/${ws.dir}/seed.html`);await page.waitForFunction(()=>!!window.seedV68ContinuousPlaylist);await page.evaluate(()=>window.seedV68ContinuousPlaylist());
   await page.addInitScript(()=>{
    delete Navigator.prototype.serviceWorker;
    const NativeWorker=window.Worker;window.__v68WorkerLog={connection:[],search:[],workers:[],commands:[]};
    window.Worker=class{
     constructor(url,options){
      window.__v68WorkerLog.workers.push(String(url));
      if(!String(url).includes('session.worker-'))return new NativeWorker(url,options);
      this.postMessage=message=>{
       window.__v68WorkerLog.commands.push(message.type);
       if(message.type==='restore')queueMicrotask(()=>this.onmessage?.({data:{version:2,session:message.session,request:message.request,phase:'connected',error:null,retryAt:null,delivery:null,binding:{accountRef:crypto.randomUUID(),accountEpoch:1},saved:{peerRef:crypto.randomUUID(),kind:'saved',name:'Mensajes guardados'},bots:[{providerRef:crypto.randomUUID(),username:'ivkmbot',label:'Bot sintético',status:'verified-profile',compatibility:'unverified'}]}}));
       else if(message.protocol==='pulso-telegram-connection')window.__v68WorkerLog.connection.push(message.type);
       else if(message.protocol==='pulso-bot-search')window.__v68WorkerLog.search.push(message.type);
      };
     }
     terminate(){}
    };
    let visible=true;Object.defineProperty(document,'visibilityState',{get:()=>visible?'visible':'hidden',configurable:true});
    window.__v68Visibility=value=>{visible=value;document.dispatchEvent(new Event('visibilitychange'));};
   });
   await page.goto(origin);
   await page.waitForFunction(()=>window.__v68WorkerLog.connection.length===0);
   await page.waitForTimeout(1000);
   await page.evaluate(()=>window.__v68Visibility(false));
   try{await page.waitForFunction(()=>window.__v68WorkerLog.connection.includes('suspend'));}catch(error){console.error(await page.evaluate(()=>window.__v68WorkerLog));throw error;}
   await page.locator('.home-playlists button').filter({hasText:'Continuidad sintética'}).click();
   await page.evaluate(()=>window.__v68Visibility(true));
   await page.waitForFunction(()=>window.__v68WorkerLog.connection.includes('warm'));
   assert.deepEqual(await page.evaluate(()=>window.__v68WorkerLog.search),[]);
   cases.push(`${engine}: U-V68-04 warm`);
  }finally{await warmContext.close();}
  }finally{await browser.close();}
 }
 console.log('PASS',cases.length,cases.join('; '));
}catch(error){console.error('FAIL',error.stack||error);process.exitCode=1;}
finally{if(server)await new Promise(r=>server.httpServer.close(r));await ws.cleanup();}
