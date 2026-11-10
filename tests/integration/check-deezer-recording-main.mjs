/** MUSIC_FLOW full MAIN selection. --prepare keeps history, no browser/build.
 * Final exactly once, immutable attempt directory and exclusive final claim.
 * Sole SDK factory fixture is synthetic, NEVER account/bot/audio acceptance. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,copyFile,symlink,open} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const helpers=resolve(project,'tests/integration/helpersdeezer-recording-main');
const args=process.argv.slice(2),prepare=args.includes('--prepare');
assert(args.every((a,i)=>['--prepare','--freeze','--go','--groups','--evidence','--source-root'].includes(a)||['--freeze','--go','--groups','--evidence','--source-root'].includes(args[i-1])),'Unknown option');
const sourceRoot=resolve(project,args.includes('--source-root')?args[args.indexOf('--source-root')+1]:'.local/deezer-recording-parent/frozen-root');
const selected=args.includes('--groups')?args[args.indexOf('--groups')+1].split(','):null;assert(!selected||selected.every(n=>/^(0[1-9]|1[0-9]|2[0-9]|3[0-9]|40)$/.test(n)));
const freezePath=resolve(project,args.includes('--freeze')?args[args.indexOf('--freeze')+1]:'.local/deezer-recording-parent/freeze.json');
assert(prepare||args[args.indexOf('--go')+1]==='DEEZER_RECORDING-FINAL','Explicit GO DEEZER_RECORDING-FINAL required');
const owned=resolve(project,args.includes('--evidence')?args[args.indexOf('--evidence')+1]+'/main':'.local/deezer-recording-main');
await mkdir(owned,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),run=resolve(owned,`${prepare?'prepare':'final'}-${stamp}`);await mkdir(run);
const sha=b=>createHash('sha256').update(b).digest('hex');
async function tree(base,sub=''){const out={};async function walk(p){for(const e of(await readdir(resolve(base,p),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const k=p?p+'/'+e.name:e.name;if(e.isDirectory())await walk(k);else{assert(e.isFile(),'Nonregular source '+k);const b=await readFile(resolve(base,k));out[k]={bytes:b.length,sha256:sha(b)};}}}await walk(sub);return out;}
async function sourceMap(base){const m={...await tree(base,'src'),...await tree(base,'public')};for(const p of ['index.html','scripts/serve_review.py']){const b=await readFile(resolve(base,p));m[p]={bytes:b.length,sha256:sha(b)};}return m;}
async function memory(label){const raw=execFileSync('python3',['scripts/sync_odd_memory.py','--read-only'],{cwd:project,encoding:'utf8',maxBuffer:2**20});await writeFile(resolve(run,'engram-'+label+'.json'),raw);const r=JSON.parse(raw);assert.equal(r.mode,'read-only');assert.equal(r.tasks.length,15);assert.equal(r.FullContentVerified,true);for(const t of r.tasks){assert.equal(t.project,'Pulso-Web');assert.equal(t.FullContentVerified,true);const b=await readFile(resolve(project,t.file));assert.equal(t.bytes,b.length);assert.equal(t.ContentSHA256,sha(b));}return r;}
const frozenBytes=await readFile(freezePath),freeze=JSON.parse(frozenBytes);assert.equal(freeze.frozen,true);assert.equal(freeze.project,'Pulso-Web');assert(Object.keys(freeze.sources).length>=146);
const before=await sourceMap(sourceRoot);assert.deepEqual(before,freeze.sources,'STOP freeze differs from complete actual src/public/index/header');
const root=resolve(run,'isolated-root');await mkdir(root);
for(const p of Object.keys(before)){await mkdir(dirname(resolve(root,p)),{recursive:true});await copyFile(resolve(sourceRoot,p),resolve(root,p));}
await symlink(resolve(project,'node_modules'),resolve(root,'node_modules'),'dir');
assert.deepEqual(await sourceMap(root),before);
await writeFile(resolve(run,'freeze-input.json'),frozenBytes);await writeFile(resolve(run,'source-start.json'),JSON.stringify(before,null,2));
await mkdir(resolve(run,'harness'));const harnessMap={};
for(const p of ['check-deezer-recording-main.mjs',...(await readdir(helpers)).map(p=>'helpersdeezer-recording-main/'+p)]){const b=await readFile(resolve(project,'tests/integration',p));await mkdir(dirname(resolve(run,'harness',p)),{recursive:true});await writeFile(resolve(run,'harness',p),b);harnessMap[p]={bytes:b.length,sha256:sha(b)};}
const memoryInitial=await memory('initial');
// Header authority comes from frozen installed server source, not invented permissive CSP.
const headerSource=await readFile(resolve(root,'scripts/serve_review.py'),'utf8');
const policies=[...headerSource.matchAll(/^        (?:    )?policy = "([^"]+)"$/gm)].map(m=>m[1]);assert.equal(policies.length,2);
const replacement=headerSource.match(/policy = policy\.replace\("connect-src 'self';", "([^"]+)"\)/);assert(replacement);const htmlPolicy=policies[0].replace("connect-src 'self';",replacement[1]);assert(htmlPolicy.includes('https://itunes.apple.com'));assert(headerSource.includes('if resolved.suffix == \'.html\':'));assert(headerSource.includes('if resolved.name.startswith(\'session.worker-\')'));assert.equal((htmlPolicy.match(/https:\/\/lrclib.net/g)??[]).length,1);
const manifest={project:'Pulso-Web',mode:prepare?'PREPARED_NOT_EXECUTED':'FINAL',freezeSHA256:sha(frozenBytes),sources:before,harness:harnessMap,headers:{document:htmlPolicy,regular:policies[0],authWorker:policies[1]},groupsPlanned:8,mainSourceTransformations:0,polling:'TESTONLY SDK driver keeps 1000ms poll real for group 16; other groups accelerate that delay to 0. Date.now and other timers remain real.',fixture:'Only ./temporary-sdk resolution from session.worker; native Worker, genuine session/client/provider/search/source drivers. Synthetic binding, not real auth.',claims:{realTelegram:false,realAccount:false,liveBotGrammar:false,realAudioDelivery:false,iPhone:false,P0:false},semanticReading:'Applicable current contracts and selected ODD sections; no full historical semantic reading claim.'};
await writeFile(resolve(run,'manifest.json'),JSON.stringify(manifest,null,2));
if(prepare){await memory('final');assert.deepEqual(await sourceMap(sourceRoot),before);assert.deepEqual(await sourceMap(root),before);await writeFile(resolve(owned,'latest-prepare.json'),JSON.stringify({run,status:manifest.mode},null,2));console.log(JSON.stringify({run,status:manifest.mode,sourceFiles:Object.keys(before).length,groupsPlanned:8,browser:false,build:false}));process.exit(0);}
// Claim is permanent even for failed final. Never overwrite or downgrade raw failures.
const claim=await open(resolve(owned,'final-claimed-'+sha(frozenBytes).slice(0,12)+'-'+sha(Buffer.from(JSON.stringify(harnessMap))).slice(0,12)+(selected?'-'+selected.join('-'):'')+'.json'),'wx');await claim.writeFile(JSON.stringify({run,freezeSHA256:sha(frozenBytes),harness:harnessMap}));await claim.close();
const report={...manifest,selection:selected??'all-8',run,status:'RUNNING',groups:[],rpc:[],events:[],network:[],lrclib:[],pageErrors:[],csp:[],serverErrors:[],servedHeaders:[],resources:{},memoryInitial,cleanup:false};
const outControl=resolve(run,'control-build'),outFixture=resolve(run,'fixture-build');
let browser,server;const contexts=new Set(),pending=new Map(),sockets=new Set();let control=false,scenario={mode:'menu'},rpcIndex=0;
const fixture={
 reset(){assert.equal(pending.size,0,'Unsettled SDK HTTP barrier');scenario={mode:'menu'};},
 set(v){assert.equal(pending.size,0);scenario={mode:'menu',...v};},
 release(v={}){assert.equal(pending.size,1,'one native-await barrier required');const [res,body]=[...pending][0];pending.delete(res);scenario={...scenario,hold:undefined};res.end(JSON.stringify({...body,...v}));},
 dispose(){for(const res of pending.keys())res.destroy();pending.clear();},
 get pendingCount(){return pending.size;},get requests(){return report.rpc;},get events(){return report.events;},
};
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wav':'audio/wav','.mp3':'audio/mpeg'};
try{
 const {build}=await import('vite');
 const standard={configFile:false,root,envDir:resolve(run,'empty-env'),logLevel:'warn'};
 await build({...standard,publicDir:resolve(root,'public'),build:{outDir:outControl,emptyOutDir:true}});
 await copyFile(resolve(helpers,'sdk.ts'),resolve(root,'src/telegram/MUSIC_FLOW-TESTONLY-sdk.ts'));
 await mkdir(resolve(root,'__musicflow'));await writeFile(resolve(root,'__musicflow/zoom.css'),'html { font-size: 200%; }');await writeFile(resolve(root,'__musicflow/seed.html'),'<!doctype html><meta charset="utf-8"><title>MUSIC_FLOW TESTONLY importer</title>');
 // Real importer as a separate test entry, with imports resolved to the snapshot.
 const seed=(await readFile(resolve(helpers,'seed.ts'),'utf8')).replaceAll('../../../src/','../src/');await writeFile(resolve(root,'__musicflow/seed.ts'),seed);
 await copyFile(resolve(helpers,'snapshot.mjs'),resolve(root,'__musicflow/snapshot.mjs'));
 const wav=Buffer.alloc(44+22050*45*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(22050,24);wav.writeUInt32LE(44100,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=0;i<22050*45;i++)wav.writeInt16LE(Math.round(1400*Math.sin(2*Math.PI*440*i/22050)),44+i*2);await writeFile(resolve(root,'__musicflow/tone.wav'),wav);
 execFileSync(resolve(project,'node_modules/@ffmpeg-installer/linux-x64/ffmpeg'),['-hide_banner','-loglevel','error','-i',resolve(root,'__musicflow/tone.wav'),'-codec:a','libmp3lame','-b:a','64k',resolve(root,'__musicflow/tone.mp3')],{timeout:30000});
 execFileSync(resolve(project,'node_modules/@ffmpeg-installer/linux-x64/ffmpeg'),['-hide_banner','-loglevel','error','-i',resolve(root,'__musicflow/tone.wav'),'-codec:a','libmp3lame','-b:a','64k','-metadata','title=MUSIC_FLOW Song','-metadata','artist=MUSIC_FLOW Artist','-metadata','album=MUSIC_FLOW Album',resolve(root,'__musicflow/download.mp3')],{timeout:30000});
 for(const [name,title,frequency] of [['second','MUSIC_FLOW Second','550'],['third','MUSIC_FLOW Third','660']])execFileSync(resolve(project,'node_modules/@ffmpeg-installer/linux-x64/ffmpeg'),['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency='+frequency+':duration=45','-codec:a','libmp3lame','-b:a','64k','-metadata','title='+title,'-metadata','artist=MUSIC_FLOW Artist','-metadata','album=MUSIC_FLOW Album',resolve(root,'__musicflow/'+name+'.mp3')],{timeout:30000});
 report.fixtureHashes=Object.fromEntries(await Promise.all(['second.mp3','third.mp3'].map(async name=>[name,sha(await readFile(resolve(root,'__musicflow',name)))])));
 for(const [name,title,artist,album,duration] of [['alias','MUSIC_FLOW Song (Album Version)','MUSIC_FLOW Artist','MUSIC_FLOW Album',45],['wrong-album','MUSIC_FLOW Song (Album Version)','MUSIC_FLOW Artist','Other Album',45],['missing-tags','MUSIC_FLOW Song (Album Version)','','',45],['foreign-artist','MUSIC_FLOW Song (Album Version)','Other Artist','MUSIC_FLOW Album',45],['wrong-duration','MUSIC_FLOW Song (Album Version)','MUSIC_FLOW Artist','MUSIC_FLOW Album',48]])execFileSync(resolve(project,'node_modules/@ffmpeg-installer/linux-x64/ffmpeg'),['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration='+duration,'-codec:a','libmp3lame','-b:a','64k','-metadata','title='+title,'-metadata','artist='+artist,'-metadata','album='+album,resolve(root,'__musicflow/'+name+'.mp3')],{timeout:30000});
 for(const [name,artist]of [['collaboration','MUSIC_FLOW Artist; Guest'],['wrong-tags','Another Artist']])execFileSync(resolve(project,'node_modules/@ffmpeg-installer/linux-x64/ffmpeg'),['-hide_banner','-loglevel','error','-i',resolve(root,'__musicflow/tone.wav'),'-codec:a','aac','-b:a','64k','-metadata','title=MUSIC_FLOW Song','-metadata','artist='+artist,'-metadata','album=MUSIC_FLOW Album',resolve(root,'__musicflow/'+name+'.m4a')],{timeout:30000});
 await build({...standard,publicDir:false,build:{outDir:resolve(root,'__musicflow/importer'),lib:{entry:resolve(root,'__musicflow/seed.ts'),formats:['es'],fileName:()=> 'seed.js'}}});
 let injections=0;const inject=()=>({name:'MUSIC_FLOW-only-sdk-factory',enforce:'pre',resolveId(s,i){if(s==='./temporary-sdk'&&i?.split('?')[0]===resolve(root,'src/telegram/session.worker.ts')){injections++;return resolve(root,'src/telegram/MUSIC_FLOW-TESTONLY-sdk.ts');}}});
 await build({...standard,plugins:[inject()],worker:{plugins:()=>[inject()]},publicDir:resolve(root,'public'),build:{outDir:outFixture,emptyOutDir:true}});assert.equal(injections,1);report.injections=injections;
 for(const out of [outControl,outFixture]){const shell=['/','/index.html',...(await readdir(resolve(out,'assets'))).map(f=>'/assets/'+f)];await build({...standard,publicDir:false,define:{SHELL_FILES:JSON.stringify(shell)},build:{outDir:out,emptyOutDir:false,lib:{entry:resolve(root,'src/service-worker/sw.ts'),formats:['es'],fileName:()=> 'sw.js'}}});}
 report.buildStart={control:await tree(outControl),fixture:await tree(outFixture)};await writeFile(resolve(run,'build-start.json'),JSON.stringify(report.buildStart,null,2));
 server=createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://127.0.0.1');if(u.pathname==='/favicon.ico'){res.statusCode=204;res.end();return;}let body='';if(req.method==='POST'){for await(const b of req){body+=b;assert(body.length<32768);}}
  if(u.pathname==='/__musicflow/event'){report.events.push(JSON.parse(body));res.end(JSON.stringify({mode:scenario.mode,persistSession:!!scenario.persistSession,realPoll:!!scenario.realPoll}));return;}
  if(u.pathname==='/__musicflow/rpc'){const p=JSON.parse(body);report.rpc.push({index:++rpcIndex,at:Date.now(),...p});const kind=p.method==='upload.getFile'?'file':p.method==='messages.getBotCallbackAnswer'?'callback':p.method==='messages.getMessages'?'known':p.method==='messages.sendMessage'?'send':p.method==='messages.getHistory'?(p.limit===1?'baseline':'poll'):'identity';const provider=({101:'first',102:'second',103:'third',104:'fourth'})[p.currentPeer]??'first';const mode=scenario.providers?.[provider]??scenario.mode;const payload={mode,...(scenario.errorStage===kind&&(!scenario.errorProvider||scenario.errorProvider===provider)?{error:scenario.error}:{}),label:scenario.label};res.setHeader('Content-Type','application/json');if(scenario.hold===kind){pending.set(res,payload);res.on('close',()=>pending.delete(res));}else res.end(JSON.stringify(payload));return;}
  if(u.pathname==='/telegram-config.json'){report.configLoads=(report.configLoads??0)+1;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({api_id:12345,api_hash:'0'.repeat(32)}));return;}
  if(u.pathname==='/__musicflow/idb-worker.js'){const target=u.searchParams.get('target');assert(target&&/^\/assets\/import\.worker-[a-zA-Z0-9_-]+\.js$/.test(target));res.setHeader('Content-Type','text/javascript');res.setHeader('Content-Security-Policy',policies[0]);res.end('const pending=[];self.onmessage=e=>pending.push(e);Object.defineProperty(Object.getPrototypeOf(navigator.storage),"getDirectory",{value:undefined,configurable:true});await import('+JSON.stringify(target)+');for(const e of pending)self.onmessage(e);');return;}
  const base=u.pathname.startsWith('/__musicflow/')?root:control?outControl:outFixture;
  const path=resolve(base,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));assert(path.startsWith(base+sep),'traversal');const bytes=await readFile(path);const file=path.split('/').at(-1);
  let policy=extname(path)==='.html'?htmlPolicy:policies[0];if(file.startsWith('session.worker-')&&file.endsWith('.js'))policy=policies[1];report.servedHeaders.push({path:u.pathname,kind:control?'control':'fixture',policy,bytes:bytes.length,sha256:sha(bytes)});res.setHeader('Content-Security-Policy',policy);res.setHeader('Content-Type',mime[extname(path)]??'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');if(file==='sw.js')res.setHeader('Service-Worker-Allowed','/');
  res.setHeader('Content-Length',bytes.length);res.end(req.method==='HEAD'?undefined:bytes);
 }catch(e){report.serverErrors.push(e.message);res.statusCode=500;res.end('TESTONLY failure');}});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;report.origin=origin;
 const {chromium}=await import('playwright-core');browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true,args:['--disable-dev-shm-usage'],env:{...process.env,INSTABOX_HEADLESS:'1'}});report.browser=browser.version();assert.match(report.browser,/^154\./);
 const newContext=async()=>{const c=await browser.newContext({serviceWorkers:'allow',viewport:{width:1280,height:900}});contexts.add(c);c.on('close',()=>contexts.delete(c));await c.routeWebSocket(/.*/,s=>{report.network.push({type:'websocket',url:s.url()});s.close();});return c;};
 const {runGroups}=await import(pathToFileURL(resolve(run,'harness/helpersdeezer-recording-main/browser.mjs')).href);
 await runGroups({newContext,origin,fixture,report,run,selected,setBuildControl:v=>control=v});
 assert.equal(report.groups.length,selected?.length??8);assert(report.groups.every(g=>g.status==='PASS'),'One or more browser groups failed');assert.deepEqual(report.network,[]);assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.csp,[]);assert.deepEqual(report.serverErrors,[]);assert(!report.events.some(e=>e.type.startsWith('blocked-')));
 for(const r of report.rpc)assert(['contacts.resolveUsername','messages.getHistory','messages.sendMessage','messages.getDialogs','messages.getMessages','messages.getBotCallbackAnswer','upload.getFile'].includes(r.method));
 report.status='PASS_LOCAL_MAIN_SYNTHETIC_SDK_ONLY';
}catch(e){report.status='FAIL';report.fatal={message:e.message,stack:e.stack};process.exitCode=1;}
finally{
 fixture.dispose();for(const c of contexts)await c.close().catch(e=>report.pageErrors.push('cleanup '+e.message));await browser?.close().catch(e=>report.pageErrors.push('cleanup '+e.message));if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}for(const s of sockets)s.destroy();
 report.resources={contexts:contexts.size,browserConnected:browser?.isConnected()??false,serverListening:server?.listening??false,pending:pending.size};report.cleanup=contexts.size===0&&!report.resources.browserConnected&&!report.resources.serverListening&&pending.size===0;
 try{const now=await sourceMap(sourceRoot);assert.deepEqual(now,before);assert.deepEqual(await readFile(freezePath),frozenBytes);const snap=await sourceMap(root);delete snap['src/telegram/MUSIC_FLOW-TESTONLY-sdk.ts'];assert.deepEqual(snap,before);report.sourceFinal=now;report.sourceUnchanged=true;report.buildFinal={control:await tree(outControl),fixture:await tree(outFixture)};assert.deepEqual(report.buildFinal,report.buildStart);report.memoryFinal=await memory('final');}catch(e){report.status='ABORTED_FREEZE_OR_AUDIT_FAILED';report.auditFailure=e.message;process.exitCode=1;}
 if(!report.cleanup){report.status='FAIL_CLEANUP';process.exitCode=1;}
 report.counts={uniquePlanned:selected?.length??8,executed:report.groups.length,passed:report.groups.filter(g=>g.status==='PASS').length,failed:report.groups.filter(g=>g.status==='FAIL').length};report.finished=new Date().toISOString();await writeFile(resolve(run,'report.json'),JSON.stringify(report,null,2));await writeFile(resolve(owned,'report-latest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({run,status:report.status,counts:report.counts,cleanup:report.cleanup,fatal:report.fatal,auditFailure:report.auditFailure},null,2));
}
