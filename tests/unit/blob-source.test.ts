import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateBlobBudget,MAX_BLOB_ASSET} from '../../src/playback/blob-source.ts';
import type {LocalAsset} from '../../src/library/library.ts';
function asset(bytes:number):LocalAsset{return {id:'00000000-0000-0000-0000-000000000001',namespace:'local',storageKey:'00000000-0000-0000-0000-000000000002',bytes,sha256:'a'.repeat(64),mime:'audio/mpeg',chunks:Math.ceil(bytes/65536),state:'complete',revision:1,backend:'idb',chunkSize:65536,retention:'kept'};}
test('modo Blob limita por archivo y cola antes de leer o asignar bytes',()=>{
 assert.doesNotThrow(()=>validateBlobBudget([asset(200000),asset(300000)]));
 assert.throws(()=>validateBlobBudget([asset(MAX_BLOB_ASSET+1)]));
 assert.throws(()=>validateBlobBudget(Array.from({length:4},()=>asset(MAX_BLOB_ASSET))));
 assert.throws(()=>validateBlobBudget([{...asset(100),mime:'text/html'}]));
});
