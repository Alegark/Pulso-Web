/** Isolated LRCLIB v2 metadata adapter. Caller must obtain consent BEFORE search
 * (including CORS preflight), debounce UI, and render strings as text only.
 * No constructor/getter IO, persistence, Telegram availability or lyrics lookup.
 */
export const MUSIC_SUGGESTIONS_ENDPOINT = 'https://lrclib.net/api/v2/search';
export const MUSIC_SUGGESTIONS_CLIENT = 'Pulso Web 0.1 (https://github.com/Alegark/Pulso-Web)';
export const MUSIC_SUGGESTIONS_LIMITS = Object.freeze({rows:20,bodyBytes:262144,chunks:8192,fieldLength:1024,queryMin:3,queryMax:160,timeoutMs:15000,intervalMs:1000,cacheSize:30,cacheMs:300000});
export type MusicSuggestion = Readonly<{id:number;trackName:string;artistName:string;albumName:string;duration:number}>;
/** Groups describe returned records only, never a complete artist/album catalog. */
export type MusicSuggestionGroups = Readonly<{
 artists:readonly Readonly<{artistName:string;tracks:readonly MusicSuggestion[]}>[];
 albums:readonly Readonly<{artistName:string;albumName:string;tracks:readonly MusicSuggestion[]}>[];
}>;
export type MusicSuggestionsResult =
 | {state:'ready';tracks:readonly MusicSuggestion[];groups:MusicSuggestionGroups;cached:boolean}
 | {state:'invalid-query'|'cancelled'|'closed'|'busy'}
 | {state:'rate-limited';retryAt:number|null}
 | {state:'unavailable';reason:'network'|'timeout'|'protocol'|'http'};
export type MusicSuggestionsRateState = Readonly<{state:'ready'|'busy'|'cooldown'|'blocked'|'closed';retryAt:number|null}>;
export type MusicSuggestionsSearchOptions = {signal?:AbortSignal;current:()=>boolean};
export type MusicSuggestionsClient = {
 search(query:string,options:MusicSuggestionsSearchOptions):Promise<MusicSuggestionsResult>;
 getRateState():MusicSuggestionsRateState;
 /** Permanently closes this instance, cancels publication and clears RAM cache. */
 close():void;
};
/** Dependency injection for isolated tests; endpoint/identity/limits cannot be overridden.
 * timeoutMs may shorten (never extend) the 15s deadline. now must be wall-clock ms. */
export type MusicSuggestionsDependencies = {fetch?:typeof fetch;now?:()=>number;timeoutMs?:number};
const own=(o:object,k:string):unknown=>{const d=Object.getOwnPropertyDescriptor(o,k);return d&&'value'in d?d.value:undefined;};
function text(value:unknown,empty=false):value is string {
 return typeof value==='string'&&(empty||value.trim().length>0)&&value.length<=1024&&!/[\u0000-\u001f\u007f]/u.test(value)&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}
export function normalizeMusicSuggestionsQuery(value:unknown):string|null {
 if(typeof value!=='string'||value.length>640)return null;
 const q=value.normalize('NFC').trim().replace(/\s+/gu,' ');
 if(!text(q)||[...q].length<3||[...q].length>160||/[\u0000-\u001f\u007f]/u.test(value)||/(?:[a-z][a-z0-9+.-]*:\/\/|www\.|^[\/@!]|\b(?:javascript|data|mailto):)/iu.test(q))return null;
 return q;
}
/** Validates only own data fields; unknown fields (including accessors) are discarded. */
export function validateMusicSuggestions(value:unknown):readonly MusicSuggestion[]|null {
 if(!Array.isArray(value)||value.length>20)return null;
 const out:MusicSuggestion[]=[],seen=new Set<number>();
 for(let i=0;i<value.length;i++){
  const row=own(value,String(i));if(!row||typeof row!=='object'||Array.isArray(row))return null;
  const id=own(row,'id'),trackName=own(row,'trackName'),artistName=own(row,'artistName'),albumName=own(row,'albumName'),duration=own(row,'duration');
  if(typeof id!=='number'||!Number.isSafeInteger(id)||id<=0||!text(trackName)||!text(artistName)||!text(albumName,true)||typeof duration!=='number'||!Number.isFinite(duration)||duration<0||duration>86400)return null;
  if(!seen.has(id)){seen.add(id);out.push(Object.freeze({id,trackName,artistName,albumName,duration}));}
 }
 return Object.freeze(out);
}
export function deriveMusicSuggestionGroups(tracks:readonly MusicSuggestion[]):MusicSuggestionGroups {
 const artists=new Map<string,{artistName:string;tracks:MusicSuggestion[]}>(),albums=new Map<string,{artistName:string;albumName:string;tracks:MusicSuggestion[]}>();
 for(const t of tracks){
  const artist=t.artistName.normalize('NFC').trim(),album=t.albumName.normalize('NFC').trim();
  if(!artists.has(artist))artists.set(artist,{artistName:t.artistName,tracks:[]});artists.get(artist)!.tracks.push(t);
  const key=JSON.stringify([artist,album]);if(album){if(!albums.has(key))albums.set(key,{artistName:t.artistName,albumName:t.albumName,tracks:[]});albums.get(key)!.tracks.push(t);}
 }
 const freeze=<T extends {tracks:MusicSuggestion[]}>(v:T)=>Object.freeze({...v,tracks:Object.freeze(v.tracks)});
 return Object.freeze({artists:Object.freeze([...artists.values()].map(freeze)),albums:Object.freeze([...albums.values()].map(freeze))});
}
function retryDeadline(raw:string|null,now:number):number|null {
 if(!raw||raw.length>128)return null;
 let delay:number;
 if(/^\d+$/.test(raw)){delay=Number(raw)*1000;}
 else if(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw)){delay=Math.max(0,Date.parse(raw)-now);}
 else return null;
 if(!Number.isFinite(delay)||delay<0||delay>604800000)return null;
 return now+delay+Math.ceil(Math.random()*Math.min(delay*.3,1000));
}
export function createMusicSuggestionsClient(deps:MusicSuggestionsDependencies={}):MusicSuggestionsClient {
 const fetcher=deps.fetch??globalThis.fetch,now=deps.now??Date.now;
 const timeout=Number.isFinite(deps.timeoutMs)?Math.max(1,Math.min(15000,deps.timeoutMs!)):15000;
 let closed=false,epoch=0,nextAt=0,blocked=false;
 type Operation={cancel:(result:MusicSuggestionsResult)=>void};let active:Operation|null=null;
 const cache=new Map<string,{at:number;tracks:readonly MusicSuggestion[]}>();
 function getRateState():MusicSuggestionsRateState {
  return {state:closed?'closed':active?'busy':blocked?'blocked':now()<nextAt?'cooldown':'ready',retryAt:blocked?null:nextAt>now()?nextAt:null};
 }
 async function search(query:string,options:MusicSuggestionsSearchOptions):Promise<MusicSuggestionsResult>{
  const generation=++epoch;active?.cancel({state:'cancelled'});
  if(closed)return {state:'closed'};
  const q=normalizeMusicSuggestionsQuery(query);if(!q)return {state:'invalid-query'};
  const current=()=>{try{return !closed&&generation===epoch&&!options.signal?.aborted&&options.current()===true;}catch{return false;}};
  if(!current())return {state:'cancelled'};
  const hit=cache.get(q);
  if(hit&&now()-hit.at>=0&&now()-hit.at<300000){cache.delete(q);cache.set(q,hit);return current()?{state:'ready',tracks:hit.tracks,groups:deriveMusicSuggestionGroups(hit.tracks),cached:true}:{state:'cancelled'};}
  if(hit)cache.delete(q);
  if(active)return {state:'busy'};
  if(blocked||now()<nextAt)return {state:'rate-limited',retryAt:blocked?null:nextAt};
  const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,response:Response|undefined;
  let terminal:MusicSuggestionsResult|undefined,resolveTerminal!:(r:MusicSuggestionsResult)=>void;
  const terminalPromise=new Promise<MusicSuggestionsResult>(r=>resolveTerminal=r);
  // Cancellation is observed immediately by callers; transport ownership persists until
  // fetch AND body cleanup actually settle (even for noncooperative injected IO).
  let cleanup:Promise<unknown>|undefined;
  function cancelBody(){if(!cleanup){try{cleanup=(reader?reader.cancel():response?.body?.cancel())??Promise.resolve();}catch{cleanup=Promise.resolve();}cleanup=cleanup.catch(()=>{});}}
  const operation:Operation={cancel(r){if(terminal)return;terminal=r;resolveTerminal(r);controller.abort();if(response)cancelBody();}};active=operation;
  const abort=()=>operation.cancel({state:'cancelled'});options.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>operation.cancel(current()?{state:'unavailable',reason:'timeout'}:{state:'cancelled'}),timeout);
  const guard=()=>{if(!current())operation.cancel({state:'cancelled'});if(terminal)throw 0;};
  nextAt=Math.max(nextAt,now()+1000);
  const work=(async():Promise<MusicSuggestionsResult>=>{
   try{
    guard();
    const url=new URL(MUSIC_SUGGESTIONS_ENDPOINT);url.searchParams.set('q',q);
    response=await fetcher(url.href,{method:'GET',headers:{Accept:'application/json','Lrclib-Client':MUSIC_SUGGESTIONS_CLIENT},credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store',signal:controller.signal});
    // Observe late throttling BEFORE publication guard; changing query cannot erase it.
    if(response.status===429||response.status===503){const deadline=retryDeadline(response.headers.get('Retry-After'),now());if(deadline===null)blocked=true;else nextAt=Math.max(nextAt,deadline);guard();return {state:'rate-limited',retryAt:blocked?null:nextAt};}
    guard();
    if(!response.ok)return {state:'unavailable',reason:'http'};
    if(response.redirected||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type')??''))return {state:'unavailable',reason:'protocol'};
    const size=response.headers.get('Content-Length');if(size!==null&&(!/^\d+$/.test(size)||Number(size)>262144))return {state:'unavailable',reason:'protocol'};
    if(!response.body)return {state:'unavailable',reason:'protocol'};
    reader=response.body.getReader();const chunks:Uint8Array[]=[];let total=0,count=0;
    while(true){guard();const chunk=await reader.read();guard();if(chunk.done)break;if(!(chunk.value instanceof Uint8Array)||++count>8192||(total+=chunk.value.byteLength)>262144)return {state:'unavailable',reason:'protocol'};chunks.push(chunk.value);}
    const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
    let tracks:readonly MusicSuggestion[]|null;
    try{tracks=validateMusicSuggestions(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}catch{return {state:'unavailable',reason:'protocol'};}
    guard();if(!tracks)return {state:'unavailable',reason:'protocol'};
    // Only the current epoch publishes to cache. No stale/aborted responses are retained.
    cache.set(q,{at:now(),tracks});while(cache.size>30)cache.delete(cache.keys().next().value!);
    return {state:'ready',tracks,groups:deriveMusicSuggestionGroups(tracks),cached:false};
   }catch{return terminal??(current()?{state:'unavailable',reason:'network'}:{state:'cancelled'});}
  })().then(result=>{
   // Preserve the first IO outcome before untrusted cancel hooks can revoke context.
   if(!terminal)terminal=result;
   cancelBody();void cleanup!.then(()=>{
    if(reader){try{reader.releaseLock();}catch{ return; }}
    if(active===operation)active=null;
   });
   return terminal;
  });
  // work's result is safe to report before asynchronous cancellation cleanup settles.
  // terminalPromise ensures an unresponsive fetch/body cannot hold the caller forever.
  try{return await Promise.race([work,terminalPromise]);}
  finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
 }
 return {search,getRateState,close(){if(closed)return;closed=true;epoch++;cache.clear();active?.cancel({state:'closed'});}};
}
