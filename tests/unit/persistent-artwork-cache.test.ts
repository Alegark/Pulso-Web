import assert from 'node:assert/strict';
import test from 'node:test';

async function policy(){
 // Dynamic resolution allows the same assertions to run against the baseline.
 const path='../../src/cache/artwork-policy';
 return await import(path) as typeof import('../../src/cache/artwork-policy');
}
test('C01/C02 · oversize or invalid persistent artwork is rejected',async()=>{
 const {fitsThumbnail}=await policy();
 assert.equal(fitsThumbnail({width:300,height:150,byteLength:262144}),true);
 for(const bad of [{width:301},{height:301},{byteLength:262145},{width:0},{byteLength:0}]){
  assert.equal(fitsThumbnail({width:300,height:300,byteLength:100,...bad}),false);
 }
});
test('C02 · evicts the least recent covers only after crossing either high watermark',async()=>{
 const {selectArtworkEvictions}=await policy();
 const make=(count:number,byteLength:number)=>Array.from({length:count},(_,i)=>({artworkKey:String(i),byteLength,lastAccessedAt:i}));
 assert.deepEqual(selectArtworkEvictions(make(800,1)),[]);
 assert.deepEqual(selectArtworkEvictions(make(801,1)),make(161,1).map(x=>x.artworkKey));
 assert.deepEqual(selectArtworkEvictions(make(120,262144)),[]);
 assert.deepEqual(selectArtworkEvictions(make(121,262144)),make(25,262144).map(x=>x.artworkKey));
});
test('C03/C05 · persistent covers remain usable offline after expiry and fresh hits need no network',async()=>{
 const {artworkFreshness}=await policy();
 const day=86400000;
 assert.equal(artworkFreshness(1,29*day,true),'fresh');
 assert.equal(artworkFreshness(1,31*day,true),'stale');
 assert.equal(artworkFreshness(1,91*day,true),'expired');
 assert.equal(artworkFreshness(1,91*day,false),'fresh');
});
test('C04 · local art and manual absence take priority over both remote sources',async()=>{
 const {artworkPriority}=await policy();
 assert.equal(artworkPriority({state:'ready',manual:false}),'local');
 assert.equal(artworkPriority({state:'absent',manual:true}),'hidden');
 assert.equal(artworkPriority({state:'unavailable'}),'hidden');
 assert.equal(artworkPriority({state:'absent',manual:false}),'remote');
});
test('C06 · account range contains only the requested compound keys',async()=>{
 const {artworkAccountBounds}=await policy();
 assert.deepEqual(artworkAccountBounds('A'),[['A'],['A',[]]]);
});
test('C05 · an offline catalog call does not probe the relay or dispatch a request',async()=>{
 const {createCatalogTransport}=await import('../../src/library/catalog-fetch');
 const saved=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false}});
 try{
  let attempts=0;
  const transport=createCatalogTransport({origin:'http://localhost',fetcher:async()=>{
   attempts++;return Response.json({version:1,itunes:true,artwork:true,musicbrainz:true});
  }});
  assert.equal(await transport.musicbrainz(),false);
  await assert.rejects(transport.fetch('https://itunes.apple.com/search?term=fixture'),/offline/);
  assert.equal(attempts,0);
 }finally{
  if(saved)Object.defineProperty(globalThis,'navigator',saved);
  else Reflect.deleteProperty(globalThis,'navigator');
 }
});
