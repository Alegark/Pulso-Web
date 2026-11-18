import {test} from 'node:test';import assert from 'node:assert/strict';
import {CatalogRelay,upstream,RelayError} from '../../deployment/cloudflare/relay.mjs';
const empty=()=>Response.json({resultCount:0,results:[]});
test('closed metadata parameters and artwork hosts reject SSRF, JSONP, audio, duplicates and other markets',()=>{
 for(const [path,q] of [['/catalog/itunes/search','term=x&callback=alert'],['/catalog/itunes/search','term=x&country=GB'],['/catalog/itunes/search','term=x&term=y'],['/catalog/itunes/search','term=%00'],['/catalog/itunes/lookup','id=9007199254740992'],['/catalog/itunes/lookup','id=1&entity=musicArtist'],['/catalog/nope','term=x'],...['https://is1-ssl.mzstatic.com@127.0.0.1/x.png','https://is1-ssl.mzstatic.com:443/x.png','https://is1-ssl.mzstatic.com/a.mp3','https://evil.example/a.png','http://is1-ssl.mzstatic.com/a.png','https://is1-ssl.mzstatic.com/a.png?x=y'].map(u=>['/catalog/artwork',new URLSearchParams({u}).toString()])])assert.throws(()=>upstream(path,q),RelayError);
 assert.match(upstream('/catalog/itunes/search','term=MOSCA&entity=album').url,/^https:\/\/itunes.apple.com\/search\?/);
});
test('same query shares one load, normalizes order and uses bounded RAM cache',async()=>{
 let calls=0,finish;const hold=new Promise(r=>finish=r);const relay=new CatalogRelay({spacing:0,fetcher:async()=>{calls++;await hold;return empty();}});
 const a=relay.get('/catalog/itunes/search','term=x&entity=album'),b=relay.get('/catalog/itunes/search','entity=album&term=x');finish();assert.deepEqual(await a,await b);assert.equal(calls,1);await relay.get('/catalog/itunes/search','term=x&entity=album');assert.equal(calls,1);
});
test('metadata quota has sequential spacing and persists timestamps without query content',async()=>{
 let now=10000;const times=[],saved=[];const relay=new CatalogRelay({clock:()=>now,spacing:3100,sleep:async ms=>{now+=ms;},checkpoint:async x=>saved.push(x),fetcher:async()=>{times.push(now);return empty();}});
 await Promise.all(['a','b','c'].map(term=>relay.get('/catalog/itunes/search','term='+term)));assert.deepEqual(times,[10000,13100,16200]);assert.ok(saved.every(x=>Object.keys(x).sort().join()==='cooldown,last'));
});
test('429 stops later dispatch and shares persisted cooldown',async()=>{
 let calls=0,saved;const relay=new CatalogRelay({spacing:0,checkpoint:async x=>saved=x,fetcher:async()=>{calls++;return new Response(null,{status:429,headers:{'retry-after':'9'}});}});
 await assert.rejects(relay.get('/catalog/itunes/search','term=x'),e=>e.status===429&&e.retryAfter==='9');await assert.rejects(relay.get('/catalog/itunes/search','term=y'),e=>e.status===429);assert.equal(calls,1);assert.ok(saved.cooldown>Date.now());
});
test('upstream receives fixed anonymous headers and cannot redirect',async()=>{
 let options;const relay=new CatalogRelay({spacing:0,fetcher:async(_,o)=>{options=o;return new Response(null,{status:302,headers:{location:'http://localhost/'}});}});
 await assert.rejects(relay.get('/catalog/itunes/search','term=x'),e=>e.status===502);assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.deepEqual(Object.keys(options.headers).sort(),['Accept','User-Agent']);
});
test('JSON MIME, malformed body, oversized stream and image signature are checked',async()=>{
 for(const response of [new Response('[]',{headers:{'content-type':'application/json'}}),new Response('{',{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'text/html'}}),new Response(' '.repeat(1048577),{headers:{'content-type':'application/json'}})])await assert.rejects(new CatalogRelay({spacing:0,fetcher:async()=>response}).get('/catalog/itunes/search','term=x'),e=>e.status===502);
 await assert.rejects(new CatalogRelay({fetcher:async()=>new Response('audio',{headers:{'content-type':'image/png'}})}).get('/catalog/artwork','u='+encodeURIComponent('https://is1-ssl.mzstatic.com/a.png')),e=>e.status===502);
});
test('timeout responds while original ignored-abort transport retains its slot',async()=>{
 const relay=new CatalogRelay({timeout:15,spacing:0,fetcher:()=>new Promise(()=>{})});
 await Promise.all(Array.from({length:8},(_,i)=>assert.rejects(relay.get('/catalog/itunes/search','term=x'+i),e=>e.status===504)));
 assert.equal(relay.inflight.size,8);await assert.rejects(relay.get('/catalog/itunes/search','term=ninth'),e=>e.status===503);
});
test('late response is cancelled without waiting for cancellation settlement',async()=>{
 let finish,cancelled=false;const transport=new Promise(r=>finish=r);const relay=new CatalogRelay({timeout:15,spacing:0,fetcher:()=>transport});
 await assert.rejects(relay.get('/catalog/itunes/search','term=x'),e=>e.status===504);
 finish(new Response(new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}}));await new Promise(r=>setTimeout(r,5));assert.equal(cancelled,true);assert.equal(relay.inflight.size,0);
});
test('one catalog visitor cannot fill both relays and keeps its slots until transport settles',async()=>{
 const clientSlots=new Map(),releases=[];
 const options={clientSlots,spacing:0,timeout:2000,fetcher:()=>new Promise(resolve=>releases.push(resolve))};
 const first=new CatalogRelay(options),second=new CatalogRelay(options);
 const a=first.get('/catalog/itunes/search','term=a','192.0.2.1');
 const b=second.get('/catalog/itunes/search','term=b','192.0.2.1');
 const shared=first.get('/catalog/itunes/search','term=a','192.0.2.1');
 try{
  await assert.rejects(first.get('/catalog/itunes/search','term=c','192.0.2.1'),e=>e.status===429&&e.retryAfter==='5');
  const independent=first.get('/catalog/itunes/search','term=c','192.0.2.2');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(releases.length,3);
  for(const resolve of releases.splice(0))resolve(empty());
  assert.deepEqual(await a,await shared);
  await Promise.all([b,independent]);
  const again=second.get('/catalog/itunes/search','term=d','192.0.2.1');
  await new Promise(resolve=>setImmediate(resolve));releases.shift()(empty());
  await again;assert.equal(clientSlots.size,0);
 }finally{for(const resolve of releases)resolve(empty());await Promise.allSettled([a,b,shared]);}
});
