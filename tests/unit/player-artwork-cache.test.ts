import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PlayerArtworkCache,albumArtworkKey} from '../../src/library/player-artwork-cache';

const cover=(bytes:number)=>({album:'Álbum de prueba',blob:new Blob([new Uint8Array(bytes)])});

test('la caché comparte un Blob y avisa también al retirar una entrada',()=>{
 const cache=new PlayerArtworkCache(),first=cover(1);
 const observed:(Blob|undefined)[]=[];
 const unsubscribe=cache.subscribe(()=>observed.push(cache.get('primera')?.blob));
 cache.set('primera',first);
 for(let i=0;i<64;i++)cache.set(String(i),cover(1));
 assert.equal(observed.at(0),first.blob);
 assert.equal(observed.at(-1),undefined);
 assert.equal(cache.get('primera'),undefined);
 assert.ok(cache.get('0'));
 assert.ok(cache.get('63'));
 unsubscribe();
 cache.set('fin',cover(1));
 assert.equal(observed.length,65);
});

test('el presupuesto de bytes se aplica también al reemplazar una carátula',()=>{
 const cache=new PlayerArtworkCache(),mib=1024*1024;
 for(let i=0;i<4;i++)cache.set(String(i),cover(2*mib));
 cache.set('3',cover(mib));
 cache.set('4',cover(mib));
 assert.ok(cache.get('0'));
 cache.set('5',cover(2*mib));
 assert.equal(cache.get('0'),undefined);
 assert.ok(cache.get('1'));
 assert.ok(cache.get('5'));
 cache.set('demasiado grande',cover(9*mib));
 assert.equal(cache.get('demasiado grande'),undefined);
 assert.ok(cache.get('1'));
});

test('V64-05 · album tracks share the same memory hit',async()=>{
 const cache=new PlayerArtworkCache(),key=albumArtworkKey({artist:'Artist',album:'Album'})!;
 const first=cover(1);cache.set(key,first);
 assert.equal((await cache.readProvider(albumArtworkKey({artist:' artist ',album:'album'})!))?.blob,first.blob);
});
test('V64-07 · preload batches missing keys and hydrates memory',async()=>{
 const cache=new PlayerArtworkCache(),now=Date.now(),calls:string[][]=[];
 const storage={getMany:async(keys:readonly string[])=>{calls.push([...keys]);return new Map(keys.map(key=>[key,{...cover(2),fetchedAt:now,lastAccessedAt:now}]));}};
 (cache as unknown as {storage:unknown}).storage=storage;
 cache.set('existing',cover(1));
 await cache.preload(['provider:one','provider:two','provider:one','provider:existing']);
 assert.deepEqual(calls,[['provider:one','provider:two']]);
 assert.ok(cache.get('one'));assert.ok(cache.get('two'));
});
