import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMusicSuggestionsClient} from '../../src/library/music-suggestions';
import {registerSearchCacheCleaner,clearSearchCaches} from '../../src/library/search-caches';

test('clearing registered search caches preserves the rate limit and the client remains usable',async()=>{
 let now=1000,calls=0;
 const client=createMusicSuggestionsClient({now:()=>now,fetch:async()=>{calls++;return new Response(JSON.stringify([{id:1,trackName:'Song',artistName:'Artist',albumName:'Album',duration:10}]),{headers:{'Content-Type':'application/json'}});}});
 const unregister=registerSearchCacheCleaner(()=>client.clearCache());
 try{
  const search=()=>client.search('Song',{current:()=>true});
  assert.equal((await search()).state,'ready');
  const cached=await search();assert.equal(cached.state,'ready');if(cached.state==='ready')assert.equal(cached.cached,true);
  clearSearchCaches();assert.equal((await search()).state,'rate-limited');assert.equal(calls,1);
  now+=1001;const fresh=await search();assert.equal(fresh.state,'ready');if(fresh.state==='ready')assert.equal(fresh.cached,false);assert.equal(calls,2);
 }finally{unregister();client.close();}
});
