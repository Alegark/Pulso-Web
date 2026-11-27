// U-V68-01 and the Inicio artwork preload portion of U-V68-04.
import {build,preview} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createTestWorkspace} from './test-workspace.mjs';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';

const ws=await createTestWorkspace('v69-album-download');let server;const cases=[];
try{
 await writeFile(`${ws.dir}/seed.html`,'<script type="module" src="/tests/integration/v68-continuous-fixture.ts"></script>');
 await build({configFile:false,plugins:[tailwindcss()],logLevel:'error',build:{outDir:`${ws.dir}/bundle`,rolldownOptions:{input:{main:'index.html',seed:`${ws.dir}/seed.html`}}}});
 server=await preview({configFile:false,build:{outDir:`${ws.dir}/bundle`},preview:{host:'127.0.0.1',port:0}});
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await launcher.launch(engine==='chromium'?{headless:true,executablePath:'/usr/bin/chromium'}:{headless:true});
  try{
  for(const scenario of ["02b-next","complete-next"]){
   console.log("RUN",engine,scenario);const context=await browser.newContext({serviceWorkers:"block",viewport:{width:1200,height:844}});
   try{
    await context.route("**/*",r=>{const u=new URL(r.request().url());if(u.origin===origin||["blob:","data:"].includes(u.protocol))return r.continue();if(u.hostname==='itunes.apple.com'){
     const positions=scenario==='complete-next'?[0,2]:[0,1,2];
     const album={wrapperType:'collection',collectionType:'Album',collectionId:201,collectionName:'Álbum sintético',artistName:'Artista sintético',trackCount:positions.length};
     const tracks=positions.map((i,index)=>({wrapperType:'track',kind:'song',collectionId:201,collectionName:'Álbum sintético',artistName:'Artista sintético',trackId:301+i,discNumber:1,discCount:1,trackNumber:index+1,trackCount:positions.length,trackName:`Sintética ${i}`,trackTimeMillis:30000}));
     const rows=u.pathname==='/lookup'?[album,...tracks]:u.searchParams.get('entity')==='album'?[album]:tracks;return r.fulfill({json:{resultCount:rows.length,results:rows},headers:{'access-control-allow-origin':'*'}});
    }return r.abort();});
    await installRequiredAccountFixture(context,origin);
    const page=await context.newPage();page.setDefaultTimeout(15000);
    await page.goto(`${origin}/${ws.dir}/seed.html`);await page.waitForFunction(()=>!!window.seedV69AlbumAndPlaylist);await page.evaluate(complete=>window.seedV69AlbumAndPlaylist(complete),scenario==='complete-next');
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

    await page.waitForFunction(()=>window.__v68Log.restored);
    await page.locator('.home-playlists button').filter({hasText:'Continuidad sintética'}).click();
    await page.getByRole('button',{name:'Descargar playlist completa',exact:true}).click();
    await page.waitForFunction(()=>window.__v68Log.download.length===1);
    await page.locator('.shell-nav').getByRole('button',{name:'Inicio',exact:true}).click();
    const card=page.locator('.home-albums button').filter({hasText:'Álbum sintético'});
    await (scenario==='complete-next'?card.filter({hasText:'2 canciones'}):card.first()).click();
    const album=page.locator('.album-page');await album.locator('.album-tracks li').first().waitFor();
    assert.equal(await album.locator('.album-tracks li[data-track-state=downloaded]').count(),2);
    assert.equal(await album.locator('.album-tracks li[data-album-pending=true]').count(),scenario==='complete-next'?0:1);
    if(scenario==='complete-next')assert.equal(await album.getByRole('button',{name:'Todas las canciones descargadas'}).count(),1);
    else assert.equal(await album.locator('.album-tracks li').nth(1).locator('.album-track-main').isDisabled(),true);
    assert.equal(await album.getByRole('button',{name:'▶ Reproducir'}).isEnabled(),true);
    assert.equal(await album.getByRole('button',{name:'⇄ Aleatorio'}).isEnabled(),true);
    const before=await page.evaluate(()=>({search:window.__v68Log.search.length,cancel:window.__v68Log.cancel.length}));
    await album.locator('.album-tracks li').first().locator('.album-track-main').click();
    await page.waitForFunction(()=>window.__v68Log.events.includes('playing'));
    const after=await page.evaluate(()=>({search:window.__v68Log.search.length,cancel:window.__v68Log.cancel.length,active:window.__v68Log.active,max:window.__v68Log.max}));
    assert.deepEqual(after,{...before,active:1,max:1});cases.push(engine+': U-V69-01 '+scenario);
   }finally{await context.close();}
  }
  }finally{await browser.close();}
 }
 console.log('PASS',cases.length,cases.join('; '));
}catch(error){console.error('FAIL',error.stack||error);process.exitCode=1;}
finally{if(server)await new Promise(r=>server.httpServer.close(r));await ws.cleanup();}
