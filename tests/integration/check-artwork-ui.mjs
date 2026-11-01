import assert from 'node:assert/strict';
import {preview} from 'vite';
import {chromium} from 'playwright-core';

let server,browser,page;
const report={passed:false,cases:[],iphoneVerified:false};
try{
 server=await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 const context=await browser.newContext();
 await context.addInitScript(()=>{
  window.pulsoArtworkUi={audio:[],violations:[],revoked:[]};const NativeAudio=window.Audio;
  const revoke=URL.revokeObjectURL;URL.revokeObjectURL=function(url){window.pulsoArtworkUi.revoked.push(url);return revoke.call(this,url);};
  window.Audio=class extends NativeAudio{constructor(...args){super(...args);window.pulsoArtworkUi.audio.push(this);}};
  document.addEventListener('securitypolicyviolation',event=>window.pulsoArtworkUi.violations.push(event.violatedDirective));
 });
 page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.name));await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
 const fixtures=await page.evaluate(async()=>{
  const make=async(width,height,color)=>{const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,width,height);const blob=await new Promise(r=>c.toBlob(r,'image/png'));return [...new Uint8Array(await blob.arrayBuffer())];};
  const cover=await make(16,12,'#2857a3'),manual=await make(10,10,'#ac3840');
  const raw=new Uint8Array(await(await fetch('/fixtures/A.mp3')).arrayBuffer());
  const offset=new TextDecoder().decode(raw.subarray(0,3))==='ID3'?10+raw[6]*2097152+raw[7]*16384+raw[8]*128+raw[9]:0;
  const text=s=>new TextEncoder().encode(s),sync=n=>new Uint8Array([n>>>21&127,n>>>14&127,n>>>7&127,n&127]);
  const join=(...arrays)=>{const result=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let p=0;for(const a of arrays){result.set(a,p);p+=a.length;}return result;};
  const frame=(id,body)=>join(text(id),sync(body.length),new Uint8Array(2),body);
  const tag=join(frame('TIT2',join(new Uint8Array([3]),text('Canción propia ñ 🎵'))),frame('APIC',join(new Uint8Array([3]),text('image/png'),new Uint8Array([0,3,0]),new Uint8Array(cover))));
  return {cover,manual,audio:[...join(text('ID3'),new Uint8Array([4,0,0]),sync(tag.length),tag,raw.slice(offset))]};
 });
 const audioFile={name:'Propio.mp3',mimeType:'audio/mpeg',buffer:Buffer.from(fixtures.audio)};
 const input=page.getByLabel('Importar audios',{exact:true});
 await page.waitForFunction(()=>{const input=document.querySelector('input[type=file]');return input instanceof HTMLInputElement&&!input.disabled;});
 await input.setInputFiles(audioFile);await page.getByRole('status').filter({hasText:'1 importadas, 0 ya existentes.'}).waitFor();
 const row=page.locator('.tracks>li').first();
 const image=row.getByRole('img',{name:'Portada de Canción propia ñ 🎵',exact:true});
 const imageReady=async(width,height)=>{await row.scrollIntoViewIfNeeded();await image.waitFor();await page.waitForFunction(({width,height})=>{const img=document.querySelector('.tracks>li img');return img&&img.complete&&img.naturalWidth===width&&img.naturalHeight===height;},{width,height});};
 const imagePixel=()=>image.evaluate(img=>{const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(0,0,1,1).data];});
 await imageReady(16,12);assert.deepEqual(await imagePixel(),[40,87,163,255]);
 report.cases.push({name:'embedded Unicode APIC rendered under production CSP',passed:true});
 await row.getByText('Editar portada',{exact:true}).click();
 await row.getByLabel('Elegir portada para Canción propia ñ 🎵',{exact:true}).setInputFiles({name:'Propia.png',mimeType:'image/png',buffer:Buffer.from(fixtures.manual)});
 await row.getByText('Portada elegida manualmente',{exact:true}).waitFor();await imageReady(10,10);
 assert.deepEqual(await imagePixel(),[172,56,64,255]);
 const oldUrl=await image.getAttribute('src');
 await input.setInputFiles(audioFile);await page.getByRole('status').filter({hasText:'0 importadas, 1 ya existentes.'}).waitFor();await imageReady(10,10);assert.deepEqual(await imagePixel(),[172,56,64,255]);
 assert.equal(await page.evaluate(url=>window.pulsoArtworkUi.revoked.includes(url),oldUrl),true,'old image URL released after refresh');
 await page.reload();await row.scrollIntoViewIfNeeded();await row.getByText('Portada elegida manualmente',{exact:true}).waitFor();await imageReady(10,10);assert.deepEqual(await imagePixel(),[172,56,64,255]);
 report.cases.push({name:'manual selection survives binary reimport and page reopen; old URL revoked',passed:true});
 await row.getByRole('button',{name:'Escuchar Canción propia ñ 🎵',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
 const player=page.getByRole('region',{name:'Reproductor',exact:true});
 await player.getByLabel(/Repetición/).selectOption('one');await player.getByRole('button',{name:'Reproducir',exact:true}).click();
 await page.waitForFunction(()=>window.pulsoArtworkUi.audio.length===1&&!window.pulsoArtworkUi.audio[0].paused);
 await row.getByText('Editar portada',{exact:true}).click();
 await row.getByRole('button',{name:'Ocultar portada',exact:true}).click();await row.getByText('Portada ocultada manualmente',{exact:true}).waitFor();
 const engine=await page.evaluate(()=>({count:window.pulsoArtworkUi.audio.length,playing:!window.pulsoArtworkUi.audio[0].paused}));assert.deepEqual(engine,{count:1,playing:true});assert.equal(await image.count(),0);
 await player.getByRole('button',{name:'Pausar',exact:true}).click();
 await input.setInputFiles(audioFile);await page.getByRole('status').filter({hasText:'0 importadas, 1 ya existentes.'}).waitFor();await row.getByText('Portada ocultada manualmente',{exact:true}).waitFor();assert.equal(await image.count(),0);
 report.cases.push({name:'manual hide persists after reimport and does not replace or pause audio engine',passed:true});
 await row.getByLabel('Elegir portada para Canción propia ñ 🎵',{exact:true}).setInputFiles({name:'hostil.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg><script>throw 1</script></svg>')});
 await row.getByRole('status').filter({hasText:'Elige una imagen PNG, JPEG o WebP válida.'}).waitFor();
 await row.getByText('Portada ocultada manualmente',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.pulsoArtworkUi.violations),[]);
 report.cases.push({name:'hostile image rejected while previous manual state and CSP remain intact',passed:true});
 await page.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('pulso-web-local-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{
   const db=request.result,tx=db.transaction(['tracks','settings'],'readwrite');const records=tx.objectStore('tracks').getAll();
   records.onsuccess=()=>{const key='artwork:v1:'+records.result[0].id;const cover=tx.objectStore('settings').get(key);cover.onsuccess=()=>tx.objectStore('settings').put({...cover.result,version:999},key);};
   tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};
  };
 }));
 await page.reload();await row.scrollIntoViewIfNeeded();await row.getByText(/^Portada no disponible\./).waitFor();await row.getByText('Editar portada',{exact:true}).click();
 const choose=row.getByLabel('Elegir portada para Canción propia ñ 🎵',{exact:true});assert.equal(await choose.isDisabled(),false);
 await choose.setInputFiles({name:'Reparación.png',mimeType:'image/png',buffer:Buffer.from(fixtures.manual)});
 await row.getByText('Portada elegida manualmente',{exact:true}).waitFor();await imageReady(10,10);assert.deepEqual(await imagePixel(),[172,56,64,255]);
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.pulsoArtworkUi.violations),[]);
 report.cases.push({name:'damaged artwork record replaced explicitly with observed repair token through UI',passed:true});
 report.passed=true;await context.close();
}catch(error){report.failure={error:error.message,status:page&&!page.isClosed()?await page.getByRole('status').allTextContents():[]};throw error;}
finally{await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));console.log(JSON.stringify(report));}
