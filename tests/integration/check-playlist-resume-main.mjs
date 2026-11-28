import {build,preview} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {cp,open,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTestWorkspace} from './test-workspace.mjs';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';

const work=await createTestWorkspace('background-resume');
const report={cases:[],external:[],errors:[],limits:'Compiled app, real TelegramSessionClient and worker/driver, synthetic SDK and account. Desktop browser engines.'};
const uuid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const user='11111111-1111-4111-8111-111111111111',ids=[1,2,3,4].map(uuid);
function fixtureWav(n){
 const audio=Buffer.alloc(32044);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);
 audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);
 audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);
 audio.writeUInt32LE(audio.length-44,40);audio[audio.length-1]=n;
 return audio;
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const readyCopies=[1,2].map(n=>{
 const audio=fixtureWav(n);
 return {id:uuid(80+n),trackId:ids[n-1],sha256:digest(audio),audio:audio.toString('base64')};
});
const fixture=(release='old')=>({name:'playlist-resume-sdk-test',enforce:'pre',resolveId(id){if(id==='./temporary-sdk')return resolve('tests/integration/playlist-resume-sdk.ts');},
 transform(code,id){
  if(id.endsWith('/src/main.tsx'))return code.replace('function captureBatchDownload(recoverPending=false):SongPlaybackAttempt|null {',
   'function captureBatchDownload(recoverPending=false):SongPlaybackAttempt|null {if(document.documentElement.dataset.testBusy==="true")return null;')
   .replace('prepare:async manual=>{',
   'prepare:async manual=>{if (document.documentElement.dataset.testUpdateBlocked === "true") return false;')
   .replace("await refresh(false,false,diagnostic,'refresh',false,true);","await window.testBeforeImportRefresh?.();await refresh(false,false,diagnostic,'refresh',false,true);")+`
document.documentElement.dataset.testBuild=${JSON.stringify(release)};window.testEmit=emit;window.testCopyState=id=>availability.get(id)?.state;`;
  if(id.endsWith('/src/service-worker/download-update.ts'))return code.replace(' },bundle)};',` },bundle)};
   const account=sessionStorage.getItem('testonly-external-version-check');
   if(account){
    sessionStorage.removeItem('testonly-external-version-check');
    window.testExternalVersionGate=new Promise(resolve=>{window.testReleaseExternalVersion=()=>{
     window.testExternalVersionGate=null;resolve();
    };});
    void downloadWithCurrentApp(account,{kind:'repair',trackId:account,title:'Consulta ocupada',retry:'safe'},()=>!!window.testExternalVersionGate);
   }`).replace('try{return await beforeDownload(', 'try{await window.testExternalVersionGate;if(!current())return false;return await beforeDownload(');
  if(id.endsWith('/src/ui/DownloadDock.tsx'))return code.replace('const displayTime=5000;', 'const displayTime=window.testDockTime??5000;');
  if(id.endsWith('/src/ui/TelegramPanel.tsx'))return code.replace('tracks={localTracks} client={client.current}',
   'tracks={document.documentElement.dataset.testHoldTracks==="true"?[]:localTracks} client={client.current}');
  if(id.endsWith('/tests/integration/required-setup-sdk.ts'))return code.replace("await fetch('/__setup-event?kind='+kind);",
   "if(!(await fetch('/__setup-event?kind='+kind)).ok)throw Error('network');");
  if(id.endsWith('/library/ordered-bot-acquisition.ts'))return code.replace('await terminal;ownedCancel=undefined;',
   'await terminal;if(window.testManualSettlement){await window.testManualSettlement;window.testManualSettlement=null;}ownedCancel=undefined;');
  if(id.endsWith('/telegram/session-client.ts')){
   return code+`
const testSearchBot=TelegramSessionClient.prototype.searchBot;
    TelegramSessionClient.prototype.searchBot=function(...args){
     if(window.testStartManualLane&&args[0].target?.title==='Pista 3'){
      window.testStartManualLane=false;
      // Admit the competing search synchronously at settlement. The product
      // no longer waits a second before admitting the selected download.
      const stop=this.subscribeSearch(state=>{
       if(state.expectedTarget?.title!=='Pista 3'||state.pending||!state.rows.length)return;
       stop();
       if(window.testManualLaneCompletesFirst)window.testManualSettlement=new Promise(resolve=>{
        const unsubscribe=this.subscribeSearch(manual=>{
         if(manual.pending||manual.queryId===state.queryId||manual.delivery!=='acknowledged')return;
         unsubscribe();window.testManualSettledBeforeCollection=true;resolve();
        });
       });
       testSearchBot.call(this,{providerRef:this.botsSnapshot().providers[0].providerRef,query:'Consulta manual',consent:true});
      });
     }
     return testSearchBot.apply(this,args);
    };
`;
  }
  if(!id.endsWith('/telegram/session.worker.ts'))return;
  return `let testClockOffset=0;const realNow=Date.now.bind(Date);
   Date.now=()=>realNow()+testClockOffset;
   self.addEventListener('message',event=>{if(event.data?.testonlyClock!==undefined){
    event.stopImmediatePropagation();testClockOffset=event.data.testonlyClock;
   }});
   `+code;
 }});
const backgroundModes=['background-alive','cold-resume','stop-reload','two-tabs','wake-restore','paused-hidden','hidden-rejection','orphan-idle'];
const channelModes=['long-cooldown','unknown-cooldown','reconnect','uncertain-send','suspend','suspend-short','notifications-off','stop',...backgroundModes];
const fallbackModes=['bot-timeout','bot-unsupported','manual-lane','manual-lane-settled'];
const updateModes=['update-resume','update-offline','update-startup','update-single','update-album','update-timeout','update-stopped','update-attempted','update-auto','update-auto-busy','update-auto-external-version','update-priority-album','update-priority-song','update-album-cancelled','update-album-other-edition'];
const allModes=[...updateModes,...channelModes,...fallbackModes,'autoheal','missing','missing-metadata','invalid','cooldown','staging','parked','ack-lost','connected','single','album'];
const modes=process.env.PLAYLIST_RESUME_MODE?process.env.PLAYLIST_RESUME_MODE.split(','):allModes;
assert.ok(modes.every(mode=>allModes.includes(mode)),'Unknown playlist resume test case');
const reasons={
 missing:['1 no existe','No existe en tus bots'],
 'missing-metadata':['1 sin datos','Faltan datos para buscarla'],
 parked:['1 pendiente en Almacenamiento','Pendiente en Almacenamiento'],
 invalid:['1 sin archivo válido','Ningún bot entregó un archivo válido'],
};

async function checkHeader(page,header,engine,screenshots){
 const controls=header.locator('.collection-header__controls');
 const labels=()=>controls.locator('button:visible').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label')));
 const expected=['Reproducir playlist','Reproducción aleatoria','Descargar playlist completa','Opciones de playlist'];
 await controls.getByRole('button',{name:expected[2],exact:true}).waitFor();
 assert.deepEqual(await labels(),expected);
 assert.equal(await page.getByRole('button',{name:'Eliminar playlist',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:/portadas de Spotify/}).count(),0);
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:`${screenshots}/${engine}-390x844-cabecera.png`});
 for(const [width,height] of [[320,568],[844,390],[390,844]]){
  await page.setViewportSize({width,height});
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  assert.deepEqual(await labels(),expected);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await header.getByRole('button',{name:'Opciones de playlist',exact:true}).click();
  const menu=header.getByRole('dialog');
  await menu.getByRole('button',{name:'Eliminar playlist',exact:true}).waitFor();
  await menu.getByRole('button',{name:/portadas de Spotify/}).waitFor();
  for(const label of ['Editar nombre','Filtros de canciones'])await menu.getByText(label,{exact:true}).waitFor();
  await menu.getByRole('button',{name:'Cerrar opciones de colección'}).click();
 }
 await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
}

async function buildRelease(outDir,release){
 await build({configFile:false,plugins:[tailwindcss(),fixture(release)],worker:{plugins:()=>[fixture()]},logLevel:'error',build:{outDir}});
 const html=await readFile(outDir+'/index.html','utf8');
 const id=digest(html).slice(0,16);
 assert.ok(html.includes('<title>'));
 return {html:html.replace('<title>',`<meta name="pulso-release" content="${id}"><title>`),entry:`/releases/${id}.html`,id};
}

let server,tempDirectory;
const oldTemp=process.env.TMPDIR;
const screenshots=process.env.PULSO_TEST_EVIDENCE_DIR??work.evidence;
try{
 // Keep test profiles in the worktree using a path short enough for Unix sockets.
 tempDirectory=await open(work.dir,'r');
 process.env.TMPDIR=`/proc/${process.pid}/fd/${tempDirectory.fd}`;
 const bundle=work.dir+'/bundle';
 const previous=await buildRelease(bundle,'old');
 const next=modes.some(mode=>updateModes.includes(mode))?await buildRelease(work.dir+'/next','new'):null;
 if(next)await cp(work.dir+'/next/assets',bundle+'/assets',{recursive:true,force:false});
 await writeFile(bundle+'/telegram-config.json',JSON.stringify({api_id:12345,api_hash:'0'.repeat(32)}));
 server=await preview({configFile:false,build:{outDir:bundle},preview:{host:'127.0.0.1',port:0}});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
  if(process.env.PLAYLIST_RESUME_ENGINE&&process.env.PLAYLIST_RESUME_ENGINE!==engine)continue;
  const browser=await launcher.launch(engine==='chromium'?{executablePath:'/usr/bin/chromium',headless:true}:{headless:true});
  report[engine]=browser.version();
  try{for(const mode of modes){
   const suspending=mode==='suspend'||mode==='suspend-short';
   const updating=updateModes.includes(mode),albumMode=mode==='album'||mode==='update-album',singleMode=mode==='single'||mode==='update-single';
   const abandonedAlbum=mode==='update-album-cancelled'||mode==='update-album-other-edition';
   const albumHandoff=mode==='update-priority-album'||abandonedAlbum;
   const priority=albumHandoff||mode==='update-priority-song';
   const externalVersion=mode==='update-auto-external-version';
   const autoUpdate=mode==='update-auto'||mode==='update-auto-busy'||externalVersion;
   const updateDownload=['update-resume','update-single','update-album','update-auto'].includes(mode);
   const deferUpdate=mode==='update-timeout'||mode==='update-stopped';
   const updateFallback=mode==='update-timeout'||mode==='update-attempted';
   const fresh=albumMode||singleMode||['autoheal','missing','missing-metadata'].includes(mode);
   const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
   const trace=[];let floodAt=0,restores=0,restoreFailures=0;const channel=channelModes.includes(mode),fallback=fallbackModes.includes(mode);
   let releaseRestore,releaseSearch,releaseStartupProbe,holdRestore=false,page,restoresBeforeResume=0;
   let autoPointerAt=Infinity,gateProbes=0;
   let pointer=mode==='update-startup'?'new':'old',pointerChecks=0,startupProbeAt=0,startupNavigationAt=0;
   const navigations=[];
   const startupGate=new Promise(resolve=>{releaseStartupProbe=resolve;});
   const restoration=new Promise(resolve=>{releaseRestore=resolve;});
   const searchGate=new Promise(resolve=>{releaseSearch=resolve;});
   try{
    await context.route('**/*',async route=>{
     const url=new URL(route.request().url());
     if((albumMode||albumHandoff)&&url.origin==='https://itunes.apple.com'){
      const album={wrapperType:'collection',collectionType:'Album',collectionId:201,collectionName:'Álbum de prueba',
       artistName:'Artista prueba',trackCount:2};
      const tracks=[3,4].map((n,index)=>({wrapperType:'track',kind:'song',collectionId:201,trackId:300+n,
       discNumber:1,discCount:1,trackNumber:index+1,trackCount:2,trackName:`Pista ${n}`,artistName:'Artista prueba',trackTimeMillis:2000}));
      const results=url.pathname==='/lookup'?[album,...tracks]:[album];
      if(albumHandoff&&url.pathname==='/lookup'){
       gateProbes++;await searchGate;
       if(mode==='update-album-other-edition')return route.fulfill({status:502,headers:{'access-control-allow-origin':'*'},json:{}});
      }
      return route.fulfill({headers:{'access-control-allow-origin':'*'},json:{resultCount:results.length,results}});
     }
     if(mode==='update-album-other-edition'&&url.origin===origin){
      if(url.pathname==='/catalog-config.json')return route.fulfill({json:{version:1,itunes:false,musicbrainz:true,artwork:false}});
      if(url.pathname.startsWith('/catalog/musicbrainz/')){
       const credit=[{name:'Artista prueba',joinphrase:'',artist:{id:uuid(211)}}];
       const edition={id:uuid(201),title:'Álbum de prueba','artist-credit':credit,media:[{position:1,'track-count':1,
        tracks:[{position:1,title:'Pista del respaldo',length:2000,'artist-credit':credit,recording:{id:uuid(212)}}]}]};
       if(url.pathname.endsWith('/search'))return route.fulfill({json:{releases:[edition]}});
       if(url.pathname.endsWith('/release'))return route.fulfill({json:edition});
      }
     }
     if(updating&&url.origin==='https://itunes.apple.com')return route.fulfill({headers:{'access-control-allow-origin':'*'},json:{resultCount:0,results:[]}});
     if((albumMode||updating)&&url.origin==='https://lrclib.net')return route.fulfill({headers:{'access-control-allow-origin':'*'},json:[]});
     if(url.origin!==origin){report.external.push(url.origin);return route.abort();}
     if(updating&&url.pathname==='/latest.json'){
      pointerChecks++;
      if(mode==='update-startup'&&pointerChecks===1){await startupGate;startupProbeAt=Date.now();}
      if(autoUpdate&&pointerChecks>=autoPointerAt){
       gateProbes++;
       if(mode==='update-auto-busy'&&gateProbes===1)await startupGate;
       if(mode==='update-auto')return route.fulfill({json:{version:1,entry:next.entry}});
      }
      if(pointer==='offline')return route.abort('internetdisconnected');
      return route.fulfill({json:{version:1,entry:pointer==='new'?next.entry:previous.entry}});
     }
     if(updating&&(url.pathname==='/'||url.pathname===previous.entry||url.pathname===next.entry)){
      if(route.request().isNavigationRequest()){
       navigations.push(url.pathname);
       if(url.pathname===next.entry){
        startupNavigationAt||=Date.now();
        if(updateDownload)assert.equal(trace.length,0,'download started before the new shell');
       }
      }
      return route.fulfill({contentType:'text/html',body:url.pathname===next.entry?next.html:previous.html});
     }
     if(url.pathname==='/testonly-seed'){
      if(updating&&route.request().isNavigationRequest())navigations.push(url.pathname);
      return route.fulfill({contentType:'text/html',body:'<!doctype html><title>seed</title>'});
     }
     if(url.pathname==='/__setup-event'){
      if(url.searchParams.get('kind')==='restore'){
       restores++;
       if(holdRestore)await restoration;
       if(mode==='wake-restore'&&restores===3){restoreFailures++;return route.fulfill({status:503});}
      }
      return route.fulfill({json:{}});
     }
     if(url.pathname==='/__playlist-event'){
      const event=route.request().postDataJSON();
      trace.push({...event,at:Date.now()});
      if((mode==='missing'||albumMode&&!updating)&&event.kind==='search'&&event.title==='Pista 3')await searchGate;
      const thirdSearches=trace.filter(item=>item.kind==='search'&&item.title==='Pista 3').length;
      if(event.kind==='search'&&event.title==='Pista 3'&&thirdSearches===1)restoresBeforeResume=restores;
      if(['background-alive','cold-resume','stop-reload','two-tabs','wake-restore'].includes(mode)&&event.kind==='read'&&event.title==='Pista 3'&&thirdSearches===1)await searchGate;
      if(event.kind==='search'&&event.title==='Pista 3'&&thirdSearches===1){
       if(suspending)await searchGate;
       if(mode==='uncertain-send'||mode==='suspend-short')return route.abort('connectionreset');
      }
      const limited=['long-cooldown','unknown-cooldown','notifications-off','stop','paused-hidden'].includes(mode);
      const flood=event.kind==='read'&&event.title==='Pista 3'&&limited&&!floodAt
       ?(mode==='unknown-cooldown'?'unknown':mode==='paused-hidden'?1800:300):null;
      if(flood){
       floodAt=event.workerAt;
       if(mode==='paused-hidden')await page.evaluate(()=>window.testVisibility(true));
      }
      if(mode==='manual-lane'&&event.title==='Consulta manual')await searchGate;
      if(mode==='hidden-rejection'&&event.kind==='read'&&event.title==='Pista 3'&&event.peer===101){
       await page.evaluate(()=>window.testVisibility(true));
       return route.fulfill({json:{reject:true}});
      }
      if(mode==='update-priority-song'&&event.kind==='read'){gateProbes++;await searchGate;}
      const network=event.kind==='read'&&event.title==='Pista 3'&&(mode==='reconnect'&&thirdSearches<=2||mode==='wake-restore'&&thirdSearches===1);
      return route.fulfill({json:{mode:albumMode||mode==='update-priority-album'?'missing':singleMode?'single':updating||mode==='hidden-rejection'?'autoheal':backgroundModes.includes(mode)||suspending||mode==='uncertain-send'?'suspend':mode==='manual-lane-settled'?'manual-lane':mode,flood,network}});
     }
     return route.fallback();
    });
    await installRequiredAccountFixture(context,origin);
    const tracks=ids.map((id,i)=>({id,title:'Pista '+(i+1),artist:mode==='missing-metadata'&&i===2?null:'Artista prueba',album:null,duration:2,favorite:false,inLibrary:true,createdAt:'2026-11-19T00:00:00Z',localAlbum:null,catalog:null}));
    let cloud={accountId:user,revision:1,document:{version:1,tracks,playlists:[{id:uuid(99),name:'Playlist pendiente',entries:ids.map((trackId,i)=>({trackId,id:uuid(100+i)}))}]}};
    await context.route(origin+'/api/account-library',async route=>{
     if(route.request().method()==='PUT'){
      const req=route.request().postDataJSON();
      if(req.revision!==cloud.revision)return route.fulfill({status:409,json:{code:'LIBRARY_CHANGED'}});
      cloud={...cloud,revision:cloud.revision+1,document:req.document};
     }
     return route.fulfill({json:cloud});
    });
    await context.addInitScript(({loseAck,channel,fallback,mode,user,updating})=>{
     if(mode==='manual-lane'||mode==='manual-lane-settled')window.testStartManualLane=true;
     if(mode==='manual-lane-settled')window.testManualLaneCompletesFirst=true;
     let hidden=false,offset=-500;
     if(mode!=='missing'&&mode!=='paused-hidden')window.testDockTime=45000;
     if(updating){
      const handoff=sessionStorage.getItem('pulso-shell:download-intent:v1');
      if(handoff)sessionStorage.setItem('testonly-handoff',handoff);
      if(sessionStorage.getItem('testonly-hold-tracks'))new MutationObserver((_,observer)=>{
       if(document.documentElement){document.documentElement.dataset.testHoldTracks='true';observer.disconnect();}
      }).observe(document,{childList:true});
      window.testUpdateNotices=[];
      const dockNotice=new MutationObserver(()=>{
       const text=document.querySelector('.download-dock__message')?.textContent;
       if(text&&window.testUpdateNotices.at(-1)!==text)window.testUpdateNotices.push(text);
       if(text?.includes('Actualizando Pulso antes de descargar…'))sessionStorage.setItem('testonly-update-notice','shown');
      });
      dockNotice.observe(document,{childList:true,characterData:true,subtree:true});
     }
     if(mode==='update-resume'||mode==='update-single'||mode.startsWith('update-auto')||mode.startsWith('update-priority')||mode.startsWith('update-album-')||channel){
      const play=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function(...args){
       sessionStorage.setItem('testonly-plays',String(1+Number(sessionStorage.getItem('testonly-plays'))));
       return play.apply(this,args);
      };
     }
     const workers=new Set();
     if(channel||fallback||updating){
      // Keep the synthetic Pulso configuration independent of WebKit's
      // canceled HTTP fetches when the test reloads or jumps the page clock.
      const fetchOriginal=window.fetch.bind(window);
      window.fetch=(input,init)=>{
       const url=new URL(input instanceof Request?input.url:String(input),location.href);
       if(url.origin===location.origin&&url.pathname==='/account-config.json')return Promise.resolve(Response.json({version:1,enabled:true,google:false}));
       if(url.origin===location.origin&&url.pathname==='/api/account-auth/get-session'){
        const now=new Date().toISOString();
        return Promise.resolve(Response.json({
         user:{id:user,name:'Persona TESTONLY',email:'fixture@example.test',emailVerified:true},
         session:{id:'TESTONLY',token:'TESTONLY',userId:user,expiresAt:new Date(Date.now()+3600000).toISOString(),createdAt:now,updatedAt:now},
        }));
       }
       return fetchOriginal(input,init);
      };
     }
     if(channel||fallback){
      Object.defineProperty(document,'visibilityState',{get:()=>hidden?'hidden':'visible'});
      window.testVisibility=value=>{if(hidden===value)return;hidden=value;document.dispatchEvent(new Event('visibilitychange'));};
      window.testAdvanceWorkers=ms=>{offset+=ms;for(const worker of workers)worker.postMessage({testonlyClock:offset});};
      window.testNotifications=[];
      window.testDismissed=[];
      Object.defineProperty(window,'Notification',{configurable:true,value:{permission:'granted'}});
      window.ServiceWorkerRegistration??=class {};
      window.ServiceWorkerRegistration.prototype.showNotification=async(title,options)=>window.testNotifications.push({title,...options});
      Object.defineProperty(navigator.serviceWorker,'getRegistration',{value:async()=>({
       active:true,showNotification:window.ServiceWorkerRegistration.prototype.showNotification,
       getNotifications:async()=>{
        const stored=sessionStorage.getItem('testonly-orphan');
        const recent=window.testNotifications.at(-1);
        return [recent,stored?JSON.parse(stored):null].filter(Boolean).map(({tag,data,silent})=>({tag,data,silent,close:()=>{
         window.testDismissed.push(tag);sessionStorage.removeItem('testonly-orphan');
        }}));
       },
      })});
      localStorage.setItem('pulso:download-notifications:v1',mode==='notifications-off'?'disabled':'enabled');
     }
     const locks=navigator.locks,request=locks.request.bind(locks);
     locks.request=(name,...args)=>name===sessionStorage.getItem('testonly-unavailable-lock')
      ?Promise.reject(new DOMException('Synthetic staging lock failure','SecurityError')):request(name,...args);
     const NativeWorker=window.Worker;
     window.__TESTONLY_outcomes=[];
     window.Worker=class extends NativeWorker{
      operationIdToHide;
      postMessage(message,...args){
       if(channel&&mode.startsWith('suspend')&&message?.type==='import'&&message.file.name==='Pista 4.wav')window.testVisibility(true);
       if(loseAck&&message?.type==='import'&&message.file.name==='Pista 3.wav')this.operationIdToHide=message.operationId;
       return super.postMessage(message,...args);
      }
      constructor(...args){
       super(...args);
       if((channel||mode==='manual-lane')&&String(args[0]).includes('session.worker')){
        workers.add(this);
        this.postMessage({testonlyClock:offset});
       }
       this.addEventListener('message',event=>{
        const {data}=event;
        if(data?.type==='complete'&&data.operationId===this.operationIdToHide){
         window.__TESTONLY_outcomes.push({type:'lost-ack',writeState:data.outcome.writeState});
         event.stopImmediatePropagation();
         this.dispatchEvent(new ErrorEvent('error'));
         return;
        }
        if(data?.outcome)window.__TESTONLY_outcomes.push({type:data.type,status:data.outcome.status,writeState:data.outcome.writeState,
         backend:data.outcome.primary?.backend,phase:data.outcome.primary?.phase,primary:data.outcome.primary?.code,cleanup:data.outcome.cleanup?.code,reconcile:data.outcome.reconcile?.code});
       });
      }
      terminate(){workers.delete(this);super.terminate();}
     };
    },{loseAck:mode==='ack-lost',channel,fallback,mode,user,updating});
    page=await context.newPage();page.setDefaultTimeout(18000);
    if(channel||mode==='manual-lane')await page.clock.install();
    const advance=async ms=>{await page.evaluate(value=>window.testAdvanceWorkers(value),ms);await page.clock.fastForward(ms);};
    const waitForWorker=async(predicate,timeout=5000)=>{
     const until=Date.now()+timeout;
     do{if(predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<until);
     assert.fail('No llegó el evento del worker simulado');
    };
    page.on('pageerror',error=>report.errors.push(error.stack??String(error)));
    await page.goto(origin+'/testonly-seed',{waitUntil:'domcontentloaded'});
    await page.evaluate(async ({user,ids})=>{
     localStorage.setItem('pulso:setup:v1:'+user,'complete');
     const db=await new Promise((resolve,reject)=>{
      const q=indexedDB.open('pulso-web-telegram-session-v1',1);
      q.onupgradeneeded=()=>q.result.createObjectStore('authorization');
      q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
     });
     try{await new Promise((resolve,reject)=>{
      const tx=db.transaction('authorization','readwrite'),store=tx.objectStore('authorization');
      store.put('TESTONLY_STORED_SESSION','session');store.put(crypto.randomUUID(),'epoch');
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
     });}finally{db.close();}
    },{user,ids});
    if(mode==='orphan-idle'){
     await page.evaluate(account=>sessionStorage.setItem('testonly-orphan',JSON.stringify({
      tag:'pulso-download-collection',silent:true,data:{account,terminal:false},
     })),user);
     await page.goto(origin,{waitUntil:'commit'});
     await page.waitForFunction(()=>window.testDismissed.includes('pulso-download-collection'));
     assert.equal(await page.locator('.download-dock').count(),0);
     assert.equal(trace.length,0);
     report.cases.push({engine,mode,status:'PASS'});continue;
    }
    if(mode==='update-startup'){
     // The old shell stays in place while Pulso restores its synthetic account.
     // Reply to the startup probe as soon as the existing safety guards settle.
     await page.goto(origin,{waitUntil:'commit'});
     await page.locator('.bot-providers-list li').first().waitFor({state:'attached'});
     assert.equal(pointerChecks,1);
     releaseStartupProbe();
     await page.waitForURL(origin+next.entry,{timeout:10000});
     assert.ok(startupProbeAt>0&&startupNavigationAt-startupProbeAt<3000,'startup waited for the idle window');
     assert.equal(await page.locator('html').getAttribute('data-test-build'),'new');
     assert.deepEqual(navigations,['/testonly-seed','/',next.entry]);
     report.cases.push({engine,mode,status:'PASS'});
     continue;
    }
    await page.goto(origin,{waitUntil:'commit'});
    await page.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();
    await page.locator('.library-grid button').filter({hasText:'Playlist pendiente'}).click();
    await page.getByRole('heading',{name:'Playlist pendiente',exact:true}).waitFor();
    const operationId=fresh?null:await page.evaluate(async ({user,ids,staging,parked,readyCopies})=>{
     const operationId=staging?crypto.randomUUID():null;
     const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
     try{await new Promise((resolve,reject)=>{
      const tx=db.transaction(['jobs','chunks','settings','tracks','assets'],'readwrite');
      const chunks=tx.objectStore('chunks'),tracks=tx.objectStore('tracks'),assets=tx.objectStore('assets');
      for(const copy of readyCopies){
       const bytes=Uint8Array.from(atob(copy.audio),char=>char.charCodeAt(0)),row=tracks.get(copy.trackId);
       chunks.put(bytes,[copy.id,0]);
       assets.put({id:copy.id,namespace:'local',storageKey:copy.id,bytes:bytes.length,sha256:copy.sha256,mime:'audio/wav',chunks:1,
        state:'complete',revision:1,chunkSize:65536,backend:'idb',retention:'kept'},copy.id);
       row.onsuccess=()=>tracks.put({...row.result,assetId:copy.id,revision:row.result.revision+1,
        audioFingerprint:{algorithm:'sha256',sha256:copy.sha256,bytes:bytes.length}},copy.trackId);
      }
      if(operationId){
       const owner=crypto.randomUUID();
       tx.objectStore('jobs').put({version:1,operationId,owner,accountId:user,revision:1,backend:'idb',
        storageKey:operationId,bytes:0,expectedBytes:32044,state:'writing',libraryMode:'cache'},operationId);
       chunks.put(new Uint8Array([1]),[operationId,0]);
       tx.objectStore('settings').put({operationId,owner,everPublished:false},['asset-ownership','idb',operationId]);
      }
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
     });}finally{db.close();}
     localStorage.setItem('pulso:library-download:v1:'+user,JSON.stringify({id:crypto.randomUUID(),trackIds:ids,cursor:2,
      pending:operationId?{kind:'save',index:2,operationId}:null}));
     if(parked)sessionStorage.setItem('testonly-unavailable-lock','pulso-web:local:asset:idb:'+operationId);
     return operationId;
    },{user,ids,staging:mode==='staging'||mode==='parked',parked:mode==='parked',readyCopies});
    const header=page.locator('.collection-header');
    const dock=page.getByRole('region',{name:'Descargas',exact:true});
    const handle=dock.locator('.download-dock__handle');
    const panel=dock.locator('.download-dock__panel');
    if(albumMode){
     await page.locator('.bot-providers-list li').first().waitFor({state:'attached'});
     await page.locator('.shell-nav').getByRole('button',{name:'Buscar',exact:true}).click();
     const input=page.getByRole('searchbox',{name:'Canción, álbum o artista'});
     await input.fill('Álbum de prueba');
     await input.press('Enter');
     await page.locator('[data-catalog-kind="album"]').filter({hasText:'Álbum de prueba'}).first().click();
     if(updating)pointer='new';
     await page.getByRole('button',{name:'Añadir álbum',exact:true}).click();
     if(updating){
      await page.waitForURL(origin+next.entry);
      assert.deepEqual(navigations,['/testonly-seed','/',next.entry]);
     }else{
      await handle.getByText('0/2',{exact:true}).waitFor();
      await page.locator('.album-actions').getByRole('button',{name:'Gestionar descarga de Álbum de prueba'}).click();
      await page.getByRole('button',{name:'Seguir descargando',exact:true}).click();
      await handle.click();
      await dock.getByRole('button',{name:'Detener',exact:true}).waitFor();
      await panel.getByText('Álbum de prueba',{exact:true}).waitFor();
      releaseSearch();
     }
     await handle.getByText('1 de 2 guardadas · 1 no existe',{exact:true}).waitFor();
     await handle.click();
     await panel.locator('li[data-failed=true]').getByText('No existe en tus bots',{exact:true}).waitFor();
     await panel.locator('li[data-failed=false]').getByText('Pista 4',{exact:true}).waitFor();
     const assets=await page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{
       const req=indexedDB.open('pulso-web-local-v1');
       req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      try{return await new Promise((resolve,reject)=>{
       const req=db.transaction('assets').objectStore('assets').getAll();
       req.onsuccess=()=>resolve(req.result.filter(asset=>asset.state==='complete').map(asset=>asset.sha256));
       req.onerror=()=>reject(req.error);
      });}finally{db.close();}
     });
     assert.deepEqual(assets,[digest(fixtureWav(14))]);
     assert.deepEqual(trace.filter(event=>event.kind==='search').map(event=>event.title),['Pista 3','Pista 3','Pista 4']);
     report.cases.push({engine,mode,status:'PASS'});
     continue;
    }
    let fallbackDelayMs;
    if(autoUpdate||priority){
     const previousId=await page.evaluate(({user,ids,priority,bundle,albumHandoff,externalVersion})=>{
      const key='pulso:library-download:v1:'+user,checkpoint=JSON.parse(localStorage.getItem(key));
      Object.assign(checkpoint,priority?{trackIds:[ids[2]],cursor:0,saved:0}:{saved:2,autoAttempts:1},{autoResume:true,title:'Playlist pendiente'});
      localStorage.setItem(key,JSON.stringify(checkpoint));
      if(externalVersion)sessionStorage.setItem('testonly-external-version-check',user);
      if(priority){
       sessionStorage.setItem('testonly-hold-tracks','1');
       const action=albumHandoff?{kind:'album',editionId:201,title:'Álbum de prueba',artist:'Artista prueba'}:
        {kind:'song',choice:{id:'local:'+ids[3],source:'local',title:'Pista 4',artist:'Artista prueba',album:null,duration:2}};
       sessionStorage.setItem('pulso-shell:download-intent:v1',JSON.stringify({account:user,bundle,expires:Date.now()+90000,action}));
      }
      return checkpoint.id;
     },{user,ids,priority,albumHandoff,externalVersion,bundle:previous.html.match(/src="(\/assets\/[^"]+\.js)"/)[1]});
     autoPointerAt=pointerChecks+2;
     await page.reload({waitUntil:'commit'});
     if(externalVersion){
      await page.locator('.bot-providers-list li').first().waitFor({state:'attached'});
      await dock.getByText('Descarga pendiente · 2 de 4 guardadas',{exact:true}).waitFor();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(trace.length,0);
      await page.evaluate(()=>window.testReleaseExternalVersion());
     }else await waitForWorker(()=>gateProbes>0);
     if(priority){
      await page.waitForFunction(()=>sessionStorage.getItem('pulso-shell:download-intent:v1')===null);
      await page.evaluate(()=>{delete document.documentElement.dataset.testHoldTracks;document.dispatchEvent(new Event('visibilitychange'));window.testEmit();});
      await dock.getByText('Descarga pendiente · 0 de 1 guardadas',{exact:true}).waitFor();
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(account=>JSON.parse(localStorage.getItem('pulso:library-download:v1:'+account)).id,user),previousId);
      if(albumHandoff)assert.equal(trace.length,0);
      else assert.deepEqual(trace.filter(e=>e.kind==='search').map(e=>e.title),['Pista 4']);
      if(mode==='update-album-cancelled'){
       await page.locator('.shell-nav').getByRole('button',{name:'Inicio',exact:true}).click();
       await page.locator('.album-page').waitFor({state:'hidden'});
      }
      releaseSearch();
      if(abandonedAlbum){
       if(mode==='update-album-other-edition')await page.locator('.album-tracks').getByText('Pista del respaldo',{exact:true}).waitFor();
       await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
       await handle.getByText('1 de 1 guardadas',{exact:true}).waitFor();
       assert.deepEqual(trace.filter(event=>event.kind==='search').map(event=>event.title),['Pista 3','Pista 3']);
       assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('testonly-plays'))),0);
       assert.equal(await page.evaluate(account=>localStorage.getItem('pulso:library-download:v1:'+account),user),null);
       report.cases.push({engine,mode,status:'PASS'});continue;
      }
      if(mode==='update-priority-album')await page.locator('.album-tracks li[data-track-state="downloaded"]').filter({hasText:'Pista 4'}).waitFor();
      else await page.getByText('Copia guardada. Pulsa Reproducir para escucharla.',{exact:false}).first().waitFor();
      assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('testonly-plays'))),0);
      assert.equal(await page.evaluate(account=>JSON.parse(localStorage.getItem('pulso:library-download:v1:'+account)).id,user),previousId);
      report.cases.push({engine,mode,status:'PASS'});continue;
     }
     if(mode==='update-auto-busy'){
      await page.evaluate(()=>{document.documentElement.dataset.testBusy='true';window.testEmit();});
      releaseStartupProbe();
      await dock.getByText('Descarga pendiente · 2 de 4 guardadas',{exact:true}).waitFor();
      assert.equal(await dock.getByText(/Biblioteca está ocupada/).count(),0);
      assert.equal(trace.length,0);
      await page.evaluate(()=>{delete document.documentElement.dataset.testBusy;window.testEmit();});
     }else if(!externalVersion){
      await page.waitForURL(origin+next.entry);
      const handoff=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('testonly-handoff')));
      assert.equal(handoff?.action.automatic,true);
      assert.equal(handoff?.action.checkpointId,previousId);
     }
     await page.waitForFunction(()=>sessionStorage.getItem('pulso-shell:download-intent:v1')===null);
    }else if(!fresh){
     holdRestore=true;
     await page.reload({waitUntil:'commit'});
     await page.locator('.shell-nav').getByRole('button',{name:'Biblioteca',exact:true}).click();
     await page.locator('.library-grid button').filter({hasText:'Playlist pendiente'}).click();
     if(mode==='connected'||updating){
      releaseRestore();
      await page.getByText('Cuenta autenticada en esta pestaña.',{exact:false}).waitFor({state:'attached'});
      await page.locator('.bot-providers-list li').first().waitFor({state:'attached'});
     }
     let playsBefore=0;
     if(updating){
      await page.waitForFunction(id=>document.querySelector('meta[name="pulso-release"]')?.content===id,previous.id);
      assert.ok(pointerChecks>=2,'expected a startup probe on each old document');
      if(mode==='update-resume'){
       await page.getByRole('button',{name:'Escuchar Pista 1',exact:true}).click();
       await page.getByRole('button',{name:'Pausar desde minirreproductor'}).waitFor();
       playsBefore=await page.evaluate(()=>Number(sessionStorage.getItem('testonly-plays')));
       assert.ok(playsBefore>0);
      }
      if(deferUpdate)await page.evaluate(()=>{document.documentElement.dataset.testUpdateBlocked='true';});
      if(mode==='update-attempted')await page.evaluate(({entry,bundle,user})=>{
       sessionStorage.setItem('pulso-shell:automatic-attempt:'+entry,'1');
       sessionStorage.setItem('pulso-shell:download-intent:v1',JSON.stringify({account:user,bundle,expires:Date.now()+90000,
        action:{kind:'library',request:{id:crypto.randomUUID(),trackIds:['00000001-1111-4111-8111-111111111111'],title:'Intento anterior',play:false}}}));
      },{entry:next.entry,bundle:next.html.match(/src="(\/assets\/[^"]+\.js)"/)[1],user});
      pointer=mode==='update-offline'?'offline':'new';
     }
     if(mode==='connected'&&process.env.PLAYLIST_TEST_PURGED_COPY==='1'){
      await page.waitForFunction(id=>window.testCopyState(id)==='available',ids[0]);
      await page.evaluate(storageKey=>{
       const edit=async(value,restore)=>{
        const db=await new Promise((resolve,reject)=>{
         const req=indexedDB.open('pulso-web-local-v1');
         req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
        });
        try{await new Promise((resolve,reject)=>{
         const tx=db.transaction('chunks','readwrite'),store=tx.objectStore('chunks'),key=[storageKey,0];
         if(restore)store.put(value,key);else store.delete(key);
         tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
        });}finally{db.close();}
       };
       window.testBeforeImportRefresh=async()=>{window.testBeforeImportRefresh=null;await edit(null,false);window.testPurged=true;};
       window.testRestorePurgedCopy=value=>edit(Uint8Array.from(atob(value),c=>c.charCodeAt(0)),true);
      },readyCopies[0].id);
     }
     const clickedAt=Date.now();
     const continueButton=dock.getByRole('button',{name:'Continuar',exact:true});
     await continueButton.click();
     if(deferUpdate){
      await dock.getByText('Actualizando Pulso antes de descargar…',{exact:true}).waitFor();
      assert.equal(trace.length,0);
     }
     if(mode==='update-stopped'){
      await dock.getByRole('button',{name:'Detener',exact:true}).click();
      await dock.getByText('Actualizando Pulso antes de descargar…',{exact:true}).waitFor({state:'detached'});
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,clickedAt+10500-Date.now())));
      assert.equal(trace.length,0);
      assert.deepEqual(navigations,['/testonly-seed','/','/']);
      assert.equal(await page.evaluate(()=>sessionStorage.getItem('pulso-shell:download-intent:v1')),null);
      report.cases.push({engine,mode,status:'PASS'});
      continue;
     }
     if(updateFallback){
      await page.waitForFunction(()=>window.testUpdateNotices.includes('No se pudo actualizar ahora. Descargando con esta versión.'));
      await waitForWorker(()=>trace.some(event=>event.kind==='search'));
      fallbackDelayMs=trace.find(event=>event.kind==='search').at-clickedAt;
      if(deferUpdate)assert.ok(fallbackDelayMs>=9500&&fallbackDelayMs<14000,`fallback after ${fallbackDelayMs} ms`);
      else assert.ok(fallbackDelayMs<9500,`attempted release took ${fallbackDelayMs} ms`);
      assert.equal(await page.evaluate(()=>sessionStorage.getItem('pulso-shell:download-intent:v1')),null);
     }
     if(mode==='update-resume'){
      await page.waitForURL(origin+next.entry);
      assert.equal(await page.evaluate(()=>sessionStorage.getItem('testonly-update-notice')),'shown');
      await page.locator('.mini-player__title').filter({hasText:/^Pista [12]$/}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Pausar desde minirreproductor'}).count(),0);
      assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('testonly-plays'))),playsBefore);
      await page.waitForFunction(()=>sessionStorage.getItem('pulso-shell:download-intent:v1')===null);
     }
     if(mode!=='connected'&&!updating){
      await dock.locator('.download-dock__message').getByText('Esperando a que Telegram termine de preparar tus bots…',{exact:true}).waitFor();
      assert.equal(trace.length,0);
      releaseRestore();
     }
    }else{
     await page.locator('.bot-providers-list li').first().waitFor({state:'attached'});
     if(mode==='missing'){
      assert.equal(await dock.count(),0);
      await checkHeader(page,header,engine,screenshots);
     }
     const start=singleMode?page.getByRole('button',{name:'Escuchar Pista 3',exact:true}):
      header.getByRole('button',{name:'Descargar playlist completa',exact:true});
     if(updating)pointer='new';
     await start.click();
     if(updating)await page.waitForURL(origin+next.entry);
    }
    if(mode==='missing'){
     await handle.getByText('2/4',{exact:true}).waitFor();
     assert.equal(await handle.getAttribute('aria-expanded'),'false');
     await page.screenshot({path:`${screenshots}/${engine}-390x844-plegada.png`});
     await header.getByRole('button',{name:/Gestionar descarga de/}).click();
     const keep=page.getByRole('button',{name:'Seguir descargando',exact:true});
     assert.equal(await keep.evaluate(el=>el===document.activeElement),true);
     await keep.click();
     await handle.click();
     await dock.getByRole('button',{name:'Detener',exact:true}).waitFor();
     await panel.getByText('Pista 3',{exact:true}).first().waitFor();
     await handle.click();
     assert.equal(await handle.getAttribute('aria-expanded'),'false');
     releaseSearch();
    }
    if(mode==='manual-lane'){
     await waitForWorker(()=>trace.some(event=>event.title==='Consulta manual'));
     await advance(4000);
     assert.equal(trace.filter(event=>event.title==='Pista 3').length,1);
     assert.equal(trace.some(event=>event.title==='Pista 4'),false);
     assert.equal(await dock.getByText('Reconectando con Telegram…',{exact:true}).count(),0);
     releaseSearch();
    }
    let cold=false,other;
    if(channel){
     const thirdSearches=()=>trace.filter(event=>event.kind==='search'&&event.title==='Pista 3').length;
     if(mode==='background-alive'||mode==='wake-restore'){
      await waitForWorker(()=>trace.some(event=>event.kind==='read'&&event.title==='Pista 3'));
      await page.evaluate(()=>window.testVisibility(true));
      if(mode==='wake-restore')await page.evaluate(()=>window.testVisibility(false));
      releaseSearch();
      if(mode==='wake-restore'){
       await dock.getByText('Reconectando con Telegram…',{exact:true}).first().waitFor();
       await waitForWorker(()=>restoreFailures===1,12_000);
       await waitForWorker(()=>restores>=4,20_000);
      }
     }else if(mode==='cold-resume'||mode==='two-tabs'||mode==='stop-reload'){
      await waitForWorker(()=>trace.some(event=>event.kind==='read'&&event.title==='Pista 3'));
      if(mode==='stop-reload'){
       await handle.click();
       await dock.getByRole('button',{name:'Detener',exact:true}).click();
       await dock.getByText('Descarga pendiente · 2 de 4 guardadas',{exact:true}).waitFor();
      }
      const stored=await page.evaluate(account=>JSON.parse(localStorage.getItem('pulso:library-download:v1:'+account)),user);
      assert.equal(stored.autoResume,mode!=='stop-reload');
      assert.equal(stored.title,'Playlist pendiente');
      if(mode!=='stop-reload')await page.evaluate(account=>sessionStorage.setItem('testonly-orphan',JSON.stringify({
       tag:'pulso-download-collection',silent:true,data:{account,terminal:false},
      })),user);
      if(mode==='two-tabs'){
       other=await context.newPage();
       await other.goto(origin,{waitUntil:'commit'});
       await other.getByRole('button',{name:'Continuar',exact:true}).waitFor();
       assert.equal(await other.evaluate(()=>window.testNotifications.length),0);
       await other.getByRole('button',{name:'Continuar',exact:true}).press('Enter');
       await other.locator('.download-dock__message').getByText('Usa Pulso en esta pestaña para continuar la descarga.',{exact:true}).waitFor();
       assert.equal(thirdSearches(),1);
       await page.bringToFront();
      }
      await page.reload({waitUntil:'commit'});
      releaseSearch();cold=true;
      await page.locator('.shell-nav').waitFor();
      assert.equal(await page.getByRole('heading',{name:'Playlist pendiente'}).count(),0);
      if(mode==='stop-reload'){
       await dock.getByText('Descarga pendiente · 2 de 4 guardadas',{exact:true}).waitFor();
       await dock.getByRole('button',{name:'Continuar',exact:true}).waitFor();
       assert.equal(await page.getByRole('button',{name:'Continuar',exact:true}).count(),1);
       await page.locator('.bot-providers-list li').first().waitFor({state:'attached'});
       for(const tab of ['Buscar','Biblioteca']){
        await page.locator('.shell-nav').getByRole('button',{name:tab,exact:true}).click();
        assert.equal(await dock.getByRole('button',{name:'Continuar',exact:true}).count(),1);
       }
       assert.equal(thirdSearches(),1);
       assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('testonly-plays'))),0);
       assert.equal(await page.evaluate(()=>window.testNotifications.length),0);
       report.cases.push({engine,mode,status:'PASS'});continue;
      }
      await page.waitForFunction(()=>window.testDismissed.includes('pulso-download-collection'));
     }else if(mode==='paused-hidden'){
      await page.waitForFunction(()=>window.testNotifications.some(notice=>!notice.silent));
      assert.deepEqual(await page.evaluate(()=>window.testNotifications.filter(n=>!n.silent).map(n=>n.body)),
       ['2 de 4 guardadas · abre Pulso para continuar']);
      assert.equal(await page.evaluate(account=>JSON.parse(localStorage.getItem('pulso:library-download:v1:'+account)).autoResume,user),false);
      assert.equal(thirdSearches(),1);
      assert.equal(await page.evaluate(()=>document.visibilityState),'hidden');
      await advance(6000);
      assert.equal(await handle.getAttribute('aria-expanded'),'false');
      await dock.getByText(/Telegram pide esperar 30 min.*Pulsa Continuar/).waitFor();
      await page.getByRole('status').filter({hasText:/Descarga pendiente.*Telegram pide esperar 30 min/}).first().waitFor();
      await page.reload({waitUntil:'commit'});
      await dock.getByText(/Telegram pide esperar 30 min.*Pulsa Continuar/).waitFor();
      report.cases.push({engine,mode,status:'PASS'});continue;
     }else if(mode==='hidden-rejection'){
      await waitForWorker(()=>trace.some(e=>e.kind==='read'&&e.title==='Pista 3'));
     }else if(suspending){
      await waitForWorker(()=>thirdSearches()===1);
      await page.evaluate(()=>window.testVisibility(true));
      await advance(mode==='suspend-short'?30_000:240_000);
      assert.equal(thirdSearches(),1);
      assert.equal(trace.some(event=>event.title==='Pista 4'),false);
      releaseSearch();
      await page.evaluate(()=>window.testVisibility(false));
      await dock.getByText('Reconectando con Telegram…',{exact:true}).first().waitFor();
      await waitForWorker(()=>thirdSearches()>=2,12_000);
     }else if(mode==='uncertain-send'){
      await waitForWorker(()=>thirdSearches()>=2,12_000);
     }else if(mode==='reconnect'){
      await dock.getByText('Reconectando con Telegram…',{exact:true}).first().waitFor();
      await waitForWorker(()=>thirdSearches()>=2,12_000);
      await waitForWorker(()=>thirdSearches()>=3,20_000);
     }else{
      await dock.getByText(/Telegram pide esperar 5 min/).first().waitFor();
      assert.equal(thirdSearches(),1);
      if(mode==='stop'){
       await handle.click();
       await dock.getByRole('button',{name:'Detener',exact:true}).click();
       await dock.getByRole('button',{name:'Continuar',exact:true}).waitFor();
       await page.waitForFunction(()=>window.testDismissed.includes('pulso-download-collection'));
       assert.equal(thirdSearches(),1);
       assert.equal(await page.evaluate(()=>window.testNotifications.some(notice=>!notice.silent)),false);
       report.cases.push({engine,mode,status:'PASS'});continue;
      }
      await advance(280_000);
      assert.equal(thirdSearches(),1);
      assert.equal(trace.some(event=>event.title==='Pista 4'),false);
      await advance(25_000);
     }
    }
    const allSaved=channel||fallback||updating||['autoheal','cooldown','ack-lost','single'].includes(mode);
    const [reasonCount,reasonText]=reasons[mode]??reasons.invalid;
    const summary=singleMode?'1 de 1 guardadas':allSaved?'4 de 4 guardadas':`3 de 4 guardadas · ${reasonCount}`;
    await handle.getByText(summary,{exact:true}).waitFor({timeout:45000});
    assert.equal(await handle.getAttribute('aria-expanded'),'false');
    await handle.evaluate(button=>button.click());
    await panel.getByText('Descarga finalizada',{exact:true}).waitFor();
    assert.equal(await panel.locator('li').count(),singleMode?1:4);
    assert.equal(await page.locator('.library-detail .download-dock, .library-detail [aria-label="Revisión de descarga"]').count(),0);
    for(const label of ['Ver canciones','Continuar descarga de Biblioteca']){
     assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),0);
    }
    assert.doesNotMatch(await panel.innerText(),/\[D\d+\]/);
    if(channel||fallback)assert.equal(await panel.locator('li[data-failed=true]').count(),0);
    if(!allSaved){
     const failed=panel.locator(mode==='missing-metadata'?'li[data-failed=false]':'li[data-failed=true]').filter({hasText:'Pista 3'});
     await failed.getByText(reasonText,{exact:true}).waitFor();
     assert.equal(await panel.locator('li[data-failed=true]').count(),mode==='missing-metadata'?0:1);
    }
    const storage=dock.getByRole('button',{name:'Revisar en Almacenamiento',exact:true});
    assert.equal(await storage.count(),mode==='parked'?1:0);
    assert.equal(await dock.getByRole('button').count(),mode==='parked'?2:1);
    if(mode==='parked'){
     await storage.click();
     await dock.waitFor({state:'detached'});
     await page.locator('#download-copy-recovery, [aria-label="Almacenamiento"]').first().waitFor();
    }
    if(mode==='missing'){
     await page.screenshot({path:`${screenshots}/${engine}-390x844-final.png`});
     await dock.waitFor({state:'detached',timeout:6500});
    }
    const searches=trace.filter(e=>e.kind==='search');
    if(channel){
     assert.deepEqual(searches.map(event=>event.title),[...Array(mode==='reconnect'?3:mode==='background-alive'?1:2).fill('Pista 3'),'Pista 4']);
     if(other){
      await other.getByRole('button',{name:'Continuar',exact:true}).waitFor({state:'detached'});
      assert.equal(await other.evaluate(()=>window.testNotifications.length),0);
     }
     if(cold||mode==='background-alive'||autoUpdate)assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('testonly-plays'))),0);
     if(floodAt)assert.ok(searches[1].workerAt>=floodAt+300_000);
     if(mode==='hidden-rejection'){
      assert.equal(restores,restoresBeforeResume);
      assert.deepEqual(searches.map(event=>event.peer),[101,102,101]);
     }
     if(suspending||mode==='uncertain-send')assert.equal(searches[0].peer,searches[1].peer,'La pista se reintenta en el mismo bot');
     if(mode==='reconnect')assert.ok(restores>restoresBeforeResume,'expected the worker to restore the saved session');
     if(suspending||mode==='background-alive')assert.equal(await page.evaluate(()=>document.visibilityState),'hidden');
     if(mode!=='notifications-off')await page.waitForFunction(()=>window.testNotifications.some(notice=>!notice.silent));
     const notices=await page.evaluate(()=>window.testNotifications);
     if(mode==='notifications-off')assert.equal(notices.length,0);
     else{
      assert.ok(notices.some(notice=>notice.silent&&notice.body.includes('guardadas')));
      if(!backgroundModes.includes(mode)||mode==='wake-restore')
       assert.ok(notices.some(notice=>notice.body.includes((['reconnect','uncertain-send','wake-restore'].includes(mode)||suspending)?'Reconectando':'Telegram pide esperar')));
      assert.deepEqual(notices.filter(notice=>!notice.silent).map(notice=>notice.body),['4 de 4 guardadas']);
      assert.ok(notices.every(notice=>notice.tag==='pulso-download-collection'));
     }
    }else if(fallback){
     if(mode==='manual-lane-settled')assert.equal(await page.evaluate(()=>window.testManualSettledBeforeCollection),true);
     assert.deepEqual(searches.map(({title,peer})=>[title,peer]),mode.startsWith('manual-lane')?
      [['Pista 3',101],['Consulta manual',101],['Pista 3',101],['Pista 4',101]]:
      [['Pista 3',101],['Pista 3',102],['Pista 4',101]]);
     if(mode==='bot-timeout')assert.ok(searches[1].at-searches[0].at>=14_000,'the first bot stayed silent through its response deadline');
     const notices=await page.evaluate(()=>window.testNotifications);
     assert.ok(notices.every(notice=>!notice.body.includes('Reconectando')&&!notice.body.includes('Telegram pide esperar')));
     assert.equal(restores,restoresBeforeResume,'healthy transport should not restore during an isolated bot failure');
    }else assert.deepEqual(searches.map(e=>e.title),singleMode?['Pista 3','Pista 3']:mode==='parked'?['Pista 4']:mode==='ack-lost'?['Pista 3','Pista 4']:mode==='missing-metadata'?['Pista 1','Pista 2','Pista 4']:[...(fresh?['Pista 1','Pista 2']:[]),'Pista 3','Pista 3','Pista 4']);
    if(mode==='ack-lost'){
     const lost=await page.evaluate(()=>window.__TESTONLY_outcomes.filter(outcome=>outcome.type==='lost-ack'));
     assert.deepEqual(lost,[{type:'lost-ack',writeState:'published'}]);
    }
    if(mode==='missing')assert.equal(trace.some(e=>e.kind==='read'&&e.title==='Pista 3'),false);
    if(mode==='autoheal'||singleMode)assert.deepEqual(trace.filter(e=>e.kind==='read'&&e.title==='Pista 3').map(e=>e.peer),[101,102]);
    if(mode==='cooldown')assert.ok(searches[1].at-trace.find(e=>e.kind==='read'&&e.title==='Pista 3').at>=1900);
    if(mode==='staging'||mode==='parked'){
     const staging=await page.evaluate(async operationId=>{
      const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
      try{return await new Promise((resolve,reject)=>{
       const tx=db.transaction(['jobs','chunks']),job=tx.objectStore('jobs').get(operationId),chunk=tx.objectStore('chunks').get([operationId,0]);
       tx.oncomplete=()=>resolve({state:job.result?.state,hasChunk:chunk.result!==undefined});tx.onabort=()=>reject(tx.error);
      });}finally{db.close();}
     },operationId);
     assert.deepEqual(staging,mode==='parked'?{state:'cleanup',hasChunk:true}:{state:'discarded',hasChunk:false});
    }
    if(mode==='connected'&&process.env.PLAYLIST_TEST_PURGED_COPY==='1'){
     assert.equal(await page.evaluate(id=>window.testPurged&&window.testCopyState(id),ids[0]),'missing');
     await page.evaluate(audio=>window.testRestorePurgedCopy(audio),readyCopies[0].audio);
    }
    const copies=await page.evaluate(async ids=>{
     const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
     const read=(store,key)=>new Promise((resolve,reject)=>{
      const q=db.transaction(store).objectStore(store).get(key);
      q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
     });
     try{return await Promise.all(ids.map(async id=>{
      const track=await read('tracks',id);
      if(!track?.assetId)return null;
      const asset=await read('assets',track.assetId);
      if(asset?.state!=='complete')throw Error('Missing complete asset');
      const data=asset.backend==='opfs'
       ?await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('pulso-assets-v1')).getFileHandle(asset.storageKey)).getFile().then(file=>file.arrayBuffer())
       :(await read('chunks',[asset.storageKey,0])).buffer;
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');
      if(data.byteLength!==32044||digest!==asset.sha256||digest!==track.audioFingerprint.sha256)throw Error('Invalid stored bytes');
      return {id:asset.id,digest};
     }));}finally{db.close();}
    },ids);
    if(mode==='background-alive'){
     assert.deepEqual(trace.filter(e=>e.kind==='read').map(e=>e.title),['Pista 3','Pista 4']);
     const complete=await page.evaluate(()=>new Promise((resolve,reject)=>{
      const q=indexedDB.open('pulso-web-local-v1');
      q.onerror=()=>reject(q.error);q.onsuccess=()=>{
       const db=q.result,assets=db.transaction('assets').objectStore('assets').getAll();
       assets.onsuccess=()=>{db.close();resolve(assets.result.filter(asset=>asset.state==='complete').length);};
       assets.onerror=()=>{db.close();reject(assets.error);};
      };
     }));
     assert.equal(complete,4);
    }
    const linked=copies.map(Boolean);
    assert.deepEqual(linked,singleMode?[false,false,true,false]:[true,true,allSaved,true]);
    if(singleMode)assert.equal(await page.evaluate(({user,id})=>localStorage.getItem('pulso:library-download-held:v1:'+user+':'+id),{user,id:ids[2]}),null);
    assert.equal(new Set(copies.filter(Boolean).map(copy=>copy.id)).size,linked.filter(Boolean).length);
    assert.deepEqual(copies.map((copy,index)=>copy?.digest??null),linked.map((saved,index)=>
     saved?digest(fixtureWav(!fresh&&index<2?index+1:index+11)):null));
    if(updating){
     if(singleMode||autoUpdate)assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('testonly-plays'))),0);
     const opened=['/testonly-seed','/'];
     if(!fresh)opened.push('/');
     if(updateDownload)opened.push(next.entry);
     assert.deepEqual(navigations,opened);
     assert.equal(await page.locator('html').getAttribute('data-test-build'),updateDownload?'new':'old');
     if(updateDownload){
      await page.getByRole('button',{name:'Configuración',exact:true}).click();
      await page.getByText('Versión en ejecución: '+next.id.slice(0,8),{exact:true}).waitFor();
     }
    }
    report.cases.push({engine,mode,searches:searches.map(e=>e.title),linked,fallbackDelayMs,status:'PASS'});
   }catch(error){releaseStartupProbe();report.cases.push({engine,mode,status:'FAIL',error:String(error.stack??error),trace:trace.map(({kind,title,workerAt})=>({kind,title,workerAt})),dock:await page?.locator('.download-dock').textContent({timeout:500}).catch(()=>null),outcomes:await page?.evaluate(()=>window.__TESTONLY_outcomes).catch(()=>[]),notices:await page?.evaluate(()=>window.testUpdateNotices).catch(()=>[])});}
   finally{
    const result=report.cases.at(-1);
    if(result?.engine===engine&&result.mode===mode){
     console.log(`${engine} ${mode} ${result.status}`);
     if(result.error)console.log(JSON.stringify(result));
    }
    releaseRestore();releaseSearch();releaseStartupProbe();await context.close();
   }
  }}finally{await browser.close();}
 }
 assert.equal(report.external.length,0);
}catch(error){report.errors.push(String(error.stack??error));}
finally{
 if(server)await new Promise(resolve=>server.httpServer.close(resolve));
 if(oldTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTemp;
 await tempDirectory?.close();
 report.cleanup=await work.cleanup();
 report.status=report.cases.length===modes.length*(process.env.PLAYLIST_RESUME_ENGINE?1:2)&&report.cases.every(c=>c.status==='PASS')&&!report.errors.length?'PASS':'FAIL';
 await writeFile(work.evidence+'/report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({report:work.evidence+'/report.json',...report},null,2));
 if(report.status!=='PASS')process.exitCode=1;
}
