import {readBoundedJson} from '../../src/accounts/bounded-body.mjs';
import {libraryUuid} from '../../src/accounts/library-document.mjs';
import {accountAuth} from './accounts.mjs';
import {clientIp,isRateLimited,rateLimitHeaders} from './rate-limit.mjs';

// The relay returns only playlist metadata needed by the importer. It never
// exposes video IDs, upstream error bodies, visitor cookies, or the API key.
const MAX_ITEMS=1500;
const MAX_PAGES=30;
const MAX_BODY=512*1024;
const API='https://www.googleapis.com/youtube/v3/';
const HIDDEN=new Set(['Deleted video','Private video']);
const baseHeaders={
 'Cache-Control':'no-store',
 'Content-Type':'application/json',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
};
const reasonSet=new Set(['quotaExceeded','dailyLimitExceeded','rateLimitExceeded']);

const uuid=value=>typeof value==='string'&&libraryUuid(value.toLowerCase());
const cancel=response=>{void response?.body?.cancel().catch(()=>{});};

function response(body,status,cookies=[],extra={}){
 const headers=new Headers({...baseHeaders,...extra});
 for(const cookie of cookies)headers.append('Set-Cookie',cookie);
 return new Response(JSON.stringify(body),{status,headers});
}

function tokenSubject(token){
 if(typeof token!=='string'||token.length>16384)return null;
 try{
  const payload=token.split('.')[1];
  if(!payload)return null;
  const {sub}=JSON.parse(atob(payload.replaceAll('-','+').replaceAll('_','/')));
  return uuid(sub)?sub.toLowerCase():null;
 }catch{return null;}
}

class GoogleError extends Error{
 constructor(status,reason){super('google-upstream');this.status=status;this.reason=reason;}
}

function googleReason(body){
 const errors=body?.error?.errors;
 if(!Array.isArray(errors))return '';
 const reasons=errors.map(item=>item?.reason).filter(value=>typeof value==='string');
 return reasons.find(reason=>reason==='playlistNotFound')??reasons.find(reason=>reasonSet.has(reason))??reasons[0]??'';
}

function upstreamFailure(error,cookies){
 if(error instanceof GoogleError){
  if(error.status===404&&error.reason==='playlistNotFound')return response({error:'not-found'},404,cookies);
  if(error.status===403&&reasonSet.has(error.reason))return response({error:'quota'},429,cookies,rateLimitHeaders);
  if(error.status===403)return response({error:'private'},403,cookies);
 }
 return response({error:'unavailable'},502,cookies);
}

async function google(fetcher,path,params,key,signal,pageTimeoutMs){
 const url=new URL(path,API);
 for(const [name,value] of Object.entries({...params,key}))url.searchParams.set(name,value);
 const pageAbort=new AbortController();
 const abortPage=()=>pageAbort.abort(signal.reason);
 if(signal.aborted)abortPage();
 else signal.addEventListener('abort',abortPage,{once:true});
 const timer=setTimeout(()=>pageAbort.abort(new Error('page-timeout')),pageTimeoutMs);
 try{
  const result=await fetcher(url.href,{
   signal:pageAbort.signal,
   redirect:'manual',
   credentials:'omit',
   headers:{Accept:'application/json'},
  });
  let body;
  try{body=await readBoundedJson(result,MAX_BODY,pageAbort.signal);}
  catch(error){cancel(result);throw error;}
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('google-format');
  if(!result.ok)throw new GoogleError(result.status,googleReason(body));
  return body;
 }finally{
  clearTimeout(timer);
  signal.removeEventListener('abort',abortPage);
 }
}

/**
 * Read one public YouTube playlist after authenticating a Pulso account.
 * The legacy third positional fetcher remains accepted for existing callers.
 */
export async function youtubePlaylist(request,env,options={}){
 const {fetcher=fetch,auth=accountAuth,timeoutMs=25000,pageTimeoutMs=10000}=
  typeof options==='function'?{fetcher:options}:options;
 const url=new URL(request.url);
 if(request.method!=='GET')return response({error:'method'},405);
 const origin=request.headers.get('Origin');
 if(origin!==null&&origin!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')
  return response({error:'forbidden'},403);
 const params=[...url.searchParams.keys()];
 const id=url.searchParams.get('list')??'';
 if(params.length!==1||params[0]!=='list'||![...url.searchParams.values()][0]||
  !/^[A-Za-z0-9_-]{10,64}$/.test(id))return response({error:'invalid'},400);

 const controller=new AbortController(),signal=controller.signal;
 let cookies=[],timer;
 const onAbort=()=>controller.abort(request.signal.reason);
 if(request.signal.aborted)onAbort();
 else request.signal.addEventListener('abort',onAbort,{once:true});
 const unavailable=()=>response({error:'unavailable'},502,cookies);
 async function run(){
  const cookie=request.headers.get('Cookie');
  const headers=new Headers({Origin:url.origin});
  if(cookie)headers.set('Cookie',cookie);
  const authorization=await auth(new Request(url.origin+'/api/account-auth/token',{headers,signal}),env);
  cookies=authorization?.headers.getSetCookie?.()??[];
  if(!authorization?.ok){
   cancel(authorization);
   return authorization?.status===401
    ?response({error:'sign-in-required'},401,cookies)
    :response({error:'unavailable'},503,cookies);
  }
  let authorized;
  try{authorized=await readBoundedJson(authorization,16384,signal);}
  catch{return unavailable();}
  const subject=tokenSubject(authorized?.token);
  if(!subject)return response({error:'sign-in-required'},401,cookies);

  if(!env?.PULSO_SPOTIFY_LIMIT)return response({error:'unavailable'},503,cookies);
  let limited;
  try{
   const [userLimited,ipLimited]=await Promise.all([
    isRateLimited(env?.PULSO_SPOTIFY_LIMIT,'youtube:user:'+subject),
    isRateLimited(env?.PULSO_SPOTIFY_LIMIT,'youtube:ip:'+(clientIp(request)??'unknown')),
   ]);
   limited=userLimited||ipLimited;
  }catch{return response({error:'unavailable'},503,cookies);}
  if(limited)return response({error:'rate-limited'},429,cookies,rateLimitHeaders);

  const key=typeof env?.YOUTUBE_API_KEY==='string'?env.YOUTUBE_API_KEY.trim():'';
  if(!key)return response({error:'not-configured'},503,cookies);
  if(signal.aborted)return unavailable();

  const items=[];
  let pageToken='',total=null,scanned=0,pageCount=0;
  do{
   const page=await google(fetcher,'playlistItems',{
    part:'snippet',maxResults:'50',playlistId:id,...(pageToken?{pageToken}:{})
   },key,signal,pageTimeoutMs);
   if(!Array.isArray(page.items))throw Error('google-format');
   if(page.pageInfo!==undefined){
    if(!page.pageInfo||typeof page.pageInfo!=='object'||Array.isArray(page.pageInfo)||
     page.pageInfo.totalResults!==undefined&&(!Number.isSafeInteger(page.pageInfo.totalResults)||page.pageInfo.totalResults<0))
     throw Error('google-format');
    total=page.pageInfo.totalResults??total;
   }
   for(const item of page.items){
    if(scanned>=MAX_ITEMS)break;
    scanned++;
    if(!item||typeof item!=='object'||!item.snippet||typeof item.snippet!=='object'||Array.isArray(item.snippet))
     throw Error('google-format');
    const {title,videoOwnerChannelTitle:channel}=item.snippet;
    if(typeof title!=='string')throw Error('google-format');
    if(!title.trim()||HIDDEN.has(title))continue;
    items.push({title:title.slice(0,300),channel:typeof channel==='string'?channel.slice(0,300):''});
   }
   if(page.nextPageToken!==undefined&&typeof page.nextPageToken!=='string')throw Error('google-format');
   pageToken=page.nextPageToken??'';
   pageCount++;
   if(scanned>=MAX_ITEMS||pageCount>=MAX_PAGES)break;
  }while(pageToken);

  const listing=await google(fetcher,'playlists',{part:'snippet',id},key,signal,pageTimeoutMs);
  if(!Array.isArray(listing.items))throw Error('google-format');
  let name='';
  if(listing.items.length){
   const snippet=listing.items[0]?.snippet;
   if(!snippet||typeof snippet!=='object'||Array.isArray(snippet)||typeof snippet.title!=='string')
    throw Error('google-format');
   name=snippet.title.slice(0,120);
  }
  return response({name,total,truncated:!!pageToken,items:items.slice(0,MAX_ITEMS)},200,cookies);
 }

 const deadline=new Promise(resolve=>{
  timer=setTimeout(()=>{controller.abort(new Error('request-timeout'));resolve(unavailable());},timeoutMs);
 });
 try{
  if(signal.aborted)return unavailable();
  return await Promise.race([run().catch(error=>upstreamFailure(error,cookies)),deadline]);
 }catch{return unavailable();}
 finally{
  clearTimeout(timer);
  request.signal.removeEventListener('abort',onAbort);
 }
}
