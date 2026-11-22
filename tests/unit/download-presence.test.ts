import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openAssetReader} from '../../src/storage/asset-reader';
import type {LocalAsset} from '../../src/library/library';

test('checking the presence of multiple IDB copies reads counts without materializing audio',async()=>{
 const asset:LocalAsset={id:crypto.randomUUID(),storageKey:crypto.randomUUID(),namespace:'local',state:'complete',revision:1,
  backend:'idb',mime:'audio/mpeg',bytes:8*1024**2,chunkSize:65536,chunks:128,sha256:'a'.repeat(64),retention:'kept'};
 const counts=new Map([[asset.storageKey,128]]),queries:unknown[]=[];
 let reads=0;
 const database={
  transaction(){
   const tx={addEventListener(){},oncomplete:()=>{},objectStore(){
    return {
     count(range:{low:[string,number];high:[string,number]}){
      queries.push(range);
      const request={onsuccess:()=>{},result:counts.get(range.low[0])??0};
      queueMicrotask(()=>{request.onsuccess();tx.oncomplete();});
      return request;
     },
     get(){reads++;throw Error('Unexpected byte read');},
    };
   }};
   return tx;
  },
 } as unknown as IDBDatabase;
 const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator')!;
 const originalRange=Object.getOwnPropertyDescriptor(globalThis,'IDBKeyRange');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_name:unknown,_mode:unknown,work:()=>Promise<void>)=>work()}}});
 Object.defineProperty(globalThis,'IDBKeyRange',{configurable:true,value:{bound:(low:unknown,high:unknown)=>({low,high})}});
 try{
  const missing={...asset,storageKey:crypto.randomUUID()};
  for(const [copy,wanted] of [[asset,'valid'],[missing,'missing']] as const){
   const reader=await openAssetReader(copy,false,{signal:new AbortController().signal,database});
   try{assert.equal((await reader.verifyDetailed('presence')).state,wanted);}finally{reader.release();}
  }
  assert.deepEqual(queries,[asset,missing].map(copy=>({low:[copy.storageKey,0],high:[copy.storageKey,127]})));
  assert.equal(reads,0);
 }finally{
  Object.defineProperty(globalThis,'navigator',originalNavigator);
  if(originalRange)Object.defineProperty(globalThis,'IDBKeyRange',originalRange);else Reflect.deleteProperty(globalThis,'IDBKeyRange');
 }
});
