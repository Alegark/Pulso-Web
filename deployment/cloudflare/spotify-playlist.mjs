import {spotifyArtworkUrl} from '../../src/library/catalog-id.ts';
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
const reply=(body,status)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
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
export function parseSpotifyRelease(html,id,reference){
 const entity=entityFromEmbed(html),releaseId=reference.album;
 if(entity?.type!=='album'||entity.id!==releaseId||entity.uri!==`spotify:album:${releaseId}`||
  !Array.isArray(entity.trackList)||entity.trackList.length>1000||
  !entity.trackList.some(row=>row?.uri===`spotify:track:${id}`))throw Error('Album track identity');
 const title=field(entity.title,300).trim(),artist=typeof entity.subtitle==='string'&&entity.subtitle.length<=300?entity.subtitle.trim()||null:null;
 if(!title)throw Error('Album name');
 const images=Array.isArray(entity.visualIdentity?.image)?entity.visualIdentity.image:[];
 const artworkUrl=[...images].sort((a,b)=>(Number(b?.maxWidth)||0)-(Number(a?.maxWidth)||0))
  .map(image=>spotifyArtworkUrl(image?.url)).find(Boolean)??reference.artworkUrl;
 return {source:'spotify',releaseId,trackId:id,position:reference.position,title,artist,...(artworkUrl?{artworkUrl}:{})};
}
async function spotifyHtml(fetcher,path,signal,onResponse){
 const upstream=await fetcher('https://open.spotify.com'+path,{redirect:'manual',signal,credentials:'omit',headers:{Accept:'text/html'}});
 onResponse(upstream.status);
 if(!upstream.ok||!upstream.headers.get('content-type')?.includes('text/html')||Number(upstream.headers.get('content-length'))>MAX_BYTES||!upstream.body){
  await upstream.body?.cancel().catch(()=>{});throw Error('Unavailable');
 }
 const reader=upstream.body.getReader(),decoder=new TextDecoder();let html='',bytes=0;
 try{while(true){
  const {done,value}=await reader.read();if(done)break;
  bytes+=value.byteLength;if(bytes>MAX_BYTES)throw Error('Oversize');html+=decoder.decode(value,{stream:true});
 }return html+decoder.decode();}finally{await reader.cancel().catch(()=>{});}
}
async function handleSpotify(request,fetcher,release){
 const url=new URL(request.url),match=(release?/^\/api\/spotify-track\/([A-Za-z0-9]{22})$/:/^\/api\/spotify-playlist\/([A-Za-z0-9]{22})$/).exec(url.pathname);
 if(!match||!ID.test(match[1])||url.search)return reply({error:'invalid-request'},400);
 if(request.method!=='GET')return reply({error:'method'},405);
 if((request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return reply({error:'origin'},403);
 const controller=new AbortController(),abort=()=>controller.abort();request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
 const timer=setTimeout(abort,8000);let stage='network',upstreamStatus;
 const get=async path=>{
  stage='network';
  const html=await spotifyHtml(fetcher,path,controller.signal,status=>{stage='upstream-response';upstreamStatus=status;});
  stage='metadata-format';return html;
 };
 try{
  const id=match[1];
  if(!release)return reply(parseSpotifyPlaylist(await get('/embed/playlist/'+id)),200);
  const reference=spotifyReleaseReference(await get('/track/'+id),id);
  return reply(parseSpotifyRelease(await get('/embed/album/'+reference.album),id,reference),200);
 }catch{return reply({error:'unavailable',reason:controller.signal.aborted?'aborted':stage,...(stage==='upstream-response'?{upstreamStatus}:{})},502);}finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);}
}
export const spotifyPlaylist=(request,fetcher=fetch)=>handleSpotify(request,fetcher,false);
export const spotifyTrackRelease=(request,fetcher=fetch)=>handleSpotify(request,fetcher,true);
