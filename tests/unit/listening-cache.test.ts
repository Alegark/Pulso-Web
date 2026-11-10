import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeListeningCache} from '../../src/library/listening-cache';
import type {LocalAsset,Playlist,Track} from '../../src/library/library';
const asset=(id:string,sha256:string):LocalAsset=>({id,namespace:'local',storageKey:id,bytes:100,sha256,mime:'audio/wav',chunks:1,state:'complete',revision:1,chunkSize:65536,retention:'kept',backend:'idb'});
const track=(id:string,assetId:string|null):Track=>({id,assetId,title:id,artist:null,album:null,duration:1,favorite:false,revision:1,createdAt:'2026-01-01T00:00:00Z',manualOverrides:{}});
const list=(id:string):Playlist=>({id:'list',name:'list',revision:1,entries:[{id:'entry',trackId:id}]});
test('cache counts physical copies once and protects every organizational reference',()=>{
 const a=asset('a','x'),b=asset('b','y'),t=track('one','a'),alias=track('alias','a'),other=track('other','b');
 const input={tracks:[t,alias,other],assets:[a,b],libraryTrackIds:new Set<string>(),playlists:[] as Playlist[]};
 assert.deepEqual(summarizeListeningCache(input),{copies:2,bytes:200});
 assert.deepEqual(summarizeListeningCache({...input,libraryTrackIds:new Set(['alias'])}),{copies:1,bytes:100});
 assert.deepEqual(summarizeListeningCache({...input,playlists:[list('alias')]}),{copies:1,bytes:100});
 assert.deepEqual(summarizeListeningCache({...input,tracks:[t,{...alias,favorite:true},other]}),{copies:1,bytes:100});
 const detached={...alias,assetId:null,audioFingerprint:{algorithm:'sha256' as const,sha256:'x',bytes:100}};
 assert.deepEqual(summarizeListeningCache({...input,tracks:[t,detached,other],libraryTrackIds:new Set(['alias'])}),{copies:1,bytes:100});
 assert.deepEqual(summarizeListeningCache({...input,tracks:[t,detached,other],playlists:[list('alias')]}),{copies:1,bytes:100});
 assert.deepEqual(summarizeListeningCache({...input,tracks:[other]}),{copies:1,bytes:100});
});
