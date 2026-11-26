import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';

test('account data uses Workers-compatible fetch options and rejects redirects',async()=>{
 const routerName='deployment/cloudflare/account-data.mjs';
 const readerName='src/accounts/bounded-body.mjs';
 const limiterName='deployment/cloudflare/rate-limit.mjs';
 const router=await readFile(new URL('../../'+routerName,import.meta.url),'utf8');
 const reader=await readFile(new URL('../../'+readerName,import.meta.url),'utf8');
 const limiter=await readFile(new URL('../../'+limiterName,import.meta.url),'utf8');
 const turnstile=await readFile(new URL('../../deployment/cloudflare/turnstile.mjs',import.meta.url),'utf8');
 const entry=`import {verifyTurnstile} from './deployment/cloudflare/turnstile.mjs';
 import {createAccountDataRouter} from './${routerName}';
 const id='11111111-1111-4111-8111-111111111111';
 const token='test.'+btoa(JSON.stringify({sub:id}))+'.test';
 export default {async fetch(request){
  if(new URL(request.url).searchParams.has('turnstile')) {
   let calls=0;
   const response=await verifyTurnstile(new Request('https://pulso.test/',{headers:{'X-Pulso-Turnstile':'token'}}),{PULSO_TURNSTILE_SECRET:'secret'},'login',async(url,options)=>{calls++;new Request(url,options);return new URL(request.url).searchParams.has('redirect')?new Response(null,{status:302,headers:{Location:'https://other.invalid/'}}):Response.json({success:true,hostname:'pulso.test',action:'login'});},1000);
   return Response.json({response,calls});
  }
  let calls=0;
  const path=new URL(request.url).searchParams.has('profile')?'/api/account-profile':'/api/account-library';
  const route=createAccountDataRouter({path,table:'test',column:'document',unavailableCode:'LIBRARY_UNAVAILABLE',conflictCode:'CONFLICT',inputMax:1024,resultMax:1024,parseInput:x=>x,values:()=>({document:{}}),formatRow:(_row,_subject,respond)=>respond({ok:true})},{auth:async()=>Response.json({token}),fetcher:async(url,options)=>{calls++;new Request(url,options);return new URL(request.url).searchParams.has('redirect')?new Response(null,{status:302,headers:{Location:'https://other.invalid/'}}):Response.json([]);}});
  const response=await route(new Request('https://pulso.test'+path),{PULSO_NEON_DATA_API_URL:'https://ep-test.apirest.us-east-2.aws.neon.tech/pulso/rest/v1'});
  return Response.json({status:response.status,calls});
 }};`;
 const modules={
  'index.mjs':{type:'esm',contents:entry},
  [routerName]:{type:'esm',contents:router},
  'deployment/cloudflare/turnstile.mjs':{type:'esm',contents:turnstile},
  [readerName]:{type:'esm',contents:reader},
  [limiterName]:{type:'esm',contents:limiter},
  'deployment/cloudflare/accounts.mjs':{type:'esm',contents:'export const accountAuth=()=>{};'},
  'src/accounts/library-document.mjs':{type:'esm',contents:'export const libraryUuid=v=>/^[0-9a-f-]{36}$/.test(v);'},
 };
 const mf=new Miniflare({workers:[{config:{name:'account-data-runtime-test',compatibilityDate:'2026-11-13',manifest:{mainModule:'index.mjs',modules}}}]});
 try{
  assert.deepEqual(await (await mf.dispatchFetch('http://localhost/')).json(),{status:200,calls:1});
  assert.deepEqual(await (await mf.dispatchFetch('http://localhost/?redirect')).json(),{status:503,calls:1});
  assert.deepEqual(await (await mf.dispatchFetch('http://localhost/?profile')).json(),{status:200,calls:1});
  assert.deepEqual(await (await mf.dispatchFetch('http://localhost/?profile&redirect')).json(),{status:503,calls:1});
  assert.deepEqual(await (await mf.dispatchFetch('http://localhost/?turnstile')).json(),{response:null,calls:1});
  assert.deepEqual(await (await mf.dispatchFetch('http://localhost/?turnstile&redirect')).json(),{response:'TURNSTILE_UNAVAILABLE',calls:1});
 }finally{await mf.dispose();}
});
