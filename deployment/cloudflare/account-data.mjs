import {accountAuth} from './accounts.mjs';
import {readBoundedJson} from '../../src/accounts/bounded-body.mjs';
import {libraryUuid} from '../../src/accounts/library-document.mjs';

import {isRateLimited,rateLimitBody,rateLimitHeaders} from './rate-limit.mjs';

const headers={'Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const accountUuid=value=>typeof value==='string'&&libraryUuid(value.toLowerCase());
const revision=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
function dataApiEndpoint(env,table){
 const url=new URL(env.PULSO_NEON_DATA_API_URL);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!/^ep-[a-z0-9-]+\.apirest\.[a-z0-9.-]+\.neon\.(tech|build)$/.test(url.hostname)||url.pathname!=='/pulso/rest/v1')throw Error('config');
 return new URL(url.href+'/'+table);
}
function tokenSubject(token){
 if(typeof token!=='string'||token.length>16384)return null;
 try{
  const payload=token.split('.')[1];
  const {sub}=JSON.parse(atob(payload.replaceAll('-','+').replaceAll('_','/')));
  return accountUuid(sub)?sub.toLowerCase():null;
 }catch{return null;}
}
function dataRequest(target,columns,subject,token,input,values,signal){
 target.searchParams.set('select','user_id,'+columns+',revision');
 const headers={Authorization:'Bearer '+token,Accept:'application/json'};
 const init={method:'GET',headers,redirect:'manual',signal};
 if(!input||input.revision!==null)target.searchParams.set('user_id','eq.'+subject);
 if(!input)return init;
 headers['Content-Type']='application/json';
 const fields=values(input);
 if(input.revision===null){
  init.method='POST';
  target.searchParams.set('on_conflict','user_id');
  headers.Prefer='resolution=ignore-duplicates,return=representation';
  init.body=JSON.stringify({user_id:subject,...fields,revision:1});
 }else{
  init.method='PATCH';
  target.searchParams.set('revision','eq.'+input.revision);
  headers.Prefer='return=representation';
  init.body=JSON.stringify({...fields,revision:input.revision+1,updated_at:new Date().toISOString()});
 }
 return init;
}

/** The Data API verifies the auth service JWT and enforces RLS. The decoded
 * subject only selects the caller's own row and guards account switches. */
export function createAccountDataRouter({
 path,table,column,unavailableCode,conflictCode,inputMax,resultMax,parseInput,values,formatRow,
 extraHeaders,invalidInput=()=>({}),onBadWrite,
},{auth=accountAuth,fetcher=fetch,timeoutMs=15000}={}){
 return async(request,env)=>{
  const url=new URL(request.url);if(url.pathname!==path)return null;
  let cookies=[];
  const respond=(body,status=200,additionalHeaders)=>{
   const out=new Headers({...headers,...extraHeaders,...additionalHeaders});
   for(const cookie of cookies)out.append('Set-Cookie',cookie);
   return new Response(JSON.stringify(body),{status,headers:out});
  };
  const unavailable=()=>respond({code:unavailableCode},503);
  const signIn=()=>respond({code:'SIGN_IN_REQUIRED'},401);
  const writing=request.method==='PUT';
  if(!writing&&request.method!=='GET')return respond({},405);
  const origin=request.headers.get('Origin');
  if(url.search||request.headers.get('Sec-Fetch-Site')==='cross-site'||(origin!==null||writing)&&origin!==url.origin)return respond({},403);
  const abort=new AbortController(),signal=abort.signal;let timer;
  async function run(){
   const target=dataApiEndpoint(env,table);let input;
   if(writing){
    if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')??''))return respond({},415);
    try{
     input=await readBoundedJson(request,inputMax,signal);
     if(!accountUuid(input?.accountId)||input.revision!==null&&(!revision(input.revision)||input.revision===2147483647))throw Error('input');
     input=parseInput(input);
    }catch(error){return respond(invalidInput(error),400);}
   }
   if(signal.aborted)return unavailable();
   const headers=new Headers({Origin:url.origin});
   const cookie=request.headers.get('Cookie');if(cookie)headers.set('Cookie',cookie);
   const authorization=await auth(new Request(url.origin+'/api/account-auth/token',{headers,signal}),env);
   cookies=authorization?.headers.getSetCookie()??[];
   if(!authorization?.ok){
    void authorization?.body?.cancel().catch(()=>{});
    return authorization?.status===401?signIn():unavailable();
   }
   const {token}=await readBoundedJson(authorization,16384,signal)??{};
   const subject=tokenSubject(token);
   if(!subject)return signIn();
   if(input&&input.accountId.toLowerCase()!==subject)return respond({code:'ACCOUNT_CHANGED'},409);
   // The token came from the same-origin proxy's Neon session exchange, never
   // from a visitor header. Check the subject before spending any write quota.
   if(writing&&await isRateLimited(env.PULSO_ACCOUNT_WRITE_LIMIT,subject))return respond(rateLimitBody,429,rateLimitHeaders);
   if(signal.aborted)return unavailable();
   const result=await fetcher(target,dataRequest(target,column,subject,token,input,values,signal));
   if(!result.ok){
    if(writing&&result.status===400&&onBadWrite)return await onBadWrite(result,signal,respond)??unavailable();
    void result.body?.cancel().catch(()=>{});
    return result.status===401?signIn():unavailable();
   }
   const rows=await readBoundedJson(result,resultMax,signal);
   if(!Array.isArray(rows)||rows.length>1)throw Error('response');
   if(writing&&!rows.length)return respond({code:conflictCode},409);
   const row=rows[0];
   if(rows.length&&(row?.user_id!==subject||!revision(row.revision)))throw Error('response');
   return formatRow(row,subject,respond);
  }
  try{
   return await Promise.race([run(),new Promise(resolve=>{
    timer=setTimeout(()=>{resolve(unavailable());abort.abort();},timeoutMs);
   })]);
  }catch{return unavailable();}finally{clearTimeout(timer);}
 };
}
