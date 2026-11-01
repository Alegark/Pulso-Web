import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const directory='.local/batch-diagnostics-r22';
const cases=['modes','valid','snapshot','observer-throw','empty','conflict','relation','create-quota','create-open','create-read','missing','manifest-missing','manifest-io','corrupt','short','long','invalid-chunk','changed','generation','io-unknown','io-denied','verify-quota','write-quota','abort-cleanup','terminal-write-quota','commit-abort','commit-ack-lost','quota-cancel','recover','reconcile','preabort','firstchunk','signal-cancel','precommit','postcommit','foreign','stale','stale-base','duplicate','bad-getter','bad-progress','bad-attempt','bad-observation','bad-snapshot','retry-cross','panel-valid','panel-refresh','panel-empty','panel-guard','panel-off-on','panel-clear','panel-late','panel-begin-throw','panel-observer-throw'];
const selected=process.argv.slice(2);assert(selected.every(n=>cases.includes(n)),'unknown filter');
function replace(code,before,after){assert(code.includes(before),'instrumentation anchor '+before);return code.replace(before,after);}
const plugin={name:'isolated-batch-r22',enforce:'pre',configureServer(server){server.middlewares.use((req,res,next)=>{
 if(!req.url.startsWith('/__batch-r22'))return next();res.setHeader('Content-Type','text/html');const testCase=new URL(req.url,'http://localhost').searchParams.get('case'),panel=testCase?.startsWith('panel-');res.end(`<div id="root"></div><script type="module" src="/.local/batch-diagnostics-r22/${panel?'panel-harness.tsx':testCase==='modes'?'modes-harness.ts':'harness.ts'}"></script>`);
 });},transform(code,id){
 if(id.endsWith('/src/storage/transaction-done.ts'))return replace(code,'const done=committed(tx);',`const done=committed(tx).then(()=>{if((tx as any).__batchACK)throw new Error('PII_ACK');});`);
 if(!id.endsWith('/src/storage/asset-reader.ts'))return;
 code=replace(code,'let unlock!:()=>void;',"const p=(globalThis as any).__batchCounters;if(p)p.opens++;let unlock!:()=>void;");
 code=replace(code,"if(released)fail('read'","if(p)p.ranges++;if(released)fail('read'");
 code=replace(code,'// Internal synchronous consumers only.', 'if(p)p.verifies++;// Internal synchronous consumers only.');
 code=replace(code,'const hash=integrity?sha256.create():null;', 'if(p&&integrity)p.hashes++;const hash=integrity?sha256.create():null;');
 code=replace(code,'async verify(integrity=true){return', 'async verify(integrity=true){if(p)p.legacy++;return');return code;
}};
let server,browser;
const report={revision:22,passed:false,cases:[],pageErrors:[],externalAttempts:[],limits:['Chromium sandbox loopback, synthetic IDB/OPFS; native faults injected, no physical quota exhaustion.','Read-only Vite test instrumentation counts reader scans; no product main wiring or production build.','Real session exercised by a test-only bridge; iPhone/T18/P0 pending.']};
await mkdir(directory,{recursive:true});
try{
 server=await createServer({configFile:false,publicDir:false,cacheDir:`${directory}/vite-cache`,appType:'mpa',plugins:[plugin],optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime']},server:{host:'127.0.0.1',port:0,strictPort:true,hmr:false,fs:{allow:[resolve('.')]}}});await server.listen();
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 for(const backend of ['idb','opfs'])for(const name of selected.length?selected:cases){
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
 page.on('pageerror',e=>report.pageErrors.push({name,backend,message:e.message}));
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){report.externalAttempts.push(route.request().url());return route.abort();}return route.continue();});
 try{
 await page.goto(`${origin}/__batch-r22?case=${name}&backend=${backend}`);await page.waitForFunction(()=>globalThis.batchReport!==undefined,{},{timeout:20000});
 const result=await page.evaluate(()=>globalThis.batchReport);report.cases.push(result);console.log(`${result.passed?'PASS':'FAIL'} ${backend} ${name}${result.error?': '+result.error:''}`);
 }catch(e){report.cases.push({name,backend,passed:false,harnessError:e.message});console.log(`FAIL ${backend} ${name}: ${e.message}`);}finally{await context.close();}
 }
 report.passed=report.pageErrors.length===0&&report.externalAttempts.length===0&&report.cases.every(c=>c.passed);
}finally{await browser?.close();await server?.close();const path=`${directory}/browser-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(path);}
assert(report.passed,'focal batch diagnostics failed');
