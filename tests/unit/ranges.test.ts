import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveRange} from '../../src/service-worker/ranges.ts';
test('rangos cerrado, abierto, sufijo y recorte', () => {
 assert.deepEqual(resolveRange('bytes=0-1',10),{start:0,end:2,partial:true});
 assert.deepEqual(resolveRange('bytes=3-',10),{start:3,end:10,partial:true});
 assert.deepEqual(resolveRange('bytes=-3',10),{start:7,end:10,partial:true});
 assert.deepEqual(resolveRange('bytes=8-99',10),{start:8,end:10,partial:true});
});
test('416 lógico ante rango inválido y multipart explícito 200', () => {
 for(const header of ['bytes=10-','bytes=3-1','bytes=-0','bytes=-','bytes=9007199254740999-','oops']) assert.equal(resolveRange(header,10),null);
 assert.deepEqual(resolveRange('bytes=0-1,4-5',10),{start:0,end:10,partial:false});
 assert.deepEqual(resolveRange(null,10),{start:0,end:10,partial:false});
});
