import assert from 'node:assert/strict';
import {mkdir,mkdtemp,open,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import {chromium,webkit} from 'playwright-core';
import {build,preview} from 'vite';
import {installRequiredAccountFixture} from './required-account-fixture.mjs';
import {createTestWorkspace} from './test-workspace.mjs';

const fixture='tests/integration/player-notice-fixture.html';
const workspace=await createTestWorkspace('player-notice');
const report={cases:[],errors:[],requests:[],media:[],engines:{}};
const restoredTitle='Sintética 2';
const errorText='No se pudo leer el audio.';
const wave=Buffer.alloc(480044);
wave.write('RIFF',0);wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);
wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);
wave.writeUInt32LE(8000,24);wave.writeUInt32LE(16000,28);wave.writeUInt16LE(2,32);
wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(wave.length-44,40);

let server,profileDirectory,engine;
const previousTemp=process.env.TMPDIR;
function media(req,res,next){
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname!=='/__player-notice.wav')return next();
 const mode=url.searchParams.get('mode'),attempt=Number(url.searchParams.get('attempt'));
 if(mode==='persistent'||mode==='transient'&&attempt===1){
  report.requests.push({engine,mode,attempt,status:503});
  res.writeHead(503,{'Cache-Control':'no-store'});res.end();return;
 }
 const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');
 const start=range?Number(range[1]):0,end=range?.[2]?Math.min(wave.length-1,Number(range[2])):wave.length-1;
 if(start>end){res.writeHead(416,{'Content-Range':`bytes */${wave.length}`});res.end();return;}
 const body=wave.subarray(start,end+1),status=range?206:200;
 report.requests.push({engine,mode,attempt,status});
 res.writeHead(status,{'Content-Type':'audio/wav','Content-Length':body.length,'Cache-Control':'no-store','Accept-Ranges':'bytes',
  ...(range?{'Content-Range':`bytes ${start}-${end}/${wave.length}`}:{})});
 res.end(req.method==='HEAD'?undefined:body);
}

async function check(name,run){
 try{await run();report.cases.push({engine,name,status:'PASS'});}
 catch(error){report.cases.push({engine,name,status:'FAIL',error:String(error.stack??error)});}
 console.log(engine,report.cases.at(-1).status,name,report.cases.at(-1).error?.split('\n')[0]??'');
}

async function restore(page,origin,mode){
 await page.goto(origin+'/'+fixture,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof window.setupCollectionFixture==='function');
 await page.evaluate(async mode=>{
  await window.setupCollectionFixture();
  const trackId=JSON.parse(sessionStorage.getItem('test-own-fixture')).rows[2].track;
  const db=await new Promise((resolve,reject)=>{
   const request=indexedDB.open('pulso-web-local-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  try{await new Promise((resolve,reject)=>{
   const tx=db.transaction('settings','readwrite');
   tx.objectStore('settings').put({version:1,entries:[{id:'test-occurrence',trackId}],currentEntryId:'test-occurrence',
    position:2,repeat:'off',shuffleOrder:null},'library-playback');
   tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
  sessionStorage.setItem('test-player-notice-mode',mode);
 },mode);
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.locator('.mini-player__title').filter({hasText:restoredTitle}).waitFor();
}

async function openPlayer(page){
 await page.getByRole('button',{name:'Abrir reproductor desde minirreproductor'}).click();
 const surface=page.getByRole('dialog',{name:'Reproductor',exact:true});
 await surface.getByRole('heading',{name:restoredTitle,exact:true}).waitFor();
 return surface;
}

const inspect=surface=>surface.evaluate(el=>Array.from(el.querySelectorAll('[role=status]')).flatMap(node=>{
 if(!node.textContent?.trim()||node.closest('[hidden]'))return [];
 const css=getComputedStyle(node),{width,height}=node.getBoundingClientRect();
 return [{text:node.textContent,clipped:css.position==='absolute'&&width<=1&&height<=1&&css.clipPath!=='none'}];
}));
const state=page=>page.evaluate(()=>{
 const {audio,loads,plays,errors}=window.playerNotice;
 return {loads,plays,errors,paused:audio.paused,ready:audio.readyState,position:audio.currentTime};
});
const waitMetadata=page=>page.waitForFunction(()=>window.playerNotice.audio.readyState>=1&&Math.abs(window.playerNotice.audio.currentTime-2)<.15);
const mediaStatus=(surface,text)=>surface.getByRole('status').filter({hasText:text});

try{
 const profiles=resolve(workspace.dir,'profiles'),out=resolve(workspace.dir,'bundle');
 await mkdir(profiles);profileDirectory=await open(profiles);
 await build({configFile:false,plugins:[tailwindcss()],logLevel:'error',build:{outDir:out,
  rolldownOptions:{input:[resolve('index.html'),resolve(fixture)]}}});
 server=await preview({configFile:false,build:{outDir:out},preview:{host:'127.0.0.1',port:0},
  plugins:[{name:'player-notice-audio-fixture',configurePreviewServer(server){server.middlewares.use(media);}}]});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 for(const [name,launcher] of Object.entries({chromium,webkit})){
  engine=name;
  process.env.TMPDIR=name==='chromium'?`/proc/${process.pid}/fd/${profileDirectory.fd}`:profiles;
  const launch={headless:true,proxy:{server:'http://127.0.0.1:9',bypass:'127.0.0.1,localhost'}};
  const browser=name==='chromium'?await launcher.launch({...launch,executablePath:'/usr/bin/chromium',chromiumSandbox:true}):null;
  const inPage=async(mode,run)=>{
   const options={viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:'block'};
   // Keep WebKit's restored IndexedDB state on an isolated, disposable profile.
   const profile=browser?null:await mkdtemp(resolve(profiles,'webkit-'));
   let context;
   try{
    context=browser?await browser.newContext(options):await launcher.launchPersistentContext(profile,{...launch,...options});
    report.engines[name]=context.browser().version();
    await context.route('**/*',route=>{
     const url=new URL(route.request().url());
     if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();
     const headers={'access-control-allow-origin':'*','access-control-allow-headers':'Lrclib-Client'};
     if(url.origin==='https://lrclib.net')return route.fulfill({json:[],headers});
     if(url.origin==='https://itunes.apple.com')return route.fulfill({json:{resultCount:0,results:[]},headers});
     report.errors.push({engine,external:url.origin});return route.abort();
    });
    await installRequiredAccountFixture(context,origin);
    await context.addInitScript(()=>{
     try{delete Navigator.prototype.serviceWorker;}catch{}
     const NativeAudio=window.Audio;
     const mediaSrc=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
     window.Audio=function(...args){
      const audio=new NativeAudio(...args);
      const mode=sessionStorage.getItem('test-player-notice-mode');
      const trace=window.playerNotice={audio,loads:0,plays:0,errors:[]};
      let preparedBlob='';
      const play=audio.play.bind(audio),load=audio.load.bind(audio);
      audio.play=()=>{trace.plays++;return play();};
      if(mode){
       // Keep the registry's verified Blob identity. Feed the actual element a
       // synthetic same-origin HTTP source for native metadata/error events.
       Object.defineProperty(audio,'src',{
        get:()=>preparedBlob||mediaSrc.get.call(audio),
        set(value){preparedBlob=value.startsWith('blob:')?value:'';mediaSrc.set.call(audio,value);},
       });
       audio.load=()=>{
        if(preparedBlob)mediaSrc.set.call(audio,`/__player-notice.wav?mode=${mode}&attempt=${++trace.loads}`);
        load();
       };
      }
      audio.addEventListener('error',event=>{
       if(preparedBlob)trace.errors.push({code:audio.error?.code??null,
        native:event.isTrusted,open:document.querySelector('#player')?.dataset.open==='true'});
      });
      return audio;
     };
     window.Audio.prototype=NativeAudio.prototype;
    });
    const page=context.pages()[0]??await context.newPage();
    page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(30000);
    page.on('pageerror',error=>report.errors.push({engine,error:String(error)}));
    await restore(page,origin,mode);
    await run(page);
   }finally{
    await context?.close();
    if(profile)await rm(profile,{recursive:true});
   }
  };
  try{
   await check('N01 · Avisos del shell, espera y favorito sin espacio visible',()=>inPage('normal',async page=>{
    await waitMetadata(page);
    const surface=await openPlayer(page);
    await page.evaluate(()=>playerNotice.audio.dispatchEvent(new Event('waiting')));
    await mediaStatus(surface,'Esperando audio…').waitFor({state:'attached'});
    const pending=await inspect(surface);
    assert.ok(pending.some(row=>row.text.includes('Cola lista y pausada.')),JSON.stringify(pending));
    await surface.getByRole('button',{name:'Quitar canción actual de Favoritos'}).click();
    await mediaStatus(surface,'Quitada de Favoritos.').waitFor({state:'attached'});
    const settled=await inspect(surface);
    assert.deepEqual([...pending,...settled].filter(row=>!row.clipped),[]);
    await surface.getByRole('button',{name:'Cerrar reproductor'}).click();
    await mediaStatus(page.locator('.mini-player'),'Cola lista y pausada.').waitFor();
   }));
   await check('N02 · Canales persistentes de lector de pantalla',()=>inPage('normal',async page=>{
    await waitMetadata(page);
    const surface=await openPlayer(page);
    const channels=await surface.locator('.now-playing-view').evaluate(el=>{
     window.initialPlayerLiveRegions=Array.from(el.querySelectorAll('[role=status][aria-live=polite]'));
     return window.initialPlayerLiveRegions.length;
    });
    assert.equal(channels,2,'se mantienen dos regiones vivas incluso antes de recibir texto');
    await page.evaluate(()=>playerNotice.audio.dispatchEvent(new Event('waiting')));
    await mediaStatus(surface,'Esperando audio…').waitFor({state:'attached'});
    await surface.getByRole('button',{name:'Quitar canción actual de Favoritos'}).click();
    await mediaStatus(surface,'Quitada de Favoritos.').waitFor({state:'attached'});
    assert.equal(await surface.evaluate(()=>window.initialPlayerLiveRegions.every(node=>node.isConnected&&node.textContent)),true);
    const tree=await surface.ariaSnapshot();
    assert.match(tree,/status: Esperando audio/);assert.match(tree,/status: Quitada de Favoritos/);
   }));
   await check('N03a · Un aviso de error sin MediaError vigente se descarta',()=>inPage('normal',async page=>{
    await waitMetadata(page);
    await page.evaluate(()=>{
     if(playerNotice.audio.error!==null)throw Error('Se esperaba un medio sano');
     playerNotice.audio.dispatchEvent(new Event('error'));
    });
    const surface=await openPlayer(page),audio=await state(page);
    report.media.push({engine,case:'N03a',audio,announcements:await mediaStatus(surface,errorText).count()});
    assert.deepEqual(audio.errors,[{code:null,native:false,open:false}]);
    assert.equal(audio.loads,1);assert.equal(audio.plays,0);
    assert.equal(await mediaStatus(surface,errorText).count(),0);
   }));
   await check('N03b · Un fallo nativo de precarga se recupera una vez y sigue en pausa',()=>inPage('transient',async page=>{
    await page.waitForFunction(()=>window.playerNotice.errors.length>0);
    const first=await state(page);
    report.media.push({engine,case:'N03b before opening',audio:first});
    assert.ok(first.errors[0].native&&first.errors[0].code>0&&!first.errors[0].open&&first.plays===0,JSON.stringify(first));
    const surface=await openPlayer(page);
    await waitMetadata(page);
    const audio=await state(page);
    report.media.push({engine,case:'N03b recovered',audio});
    assert.equal(audio.errors.length,1);
    assert.equal(audio.loads,2);assert.equal(audio.plays,0);assert.equal(audio.paused,true);
    assert.equal(await mediaStatus(surface,errorText).count(),0);
    await surface.getByRole('button',{name:'Reproducir',exact:true}).click();
    await page.waitForFunction(()=>!window.playerNotice.audio.paused&&window.playerNotice.audio.currentTime>2);
    assert.equal((await state(page)).loads,2);
   }));
   await check('N03c · Un fallo nativo persistente se detiene tras un único intento adicional',()=>inPage('persistent',async page=>{
    await page.waitForFunction(()=>window.playerNotice.errors.length>=2);
    const surface=await openPlayer(page);
    await mediaStatus(surface,errorText).waitFor({state:'attached'});
    await page.waitForTimeout(350);
    const audio=await state(page);
    report.media.push({engine,case:'N03c',audio});
    assert.equal(audio.loads,2);assert.equal(audio.plays,0);assert.equal(audio.paused,true);
    assert.equal(audio.errors.length,2);assert.ok(audio.errors.every(error=>error.native&&error.code>0));
    assert.deepEqual((await inspect(surface)).filter(row=>!row.clipped),[]);
   }));
  }finally{await browser?.close();}
 }
}catch(error){report.fatal=String(error.stack??error);}
finally{
 if(server)await new Promise((done,reject)=>server.httpServer.close(error=>error?reject(error):done()));
 if(previousTemp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTemp;
 await profileDirectory?.close();
 report.cleanup=await workspace.cleanup();
 await writeFile(resolve(workspace.evidence,'report.json'),JSON.stringify(report,null,2));
 console.log(workspace.evidence);
 if(report.fatal||report.errors.length||report.cases.length!==10||report.cases.some(item=>item.status==='FAIL')){
  console.error(report.fatal??JSON.stringify(report.errors));process.exitCode=1;
 }
}
