import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AlbumCatalog} from '../../src/library/album-catalog';

test('HTTP failure reports only bounded status and makes no retry',async()=>{
 let calls=0;
 const catalog=new AlbumCatalog(async()=>{calls++;return new Response('untrusted details',{status:500});});
 const result=await catalog.search('Record','Artist',{signal:new AbortController().signal,current:()=>true});
 assert.deepEqual(result,{ok:false,reason:'http',httpStatus:500});
 assert.equal(calls,1);
});
