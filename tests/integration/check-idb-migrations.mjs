import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dir='.local/idb-migrations-r31';
const cases=['normal-helpers','blocked','blocked-readRecord','late-success','late-success-readRecord','upgrade-abort','existing-seven-extra','future','versionchange-listeners',...['sync','boundary'].flatMap(prefix=>['quota','security','hostile','proxy','version'].map(kind=>`${prefix}-${kind}`))];
const selected=process.argv.slice(2);if(selected.some(c=>!cases.includes(c)))throw Error('Unknown selection');
const sources=['src/storage/database.ts','src/storage/transaction-done.ts','src/errors/app-failure.ts','src/diagnostics/contract.ts','src/main.tsx','tests/browser/idb-migrations.ts','tests/browser/idb-migrations.html','tests/integration/check-idb-migrations.mjs'];
const snapshot=async()=>Promise.all(sources.map(async path=>{const data=await readFile(path);return {path,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};}));
await mkdir(dir,{recursive:true});
const report={project:'Pulso-Web',revision:31,startedUTC:new Date().toISOString(),passed:false,environment:'Real Chromium Linux, sandbox enabled, own fresh context per case, ephemeral loopback origin, USD0',sourceBefore:await snapshot(),cases:[],externalRequests:[],pageErrors:[],limits:['No main lifecycle wiring, SW/bundle compatibility, full AC21/T16/T18/P0 or physical iPhone acceptance.','Late success uses real native request/result with injected blocked notification; native blocked/release cases separately require upgrade abort before schema mutation.','Quota/security are explicit fault injection, not physical quota exhaustion or browser permission acceptance.','R30 remains historical RED evidence; no destructive database recovery or external origin access.']};
let server,browser;
try{
 await build({entryPoints:['tests/browser/idb-migrations.ts'],bundle:true,format:'iife',platform:'browser',outfile:dir+'/probe.js',sourcemap:true});
 server=createServer(async(r,s)=>{try{if(r.url==='/probe.js'){s.setHeader('Content-Type','text/javascript');s.end(await readFile(dir+'/probe.js'));}else if(r.url==='/'){s.setHeader('Content-Type','text/html');s.end((await readFile('tests/browser/idb-migrations.html','utf8')).replace('type="module" src="./idb-migrations.ts"','src="/probe.js"'));}else{s.writeHead(404).end();}}catch{s.writeHead(500).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));report.origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 for(const name of selected.length?selected:cases){
  const context=await browser.newContext();
  try{
   await context.route('**/*',route=>{if(new URL(route.request().url()).origin===report.origin)return route.continue();report.externalRequests.push(route.request().url());return route.abort();});
   const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push({name,message:e.message}));
   await page.goto(report.origin);await page.waitForFunction(()=>window.idbMigrations);
   const result=await page.evaluate(name=>Promise.race([window.idbMigrations.run(name),new Promise((_,reject)=>setTimeout(()=>reject(Error('case timeout')),12000))]),name);report.cases.push(result);console.log('PASS',name);
  }catch(error){report.cases.push({name,passed:false,error:error.stack});console.log('FAIL',name,error.message);}
  finally{await context.close();}
 }
 report.passed=report.cases.every(c=>c.passed)&&!report.externalRequests.length&&!report.pageErrors.length;
}catch(error){report.error=error.stack;}
finally{
 await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));report.cleanup={browserClosed:true,ephemeralServerClosed:!server?.listening};
 report.sourceAfter=await snapshot();report.sourceUnchanged=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.passed&&=report.sourceUnchanged;
 const path=`${dir}/browser-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(path);if(!report.passed)process.exitCode=1;
}
