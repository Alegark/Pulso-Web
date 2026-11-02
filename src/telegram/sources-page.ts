import Long from 'long';
import type {tl} from '@mtcute/core';
import {SOURCES_BOUNDS as B,dataArray,positive,sourceName,type SourceKind,type Folder} from './sources-protocol';
/** Worker-private types: these must never cross the sources DTO boundary. */
export interface PageAnchor {readonly key:string;readonly offsetId:number;readonly offsetDate:number;readonly offsetPeer:tl.TypeInputPeer}
export interface ProjectedCandidate {readonly key:string;readonly kind:SourceKind;readonly name:string;readonly peer:tl.TypeInputPeer}
export interface ProjectedPage {readonly candidates:readonly ProjectedCandidate[];readonly dialogs:number;readonly anchor:PageAnchor|null;readonly end:'more'|'exhausted'|'cursor-unavailable'}
export class ProjectionLimit extends Error {constructor(){super('limit');}}
function limit():never {throw new ProjectionLimit();}
const own=(v:unknown,k:string):unknown=>v&&typeof v==='object'?Object.getOwnPropertyDescriptor(v,k)?.value:undefined;
/** SDK 0.32.7 TL long: clone data slots, never call toJSON/toString or a foreign getter. */
function long(v:unknown):Long|null {
 if(typeof v==='bigint')return v>=-(1n<<63n)&&v<(1n<<63n)?Long.fromBigInt(v):null;
 if(!v||typeof v!=='object'||Object.getPrototypeOf(v)!==Long.prototype)return null;
 const lo=own(v,'low'),hi=own(v,'high'),unsigned=own(v,'unsigned');
 if(typeof lo!=='number'||typeof hi!=='number'||!Number.isInteger(lo)||!Number.isInteger(hi)||lo< -2147483648||lo>2147483647||hi< -2147483648||hi>2147483647||typeof unsigned!=='boolean')return null;
 return new Long(lo,hi,unsigned);
}
/** Approximate post-decoder budget, NOT a bound on SDK cache/network/WASM/peak heap.
 * Iterative traversal is bounded in depth, nodes, slots and bytes; no accessors or hooks.
 * Incidental message strings/bytes are measured only and never copied into a model.
 */
export function assertRawBudget(raw:unknown):void {
 const work:{v:unknown;depth:number}[]=[{v:raw,depth:0}];const seen=new Set<object>();let bytes=0,nodes=0,slots=0;
 const byteLength=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength')!.get!;
 while(work.length){const {v,depth}=work.pop()!;if(++nodes>B.rawNodes||depth>B.rawDepth)limit();
  if(v===null||v===undefined||typeof v==='boolean'||typeof v==='number'){bytes+=8;}
  else if(typeof v==='bigint'){if(v<-(1n<<63n)||v>=(1n<<64n))limit();bytes+=16;}
  else if(typeof v==='string'){if(v.length>B.rawBytes/2)limit();bytes+=v.length*2+8;}
  else if(typeof v==='object'){
   if(seen.has(v))limit();seen.add(v);bytes+=32;
   const proto=Object.getPrototypeOf(v);
   if(proto===Uint8Array.prototype){const size=byteLength.call(v);bytes+=size;if(bytes>B.rawBytes||size>B.rawBinaryBytes)limit();const keys=Reflect.ownKeys(v);if(keys.length!==size)limit();}
   else {
    if(proto!==Object.prototype&&proto!==null&&proto!==Array.prototype&&proto!==Long.prototype)limit();
    const keys=Reflect.ownKeys(v);slots+=keys.length;if(keys.length>B.rawObjectKeys||slots>B.rawSlots)limit();
    if(proto===Long.prototype&&!long(v))limit();
    for(const key of keys){if(typeof key!=='string'||key==='__proto__'||key==='constructor'||key==='prototype')limit();const d=Object.getOwnPropertyDescriptor(v,key)!;if(!('value'in d))limit();bytes+=key.length*2+8;work.push({v:d.value,depth:depth+1});}
   }
  }else limit();
  if(bytes>B.rawBytes)limit();
 }
}
function fields(v:unknown,keys:readonly string[]):Record<string,unknown>|null {
 if(!v||typeof v!=='object'||(Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null))return null;
 const out:Record<string,unknown>=Object.create(null);
 // The post-decoder budget already rejected accessors. Copy only named projection fields.
 for(const key of keys)out[key]=own(v,key);return out;
}
function peerIdentity(v:unknown):{key:string;type:'user'|'chat'|'channel';id:number}|null {
 const p=fields(v,['_','userId','chatId','channelId']);if(!p)return null;const type=p._==='peerUser'?'user':p._==='peerChat'?'chat':p._==='peerChannel'?'channel':null;
 if(!type)return null;const id=p[`${type}Id`];return positive(id)?{key:`${type}:${id}`,type,id}:null;
}
function inputPeer(p:NonNullable<ReturnType<typeof peerIdentity>>,chats:readonly unknown[],users:readonly unknown[]):tl.TypeInputPeer|null {
 if(p.type==='chat')return {_: 'inputPeerChat',chatId:p.id};
 const r=(p.type==='user'?users:chats).map(v=>fields(v,['_','id','min','self','accessHash'])).find(x=>x&&x.id===p.id&&(p.type==='user'?x._==='user':x._==='channel'||x._==='channelForbidden'));
 if(!r||r.min)return null;if(p.type==='user'&&r.self)return {_: 'inputPeerSelf'};
 const hash=long(r.accessHash);if(!hash)return null;
 return p.type==='user'?{_: 'inputPeerUser',userId:p.id,accessHash:hash}:{_: 'inputPeerChannel',channelId:p.id,accessHash:hash};
}
/** Equivalent conservative subset of installed Chat getters (no high-level Chat/Message/Dialog).
 * Additional policy exclusions: protected, migrated, community and monoforum. */
function candidate(p:NonNullable<ReturnType<typeof peerIdentity>>,chats:readonly unknown[]):ProjectedCandidate|null {
 if(p.type==='user')return null;
 const c=chats.map(v=>fields(v,['_','id','title','left','min','deactivated','migratedTo','restricted','noforwards','monoforum','gigagroup','broadcast','megagroup'])).find(x=>x&&x.id===p.id&&x._===(p.type==='chat'?'chat':'channel'));
 if(!c||c.left||c.min||c.deactivated||c.migratedTo||c.restricted||c.noforwards||c.monoforum)return null;
 const kind:SourceKind|null=p.type==='chat'?'group':c.gigagroup?'gigagroup':c.broadcast?'channel':c.megagroup?'supergroup':null;
 if(!kind)return null;const peer=inputPeer(p,chats,[]);if(!peer)return null;
 if(typeof c.title!=='string'||c.title.length>B.rawTitlePoints*2||Array.from(c.title).length>B.rawTitlePoints)limit();
 return Object.freeze({key:p.key,kind,name:sourceName(c.title),peer});
}
export function projectSourcesPage(raw:unknown,previous:PageAnchor|null=null,folder:Folder='main'):ProjectedPage {
 assertRawBudget(raw);const r=fields(raw,['_','dialogs','chats','users','messages']);if(!r||r._!=='messages.dialogs'&&r._!=='messages.dialogsSlice')limit();
 const dialogs=dataArray(r.dialogs,B.pageDialogs),chats=dataArray(r.chats,B.rawChats),users=dataArray(r.users,B.rawUsers),messages=dataArray(r.messages,B.rawMessages);
 if(!dialogs||!chats||!users||!messages)limit();
 // Validate all raw title budgets, including auxiliary peers, before retaining projection.
 for(const rawChat of chats){const c=fields(rawChat,['title']);if(!c)limit();if(c.title!==undefined&&(typeof c.title!=='string'||c.title.length>B.rawTitlePoints*2||Array.from(c.title).length>B.rawTitlePoints))limit();}
 const candidates:ProjectedCandidate[]=[];const seen=new Set<string>();let last:Record<string,unknown>|null=null;
 for(const rawDialog of dialogs){const d=fields(rawDialog,['_','pinned','folderId','peer','topMessage']);if(!d)limit();if(d._!=='dialog')continue;
  if(d.pinned!==true)last=d;
  if((d.folderId===1)!==(folder==='archived'))continue;
  const p=peerIdentity(d.peer);if(!p)continue;const c=candidate(p,chats);if(c&&!seen.has(c.key)){seen.add(c.key);candidates.push(c);}
 }
 let anchor:PageAnchor|null=null;
 if(last&&(last.folderId===1)===(folder==='archived')){const p=peerIdentity(last.peer),id=last.topMessage;
  if(p&&positive(id)&&id<=2147483647){const peer=inputPeer(p,chats,users);
   const m=messages.find(m=>(own(m,'_')==='message'||own(m,'_')==='messageService')&&own(m,'id')===id&&peerIdentity(own(m,'peerId'))?.key===p.key);
   const date=m?own(m,'date'):undefined;
   if(peer&&positive(date)&&date<=2147483647){const key=`${p.key}:${id}:${date}`;if(key!==previous?.key)anchor=Object.freeze({key,offsetId:id,offsetDate:date,offsetPeer:peer});}
  }
 }
 const end=r._==='messages.dialogs'||dialogs.length===0?'exhausted':anchor?'more':'cursor-unavailable';
 return Object.freeze({candidates:Object.freeze(candidates),dialogs:dialogs.length,anchor:end==='more'?anchor:null,end});
}
