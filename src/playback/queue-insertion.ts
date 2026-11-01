import type {Entry} from './player';

export type Placement = 'next'|'end';
export type QueueStructure = Readonly<{
  queueRevision:number; queueEpoch:number; entries:readonly Entry[];
  currentEntryId:string|null; shuffleOrder:readonly string[]|null;
}>;
export type InsertionRequest = Readonly<{
  intentId:string; placement:Placement; entries:readonly Entry[];
  expectedQueueRevision:number; expectedQueueEpoch:number; afterEntryId:string|null;
}>;
export type InsertionPlan = Readonly<{
  intentId:string; expectedQueueRevision:number; expectedQueueEpoch:number;
  entries:readonly Entry[]; currentEntryId:string|null; index:number;
  shuffleOrder:readonly string[]|null; addedEntryIds:readonly string[];
}>;
export type PlanResult = {kind:'planned';plan:InsertionPlan} |
  {kind:'rejected';reason:'invalid-input'|'limit-exceeded'|'invalid-anchor'|'invalid-order'};
export type InsertResult = {kind:'inserted';queueRevision:number;queueEpoch:number;addedEntryIds:readonly string[]} |
  {kind:'rejected';reason:'not-admitted'|'stale-queue'|'invalid-input'|'limit-exceeded'|'invalid-anchor'|'invalid-order'|'protection-rejected'};

// Inspect own data descriptors: malformed ordinary inputs cannot execute getters.
// Proxies are outside this internal data-only boundary (reflection itself can trap).
function data(value:unknown, keys:readonly string[]):Record<string,unknown>|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null)return null;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).length!==keys.length)return null;
  const result:Record<string,unknown>=Object.create(null);
  for(const key of keys){const d=descriptors[key];if(!d||!('value' in d))return null;result[key]=d.value;}
  return result;
}
function array(value:unknown):unknown[]|null {
  if(!Array.isArray(value))return null;
  const length=Object.getOwnPropertyDescriptor(value,'length')?.value;
  if(!Number.isSafeInteger(length)||length<0||length>1000)return null;
  if(Reflect.ownKeys(value).length!==length+1)return null;
  const result:unknown[]=[];
  for(let i=0;i<length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!('value' in d))return null;result.push(d.value);}
  return result;
}
function string(value:unknown,max:number):value is string {
  return typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
}
function revision(value:unknown):value is number {return Number.isSafeInteger(value)&&(value as number)>=0;}
function entry(value:unknown):value is Entry {
  const e=data(value,['id','trackId','title','src']);
  return !!e&&string(e.id,256)&&string(e.trackId,256)&&string(e.title,4096)&&string(e.src,8192);
}
function rejected(reason:Extract<PlanResult,{kind:'rejected'}>['reason']):PlanResult {return {kind:'rejected',reason};}

/** Deterministic data-only planner. Anchor is resolved by the coordinator, never an index. */
export function planQueueInsertion(structure:QueueStructure,request:InsertionRequest):PlanResult {
  try {
    const s=data(structure,['queueRevision','queueEpoch','entries','currentEntryId','shuffleOrder']);
    const r=data(request,['intentId','placement','entries','expectedQueueRevision','expectedQueueEpoch','afterEntryId']);
    if(!s||!r||!revision(s.queueRevision)||!revision(s.queueEpoch)||
      !revision(r.expectedQueueRevision)||!revision(r.expectedQueueEpoch)||!string(r.intentId,256)||
      (r.placement!=='next'&&r.placement!=='end'))return rejected('invalid-input');
    // Oversize arrays are recognized without visiting their elements.
    for(const value of [s.entries,r.entries]){
      if(Array.isArray(value)&&Object.getOwnPropertyDescriptor(value,'length')!.value>1000)return rejected('limit-exceeded');
    }
    const old=array(s.entries),added=array(r.entries);
    if(!old||!added||added.length===0)return rejected('invalid-input');
    if(old.length+added.length>1000)return rejected('limit-exceeded');
    if(!old.every(entry)||!added.every(entry))return rejected('invalid-input');
    const ids=old.map(e=>e.id),newIds=added.map(e=>e.id);
    if(new Set([...ids,...newIds]).size!==ids.length+newIds.length)return rejected('invalid-input');
    const current=s.currentEntryId;
    if(current!==null&&(!string(current,256)||!ids.includes(current)))return rejected('invalid-anchor');
    const shuffle=s.shuffleOrder===null?null:array(s.shuffleOrder);
    if(s.shuffleOrder!==null&&(!shuffle||shuffle.length!==ids.length||
      !shuffle.every(id=>typeof id==='string'&&ids.includes(id))||new Set(shuffle).size!==ids.length))return rejected('invalid-order');
    const anchor=r.afterEntryId;
    if(r.placement==='end') {if(anchor!==null)return rejected('invalid-anchor');}
    else if(current===null) {if(anchor!==null)return rejected('invalid-anchor');}
    else if(typeof anchor!=='string'||!ids.includes(anchor)||ids.indexOf(anchor)<ids.indexOf(current)||
      (shuffle!==null&&shuffle.indexOf(anchor)<shuffle.indexOf(current)))return rejected('invalid-anchor');
    const position=r.placement==='end'?ids.length:anchor===null?0:ids.indexOf(anchor as string)+1;
    // Old objects retain identity; new ones are private immutable copies.
    const entries=Object.freeze([...old.slice(0,position),...added.map(e=>Object.freeze({id:e.id,trackId:e.trackId,title:e.title,src:e.src})),...old.slice(position)]);
    let order:readonly string[]|null=null;
    if(shuffle!==null){const at=r.placement==='end'?shuffle.length:anchor===null?0:shuffle.indexOf(anchor)+1;
      order=Object.freeze([...shuffle.slice(0,at),...newIds,...shuffle.slice(at)]) as readonly string[];}
    return {kind:'planned',plan:Object.freeze({intentId:r.intentId as string,
      expectedQueueRevision:r.expectedQueueRevision as number,expectedQueueEpoch:r.expectedQueueEpoch as number,
      entries,currentEntryId:current as string|null,index:current===null?-1:entries.findIndex(e=>e.id===current),
      shuffleOrder:order,addedEntryIds:Object.freeze(newIds)})};
  } catch {return rejected('invalid-input');}
}
