import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountAuthRouter} from '../../deployment/cloudflare/accounts.mjs';
const env={PULSO_NEON_AUTH_URL:'https://ep-own-test.neonauth.us-east-2.aws.neon.build/neondb/auth',PULSO_AUTH_COOKIE_SECRET:'test-only-secret-not-a-real-credential-123456789',PULSO_AUTH_GOOGLE_ENABLED:'true'};
const post=(operation,value,headers={})=>new Request('https://pulso.test/api/account-auth/'+operation,{method:'POST',headers:{Origin:'https://pulso.test','Content-Type':'application/json',...headers},body:JSON.stringify(value)});
test('configuration fails closed for missing or non-Neon backend and reveals only capabilities',async()=>{const route=createAccountAuthRouter();for(const e of [{},{...env,PULSO_NEON_AUTH_URL:'https://attacker.test/auth'},{...env,PULSO_AUTH_COOKIE_SECRET:'short'}])assert.deepEqual(await (await route(new Request('https://pulso.test/account-config.json'),e)).json(),{version:1,enabled:false,google:false});const r=await route(new Request('https://pulso.test/account-config.json'),env);assert.deepEqual(await r.json(),{version:1,enabled:true,google:true});assert.equal(r.headers.get('Cache-Control'),'no-store');});
test('closed routes, methods, cross-origin, query and malformed requests never reach Neon',async()=>{let count=0;const route=createAccountAuthRouter({proxy:async()=>{count++;return Response.json({});}});const requests=[new Request('https://pulso.test/api/account-auth/admin/list-users'),new Request('https://pulso.test/api/account-auth/sign-up/email'),post('sign-out',{}, {Origin:'https://attacker.test'}),post('sign-out',{}, {'Sec-Fetch-Site':'cross-site'}),post('sign-in/email',{email:'bad',password:'12345678'}),post('sign-in/email',{email:'own@example.test',password:'short'}),post('sign-in/social',{provider:'github'}),new Request('https://pulso.test/api/account-auth/token?url=https://attacker.test'),new Request('https://pulso.test/api/account-auth/sign-out',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})];for(const request of requests)assert.ok((await route(request,env)).status>=400);assert.equal(count,0);});
test('proxy accepts only the intended payload, origin and Neon cookies; no visitor identity forwarding',async()=>{let capture;const route=createAccountAuthRouter({proxy:async config=>{capture=config;return new Response('{}',{headers:{'Set-Cookie':'__Secure-neon-auth.session_token=own-test; HttpOnly; Secure; SameSite=Lax; Path=/','Cache-Control':'public, max-age=3600','X-Private':'private'}});}});const r=await route(post('sign-up/email',{name:' Persona ',email:'own@example.test',password:'test-only-password',role:'admin',callbackURL:'https://attacker.test'},{Cookie:'__Secure-neon-auth.session_token=own-test','Authorization':'Bearer private','Referer':'https://private.test','CF-Connecting-IP':'192.0.2.1'}),env);assert.equal(r.status,200);assert.equal(capture.path,'sign-up/email');assert.deepEqual(JSON.parse(await capture.request.text()),{name:'Persona',email:'own@example.test',password:'test-only-password',callbackURL:'https://pulso.test/?pulso-account=callback'});for(const h of ['Authorization','Referer','CF-Connecting-IP'])assert.equal(capture.request.headers.get(h),null);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('X-Private'),null);assert.match(r.headers.get('Set-Cookie'),/HttpOnly/);assert.equal(capture.sameSite,'lax');assert.equal(capture.domain,'pulso.test');});
test('Google is unavailable until own credentials are explicitly enabled',async()=>{let called=false;const route=createAccountAuthRouter({proxy:async()=>{called=true;return Response.json({});}});assert.equal((await route(post('sign-in/social',{provider:'google'}),{...env,PULSO_AUTH_GOOGLE_ENABLED:'false'})).status,503);assert.equal(called,false);});
test('upstream failure and never-settling operation have a deadline, no retry and no raw error',async()=>{let count=0;const route=createAccountAuthRouter({timeoutMs:10,proxy:()=>{count++;return new Promise(()=>{});}});const r=await route(post('sign-out',{}),env);assert.equal(r.status,503);assert.deepEqual(await r.json(),{code:'AUTH_UNAVAILABLE'});assert.equal(count,1);});
test('oversized requests and responses are rejected without partial auth content',async()=>{let count=0;const route=createAccountAuthRouter({proxy:async()=>{count++;return new Response('x'.repeat(65537));}});assert.equal((await route(post('sign-up/email',{email:'own@example.test',name:'x'.repeat(9000),password:'test-only-password'}),env)).status,400);assert.equal(count,0);assert.equal((await route(post('sign-out',{}),env)).status,503);assert.equal(count,1);});
test('actual Neon proxy rewrites secure cookies to the same site and forwards no unrelated cookies',async()=>{
 const original=globalThis.fetch,calls=[],now=new Date().toISOString();
 const data={session:{id:'own-test-session',token:'own-test-token',userId:'own-test-user',expiresAt:new Date(Date.now()+3600000).toISOString(),createdAt:now,updatedAt:now},user:{id:'own-test-user',name:'Persona sintética',email:'own@example.test',emailVerified:true,createdAt:now,updatedAt:now}};
 globalThis.fetch=async(url,options)=>{calls.push({url:String(url),headers:new Headers(options?.headers)});return String(url).includes('/sign-in/email')?new Response(JSON.stringify({token:'own-test-token',user:data.user}),{headers:{'Content-Type':'application/json','Set-Cookie':'__Secure-neon-auth.session_token=own-test-token; Path=/; HttpOnly; Secure; SameSite=None; Partitioned'}}):Response.json(data);};
 try{const r=await createAccountAuthRouter()(post('sign-in/email',{email:'own@example.test',password:'test-only-password'},{Cookie:'unrelated=private; __Secure-neon-auth.session_token=old-test-token'}),env);assert.equal(r.status,200);const cookies=r.headers.getSetCookie();assert.ok(cookies.length>=1);assert.ok(cookies.every(c=>!c.includes('Partitioned')&&c.includes('SameSite=Lax')&&c.includes('Secure')));assert.match(cookies[0],/HttpOnly/);assert.match(cookies[0],/Domain=pulso.test/);assert.ok(calls.every(c=>new URL(c.url).origin===new URL(env.PULSO_NEON_AUTH_URL).origin));assert.ok(calls.every(c=>!c.headers.get('cookie')?.includes('unrelated')));}
 finally{globalThis.fetch=original;}
});
test('actual Neon proxy cannot swallow an OAuth verifier behind an older session cookie',async()=>{
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url)=>{calls.push(String(url));return Response.json(null);};
 try{const request=new Request('https://pulso.test/api/account-auth/get-session?neon_auth_session_verifier=TESTONLY-verifier',{headers:{Cookie:'__Secure-neon-auth.session_token=older-test-token'}});const r=await createAccountAuthRouter()(request,env);assert.equal(r.status,200);assert.equal(calls.length,1);assert.equal(new URL(calls[0]).searchParams.get('neon_auth_session_verifier'),'TESTONLY-verifier');assert.equal(new URL(calls[0]).searchParams.get('disableCookieCache'),'true');}
 finally{globalThis.fetch=original;}
});

const turnstileSiteKey='1x00000000000000000000AA';
const passingSecret='1x0000000000000000000000000000000AA';
const failingSecret='2x0000000000000000000000000000000AA';
const spentSecret='3x0000000000000000000000000000000AA';
const dummyToken='XXXX.DUMMY.TOKEN.XXXX';
const signIn={email:'own@example.test',password:'test-only-password'};
const protectedOperations=[
 ['sign-up/email','sign-up',{...signIn,name:'Persona de prueba'}],
 ['email-otp/send-verification-otp','verify-email',{email:signIn.email,type:'email-verification'}],
 ['request-password-reset','password-reset',{email:signIn.email}],
 ['email-otp/request-password-reset','password-reset',{email:signIn.email}],
];
const activeTurnstile={...env,PULSO_TURNSTILE_SITE_KEY:turnstileSiteKey,PULSO_TURNSTILE_SECRET:passingSecret};

test('opaque limiter decisions separate IP-based email and login budgets and stop upstream work',async()=>{
 const emailKeys=[],attemptKeys=[];
 const limiter=keys=>({limit:async({key})=>{keys.push(key);return {success:false};}});
 const limitedEnv={...activeTurnstile,PULSO_AUTH_EMAIL_LIMIT:limiter(emailKeys),PULSO_AUTH_ATTEMPT_LIMIT:limiter(attemptKeys)};
 const route=createAccountAuthRouter({proxy:()=>assert.fail('Neon'),siteverify:()=>assert.fail('Siteverify')});
 for(const [operation,,body] of [...protectedOperations,['sign-in/email',null,signIn]]){
  const response=await route(post(operation,body,{'CF-Connecting-IP':'192.0.2.5','X-Forwarded-For':'198.51.100.1'}),limitedEnv);
  assert.equal(response.status,429);
  assert.equal(response.headers.get('Retry-After'),'60');
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(await response.json(),{code:'RATE_LIMITED'});
 }
 assert.deepEqual(emailKeys,Array(4).fill('192.0.2.5'));
 assert.deepEqual(attemptKeys,['192.0.2.5']);
});

test('Turnstile activation needs both keys, exposes just the sitekey, and never challenges login or code submission',async()=>{
 const route=createAccountAuthRouter({proxy:async()=>Response.json({}),siteverify:()=>assert.fail('Siteverify')});
 const config=new Request('https://pulso.test/account-config.json');
 for(const disabled of [env,{...env,PULSO_TURNSTILE_SITE_KEY:turnstileSiteKey},{...env,PULSO_TURNSTILE_SECRET:passingSecret}]){
  assert.deepEqual(await (await route(config,disabled)).json(),{version:1,enabled:true,google:true});
  assert.equal((await route(post('sign-up/email',{...signIn,name:'Persona'}),disabled)).status,200);
 }
 assert.deepEqual(await (await route(config,activeTurnstile)).json(),{version:1,enabled:true,google:true,turnstileSiteKey});
 assert.equal((await route(post('sign-in/email',signIn),activeTurnstile)).status,200);
 assert.equal((await route(post('email-otp/verify-email',{email:signIn.email,otp:'123456'}),activeTurnstile)).status,200);
 const result=await route(post('sign-up/email',{...signIn,name:'Persona'}),activeTurnstile);
 assert.equal(result.status,400);
 assert.deepEqual(await result.json(),{code:'TURNSTILE_REQUIRED'});
});

test('Siteverify sends the Cloudflare IP and checks success, action, hostname, and one-use tokens',async()=>{
 for(const [operation,action,body] of protectedOperations){
  let proxyCalls=0,siteCalls=0;
  const route=createAccountAuthRouter({
   proxy:async({request})=>{
    proxyCalls++;
    assert.equal(request.headers.get('X-Pulso-Turnstile'),null);
    assert.ok(!(await request.text()).includes(dummyToken));
    return Response.json({});
   },
   siteverify:async(url,options)=>{
    siteCalls++;
    assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(options.method,'POST');
    assert.equal(options.redirect,'manual');
    const input=JSON.parse(options.body);
    assert.deepEqual(input,{secret:input.secret,response:dummyToken,remoteip:'2001:db8::1'});
    if(input.secret===failingSecret)return Response.json({success:false,'error-codes':['invalid-input-response']});
    if(input.secret===spentSecret)return Response.json({success:false,'error-codes':['timeout-or-duplicate']});
    assert.equal(input.secret,passingSecret);
    // Cloudflare dummy success itself has no action and returns example.com.
    // Supply production-shaped fields only after covering that exact response.
    if(siteCalls===1)return Response.json({success:true,hostname:'example.com'});
    if(siteCalls===2)return Response.json({success:true,hostname:'pulso.test',action:'wrong-action'});
    return Response.json({success:true,hostname:'pulso.test',action});
   },
  });
  for(const [secret,expected] of [[passingSecret,400],[passingSecret,400],[passingSecret,200],[failingSecret,400],[spentSecret,400]]){
   const request=post(operation,{...body,turnstileToken:'ignored'},{'X-Pulso-Turnstile':dummyToken,'CF-Connecting-IP':'2001:db8::1'});
   const response=await route(request,{...activeTurnstile,PULSO_TURNSTILE_SECRET:secret});
   assert.equal(response.status,expected);
   if(expected===400)assert.deepEqual(await response.json(),{code:'TURNSTILE_INVALID'});
  }
  assert.equal(proxyCalls,1);
  assert.equal(siteCalls,5);
 }
});

test('Siteverify network, HTTP, malformed body and deadline errors fail closed',async()=>{
 const [operation,,body]=protectedOperations[0];
 for(const siteverify of [
  async()=>{throw new Error('Synthetic network error');},
  async()=>new Response('',{status:503}),
  async()=>new Response('not JSON'),
  async()=>Response.json({success:false,'error-codes':['internal-error']}),
  async(_url,{signal})=>new Promise((_,reject)=>{
   const keepAlive=setTimeout(()=>reject(Error('Timeout was not applied')),500);
   signal.addEventListener('abort',()=>{clearTimeout(keepAlive);reject(signal.reason);},{once:true});
  }),
 ]){
  const route=createAccountAuthRouter({siteverify,siteverifyTimeoutMs:20,proxy:()=>assert.fail('Neon')});
  const response=await route(post(operation,body,{'X-Pulso-Turnstile':dummyToken}),activeTurnstile);
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{code:'TURNSTILE_UNAVAILABLE'});
 }
});
