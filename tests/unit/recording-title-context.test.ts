import test from 'node:test';import assert from 'node:assert/strict';
import {expectedAudioTagMismatch} from '../../src/imports/expected-audio-metadata';
import {copyWorkerRequest} from '../../src/imports/import-protocol';
import {recordingTitleCandidate,recordingTitlesEquivalent} from '../../src/library/recording-title';
import {compatibleSongMetadata} from '../../src/library/song-copy-status';
import type {Track} from '../../src/library/library';
const expected={sha256:'a'.repeat(64),title:'Synthetic song',artist:'Artist & Guest',recordingTitle:'Synthetic song (Album Version)',album:'Synthetic album',durationSeconds:100};
const tags={title:'Synthetic song (Album Version)',artist:'Artist & Guest',album:'Synthetic album'};
test('album-version alias requires complete matching metadata and actual duration',()=>{
 assert.equal(expectedAudioTagMismatch(tags,expected,100.5),null);
 for(const v of [{...tags,title:undefined},{...tags,artist:undefined},{...tags,artist:'Artist'},{...tags,artist:'Artist Guest'},{...tags,album:undefined},{...tags,album:'Other'},{...tags,album:'Synthetic-album'},{...tags,title:'Synthetic song (Live)'},{...tags,title:'Synthetic song (Remix)'}])assert.notEqual(expectedAudioTagMismatch(v,expected,100),null);
 assert.notEqual(expectedAudioTagMismatch({...tags,title:expected.title,album:undefined},expected,100),null);assert.notEqual(expectedAudioTagMismatch(tags,expected,101.01),null);assert.notEqual(expectedAudioTagMismatch(tags,expected,undefined),null);
 assert.notEqual(expectedAudioTagMismatch(tags,{sha256:expected.sha256,title:expected.title,artist:expected.artist},100),null);assert.notEqual(expectedAudioTagMismatch({}, {title:expected.title,artist:expected.artist,recordingTitle:expected.recordingTitle}),null);
 assert.equal(expectedAudioTagMismatch({...tags,artists:[tags.artist,'Another artist']},expected,100),'artist');
});
test('worker admission requires a closed complete alias context with safe values',()=>{
 const request={version:2,type:'import',operationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',file:new File(['x'],'synthetic.wav'),expected};
 assert.ok(copyWorkerRequest(request));
 for(const change of [{recordingTitle:undefined},{album:undefined},{durationSeconds:undefined},{durationSeconds:0},{durationSeconds:Infinity},{recordingTitle:'Synthetic song (Live)'},{recordingTitle:'Synthetic song (Album Version) (Live)'},{album:' '},{unknown:true}])assert.equal(copyWorkerRequest({...request,expected:{...expected,...change}}),null);
 let calls=0;const bad=Object.defineProperty({...expected},'album',{get(){calls++;return 'Synthetic album';}});assert.equal(copyWorkerRequest({...request,expected:bad}),null);assert.equal(calls,0);
});
test('copy inspection accepts only album-version with same complete album, full artist and duration within one second',()=>{
 const track:Track={id:'00000000-0000-4000-8000-000000000001',assetId:null,audioFingerprint:{algorithm:'sha256',sha256:'b'.repeat(64),bytes:300},title:tags.title,artist:tags.artist,album:tags.album,duration:100.5,favorite:false,revision:1,createdAt:'2026-11-08',manualOverrides:{}};
 const choice={id:'itunes:1:1:1:2',source:'itunes' as const,title:expected.title,artist:expected.artist,album:expected.album,duration:100};
 assert.equal(compatibleSongMetadata(track,choice),true);
 for(const change of [{album:null},{album:'Other'},{album:'Synthetic-album'},{duration:101.01},{artist:'Artist'},{artist:'Artist Guest'},{title:'Synthetic song (Live)'},{title:'Synthetic song (Remix)'}])assert.equal(compatibleSongMetadata({...track,...change},choice),false);
});
test('ordinary titles retain the legacy five-second rule without album context',()=>{
 const track:Track={id:'00000000-0000-4000-8000-000000000001',assetId:null,audioFingerprint:{algorithm:'sha256',sha256:'c'.repeat(64),bytes:300},title:'Synthetic song',artist:'Artist',album:null,duration:104,favorite:false,revision:1,createdAt:'2026-11-08',manualOverrides:{}};
 assert.equal(compatibleSongMetadata(track,{id:'itunes:1:1:1:2',source:'itunes',title:'Synthetic song',artist:'Artist',album:null,duration:100}),true);
});

test('recording title helpers require context exclusively for the exact album-version marker',()=>{
 const alias='Synthetic song (Album Version)',base='Synthetic song',ctx={actualAlbum:'Synthetic album',expectedAlbum:'Synthetic album',actualDurationSeconds:100.5,expectedDurationSeconds:100};
 assert(recordingTitleCandidate(alias,base,'Synthetic album',100));assert(recordingTitleCandidate(base,alias,'Synthetic album',100));assert(!recordingTitleCandidate(alias,base,null,100));assert(!recordingTitleCandidate(alias,base,'Synthetic album',null));
 assert(recordingTitlesEquivalent(alias,base,ctx));assert(!recordingTitlesEquivalent(alias,base,{...ctx,actualAlbum:null}));assert(!recordingTitlesEquivalent(alias,base,{...ctx,actualDurationSeconds:101.01}));
 for(const other of ['Synthetic song (Live)','Synthetic song (Remix)','Synthetic song (Album Version) (Live)','Synthetic song (Album-Version)'])assert(!recordingTitleCandidate(other,base,'Synthetic album',100));
});
