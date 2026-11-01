import assert from 'node:assert/strict';
import {build,preview} from 'vite';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
const outDir='.local/import-failure-r10/build';
const selected=process.argv.slice(2);
const cases=['success-legacy','quota-none','quota-abort','quota-cleanup','quota-reconcile','quota-combined','job-idb','reader-states','dedup-unknown','cancel-copy','callback-unknown','commit-precommit','commit-second-put','commit-abort','commit-ack-lost','commit-postcommit','metadata-optional','read-lock','worker-v2','dedup-cleanup','restored-null-asset','worker-errors-recovery','read-parse-header','read-parse-view','read-parse-parser-quota','read-parse-parser-unknown','read-parse-parser-retry','worker-rejects','legacy-reader-consumers','reader-hostile','metadata-hostile','read-parse-parser-hostile','lock-denied'];
if(selected.some(c=>!cases.includes(c)&&!['open-writer','close-ack','close-before'].includes(c)))throw Error('Unknown filter');
let browser,server;
const report={passed:false,cases:[],pageErrors:[],externalAttempts:[],limits:['Isolated Chromium sandbox/loopback; no main/UI/consent/export wiring; no iPhone; no process-kill or physical quota claim.']};
await mkdir('.local/import-failure-r10',{recursive:true});
try{
 await build({configFile:false,publicDir:false,plugins:[{name:'isolated-parser-fault',enforce:'pre',transform(code,id){if(!id.endsWith('/src/imports/import-file.ts'))return;return code.replace("import {parseBlob} from 'music-metadata';",`import {parseBlob as actualParseBlob} from 'music-metadata';
 let parserAttempts=0;
 const parseBlob=(...args:Parameters<typeof actualParseBlob>)=>{
 const mode=(globalThis as any).__importFailureParse;
 if(mode==='parser-hostile')throw new Proxy({}, {getPrototypeOf(){throw Error('PRIVATE_CANARY proxy');},get(){throw Error('PRIVATE_CANARY getter');}});
 if(mode==='parser-quota')throw new DOMException('PRIVATE_CANARY parser','QuotaExceededError');
 if(mode==='parser-unknown'||mode==='parser-retry'&&parserAttempts++===0)throw new Error('PRIVATE_CANARY parser');
 return actualParseBlob(...args);
 };`);}}],build:{outDir,emptyOutDir:true,rolldownOptions:{input:'tests/browser/import-failure-v1.html'}}});
 server=await preview({configFile:false,publicDir:false,build:{outDir},preview:{host:'127.0.0.1',port:0,strictPort:true}});
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();
 for(const backend of ['idb','opfs'])for(const name of selected.length?selected:[...cases,...backend==='opfs'?['open-writer','close-ack','close-before']:[]]){
 if(backend==='idb'&&['open-writer','close-ack','close-before'].includes(name))continue;
 const context=await browser.newContext();const page=await context.newPage();
 page.on('pageerror',e=>report.pageErrors.push({name,backend,message:e.message}));
 context.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:'))report.externalAttempts.push(r.url().split(':')[0]);});
 try{
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/browser/import-failure-v1.html?case=${name}&backend=${backend}`);
 await page.waitForFunction(()=>window.importFailureReport!==undefined,{},{timeout:30000});
 const result=await page.evaluate(()=>window.importFailureReport);report.cases.push(result);console.log(`${result.passed?'PASS':'FAIL'} ${backend} ${name}${result.error?`: ${result.error}`:''}`);
 }catch(error){report.cases.push({passed:false,name,backend,harnessError:error.message});console.log(`FAIL ${backend} ${name}: harness ${error.message}`);}
 finally{await context.close();}
 }
 assert.equal(report.pageErrors.length,0,'page errors');assert.equal(report.externalAttempts.length,0,'external requests');assert.ok(report.cases.every(c=>c.passed),'one or more cases failed');report.passed=true;
}finally{
 await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));
 const path=`.local/import-failure-r10/browser-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(path);
}
