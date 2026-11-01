import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const directory='.local/reader-b1a-r17';
const cases=['valid-presence','valid-integrity','valid-restore','valid-legacy-default','valid-legacy-integrity','missing-manifest',
 'manifest-null','manifest-invalid','manifest-id-mismatch','manifest-hostile-manifest','digest-presence-legacy-false','bytes-missing','bytes-short','bytes-long','bytes-digest','bytes-chunk-type','generation-changed',
 ...['manifest','open','bytes'].flatMap(where=>['security','quota','abort','hostile'].map(kind=>`io-${where}-${kind}`)),
 'unknown-plan-preserves','ABA-survivors-attempt-cache'];
const selected=process.argv.slice(2);assert.ok(selected.every(name=>cases.includes(name)),'unknown case filter');
function replace(code,before,after){assert.ok(code.includes(before),`counter instrumentation anchor missing: ${before}`);return code.replace(before,after);}
const instrumentation={name:'reader-b1a-isolated-probes',enforce:'pre',transform(code,id){
 if(id.endsWith('/src/storage/database.ts')){
  code=replace(code,'export async function readRecord<T>(store: string, key: IDBValidKey): Promise<T | undefined> {',`export async function readRecord<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
   const p=(globalThis as any).readerProbe;if(p?.enabled){if(store==='assets')p.assets++;if(store==='chunks')p.chunks++;}`);
  code=replace(code,'await done; return result;','await done; return store===\'assets\'&&p?.enabled&&p.manifest?p.manifest(result):result;');
  return code;
 }
 if(!id.endsWith('/src/storage/asset-reader.ts'))return;
 code=replace(code,'export async function openAssetReader(asset:LocalAsset,current=true):Promise<AssetReader> {',`export async function openAssetReader(asset:LocalAsset,current=true):Promise<AssetReader> {
 const p=(globalThis as any).readerProbe;if(p?.enabled){p.opens++;await p.onOpen?.(asset);}`);
 code=replace(code,'if(!released){released=true;unlock();}','if(!released){released=true;if(p?.enabled)p.releases++;unlock();}');
 code=replace(code,'const readRange=async(start:number,end:number)=>atBoundary(\'read\',asset.backend,async()=>{','const readRange=async(start:number,end:number)=>atBoundary(\'read\',asset.backend,async()=>{if(p?.enabled)p.ranges++;');
 code=replace(code,'const verifyDetailed=async(integrity=true):Promise<ReadVerificationV1>=>{','const verifyDetailed=async(integrity=true):Promise<ReadVerificationV1>=>{if(p?.enabled){p.verifies++;await p.onVerify?.(asset);}');
 code=replace(code,'const hash=integrity?sha256.create():null;','if(p?.enabled&&integrity)p.hashes++;const hash=integrity?sha256.create():null;');
 code=replace(code,'if(hash&&bytesToHex(hash.digest())!==asset.sha256)','if(hash&&bytesToHex((p?.enabled&&p.digests++,hash.digest()))!==asset.sha256)');
 return code;
}};
let server,browser;
const report={project:'Pulso-Web',revision:17,passed:false,cases:[],pageErrors:[],externalAttempts:[],
 limits:['Chromium sandbox, isolated loopback Vite runner; real IDB/OPFS, synthetic bytes only.','Faults injected at native browser operations; quota not physically exhausted.','Read-only source transforms add counters and hostile-manifest/generation test hooks, never emitted into product.','No main/UI/wiring, Blob, SW, physical iPhone, T18/P0 acceptance or product build.']};
await mkdir(directory,{recursive:true});
try{
 server=await createServer({configFile:false,publicDir:false,cacheDir:`${directory}/vite-cache`,appType:'mpa',
  plugins:[instrumentation],optimizeDeps:{noDiscovery:true,include:[]},
  server:{host:'127.0.0.1',port:0,strictPort:true,hmr:false,fs:{allow:[resolve('.')]}}});
 await server.listen();
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 for(const backend of ['idb','opfs'])for(const name of selected.length?selected:cases){
  if(backend==='opfs'&&name==='bytes-chunk-type'||backend==='idb'&&name.startsWith('io-open-'))continue;
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  page.on('pageerror',error=>report.pageErrors.push({name,backend,message:error.message}));
  await context.route('**/*',route=>{const url=route.request().url();if(new URL(url).origin!==origin){report.externalAttempts.push(new URL(url).protocol);return route.abort();}return route.continue();});
  try{
   await page.goto(`${origin}/tests/browser/reader-availability.html?backend=${backend}&case=${name}`);
   await page.waitForFunction(()=>globalThis.readerAvailabilityReport!==undefined,{},{timeout:30000});
   const result=await page.evaluate(()=>globalThis.readerAvailabilityReport);report.cases.push(result);
   console.log(`${result.passed?'PASS':'FAIL'} ${backend} ${name}${result.error?`: ${result.error}`:''}`);
  }catch(error){report.cases.push({name,backend,passed:false,harnessError:error.message});console.log(`FAIL ${backend} ${name}: ${error.message}`);}
  finally{await context.close();}
 }
 assert.equal(report.pageErrors.length,0,'page errors');assert.equal(report.externalAttempts.length,0,'external attempts');assert.ok(report.cases.every(c=>c.passed),'one or more cases failed');report.passed=true;
}finally{
 await browser?.close();await server?.close();
 const path=`${directory}/browser-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(path);
}
