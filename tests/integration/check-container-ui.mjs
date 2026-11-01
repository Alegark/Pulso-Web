import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {preview} from 'vite';
import {chromium} from 'playwright-core';

let server,context,profile,page;
const report={passed:false,cases:[],iphoneVerified:false};
try{
 server=await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 await mkdir('.local/browser-profiles',{recursive:true});profile=await mkdtemp(join('.local/browser-profiles','covers-'));
 const launch=()=>chromium.launchPersistentContext(profile,{executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});
 context=await launch();report.browserVersion=context.browser().version();
 const init=()=>context.addInitScript(()=>{window.pulsoContainerAudio=[];const NativeAudio=window.Audio;window.Audio=class extends NativeAudio{constructor(...args){super(...args);window.pulsoContainerAudio.push(this);}};});await init();
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 page=await context.newPage();await page.goto(origin);
 const files=await page.evaluate(async()=>{
  const text=s=>new TextEncoder().encode(s),n32=(n,le=false)=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,le);return b;};
  const join=(...parts)=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){b.set(p,o);o+=p.length;}return b;};
  const box=(name,b)=>join(n32(b.length+8),text(name),b),ascii=(b,p,n)=>new TextDecoder().decode(b.subarray(p,p+n));
  const canvas=document.createElement('canvas');canvas.width=24;canvas.height=16;const c=canvas.getContext('2d');c.fillStyle='#307bad';c.fillRect(0,0,24,16);
  const png=new Uint8Array(await(await new Promise(r=>canvas.toBlob(r,'image/png'))).arrayBuffer());
  const base=new Uint8Array(await(await fetch('/fixtures/B.m4a')).arrayBuffer()),view=new DataView(base.buffer);
  let moov=-1,mdat=-1,count=0;for(let p=0;p<base.length;){if(++count>128)throw new Error('fixture boxes');const size=view.getUint32(p);if(size<8||size>base.length-p)throw new Error('fixture size');const kind=ascii(base,p+4,4);if(kind==='moov')moov=p;if(kind==='mdat')mdat=p;p+=size;}
  if(!(moov>mdat&&mdat>=0&&moov+view.getUint32(moov)===base.length))throw new Error('fixture requires final moov so audio offsets remain intact');
  const parts=[];for(let p=moov+8;p<base.length;){const size=view.getUint32(p);if(size<8||size>base.length-p)throw new Error('fixture child');if(ascii(base,p+4,4)!=='udta')parts.push(base.slice(p,p+size));p+=size;}
  const mp4=join(base.slice(0,moov),box('moov',join(...parts,box('udta',box('meta',join(new Uint8Array(4),box('ilst',box('covr',box('data',join(n32(14),n32(0),png))))))))));
  const sync=n=>new Uint8Array([n>>>21&127,n>>>14&127,n>>>7&127,n&127]);
  const payload=join(new Uint8Array([3]),text('image/png'),new Uint8Array([0,3,0]),png),frame=join(text('APIC'),sync(payload.length),new Uint8Array(2),payload);
  const id3=join(text('ID3'),new Uint8Array([4,0,0]),sync(frame.length),frame);
  const chunk=(name,b)=>join(text(name),n32(b.length,true),b,new Uint8Array(b.length%2));
  const fmt=join(new Uint8Array([1,0,1,0]),n32(8000,true),n32(16000,true),new Uint8Array([2,0,16,0]));
  const pcm=new Uint8Array(64000),pcmView=new DataView(pcm.buffer);for(let p=0;p<pcm.length;p+=2)pcmView.setInt16(p,Math.round(1000*Math.sin(p*Math.PI/20)),true);
  const wave=join(text('WAVE'),chunk('fmt ',fmt),chunk('data',pcm),chunk('ID3 ',id3));
  return {mp4:[...mp4],wav:[...join(text('RIFF'),n32(wave.length,true),wave)]};
 });
 await page.waitForFunction(()=>{const i=document.querySelector('input[type=file]');return i instanceof HTMLInputElement&&!i.disabled;});
 await page.getByLabel('Importar audios',{exact:true}).setInputFiles([{name:'M4A propio.m4a',mimeType:'audio/mp4',buffer:Buffer.from(files.mp4)},{name:'WAV propio.wav',mimeType:'audio/wav',buffer:Buffer.from(files.wav)}]);
 await page.getByRole('status').filter({hasText:'2 importadas, 0 ya existentes.'}).waitFor();
 const checkCover=async index=>{
  const row=page.locator('.tracks>li').nth(index);await row.scrollIntoViewIfNeeded();await row.getByRole('img').waitFor();
  await page.waitForFunction(index=>{const img=document.querySelectorAll('.tracks>li')[index]?.querySelector('img');return img&&img.complete&&img.naturalWidth===24&&img.naturalHeight===16;},index);
  const pixels=await row.getByRole('img').evaluate(img=>{if(!img.complete||img.naturalWidth!==24||img.naturalHeight!==16)throw new Error('cover not rendered');const c=document.createElement('canvas');c.width=24;c.height=16;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(0,0,1,1).data];});assert.deepEqual(pixels,[48,123,173,255]);
 };
 for(const [index,format]of ['M4A','WAV'].entries()){
  await checkCover(index);const row=page.locator('.tracks>li').nth(index);await row.getByRole('button',{name:/^Escuchar /}).click();await page.getByRole('status').filter({hasText:'Cola lista y pausada.'}).waitFor();
  const player=page.getByRole('region',{name:'Reproductor',exact:true});await player.getByRole('button',{name:'Reproducir',exact:true}).click();
  await page.waitForFunction(()=>{const audio=window.pulsoContainerAudio[0];return window.pulsoContainerAudio.length===1&&audio&&!audio.paused&&!audio.error&&audio.currentTime>0&&Number.isFinite(audio.duration)&&audio.duration>0;});
  await player.getByRole('button',{name:'Pausar',exact:true}).click();report.cases.push({format,coverRendered:true,nativeMediaTimeAdvanced:true,oneEngine:true});
 }
 await context.close();context=await launch();await init();await context.setOffline(true);page=await context.newPage();await page.goto(origin);
 for(let index=0;index<2;index++)await checkCover(index);
 assert.equal(await page.evaluate(()=>window.pulsoContainerAudio.length===1&&window.pulsoContainerAudio[0].paused),true);
 report.offlineCoversAfterChromiumRestart=true;report.passed=true;
}catch(error){report.failure={error:error.message,status:page&&!page.isClosed()?await page.getByRole('status').allTextContents():[]};throw error;}
finally{await context?.close();if(profile)await rm(profile,{recursive:true,force:true});if(server)await new Promise(resolve=>server.httpServer.close(resolve));console.log(JSON.stringify(report));}
