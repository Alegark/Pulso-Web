import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PlayerArtworkCache} from '../../src/library/player-artwork-cache';

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
