/** Closed, data-only wire contract. No SDK values or persistent capabilities. */
export const SOURCES_BOUNDS = Object.freeze({pageDialogs:25, calls:20, dialogs:500, candidates:501, selected:20, namePoints:160, nameBytes:640, dtoBytes:32768, retainedBytes:524288, rawBytes:2097152, rawChats:100, rawUsers:250, rawMessages:100, rawTitlePoints:4096, cursorMs:120000, idleMs:900000, timeoutMs:15000, settlementMs:2000, requestIds:256, rawDepth:32, rawNodes:50000, rawSlots:50000, rawObjectKeys:10000, rawBinaryBytes:50000, dtoRecordKeys:64});
export interface AccountBinding {readonly accountRef:string; readonly accountEpoch:number}
export interface Envelope extends AccountBinding {readonly protocol:'pulso-sources';readonly version:1;readonly sessionId:string;readonly listEpoch:number;readonly operationId:string;readonly requestId:string}
export type Folder='main'|'archived';
export type SourceKind='saved'|'group'|'supergroup'|'channel'|'gigagroup';
export interface SourceRow {readonly peerRef:string;readonly kind:SourceKind;readonly name:string}
export type SourcesCommand =
 | (Envelope & {readonly type:'sources.page';readonly folder:Folder;readonly cursor:string|null})
 | (Envelope & {readonly type:'sources.cancel';readonly targetRequestId:string})
 | (Envelope & {readonly type:'sources.select';readonly peerRefs:readonly string[]})
 | (Envelope & {readonly type:'sources.clear'});
export type SourcesError='access'|'rate-limit'|'network'|'timeout'|'cancelled'|'limit'|'expired'|'protocol'|'session-expired'|'internal';
export type PageEnd='more'|'exhausted'|'limit'|'cursor-unavailable';
export type SourcesReply =
 | (Envelope & {readonly type:'sources.page';readonly folder:Folder;readonly items:readonly SourceRow[];readonly cursor:string|null;readonly end:PageEnd})
 | (Envelope & {readonly type:'sources.cancelled';readonly targetRequestId:string})
 | (Envelope & {readonly type:'sources.selected';readonly revision:number;readonly peerRefs:readonly string[]})
 | (Envelope & {readonly type:'sources.cleared';readonly revision:number})
 | (Envelope & {readonly type:'sources.error';readonly error:SourcesError;readonly retryAt:number|null;readonly retryBlocked:boolean});
export const utf8Bytes=(s:string):number=>new TextEncoder().encode(s).length;
export const isUuid=(v:unknown):v is string=>typeof v==='string'&&v.length===36&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
export const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
/** Reflect APIs cannot make hostile Proxy traps safe; wire values must be structured-clone data. */
export function dataRecord(v:unknown,keys?:readonly string[]):Record<string,unknown>|null {
 if(!v||typeof v!=='object'||(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null))return null;
 const own=Reflect.ownKeys(v);if(own.length>SOURCES_BOUNDS.dtoRecordKeys||own.some(k=>typeof k!=='string'||k==='__proto__'||k==='constructor'||k==='prototype'))return null;
 if(keys&&(own.length!==keys.length||own.some(k=>!keys.includes(k as string))))return null;
 const out:Record<string,unknown>=Object.create(null);
 for(const k of own){const d=Object.getOwnPropertyDescriptor(v,k)!;if(!('value'in d)||!d.enumerable)return null;out[k as string]=d.value;}return out;
}
export function dataArray(v:unknown,max:number):readonly unknown[]|null {
 if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype)return null;
 const len=Object.getOwnPropertyDescriptor(v,'length')?.value;if(!Number.isSafeInteger(len)||len>max)return null;
 const keys=Reflect.ownKeys(v);if(keys.length!==len+1)return null;
 const out:unknown[]=[];for(let i=0;i<len;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!('value'in d)||!d.enumerable)return null;out.push(d.value);}return out;
}
export function parseAccountBinding(v:unknown):AccountBinding|null {try{const r=dataRecord(v,['accountRef','accountEpoch']);return r&&isUuid(r.accountRef)&&positive(r.accountEpoch)?Object.freeze({accountRef:r.accountRef,accountEpoch:r.accountEpoch}):null;}catch{return null;}}
export function sourceName(raw:string):string {
 // Bound before normalization/codepoint allocation. Raw titles have a separate acceptance budget.
 const cleaned=raw.slice(0,8192).normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/gu,'').trim();
 return Array.from(cleaned).slice(0,SOURCES_BOUNDS.namePoints).join('')||'Fuente sin nombre';
}
const envelopeKeys=['protocol','version','sessionId','accountRef','accountEpoch','listEpoch','operationId','requestId'] as const;
export function copyEnvelope(r:Envelope):Envelope {return Object.freeze({protocol:'pulso-sources',version:1,sessionId:r.sessionId,accountRef:r.accountRef,accountEpoch:r.accountEpoch,listEpoch:r.listEpoch,operationId:r.operationId,requestId:r.requestId});}
function envelope(r:Record<string,unknown>):Envelope|null {
 if(r.protocol!=='pulso-sources'||r.version!==1||!isUuid(r.sessionId)||!isUuid(r.accountRef)||!positive(r.accountEpoch)||!positive(r.listEpoch)||!isUuid(r.operationId)||!isUuid(r.requestId))return null;
 return copyEnvelope(r as unknown as Envelope);
}
function refs(v:unknown):readonly string[]|null {const a=dataArray(v,20);if(!a||!a.every(isUuid)||new Set(a).size!==a.length)return null;return Object.freeze(a as string[]);}
function row(v:unknown):SourceRow|null {const r=dataRecord(v,['peerRef','kind','name']);if(!r||!isUuid(r.peerRef)||!['saved','group','supergroup','channel','gigagroup'].includes(r.kind as string)||typeof r.name!=='string'||r.name.length>320||Array.from(r.name).length>160||utf8Bytes(r.name)>640||sourceName(r.name)!==r.name)return null;return Object.freeze({peerRef:r.peerRef,kind:r.kind as SourceKind,name:r.name});}
function parse(raw:unknown,reply:boolean,expected?:Readonly<Envelope>):SourcesCommand|SourcesReply|null {
 const r=dataRecord(raw);if(!r)return null;const e=envelope(r);if(!e)return null;
 if(expected&&envelopeKeys.some(k=>e[k]!==expected[k]))return null;
 let extra:string[]=[];let value:SourcesCommand|SourcesReply|null=null;
 switch(r.type){
 case 'sources.page':
  if(r.folder!=='main'&&r.folder!=='archived'||r.cursor!==null&&!isUuid(r.cursor))return null;
  if(!reply){extra=['folder','cursor'];value={...e,type:'sources.page',folder:r.folder,cursor:r.cursor as string|null};break;}
  {extra=['folder','items','cursor','end'];const a=dataArray(r.items,26);if(!a)return null;const items=a.map(row);if(items.some(x=>!x)||new Set(items.map(x=>x!.peerRef)).size!==items.length||!['more','exhausted','limit','cursor-unavailable'].includes(r.end as string)||(r.end==='more')!==(r.cursor!==null))return null;
   value={...e,type:'sources.page',folder:r.folder,items:Object.freeze(items as SourceRow[]),cursor:r.cursor as string|null,end:r.end as PageEnd};}break;
 case 'sources.cancel':if(reply||!isUuid(r.targetRequestId))return null;extra=['targetRequestId'];value={...e,type:'sources.cancel',targetRequestId:r.targetRequestId};break;
 case 'sources.cancelled':if(!reply||!isUuid(r.targetRequestId))return null;extra=['targetRequestId'];value={...e,type:'sources.cancelled',targetRequestId:r.targetRequestId};break;
 case 'sources.select':{if(reply)return null;const a=refs(r.peerRefs);if(!a)return null;extra=['peerRefs'];value={...e,type:'sources.select',peerRefs:a};break;}
 case 'sources.selected':{if(!reply||!positive(r.revision))return null;const a=refs(r.peerRefs);if(!a)return null;extra=['revision','peerRefs'];value={...e,type:'sources.selected',revision:r.revision,peerRefs:a};break;}
 case 'sources.clear':if(reply)return null;value={...e,type:'sources.clear'};break;
 case 'sources.cleared':if(!reply||!positive(r.revision))return null;extra=['revision'];value={...e,type:'sources.cleared',revision:r.revision};break;
 case 'sources.error':
  if(!reply||!['access','rate-limit','network','timeout','cancelled','limit','expired','protocol','session-expired','internal'].includes(r.error as string)||typeof r.retryBlocked!=='boolean'||r.retryAt!==null&&(!positive(r.retryAt)||r.retryAt>8640000000000000))return null;
  if(r.error==='rate-limit'?(r.retryBlocked!==(r.retryAt===null)):(r.retryAt!==null||r.retryBlocked))return null;
  extra=['error','retryAt','retryBlocked'];value={...e,type:'sources.error',error:r.error as SourcesError,retryAt:r.retryAt as number|null,retryBlocked:r.retryBlocked};break;
 default:return null;
 }
 // The spread above copies our freshly built envelope only, never unvalidated input.
 if(!dataRecord(raw,[...envelopeKeys,'type',...extra]))return null;
 if(utf8Bytes(JSON.stringify(value))>SOURCES_BOUNDS.dtoBytes)return null;return Object.freeze(value);
}
export function parseSourcesCommand(raw:unknown):SourcesCommand|null {try{return parse(raw,false) as SourcesCommand|null;}catch{return null;}}
export function parseSourcesReply(raw:unknown,expected:Readonly<Envelope>):SourcesReply|null {try{return parse(raw,true,expected) as SourcesReply|null;}catch{return null;}}
