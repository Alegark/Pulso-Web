import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const directory='.local/reader-blob-b1b-r20';
const cases=['guard-issued-corrupt','consumer-issued-corrupt','legacy-default-boolean','scan-valid','guard-unknown','guard-cancel','consumer-unknown','consumer-hostile','consumer-dom','late-cancel','final-cancel','presence-callback','presence-check','blob-valid','blob-occurrences','blob-missing','blob-short','blob-long','blob-corrupt','manifest-missing','manifest-invalid','manifest-mismatch','manifest-hostile','io-unknown','io-denied','generation-changed','budget-file','budget-queue','current-before','current-read','current-digest','current-url','current-manifest','url-failure','blob-failure','owner-invalid','owner-mismatch','current-open','native-io-unknown','native-io-denied','current-throw','current-hostile'];
const selected=process.argv.slice(2);assert.ok(selected.every(name=>cases.includes(name)),'unknown case filter');
function replace(code,before,after){assert.ok(code.includes(before),`counter instrumentation anchor missing: ${before}`);return code.replace(before,after);}
const instrumentation={name:'reader-blob-b1b-isolated-probes',enforce:'pre',transform(code,id){
 if(id.endsWith('/src/storage/database.ts')){
  code=replace(code,'export async function readRecord<T>(store: string, key: IDBValidKey): Promise<T | undefined> {',`export async function readRecord<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
   const p=(globalThis as any).blobScanProbe;if(p?.enabled){if(store==='assets')p.assets++;if(store==='chunks')p.chunks++;}`);
  code=replace(code,'await done; return result;','await done; return store===\'assets\'&&p?.enabled&&p.manifest?p.manifest(result):result;');
  return code;
 }
 if(!id.endsWith('/src/storage/asset-reader.ts'))return;
 code=replace(code,'export async function openAssetReader(asset:LocalAsset,current=true):Promise<AssetReader> {',`export async function openAssetReader(asset:LocalAsset,current=true):Promise<AssetReader> {
 const p=(globalThis as any).blobScanProbe;if(p?.enabled){p.opens++;await p.onOpen?.(asset);}`);
 code=replace(code,'if(!released){released=true;unlock();}','if(!released){released=true;if(p?.enabled)p.releases++;unlock();}');
 code=replace(code,'const readRange=async(start:number,end:number)=>atBoundary(\'read\',asset.backend,async()=>{','const readRange=async(start:number,end:number)=>atBoundary(\'read\',asset.backend,async()=>{if(p?.enabled){p.ranges++;p.onRead?.();}');
 code=replace(code,'const verifyDetailed=async(integrity=true,scan?:{check?:()=>void;onChunk?:(bytes:Uint8Array)=>void}):Promise<ReadVerificationV1>=>{','const verifyDetailed=async(integrity=true,scan?:{check?:()=>void;onChunk?:(bytes:Uint8Array)=>void}):Promise<ReadVerificationV1>=>{if(p?.enabled){p.verifies++;}');
 code=replace(code,'const hash=integrity?sha256.create():null;','if(p?.enabled&&integrity)p.hashes++;const hash=integrity?sha256.create():null;');
 code=replace(code,'if(hash&&bytesToHex(hash.digest())!==asset.sha256)','if(hash&&bytesToHex((p?.enabled&&(p.digests++,p.onDigest?.()),hash.digest()))!==asset.sha256)');
 code=replace(code,'Math.min(offset+65536,asset.bytes));check();hash?.update(bytes);','Math.min(offset+65536,asset.bytes));if(p?.enabled)p.afterRead?.();check();hash?.update(bytes);');
 return code;
}};
let server,browser;
const report={project:'Pulso-Web',revision:20,passed:false,cases:[],pageErrors:[],externalAttempts:[],
 limits:['Chromium sandbox, isolated loopback Vite runner; real IDB/OPFS, synthetic bytes only.','Faults injected at native browser operations and isolated readRange/manifest hooks; quota not physically exhausted.','Read-only source transforms add counters and hostile-manifest/generation test hooks, never emitted into product.','No main/UI/wiring, SW, physical iPhone, T18/P0 acceptance or production build.']};
await mkdir(directory,{recursive:true});
try{
 server=await createServer({configFile:false,publicDir:false,cacheDir:`${directory}/vite-cache`,appType:'mpa',
  plugins:[instrumentation],optimizeDeps:{noDiscovery:true,include:[]},
  server:{host:'127.0.0.1',port:0,strictPort:true,hmr:false,fs:{allow:[resolve('.')]}}});
 await server.listen();
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});report.browser=browser.version();
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 for(const backend of ['idb','opfs'])for(const name of selected.length?selected:cases){
  
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  page.on('pageerror',error=>report.pageErrors.push({name,backend,message:error.message}));
  await context.route('**/*',route=>{const url=route.request().url();if(new URL(url).origin!==origin){report.externalAttempts.push(new URL(url).protocol);return route.abort();}return route.continue();});
  try{
   await page.goto(`${origin}/tests/browser/reader-blob-scan.html?backend=${backend}&case=${name}`);
   await page.waitForFunction(()=>globalThis.readerBlobScanReport!==undefined,{},{timeout:30000});
   const result=await page.evaluate(()=>globalThis.readerBlobScanReport);report.cases.push(result);
   console.log(`${result.passed?'PASS':'FAIL'} ${backend} ${name}${result.error?`: ${result.error}`:''}`);
  }catch(error){report.cases.push({name,backend,passed:false,harnessError:error.message});console.log(`FAIL ${backend} ${name}: ${error.message}`);}
  finally{await context.close();}
 }
 assert.equal(report.pageErrors.length,0,'page errors');assert.equal(report.externalAttempts.length,0,'external attempts');assert.ok(report.cases.every(c=>c.passed),'one or more cases failed');report.passed=true;
}finally{
 await browser?.close();await server?.close();
 const path=`${directory}/browser-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(path);
}
