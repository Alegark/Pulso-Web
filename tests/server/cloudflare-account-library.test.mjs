import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountLibraryRouter} from '../../deployment/cloudflare/account-library.mjs';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const env={PULSO_NEON_DATA_API_URL:'https://ep-test.apirest.us-east-2.aws.neon.tech/pulso/rest/v1'};
const token='TESTONLY.'+Buffer.from(JSON.stringify({sub:id})).toString('base64url')+'.TESTONLY',auth=async()=>Response.json({token});
const document={version:1,tracks:[{id,title:'Canción propia',artist:'Artista',album:'Álbum',duration:45,favorite:true,inLibrary:true,createdAt:'2026-11-17T00:00:00Z',localAlbum:null,catalog:null}],playlists:[]};
const req=(value,origin='https://pulso.test')=>new Request('https://pulso.test/api/account-library',{method:'PUT',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
test('library boundary blocks anonymous, foreign subject, cross-origin and audio fields before storage',async()=>{
 let calls=0;const route=createAccountLibraryRouter({auth,fetcher:async()=>{calls++;return Response.json([]);}});
 for(const r of [req({accountId:other,revision:null,document}),req({accountId:id,revision:null,document},'https://other.test'),req({accountId:id,revision:null,document:{...document,audio:'bytes'}})])assert.ok((await route(r,env)).status>=400);
 assert.equal(calls,0);const anonymous=createAccountLibraryRouter({auth:async()=>Response.json({token:null}),fetcher:async()=>{calls++;}});assert.equal((await anonymous(new Request('https://pulso.test/api/account-library'),env)).status,401);assert.equal(calls,0);
});
test('library metadata returned only for the authenticated subject and exact revision used for CAS',async()=>{
 let captured;const route=createAccountLibraryRouter({auth,fetcher:async(url,options)=>{captured={url:new URL(url),options,body:options.body&&JSON.parse(options.body)};return Response.json([{user_id:id,revision:4,document}]);}});
 const response=await route(req({accountId:id,revision:3,document}),env);assert.equal(response.status,200);assert.equal(captured.url.searchParams.get('user_id'),'eq.'+id);assert.equal(captured.url.searchParams.get('revision'),'eq.3');assert.equal(captured.body.revision,4);assert.equal(captured.options.method,'PATCH');assert.deepEqual(await response.json(),{accountId:id,revision:4,document});assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Authorization'),null);
});
test('conflict cannot overwrite another device and foreign-row responses are rejected',async()=>{
 let calls=0;const route=createAccountLibraryRouter({auth,fetcher:async()=>{calls++;return Response.json([]);}});assert.equal((await route(req({accountId:id,revision:3,document}),env)).status,409);assert.equal(calls,1);
 const foreign=createAccountLibraryRouter({auth,fetcher:async()=>Response.json([{user_id:other,revision:4,document}])});assert.equal((await foreign(new Request('https://pulso.test/api/account-library'),env)).status,503);
});
test('delayed authentication cannot write after deadline and body reads are bounded',async()=>{
 let release,calls=0;const route=createAccountLibraryRouter({timeoutMs:5,auth:()=>new Promise(r=>{release=r;}),fetcher:async()=>{calls++;return Response.json([]);}});assert.equal((await route(req({accountId:id,revision:null,document}),env)).status,503);release(Response.json({token}));await new Promise(r=>setTimeout(r,10));assert.equal(calls,0);
});
test('library rejects jsonb overflow even when the compact document fits',async()=>{
 const max=2*1024*1024;
 const tracks=Array.from({length:5000},(_,i)=>({...document.tracks[0],id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,title:'x'.repeat(270)}));
 const count=Math.floor((max-100)/(Buffer.byteLength(JSON.stringify(tracks[0]))+1));
 const large={...document,tracks:tracks.slice(0,count)};
 assert.ok(Buffer.byteLength(JSON.stringify(large))<max);
 assert.ok(Buffer.byteLength(JSON.stringify(large))+(19*count)>max);
 let writes=0;
 const route=createAccountLibraryRouter({auth,fetcher:async()=>{writes++;return Response.json([]);}});
 const response=await route(req({accountId:id,revision:null,document:large}),env);
 assert.equal(response.status,400);
 assert.deepEqual(await response.json(),{code:'LIBRARY_TOO_LARGE'});
 assert.equal(writes,0);
});
test('library rejects lone UTF-16 surrogates and accepts paired characters',async()=>{
 let writes=0;
 const route=createAccountLibraryRouter({auth,fetcher:async()=>{writes++;return Response.json([]);}});
 const withTitle=title=>req({accountId:id,revision:null,document:{...document,tracks:[{...document.tracks[0],title}]}});
 for(const title of ['\ud800','\udfff']){
  const response=await route(withTitle(title),env);
  assert.equal(response.status,400);
  assert.deepEqual(await response.json(),{code:'LIBRARY_INVALID'});
 }
 assert.equal(writes,0);
 assert.equal((await route(withTitle('Canción 🎵'),env)).status,409);
 assert.equal(writes,1);
});
test('library distinguishes known Postgres document rejections from service errors',async()=>{
 for(const [pg,code,status] of [['23514','LIBRARY_TOO_LARGE',400],['22P05','LIBRARY_INVALID',400],['unknown','LIBRARY_UNAVAILABLE',503]]){
  const route=createAccountLibraryRouter({auth,fetcher:async()=>Response.json({code:pg,message:'private upstream details'},{status:400})});
  const response=await route(req({accountId:id,revision:null,document}),env);
  assert.equal(response.status,status);
  assert.deepEqual(await response.json(),{code});
 }
});
