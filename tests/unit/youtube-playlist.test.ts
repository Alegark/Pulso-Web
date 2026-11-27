import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePlaylistId,youtubeItemsToLines,youtubeItemsToSongs,loadYoutubePlaylist} from '../../src/library/youtube-playlist';
import {youtubePlaylist} from '../../deployment/cloudflare/youtube-playlist.mjs';

const ID='PLymdogRYFRdJDRc2TzZnE5OCw-sRpyXEm';

test('playlist id: full links, watch links with list, bare id; anything else is rejected',()=>{
  assert.equal(parsePlaylistId(`https://www.youtube.com/playlist?list=${ID}`),ID);
  assert.equal(parsePlaylistId(`https://www.youtube.com/watch?v=abc123&list=${ID}&index=2`),ID);
  assert.equal(parsePlaylistId(`https://music.youtube.com/playlist?list=${ID}#x`),ID);
  assert.equal(parsePlaylistId(` ${ID} `),ID);
  for(const bad of ['','hola','https://example.com/','https://www.youtube.com/watch?v=abc','list=corto','x'.repeat(80)])assert.equal(parsePlaylistId(bad),null,bad);
});
test('items to lines: Topic channel is the artist, "Artist - Title" kept, shorts/mixes ignored',()=>{
  const {lines,ignored}=youtubeItemsToLines([
    {title:'Melatonin',channel:'TUZI - Topic'},
    {title:'Lana Del Rey - Say Yes To Heaven (Official Audio)',channel:'Lana Del Rey'},
    {title:'Suzume (feat. Toaka)',channel:'RADWIMPS'},
    {title:'¿Quién programó este juego 💀 #shorts #gracioso',channel:'Burly VODs'},
    {title:'I WANT YOU | Bedroom R&B After Hours | Late Night Lovers Playlist (pt.21)',channel:'ONLYOU'},
    {title:'Solo titulo',channel:''},
  ]);
  assert.deepEqual(lines,['TUZI - Melatonin','Lana Del Rey - Say Yes To Heaven (Official Audio)','RADWIMPS - Suzume (feat. Toaka)','Solo titulo']);
  assert.equal(ignored,2);
});
test('items to songs: Topic channel is the artist, "Artist - Title" is split, noise and non-songs removed',()=>{
  const {songs,ignored}=youtubeItemsToSongs([
    {title:'Melatonin',channel:'TUZI - Topic'},
    {title:'Lana Del Rey - Say Yes To Heaven (Official Audio)',channel:'Lana Del Rey'},
    {title:'Night Tapes - Swordsman [Lyric Video]',channel:'Fan Uploads'},
    {title:'Suzume (feat. Toaka)',channel:'RADWIMPS'},
    {title:'Golden Brown',channel:'Release - Topic'},
    {title:'Golden Cats - Ivory (Shadow)',channel:'Golden Cats - Topic'},
    {title:'clip #shorts',channel:'X'},
    {title:'Solo titulo',channel:''},
  ]);
  assert.deepEqual(songs,[
    {title:'Melatonin',artist:'TUZI'},
    {title:'Say Yes To Heaven',artist:'Lana Del Rey'},
    {title:'Swordsman',artist:'Night Tapes'},
    {title:'Suzume (feat. Toaka)',artist:'RADWIMPS'},
    {title:'Golden Brown',artist:'Release'},
    {title:'Ivory (Shadow)',artist:'Golden Cats'},
  ]);
  assert.equal(ignored,2);
});
const reply=(status:number,body:unknown)=>async()=>new Response(JSON.stringify(body),{status});
const signal=()=>new AbortController().signal;
test('client: maps API failures to specific reasons and validates the payload',async()=>{
  const ok={name:'HIGH & TRIP',total:2,truncated:false,items:[{title:'a',channel:'b'}]};
  assert.deepEqual((await loadYoutubePlaylist(ID,{signal:signal(),fetcher:reply(200,ok) as typeof fetch}) as {value:{name:string}}).value.name,'HIGH & TRIP');
  const reason=async(status:number,body:unknown)=>(await loadYoutubePlaylist(ID,{signal:signal(),fetcher:reply(status,body) as typeof fetch}) as {reason:string}).reason;
  assert.equal(await reason(503,{error:'not-configured'}),'not-configured');
  assert.equal(await reason(404,{error:'not-found'}),'not-found');
  assert.equal(await reason(403,{error:'private'}),'private');
  assert.equal(await reason(429,{error:'quota'}),'quota');
  assert.equal(await reason(200,{name:'x',total:1,truncated:false,items:[{title:1,channel:''}]}),'invalid');
  assert.equal(await reason(200,{...ok,items:Array.from({length:1501},()=>({title:'a',channel:''}))}),'invalid');
  assert.equal((await loadYoutubePlaylist('nope',{signal:signal(),fetcher:reply(200,ok) as typeof fetch}) as {reason:string}).reason,'bad-link');
});

// --- Cloudflare Worker route, with Google mocked ---
const call=async(url:string,{headers={'Sec-Fetch-Site':'same-origin'} as Record<string,string>,method='GET',env={YOUTUBE_API_KEY:'k'} as Record<string,string>|undefined,fetcher=(async()=>new Response('{}')) as typeof fetch}={})=>{
  const response=await youtubePlaylist(new Request('https://pulso.test'+url,{method,headers}),env,fetcher);
  return {status:response.status,body:await response.json()};
};
test('route: not configured, bad id, extra query, cross-site, missing header and wrong method are refused before any request',async()=>{
  let calls=0;const fetcher=(async()=>{calls++;return new Response('{}');}) as typeof fetch;
  assert.equal((await call(`/api/youtube-playlist?list=${ID}`,{env:{},fetcher})).status,503);
  assert.equal((await call('/api/youtube-playlist?list=x',{fetcher})).status,400);
  assert.equal((await call(`/api/youtube-playlist?list=${ID}&x=1`,{fetcher})).status,400);
  assert.equal((await call(`/api/youtube-playlist?list=${ID}`,{headers:{'Sec-Fetch-Site':'cross-site'},fetcher})).status,403);
  assert.equal((await call(`/api/youtube-playlist?list=${ID}`,{headers:{},fetcher})).status,403);
  assert.equal((await call(`/api/youtube-playlist?list=${ID}`,{method:'POST',fetcher})).status,405);
  assert.equal(calls,0);
});
test('route: pages through the playlist, hides deleted/private videos, returns only titles and channels',async()=>{
  const seen:string[]=[];
  const fetcher=(async(url:string)=>{
    seen.push(url);const u=new URL(url);
    if(u.pathname.endsWith('/playlists'))return new Response(JSON.stringify({items:[{snippet:{title:'HIGH & TRIP'}}]}));
    const second=u.searchParams.get('pageToken')==='p2';
    return new Response(JSON.stringify(second
      ?{pageInfo:{totalResults:3},items:[{snippet:{title:'Last',videoOwnerChannelTitle:'Z - Topic',resourceId:{videoId:'secret'}}}]}
      :{pageInfo:{totalResults:3},nextPageToken:'p2',items:[{snippet:{title:'One',videoOwnerChannelTitle:'A'}},{snippet:{title:'Deleted video'}},{snippet:{title:'Private video'}}]}));
  }) as unknown as typeof fetch;
  const {status,body}=await call(`/api/youtube-playlist?list=${ID}`,{fetcher});
  assert.equal(status,200);assert.equal(body.name,'HIGH & TRIP');assert.equal(body.total,3);assert.equal(body.truncated,false);
  assert.deepEqual(body.items,[{title:'One',channel:'A'},{title:'Last',channel:'Z - Topic'}]);
  assert.ok(!JSON.stringify(body).includes('secret'));
  assert.ok(seen.every(u=>u.startsWith('https://www.googleapis.com/youtube/v3/')));
});
test('route: upstream errors map to not-found, private and quota without leaking the key',async()=>{
  const upstream=(status:number,reason:string)=>(async()=>new Response(JSON.stringify({error:{errors:[{reason}]}}),{status})) as typeof fetch;
  const env={YOUTUBE_API_KEY:'secret-key'};
  assert.equal((await call(`/api/youtube-playlist?list=${ID}`,{env,fetcher:upstream(404,'playlistNotFound')})).status,404);
  assert.equal((await call(`/api/youtube-playlist?list=${ID}`,{env,fetcher:upstream(403,'playlistItemsNotAccessible')})).status,403);
  const quota=await call(`/api/youtube-playlist?list=${ID}`,{env,fetcher:upstream(403,'quotaExceeded')});
  assert.equal(quota.status,429);assert.ok(!JSON.stringify(quota).includes('secret-key'));
});
