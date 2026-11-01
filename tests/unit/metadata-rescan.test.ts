import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyMetadataRescanReference,copyMetadataRescanReply,copyMetadataRescanRequest} from '../../src/library/metadata-rescan-protocol';
import {unknownLocalAlbum} from '../../src/library/album-metadata';
const id='00000000-0000-4000-8000-000000000001',token='00000000-0000-4000-8000-000000000002';
const reference={version:1,operationId:id,incarnation:token};
const asset={id,namespace:'local',storageKey:token,bytes:65537,sha256:'a'.repeat(64),mime:'audio/mpeg',chunks:2,state:'complete',revision:1,chunkSize:65536,retention:'kept',backend:'idb'};
test('reference closed data: rejects getters/symbols/prototypes/extra/forged UUID; copied frozen ref',()=>{
 assert.deepEqual(copyMetadataRescanReference(reference),reference);assert(Object.isFrozen(copyMetadataRescanReference(reference)));
 let reads=0;const accessor={...reference,get operationId(){reads++;return id;}};
 for(const bad of [null,{...reference,x:0},{...reference,version:2},{...reference,operationId:'a'.repeat(36)},Object.assign(Object.create({}),reference),{...reference,[Symbol()]:0},accessor])assert.equal(copyMetadataRescanReference(bad),null);
 assert.equal(reads,0);
});
test('worker protocol: exact bounded manifest, progress and source-only candidate, no raw payload accepted',()=>{
 const header={version:1,requestId:id,token};
 assert(copyMetadataRescanRequest({...header,type:'inspect',asset}));
 assert.equal(copyMetadataRescanRequest({...header,type:'inspect',asset:{...asset,bytes:8388609,chunks:129}}),null);
 assert.equal(copyMetadataRescanRequest({...header,type:'inspect',asset:{...asset,extra:1}}),null);
 assert(copyMetadataRescanReply({...header,type:'progress',bytes:1,total:8388608}));
 for(const p of [{bytes:0,total:1},{bytes:2,total:1},{bytes:1,total:8388609},{bytes:NaN,total:1}])assert.equal(copyMetadataRescanReply({...header,type:'progress',...p}),null);
 const m=unknownLocalAlbum('absent');const reply=copyMetadataRescanReply({...header,type:'candidate',asset,localAlbum:m});assert(reply?.type==='candidate');m.source.track.reason='invalid';assert.equal(reply.localAlbum.source.track.state==='unknown'&&reply.localAlbum.source.track.reason,'absent');
 for(const bad of [{...header,type:'candidate',asset,localAlbum:{...m,manual:{}}},{...header,type:'candidate',asset,localAlbum:m,raw:new Uint8Array(1)},{...header,type:'failure',failure:{version:1,phase:'parse',code:'cancelled',family:'quota',backend:'none'}}])assert.equal(copyMetadataRescanReply(bad),null);
});
