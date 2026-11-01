import {parseLyrics, type ParsedLyrics} from './lyrics-parser';

/** Isolated adapter, NOT imported by product. enabled is a caller gate, NOT consent.
 * Parent must integrate D08, scope identity and serial scheduling across operations/tabs.
 * No cache, persistence, Track writes, retry, search, rate coordinator or artwork.
 * Primary contract: https://lrclib.net/docs.txt (local research 2026-10-31).
 * Browser alternative Lrclib-Client is documented there; no fabricated homepage/contact
 * is sent in this slice. Production identification/CORS must be verified before activation.
 */
export const LRCLIB_LIMITS=Object.freeze({responseBytes:524288,responseChunks:8192,lyricsBytes:131072,cues:4000,nameCharacters:1024,nameBytes:4096,durationSeconds:3600,timeoutMs:15000,maxTimeoutMs:30000,retryAfterSeconds:604800});
export interface LrclibInput {title:string;artist:string;album?:string|null;durationSeconds?:number|null}
export interface LrclibRecord {
 readonly origin:{readonly provider:'lrclib';readonly recordId:number};
 readonly title:string;readonly artist:string;readonly album:string|null;readonly durationSeconds:number;
 readonly instrumental:boolean;readonly plainLyrics:ParsedLyrics|null;readonly syncedLyrics:ParsedLyrics|null;
}
export type FieldContrast='metadata-consistent'|'conflict'|'unknown';
export interface LrclibContrast {title:FieldContrast;artist:FieldContrast;album:FieldContrast;duration:FieldContrast}
export type LrclibResult=
 | {state:'disabled'|'missing-input'|'not-found'}
 | {state:'candidate'|'conflict'|'instrumental';record:LrclibRecord;contrast:LrclibContrast}
 | {state:'unavailable';reason:'network'|'protocol-invalid'|'timeout'|'rate-limited'|'service-unavailable';retryAfterSeconds?:number}
 | {state:'cancelled';reason:'signal'|'stale'};
export interface LrclibOptions {
 enabled:boolean;current:()=>boolean;signal?:AbortSignal;timeoutMs?:number;
 /** Trusted transport injection for Node tests only. Browser defaults to native fetch. */
 fetch?:typeof fetch;
}
const encoder=new TextEncoder();
function invalid():never {throw new Error('protocol-invalid');}
/** Inspect a fixed number of own data descriptors; never read an input getter.
 * Proxies are outside the trusted JS-caller boundary (reflection can trap/throw).
 * Unknown fields are never traversed, interpreted or copied, including lyricsfile. */
function field(value:unknown,key:string):unknown {
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return undefined;
 const d=Object.getOwnPropertyDescriptor(value,key);
 if(d&&!('value' in d))invalid();
 return d?.value;
}
function name(value:unknown):string|null {
 if(typeof value!=='string'||value.length>LRCLIB_LIMITS.nameCharacters)return null;
 if(encoder.encode(value).length>LRCLIB_LIMITS.nameBytes)return null;
 // Bound before normalize/regex; retain case, punctuation, internal whitespace and variants.
 if(/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)) {
  // Unicode regex above matches isolated surrogates only, not valid astral code points.
  return null;
 }
 const normalized=value.trim().normalize('NFC');
 return normalized&&normalized.length<=LRCLIB_LIMITS.nameCharacters&&encoder.encode(normalized).length<=LRCLIB_LIMITS.nameBytes?normalized:null;
}
function query(input:unknown):LrclibInput|null {
 try {
  const title=name(field(input,'title')),artist=name(field(input,'artist'));
  if(!title||!artist)return null;
  const album=name(field(input,'album')),duration=field(input,'durationSeconds');
  return {title,artist,...(album?{album}:{}),...(typeof duration==='number'&&Number.isFinite(duration)&&duration>=1&&duration<=LRCLIB_LIMITS.durationSeconds?{durationSeconds:duration}:{})};
 }catch{return null;}
}
function lyric(value:unknown,format:'plain'|'lrc'):ParsedLyrics|null {
 if(value===null)return null;
 if(typeof value!=='string'||value.length>LRCLIB_LIMITS.lyricsBytes||encoder.encode(value).length>LRCLIB_LIMITS.lyricsBytes)invalid();
 return parseLyrics(value,format);
}
/** Closed DTO; only documented, own fields accepted. 512KiB total decoded HTTP bytes
 * allows two 128KiB lyric fields + bounded metadata/envelope. Escaped JSON overhead
 * still counts: not every maximally escaped 128KiB field fits. Not a JS heap limit. */
export function validateLrclibRecord(value:unknown):LrclibRecord|null {
 try {
  const id=field(value,'id'),title=name(field(value,'trackName')),artist=name(field(value,'artistName'));
  const rawAlbum=field(value,'albumName'),album=name(rawAlbum),duration=field(value,'duration'),instrumental=field(value,'instrumental');
  if(typeof id!=='number'||!Number.isSafeInteger(id)||id<1||!title||!artist||typeof rawAlbum!=='string'||rawAlbum.length>LRCLIB_LIMITS.nameCharacters||encoder.encode(rawAlbum).length>LRCLIB_LIMITS.nameBytes||(rawAlbum.trim()!==''&&!album)||typeof duration!=='number'||!Number.isFinite(duration)||duration<1||duration>3600||typeof instrumental!=='boolean')return null;
  const plainLyrics=lyric(field(value,'plainLyrics'),'plain'),syncedLyrics=lyric(field(value,'syncedLyrics'),'lrc');
  if(instrumental&&(plainLyrics!==null||syncedLyrics!==null))return null;
  if(!instrumental&&(!plainLyrics||plainLyrics.kind==='absent')&&(!syncedLyrics||syncedLyrics.kind==='absent'))return null;
  // Keep original spelling for display. Comparison alone uses trim+NFC.
  return {origin:{provider:'lrclib',recordId:id},title:field(value,'trackName') as string,artist:field(value,'artistName') as string,album:album?rawAlbum as string:null,durationSeconds:duration,instrumental,plainLyrics,syncedLyrics};
 }catch{return null;}
}
/** Pure, qualitative comparison. Exact trim+NFC, case-sensitive; no accent/case
 * folding, live/remix removal or fuzzy match. ±2s is consonance, NOT recognition.
 * Unknown album/duration stay unknown; GET supplies one candidate, never a release ID. */
export function contrastLrclib(input:LrclibInput,record:LrclibRecord):LrclibContrast {
 const q=query(input);
 const compare=(a:unknown,b:unknown):FieldContrast=>{const x=name(a),y=name(b);return !x||!y?'unknown':x===y?'metadata-consistent':'conflict';};
 return {title:compare(q?.title,record.title),artist:compare(q?.artist,record.artist),album:compare(q?.album,record.album),duration:q?.durationSeconds==null?'unknown':Math.abs(q.durationSeconds-record.durationSeconds)<=2?'metadata-consistent':'conflict'};
}
/** Reject malformed/oversized delays instead of clamping down and retrying too soon.
 * Invalid or unavailable CORS header => undefined: caller must not auto-retry. */
export function parseRetryAfter(value:unknown,now=Date.now()):number|undefined {
 if(typeof value!=='string'||value.length>128||!Number.isFinite(now))return undefined;
 const v=value.trim();let seconds:number;
 if(/^\d{1,10}$/.test(v))seconds=Number(v);
 else if(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(v))seconds=Math.max(0,Math.ceil((Date.parse(v)-now)/1000));
 else return undefined;
 return Number.isFinite(seconds)&&seconds>=0&&seconds<=LRCLIB_LIMITS.retryAfterSeconds?seconds:undefined;
}
export async function readLrclib(input:LrclibInput,options:LrclibOptions):Promise<LrclibResult> {
 if(options.enabled!==true)return {state:'disabled'};
 let terminal:LrclibResult|undefined;
 const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 let response:Response|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 let stopReject:(reason:unknown)=>void=()=>{};
 const stopped=new Promise<never>((_,reject)=>{stopReject=reject;});
 // Attach immediately, even when preflight returns without awaiting this promise.
 void stopped.catch(()=>{});
 const stop=(result:LrclibResult)=>{if(!terminal){terminal=result;stopReject(new Error('stopped'));controller.abort();}};
 const guard=()=>{
  if(options.signal?.aborted)stop({state:'cancelled',reason:'signal'});
  try{if(!options.current())stop({state:'cancelled',reason:'stale'});}catch{stop({state:'cancelled',reason:'stale'});}
  if(terminal)throw new Error('stopped');
 };
 const abort=()=>stop({state:'cancelled',reason:'signal'});
 async function wait<T>(work:()=>Promise<T>):Promise<T> {
  guard();
  const result=await Promise.race([work().then(value=>value,()=>{stop({state:'unavailable',reason:'network'});throw new Error('network');}),stopped]);
  guard();return result;
 }
 try {
  guard();const q=query(input);if(!q)return {state:'missing-input'};
  const timeout=options.timeoutMs??LRCLIB_LIMITS.timeoutMs;
  if(!Number.isFinite(timeout)||timeout<1||timeout>LRCLIB_LIMITS.maxTimeoutMs)return {state:'unavailable',reason:'protocol-invalid'};
  options.signal?.addEventListener('abort',abort,{once:true});guard();
  timer=setTimeout(()=>stop({state:'unavailable',reason:'timeout'}),timeout);
  const url=new URL('https://lrclib.net/api/get');url.searchParams.set('track_name',q.title);url.searchParams.set('artist_name',q.artist);
  if(q.album)url.searchParams.set('album_name',q.album);
  if(q.durationSeconds!=null)url.searchParams.set('duration',String(q.durationSeconds));
  guard();
  let pending:Promise<Response>;
  try{pending=(options.fetch??fetch)(url,{method:'GET',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});}catch{stop({state:'unavailable',reason:'network'});throw new Error('network');}
  // A transport ignoring abort can resolve after timeout. Retire its body as well.
  // Own every resolved response before wait's post-await guard can discard it.
  // Also retire a response arriving after timeout/cancellation has already settled.
  void pending.then(r=>{response=r;if(controller.signal.aborted)void r.body?.cancel().catch(()=>{});},()=>{});
  response=await wait(()=>pending);guard();
  const status=response.status;
  if(response.redirected||response.type==='opaqueredirect'||(response.url&&response.url!==url.href))invalid();
  if(status===404){guard();return {state:'not-found'};}
  if(status===429||status===503){
   const retryAfterSeconds=parseRetryAfter(response.headers.get('Retry-After'));guard();
   return {state:'unavailable',reason:status===429?'rate-limited':'service-unavailable',...(retryAfterSeconds===undefined?{}:{retryAfterSeconds})};
  }
  if(status!==200)invalid();
  const mime=response.headers.get('Content-Type');
  if(!mime||mime.length>128||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(mime.trim()))invalid();
  const length=response.headers.get('Content-Length');
  if(length!==null&&(length.length>16||!/^\d+$/.test(length)||Number(length)>LRCLIB_LIMITS.responseBytes))invalid();
  if(!response.body)invalid();reader=response.body.getReader();
  const chunks:Uint8Array[]=[];let size=0;
  while(true){
   guard();const next=await wait(()=>reader!.read());guard();if(next.done)break;
   if(next.value.byteLength===0||chunks.length>=LRCLIB_LIMITS.responseChunks)invalid();
   size+=next.value.byteLength;if(size>LRCLIB_LIMITS.responseBytes)invalid();chunks.push(next.value);
  }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  guard();const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const record=validateLrclibRecord(JSON.parse(text));if(!record)invalid();
  const contrast=contrastLrclib(q,record);guard();
  return {state:Object.values(contrast).includes('conflict')?'conflict':record.instrumental?'instrumental':'candidate',record,contrast};
 }catch {
  // Observe revocation at the boundary; a previously observed IO cause wins cleanup/abort.
  if(!terminal){try{guard();}catch{} }
  return terminal??{state:'unavailable',reason:'protocol-invalid'};
 }finally {
  if(timer!==undefined)clearTimeout(timer);
  options.signal?.removeEventListener('abort',abort);
  // Do not await untrusted stream cancellation: timeout/cancel must settle even if it hangs.
  if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}
  else if(response)void response.body?.cancel().catch(()=>{});
 }
}
