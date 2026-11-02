/** R133 TESTONLY NoTelegram: full unchanged MAIN + real worker/client/driver.
 * --prepare never starts browser/server/build. --freeze is mandatory for final.
 */
import {readFile,writeFile,mkdir,readdir,copyFile,symlink} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {pathToFileURL} from 'node:url';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const owned=resolve(project,'.local/telegram-bot-pool-main-r133');await mkdir(owned,{recursive:true});
const args=process.argv.slice(2),prepare=args.includes('--prepare'),exploratory=args.includes('--exploratory');
assert(args.every((a,i)=>['--prepare','--exploratory','--freeze','--focus','--go'].includes(a)||['--freeze','--focus','--go'].includes(args[i-1])),'Unknown argument');
const focus=args.includes('--focus')?args[args.indexOf('--focus')+1]:null;assert(!focus||exploratory&&/^\d{2}(?:-\d{2})?$/.test(focus),'--focus NN only with --exploratory');
assert(!(prepare&&exploratory),'Choose one mode');
const freezePath=args.includes('--freeze')?resolve(project,args[args.indexOf('--freeze')+1]):null;
assert(prepare||exploratory||freezePath&&args[args.indexOf('--go')+1]==='R133-FINAL','Final requires --freeze path (and explicit root GO in orchestration)');
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),run=resolve(owned,`${prepare?'prepare':exploratory?'exploratory':'final'}-${stamp}`);await mkdir(run);
const root=resolve(run,'isolated-root'),out=resolve(run,'browser-build-TESTONLY');await mkdir(root);
const sha=b=>createHash('sha256').update(b).digest('hex');
async function mapTree(base,sub){const result={};async function visit(path){for(const e of(await readdir(resolve(base,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const next=path+'/'+e.name;if(e.isDirectory())await visit(next);else{assert(e.isFile(),`Non-regular snapshot entry ${next}`);const b=await readFile(resolve(base,next));result[next]={bytes:b.length,sha256:sha(b)};}}}await visit(sub);return result;}
async function sourceMap(base){return {...await mapTree(base,'src'),...await mapTree(base,'public')};}
async function verifyMap(map,base){for(const [path,expected]of Object.entries(map)){assert(!path.startsWith('/')&&!path.split('/').includes('..'),`Unsafe source path ${path}`);const b=await readFile(resolve(base,path));assert.deepEqual({bytes:b.length,sha256:sha(b)},expected,`Freeze mismatch ${path}`);}}
let frozen=null;
if(freezePath){frozen=JSON.parse(await readFile(freezePath,'utf8'));assert.equal(frozen.frozen,true);assert(frozen.sources&&Object.keys(frozen.sources).length>=17,'Combined frozen source map required');for(const path of ["src/telegram/session-protocol.ts","src/telegram/session-client.ts","src/telegram/session.worker.ts","src/telegram/sources-bridge-protocol.ts","src/ui/TelegramPanel.tsx","src/ui/TelegramSourcesPanel.tsx","src/ui/telegram-sources.css","tests/unit/telegram-session.test.ts","tests/unit/telegram-sources-session.test.ts","tests/integration/check-telegram-sources-session-worker.mjs","tests/integration/check-telegram-sources-session-ui.tsx","tests/integration/check-telegram-sources-session-ui.html","tests/integration/check-telegram-sources-session-browser.mjs","src/telegram/sources-protocol.ts","src/telegram/sources-page.ts","src/telegram/sources-driver.ts","src/telegram/temporary-sdk.ts","src/main.tsx","src/telegram/bot-providers-driver.ts","src/telegram/bot-providers-protocol.ts","src/telegram/bot-chat-profiles.ts","src/ui/BotProvidersPanel.tsx","src/ui/bot-providers.css"])assert(frozen.sources[path],`Missing required frozen source ${path}`);await verifyMap(frozen.sources,project);await copyFile(freezePath,resolve(run,'freeze-input.json'));}
const before=await sourceMap(project);
for(const path of Object.keys(before)){await mkdir(dirname(resolve(root,path)),{recursive:true});await copyFile(resolve(project,path),resolve(root,path));}
const indexBytes=await readFile(resolve(project,'index.html'));await writeFile(resolve(root,'index.html'),indexBytes);
await symlink(resolve(project,'node_modules'),resolve(root,'node_modules'),'dir');
assert.deepEqual(await sourceMap(root),before,'Snapshot complete bytes mismatch');
// Copy TESTONLY SDK next to its genuine relative imports. Main is never transformed.
await copyFile(resolve(project,'tests/integration/telegram-bot-pool-main-sdk.ts'),resolve(root,'src/telegram/R133-TESTONLY-sdk.ts'));
// This extra file is the only addition inside isolated src; excluded solely from
// snapshot comparison by exact name, never from the current-product audit.
const snapshotMap=async()=>{const m=await sourceMap(root);delete m['src/telegram/R133-TESTONLY-sdk.ts'];return m;};
await mkdir(resolve(root,'__r133'));
for(const helper of ['telegram-bot-pool-main-seed.mjs'])await copyFile(resolve(project,'tests/integration',helper),resolve(root,'__r133',helper));
const wav=Buffer.alloc(44+22050*45*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(22050,24);wav.writeUInt32LE(44100,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=0;i<22050*45;i++)wav.writeInt16LE(Math.round(1400*Math.sin(2*Math.PI*440*i/22050)),44+i*2);
await writeFile(resolve(root,'__r133/tone.wav'),wav);
execFileSync(resolve(project,'node_modules/@ffmpeg-installer/linux-x64/ffmpeg'),['-hide_banner','-loglevel','error','-i',resolve(root,'__r133/tone.wav'),'-codec:a','libmp3lame','-b:a','64k',resolve(root,'__r133/tone.mp3')],{timeout:30000});
await writeFile(resolve(root,'__r133/seed.html'),'<!doctype html><meta charset="utf-8"><title>TESTONLY NoTelegram seed</title>');
const helpers=(await readdir(resolve(project,'tests/integration'))).filter(p=>p==='check-telegram-bot-pool-main.mjs'||p.startsWith('telegram-bot-pool-main-'));
const manifest={version:1,label:'TESTONLY NoTelegram; no acceptance from preparation',mode:prepare?'PREPARED_NOT_EXECUTED':exploratory?'EXPLORATORY':'FINAL_ROOT_GO',sourceMap:before,index:{bytes:indexBytes.length,sha256:sha(indexBytes)},helpers:{},fixtures:{},injection:'Exactly temporary-sdk resolution; real worker/client/driver/projector/root/player/storage',mainUntransformed:true};
await mkdir(resolve(run,'harness'));
for(const f of helpers){const b=await readFile(resolve(project,'tests/integration',f));manifest.helpers['tests/integration/'+f]={bytes:b.length,sha256:sha(b)};await writeFile(resolve(run,'harness',f),b);}
for(const f of ['tone.wav','tone.mp3']){const b=await readFile(resolve(root,'__r133',f));manifest.fixtures[f]={bytes:b.length,sha256:sha(b),ownSynthetic:true};}
await writeFile(resolve(run,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(resolve(run,'source-start.json'),JSON.stringify(before,null,2)+'\n');
if(prepare){await writeFile(resolve(owned,'latest-prepare.json'),JSON.stringify({run,manifest:resolve(run,'manifest.json'),status:'PREPARED_NOT_EXECUTED'},null,2)+'\n');console.log(JSON.stringify({status:'PREPARED_NOT_EXECUTED',run,files:Object.keys(before).length,mainUntransformed:true,browser:false,server:false,build:false}));process.exit(0);}
const report={version:1,label:'TESTONLY NoTelegram: fictional auth + SDK boundary only',mode:manifest.mode,focus,status:'RUNNING',run,groups:[],external:[],events:[],requests:[],errors:[],csp:[],productBuild:false,realTelegram:false,acceptance:{ROOT:false,P0:false,T4:false,T9:false,iPhone:false,offline:false,heap:false,realAuth:false},cleanup:false};
let browser,server,context;const sockets=new Set(),pending=new Set();
let plan=[];
const fixture={set(...steps){assert.equal(pending.size,0,'Unsettled fixture HTTP barrier');plan=steps;},release(result){assert.equal(pending.size,1,'Exactly one pending SDK barrier');const res=[...pending][0];pending.delete(res);res.end(JSON.stringify(result));},finishClosed(){assert(pending.size<=1);for(const res of pending)res.destroy();pending.clear();report.events.push({type:'TESTONLY-barrier-disposed-after-observed-worker-termination'});},events:report.events,requests:report.requests};
try{
 const {build}=await import('vite');
 const sdkPath=resolve(root,'src/telegram/R133-TESTONLY-sdk.ts');let injections=0;
 const inject=()=>({name:'R133-TESTONLY-sdk-boundary',enforce:'pre',resolveId(source,importer){if(source==='./temporary-sdk'&&importer?.split('?')[0]===resolve(root,'src/telegram/session.worker.ts')){injections++;return sdkPath;}}});
 if(frozen)await verifyMap(frozen.sources,project);assert.deepEqual(await sourceMap(project),before,'Sources changed before build');
 await build({configFile:false,root,envDir:resolve(run,'empty-env'),publicDir:resolve(root,'public'),logLevel:'warn',plugins:[inject()],worker:{plugins:()=>[inject()]},build:{outDir:out,emptyOutDir:true,rolldownOptions:{input:resolve(root,'index.html')}}});
 assert.equal(injections,1,'Exactly one SDK boundary resolution required');
 // Build real product SW in isolated output, no scripts/build-sw/release pipeline.
 const shell=['/','/index.html',...(await readdir(resolve(out,'assets'))).map(f=>'/assets/'+f)];
 await build({configFile:false,root,envDir:resolve(run,'empty-env'),publicDir:false,logLevel:'warn',define:{SHELL_FILES:JSON.stringify(shell)},build:{outDir:out,emptyOutDir:false,lib:{entry:resolve(root,'src/service-worker/sw.ts'),formats:['es'],fileName:()=> 'sw.js'}}});
 report.injections=injections;
 const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wav':'audio/wav','.mp3':'audio/mpeg'};
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/telegram-config.json'){report.events.push({type:'config-synthetic'});res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({api_id:133,api_hash:'0'.repeat(32)}));return;}
  if(url.pathname==='/__r133/event'){let body='';for await(const chunk of req){body+=chunk;assert(body.length<32768);}const e=JSON.parse(body);report.events.push(e);res.end('{}');return;}
  if(['/__r133/dialogs','/__r133/identity'].includes(url.pathname)){let body='';for await(const chunk of req){body+=chunk;assert(body.length<32768);}report.requests.push({kind:url.pathname.endsWith('/identity')?'identity':'dialogs',...JSON.parse(body)});const next=plan.shift();assert(next,'Unplanned configuration RPC');res.setHeader('Content-Type','application/json');if(next.hold){pending.add(res);res.on('close',()=>pending.delete(res));}else res.end(JSON.stringify(next));return;}
  const base=url.pathname.startsWith('/__r133/')?root:out;
  const path=resolve(base,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));assert(path.startsWith(base+sep));const bytes=await readFile(path);
  res.setHeader('Content-Type',mime[extname(path)]??'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.end(bytes);
 }catch(e){report.errors.push({server:e.message});res.statusCode=500;res.end('TESTONLY server failure');}});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;report.origin=origin;
 const {chromium}=await import('playwright-core');browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true,args:['--disable-dev-shm-usage']});report.browser=browser.version();
 const {runGroups}=await import(pathToFileURL(resolve(run,'harness/telegram-bot-pool-main-browser.mjs')).href);
 const newContext=async()=>{
  const c=await browser.newContext({serviceWorkers:'allow',viewport:{width:1280,height:900}});
  // Context routes abort nonlocal application HTTP; the sole SDK fixture also
  // forbids worker sockets/fetch independently. Native SW uses local assets only.
  await c.route('**/*',route=>{const u=route.request().url();if(new URL(u).origin!==origin){report.external.push({type:'request',url:u});return route.abort();}return route.continue();});
  await c.routeWebSocket(/.*/,socket=>{report.external.push({type:'websocket',url:socket.url()});socket.close();});
  c.on('request',r=>{const u=r.url();if(/^https?:/.test(u)&&new URL(u).origin!==origin)report.external.push({type:'observed',url:u});});
  return c;
 };
 let watchdog;
 try{await Promise.race([runGroups({browser,newContext,origin,fixture,report,run,focus,setContext:c=>context=c}),new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(Error('R133 whole-browser watchdog 400s; no product timer altered')),400000);})]);}finally{clearTimeout(watchdog);}
 if(!exploratory)assert.equal(report.groups.length,12,'Final must execute all 12 groups');
 for(const w of (report.workerTraces??[]).filter(w=>w.sent.some(c=>c.type==='begin')))for(const c of w.sent)assert(['begin','code','password','logout','sources.page','sources.select','sources.clear','sources.cancel','bots.validate','bots.setOrder','bots.cancel'].includes(c.type),`Forbidden outgoing worker command ${c.type}`);
 assert.deepEqual(report.external,[],'External network attempted');assert.equal(report.events.filter(e=>e.type.startsWith('blocked-')).length,0,'Worker attempted external IO');assert.deepEqual(report.errors,[],'Unexpected page/server error');assert.deepEqual(report.csp,[],'Unexpected CSP violation');
 report.status=exploratory?'EXPLORATORY_COMPLETED_NO_ACCEPTANCE':'PASS_LOCAL_MAIN_FIXTURE_ONLY';
}catch(error){report.status=exploratory?'EXPLORATORY_FAIL':'FAIL';report.failure={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 for(const res of pending)res.destroy();pending.clear();
 await context?.close().catch(e=>report.errors.push({cleanup:e.message}));await browser?.close().catch(e=>report.errors.push({cleanup:e.message}));
 if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}for(const s of sockets)s.destroy();
 try{assert.deepEqual(await readFile(resolve(project,'index.html')),indexBytes,'Current index changed');assert.deepEqual(await readFile(resolve(root,'index.html')),indexBytes,'Snapshot index changed');assert.deepEqual(await sourceMap(project),before,'Current src/public changed during run');assert.deepEqual(await snapshotMap(),before,'Snapshot changed during run');if(frozen)await verifyMap(frozen.sources,project);report.sourceAudit={actualEqualsSnapshot:true,freezeCurrent:!!frozen,completeSrcPublic:true,mainBytes:before['src/main.tsx']};}catch(e){report.status='ABORTED_SOURCE_CHANGED';report.sourceAudit={error:e.message};process.exitCode=1;}
 report.cleanupDetails={browserConnected:browser?.isConnected()??false,serverListening:server?.listening??false,remainingFixtureBarriers:pending.size};
 report.cleanup=!report.cleanupDetails.browserConnected&&!report.cleanupDetails.serverListening&&pending.size===0;
 if(!report.cleanup||report.errors.some(e=>e.cleanup)){report.status='FAIL_CLEANUP';process.exitCode=1;}
 await writeFile(resolve(run,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve(owned,'latest-run.json'),JSON.stringify({run,status:report.status},null,2)+'\n');await writeFile(resolve(project,'.local/evidence/telegram-bot-pool-main-r133.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,groups:report.groups,run,failure:report.failure,sourceAudit:report.sourceAudit,cleanup:report.cleanup},null,2));
}
