import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireAlbum,albumTrackChoice,type AlbumRow,type AlbumProgress} from '../../src/library/album-acquisition';
import type {AlbumDetail} from '../../src/library/album-catalog';
import type {SongPlaybackAttempt,SongManagement} from '../../src/library/selected-song';

const detail:AlbumDetail={edition:{id:1,title:'Album',artist:'Artist',trackCount:2,releaseDate:null},tracks:[1,2].map(i=>({releaseId:1,trackId:i,disc:1,position:i,title:`Track ${i}`,artist:'Artist',durationMs:60000}))};
const initial=():AlbumRow[]=>detail.tracks.map(()=>({state:'unattempted',trackId:null,confirmed:false,message:''}));
let addCurrent:SongManagement['add']=async()=>true;
const attempt=(lookup:SongPlaybackAttempt['lookup']):SongPlaybackAttempt=>({current:()=>true,lookup,save:async()=>({state:'failed',trackId:null}),addToLibrary:async(_id,current)=>addCurrent(current),play:async()=>{throw Error('unexpected play');}});
const manager=(add:SongManagement['add']):SongManagement=>({current:()=>true,playReady:false,add,addToPlaylist:async()=>false,play:async()=>'failed'});
test('cached album verifies each occurrence and passes original live guard through add, without play',async()=>{
 let result:AlbumProgress|undefined;const calls:string[]=[];addCurrent=async current=>{assert.equal(current?.(),true);return true;};
 await acquireAlbum({detail,attempt:attempt(async c=>{calls.push(c.id);return 'track';}),client:null,provider:null,revision:0,management:()=>manager(async current=>{assert.equal(current?.(),true);return true;}),signal:new AbortController().signal,current:()=>true,rows:initial(),update:v=>{result=v;}});
 assert.equal(calls.length,2);assert.equal(result?.rows.filter(r=>r.confirmed).length,2);assert.equal(result?.message,'Álbum listo en Biblioteca.');
});
test('cancelled add observes original guard and cannot report completion',async()=>{
 const controller=new AbortController();let result:AlbumProgress|undefined;addCurrent=async current=>{controller.abort();return !!current?.();};
 await acquireAlbum({detail,attempt:attempt(async()=> 'track'),client:null,provider:null,revision:0,management:()=>manager(async current=>{controller.abort();return !!current?.();}),signal:controller.signal,current:()=>true,rows:initial(),update:v=>{result=v;}});
 assert.equal(result?.rows.filter(r=>r.confirmed).length,0);assert.match(result!.message,/detenida/);
});
test('uncertain row is checked locally before continuing and is never dispatched again',async()=>{
 addCurrent=async()=>true;const rows=initial();rows[0].state='uncertain';let looked=0;let result:AlbumProgress|undefined;
 await acquireAlbum({detail,attempt:attempt(async()=>{looked++;return looked===2?'verified':null;}),client:null,provider:null,revision:0,management:()=>manager(async()=>true),signal:new AbortController().signal,current:()=>true,rows,update:v=>{result=v;}});
 assert.equal(looked,2);assert.equal(result?.rows[0].state,'uncertain');assert.equal(result?.rows[1].confirmed,true);assert.match(result!.message,/incompleto/);
});
test('album choice retains full credit for local verification and primary artist for query',()=>{
 const choice=albumTrackChoice({...detail.tracks[0],artist:'Artist, Guest',primaryArtist:'Artist'},'Album');assert.equal(choice.artist,'Artist, Guest');assert.equal(choice.searchArtist,'Artist');
});
