import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPlayerOnlineLyrics} from '../../src/library/player-lyrics-provider';

test('online player lyrics use bounded cache, preserve variants, rate limit and cancel stale work',async()=>{
 const original=globalThis.fetch;let calls=0;const times:number[]=[];
 globalThis.fetch=async input=>{
  calls++;times.push(Date.now());const url=new URL(String(input));
  const name=url.searchParams.get('track_name')!;
  return new Response(JSON.stringify({id:12,trackName:name==='Canción (Remix)'?'Canción':name.toUpperCase(),artistName:'ARTISTA',albumName:'Disco',duration:120,instrumental:false,plainLyrics:'línea ficticia',syncedLyrics:'[00:01.00]línea ficticia'}),{headers:{'Content-Type':'application/json'}});
 };
 try{
  const signal=new AbortController().signal,current=()=>true;
  const query={title:'Canción',artist:'Artista',album:'Disco',durationSeconds:120};
  const first=await readPlayerOnlineLyrics(query,signal,current);
  assert.equal(first.state,'ready');if(first.state==='ready')assert.equal(first.lyrics.kind,'timed');
  assert.equal((await readPlayerOnlineLyrics(query,signal,current)).state,'ready');assert.equal(calls,1);
  const stale=new AbortController();stale.abort();
  assert.equal((await readPlayerOnlineLyrics({...query,title:'Otra'},stale.signal,current)).state,'cancelled');assert.equal(calls,1);
  assert.equal((await readPlayerOnlineLyrics({...query,title:'Canción (Remix)'},signal,current)).state,'not-found');
  assert.equal(calls,2);assert.ok(times[1]-times[0]>=950);
 }finally{globalThis.fetch=original;}
});
