import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {youtubePlaylist} from '../../deployment/cloudflare/youtube-playlist.mjs';

const id='PLymdogRYFRdJDRc2TzZnE5OCw-sRpyXEm';
const subject='11111111-1111-4111-8111-111111111111';
const dummyKey='TESTONLY_YOUTUBE_API_KEY';
const jwt=`header.${btoa(JSON.stringify({sub:subject}))}.signature`;
const authOk=()=>Response.json({token:jwt});
const successLimit={limit:async()=>({success:true})};
const env={YOUTUBE_API_KEY:dummyKey,PULSO_SPOTIFY_LIMIT:successLimit};
const request=(path=`/api/youtube-playlist?list=${id}`,init={})=>new Request('https://pulso.test'+path,{
 headers:{Origin:'https://pulso.test','Sec-Fetch-Site':'same-origin',Cookie:'pulso-session=synthetic','CF-Connecting-IP':'192.0.2.25',...init.headers},
 ...init,
});
const result=async response=>({status:response.status,body:await response.json(),headers:response.headers});
const assertSafe=response=>{
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
 assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
 assert.equal(response.headers.get('Content-Security-Policy'),"default-src 'none'; frame-ancestors 'none'");
};
const googleJson=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

test('HTTP methods, query validation, Origin and cross-site checks reject before auth or upstream',async()=>{
 let authCalls=0,googleCalls=0;
 const auth=async()=>{authCalls++;return authOk();};
 const fetcher=async()=>{googleCalls++;return googleJson({});};
 for(const req of [request(undefined,{method:'POST'}),request('/api/youtube-playlist?list='+id+'&extra=1'),request('/api/youtube-playlist?list='+id+'&list='+id),request('/api/youtube-playlist?list=short')]){
  const response=await youtubePlaylist(req,env,{auth,fetcher});assertSafe(response);
  assert.equal(response.status,req.method==='POST'?405:400);
 }
 const wrongOrigin=request(undefined,{headers:{Origin:'https://evil.test'}});
 const crossSite=request(undefined,{headers:{'Sec-Fetch-Site':'cross-site'}});
 assert.equal((await youtubePlaylist(wrongOrigin,env,{auth,fetcher})).status,403);
 assert.equal((await youtubePlaylist(crossSite,env,{auth,fetcher})).status,403);
 assert.equal(authCalls,0);assert.equal(googleCalls,0);
});

test('authentication requires a Pulso session, bounds the auth body, and propagates refreshed cookies',async()=>{
 const anonymous=await youtubePlaylist(request(),env,{auth:async()=>new Response(null,{status:401}),fetcher:()=>assert.fail('upstream')});
 assert.equal(anonymous.status,401);assert.deepEqual(await anonymous.json(),{error:'sign-in-required'});assertSafe(anonymous);
 const unavailable=await youtubePlaylist(request(),env,{auth:async()=>new Response(null,{status:503}),fetcher:()=>assert.fail('upstream')});
 assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{error:'unavailable'});
 let authTarget;
 const refreshed=await youtubePlaylist(request(),env,{
  auth:async(target)=>{authTarget=target;const response=Response.json({token:jwt});response.headers.append('Set-Cookie','pulso-a=synthetic; Path=/; HttpOnly');response.headers.append('Set-Cookie','pulso-b=synthetic; Path=/; SameSite=Lax');return response;},
  fetcher:async url=>new URL(url).pathname.endsWith('/playlists')?googleJson({items:[{snippet:{title:'Lista'}}]}):googleJson({pageInfo:{totalResults:0},items:[]}),
 });
 assert.equal(authTarget.url,'https://pulso.test/api/account-auth/token');
 assert.equal(authTarget.headers.get('Origin'),'https://pulso.test');
 assert.equal(authTarget.headers.get('Cookie'),'pulso-session=synthetic');
 assert.deepEqual(refreshed.headers.getSetCookie(),['pulso-a=synthetic; Path=/; HttpOnly','pulso-b=synthetic; Path=/; SameSite=Lax']);
 assertSafe(refreshed);
 const badSubject=await youtubePlaylist(request(),env,{auth:async()=>Response.json({token:`header.${btoa(JSON.stringify({sub:'not-a-uuid'}))}.sig`}),fetcher:()=>assert.fail('upstream')});
 assert.equal(badSubject.status,401);
});

test('account and IP limits use the shared binding and return a no-store 429 before Google',async()=>{
 for(const blocked of ['youtube:user:'+subject,'youtube:ip:192.0.2.25']){
  const keys=[];
  const limiter={limit:async({key})=>{keys.push(key);return {success:key!==blocked};}};
  const response=await youtubePlaylist(request(),{...env,PULSO_SPOTIFY_LIMIT:limiter},{auth:async()=>authOk(),fetcher:()=>assert.fail('upstream')});
  assert.equal(response.status,429);assert.deepEqual(await response.json(),{error:'rate-limited'});
  assert.equal(response.headers.get('Retry-After'),'60');assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(keys,['youtube:user:'+subject,'youtube:ip:192.0.2.25']);assertSafe(response);
 }
 let calls=0;
 const missingBinding=await youtubePlaylist(request(),{YOUTUBE_API_KEY:dummyKey},{auth:async()=>authOk(),fetcher:async()=>{calls++;return googleJson({});}});
 assert.equal(missingBinding.status,503);assert.deepEqual(await missingBinding.json(),{error:'unavailable'});assert.equal(calls,0);assertSafe(missingBinding);
});

test('missing key returns not-configured without upstream traffic',async()=>{
 let calls=0;
 const response=await youtubePlaylist(request(),{PULSO_SPOTIFY_LIMIT:successLimit},{auth:async()=>authOk(),fetcher:async()=>{calls++;return googleJson({});}});
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'not-configured'});assert.equal(calls,0);assertSafe(response);
});

test('pagination returns bounded titles only and sends no client headers or credentials to Google',async()=>{
 const seen=[];
 const response=await youtubePlaylist(request(),env,{auth:async()=>authOk(),fetcher:async(url,options)=>{
  seen.push({url,options});
  const endpoint=new URL(url);
  if(endpoint.pathname.endsWith('/playlists'))return googleJson({items:[{snippet:{title:'Lista pública'}}]});
  const second=endpoint.searchParams.get('pageToken')==='synthetic-next';
  return googleJson(second?{pageInfo:{totalResults:3},items:[{snippet:{title:'Final',videoOwnerChannelTitle:'Canal - Topic',resourceId:{videoId:'synthetic-video-id'}}}]}:
   {pageInfo:{totalResults:3},nextPageToken:'synthetic-next',items:[{snippet:{title:'Primera',videoOwnerChannelTitle:'Artista'},resourceId:{videoId:'synthetic-video-id'}},{snippet:{title:'Deleted video'}}]});
 }});
 const out=await result(response);
 assert.equal(out.status,200);assert.equal(out.body.name,'Lista pública');assert.equal(out.body.total,3);assert.equal(out.body.truncated,false);
 assert.deepEqual(out.body.items,[{title:'Primera',channel:'Artista'},{title:'Final',channel:'Canal - Topic'}]);
 const serialized=JSON.stringify(out.body);assert.ok(!serialized.includes(dummyKey));assert.ok(!serialized.includes('synthetic-video-id'));
 assert.equal(seen.length,3);
 for(const call of seen){
  const url=new URL(call.url);assert.equal(url.hostname,'www.googleapis.com');assert.equal(url.searchParams.get('key'),dummyKey);
  assert.equal(call.options.redirect,'manual');assert.equal(call.options.credentials,'omit');
  assert.deepEqual(call.options.headers,{Accept:'application/json'});assert.ok(call.options.signal);
  assert.ok(!Object.hasOwn(call.options.headers,'Cookie'));
 }
 assertSafe(response);
});

test('30 páginas devuelve los 1500 ítems y limita Google a 31 llamadas más auth dentro de Workers Free',async()=>{
 const calls=[];let authCalls=0;
 const response=await youtubePlaylist(request(),env,{
  auth:async()=>{authCalls++;return authOk();},
  fetcher:async url=>{
   calls.push(new URL(url));
   const endpoint=new URL(url);
   if(endpoint.pathname.endsWith('/playlists'))return googleJson({items:[{snippet:{title:'Lista de 30 páginas'}}]});
   const pageToken=endpoint.searchParams.get('pageToken');
   const pageNumber=pageToken?Number(pageToken.replace('synthetic-page-','')):1;
   return googleJson({pageInfo:{totalResults:2000},nextPageToken:`synthetic-page-${pageNumber+1}`,
    items:Array.from({length:50},(_,index)=>({snippet:{title:`Página ${pageNumber} pista ${index+1}`,videoOwnerChannelTitle:'Canal sintético'}}))});
  },
 });
 const out=await result(response);
 assert.equal(out.status,200);assert.equal(out.body.name,'Lista de 30 páginas');assert.equal(out.body.total,2000);
 assert.equal(out.body.truncated,true);assert.equal(out.body.items.length,1500);
 assert.equal(new Set(out.body.items.map(item=>item.title)).size,1500);
 assert.equal(calls.filter(url=>url.pathname.endsWith('/playlistItems')).length,30);
 assert.equal(calls.filter(url=>url.pathname.endsWith('/playlists')).length,1);
 assert.equal(calls.length,31);
 assert.equal(authCalls,1);
 assert.ok(calls.length+authCalls<=32);
 assert.ok(calls.length+authCalls<=50,'El relay permanece por debajo del límite de 50 subrequests de Workers Free');
 assert.ok(out.body.items.every(item=>item.title.startsWith('Página ')&&item.channel==='Canal sintético'));
 assertSafe(response);
});

test('upstream status and quota reasons map to fixed user-facing errors',async()=>{
 const denied=(status,reason)=>youtubePlaylist(request(),env,{auth:async()=>authOk(),fetcher:async()=>googleJson({error:{errors:[{reason}],message:'synthetic raw body'}} ,status)});
 for(const [status,reason,expected,body] of [
  [404,'playlistNotFound',404,{error:'not-found'}],
  [403,'playlistItemsNotAccessible',403,{error:'private'}],
  [403,'quotaExceeded',429,{error:'quota'}],
  [403,'dailyLimitExceeded',429,{error:'quota'}],
  [403,'rateLimitExceeded',429,{error:'quota'}],
 ]){
  const response=await denied(status,reason);assert.equal(response.status,expected);assert.deepEqual(await response.json(),body);assertSafe(response);
 }
});

test('oversized or malformed upstream bodies become unavailable without exposing content',async()=>{
 const oversized='x'.repeat(512*1024+1);
 const response=await youtubePlaylist(request(),env,{auth:async()=>authOk(),fetcher:async()=>new Response(oversized,{headers:{'Content-Length':String(oversized.length)}})});
 assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:'unavailable'});
 const malformed=await youtubePlaylist(request(),env,{auth:async()=>authOk(),fetcher:async()=>new Response('{not-json')});
 assert.equal(malformed.status,502);assert.deepEqual(await malformed.json(),{error:'unavailable'});
});

test('page timeout, global deadline and request abort cancel their work',async()=>{
 let pageAborted=false;
 const page=await youtubePlaylist(request(),env,{auth:async()=>authOk(),pageTimeoutMs:5,timeoutMs:500,fetcher:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{pageAborted=true;reject(Error('aborted'));},{once:true}))});
 assert.equal(page.status,502);assert.equal(pageAborted,true);
 let globalAborted=false;
 const timed=await youtubePlaylist(request(),env,{timeoutMs:5,auth:target=>new Promise(resolve=>target.signal.addEventListener('abort',()=>{globalAborted=true;resolve(new Response(null,{status:401}));},{once:true}))});
 assert.equal(timed.status,502);assert.equal(globalAborted,true);
 const controller=new AbortController();const req=request(undefined,{signal:controller.signal});
 const pending=youtubePlaylist(req,env,{auth:async()=>authOk(),fetcher:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))});
 controller.abort();assert.equal((await pending).status,502);
});

test('Miniflare executes the relay in Workers runtime with its Web APIs and bounded reader',async()=>{
 const {Miniflare}=await import('miniflare');
 const source=await readFile(new URL('../../deployment/cloudflare/youtube-playlist.mjs',import.meta.url),'utf8');
 const reader=await readFile(new URL('../../src/accounts/bounded-body.mjs',import.meta.url),'utf8');
 const limiter=await readFile(new URL('../../deployment/cloudflare/rate-limit.mjs',import.meta.url),'utf8');
 const authModule=`export async function accountAuth(){return Response.json({token:${JSON.stringify(jwt)}});}`;
 const accountModule=`export const libraryUuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);`;
 const main=source+`
 export default {async fetch(request){
  return youtubePlaylist(request,{YOUTUBE_API_KEY:${JSON.stringify(dummyKey)},PULSO_SPOTIFY_LIMIT:{limit:async()=>({success:true})}},{fetcher:async(url,options)=>{
   new Request(url,options);
   return new URL(url).pathname.endsWith('/playlists')
    ?Response.json({items:[{snippet:{title:'Miniflare'}}]})
    :Response.json({pageInfo:{totalResults:1},items:[{snippet:{title:'Runtime song',videoOwnerChannelTitle:'Worker'}}]});
  }});
 }};
 `;
 const mf=new Miniflare({workers:[{config:{name:'youtube-runtime-test',compatibilityDate:'2026-11-13',manifest:{mainModule:'deployment/cloudflare/youtube-playlist.mjs',modules:{
  'deployment/cloudflare/youtube-playlist.mjs':{type:'esm',contents:main},
  'src/accounts/bounded-body.mjs':{type:'esm',contents:reader},
  'src/accounts/library-document.mjs':{type:'esm',contents:accountModule},
  'deployment/cloudflare/accounts.mjs':{type:'esm',contents:authModule},
  'deployment/cloudflare/rate-limit.mjs':{type:'esm',contents:limiter},
 }}}}]});
 try{
  const response=await mf.dispatchFetch(`https://pulso.test/api/youtube-playlist?list=${id}`);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{name:'Miniflare',total:1,truncated:false,items:[{title:'Runtime song',channel:'Worker'}]});assertSafe(response);
 }finally{await mf.dispose();}
});
