// Focused long-text CSS regression against the frozen baseline, with the exact
// current source stylesheet injected only into this own test context.
import assert from 'node:assert/strict';
import {preview} from 'vite';
import {chromium} from 'playwright-core';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const product=process.env.PULSO_QUALITY_PRODUCT==='1';
const report={passed:false,environment:'Chromium Linux sandbox, temporary loopback, frozen baseline plus current source CSS',iphoneVerified:false,cases:[],limits:['200% font-size approximates text enlargement, not Safari zoom','No VoiceOver, contrast acceptance or physical iPhone test','Current stylesheet is injected into the frozen baseline; final product integration is separate']};
let server,browser;
try{
 const css=await readFile('src/style.css','utf8');report.stylesheetSHA256=createHash('sha256').update(css).digest('hex');
 report.environment=product?'Chromium Linux sandbox, temporary loopback, current production build':report.environment;
 if(product)report.limits=report.limits.filter(x=>!x.startsWith('Current stylesheet'));
 server=await preview({configFile:false,build:{outDir:product?'dist':'.local/releases/quality-before'},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await ctx.newPage(),errors=[],external=[];
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(origin))external.push(r.url());});
 await page.goto(origin);await page.getByLabel('Importar audios',{exact:true}).waitFor();
 const title='Tema propio '+'L'.repeat(260);
 await page.evaluate(async title=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('pulso-web-local-v1',2);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const id=crypto.randomUUID(),listId=crypto.randomUUID(),track={id,assetId:null,audioFingerprint:null,title,artist:'A'.repeat(300),album:'B'.repeat(300),duration:180,favorite:true,revision:1,createdAt:'2026-01-01T00:00:00.000Z',manualOverrides:{}};
  await new Promise((resolve,reject)=>{const tx=db.transaction(['tracks','playlists'],'readwrite');tx.objectStore('tracks').put(track,id);tx.objectStore('playlists').put({id:listId,name:'Lista propia '+'M'.repeat(80),entries:[{id:crypto.randomUUID(),trackId:id}],revision:1},listId);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
 },title);
 await page.reload();await page.locator('.tracks>li').waitFor();
 // Capture RED before applying the actual source fix.
 report.before=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
 if(!product){
  assert.ok(report.before.scrollWidth>report.before.clientWidth);
  await ctx.route(origin+'/layout-test.css',route=>route.fulfill({contentType:'text/css',body:css}));
  await page.addStyleTag({url:origin+'/layout-test.css'});
 }
 await page.locator('.tracks details').last().locator('summary').click();
 for(const [width,height]of[[320,700],[390,844],[844,390]])for(const scale of[100,200]){
  await page.setViewportSize({width,height});await page.evaluate(scale=>document.documentElement.style.fontSize=scale+'%',scale);
  const measured=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,title:document.querySelector('.tracks strong').textContent,overflow:[...document.querySelectorAll('body *')].filter(e=>{const b=e.getBoundingClientRect();return b.width&&b.height&&(b.right>document.documentElement.clientWidth+1||b.left< -1);}).map(e=>({tag:e.tagName,text:(e.textContent??'').slice(0,40)}))}));
  assert.equal(measured.title,title);assert.ok(measured.scrollWidth<=measured.clientWidth+1,JSON.stringify({width,height,scale,...measured}));
  report.cases.push({width,height,textScale:scale,passed:true,scrollWidth:measured.scrollWidth,clientWidth:measured.clientWidth,overflow:measured.overflow});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report.pageErrors=0;report.externalRequests=0;report.passed=true;
}catch(error){report.failure=error.message;throw error;}
finally{await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));await mkdir('.local/evidence',{recursive:true});await writeFile(`.local/evidence/web-layout-long-text${product?'-product':''}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
