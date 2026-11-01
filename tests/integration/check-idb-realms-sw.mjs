import assert from 'node:assert/strict';
import {build} from 'vite';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.local/idb-realms-sw-r46'),out=resolve(root,'native');
const report={selection:process.env.R46_FILTER??'FULL',revision:46,passed:false,USD:0,browser:null,cases:[],limits:['Native protocol harness is not main integration acceptance','No iPhone/AC21/T16/T18/P0 acceptance'],errors:[]};
const hash=b=>createHash('sha256').update(b).digest('hex');
async function hashes(dir){const result={};for(const e of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,e.name);if(e.isDirectory())Object.assign(result,await hashes(p));else result[p.replace(process.cwd()+'/','')]={bytes:(await readFile(p)).length,sha256:hash(await readFile(p))};}return result;}
let browser,server;
async function until(check){for(let i=0;i<120;i++){const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,50));}throw Error('bounded native observation missing');}
async function test(id,kind,run){if(process.env.R46_FILTER&&!id.includes(process.env.R46_FILTER))return;const start=Date.now();try{const evidence=await run();report.cases.push({id,kind,status:'PASS',ms:Date.now()-start,evidence});}catch(e){report.cases.push({id,kind,status:'FAIL',error:String(e.stack??e)});throw e;}}
try{
 await mkdir(out,{recursive:true});report.sourceAtBuild=await hashes(resolve('src'));
 await build({configFile:false,logLevel:'warn',build:{outDir:out,emptyOutDir:false,lib:{entry:resolve(root,'harness.ts'),formats:['es'],fileName:()=> 'harness.js'}}});
 await build({configFile:false,logLevel:'warn',define:{SHELL_FILES:'[]'},build:{outDir:out,emptyOutDir:false,lib:{entry:resolve('src/service-worker/sw.ts'),formats:['es'],fileName:()=> 'sw.js'}}});
 // TESTONLY: deterministic post-read barrier. Native IDB versionchange still supplies revocation.
 await build({configFile:false,logLevel:'warn',define:{SHELL_FILES:'[]'},plugins:[{name:'r46-post-read-barrier',enforce:'pre',transform(code,id){if(id.endsWith('/service-worker/sw.ts')){assert.ok(code.includes('const bytes=await reader.readRange(position,end);current();'),'barrier injection must match frozen source');return code.replace('const bytes=await reader.readRange(position,end);current();','const bytes=await reader.readRange(position,end);if(position>range.start)await r46Barrier();current();')+`\nlet r46Waiting=false;let r46Release=()=>{};function r46Barrier(){return new Promise(resolve=>{r46Waiting=true;const timer=setTimeout(resolve,10000);r46Release=()=>{clearTimeout(timer);resolve();};});}self.addEventListener('message',event=>{if(event.data?.type==='r46-barrier-status')event.ports[0]?.postMessage({waiting:r46Waiting});if(event.data?.type==='r46-barrier-release'){r46Release();event.ports[0]?.postMessage({released:true});}});`;}}}],build:{outDir:out,emptyOutDir:false,lib:{entry:resolve('src/service-worker/sw.ts'),formats:['es'],fileName:()=> 'sw-barrier.js'}}});
 await build({configFile:false,logLevel:'warn',define:{SHELL_FILES:'[]'},plugins:[{name:'r46-unknown-io',enforce:'pre',transform(code,id){if(id.endsWith('/storage/database.ts')){assert.ok(code.includes('req = indexedDB.open(DATABASE, 2)'));return code.replace('req = indexedDB.open(DATABASE, 2)','req = ((globalThis as any).__r46IO ? (()=>{throw new DOMException("TESTONLY unknown IO", "UnknownError");})() : indexedDB.open(DATABASE, 2))');}if(id.endsWith('/service-worker/sw.ts'))return code+`\nself.addEventListener('message',event=>{if(event.data?.type==='r46-unknown-io'){globalThis.__r46IO=true;event.ports[0]?.postMessage({set:true});}});`;}}],build:{outDir:out,emptyOutDir:false,lib:{entry:resolve('src/service-worker/sw.ts'),formats:['es'],fileName:()=> 'sw-unknown.js'}}});
 await writeFile(resolve(out,'realm.html'),'<!doctype html><title>R46 explicit DOM fixture</title><script type="module" src="/harness.js"></script>');
 report.built=await hashes(out);
 server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;assert.match(path,/^\/[\w.-]+$/);const b=await readFile(resolve(out,'.'+path));res.writeHead(200,{'Content-Type':extname(path)==='.js'?'text/javascript':'text/html','Cache-Control':'no-store'}).end(b);}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();
 const contexts=[];
 async function fixture(version,script='/sw.js'){const context=await browser.newContext();contexts.push(context);await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const a=await context.newPage(),b=await context.newPage();for(const p of [a,b]){p.on('pageerror',e=>report.errors.push(String(e)));await p.goto(origin+'/realm.html');await p.waitForFunction(()=>window.ready);}if(version)await b.evaluate(v=>window.native(v),version);await a.evaluate(script=>window.install(script),script);await a.evaluate(()=>window.acquire());return {context,a,b};}
 try{
 for(const version of [null,1,3])await test(`F08-schema-${version??'absent'}`,'NATIVE',async()=>{
 const {context,a,b}=await fixture(version);
 const before=await b.evaluate(()=>window.inspect());const cap=await a.evaluate(()=>window.rpc({version:1,type:'transport-capabilities'}));assert.equal(cap.idbLifecycle,1);assert.deepEqual(await b.evaluate(()=>window.inspect()),before);
 const ticket=await a.evaluate(()=>window.rpc({version:1,type:'fixture-tickets',ownerProof:window.proof,assetIds:[]}));assert.equal(ticket.status,503);assert.equal(ticket.tokens,undefined);
 const response=await a.evaluate(()=>window.fetchMedia(crypto.randomUUID()));assert.equal(response.status,503);assert.deepEqual(await b.evaluate(()=>window.inspect()),before);
 if(version!==3){await b.evaluate(()=>window.initialize());const deny=await a.evaluate(()=>window.rpc({protocol:'pulso-idb-realm',version:1,type:'revalidate',requestId:crypto.randomUUID(),ownerProof:'invalid'}));assert.equal(deny.status,403);await a.evaluate(()=>window.api.revalidateDatabaseTransport(window.proof,()=>true));const ok=await a.evaluate(()=>window.rpc({version:1,type:'fixture-tickets',ownerProof:window.proof,assetIds:[]}));assert.deepEqual(ok.tokens,[]);}
 else {await a.waitForFunction(()=>window.notices.includes('version-incompatible'));assert.deepEqual(await b.evaluate(()=>window.rawNotices),[]);}
 await context.close();return {before,cap,ticketStatus:ticket.status,fetchStatus:response.status};});
 await test('F08-blocked-explicit-readmission','NATIVE',async()=>{
 const {context,a,b}=await fixture();await b.evaluate(()=>window.native(1,true));
 const blocked=await a.evaluate(()=>window.rpc({version:1,type:'fixture-tickets',ownerProof:window.proof,assetIds:[]}));assert.equal(blocked.status,503);assert.equal(blocked.notice.state,'blocked');
 await a.waitForFunction(()=>window.notices.includes('blocked'));assert.deepEqual(await b.evaluate(()=>window.rawNotices),[]);
 await b.evaluate(()=>window.kept.close());const preserved=await b.evaluate(()=>window.inspect());assert.equal(preserved.version,1);assert.equal(preserved.stores.includes('tickets'),false);
 await b.evaluate(()=>window.initialize());await a.evaluate(()=>window.api.revalidateDatabaseTransport(window.proof,()=>true));const ready=await a.evaluate(()=>window.rpc({version:1,type:'fixture-tickets',ownerProof:window.proof,assetIds:[]}));assert.deepEqual(ready.tokens,[]);
 await context.close();return {blocked:blocked.notice.state,legacyPreservedBeforeExplicitDOM:preserved,explicitProofReadmission:true};});
 for(const backend of ['idb','opfs'])await test('F09-F10-'+backend,'NATIVE',async()=>{
 const {context,a,b}=await fixture();await b.evaluate(()=>window.initialize());const asset=await a.evaluate(backend=>window.seed(backend),backend);
 const mint=await a.evaluate(id=>window.rpc({version:1,type:'fixture-tickets',ownerProof:window.proof,assetIds:[id]}),asset.id);assert.equal(mint.tokens.length,1);const token=mint.tokens[0];
 const range=await a.evaluate(token=>window.fetchMedia(token,{Range:'bytes=65530-65545'}),token);assert.equal(range.status,206);assert.deepEqual(range.bytes,Array.from({length:16},(_,i)=>(65530+i)%251));
 const head=await a.evaluate(token=>window.fetchMedia(token,{},'HEAD'),token);assert.equal(head.status,200);assert.equal(head.bytes.length,0);assert.equal(head.headers['content-length'],String(asset.bytes));
 assert.equal((await b.evaluate(token=>window.fetchMedia(token),token)).status,403);
 const badRange=await a.evaluate(token=>window.fetchMedia(token,{Range:'bytes=999999-'}),token);assert.equal(badRange.status,416);
 // Stop only the worker belonging to this fresh browser context via CDP.
 const cdp=await context.newCDPSession(a);await cdp.send('ServiceWorker.enable');let versions=[];cdp.on('ServiceWorker.workerVersionUpdated',e=>versions.push(...e.versions));await a.evaluate(()=>navigator.serviceWorker.getRegistration().then(r=>r.update()));
 await new Promise(r=>setTimeout(r,200));const live=versions.find(v=>v.scriptURL===origin+'/sw.js'&&v.runningStatus==='running');assert.ok(live,'own active SW version observed');await cdp.send('ServiceWorker.stopWorker',{versionId:live.versionId});
 const afterRestart=await a.evaluate(token=>window.fetchMedia(token,{Range:'bytes=0-1'}),token);assert.equal(afterRestart.status,206);assert.deepEqual(afterRestart.bytes,[0,1]);
 await b.evaluate(()=>window.native(3));await cdp.send('ServiceWorker.stopWorker',{versionId:live.versionId}).catch(()=>{});
 const future=await a.evaluate(token=>window.fetchMedia(token),token);assert.equal(future.status,503);await a.waitForFunction(()=>window.notices.includes('version-incompatible'));assert.equal((await b.evaluate(()=>window.rawNotices)).length,0);
 await cdp.detach();await context.close();return {rangeStatus:range.status,headStatus:head.status,afterRestart:afterRestart.status,future:future.status,streamCut:'NOT_TESTED_IN_THIS_CASE'};});
 for(const backend of ['idb','opfs'])await test('F09-active-stream-'+backend,'NATIVE_VERSIONCHANGE_WITH_TESTONLY_POST_READ_BARRIER',async()=>{
 const {context,a:owner,b:peer}=await fixture(undefined,'/sw-barrier.js');
 await peer.evaluate(()=>window.initialize());const asset=await owner.evaluate(backend=>window.seed(backend,196619),backend);
 const mint=await owner.evaluate(id=>window.rpc({version:1,type:'fixture-tickets',ownerProof:window.proof,assetIds:[id]}),asset.id);
 const first=await owner.evaluate(async token=>{const response=await fetch('/_pulso/media/'+token);window.streamReader=response.body.getReader();const first=await window.streamReader.read();return {status:response.status,first:first.value.length,done:first.done};},mint.tokens[0]);
 assert.equal(first.status,200);assert.equal(first.done,false);assert.ok(first.first<=65536);
 const before=await peer.evaluate(()=>window.snapshot());
 await until(()=>owner.evaluate(async()=>!!(await window.rpc({type:'r46-barrier-status'})).waiting));
 await peer.evaluate(()=>window.native(3));await owner.evaluate(()=>window.rpc({type:'r46-barrier-release'}));
 const cut=await owner.evaluate(async()=>{let remaining=0;try{while(true){const item=await window.streamReader.read();if(item.done)return {remaining,error:false};remaining+=item.value.length;}}catch{return {remaining,error:true};}finally{window.streamReader.releaseLock();}});
 const afterRange=await owner.evaluate(token=>window.fetchMedia(token,{Range:'bytes=0-1'}),mint.tokens[0]);const afterHead=await owner.evaluate(token=>window.fetchMedia(token,{},'HEAD'),mint.tokens[0]);assert.equal(afterRange.status,503);assert.equal(afterHead.status,503);
 assert.equal(cut.error,true,'native versionchange must error, never clean EOF');assert.equal(cut.remaining,0,'no second enqueue after barrier revocation');
 await owner.waitForFunction(()=>window.notices.includes('versionchange'));assert.deepEqual(await peer.evaluate(()=>window.rawNotices),[]);
 const unlocked=await owner.evaluate(async asset=>navigator.locks.request(`pulso-web:local:asset:${asset.backend}:${asset.storageKey}`,{mode:'exclusive'},()=>true),asset);assert.equal(unlocked,true);
 assert.deepEqual(await peer.evaluate(()=>window.snapshot()),before,'all existing assets/chunks/jobs/settings/tracks/playlists/tickets unchanged');
 const retry=await owner.evaluate(async()=>{try{await window.api.revalidateDatabaseTransport(window.proof,()=>true);return true;}catch{return false;}});assert.equal(retry,false,'fatal remains sticky');
 await context.close();return {first,cut,rangeAfterRevocation:afterRange.status,headAfterRevocation:afterHead.status,readerLockReleased:unlocked,allExistingStoresUnchanged:true,directed:true,retryDenied:true,barrier:'explicit TESTONLY MessageChannel pause after second readRange before current/enqueue; released after native versionchange'};});
 for(const backend of ['idb','opfs'])for(const kind of ['missing','corrupt'])await test(`F08-missing-corrupt-${backend}-${kind}`,'NATIVE_FIXTURE_MUTATION',async()=>{
 const {context,a,b}=await fixture();await b.evaluate(()=>window.initialize());const asset=await a.evaluate(backend=>window.seed(backend),backend);const mint=await a.evaluate(id=>window.rpc({version:1,type:'fixture-tickets',ownerProof:window.proof,assetIds:[id]}),asset.id);
 await b.evaluate(({asset,kind})=>window.mutate(asset,kind),{asset,kind});const result=await a.evaluate(token=>window.fetchMedia(token),mint.tokens[0]);assert.equal(result.status,409);assert.deepEqual(await a.evaluate(()=>window.notices),[]);await context.close();return {status:result.status,noFabricatedLifecycle:true};});
 await test('F11-unknown-IO-no-lifecycle-no-blob-bypass','INJECTION_NATIVE_IDB_OPEN_BOUNDARY',async()=>{
 const {context,a,b}=await fixture(undefined,'/sw-unknown.js');await b.evaluate(()=>window.initialize());const asset=await a.evaluate(()=>window.seed('idb'));
 const mint=await a.evaluate(id=>window.rpc({version:1,type:'fixture-tickets',ownerProof:window.proof,assetIds:[id]}),asset.id);
 assert.equal((await a.evaluate(()=>window.rpc({type:'r46-unknown-io'}))).set,true);
 const result=await a.evaluate(async({token,id})=>{const fetchResult=await window.fetchMedia(token);const head=await window.fetchMedia(token,{},'HEAD');let failure=null,success=false;try{await window.api.localTickets([id],window.proof,()=>true);success=true;}catch(error){failure=window.api.issuedFailure(error);}return {fetchStatus:fetchResult.status,headStatus:head.status,notices:window.notices,failure,success};},{token:mint.tokens[0],id:asset.id});
 assert.equal(result.fetchStatus,503);assert.equal(result.headStatus,503);assert.deepEqual(result.notices,[]);assert.equal(result.success,false);assert.equal(result.failure.family,'storage-unavailable');assert.equal(result.failure.code,'storage-unavailable');
 await context.close();return result;});
 await test('F11-window-DTO-source','INJECTION',async()=>{
 const {context,a}=await fixture();const result=await a.evaluate(()=>{let called=0;const bad={protocol:'pulso-idb-realm',version:1,type:'sw-anomaly',get state(){called++;return 'versionchange';}};const parsed=window.api.databaseTransportNotice(bad);navigator.serviceWorker.dispatchEvent(new MessageEvent('message',{data:{protocol:'pulso-idb-realm',version:1,type:'sw-anomaly',state:'versionchange'},origin:location.origin,source:null}));navigator.serviceWorker.dispatchEvent(new MessageEvent('message',{data:{protocol:'pulso-idb-realm',version:1,type:'sw-anomaly',state:'versionchange'},origin:'https://foreign.invalid',source:navigator.serviceWorker.controller}));navigator.serviceWorker.dispatchEvent(new MessageEvent('message',{data:{protocol:'pulso-idb-realm',version:1,type:'sw-anomaly',state:'versionchange',cause:'untrusted'},origin:location.origin,source:navigator.serviceWorker.controller}));return {called,parsed,notices:window.notices};});assert.deepEqual(result,{called:0,parsed:null,notices:[]});await context.close();return result;});
 }finally{for(const c of contexts)await c.close().catch(()=>{});}
 report.sourceAfter=await hashes(resolve('src'));report.concurrentChanges=Object.keys({...report.sourceAtBuild,...report.sourceAfter}).filter(p=>report.sourceAtBuild[p]?.sha256!==report.sourceAfter[p]?.sha256);assert.deepEqual(report.errors,[]);report.passed=true;
}catch(e){report.failure=String(e.stack??e);process.exitCode=1;}
finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await mkdir('.local/evidence',{recursive:true});await writeFile('.local/evidence/idb-realms-sw-r46.json',JSON.stringify(report,null,2)+'\n');await writeFile(resolve(root,`run-${Date.now()}.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,cases:report.cases.map(x=>[x.id,x.status]),failure:report.failure,errors:report.errors}));}
