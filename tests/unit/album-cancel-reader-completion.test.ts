import test from 'node:test';
import assert from 'node:assert/strict';
import {AlbumCatalog} from '../../src/library/album-catalog';

test('reader cancellation returns promptly but retains producer until cancellation settles',async()=>{
 let finishCancel!:()=>void,entered!:()=>void,calls=0;
 const cancellation=new Promise<void>(resolve=>{finishCancel=resolve;});
 const reading=new Promise<void>(resolve=>{entered=resolve;});
 const stream=new ReadableStream<Uint8Array>({pull(){entered();return new Promise<void>(()=>{});},cancel(){return cancellation;}});
 const first=new AlbumCatalog(async()=>{calls++;return new Response(stream);});
 const abort=new AbortController();const result=first.load(991,{signal:abort.signal,current:()=>true});await reading;abort.abort();
 assert.deepEqual(await Promise.race([result,new Promise(resolve=>setTimeout(()=>resolve('late'),1000))]),{ok:false,reason:'cancelled'});
 const nextAbort=new AbortController();const next=new AlbumCatalog(async()=>{calls++;return new Response('{}');}).load(992,{signal:nextAbort.signal,current:()=>true});
 await new Promise(resolve=>setTimeout(resolve,100));assert.equal(calls,1);nextAbort.abort();assert.deepEqual(await next,{ok:false,reason:'cancelled'});finishCancel();
});
