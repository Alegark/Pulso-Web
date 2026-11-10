// R91 isolated core, native Chromium, own synthetic fixtures and fault injections.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,cp} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {build} from 'vite';
import {chromium} from 'playwright-core';
import {ackLossPlugin} from '../../.local/local-copy-removal-r91/ack-loss.mjs';
const base=resolve('.local/collection-removal-coordinator-tests/r91'),run=resolve(base,'run-'+Date.now()),snapshot=resolve(run,'snapshot'),out=resolve(run,'bundle');
const hash=b=>createHash('sha256').update(b).digest('hex');
async function hashes(dir,prefix=''){const out={};for(const e of(await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=resolve(dir,e.name),key=prefix+e.name;if(e.isDirectory())Object.assign(out,await hashes(p,key+'/'));else{const b=await readFile(p);out[key]={bytes:b.length,sha256:hash(b)};}}return out;}
const report={round:91,project:'Pulso-Web',USD:0,run,status:'RUNNING',cases:[],errors:[],external:[],limits:['Synthetic trusted runtime/root protection context with real R86 registry/sourceReview/Activity; no main UI acceptance.','Native import and verification workers, IDB/OPFS, Chromium sandbox; IDB backend explicitly disables OPFS capability in test worker prelude.','Faults are tagged native prototype injections; quota/security/ACK races are NOT physical device failures.','No external files, accounts, HTTPS, iPhone/Safari, heap or P0 acceptance.','Inspect explicit may CAS-settle receipts; never delete/replay.']};
let browser,server,context,origin;
await mkdir(run,{recursive:true});
try{
 for(const p of ['src','public'])await cp(p,resolve(snapshot,p),{recursive:true,filter:f=>!/^src\/(main\.tsx|ui(?:\/|$))/.test(f)});if(process.env.R91_BASELINE_SRC){await cp(resolve(process.env.R91_BASELINE_SRC),resolve(snapshot,'src'),{recursive:true});report.negativeControlBaseline=process.env.R91_BASELINE_SRC;}await mkdir(resolve(snapshot,'tests/browser'),{recursive:true});for(const p of ['local-copy-removal-r91.ts','local-copy-removal-r91.html'])await cp('tests/browser/'+p,resolve(snapshot,'tests/browser',p));
 await cp('.local/local-copy-removal-r91/ack-loss.mjs',resolve(run,'ack-loss.mjs'));report.ackInjection='TESTONLY three exact anchors: after native prepared/detached/removed commit ACK, before local variable assignment; no hook active except explicitly labelled cases.';report.sourcesAtBuild=await hashes(resolve(snapshot,'src'));await cp(import.meta.filename,resolve(run,'runner.mjs'));
 await build({root:snapshot,configFile:false,logLevel:'error',plugins:[ackLossPlugin()],build:{outDir:out,rolldownOptions:{input:resolve(snapshot,'tests/browser/local-copy-removal-r91.html')}}});report.bundle=await hashes(out);
 server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),p=resolve(out,'.'+u.pathname);assert.ok(p.startsWith(out+'/'));let b=await readFile(p);if(u.searchParams.get('r91backend')==='idb'){assert.match(p,/worker-.*\.js$/);b=Buffer.concat([Buffer.from("/* R91 TESTONLY explicit OPFS capability absence for IDB imports */Object.defineProperty(navigator.storage,'getDirectory',{configurable:true,value:undefined});\n"),b]);}res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(p)]??'application/octet-stream','Cache-Control':'no-store'}).end(b);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;report.origin=origin;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();
 for(const backend of (process.env.R91_BACKEND?[process.env.R91_BACKEND]:['idb','opfs']))for(let g=1;g<=14;g++){
 const group='G'+String(g).padStart(2,'0');if(process.env.R91_FILTER&&!group.includes(process.env.R91_FILTER))continue;
 context=await browser.newContext();await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin||['blob:','data:'].includes(u.protocol))return r.continue();report.external.push(u.origin);return r.abort();});
 if(backend==='idb')await context.addInitScript(()=>{const Actual=Worker;window.Worker=class extends Actual{constructor(url,opts){const u=new URL(String(url),location.href);u.searchParams.set('r91backend','idb');super(u,opts);}};});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));const start=Date.now();
 try{await page.goto(origin+'/tests/browser/local-copy-removal-r91.html');await page.waitForFunction(()=>!!window.r91,{timeout:10000});let timeout;const result=await Promise.race([page.evaluate(group=>window.r91.run(group),group),new Promise((_,rej)=>{timeout=setTimeout(()=>rej(Error('R91 bounded group deadline 30s')),30000);})]).finally(()=>clearTimeout(timeout));if(group==='G09'){const tracking=await page.evaluate(()=>window.r91.createReloadCheckpoint());await page.reload();await page.waitForFunction(()=>!!window.r91,{timeout:10000});result.nativeReload=await page.evaluate(tracking=>window.r91.afterNativeReload(tracking),tracking);}report.cases.push({group,backend,status:'PASS',ms:Date.now()-start,result});console.log('PASS',group,backend);}
 catch(e){report.cases.push({group,backend,status:'FAIL',ms:Date.now()-start,error:String(e.stack??e)});console.error('FAIL',group,backend,e.message);}
 finally{await context.close();context=null;await writeFile(resolve(run,'progress.json'),JSON.stringify(report,null,2));}
 }
 report.status=report.cases.length&&report.cases.every(c=>c.status==='PASS')?'PASS':'FAIL';
}catch(e){report.status='HARNESS_FAIL';report.fatal=String(e.stack??e);console.error(report.fatal);}
finally{await context?.close();await browser?.close();if(server)await new Promise(r=>server.close(r));report.cleanup=true;report.finished=new Date().toISOString();report.sourcesAfter=await hashes('src');report.changedDuringRun=Object.keys(report.sourcesAtBuild??{}).filter(p=>JSON.stringify(report.sourcesAtBuild[p])!==JSON.stringify(report.sourcesAfter[p]));await writeFile(resolve(run,'receipt.json'),JSON.stringify(report,null,2));console.log(report.status,run);if(report.status!=='PASS'||report.external.length||report.errors.length)process.exitCode=1;}
