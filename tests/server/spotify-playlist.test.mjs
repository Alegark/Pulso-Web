import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseSpotifyPlaylist,spotifyPlaylist,spotifyTrackRelease} from '../../deployment/cloudflare/spotify-playlist.mjs';
const id='a'.repeat(22),uri=`spotify:track:${id}`,row={uri,title:'Song',subtitle:'Artist',duration:120000,audioPreview:{url:'https://forbidden.invalid/audio'}};
const html=entity=>`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{state:{data:{entity}}}}})}</script>`;
const fixture=(rows=[row],extra={})=>html({name:'Fixture',trackList:rows,...extra});
test('closed metadata parser: unknown completeness, unavailable tracks and omissions',()=>{const data=parseSpotifyPlaylist(fixture([{...row,isPlayable:false},{uri:'spotify:episode:'+id},{uri:'spotify:local:x'}]));assert.equal(data.tracks.length,1);assert.equal(data.omitted,2);assert.equal(data.complete,false);assert.equal(data.total,null);assert.equal(data.tracks[0].url,'https://open.spotify.com/track/'+id);assert.ok(!JSON.stringify(data).includes('audioPreview'));});
test('limits and total never infer completeness from short list',()=>{assert.equal(parseSpotifyPlaylist(fixture(Array(100).fill(row))).limited,true);assert.equal(parseSpotifyPlaylist(fixture([row],{totalTracks:1})).complete,true);assert.equal(parseSpotifyPlaylist(fixture(Array(101).fill(row))).readCount,100);for(const input of ['',fixture([row]).replace('__NEXT_DATA__','other'),fixture(Array(1001).fill(row)),fixture()+fixture()])assert.throws(()=>parseSpotifyPlaylist(input));});
test('JSON escapes remain text; no executable HTML parsing',()=>{const value='A &amp; <b>text</b> " \\ \n 😀';assert.equal(parseSpotifyPlaylist(fixture([{...row,title:value}])).tracks[0].title,value);assert.throws(()=>parseSpotifyPlaylist('<script id="__NEXT_DATA__">(()=>42)()</script>'));});
test('fixed upstream, no visitor headers, no-store',async()=>{let count=0;const response=await spotifyPlaylist(new Request(`https://pulso.test/api/spotify-playlist/${id}`,{headers:{Cookie:'private',Authorization:'private'}}),async(url,options)=>{count++;assert.equal(url,`https://open.spotify.com/embed/playlist/${id}`);assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.deepEqual(options.headers,{Accept:'text/html'});return new Response(fixture(),{headers:{'content-type':'text/html'}});});assert.equal(count,1);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');});
test('negative routes and upstream failures',async()=>{for(const path of ['/api/spotify-playlist/short',`/api/spotify-playlist/${id}?url=https://evil.invalid`,`/api/spotify-playlist/${id}/extra`])assert.equal((await spotifyPlaylist(new Request('https://pulso.test'+path),()=>{throw Error('must not fetch');})).status,400);const request=()=>new Request(`https://pulso.test/api/spotify-playlist/${id}`);for(const mock of [()=>{throw Error('network');},()=>new Response('private',{status:404}),()=>new Response(fixture(),{headers:{'content-type':'application/json'}}),()=>new Response('x'.repeat(1024*1024+1),{headers:{'content-type':'text/html'}})])assert.equal((await spotifyPlaylist(request(),mock)).status,502);assert.equal((await spotifyPlaylist(new Request(request(),{headers:{Origin:'https://evil.invalid'}}))).status,403);assert.equal((await spotifyPlaylist(new Request(request(),{method:'POST'}))).status,405);});
test('request cancellation reaches upstream signal and reader is cancelled on overflow',async()=>{const controller=new AbortController();controller.abort();const response=await spotifyPlaylist(new Request(`https://pulso.test/api/spotify-playlist/${id}`,{signal:controller.signal}),async(_url,options)=>{assert.equal(options.signal.aborted,true);throw Error('aborted');});assert.equal(response.status,502);let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(1024*1024+1));},cancel(){cancelled=true;}});assert.equal((await spotifyPlaylist(new Request(`https://pulso.test/api/spotify-playlist/${id}`),async()=>new Response(stream,{headers:{'content-type':'text/html'}}))).status,502);assert.equal(cancelled,true);});
test('failure diagnostics expose only fixed stage and upstream status, never response metadata',async()=>{const request=()=>new Request(`https://pulso.test/api/spotify-playlist/${id}`);const rejected=await spotifyPlaylist(request(),()=>new Response('private upstream body',{status:403}));assert.deepEqual(await rejected.json(),{error:'unavailable',reason:'upstream-response',upstreamStatus:403});const network=await spotifyPlaylist(request(),()=>{throw Error('private upstream error')});assert.deepEqual(await network.json(),{error:'unavailable',reason:'network'});const format=await spotifyPlaylist(request(),()=>new Response('private invalid markup',{headers:{'content-type':'text/html'}}));assert.deepEqual(await format.json(),{error:'unavailable',reason:'metadata-format'});});

test('Workers runtime accepts request options and rejects redirects without following them',async()=>{
 const {Miniflare}=await import('miniflare');
 const {readFile}=await import('node:fs/promises');
 const {stripTypeScriptTypes}=await import('node:module');
 const source=await readFile(new URL('../../deployment/cloudflare/spotify-playlist.mjs',import.meta.url),'utf8');
 const moduleName='deployment/cloudflare/spotify-playlist.mjs',matcherName='src/library/catalog-id.ts';
 const readerName='src/accounts/bounded-body.mjs';
 const reader=await readFile(new URL('../../'+readerName,import.meta.url),'utf8');
 const matcher=stripTypeScriptTypes(await readFile(new URL('../../'+matcherName,import.meta.url),'utf8'));
 const contents=source+`
 let trackCalls=0;
 const relay=createSpotifyTrackRelease({fetcher:async url=>{
  trackCalls++;
  await new Promise(resolve=>setTimeout(resolve,25));
  const docs={
   ${JSON.stringify('https://open.spotify.com/track/'+id)}:${JSON.stringify(releaseTrack(id))},
   ${JSON.stringify('https://open.spotify.com/track/'+secondId)}:${JSON.stringify(releaseTrack(secondId))},
   ${JSON.stringify('https://open.spotify.com/embed/album/'+album)}:${JSON.stringify(releaseAlbum)},
  };
  return new Response(docs[url],{headers:{'content-type':'text/html'}});
 }});
 export default {async fetch(request,env,ctx){
  if(new URL(request.url).pathname.startsWith('/api/spotify-track/')){
   const response=await relay(request,ctx);
   return Response.json({trackCalls,status:response.status,data:await response.json()});
  }
  let calls=0;
  const response=await spotifyPlaylist(request,async(url,options)=>{
   calls++;
   new Request(url,options);
   return request.headers.get('X-Test-Redirect')?new Response(null,{status:302,headers:{Location:'https://must-not-follow.invalid/'}}):new Response(${JSON.stringify(fixture())},{headers:{'content-type':'text/html'}});
  });
  return Response.json({calls,status:response.status,data:await response.json()});
 }};
 `;
 const mf=new Miniflare({workers:[{config:{name:'spotify-runtime-test',compatibilityDate:'2026-11-13',manifest:{mainModule:moduleName,modules:{[moduleName]:{type:'esm',contents},[matcherName]:{type:'esm',contents:matcher},[readerName]:{type:'esm',contents:reader}}}}}]});
 try{
  const url=`https://pulso.test/api/spotify-playlist/${id}`;
  const success=await(await mf.dispatchFetch(url)).json();assert.equal(success.calls,1);assert.equal(success.status,200);assert.equal(success.data.tracks.length,1);
  const releases=await Promise.all([id,secondId,id].map(async id=>(await mf.dispatchFetch(releaseRequest(id).url)).json()));
  assert.deepEqual(releases.map(r=>r.status),[200,200,200]);
  assert.deepEqual(releases.map(r=>r.trackCalls),[3,3,3]);
  const redirected=await(await mf.dispatchFetch(url,{headers:{'X-Test-Redirect':'1'}})).json();assert.equal(redirected.calls,1);assert.equal(redirected.status,502);assert.equal(redirected.data.upstreamStatus,302);
 }finally{await mf.dispose();}
});

test('a missing credit stays empty and an unusable title is omitted',()=>{
 const data=parseSpotifyPlaylist(fixture([{...row,subtitle:null,duration:undefined},{...row,title:null}]));
 assert.equal(data.omitted,1);
 assert.equal(data.tracks.length,1);
 assert.equal(data.tracks[0].artists,'');
 assert.equal(data.tracks[0].durationMs,null);
});

test('exact Spotify track/album identity and bounded CDN artwork without credentials',async()=>{
 const album='b'.repeat(22),endpoint=new Request('https://pulso.test/api/spotify-track/'+id,{headers:{Authorization:'private'}});
 const track=`<meta content="https://open.spotify.com/track/${id}" property="og:url"><meta name="music:album" content="https://open.spotify.com/album/${album}"><meta name="music:album:track" content="3">`;
 const image=`https://image-cdn-fa.spotifycdn.com/image/${'a'.repeat(40)}`;
 const raw={type:'album',id:album,uri:'spotify:album:'+album,title:'Álbum',subtitle:'Artista',trackList:[{uri}],visualIdentity:{image:[{url:'https://evil.test/image/x',maxWidth:640},{url:image,maxWidth:300}]}};
 let paths=[];
 const relay=(doc=raw,metadata=track)=>spotifyTrackRelease(endpoint,async(url,options)=>{
  paths.push(url);assert.equal(options.credentials,'omit');assert.deepEqual(options.headers,{Accept:'text/html'});
  return new Response(url.includes('/embed/')?html(doc):metadata,{headers:{'content-type':'text/html'}});
 });
 const response=await relay();
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{source:'spotify',releaseId:album,trackId:id,position:3,title:'Álbum',artist:'Artista',artworkUrl:image});
 assert.deepEqual(paths,[`https://open.spotify.com/track/${id}`,`https://open.spotify.com/embed/album/${album}`]);
 paths=[];
 assert.equal((await relay(raw,track.replace('og:url','og:wrong'))).status,502);
 assert.equal(paths.length,1);
 assert.equal((await relay({...raw,trackList:[]})).status,502);
 assert.equal((await relay({...raw,uri:'spotify:album:'+'c'.repeat(22)})).status,502);
});

const album='p'.repeat(22),secondId='z'.repeat(22);
const releaseRequest=(id,signal)=>new Request('https://pulso.test/api/spotify-track/'+id,{signal});
const releaseTrack=id=>`<meta property="og:url" content="https://open.spotify.com/track/${id}"><meta name="music:album" content="https://open.spotify.com/album/${album}"><meta name="music:album:track" content="1">`;
const releaseAlbum=html({type:'album',id:album,uri:'spotify:album:'+album,title:'Album',trackList:[id,secondId].map(id=>({uri:'spotify:track:'+id}))});
const htmlResponse=body=>new Response(body,{headers:{'Content-Type':'text/html'}});

test('track and album metadata share in-flight work and successful results expire',async()=>{
 const {createSpotifyTrackRelease}=await import('../../deployment/cloudflare/spotify-playlist.mjs');
 let now=0,finish;
 const gate=new Promise(resolve=>{finish=resolve;});
 const calls=[];
 const fetcher=async url=>{
  calls.push(url);
  if(url.includes('/embed/')){await gate;return htmlResponse(releaseAlbum);}
  return htmlResponse(releaseTrack(url.split('/').pop()));
 };
 const relay=createSpotifyTrackRelease?.({fetcher,clock:()=>now})??(request=>spotifyTrackRelease(request,fetcher));
 const work=[id,secondId,id].map(id=>relay(releaseRequest(id)));
 finish();
 assert.deepEqual((await Promise.all(work)).map(r=>r.status),[200,200,200]);
 assert.equal(calls.length,3);
 assert.equal((await relay(releaseRequest(secondId))).status,200);
 assert.equal(calls.length,3);
 now=24*60*60*1000;
 assert.equal((await relay(releaseRequest(id))).status,200);
 assert.equal(calls.length,5);
});

test('cancelling one Spotify visitor leaves shared work usable and errors can be retried',async()=>{
 const {createSpotifyTrackRelease}=await import('../../deployment/cloudflare/spotify-playlist.mjs');
 let calls=0,finish;
 const gate=new Promise(resolve=>{finish=resolve;});
 const fetcher=async url=>{
  calls++;
  if(calls===1)return new Response(null,{status:429});
  await gate;
  return htmlResponse(url.includes('/embed/')?releaseAlbum:releaseTrack(id));
 };
 const relay=createSpotifyTrackRelease?.({fetcher})??(request=>spotifyTrackRelease(request,fetcher));
 assert.equal((await relay(releaseRequest(id))).status,502);
 const visitor=new AbortController();
 const first=relay(releaseRequest(id,visitor.signal)),second=relay(releaseRequest(id));
 visitor.abort();finish();
 assert.equal((await first).status,502);
 assert.equal((await second).status,200);
 assert.equal(calls,3);
});
