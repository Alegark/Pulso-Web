import Long from 'long';
import {dataArray,positive} from './sources-protocol';
import {BOT_SEARCH_BOUNDS as B,botSearchText,type BotSearchRow} from './bot-search-protocol';
/** Raw SDK values are worker-private. No getters, JSON hooks, bigint coercion or raw logging. */
export const searchOwn=(v:unknown,k:string):unknown=>v&&typeof v==='object'?Object.getOwnPropertyDescriptor(v,k)?.value:undefined;
export class BotSearchProjectionError extends Error {constructor(readonly code:'limit'|'unsupported'){super(code);}}
function bad(code:'limit'|'unsupported'='unsupported'):never {throw new BotSearchProjectionError(code);}
/** 64 KiB approximate decoded data budget, including incidental SDK response fields. NOT a
 * transport/WASM allocation or peak heap bound. Caller accumulates returned cost per attempt. */
export function assertBotSearchRawBudget(raw:unknown):number {
 const pending=[{v:raw,depth:0}],seen=new Set<object>();let bytes=0,nodes=0,slots=0;
 const byteLength=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength')!.get!;
 while(pending.length){const {v,depth}=pending.pop()!;if(++nodes>4096||depth>20)bad('limit');
  if(v===null||v===undefined||typeof v==='number'||typeof v==='boolean')bytes+=8;
  else if(typeof v==='string'){if(v.length>B.rawBytes/2)bad('limit');bytes+=v.length*2+8;}
  else if(typeof v==='object'){
   if(seen.has(v))bad('limit');seen.add(v);bytes+=32;const proto=Object.getPrototypeOf(v);
   if(proto===Uint8Array.prototype){const n=byteLength.call(v);bytes+=n;if(n>4096||bytes>B.rawBytes)bad('limit');if(Reflect.ownKeys(v).length!==n)bad();}
   else {if(proto!==Object.prototype&&proto!==null&&proto!==Array.prototype&&proto!==Long.prototype)bad();
    if(proto===Long.prototype&&!searchLong(v))bad();
    const keys=Reflect.ownKeys(v);slots+=keys.length;if(keys.length>2048||slots>4096)bad('limit');
    for(const key of keys){if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key))bad();const d=Object.getOwnPropertyDescriptor(v,key)!;if(!('value'in d))bad();bytes+=key.length*2+8;pending.push({v:d.value,depth:depth+1});}
   }
  }else bad();
  if(bytes>B.rawBytes)bad('limit');
 }return bytes;
}
/** Exact same installed signed-Long data validation used for approved peers. */
export function searchLong(v:unknown):Long|null {
 if(!v||typeof v!=='object'||Object.getPrototypeOf(v)!==Long.prototype)return null;
 const lo=searchOwn(v,'low'),hi=searchOwn(v,'high'),unsigned=searchOwn(v,'unsigned');
 return typeof lo==='number'&&Number.isInteger(lo)&&lo>=-2147483648&&lo<=2147483647&&typeof hi==='number'&&Number.isInteger(hi)&&hi>=-2147483648&&hi<=2147483647&&unsigned===false?new Long(lo,hi,false):null;
}
const messageId=(v:unknown):v is number=>positive(v)&&v<=2147483647;
const samePeer=(v:unknown,botId:number)=>searchOwn(v,'_')==='peerUser'&&searchOwn(v,'userId')===botId;
function history(raw:unknown,botId:number,limit:number):readonly unknown[] {
 if(!['messages.messages','messages.messagesSlice'].includes(searchOwn(raw,'_') as string))bad();
 const a=dataArray(searchOwn(raw,'messages'),limit);if(!a)bad('limit');
 for(const m of a){if(!['message','messageService'].includes(searchOwn(m,'_') as string)||!messageId(searchOwn(m,'id'))||!samePeer(searchOwn(m,'peerId'),botId))bad();}
 return a;
}
export function botSearchBaseline(raw:unknown,botId:number):number {return history(raw,botId,1).reduce<number>((n,m)=>Math.max(n,searchOwn(m,'id') as number),0);}
/** Send RPC response belongs to the exact private peer in the original call. Mapping randomId
 * is compared via own validated slots, never foreign equals/getters. No guessed history ACK. */
export function botSearchAck(raw:unknown,botId:number,randomId:Long):number|null {
 if(searchOwn(raw,'_')==='updateShortSentMessage')return searchOwn(raw,'out')===true&&messageId(searchOwn(raw,'id'))?searchOwn(raw,'id') as number:null;
 if(!['updates','updatesCombined'].includes(searchOwn(raw,'_') as string))return null;
 const a=dataArray(searchOwn(raw,'updates'),64);if(!a)return null;
 const ids=a.filter(u=>{const n=searchLong(searchOwn(u,'randomId'));return searchOwn(u,'_')==='updateMessageID'&&n&&n.low===randomId.low&&n.high===randomId.high&&messageId(searchOwn(u,'id'));}).map(u=>searchOwn(u,'id') as number);
 if(ids.length!==1)return null;
 for(const u of a){if(searchOwn(u,'_')!=='updateNewMessage')continue;const m=searchOwn(u,'message');if(searchOwn(m,'id')===ids[0]&&(!samePeer(searchOwn(m,'peerId'),botId)||searchOwn(m,'out')!==true))return null;}
 return ids[0];
}
export interface BotSearchPrivateRef {readonly messageId:number;readonly callbackData?:Uint8Array}
export interface BotSearchPage {readonly rows:readonly BotSearchRow[];readonly refs:ReadonlyMap<string,BotSearchPrivateRef>;readonly concurrent:boolean;readonly unrecognized:boolean}
export function projectBotSearchPage(raw:unknown,botId:number,baseline:number,outgoing:number):BotSearchPage {
 const messages=history(raw,botId,20),rows:BotSearchRow[]=[],refs=new Map<string,BotSearchPrivateRef>();let concurrent=false,unrecognized=false;
 const add=(m:number,row:Omit<Extract<BotSearchRow,{kind:'option'}>,'rowRef'>|Omit<Extract<BotSearchRow,{kind:'message'}>,'rowRef'>|Omit<Extract<BotSearchRow,{kind:'audio'}>,'rowRef'>,data?:Uint8Array)=>{
  if(rows.length>=B.rows)bad('limit');const rowRef=crypto.randomUUID();rows.push(Object.freeze({...row,rowRef}));refs.set(rowRef,Object.freeze({messageId:m,...(data?{callbackData:data.slice()}: {})}));
 };
 for(const m of messages){const id=searchOwn(m,'id') as number;if(id<=baseline)continue;
  if(searchOwn(m,'out')===true){if(id!==outgoing)concurrent=true;continue;}
  if(id<=outgoing||searchOwn(m,'_')!=='message'||!samePeer(searchOwn(m,'fromId'),botId))continue;
  const reply=searchOwn(m,'replyTo');let correlation:'reply'|'recent'='recent';
  if(reply!==undefined){const peer=searchOwn(reply,'replyToPeerId');if(searchOwn(reply,'_')!=='messageReplyHeader'||searchOwn(reply,'replyToMsgId')!==outgoing||peer!==undefined&&!samePeer(peer,botId))continue;correlation='reply';}
  const start=rows.length,markup=searchOwn(m,'replyMarkup');
  if(searchOwn(markup,'_')==='replyInlineMarkup'){
   const keyboard=dataArray(searchOwn(markup,'rows'),20);if(!keyboard)bad('limit');
   for(const r of keyboard){if(searchOwn(r,'_')!=='keyboardInlineButtonRow')bad();const buttons=dataArray(searchOwn(r,'buttons'),20);if(!buttons)bad('limit');
    for(const b of buttons){
     // Installed layer232: callback is a nested type, never the legacy button constructor.
     const type=searchOwn(b,'type');if(searchOwn(b,'_')!=='keyboardInlineButton'||searchOwn(type,'_')!=='inlineButtonTypeCallback'||searchOwn(type,'requiresPassword')===true)continue;
     const label=botSearchText(searchOwn(b,'text')),data=searchOwn(type,'data');
     if(!label||!data||typeof data!=='object'||Object.getPrototypeOf(data)!==Uint8Array.prototype||!(data as Uint8Array).length||(data as Uint8Array).length>64)continue;
     // Labels only: callback data is opaque even when it happens to resemble a title/URL.
     add(id,{kind:'option',label,correlation},data as Uint8Array);
    }
   }
  }
  const media=searchOwn(m,'media'),doc=searchOwn(media,'document');
  if(searchOwn(media,'_')==='messageMediaDocument'&&searchOwn(doc,'_')==='document'){
   const attrs=dataArray(searchOwn(doc,'attributes'),20);if(!attrs)bad('limit');const audio=attrs.filter(a=>searchOwn(a,'_')==='documentAttributeAudio');
   const mime=searchOwn(doc,'mimeType'),size=searchOwn(doc,'size');
   if(audio.length===1&&searchOwn(audio[0],'voice')!==true&&typeof mime==='string'&&/^audio\/[a-z0-9.+-]{1,64}$/.test(mime)&&typeof size==='number'){
    const bytes=size,duration=searchOwn(audio[0],'duration');
    if(Number.isSafeInteger(bytes)&&bytes>0&&typeof duration==='number'&&Number.isFinite(duration)&&duration>=0&&duration<=86400)add(id,{kind:'audio',correlation,title:botSearchText(searchOwn(audio[0],'title')),performer:botSearchText(searchOwn(audio[0],'performer')),durationSeconds:duration,mimeType:mime,bytes});
   }
  }
  const text=botSearchText(searchOwn(m,'message'),1000);if(text)add(id,{kind:'message',correlation,text});
  if(rows.length===start)unrecognized=true;
 }
 return Object.freeze({rows:Object.freeze(rows),refs,concurrent,unrecognized});
}
