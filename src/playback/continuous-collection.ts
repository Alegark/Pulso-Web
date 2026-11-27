import type {SongChoice} from '../library/selected-song';
import type {PlayerChange,State} from './player';

export type CollectionSlot =
 | {kind:'album-track';slotKey:string;choice:SongChoice;title:string;artist:string|null;trackId:string|null}
 | {kind:'library-track';slotKey:string;trackId:string;title:string;artist:string|null};
export interface PlayerSnapshot {queueEpoch:number;state:State;currentTrackId:string|null;currentTime:number;duration:number;repeat:'off'|'one'|'all';shuffled:boolean;hasFollowingInQueue:boolean;entryTrackIds:readonly string[]}
export interface ContinuousPrefetchHost {
 canStartPrefetch():boolean;isTrackAvailable(trackId:string):boolean;resolveSlotTrackId(slot:CollectionSlot):string|null;
 downloadSlot(slot:CollectionSlot,signal:AbortSignal):Promise<{state:'ready';trackId:string}|{state:'failed';channelWide:boolean;message?:string}|{state:'cancelled'}>;
 insertNextTracks(trackIds:readonly string[],expectedQueueEpoch:number):Promise<'inserted'|'rejected'|'cancelled'>;
 selectAndPlayTrack(trackId:string,expectedQueueEpoch:number):void;pauseCurrent():void;getPlayerSnapshot():PlayerSnapshot;
 onStateChange(notice:{waitingTitle:string|null;errorMessage:string|null}):void;
}
export function planInitialCollectionQueue(slots:readonly CollectionSlot[],startIndex:number,isAvailable:(id:string)=>boolean){
 const queueTrackIds:string[]=[];let startQueueIndex=-1;
 if(startIndex<0||startIndex>=slots.length)return {queueTrackIds,startQueueIndex};
 for(let i=0;i<slots.length;i++){const id=slots[i].trackId,available=!!id&&isAvailable(id);if(i===startIndex){if(!available)return {queueTrackIds:[],startQueueIndex:-1};startQueueIndex=queueTrackIds.length;}if(available)queueTrackIds.push(id!);else if(i>=startIndex)break;}
 return {queueTrackIds,startQueueIndex};
}
export function shouldTriggerPrefetch(s:PlayerSnapshot){return s.state==='playing'&&s.repeat!=='one'&&!s.shuffled&&!s.hasFollowingInQueue&&Number.isFinite(s.duration)&&s.duration>0&&Number.isFinite(s.currentTime)&&s.currentTime>=0&&(s.duration<=45||s.duration-s.currentTime<=45||s.currentTime/s.duration>=0.6);}
export interface CollectionContext {queueEpoch:number;kind:'album'|'playlist'|'collection';slots:readonly CollectionSlot[];failedSlots:Set<string>;remoteBlocked:boolean;prefetchingSlotKey:string|null;repeat:'off'|'one'|'all'}
export function nextPendingSlot(context:CollectionContext,currentTrackId:string|null,resolve:(slot:CollectionSlot)=>string|null,isAvailable:(id:string)=>boolean){
 const current=context.slots.findIndex(slot=>resolve(slot)===currentTrackId&&currentTrackId!==null);if(current<0||context.prefetchingSlotKey!==null)return null;
 const count=context.repeat==='all'?context.slots.length-1:context.slots.length-current-1;
 for(let offset=1;offset<=count;offset++){const index=(current+offset)%context.slots.length,slot=context.slots[index];if(context.failedSlots.has(slot.slotKey))continue;const id=resolve(slot);return id&&isAvailable(id)?{kind:'already-available' as const,trackId:id,startSlotIndex:index}:{kind:'needs-download' as const,slot,slotIndex:index};}return null;
}
export function createContinuousCollectionController(host:ContinuousPrefetchHost){
 let context:CollectionContext|null=null,flight:AbortController|null=null,waiting=false,suppressPause=false,flightOrigin:string|null=null,notice={waitingTitle:null as string|null,errorMessage:null as string|null};
 const emit=(waitingTitle:string|null,errorMessage:string|null)=>{notice={waitingTitle,errorMessage};host.onStateChange(notice);};
 const resolved=new Map<string,string>();
 const resolve=(slot:CollectionSlot)=>resolved.get(slot.slotKey)??host.resolveSlotTrackId(slot);
 const cancel=()=>{flight?.abort();flight=null;flightOrigin=null;if(context)context.prefetchingSlotKey=null;waiting=false;emit(null,null);};
 const clear=()=>{cancel();context=null;resolved.clear();};
 const pending=()=>{if(!context)return null;const snapshot=host.getPlayerSnapshot();context.repeat=snapshot.repeat;return nextPendingSlot(context,snapshot.currentTrackId,resolve,host.isTrackAvailable);};
 const run=async()=>{
  const ctx=context;if(!ctx||flight)return;const target=pending();if(!target){if(waiting){waiting=false;emit(null,'No se pudo preparar la siguiente canción.');}return;}
  const index=target.kind==='already-available'?target.startSlotIndex:target.slotIndex,slot=ctx.slots[index];
  if(target.kind==='needs-download'&&(ctx.remoteBlocked||!host.canStartPrefetch())){if(waiting){waiting=false;emit(null,'No se pudo preparar la siguiente canción.');}return;}
  const abort=new AbortController();flight=abort;flightOrigin=host.getPlayerSnapshot().currentTrackId;ctx.prefetchingSlotKey=slot.slotKey;
  const valid=()=>context===ctx&&flight===abort&&!abort.signal.aborted&&host.getPlayerSnapshot().queueEpoch===ctx.queueEpoch;
  try{
   const result=target.kind==='already-available'?{state:'ready' as const,trackId:target.trackId}:await host.downloadSlot(slot,abort.signal);
   if(!valid())return;
   let trackId:string|null=null,start=index;
   if(result.state==='ready'){trackId=result.trackId;resolved.set(slot.slotKey,trackId);}
   else if(result.state==='failed'){
    ctx.failedSlots.add(slot.slotKey);if(result.channelWide)ctx.remoteBlocked=true;
    for(let i=index+1;i<ctx.slots.length;i++){const id=resolve(ctx.slots[i]);if(id&&host.isTrackAvailable(id)){trackId=id;start=i;break;}}
   }
   if(trackId){const ids=[trackId];for(let i=start+1;i<ctx.slots.length;i++){const id=resolve(ctx.slots[i]);if(!id||!host.isTrackAvailable(id))break;ids.push(id);}
    const inserted=await host.insertNextTracks(ids,ctx.queueEpoch);if(!valid())return;
    if(waiting&&inserted==='inserted'){waiting=false;emit(null,null);host.selectAndPlayTrack(trackId,ctx.queueEpoch);}
    else if(waiting){waiting=false;emit(null,'No se pudo preparar la siguiente canción.');}
   }else if(waiting){waiting=false;emit(null,'No se pudo preparar la siguiente canción.');}
  }catch{if(valid()){ctx.failedSlots.add(slot.slotKey);ctx.remoteBlocked=true;if(waiting){waiting=false;emit(null,'No se pudo preparar la siguiente canción.');}}}
  finally{if(flight===abort){flight=null;flightOrigin=null;ctx.prefetchingSlotKey=null;}}
 };
 return {
  activate(input:{queueEpoch:number;kind:'album'|'playlist'|'collection';slots:readonly CollectionSlot[]}){clear();context={...input,failedSlots:new Set(),remoteBlocked:false,prefetchingSlotKey:null,repeat:'off'};},
  observePlayer(change:PlayerChange){if(!context)return;const s=host.getPlayerSnapshot();if(s.queueEpoch!==context.queueEpoch||s.shuffled||!s.currentTrackId){clear();return;}if(flight&&flightOrigin!==s.currentTrackId){cancel();return;}if(change==='state'&&s.state==='paused'&&!suppressPause){cancel();return;}if(change==='state'&&s.state==='ended'&&!s.hasFollowingInQueue&&s.repeat!=='one'){if(flight||pending()){waiting=true;emit('Preparando siguiente canción…',null);void run();}return;}if(shouldTriggerPrefetch(s)&&!context.remoteBlocked)void run();},
  hasNextPending(){return !!flight||!!pending();},
  requestNextPending(){if(!context||(!flight&&!pending()))return false;suppressPause=true;try{host.pauseCurrent();}finally{suppressPause=false;}waiting=true;context.remoteBlocked=false;emit('Preparando siguiente canción…',null);void run();return true;},
  cancelPrefetch:cancel,clear,
 };
}
