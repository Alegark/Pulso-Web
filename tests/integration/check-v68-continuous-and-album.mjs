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
