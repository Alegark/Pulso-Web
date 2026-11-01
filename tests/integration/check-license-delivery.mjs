// Verifies original notice bytes in the production release and offline SW shell.
// Run after a parent-owned build: INSTABOX_HEADLESS=1 node tests/integration/check-license-delivery.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {preview} from 'vite';
import {chromium} from 'playwright-core';
const report={passed:false,iphoneVerified:false,cases:[],environment:'Chromium Linux sandbox, own context and ephemeral loopback'};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let browser,server;
try{
 const manifest=JSON.parse(await readFile('dist/third-party-licenses.json','utf8'));
 const text=await readFile('dist/THIRD-PARTY-NOTICES.txt');assert.equal(hash(text),manifest.sha256);
 for(const pkg of manifest.packages){assert.equal(hash(text.subarray(pkg.offset,pkg.offset+pkg.bytes)),pkg.sha256);}
 assert.equal(manifest.packages.length,17);report.packages=17;report.noticeSHA256=manifest.sha256;
 report.cases.push({name:'Production notice preserves all original package byte ranges and recorded SHA-256',passed:true});
 server=await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 const context=await browser.newContext(),page=await context.newPage(),errors=[],outside=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith(origin))outside.push(request.url());});
 await page.goto(origin);await page.getByRole('link',{name:'Licencias de terceros',exact:true}).waitFor();
 await page.evaluate(async()=>{
  await navigator.serviceWorker.register('/sw.js',{type:'module'});await navigator.serviceWorker.ready;
  if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
 });
 const noticeResponse=await page.request.get(origin+'/THIRD-PARTY-NOTICES.txt');assert.equal(noticeResponse.status(),200);assert.equal(hash(await noticeResponse.body()),manifest.sha256);
 report.cases.push({name:'Release exposes the complete notice through the visible first-party link',passed:true});
 await context.setOffline(true);await new Promise(resolve=>server.httpServer.close(resolve));server=null;
 await page.reload();await page.getByRole('link',{name:'Licencias de terceros',exact:true}).waitFor();
 const request=page.waitForResponse(response=>new URL(response.url()).pathname==='/THIRD-PARTY-NOTICES.txt');
 await page.getByRole('link',{name:'Licencias de terceros',exact:true}).click();const offline=await request;
 report.offlineDiagnostic={fromServiceWorker:offline.fromServiceWorker(),headers:offline.headers(),protocolBodyBytes:(await offline.body()).length,originalBytes:text.length};
 report.offlineRaw=await page.evaluate(async()=>{const response=await fetch('/THIRD-PARTY-NOTICES.txt');const bytes=await response.arrayBuffer();return {bytes:bytes.byteLength,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')};});
 const rendered=await page.locator('pre').textContent();
 const expectedText=text.toString('utf8').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 report.noticeTextMatches=rendered===expectedText;
 if(!report.noticeTextMatches){const i=[...expectedText].findIndex((c,i)=>c!==[...rendered][i]);report.textDiagnostic={expectedCharacters:expectedText.length,renderedCharacters:rendered.length,firstDifference:i,prefix:rendered.slice(0,30)};}
 // CDP's body for a text navigation may be decoded, including BOM removal. Use
 // the controlled page's ArrayBuffer response to verify the actual cached bytes.
 assert.equal(offline.fromServiceWorker(),true);assert.equal(offline.status(),200);assert.equal(report.offlineRaw.sha256,manifest.sha256);assert.equal(report.offlineRaw.bytes,text.length);assert.equal(report.noticeTextMatches,true);
 assert.equal(new URL(page.url()).pathname,'/THIRD-PARTY-NOTICES.txt');
 report.cases.push({name:'Shell and notice reopen offline with the loopback origin stopped; notice is served by SW with the same SHA-256',passed:true});
 assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);report.pageErrors=0;report.externalRequests=0;report.passed=true;
}catch(error){report.failure=error.stack;throw error;}
finally{await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));await mkdir('.local/evidence',{recursive:true});await writeFile('.local/evidence/license-delivery.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
