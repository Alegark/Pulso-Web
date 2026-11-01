// Synthetic routed localhost origin: real Chromium IDB/OPFS, no listening socket,
// no dist build, no main wiring, no external requests or physical-device claim.
import assert from 'node:assert/strict';
import {build} from 'vite';
import {chromium} from 'playwright-core';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const directory='.local/backup-diagnostics-r25';
const cases=['schema-format','local-corrupt','plans','export-reuse','invalid-choice','imports-pending','imports-io','missing-receipt','readonly-ack','identity-corrupt','recovery-gate','fingerprint','busy','partial-quota','async-quota','ack-reconcile','late-cancel','panel-export','panel-inspect','panel-recovery','panel-corrupt','valid','format','version','relations','limits','utf8','read-io','forged-read','export-open','preabort','quota','quota-cancel','quota-reconcile','cancel-during','ack-lost','postcommit','stale','incarnation','receipt-corrupt','inspect-io','observer-throw','conflicts','recovery','panel-valid','panel-refresh','panel-off-on','panel-clear','panel-stale','panel-canwrite','panel-observer-throw','panel-begin-throw'];
const selected=process.argv.slice(2);assert(selected.every(n=>cases.includes(n)),'unknown filter');
await mkdir(directory,{recursive:true});
await build({configFile:false,publicDir:false,logLevel:'warn',define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:`${directory}/bundle`,emptyOutDir:true,minify:false,lib:{entry:resolve(`${directory}/harness.tsx`),formats:['es'],fileName:()=> 'harness.js'},rolldownOptions:{output:{codeSplitting:false}}}});
const js=await readFile(`${directory}/bundle/harness.js`,'utf8');
const report={revision:25,passed:false,cases:[],pageErrors:[],externalAttempts:[],newPorts:0,limits:['Synthetic real Chromium IDB/OPFS; native errors injected, not physical quota exhaustion.','Real panel + Session harness only. Main wiring belongs to parent; no production build, iPhone/T18/P0 pending.']};
let browser;
try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();
 for(const name of selected.length?selected:cases){
  const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();
  page.on('pageerror',e=>report.pageErrors.push({name,error:e.message}));
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!=='http://127.0.0.1'){report.externalAttempts.push(url.href);return route.abort();}return route.fulfill({contentType:url.pathname.endsWith('.js')?'text/javascript':'text/html',body:url.pathname.endsWith('.js')?js:'<div id="root"></div><script type="module" src="/harness.js"></script>'});});
  try{await page.goto(`http://127.0.0.1/?case=${name}`);await page.waitForFunction(()=>globalThis.report!==undefined,{},{timeout:20000});const result=await page.evaluate(()=>globalThis.report);report.cases.push(result);console.log(`${result.passed?'PASS':'FAIL'} ${name}${result.error?': '+result.error:''}`);}
  catch(e){report.cases.push({name,passed:false,harnessError:e.message});console.log(`FAIL ${name} ${e.message}`);}finally{await context.close();}
 }
 report.passed=!report.pageErrors.length&&!report.externalAttempts.length&&report.cases.every(c=>c.passed);
}finally{await browser?.close();const path=`${directory}/browser-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(path);}
assert(report.passed,'backup diagnostics focal failures');
