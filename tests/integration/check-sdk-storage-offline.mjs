// USD0 isolated local SDK storage experiment. No product build/guard changes.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,readdir,mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve,relative,extname,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import {chromium} from 'playwright-core';
const base='.local/sdk-storage-r9',output=base+'/build';
const sha=b=>createHash('sha256').update(b).digest('hex');
const sources=['tests/browser/sdk-storage-offline.ts','tests/browser/sdk-storage-offline.worker.ts','tests/browser/sdk-storage-offline.html','tests/integration/check-sdk-storage-offline.mjs'];
async function tree(path){const result={};async function visit(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())await visit(p);else if(e.isFile()){const b=await readFile(p);result[p]={bytes:b.length,SHA256:sha(b)};}}}await visit(path);return result;}
const before=await tree('dist'),moduleInfo=new Map();
const inventoryPlugin={name:'r9-experiment-inventory',generateBundle(_options,bundle){for(const chunk of Object.values(bundle)){if(chunk.type!=='chunk')continue;for(const [id,info] of Object.entries(chunk.modules)){moduleInfo.set(id,{renderedLength:info.renderedLength??null});}}}};
const report={project:'Pulso-Web',revision:'T4 SDK storage offline r9',passed:false,USD:0,scope:'Public real IdbStorage only; synthetic storage fixtures/trusted driver in isolated Worker/IndexedDB',realAuth:false,legalGateApproved:false,D03:false,D05:false,T4Complete:false,P0Complete:false,iPhone:false,commands:['python3 scripts/sync_odd_memory.py --read-only','node_modules/.bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM,DOM.Iterable tests/browser/sdk-storage-offline.ts tests/browser/sdk-storage-offline.worker.ts','node --check tests/integration/check-sdk-storage-offline.mjs','INSTABOX_HEADLESS=1 node tests/integration/check-sdk-storage-offline.mjs']};
let browser,server;
try{
 await mkdir(base,{recursive:true});
 const memoryText=execFileSync('python3',['scripts/sync_odd_memory.py','--read-only'],{encoding:'utf8'});await writeFile(base+'/memory.json',memoryText);const memory=JSON.parse(memoryText);
 assert.equal(memory.FullContentVerified,true);assert.equal(memory.tasks.length,14);
 for(const task of memory.tasks){const b=await readFile(task.file);assert.equal(task.project,'Pulso-Web');assert.equal(task.FullContentVerified,true);assert.equal(task.bytes,b.length);assert.equal(task.ContentSHA256,sha(b));}
 report.memory={taskCount:memory.tasks.length,FullContentVerified:true,SHA256:sha(memoryText),receipt:base+'/memory.json'};
 const types=execFileSync('node_modules/.bin/tsc',['--ignoreConfig','--noEmit','--strict','--skipLibCheck','--target','ES2022','--module','ESNext','--moduleResolution','bundler','--lib','ES2022,DOM,DOM.Iterable',...sources.filter(f=>f.endsWith('.ts'))],{encoding:'utf8'});await writeFile(base+'/types.log',types);report.types={passed:true,SHA256:sha(types)};
 execFileSync('node',['--check','tests/integration/check-sdk-storage-offline.mjs']);report.runnerSyntax=true;
 await build({configFile:false,publicDir:false,cacheDir:base+'/cache',plugins:[inventoryPlugin],worker:{format:'es',plugins:()=>[inventoryPlugin]},build:{reportCompressedSize:false,outDir:output,emptyOutDir:true,rolldownOptions:{input:'tests/browser/sdk-storage-offline.html'}}});
 const built=await tree(output);report.build={configFile:false,publicDir:false,outDir:output,files:built};
 // Inventory ONLY emitted chunks, including the worker dynamic import from the official entry.
 const modules=[];const packages=new Map();
 for(const [rawId,info] of moduleInfo){if(!rawId.includes('/node_modules/'))continue;const path=rawId.replace(/^\0/,'').split('?')[0];let dir=dirname(path),pkg;
  while(dir.includes('/node_modules/')){try{pkg=JSON.parse(await readFile(dir+'/package.json','utf8'));if(pkg.name)break;}catch{}dir=dirname(dir);}
  if(!pkg?.name)continue;packages.set(pkg.name,{name:pkg.name,version:pkg.version,license:pkg.license,packageJson:relative(process.cwd(),dir+'/package.json')});modules.push({file:relative(process.cwd(),path),...info});
 }
 report.experimentInventory={packages:[...packages.values()].sort((a,b)=>a.name.localeCompare(b.name)),modules:modules.sort((a,b)=>a.file.localeCompare(b.file)),scope:'Only emitted bundle module metadata; renderedLength=0 may be a tree-shaken module. Not a product license approval or complete corresponding-source delivery.'};
 const wasmPackage=JSON.parse(await readFile('node_modules/@mtcute/wasm/package.json','utf8'));
 const wasmAssets=[];for(const file of Object.keys(built).filter(f=>f.endsWith('.wasm'))){const candidates=['node_modules/@mtcute/wasm/mtcute.wasm','node_modules/@mtcute/wasm/mtcute-simd.wasm'];let installedMatch;for(const candidate of candidates){if(sha(await readFile(candidate))===built[file].SHA256)installedMatch=candidate;}assert.ok(installedMatch,'emitted WASM matches installed package');wasmAssets.push({file,...built[file],installedMatch});}
 report.experimentInventory.emittedAssets=wasmAssets;
 report.experimentInventory.assetPackage={name:wasmPackage.name,version:wasmPackage.version,declaredLicense:wasmPackage.license,warning:'Package MIT label is not approval of composite WASM components (AES/tgcrypto LGPL, libdeflate/SHA provenance and corresponding notices/sources remain under prior open review). Emitted for this local experiment only.'};
 await writeFile(base+'/inventory.json',JSON.stringify(report.experimentInventory,null,2)+'\n');
 assert.ok(modules.some(m=>m.file==='node_modules/@mtcute/web/idb/index.js'),'actual installed IdbStorage emitted');
 for(const f of Object.keys(built).filter(f=>f.endsWith('.js'))){const text=await readFile(f,'utf8');assert.ok(!/class BaseTelegramClient|class TelegramClient|client\.session/.test(text),'no client class/default session in emitted experiment');}
 const root=resolve(output),csp="default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'none'; base-uri 'none'; object-src 'none'";
 server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://loopback').pathname,file=resolve(root,'.'+decodeURIComponent(path));if(relative(root,file).startsWith('..')||!(await stat(file)).isFile()){res.writeHead(404).end();return;}const b=await readFile(file);res.writeHead(200,{'Content-Type':extname(file)==='.html'?'text/html':'text/javascript','Content-Length':b.length,'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}).end(b);}catch{res.writeHead(404).end();}});
 await new Promise((a,b)=>{server.once('error',b);server.listen(0,'127.0.0.1',a);});const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true,args:['--disable-background-networking','--disable-component-update','--no-first-run']});report.browserVersion=browser.version();
 const context=await browser.newContext({serviceWorkers:'block'}),external=[],pageErrors=[],cspViolations=[],requests=[];
 // Defense in depth: worker fetch/WS wrappers, connect-src none, browser interception.
 await context.route('**/*',r=>{if(new URL(r.request().url()).origin!==origin){external.push('external-request');return r.abort();}return r.continue();});
 context.on('request',r=>{if(new URL(r.url()).origin===origin)requests.push(new URL(r.url()).pathname);});
 const page=await context.newPage();page.on('pageerror',()=>pageErrors.push('page-error'));page.on('websocket',()=>external.push('websocket'));
 await page.exposeFunction('recordCsp',()=>cspViolations.push('csp-violation'));
 await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',()=>window.recordCsp()));
 const response=await page.goto(origin+'/tests/browser/sdk-storage-offline.html');assert.equal(response.status(),200);assert.equal(response.headers()['content-security-policy'],csp);
 report.browser=await page.evaluate(()=>window.sdkStorageOffline);report.browser.groupCount=report.browser.cases?.length??0;
 assert.equal(report.browser.passed,true,JSON.stringify(report.browser));assert.equal(report.browser.workerNetworkAttempts,0);assert.equal(report.browser.pageNetworkAttempts,0);assert.equal(report.browser.unhandled,0);assert.deepEqual(external,[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(cspViolations,[]);
 report.experimentInventory.requestedLocalPaths=requests;report.experimentInventory.WASMRequested=requests.some(p=>p.endsWith('.wasm'));assert.equal(report.experimentInventory.WASMRequested,false);
 await writeFile(base+'/inventory.json',JSON.stringify(report.experimentInventory,null,2)+'\n');
 report.network={externalRequests:external.length,pageErrors:pageErrors.length,cspViolations:cspViolations.length,workerFetchWebSocketAttempts:report.browser.workerNetworkAttempts,pageFetchWebSocketAttempts:report.browser.pageNetworkAttempts,csp};
 report.sources={};for(const f of [...sources,'node_modules/@mtcute/web/index.js','node_modules/@mtcute/web/idb/index.js','node_modules/@mtcute/web/idb/driver.js','node_modules/@mtcute/core/storage/driver.js','node_modules/@mtcute/web/idb/utils.js','node_modules/@mtcute/web/idb/repository/kv.js','node_modules/@mtcute/web/idb/repository/auth-keys.js','src/telegram/auth-state.ts','src/telegram/auth-scope-store.ts']){const b=await readFile(f);report.sources[f]={bytes:b.length,SHA256:sha(b)};}
 report.distUnchanged=JSON.stringify(before)===JSON.stringify(await tree('dist'));assert.equal(report.distUnchanged,true);report.passed=true;
}catch(e){report.failure=e instanceof Error?e.message:'runner-failure';if(e.stdout)await writeFile(base+'/failed-command.log',e.stdout);process.exitCode=1;}
finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await mkdir('.local/evidence',{recursive:true});await writeFile('.local/evidence/sdk-storage-r9.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failure:report.failure,groups:report.browser?.groupCount,report:'.local/evidence/sdk-storage-r9.json'}));}
