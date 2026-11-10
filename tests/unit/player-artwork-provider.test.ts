import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {artworkUrl,selectPlayerArtwork,PlayerArtworkProvider} from '../../src/library/player-artwork-provider';
const q={title:'Song (Live)',artist:'Artist & Guest',album:null,durationSeconds:100};
const row={wrapperType:'track',kind:'song',trackName:'Song (Live)',artistName:'Artist & Guest',collectionName:'Album',collectionId:7,trackTimeMillis:100000,artworkUrl100:'https://is1-ssl.mzstatic.com/image.jpg'};
const data=(results:unknown[])=>({resultCount:results.length,results});
test('exact full title, artist, duration and optional album',()=>{
 assert.deepEqual(selectPlayerArtwork(data([row]),q),{album:'Album',url:row.artworkUrl100});
 assert.ok(selectPlayerArtwork(data([{...row,trackName:' song (live) ',artistName:'artist & guest',trackTimeMillis:105000}]),q));
 for(const patch of [{trackName:'Song'},{artistName:'Artist'},{trackTimeMillis:105001},{collectionName:'Other'}])assert.equal(selectPlayerArtwork(data([{...row,...patch}]),{...q,album:'Album'}),null);
});
test('ambiguity and truncated result sets fail closed',()=>{
 assert.ok(selectPlayerArtwork(data([row,{...row}]),q));
 for(const patch of [{collectionId:8},{collectionName:'Other'},{artworkUrl100:'https://is1-ssl.mzstatic.com/other.jpg'},{artworkUrl100:'https://evil.example/a'}])assert.equal(selectPlayerArtwork(data([row,{...row,...patch}]),q),null);
 assert.equal(selectPlayerArtwork(data(Array(50).fill(row)),q),null);
});
test('URL allowlist and limits',()=>{
 for(const url of ['http://is1-ssl.mzstatic.com/a','https://is1-ssl.mzstatic.com.evil/a','https://user@is1-ssl.mzstatic.com/a','https://is1-ssl.mzstatic.com:444/a','https://is1-ssl.mzstatic.com/a#frag','https://is1-ssl.mzstatic.com/'+ 'a'.repeat(2048)])assert.equal(artworkUrl(url),null);
});
test('cancel before request and reject non-image or oversized metadata',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 const p=new PlayerArtworkProvider(async()=>{calls++;return new Response('x',{headers:{'content-length':'1048577'}})});
 assert.equal(await p.load(q,{signal:controller.signal,current:()=>true}),null);assert.equal(calls,0);
 const live=new AbortController();assert.equal(await p.load(q,{signal:live.signal,current:()=>false}),null);assert.equal(calls,0);
 assert.equal(await p.load(q,{signal:live.signal,current:()=>true}),null);assert.equal(calls,1);
});
test('in-flight cancellation prevents image request and stale result',async()=>{
 let resolveFetch!:(r:Response)=>void,started! :()=>void;const entered=new Promise<void>(r=>{started=r});let calls=0;
 const provider=new PlayerArtworkProvider(async()=>{calls++;started();return new Promise<Response>(r=>{resolveFetch=r});});
 const controller=new AbortController();let current=true;
 const pending=provider.load(q,{signal:controller.signal,current:()=>current});
 await entered;current=false;controller.abort();assert.equal(await pending,null);
 resolveFetch(Response.json(data([row])));await new Promise(r=>setTimeout(r,10));assert.equal(calls,1);
});
test('validated CDN thumbnail becomes a 600 pixel image without changing origin or album path',async()=>{
 const {artworkImageUrl}=await import('../../src/library/player-artwork-provider');
 for(const size of ['100x100bb','60x60bb','300x300','1200x1200cc'])assert.equal(artworkImageUrl(`https://is2-ssl.mzstatic.com/image/thumb/Music/own/${size}.jpg`),'https://is2-ssl.mzstatic.com/image/thumb/Music/own/600x600bb.jpg');
 assert.equal(artworkImageUrl('https://evil.example/100x100bb.jpg'),null);
 assert.equal(artworkImageUrl('https://is1-ssl.mzstatic.com/own.png'),'https://is1-ssl.mzstatic.com/own.png');
});
test('exact identity rejects a different recording or edition while keeping full credits and duration',()=>{
 const identity={...q,editionId:7,trackId:9};
 const exact={...row,trackId:9};
 assert.ok(selectPlayerArtwork(data([{wrapperType:'collection'},exact]),identity,201));
 for(const patch of [{trackId:10},{collectionId:8},{artistName:'Artist'},{trackName:'Song'},{trackTimeMillis:120000}])assert.equal(selectPlayerArtwork(data([{...exact,...patch}]),identity,201),null);
 for(const patch of [{editionId:0},{editionId:NaN},{editionId:undefined},{trackId:undefined},{trackId:-1}])assert.equal(selectPlayerArtwork(data([exact]),{...identity,...patch}),null);
});
test('canonical identity uses the edition lookup without a title search',async()=>{
 let url='';const provider=new PlayerArtworkProvider(async input=>{url=String(input);return Response.json(data([]));});
 const controller=new AbortController();assert.equal(await provider.load({...q,editionId:7,trackId:9},{signal:controller.signal,current:()=>true}),null);
 const address=new URL(url);assert.equal(address.pathname,'/lookup');assert.equal(address.searchParams.get('id'),'7');assert.equal(address.searchParams.get('entity'),'song');assert.equal(address.searchParams.has('term'),false);
});
