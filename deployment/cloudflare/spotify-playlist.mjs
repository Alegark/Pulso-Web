import {readBoundedText} from '../../src/accounts/bounded-body.mjs';
import {spotifyArtworkUrl} from '../../src/library/catalog-id.ts';
import {clientIp,isRateLimited,rateLimitBody,rateLimitHeaders} from './rate-limit.mjs';

const ID=/^[A-Za-z0-9]{22}$/;
const MAX_BYTES=1024*1024;
function field(value,max=500){if(typeof value!=='string'||value.length>max)throw Error('Invalid metadata');return value;}
function entityFromEmbed(html){
 if(new TextEncoder().encode(html).length>MAX_BYTES)throw Error('Oversize');
 const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>/(?:^|\s)id\s*=\s*(["'])__NEXT_DATA__\1/i.test(m[1]));
 if(scripts.length!==1)throw Error('Missing data');
 return JSON.parse(scripts[0][2])?.props?.pageProps?.state?.data?.entity;
}
export function parseSpotifyPlaylist(html){
 const entity=entityFromEmbed(html);
 if(!entity||!Array.isArray(entity.trackList)||entity.trackList.length>1000)throw Error('Invalid playlist');
 const name=field(entity.name),rows=entity.trackList.slice(0,100),tracks=[];let omitted=0;
 for(const row of rows){
  if(!row||typeof row.uri!=='string'||!/^spotify:track:[A-Za-z0-9]{22}$/.test(row.uri)||typeof row.title!=='string'||!row.title.trim()||row.title.length>500){omitted++;continue;}
  tracks.push({title:field(row.title),artists:typeof row.subtitle==='string'&&row.subtitle.length<=500?row.subtitle:'',durationMs:Number.isSafeInteger(row.duration)&&row.duration>=0&&row.duration<=86400000?row.duration:null,url:`https://open.spotify.com/track/${row.uri.slice(14)}`});
 }
 const total=Number.isSafeInteger(entity.totalTracks)&&entity.totalTracks>=entity.trackList.length?entity.totalTracks:null;
 return {name,tracks,readCount:rows.length,omitted,total,limited:entity.trackList.length>=100,complete:total!==null&&total===rows.length};
}
const reply=(body,status,headers)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
function property(html,name){
 const matches=[];
 for(const [tag] of html.matchAll(/<meta\b[^>]*>/gi)){
  const a=Object.fromEntries([...tag.matchAll(/([a-z:-]+)\s*=\s*(["'])([^"']*)\2/gi)].map(([,key,,value])=>[key.toLowerCase(),value]));
  if(a.name===name||a.property===name)matches.push(a.content);
 }
 return matches.length===1?matches[0]:null;
}
export function spotifyReleaseReference(html,id){
 if(property(html,'og:url')!==`https://open.spotify.com/track/${id}`)throw Error('Track identity');
 const album=/^https:\/\/open\.spotify\.com\/album\/([A-Za-z0-9]{22})$/.exec(property(html,'music:album')??'')?.[1];
 const position=Number(property(html,'music:album:track'));
 if(!album||!Number.isSafeInteger(position)||position<1||position>200)throw Error('Album identity');
 return {album,position,artworkUrl:spotifyArtworkUrl(property(html,'og:image'))};
}
function parseAlbum(html,releaseId){
 const entity=entityFromEmbed(html);
 if(entity?.type!=='album'||entity.id!==releaseId||entity.uri!==`spotify:album:${releaseId}`||
  !Array.isArray(entity.trackList)||entity.trackList.length>1000)throw Error('Album identity');
 const title=field(entity.title,300).trim(),artist=typeof entity.subtitle==='string'&&entity.subtitle.length<=300?entity.subtitle.trim()||null:null;
 if(!title)throw Error('Album name');
 const images=Array.isArray(entity.visualIdentity?.image)?entity.visualIdentity.image:[];
 const artworkUrl=[...images].sort((a,b)=>(Number(b?.maxWidth)||0)-(Number(a?.maxWidth)||0))
  .map(image=>spotifyArtworkUrl(image?.url)).find(Boolean);
 const tracks=new Set();
 for(const row of entity.trackList){
  if(typeof row?.uri==='string'&&/^spotify:track:[A-Za-z0-9]{22}$/.test(row.uri))tracks.add(row.uri.slice(14));
 }
 return {title,artist,artworkUrl,tracks};
}
function trackRelease(id,reference,album){
 if(!album.tracks.has(id))throw Error('Album track identity');
 const {title,artist}=album,artworkUrl=album.artworkUrl??reference.artworkUrl;
 return {source:'spotify',releaseId:reference.album,trackId:id,position:reference.position,title,artist,...(artworkUrl?{artworkUrl}:{})};
}
export function parseSpotifyRelease(html,id,reference){
 return trackRelease(id,reference,parseAlbum(html,reference.album));
}
async function spotifyHtml(fetcher,path,signal,onResponse){
 const upstream=await fetcher('https://open.spotify.com'+path,{redirect:'manual',signal,credentials:'omit',headers:{Accept:'text/html'}});
 onResponse(upstream.status);
 if(!upstream.ok||!upstream.headers.get('content-type')?.includes('text/html')){
  void upstream.body?.cancel().catch(()=>{});throw Error('Unavailable');
 }
 return readBoundedText(upstream,MAX_BYTES,signal,false);
}

class SpotifyError extends Error{
 constructor(reason,upstreamStatus){super(reason);this.reason=reason;this.upstreamStatus=upstreamStatus;}
}
function deadline(signal,run){
 const controller=new AbortController(),abort=()=>controller.abort();let stop;
 const expired=new Promise((_,reject)=>{
  stop=()=>reject(new SpotifyError('aborted'));
  controller.signal.addEventListener('abort',stop,{once:true});
 });
 signal?.addEventListener('abort',abort,{once:true});
 if(signal?.aborted)abort();
 const timer=setTimeout(abort,8000);
 return Promise.race([expired,run(controller.signal)]).finally(()=>{
  clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',stop);
  controller.abort();
 });
}
async function readMetadata(fetcher,path,signal,parse){
 let stage='network',upstreamStatus;
 try{
  const html=await spotifyHtml(fetcher,path,signal,status=>{stage='upstream-response';upstreamStatus=status;});
  stage='metadata-format';return parse(html);
 }catch{
  throw new SpotifyError(signal.aborted?'aborted':stage,stage==='upstream-response'?upstreamStatus:undefined);
 }
}
async function handleSpotify(request,release,limiter,load){
 const url=new URL(request.url),match=(release?/^\/api\/spotify-track\/([A-Za-z0-9]{22})$/:/^\/api\/spotify-playlist\/([A-Za-z0-9]{22})$/).exec(url.pathname);
 if(!match||!ID.test(match[1])||url.search)return reply({error:'invalid-request'},400);
 if(request.method!=='GET')return reply({error:'method'},405);
 if((request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return reply({error:'origin'},403);
 try{
  if(await isRateLimited(limiter,clientIp(request)??'unknown'))return reply(rateLimitBody,429,rateLimitHeaders);
  return reply(await load(match[1]),200);
 }
 catch(error){return reply({error:'unavailable',reason:error instanceof SpotifyError?error.reason:'metadata-format',upstreamStatus:error?.upstreamStatus},502);}
}

const metadataTtl=24*60*60*1000;
function metadataCache(maxEntries,clock){
 const cache=new Map(),inflight=new Map();
 return async (key,load,ctx)=>{
  const hit=cache.get(key);
  if(hit){
   cache.delete(key);
   if(hit.expires>clock()){cache.set(key,hit);return hit.value;}
  }
  if(inflight.has(key))return inflight.get(key);
  if(inflight.size>=16)throw new SpotifyError('network');
  const work=deadline(undefined,load).then(value=>{
   cache.set(key,{value,expires:clock()+metadataTtl});
   if(cache.size>maxEntries)cache.delete(cache.keys().next().value);
   return value;
  }).finally(()=>inflight.delete(key));
  inflight.set(key,work);
  // Only parsed public metadata crosses request contexts. Keep I/O in its
  // original context even if that visitor disconnects while others are waiting.
  ctx?.waitUntil(work.catch(()=>{}));
  return work;
 };
}
export function createSpotifyTrackRelease({fetcher=fetch,clock=Date.now}={}){
 const tracks=metadataCache(512,clock),albums=metadataCache(64,clock);
 return (request,ctx,limiter)=>handleSpotify(request,true,limiter,id=>deadline(request.signal,async visitorSignal=>{
  if(visitorSignal.aborted)throw new SpotifyError('aborted');
  return tracks(id,async signal=>{
   const reference=await readMetadata(fetcher,'/track/'+id,signal,html=>spotifyReleaseReference(html,id));
   if(signal.aborted)throw new SpotifyError('aborted');
   const album=await albums(reference.album,albumSignal=>
    readMetadata(fetcher,'/embed/album/'+reference.album,albumSignal,html=>parseAlbum(html,reference.album)),ctx);
   return trackRelease(id,reference,album);
  },ctx);
 }));
}
const trackReleaseRouter=createSpotifyTrackRelease();
export const spotifyPlaylist=(request,fetcher=fetch,limiter)=>handleSpotify(request,false,limiter,id=>
 deadline(request.signal,signal=>readMetadata(fetcher,'/embed/playlist/'+id,signal,parseSpotifyPlaylist)));
export const spotifyTrackRelease=(request,fetcher,ctx,limiter)=>(fetcher?createSpotifyTrackRelease({fetcher}):trackReleaseRouter)(request,ctx,limiter);
