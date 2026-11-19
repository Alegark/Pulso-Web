import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountProfileRouter} from '../../deployment/cloudflare/account-profile.mjs';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const env={PULSO_NEON_DATA_API_URL:'https://ep-test.apirest.us-east-2.aws.neon.tech/pulso/rest/v1'};
const token='TESTONLY.'+Buffer.from(JSON.stringify({sub:id})).toString('base64url')+'.TESTONLY';
const auth=async()=>Response.json({token});
const req=(value,extra={})=>new Request('https://pulso.test/api/account-profile',{method:'PUT',headers:{Origin:'https://pulso.test','Content-Type':'application/json',...extra},body:JSON.stringify(value)});
const value={accountId:id,telegramPhone:'+12025550100',revision:null};
test('profile boundary denies anonymous, cross-origin, unknown fields and subject swaps before the Data API',async()=>{
 let calls=0;const route=createAccountProfileRouter({auth,fetcher:async()=>{calls++;return Response.json([]);}});
 for(const input of [req(value,{Origin:'https://other.test'}),req({...value,accountId:other}),req({...value,user_id:other}),req({...value,telegramPhone:'bad'}),new Request('https://pulso.test/api/account-profile?user_id='+other)])assert.ok((await route(input,env)).status>=400);
 assert.equal(calls,0);assert.equal((await createAccountProfileRouter({auth:async()=>Response.json({token:null}),fetcher:async()=>{calls++;}})(new Request('https://pulso.test/api/account-profile'),env)).status,401);assert.equal(calls,0);
});
test('profile reads only its authenticated subject and returns no token or unrelated data',async()=>{
 let captured;const route=createAccountProfileRouter({auth,fetcher:async(url,options)=>{captured={url:new URL(url),options};return Response.json([{user_id:id,telegram_phone:'+12025550100',revision:2}]);}});
 const response=await route(new Request('https://pulso.test/api/account-profile'),env);
 assert.deepEqual(await response.json(),{accountId:id,telegramPhone:'+12025550100',revision:2});assert.equal(captured.url.searchParams.get('user_id'),'eq.'+id);assert.equal(captured.options.headers.Authorization,'Bearer '+token);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Authorization'),null);
});
test('profile insert is an idempotent own-row insert and update uses the exact revision',async()=>{
 const calls=[];const route=createAccountProfileRouter({auth,fetcher:async(url,options)=>{calls.push({url:new URL(url),options,body:JSON.parse(options.body)});return Response.json([{user_id:id,telegram_phone:value.telegramPhone,revision:2}]);}});
 assert.equal((await route(req(value),env)).status,200);assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].body.user_id,id);assert.match(calls[0].options.headers.Prefer,/ignore-duplicates/);assert.equal(calls[0].url.searchParams.has('user_id'),false);
 assert.equal((await route(req({...value,revision:1}),env)).status,200);assert.equal(calls[1].options.method,'PATCH');assert.equal(calls[1].url.searchParams.get('revision'),'eq.1');assert.equal(calls[1].body.revision,2);
});
test('a stale update is not retried or reported as saved; upstream foreign rows are rejected',async()=>{
 let calls=0;const route=createAccountProfileRouter({auth,fetcher:async()=>{calls++;return Response.json([]);}});assert.equal((await route(req({...value,revision:1}),env)).status,409);assert.equal(calls,1);
 const foreign=createAccountProfileRouter({auth,fetcher:async()=>Response.json([{user_id:other,telegram_phone:value.telegramPhone,revision:1}])});assert.equal((await foreign(new Request('https://pulso.test/api/account-profile'),env)).status,503);
});
test('profile deadline prevents a late token response from starting a write',async()=>{
 let release,writes=0;const route=createAccountProfileRouter({timeoutMs:5,auth:()=>new Promise(resolve=>{release=resolve;}),fetcher:async()=>{writes++;return Response.json([]);}});
 assert.equal((await route(req(value),env)).status,503);release(Response.json({token}));await new Promise(resolve=>setTimeout(resolve,5));assert.equal(writes,0);
});
test('oversized and never-ending profile bodies are bounded',async()=>{
 const route=createAccountProfileRouter({auth,timeoutMs:10});assert.equal((await route(req({...value,padding:'x'.repeat(2000)}),env)).status,400);
 const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}});const request=new Request('https://pulso.test/api/account-profile',{method:'PUT',headers:{Origin:'https://pulso.test','Content-Type':'application/json'},body:stream,duplex:'half'});assert.equal((await route(request,env)).status,503);
});
test('profile carries auth cookies through account mismatch, CAS conflict and auth rejection',async()=>{
 const cookie='pulso=; Path=/; Max-Age=0; HttpOnly';
 for(const [authStatus,input,status,code] of [[200,{...value,accountId:other},409,'ACCOUNT_CHANGED'],[200,value,409,'PROFILE_CHANGED'],[401,value,401,'SIGN_IN_REQUIRED']]){
  const route=createAccountProfileRouter({
   auth:async()=>Response.json({token},{status:authStatus,headers:{'Set-Cookie':cookie}}),
   fetcher:async()=>Response.json([]),
  });
  const response=await route(req(input),env);
  assert.equal(response.status,status);
  assert.deepEqual(await response.json(),{code});
  assert.deepEqual(response.headers.getSetCookie(),[cookie]);
 }
});

test('write limit uses the Neon token subject across IPs and excludes reads and unconfirmed accounts',async()=>{
 const keys=[];
 const limitedEnv={...env,PULSO_ACCOUNT_WRITE_LIMIT:{limit:async({key})=>{keys.push(key);return {success:false};}}};
 const route=createAccountProfileRouter({auth,fetcher:async(_url,{method})=>{
  assert.equal(method,'GET');
  return Response.json([]);
 }});
 for(const ip of ['192.0.2.1','192.0.2.2']){
  const response=await route(req({...value,accountId:id.toUpperCase()},{'CF-Connecting-IP':ip,'Authorization':'Bearer ignored'}),limitedEnv);
  assert.equal(response.status,429);
  assert.equal(response.headers.get('Retry-After'),'60');
  assert.deepEqual(await response.json(),{code:'RATE_LIMITED'});
 }
 assert.equal((await route(req({...value,accountId:other}),limitedEnv)).status,409);
 assert.equal((await route(new Request('https://pulso.test/api/account-profile'),limitedEnv)).status,200);
 const anonymous=createAccountProfileRouter({auth:async()=>Response.json({}, {status:401})});
 assert.equal((await anonymous(req(value),limitedEnv)).status,401);
 assert.deepEqual(keys,[id,id]);
});
