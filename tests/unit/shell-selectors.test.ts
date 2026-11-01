import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recentTracks,homePlaylists,trackAvailability,matchesShellTrack,emptyShellView,availabilityText} from '../../src/library/shell-selectors';
import type {Track,Playlist} from '../../src/library/library';
const track=(id:string,createdAt='2026-01-01',patch:Partial<Track>={}):Track=>({id,assetId:id,title:id,artist:null,album:null,duration:1,favorite:false,revision:1,createdAt,manualOverrides:{},...patch});
test('recents use creation time, deterministic ID ties, invalid dates last; edits do not promote',()=>{
 const values=[track('z','invalid'),track('b'),track('a'),track('new','2026-10-01')];
 assert.deepEqual(recentTracks(values).map(t=>t.id),['new','a','b','z']);
 assert.deepEqual(recentTracks(values.map(t=>({...t,title:'edited',revision:22}))).map(t=>t.id),['new','a','b','z']);
 assert.equal(recentTracks(Array.from({length:9},(_,i)=>track(String(i)))).length,6);
});
test('playlists use name and ID only, cap six, no fictitious date',()=>{
 const list=(id:string,name:string):Playlist=>({id,name,revision:1,entries:[]});
 assert.deepEqual(homePlaylists([list('b','A'),list('a','A'),list('z','Z')]).map(l=>l.id),['a','b','z']);
});
test('honest metadata-only, unknown, missing, invalid and available; present means available only',()=>{
 const cache=new Map([['a',{generation:'g',state:'available' as const}],['m',{generation:'g',state:'missing' as const}],['i',{generation:'g',state:'invalid' as const}]]);
 for(const [t,state]of [[track('a'),'available'],[track('m'),'missing'],[track('i'),'invalid'],[track('u'),'unknown'],[track('a','',{assetId:null}),'metadata-only']]as const){
  assert.equal(trackAvailability(t,cache),state);assert.equal(matchesShellTrack(t,{...emptyShellView(),present:true},cache),state==='available');
  assert.doesNotMatch(availabilityText(state),/offline|sin conexión/);
 }
});
test('all metadata fields searched, combinable favorite/present, no title identity dedup',()=>{
 const t=track('a','',{favorite:true,artist:'Órbita',album:'Luz'}),cache=new Map([['a',{generation:'g',state:'available' as const}]]);
 for(const query of ['a','orbita','luz'])assert.equal(matchesShellTrack(t,{...emptyShellView(),query,favorites:true,present:true},cache),true);
 assert.equal(matchesShellTrack({...t,favorite:false},{...emptyShellView(),favorites:true,present:true},cache),false);
 assert.equal(matchesShellTrack({...t,assetId:null},emptyShellView(),cache),true);
});
