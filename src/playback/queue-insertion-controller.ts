import type {Entry} from './player';
import type {Placement,QueueStructure} from './queue-insertion';
import type {ActivityToken} from './ownership';
import type {LocalAsset} from '../library/library';
import {copySourceAsset,closedObject,sourceUUID,type InsertionPlayer,type InsertionPreparation,type LocalSourcePreparation,type SourcePreparationControl} from './local-source-protocol';
import {AppFailure,fromKnownError,makeFailure,type FailureV1} from '../errors/app-failure';

export interface SelectedOccurrence {readonly selectionKey:string;readonly trackId:string;readonly entryId:string}
export interface QueueInsertionIntent {readonly intentId:string;readonly placement:Placement;readonly selection:readonly SelectedOccurrence[]}
export interface AdmissionCapture {current():boolean}
export type IntentTerminal=
 |{kind:'inserted';intentId:string;addedEntryIds:readonly string[];persistence:'saved'|'not-saved'}
 |{kind:'cancelled';intentId:string;reason:'user'|'replaced'|'revoked'|'deadline'}
 |{kind:'failed';intentId:string;failure:FailureV1;added:0;resourceState:'settled'|'settling'|'uncertain'};
export interface IntentHandle {readonly intentId:string;readonly result:Promise<IntentTerminal>;readonly settled:Promise<void>;cancel():void}
export type AdmissionResult={kind:'accepted';handle:IntentHandle}|{kind:'rejected';reason:'admission-unavailable'|'invalid-input'|'queue-limit'|'pending-limit'|'incompatible-operation'};
export interface InsertionStatus {readonly intentId:string;readonly placement:Placement;readonly phase:'queued'|'preparing'|'settling'|'inserted'|'cancelled'|'failed'|'uncertain';readonly requested:number;readonly added:number;readonly terminal?:IntentTerminal}
export interface QueueInsertionHost {
 canAccept():boolean;
 beginActivity():ActivityToken|null;
 captureExecution():()=>boolean;
 getOwnerProof():string;
 getPlayer():InsertionPlayer;
 beginSources(trackIds:readonly string[],current:()=>boolean):InsertionPreparation;
 resolveSelection(selection:readonly SelectedOccurrence[],current:()=>boolean,signal:AbortSignal):Promise<readonly {readonly entryId:string;readonly trackId:string;readonly title:string;readonly asset:Readonly<LocalAsset>}[]>;
 startSources(expected:readonly Readonly<LocalAsset>[],proof:string,control:SourcePreparationControl):LocalSourcePreparation;
 saveLatestQueue(current:()=>boolean):Promise<'saved'|'not-saved'>;
 onStatus(value:InsertionStatus):void;
 onPendingChanged(count:number):void;
}
type CancelReason='user'|'replaced'|'revoked'|'deadline';
interface Attempt {
 intent:QueueInsertionIntent;abort:AbortController;token:ActivityToken;execution:()=>boolean;queueEpoch:number;
 preparation:InsertionPreparation;producer:LocalSourcePreparation|null;deadline:number;timer:ReturnType<typeof setTimeout>|null;
 started:boolean;finishing:boolean;committed:boolean;reason:CancelReason|null;terminal:IntentTerminal|null;
 result:(value:IntentTerminal)=>void;settled:()=>void;handle:IntentHandle;
}
const safe=(fn:()=>boolean)=>{try{return fn()===true;}catch{return false;}};
function copyIntent(value:QueueInsertionIntent):QueueInsertionIntent|null {
 try{
  const v=closedObject(value,['intentId','placement','selection']);
  if(!v||!sourceUUID(v.intentId)||!['next','end'].includes(v.placement as string)||!Array.isArray(v.selection))return null;
  const length=Object.getOwnPropertyDescriptor(v.selection,'length');if(!length||!('value'in length)||length.value<1||length.value>1000||Reflect.ownKeys(v.selection).length!==length.value+1)return null;
  const rows:SelectedOccurrence[]=[],seen=new Set<string>();
  for(let i=0;i<length.value;i++){
   const descriptor=Object.getOwnPropertyDescriptor(v.selection,String(i));if(!descriptor||!('value'in descriptor))return null;
   const row=closedObject(descriptor.value,['selectionKey','trackId','entryId']);
   if(!row||typeof row.selectionKey!=='string'||!row.selectionKey||row.selectionKey.length>1024||!sourceUUID(row.trackId)||!sourceUUID(row.entryId)||seen.has(row.entryId))return null;
   seen.add(row.entryId);rows.push(Object.freeze({selectionKey:row.selectionKey,trackId:row.trackId,entryId:row.entryId}));
  }
  return Object.freeze({intentId:v.intentId,placement:v.placement as Placement,selection:Object.freeze(rows)});
 }catch{return null;}
}
/** One producer, occurrence snapshots and exact resource custody. Transport owns
 * physical settlement; logical timeout/cancel never releases a late producer. */
export function createQueueInsertionController(host:QueueInsertionHost){
 const active=new Set<Attempt>(),fifo:Attempt[]=[],history=new Map<string,{signature:string;handle:IntentHandle}>();
 let pumping=false,tail:{anchor:string|null;ids:readonly string[]}|null=null;
 const pending=()=>{try{host.onPendingChanged(active.size);}catch{/* notification has no authority */}};
 function notify(r:Attempt,phase:InsertionStatus['phase'],terminal?:IntentTerminal){try{host.onStatus({intentId:r.intent.intentId,placement:r.intent.placement,phase,requested:r.intent.selection.length,added:r.committed?r.intent.selection.length:0,...(terminal?{terminal}:{})});}catch{/* optional presentation */}}
 function complete(r:Attempt,value:IntentTerminal){if(r.terminal)return;r.terminal=Object.freeze(value);r.result(r.terminal);}
 function cancel(r:Attempt,reason:CancelReason){
  if(r.reason||r.committed)return;r.reason=reason;r.abort.abort();r.producer?.cancel();r.preparation.cancel();
  if(!r.started&&!r.finishing)void settle(r);
 }
 function current(r:Attempt){return !r.abort.signal.aborted&&safe(r.execution)&&r.token.current()&&host.getPlayer().queueEpoch===r.queueEpoch&&performance.now()<=r.deadline;}
 function check(r:Attempt){if(current(r))return;if(!r.reason)cancel(r,performance.now()>r.deadline?'deadline':'revoked');throw AppFailure.create(makeFailure('transport','cancelled','cancelled','none'));}
 function anchor(structure:QueueStructure):string|null{
  if(!tail||tail.anchor!==structure.currentEntryId)return structure.currentEntryId;
  const follows=(order:readonly string[])=>{const start=tail!.anchor===null?0:order.indexOf(tail!.anchor)+1;return start>=0&&tail!.ids.every((id,i)=>order[start+i]===id);};
  if(!follows(structure.entries.map(e=>e.id))||structure.shuffleOrder&&!follows(structure.shuffleOrder)){tail=null;return structure.currentEntryId;}
  return tail.ids.at(-1)??structure.currentEntryId;
 }
 async function settle(r:Attempt){
  if(r.finishing)return;r.finishing=true;if(r.timer!==null)clearTimeout(r.timer);
  // A producer can have returned a logical failure while a native pin/read is
  // still outstanding. Keep the token, pending record and credits until this.
  try{if(r.producer)await r.producer.settled;await r.preparation.settle();}
  catch(error){if(!r.terminal)complete(r,{kind:'failed',intentId:r.intent.intentId,failure:fromKnownError(error,{phase:'cleanup',backend:'none'}),added:0,resourceState:'uncertain'});notify(r,'uncertain',r.terminal??undefined);}
  finally{
   if(!r.terminal)complete(r,{kind:'cancelled',intentId:r.intent.intentId,reason:r.reason??'revoked'});
   if(r.terminal?.kind==='cancelled')notify(r,'cancelled',r.terminal);
   r.token.end();active.delete(r);pending();r.settled();
  }
 }
 async function run(r:Attempt){
  if(r.finishing)return;r.started=true;r.deadline=performance.now()+30000;r.timer=setTimeout(()=>cancel(r,'deadline'),30000);notify(r,'preparing');
  try{
   check(r);const selected=await host.resolveSelection(r.intent.selection,()=>current(r),r.abort.signal);check(r);
   if(selected.length!==r.intent.selection.length||selected.some((row,i)=>row.entryId!==r.intent.selection[i].entryId||row.trackId!==r.intent.selection[i].trackId||typeof row.title!=='string'||!copySourceAsset(row.asset)))throw AppFailure.create(makeFailure('read','integrity','local-corrupt','idb'));
   if(!r.preparation.setPlanned(selected.map(row=>row.trackId)))throw AppFailure.create(makeFailure('transport','internal','owner-unavailable','none'));
   const routing=r.preparation.reserveSources(selected.map(row=>row.asset));check(r);
   if(routing.missing.length){
    r.producer=host.startSources(routing.missing,host.getOwnerProof(),{signal:r.abort.signal,current:()=>current(r),deadlineAt:r.deadline,reserveBlob:r.preparation.reserveBlob});
    const produced=await r.producer.result;
    // Adopt every delivered bundle BEFORE testing current, including a late
    // ready reply after cancellation. It belongs only to this attempt.
    if(produced.kind==='prepared'){r.preparation.stageNew(produced.prepared);}
    else{
     const terminal:IntentTerminal=produced.kind==='failed'?{kind:'failed',intentId:r.intent.intentId,failure:produced.failure,added:0,resourceState:produced.resourceState}:{kind:'cancelled',intentId:r.intent.intentId,reason:r.reason??'revoked'};
     complete(r,terminal);notify(r,produced.resourceState==='uncertain'?'uncertain':produced.kind==='failed'?'failed':'settling',terminal);return;
    }
   }
   check(r);const sources=r.preparation.getSources();
   if(!sources||sources.length!==selected.length)throw AppFailure.create(makeFailure('transport','internal','worker-protocol','none'));
   const entries:Entry[]=selected.map((row,i)=>({id:row.entryId,trackId:row.trackId,title:row.title,src:sources[i].url}));
   if(!r.preparation.bindEntries(entries))throw AppFailure.create(makeFailure('transport','internal','owner-unavailable','none'));
   check(r);const player=host.getPlayer(),structure=player.structure(),afterEntryId=r.intent.placement==='next'?anchor(structure):null;
   // Reorder/shuffle/remove during IO are read here, without preparing again.
   const inserted=r.preparation.commitInsertion({intentId:r.intent.intentId,placement:r.intent.placement,entries,expectedQueueEpoch:structure.queueEpoch,expectedQueueRevision:structure.queueRevision,afterEntryId},player);
   if(inserted.kind==='rejected')throw AppFailure.create(makeFailure('commit','internal',inserted.reason==='limit-exceeded'?'limit-exceeded':'conflict','none'));
   r.committed=true;
   if(r.intent.placement==='next'){
    const prior=tail&&tail.anchor===structure.currentEntryId&&afterEntryId===tail.ids.at(-1)?tail.ids:[];
    tail={anchor:structure.currentEntryId,ids:Object.freeze([...prior,...inserted.addedEntryIds])};
   }
   // Once installed, a timeout/cancel is not a rollback. Preserve this result
   // and let its own save/cleanup finish without changing the selected medium.
   if(r.timer!==null){clearTimeout(r.timer);r.timer=null;}
   let persistence:'saved'|'not-saved'='not-saved';try{persistence=await host.saveLatestQueue(()=>safe(r.execution)&&r.token.current());}catch{/* inserted queue remains session-local */}
   const terminal:IntentTerminal={kind:'inserted',intentId:r.intent.intentId,addedEntryIds:inserted.addedEntryIds,persistence};complete(r,terminal);notify(r,'inserted',terminal);
  }catch(error){
   if(!r.terminal){const terminal:IntentTerminal=r.reason?{kind:'cancelled',intentId:r.intent.intentId,reason:r.reason}:{kind:'failed',intentId:r.intent.intentId,failure:fromKnownError(error,{phase:'transport',backend:'none'}),added:0,resourceState:'settling'};complete(r,terminal);notify(r,terminal.kind==='failed'?'failed':'settling',terminal);}
  }finally{await settle(r);}
 }
 async function pump(){if(pumping)return;pumping=true;try{while(fifo.length){const r=fifo.shift()!;if(!r.finishing)await run(r);}}finally{pumping=false;}}
 function enqueue(value:QueueInsertionIntent,capture:AdmissionCapture):AdmissionResult {
  const intent=copyIntent(value);if(!intent)return {kind:'rejected',reason:'invalid-input'};
  const signature=JSON.stringify(intent),old=history.get(intent.intentId);if(old)return old.signature===signature?{kind:'accepted',handle:old.handle}:{kind:'rejected',reason:'invalid-input'};
  if(!safe(()=>capture.current())||!safe(host.canAccept))return {kind:'rejected',reason:'admission-unavailable'};
  if(active.size>=32)return {kind:'rejected',reason:'pending-limit'};
  const player=host.getPlayer(),reserved=[...active].filter(r=>!r.committed).reduce((sum,r)=>sum+r.intent.selection.length,0);
  if(player.structure().entries.length+reserved+intent.selection.length>1000)return {kind:'rejected',reason:'queue-limit'};
  const token=host.beginActivity();if(!token)return {kind:'rejected',reason:'admission-unavailable'};
  let resolveResult!:(v:IntentTerminal)=>void,resolveSettled!:()=>void;
  const result=new Promise<IntentTerminal>(resolve=>{resolveResult=resolve;}),settled=new Promise<void>(resolve=>{resolveSettled=resolve;});
  const abort=new AbortController();let execution:()=>boolean;
  try{execution=host.captureExecution();}catch{token.end();return {kind:'rejected',reason:'admission-unavailable'};}
  const queueEpoch=player.queueEpoch;let r:Attempt|undefined;
  try{
   const preparation=host.beginSources(intent.selection.map(row=>row.trackId),()=>r?current(r):!abort.signal.aborted&&safe(execution)&&token.current()&&host.getPlayer().queueEpoch===queueEpoch);
   const handle:IntentHandle=Object.freeze({intentId:intent.intentId,result,settled,cancel:()=>{if(r)cancel(r,'user');}});
   r={intent,abort,token,execution,queueEpoch,preparation,producer:null,deadline:Infinity,timer:null,started:false,finishing:false,committed:false,reason:null,terminal:null,result:resolveResult,settled:resolveSettled,handle};
   history.set(intent.intentId,{signature,handle});active.add(r);fifo.push(r);pending();notify(r,'queued');void pump();return {kind:'accepted',handle};
  }catch{token.end();return {kind:'rejected',reason:'incompatible-operation'};}
 }
 return Object.freeze({enqueue,cancelAll(reason:CancelReason='revoked'){for(const r of [...active])cancel(r,reason);},get pendingCount(){return active.size;},get preparing(){return pumping;},whenSettled:()=>Promise.all([...active].map(r=>r.handle.settled)).then(()=>{})});
}
