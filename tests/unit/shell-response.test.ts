import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cachedShellResponse} from '../../src/service-worker/shell-response';
test('a cached followed redirect becomes a normal response while preserving document and policy',async()=>{
 const cached=new Response('<main>Own shell</main>',{headers:{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'",ETag:'owned'}});
 Object.defineProperty(cached,'redirected',{value:true});
 const result=cachedShellResponse(cached);assert.notEqual(result,cached);assert.equal(result.redirected,false);assert.equal(result.status,200);assert.equal(result.headers.get('Content-Security-Policy'),"default-src 'self'");assert.equal(result.headers.get('ETag'),'owned');assert.equal(await result.text(),'<main>Own shell</main>');
});
test('a normal cached response keeps its existing body and headers without a clone',()=>{
 const response=new Response('own');assert.equal(cachedShellResponse(response),response);assert.equal(response.bodyUsed,false);
});
