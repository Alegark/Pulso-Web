import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogTransport} from '../../src/library/catalog-fetch';
const query='https://itunes.apple.com/search?term=Night&entity=album&country=US';
const enabled=()=>Response.json({version:1,itunes:true,artwork:true});

test('capability probe is lazy and shared; public metadata and covers use own origin',async()=>{
 const calls:{url:string;options:RequestInit|undefined}[]=[];
 const fake:typeof fetch=async(input,options)=>{const url=String(input);calls.push({url,options});return url.endsWith('/catalog-config.json')?enabled():Response.json({results:[]});};
 const client=createCatalogTransport({origin:'https://pulso.example',fetcher:fake});assert.equal(calls.length,0);
 await Promise.all([client.fetch(query),client.fetch(query),client.fetch('https://is1-ssl.mzstatic.com/image/own.jpg')]);
 assert.equal(calls.filter(c=>c.url.endsWith('/catalog-config.json')).length,1);assert.equal(client.mode(),'relay');
 assert.ok(calls.slice(1).every(c=>c.url.startsWith('https://pulso.example/catalog/')));
 assert.ok(calls.slice(1).every(c=>c.options?.credentials==='same-origin'&&c.options.redirect==='error'));
});
test('disabled or missing relay retains direct transport',async()=>{
 for(const config of [()=>Response.json({version:1,itunes:false,artwork:false}),()=>new Response('',{status:404})]){
  const urls:string[]=[];const fake:typeof fetch=async input=>{urls.push(String(input));return String(input).endsWith('/catalog-config.json')?config():Response.json({});};
  const client=createCatalogTransport({origin:'https://pulso.example',fetcher:fake});await client.fetch(query);assert.equal(urls[1],query);assert.equal(client.mode(),'direct');
 }
});
test('relay failure is returned without another provider request',async()=>{
 const urls:string[]=[];const fake:typeof fetch=async input=>{urls.push(String(input));return String(input).endsWith('/catalog-config.json')?enabled():new Response('',{status:503,headers:{'Retry-After':'5'}});};
 const client=createCatalogTransport({origin:'https://pulso.example',fetcher:fake});assert.equal((await client.fetch(query)).status,503);assert.equal(urls.length,2);assert.ok(!urls.includes(query));
});
test('aborting while probing never dispatches the cancelled resource',async()=>{
 let finish!:(r:Response)=>void;let resources=0;
 const fake:typeof fetch=async input=>String(input).endsWith('/catalog-config.json')?new Promise<Response>(resolve=>{finish=resolve;}):(resources++,Response.json({}));
 const client=createCatalogTransport({origin:'https://pulso.example',fetcher:fake});const controller=new AbortController();const work=client.fetch(query,{signal:controller.signal});controller.abort();
 await assert.rejects(work,{name:'AbortError'});finish(enabled());await client.fetch(query);assert.equal(resources,1);
});
test('a noncooperative probe is bounded and a late capability cannot change the selected mode',async()=>{
 let finish!:(r:Response)=>void;let resources=0;
 const fake:typeof fetch=async input=>String(input).endsWith('/catalog-config.json')?new Promise<Response>(resolve=>{finish=resolve;}):(resources++,Response.json({}));
 const client=createCatalogTransport({origin:'https://pulso.example',fetcher:fake,capabilityTimeoutMs:5});await client.fetch(query);assert.equal(client.mode(),'direct');finish(enabled());await Promise.resolve();await client.fetch(query);assert.equal(client.mode(),'direct');assert.equal(resources,2);
});
test('oversized capabilities cannot enable relay; server-side imports do not probe',async()=>{
 const urls:string[]=[];const fake:typeof fetch=async input=>{urls.push(String(input));return String(input).endsWith('/catalog-config.json')?new Response(' '.repeat(1025)):Response.json({});};
 await createCatalogTransport({origin:'https://pulso.example',fetcher:fake}).fetch(query);assert.equal(urls[1],query);
 urls.length=0;await createCatalogTransport({origin:null,fetcher:fake}).fetch(query);assert.deepEqual(urls,[query]);
});
