import {build} from 'vite';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const out=resolve('.local/favorite-player-build');
await build({configFile:false,logLevel:'error',build:{outDir:out,rolldownOptions:{input:{main:resolve('index.html'),fixture:resolve('tests/integration/collection-removal-final-main-fixture.html')}}}});
const server=spawn('python3',['-m','http.server','4178','--bind','127.0.0.1','--directory',out],{stdio:'ignore'});let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4178/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});const context=await browser.newContext({serviceWorkers:'block'});context.setDefaultTimeout(20000);
 await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await context.addInitScript(()=>{try{delete Navigator.prototype.serviceWorker}catch{};window.testAudios=[];const A=window.Audio;window.Audio=class extends A{constructor(...args){super(...args);window.testAudios.push(this);}};});
 const page=await context.newPage();await page.goto('http://127.0.0.1:4178/tests/integration/collection-removal-final-main-fixture.html');await page.waitForFunction(()=>!!window.setupCollectionFixture);await page.evaluate(()=>window.setupCollectionFixture());
 const fixture=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('test-own-fixture')));const id=fixture.retained[0].track;
 await page.goto('http://127.0.0.1:4178/');await page.locator('.shell-nav').getByRole('button',{name:'Buscar',exact:true}).click();
 await page.locator('.music-search input[type=search]').fill('Sonido sintético');await page.locator('.music-search-catalog [data-catalog-kind=track]').filter({hasText:'Sonido sintético'}).first().click();await page.waitForFunction(()=>window.testAudios.length===1&&!!window.testAudios[0].currentSrc&&!window.testAudios[0].paused);
 await page.locator('.mini-player').getByRole('button',{name:'Abrir reproductor desde minirreproductor'}).click();const add=page.getByRole('button',{name:'Añadir canción actual a Favoritos'});await add.waitFor();
 const before=await page.evaluate(()=>({src:window.testAudios[0].currentSrc,time:window.testAudios[0].currentTime}));await add.click();await page.getByRole('button',{name:'Quitar canción actual de Favoritos'}).waitFor();
 const read=()=>page.evaluate(async id=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('pulso-web-local-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const x=await new Promise((resolve,reject)=>{const r=db.transaction('tracks').objectStore('tracks').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return x;},id);
 assert.equal((await read()).favorite,true);assert.equal(await page.evaluate(x=>window.testAudios.length===1&&window.testAudios[0].currentSrc===x&&!window.testAudios[0].paused,before.src),true);await page.waitForFunction(t=>window.testAudios[0].currentTime>t,before.time);assert.equal(await page.locator('.now-playing-view').getAttribute('data-view'),'player');
 await page.reload();await page.locator('.shell-nav').waitFor();assert.equal((await read()).favorite,true);console.log('PASS: main real, audio continuo, favorito IndexedDB y recarga');
}finally{await browser?.close();server.kill();}
