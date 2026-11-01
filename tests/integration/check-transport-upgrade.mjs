import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {preview} from 'vite';
import {chromium} from 'playwright-core';
let server,browser;
const report={passed:false,iphoneVerified:false};
try{
 server=await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 const context=await browser.newContext();
 await context.addInitScript(()=>{
  window.pulsoUpgrade={capabilityDropped:0,ticketRequests:0,audio:[],forcedActivation:0};
  const post=ServiceWorker.prototype.postMessage;
  ServiceWorker.prototype.postMessage=function(message,...args){
   if(message?.type==='transport-capabilities'){window.pulsoUpgrade.capabilityDropped++;return;}
   if(message?.type==='fixture-tickets')window.pulsoUpgrade.ticketRequests++;
   if(message?.type==='SKIP_WAITING')window.pulsoUpgrade.forcedActivation++;
   return post.call(this,message,...args);
  };
  const AudioBase=window.Audio;window.Audio=class extends AudioBase{constructor(...args){super(...args);window.pulsoUpgrade.audio.push(this);}};
 });
 const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
 await page.waitForFunction(()=>{const i=document.querySelector('input[type=file]');return i instanceof HTMLInputElement&&!i.disabled;});
 await page.getByLabel('Importar audios',{exact:true}).setInputFiles(resolve('public/fixtures/A.mp3'));
 await page.getByRole('status').filter({hasText:'1 importadas, 0 ya existentes.'}).waitFor();
 await page.locator('.tracks>li').first().getByRole('button',{name:/^Escuchar /}).click();
 await page.getByRole('status').filter({hasText:'Modo compatible para archivos pequeños.'}).waitFor();
 await page.getByRole('region',{name:'Reproductor',exact:true}).getByRole('button',{name:'Reproducir',exact:true}).click();
 await page.waitForFunction(()=>window.pulsoUpgrade.audio.length===1&&!window.pulsoUpgrade.audio[0].paused);
 const result=await page.evaluate(()=>({capabilityDropped:window.pulsoUpgrade.capabilityDropped,ticketRequests:window.pulsoUpgrade.ticketRequests,forcedActivation:window.pulsoUpgrade.forcedActivation,sourceIsBlob:window.pulsoUpgrade.audio[0].src.startsWith('blob:'),oneEngine:window.pulsoUpgrade.audio.length===1}));
 assert.equal(result.capabilityDropped,1);assert.equal(result.ticketRequests,0);assert.equal(result.forcedActivation,0);assert.equal(result.sourceIsBlob,true);assert.equal(result.oneEngine,true);
 report.result=result;report.passed=true;await context.close();
}finally{await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));console.log(JSON.stringify(report));}
