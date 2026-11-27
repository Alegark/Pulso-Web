// GET /api/youtube-playlist?list=<id>: titles and channel names of a public/unlisted YouTube
// playlist through the official YouTube Data API v3 (the browser cannot read youtube.com).
// Needs the YOUTUBE_API_KEY secret. Never returns video IDs, URLs, the key or visitor data.
const MAX_ITEMS=1500;
const API='https://www.googleapis.com/youtube/v3';
const HIDDEN=new Set(['Deleted video','Private video']);
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Type':'application/json'};
const reply=(body,status,extra={})=>new Response(JSON.stringify(body),{status,headers:{...headers,...extra}});

async function google(fetcher,path,params,key){
 const response=await fetcher(`${API}/${path}?${new URLSearchParams({...params,key})}`,{signal:AbortSignal.timeout(10000),redirect:'manual',headers:{Accept:'application/json'}});
 const body=await response.json().catch(()=>null);
 if(!response.ok){const reason=body?.error?.errors?.[0]?.reason??'';const error=new Error(reason||String(response.status));error.status=response.status;error.reason=reason;throw error;}
 return body;
}

export async function youtubePlaylist(request,env,fetcher=fetch){
 const url=new URL(request.url);
 if(request.method!=='GET')return reply({error:'method'},405);
 // Only the app itself may spend the API quota. Browsers always send this header on fetch();
 // a script that omits it is refused (spoofable by a determined caller: it raises the bar).
 if(request.headers.get('Sec-Fetch-Site')!=='same-origin'||request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)return reply({error:'forbidden'},403);
 const key=env?.YOUTUBE_API_KEY;
 if(!key)return reply({error:'not-configured'},503);
 const id=url.searchParams.get('list')??'';
 if(!/^[A-Za-z0-9_-]{10,64}$/.test(id)||[...url.searchParams.keys()].some(name=>name!=='list'))return reply({error:'bad-id'},400);
 try{
  const items=[];let pageToken,total=null;
  do{
   const page=await google(fetcher,'playlistItems',{part:'snippet',maxResults:'50',playlistId:id,...(pageToken?{pageToken}:{})},key);
   total=page.pageInfo?.totalResults??total;
   for(const item of page.items??[]){
    const title=item?.snippet?.title;
    if(typeof title!=='string'||!title.trim()||HIDDEN.has(title))continue;
    const channel=item.snippet.videoOwnerChannelTitle;
    items.push({title:title.slice(0,300),channel:typeof channel==='string'?channel.slice(0,300):''});
   }
   pageToken=page.nextPageToken;
  }while(pageToken&&items.length<MAX_ITEMS);
  let name='';
  try{const info=await google(fetcher,'playlists',{part:'snippet',id},key);name=String(info.items?.[0]?.snippet?.title??'').slice(0,120);}catch{/* The name is optional. */}
  return reply({name,total,truncated:items.length>=MAX_ITEMS&&!!pageToken,items:items.slice(0,MAX_ITEMS)},200);
 }catch(error){
  if(error.status===404)return reply({error:'not-found'},404);
  if(error.reason==='quotaExceeded'||error.reason==='rateLimitExceeded')return reply({error:'quota'},429);
  if(error.status===403||error.status===401)return reply({error:'private'},403);
  return reply({error:'upstream'},502);
 }
}
