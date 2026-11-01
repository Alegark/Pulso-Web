// Own offline harness, never builds product entries or uses the owner's profile.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,readdir,mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import {chromium} from 'playwright-core';
const base='.local/auth-offline-r8';
const output=base+'/contract-build';
const files=['src/telegram/auth-protocol.ts','src/telegram/auth-state.ts','src/telegram/auth-scope-store.ts','tests/unit/auth-offline.test.ts','tests/browser/auth-offline.worker.ts','tests/browser/auth-offline.ts','tests/browser/auth-offline.html','tests/integration/check-auth-offline.mjs'];
const sha=b=>createHash('sha256').update(b).digest('hex');
async function tree(path){const result={};async function visit(dir){let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}for(const e of entries){const p=dir+'/'+e.name;if(e.isDirectory())await visit(p);else if(e.isFile())result[p]=sha(await readFile(p));}}await visit(path);return result;}
const report={project:'Pulso-Web',passed:false,scope:'U/B offline contracts only',realAuth:false,T4Complete:false,T5:false,iPhone:false,P0Complete:false,commands:['python3 scripts/sync_odd_memory.py --read-only','node_modules/.bin/tsx --test tests/unit/auth-offline*.test.ts','INSTABOX_HEADLESS=1 node tests/integration/check-auth-offline.mjs'],gaps:['SDK IdbStorage not imported/tested: binary distribution gate remains open','No real auth, SDK, socket, RPC, Telegram session, QR, source search/bytes or remote revocation','No product integration/ownership handoff or remote media tickets; local retention unchanged','JS references released; no secure erasure claim for strings/heap'],environment:'Chromium sandbox, isolated context/origin, temporary loopback, real Worker/MessageChannel/IndexedDB, synthetic driver explicit in test worker'};
let browser,server;
const distBefore=await tree('dist');
try{
 await mkdir(base,{recursive:true});
 const memoryLog=execFileSync('python3',['scripts/sync_odd_memory.py','--read-only'],{encoding:'utf8'});await writeFile(base+'/memory.json',memoryLog);
 const memory=JSON.parse(memoryLog);assert.equal(memory.FullContentVerified,true);assert.equal(memory.tasks.length,14);
 for(const task of memory.tasks){const body=await readFile(task.file);assert.equal(task.project,'Pulso-Web');assert.equal(task.FullContentVerified,true);assert.equal(body.length,task.bytes);assert.equal(sha(body),task.ContentSHA256);}
 report.memory={project:'Pulso-Web',taskCount:memory.tasks.length,FullContentVerified:true,receipt:base+'/memory.json',SHA256:sha(memoryLog)};
 const unitFiles=(await readdir('tests/unit')).filter(f=>/^auth-offline.*\.test\.ts$/.test(f)).sort().map(f=>'tests/unit/'+f);
 let unitLog;try{unitLog=execFileSync('node_modules/.bin/tsx',['--test',...unitFiles],{encoding:'utf8'});}catch(e){await writeFile(base+'/unit.log',e.stdout??'');throw e;}
 await writeFile(base+'/unit.log',unitLog);
 const count=label=>{const m=unitLog.match(new RegExp('^# '+label+' (\\d+)$','m'));assert.ok(m,'unit receipt '+label);return Number(m[1]);};
 report.unit={executed:true,tests:count('tests'),passed:count('pass'),failed:count('fail'),receipt:base+'/unit.log',SHA256:sha(unitLog)};assert.equal(report.unit.failed,0);assert.equal(report.unit.tests,report.unit.passed);

 await build({configFile:false,publicDir:false,cacheDir:base+'/cache',build:{outDir:output,emptyOutDir:true,rolldownOptions:{input:'tests/browser/auth-offline.html'}}});
 const bundles=await tree(output);for(const file of Object.keys(bundles)){if(file.endsWith('.js')){const source=await readFile(file,'utf8');assert.ok(!/BaseTelegramClient|runtimeIdbStorage|@mtcute|client\.session|apiws|\.telegram\.org/.test(source),'no SDK/network imports in test bundle');}}
 const root=resolve(output);
 server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://loopback').pathname;const file=resolve(root,'.'+decodeURIComponent(path));if(relative(root,file).startsWith('..')||!(await stat(file)).isFile()){res.writeHead(404).end();return;}const body=await readFile(file);res.writeHead(200,{'Content-Type':extname(file)==='.html'?'text/html':'text/javascript','Content-Length':body.length,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'"}).end(body);}catch{res.writeHead(404).end();}});
 await new Promise((a,b)=>{server.once('error',b);server.listen(0,'127.0.0.1',a);});
 const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browserVersion=browser.version();
 const context=await browser.newContext(),errors=[],external=[];await context.route('**/*',route=>{if(!route.request().url().startsWith(origin+'/')){external.push('external-attempt');return route.abort();}return route.continue();});
 const page=await context.newPage();page.on('pageerror',()=>errors.push('page-error'));
 await page.goto(origin+'/tests/browser/auth-offline.html');
 report.browser=await page.evaluate(()=>window.authOffline);report.browser.groupCount=report.browser.cases?.length??0;assert.equal(report.browser.passed,true,JSON.stringify(report.browser));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report.externalRequests=external.length;report.pageErrors=errors.length;
 const sources={};for(const file of files){const body=await readFile(file);sources[file]={bytes:body.length,SHA256:sha(body)};}report.sources=sources;report.build={configFile:false,outDir:output,SDKImports:false};

 report.apis={protocol:'parseCommand(unknown), parseReply(unknown, expectedEnvelope), parseScope, SafeAuthState; closed DTO v1; secrets only in commands',coordinator:'new AuthCoordinator(initialUnboundScope, store, trustedDriver?, clock?, uuidFactory?); handle(unknown), snapshot(), expire(), close(); default disabled; 128 unique attempts maximum per coordinator',port:'bindAuthPort(appCreatedMessagePort, coordinator) => stop; exactly one port per coordinator; invalid/incompatible DTO closes admission',store:'IndexedAuthScopeStore(IDBFactory): register, bind with current guard/local AbortSignal; tombstone then cleanup; false includes pending, late result reconciles durable journal; no automatic retry of uncertain pending; sessionDatabase(UUID); permanent tombstone, no enumeration',adjustments:'SafeAuthState includes scope to expose internally confirmed binding/generation. Port emits transition state before awaiting driver and before terminal error; clients correlate every reply and update scope from state. New verified account requires fresh slot/coordinator. Explicit expire() with injected clock; no constructor timer or ownership lease. Tombstone may register a never-authenticated own slot for disabled logout.',persistence:'Own control DB and empty synthetic session fixtures only; no SDK storage/session semantics claimed'};
 report.historicalR3Attempt={receipt:'.local/evidence/auth-offline-browser-attempt1.log',result:'FAIL harness selected state ACK instead of quarantine error; fixed response discriminator; no product PASS inferred from failed attempt'};
 const distAfter=await tree('dist');report.dist={before:distBefore,after:distAfter};report.distIntact=JSON.stringify(distBefore)===JSON.stringify(distAfter);assert.equal(report.distIntact,true);report.passed=true;
}catch(error){report.failure=error instanceof Error?error.message:'runner-failure';throw error;}
finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await mkdir('.local/evidence',{recursive:true});await writeFile('.local/evidence/auth-offline-r8.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
