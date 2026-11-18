import test from 'node:test';import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';

const hook=registerHooks({
 resolve(specifier,context,next){
  if(specifier==='cloudflare:workers')return {
   url:'data:text/javascript,export class DurableObject {}',shortCircuit:true,
  };
  return next(specifier,context);
 },
});
const {default:worker,CatalogCoordinator}=await import('../../deployment/cloudflare/worker.mjs')
 .finally(()=>hook.deregister());
const origin='https://pulso.test';
const request=(path,init)=>new Request(origin+path,init);

test('the Worker sends document, SDK and default CSPs for the appropriate assets',async()=>{
 const env={ASSETS:{fetch:async r=>{
  const path=new URL(r.url).pathname;
  const mime=path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.js')?'application/javascript':'text/css';
  return new Response('fixture',{headers:{'Content-Type':mime,'Cache-Control':'public, max-age=60'}});
 }}};
 const asset=path=>worker.fetch(request(path),env);
 const page=await asset('/releases/0000000000000000.html');
 assert.match(page.headers.get('Content-Security-Policy'),/connect-src[^;]+itunes\.apple\.com/);
 assert.doesNotMatch(page.headers.get('Content-Security-Policy'),/wasm-unsafe-eval|telegram\.org/);
 assert.equal(page.headers.get('Cache-Control'),'no-store');

 const sdk=await asset('/assets/session.worker-hash.js');
 assert.match(sdk.headers.get('Content-Security-Policy'),/script-src[^;]+wasm-unsafe-eval/);
 assert.match(sdk.headers.get('Content-Security-Policy'),/connect-src[^;]+wss:\/\/pluto\.web\.telegram\.org/);
 assert.doesNotMatch(sdk.headers.get('Content-Security-Policy'),/itunes\.apple\.com/);

 const style=await asset('/assets/theme-hash.css');
 assert.match(style.headers.get('Content-Security-Policy'),/connect-src 'self';/);
 assert.doesNotMatch(style.headers.get('Content-Security-Policy'),/wasm-unsafe-eval|telegram\.org|itunes\.apple\.com/);
 assert.equal(style.headers.get('X-Content-Type-Options'),'nosniff');
 assert.equal(style.headers.get('Cache-Control'),'public, max-age=60');

 const serviceWorker=await asset('/sw.js');
 assert.equal(serviceWorker.headers.get('Cache-Control'),'no-cache');
 assert.equal(serviceWorker.headers.get('Service-Worker-Allowed'),'/');
});

test('dot-prefixed segments and invalid methods never hit assets',async()=>{
 const env={ASSETS:{fetch:async()=>{assert.fail('must not dispatch to assets');}}};
 for(const path of ['/.env','/assets/.git/config']){
  assert.equal((await worker.fetch(request(path),env)).status,404);
 }
 assert.equal((await worker.fetch(request('/sw.js',{method:'POST'}),env)).status,405);
});

test('catalog only forwards GET from a permitted origin and passes only the client IP',async()=>{
 let calls=0;
 const env={CATALOG:{
  idFromName:name=>{assert.equal(name,'public-catalog-v1');return name;},
  get:()=>({fetch:async r=>{
   calls++;
   assert.equal(r.url,'https://catalog.internal/catalog/itunes/search?term=fixture');
   assert.deepEqual([...r.headers],[['cf-connecting-ip','192.0.2.10']]);
   return Response.json({results:[]});
  }}),
 }};
 const path='/catalog/itunes/search?term=fixture';
 for(const [init,status] of [
  [{method:'POST'},405],[{method:'HEAD'},405],
  [{headers:{Origin:'https://foreign.test'}},403],[{headers:{'Sec-Fetch-Site':'cross-site'}},403],
 ]){
  assert.equal((await worker.fetch(request(path,init),env)).status,status);
 }
 assert.equal(calls,0);
 const response=await worker.fetch(request(path,{headers:{
  Origin:origin,'CF-Connecting-IP':'192.0.2.10',Cookie:'fixture=x',Authorization:'fixture',Referer:origin,
 }}),env);
 assert.equal(response.status,200);assert.equal(calls,1);
});

test('the DO passes the same client identity to both catalog providers',async()=>{
 const ctx={blockConcurrencyWhile:run=>run(),storage:{get:async()=>undefined}};
 const coordinator=new CatalogCoordinator(ctx,{});
 await coordinator.ready;
 assert.equal(coordinator.relay.clientSlots,coordinator.musicbrainz.clientSlots);
 for(const [relay,path] of [
  [coordinator.relay,'/catalog/itunes/search'],
  [coordinator.musicbrainz,'/catalog/musicbrainz/search'],
 ]){
  relay.get=async (gotPath,query,client)=>{
   assert.equal(gotPath,path);assert.equal(query,'?term=fixture');assert.equal(client,'192.0.2.10');
   return {body:'{}',mime:'application/json'};
  };
  const response=await coordinator.fetch(new Request('https://catalog.internal'+path+'?term=fixture',{headers:{'CF-Connecting-IP':'192.0.2.10'}}));
  assert.equal(response.status,200);
 }
});
