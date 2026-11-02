// Independent R136 integration runner. --prepare NEVER executes browser groups.
// Final requires a NEW authorized task, explicit --go and complete frozen source map.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,realpath,cp} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright-core';
import {root,output,json,memory,freeze,sources,tree,sha} from './tab-transfer-main/evidence.mjs';
import {prepareBuild} from './tab-transfer-main/build.mjs';
import {install} from './tab-transfer-main/browser.mjs';
import {plan,runCases} from './tab-transfer-main/cases.mjs';
const args=process.argv.slice(2),prepare=args.includes('--prepare'),final=args.includes('--final');
assert.ok(prepare!==final,'Exactly --prepare or --final required');assert.ok(args.every(a=>['--prepare','--final','--go'].includes(a)||a.startsWith('--freeze=')),'Unknown argument');
if(final)assert.ok(args.includes('--go'),'Explicit GO required; never infer it from elapsed time');
const run=resolve(output,`${prepare?'prepare':'final'}-${Date.now()}`);await mkdir(run,{recursive:true});
const report={project:'Pulso-Web',revision:'R136',status:prepare?'PREPARING':'RUNNING',run,USD:0,groups:[],planned:plan.map(([id,mode,name])=>({id,mode,name,status:'NOT_EXECUTED'})),errors:[],external:[],csp:[],sockets:[],cleanup:{},limits:['Chromium Linux sandbox/headless only. Physical iPhone autoplay NOT_EXECUTED; no T13/P0 global acceptance.','G01/G02 main and core untransformed. Other groups use recorded read-only TESTONLY source observers and barriers after actual awaited work.','All pages in a group share one fresh browser context/origin, real Web Locks/BC/IDB/Audio; no fake positive playback, ownership, storage or Activity.','Synthetic pagehide/visibility events are lifecycle boundaries, NOT a physical tab suspension or BFCache acceptance.','G07 sessionStorage pending-operation is an explicitly declared negative uncertainty fixture, never positive storage/ownership evidence.','G16 legacy entry uses real Ownership constructor3, real locks and manual cede; BC absence is an explicitly negative capability case.','G17 covers current RAM draft isolation and absence of automatic auth only. Authenticated-account migration NOT_EXECUTED: no SDK real/network and no fake authenticated runtime permitted.','No external services, accounts, Telegram calls, deployment, port4175, Git mutation or product/docs/ODD edits.']};
let browser,server,context,origin,mode,phase=0,shutdown=false;const observedPages=new Set();
// Audio bytes are persisted once as own WAV fixtures. Typed-array chunks in raw
// IDB receipts are represented by byte count and SHA, explicitly labelled.
const encode=value=>JSON.stringify(value,(_key,v)=>ArrayBuffer.isView(v)?{representation:'typed-array-bytes-sha256',constructor:v.constructor.name,bytes:v.byteLength,sha256:sha(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))}:v,2)+'\n';
async function harvest(label){if(!context)return;const dir=resolve(run,'raw',`${String(++phase).padStart(3,'0')}-${label}`);await mkdir(dir,{recursive:true});for(const [i,p]of context.pages().entries()){if(p.isClosed())continue;let native=null,db=null;try{native=await p.evaluate(()=>window.h136?.snapshot());}catch(e){native={captureError:String(e)};}try{if(new URL(p.url()).pathname!=='/blank.html')db=await p.evaluate(()=>window.h136?.read());}catch(e){db={captureError:String(e)};}if(native?.csp?.length)report.csp.push(...native.csp);await writeFile(resolve(dir,`page-${i}.json`),encode({url:new URL(p.url()).pathname,native,db}));}return dir;}
async function retire(label){if(!context)return;await harvest(label);for(const p of context.pages())if(!p.isClosed())await p.evaluate(()=>window.h136?.releaseAll()).catch(()=>{});await context.close();context=undefined;observedPages.clear();}
async function fresh(nextMode,options={}){await retire('context-finally');mode=nextMode;context=await browser.newContext({viewport:{width:1100,height:850}});context.setDefaultTimeout(12000);await context.addInitScript(install,options);await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin||['blob:','data:'].includes(u.protocol))return route.continue();report.external.push({origin:u.origin,path:u.pathname});return route.abort();});context.on('request',req=>{const u=new URL(req.url());if(u.origin!==origin&&!['blob:','data:'].includes(u.protocol))report.external.push({origin:u.origin,path:u.pathname,observed:'context-request-including-workers'});});context.on('page',p=>{observedPages.add(p);p.on('pageerror',e=>report.errors.push({name:e.name,message:e.message,stack:e.stack}));p.on('websocket',()=>report.sockets.push({unexpected:true}));});}
async function open(path='/'){const p=await context.newPage();await p.goto(origin+path);if(path==='/')await p.locator('#player').waitFor();return p;}
async function fixture(){const p=await open('/fixture.html');try{const result=await p.evaluate(()=>window.fixtureDone);await json(resolve(run,`fixture-import-${phase}-${Date.now()}.json`),result);assert.equal(result.results.length,2);assert.equal(result.results.every(r=>r.kind==='confirmed'),true);}finally{await p.close();}}
try{
 await cp(resolve(root,'tests/integration/tab-transfer-main'),resolve(run,'runner/helpers'),{recursive:true});await cp(resolve(root,'tests/integration/check-tab-transfer-main.mjs'),resolve(run,'runner/check-tab-transfer-main.mjs'));report.runnerFiles=await tree(resolve(run,'runner'));
 report.memory=await memory(run);if(final)report.freeze=await freeze(args.find(a=>a.startsWith('--freeze='))?.slice(9));
 report.preparedBuild=await prepareBuild(run);await json(resolve(run,'plan.json'),report.planned);
 if(prepare){report.status='PREPARED_NOT_EXECUTED';report.browserExecuted=false;}
 else{
  assert.deepEqual(report.preparedBuild.sources,report.freeze.sources,'Build sources exactly frozen full src/public');
  server=createServer(async(req,res)=>{try{const base=await realpath(resolve(run,mode??'native')),u=new URL(req.url,'http://localhost'),path=await realpath(resolve(base,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname))));assert.ok(path.startsWith(base+sep));const b=await readFile(path);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wav':'audio/wav','.wasm':'application/wasm'})[extname(path)]??'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}).end(b);}catch{res.writeHead(404).end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));assert.notEqual(server.address().port,4175);origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();report.browserExecuted=true;report.launch={headless:true,chromiumSandbox:true,port:server.address().port};
  await runCases({fresh,open,fixture,report,saveGroup:async r=>{r.raw=await harvest(r.id);await json(resolve(run,`${r.id}.json`),r);}});
  assert.deepEqual(await sources(),report.freeze.sources,'Current COMPLETE src/public still equal sources built and frozen');report.finalSources=await sources();
  assert.equal(report.groups.length,17);assert.ok(report.groups.every(g=>g.status==='PASS'),'One or more groups failed; preserve all raw failures');assert.deepEqual(report.errors,[],'zero pageerrors');assert.deepEqual(report.csp,[],'zero CSP violations');assert.deepEqual(report.external,[],'zero external requests');assert.deepEqual(report.sockets,[],'zero sockets');report.status='PASS_FOCAL_NOT_P0';
 }
}catch(e){report.status='FAIL';report.failure={name:e.name,message:e.message,stack:e.stack};process.exitCode=1;}
finally{
 try{await retire('finally');report.cleanup.contexts=true;}catch(e){report.cleanup.contexts=false;report.cleanup.error=String(e);process.exitCode=1;}
 try{await browser?.close();report.cleanup.browser=true;}catch{report.cleanup.browser=false;process.exitCode=1;}
 if(server)await new Promise(r=>server.close(r));shutdown=true;report.cleanup.server=shutdown;
 // A final snapshot is required even on failure; no earlier build certifies drift.
 if(report.status==='PASS_FOCAL_NOT_P0'&&(!report.cleanup.contexts||!report.cleanup.browser||!report.cleanup.server||report.errors.length||report.external.length||report.csp.length||report.sockets.length)){report.status='FAIL';process.exitCode=1;}
 report.currentSources=await sources();if(report.preparedBuild)report.currentEqualsBuilt=JSON.stringify(report.currentSources)===JSON.stringify(report.preparedBuild.sources);
 report.rawFiles=await tree(run);await json(resolve(run,'report.json'),report);
 console.log(JSON.stringify({status:report.status,run,groups:report.groups.map(g=>({id:g.id,status:g.status,error:g.error?.message})),failure:report.failure,cleanup:report.cleanup}));
}
