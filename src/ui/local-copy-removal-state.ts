import * as removal from '../library/local-copy-removal';
import {prepareCopyRemovalRuntime,type CopyRemovalRuntime} from '../playback/copy-removal-runtime';
import type {Activity,ActivityToken} from '../playback/ownership';
import type {SourceReviewReservation,SourceReviewResult} from '../playback/source-review-admission';
import type {LocalAsset,Track} from '../library/library';
import type {RemovalPanelState,RemovalPanelReason,RemovalPanelDeclaration} from './LocalCopyRemovalPanel';

export const COPY_REMOVAL_TRACKING_KEY='pulso-web:copy-removal:pending:v1';
type Tracking=removal.RemovalTracking;
const same=(a:Tracking,b:Tracking)=>a.incarnation===b.incarnation&&a.operationId===b.operationId;
interface TrackingStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
const storage=():TrackingStorage=>sessionStorage;
export function readRemovalTracking(store:()=>TrackingStorage=storage){
 let raw:string|null;
 try{raw=store().getItem(COPY_REMOVAL_TRACKING_KEY);}catch{return {tracking:null,invalid:false,unavailable:true};}
 if(raw===null)return {tracking:null,invalid:false,unavailable:false};
 try{const tracking=raw.length<=256?removal.copyRemovalTracking(JSON.parse(raw)):null;
 return {tracking,invalid:!tracking,unavailable:false};
 }catch{return {tracking:null,invalid:true,unavailable:false};}
}
export function persistRemovalTracking(value:Tracking,store:()=>TrackingStorage=storage):boolean{
 try{const old=readRemovalTracking(store);if(old.invalid||old.unavailable||old.tracking&&!same(old.tracking,value))return false;
 store().setItem(COPY_REMOVAL_TRACKING_KEY,JSON.stringify(value));const read=readRemovalTracking(store);return !!read.tracking&&same(read.tracking,value);
 }catch{return false;}
}
export function clearRemovalTracking(value:Tracking,store:()=>TrackingStorage=storage):boolean{
 try{const read=readRemovalTracking(store);if(read.invalid||read.unavailable)return false;if(!read.tracking)return true;if(!same(read.tracking,value))return false;
 store().removeItem(COPY_REMOVAL_TRACKING_KEY);return store().getItem(COPY_REMOVAL_TRACKING_KEY)===null;
 }catch{return false;}
}
export interface CopyRemovalStartup {readonly pending:readonly Tracking[];readonly unknown:boolean;readonly storageUnavailable:boolean}
export async function scanCopyRemovalStartup(context:removal.RemovalReadContext,core:Pick<typeof removal,'readPendingCopyRemovals'>=removal,store:()=>TrackingStorage=storage):Promise<CopyRemovalStartup>{
 const saved=readRemovalTracking(store);const pending:Tracking[]=saved.tracking?[saved.tracking]:[];
 let unknown=saved.invalid&&!saved.unavailable;
 try{const found=await core.readPendingCopyRemovals(context);if(found.length>32)unknown=true;
 for(const value of found.slice(0,32)){const ref=removal.copyRemovalTracking(value);if(!ref){unknown=true;continue;}if(!pending.some(p=>same(p,ref)))pending.push(ref);}
 }catch{unknown=true;}
 // A stored reference survives empty journals and an absent original incarnation.
 return Object.freeze({pending:Object.freeze(pending),unknown,storageUnavailable:saved.unavailable});
}
export function removalResolved(outcome:removal.RemovalOutcome,tracking:Tracking):boolean{
 if(!outcome.tracking||!same(outcome.tracking,tracking)||outcome.recoveryRequired)return false;
 // A terminal RECORDED receipt speaks about the original attempt. Its current
 // metadata may differ; unknown historical publication is not a pending write.
 if(outcome.preparation==='recorded'){
  if(outcome.state==='removed')return outcome.physical!=='present';
  if(outcome.state==='not-committed')return outcome.publication!=='unpublished';
 }
 return outcome.publication!=='unpublished'&&(outcome.preparation==='not-dispatched'||outcome.preparation==='aborted');
}
export interface RemovalView {
 readonly visible:boolean;readonly state:RemovalPanelState;readonly title:string;readonly reason:RemovalPanelReason|null;
 readonly message:string|null;readonly secondary:readonly string[];readonly summary:removal.RemovalSummary|null;readonly outcome:removal.RemovalOutcome|null;
 readonly revision:number|null;readonly declaration:RemovalPanelDeclaration|null;readonly confirmed:boolean;readonly working:boolean;
 readonly canConfirm:boolean;readonly canContinue:boolean;readonly canInspect:boolean;readonly pendingCount:number;
}
export interface CopyRemovalHost {
 activity:Activity;
 canStart():boolean;
 canRecover():boolean;
 captureRaw():()=>boolean;
 reserve(target:Readonly<LocalAsset>):SourceReviewResult;
 blocking(blocked:boolean,inactive:boolean):void;
 refresh():Promise<void>;
 changed():void;
}
interface Run {
 abort:AbortController;raw:()=>boolean;token:ActivityToken|null;reservation:SourceReviewReservation|null;
 runtime:CopyRemovalRuntime|null;context:removal.RemovalContext|null;plan:removal.RemovalPlan|null;
 continuation:removal.RemovalContinuation|null;tracking:Tracking|null;settlement:Promise<unknown>|null;settling:boolean;cleaned:boolean;
}
const empty:RemovalView={visible:false,state:'blocked',title:'Revisión de retirada anterior',reason:null,message:null,secondary:[],summary:null,outcome:null,revision:null,declaration:null,confirmed:false,working:false,canConfirm:false,canContinue:false,canInspect:false,pendingCount:0};
const safe=(guard:()=>boolean)=>{try{return guard();}catch{return false;}};
const reason=(value:string):RemovalPanelReason=>({busy:'busy',limit:'limit',missing:'missing',corrupt:'corrupt',changed:'changed','runtime-unknown':'runtime-unknown','runtime-unsupported':'transport-incompatible','player-current':'player-current','player-prepared':'player-prepared','queue-pending':'queue-pending','reader-active':'reader-active'} as Record<string,RemovalPanelReason>)[value]??'changed';
/** Trusted composition factory. Dependencies are injectable only for local closure
 * probes; no object from storage can manufacture a plan, context or reservation. */
export function createCopyRemovalController(host:CopyRemovalHost,core:typeof removal=removal,prepareRuntime=prepareCopyRemovalRuntime,store:()=>TrackingStorage=storage){
 let view:RemovalView=empty,run:Run|null=null,disposed=false,unknown=true,pending:Tracking[]=[];
 let initialized=false;
 function publish(patch:Partial<RemovalView>){if(disposed)return;view=Object.freeze({...view,...patch,working:run?.settling?true:patch.working??view.working,pendingCount:pending.length+(unknown?1:0)});host.changed();}
 function gate(){if(!disposed)host.blocking(unknown||pending.length>0||run!==null,run===null&&(unknown||pending.length>0));}
 function own(r:Run){return !disposed&&run===r;}
 function live(r:Run){return own(r)&&!r.abort.signal.aborted&&safe(r.raw)&&(!r.reservation||r.reservation.current());}
 function fresh():Run{return {abort:new AbortController(),raw:host.captureRaw(),token:null,reservation:null,runtime:null,context:null,plan:null,continuation:null,tracking:null,settlement:null,settling:true,cleaned:false};}
 function cleanup(r:Run){
  // The outcome can be visible before its own refresh finishes. Neither a
  // dismissal nor another inspection may release this run during that await.
  if(r.settling||r.cleaned)return;r.cleaned=true;
  if(r.plan)core.releaseCopyRemovalPlan(r.plan);
  r.runtime?.release();r.reservation?.release();r.token?.end();
  if(run===r)run=null;gate();
 }
 function blocked(r:Run,why:RemovalPanelReason,message='No se pudo preparar esta revisión. La copia se conserva.'){
  if(own(r))publish({state:'blocked',reason:why,message,working:false,canConfirm:false,canContinue:false,canInspect:pending.length>0||unknown,revision:null,declaration:null,confirmed:false});
 }
 function add(value:Tracking){if(!pending.some(p=>same(p,value)))pending.push(value);}
 async function result(r:Run,outcome:removal.RemovalOutcome){
  // Outcome bookkeeping survives a stale DB/owner guard. Only this run is
  // cleaned; no stale callback may clear the root's next scope gate.
  if(!own(r))return;
  const current=own(r)&&safe(r.raw)&&!!r.reservation?.current(),tracking=r.tracking;
  let resolved=!!tracking&&current&&removalResolved(outcome,tracking);
  if(resolved&&tracking){if(clearRemovalTracking(tracking,store))pending=pending.filter(p=>!same(p,tracking));else{resolved=false;unknown=true;}}
  if(!resolved&&tracking)add(tracking);
  publish({state:resolved?'result':'uncertain',outcome,working:false,canConfirm:false,canContinue:false,canInspect:!resolved||pending.length>0||unknown,revision:null,declaration:null,confirmed:false,reason:null,
   message:resolved&&(outcome.publication==='unknown'||outcome.physical==='unknown')?'El registro confirma que el intento terminó. El vínculo actual de la copia no puede deducirse de ese resultado histórico.':outcome.primary?'No se pudo completar toda la retirada. Se conserva el resultado comprobado y el seguimiento necesario.':null});
  if(outcome.publication==='unpublished'&&current){try{await host.refresh();}catch{if(own(r))publish({secondary:[...view.secondary,'El cambio confirmado se conserva. No se pudo actualizar la vista; vuelve a comprobar los archivos locales.']});}}
  // Hold the reservation through settlement + refresh + explicit dismissal.
  gate();
 }
 async function reserve(r:Run,target:Readonly<LocalAsset>):Promise<boolean>{
  r.token?.end();r.token=null;
  if(!live(r))return false;
  const reserved=host.reserve(target);if(reserved.kind==='blocked'){blocked(r,reason(reserved.reason));return false;}
  r.reservation=reserved.reservation;
  // Acquisition invalidated discovery admission. Never capture sourceReview's
  // unoccupied guard here; reservation.current is the occupied authority.
  r.raw=host.captureRaw();
  const current=()=>live(r);
  const runtime=await prepareRuntime(target,current);
  if(runtime.kind==='blocked'){blocked(r,reason(runtime.reason));return false;}
  r.runtime=runtime.runtime;
  if(!current())return false;
  r.context={signal:r.abort.signal,current,runtimeProtectionCurrent:asset=>current()&&runtime.runtime.current(asset)};
  return true;
 }
 function begin(title:string):Run{
  const r=fresh();run=r;host.blocking(true,false);
  publish({...empty,visible:true,title,state:'preparing',working:true});return r;
 }
 async function start(track:Track){
  if(disposed||!initialized||run||unknown||pending.length||!host.canStart()||track.assetId===null)return;
  const r=begin(track.title);r.token=host.activity.begin();
  const work=(async()=>{
   try{
    if(!r.token||!live(r)){blocked(r,'busy');return;}
    const found=await core.discoverCopyRemoval({namespace:'local',trackId:track.id,expectedTrackRevision:track.revision},{signal:r.abort.signal,current:()=>live(r)&&!!r.token?.current()});
    // Read token MUST end before sourceReview.reserve (idle mandatory).
    r.token.end();r.token=null;
    if(!live(r))return;
    if(found.kind==='blocked'){blocked(r,reason(found.reason));return;}
    if(!await reserve(r,found.target)||!live(r)||!r.context)return;
    const preview=await core.planCopyRemoval(found.candidate,r.context);
    if(preview.kind==='ready')r.plan=preview.plan;
    if(!live(r))return;
    if(preview.kind==='blocked'){blocked(r,reason(preview.reason));return;}
    r.tracking=preview.tracking;
    publish({state:'ready',working:false,summary:preview.summary,revision:preview.planRevision,declaration:null,confirmed:false,canConfirm:true,message:null});
   }catch{if(own(r))blocked(r,'database-unavailable');}
   finally{
    r.token?.end();r.token=null;
    r.settling=false;if(own(r))publish({working:false});
    if(!live(r)){if(own(r))blocked(r,'changed',r.abort.signal.aborted?'Revisión detenida. No se ha autorizado una retirada nueva.':'La revisión dejó de estar vigente. Conserva la copia y vuelve a revisar.');cleanup(r);}
    else if(view.state!=='ready')cleanup(r);
   }
  })();r.settlement=work;await work;
 }
 async function inspect(){
  if(disposed||!initialized||view.working||run?.settling||!host.canRecover())return;
  if(run){cleanup(run);}
  // Release ONLY this feature's inactive unresolved key before idle admission.
  host.blocking(true,false);
  const tracking=pending[0];
  const r=begin('Revisión de retirada anterior');r.tracking=tracking??null;r.token=host.activity.begin();
  const work=(async()=>{
   try{
    if(!r.token||!live(r)){blocked(r,'busy');return;}
    if(!tracking){
     const snapshot=await scanCopyRemovalStartup({signal:r.abort.signal,current:()=>live(r)},core,store);
     if(live(r)){pending=[...snapshot.pending];unknown=snapshot.unknown;publish({state:'uncertain',working:false,canInspect:true,message:unknown?'El seguimiento histórico no es legible. Su resultado sigue desconocido; no se autoriza otro intento.':'La lectura ha terminado. Revisa cada retirada pendiente por separado.'});}
     return;
    }
    const target=await core.readCopyRemovalTarget(tracking,{signal:r.abort.signal,current:()=>live(r)});
    r.token.end();r.token=null;
    if(!live(r))return;
    if(!target){publish({state:'uncertain',working:false,canInspect:true,message:'No podemos recuperar la biblioteca original o el destino de esta retirada. Su resultado histórico sigue desconocido.'});return;}
    if(!await reserve(r,target)||!live(r)||!r.context)return;
    const inspected=await core.inspectCopyRemoval(tracking,r.context);
    if(!live(r)){if(own(r))publish({state:'uncertain',working:false,canInspect:true,message:'El resultado necesita una revisión con el control actual.'});return;}
    if(inspected.continuation&&inspected.planRevision!==null){
     r.continuation=inspected.continuation;
     publish({state:'result',outcome:inspected.outcome,summary:inspected.summary,revision:inspected.planRevision,declaration:null,confirmed:false,working:false,canContinue:true,canInspect:false,message:'La copia sigue pendiente. Continuar requiere una nueva declaración y confirmación.'});
    }else await result(r,inspected.outcome);
   }catch{if(own(r))publish({state:'uncertain',working:false,canInspect:true,message:'No se pudo comprobar el resultado. Conservamos el seguimiento.'});}
   finally{r.token?.end();r.token=null;r.settling=false;if(own(r))publish({working:false});if(!r.continuation)cleanup(r);else gate();}
  })();r.settlement=work;await work;
 }
 async function dispatch(expected:RemovalView,consent:removal.RemovalConsent,continuing:boolean){
  const r=run;
  if(view!==expected||!r||!live(r)||!r.context||view.working||r.settling||!view.confirmed||!view.declaration||consent.declaration!==view.declaration||consent.planRevision!==view.revision||consent.confirmRemoveThisCopy!==true||!r.tracking)return;
  if(continuing?!view.canContinue||!r.continuation:!view.canConfirm||!r.plan)return;
  if(!persistRemovalTracking(r.tracking,store)){
   publish({message:'No se puede guardar y comprobar el seguimiento en esta pestaña. No se ha enviado la retirada; puedes conservar la copia y cerrar la revisión.',canConfirm:false,canContinue:false});return;
  }
  r.settling=true;add(r.tracking);publish({state:'working',working:true,canConfirm:false,canContinue:false,declaration:null,confirmed:false});gate();
  const work=(async()=>{try{const outcome=continuing?await core.continueCopyRemoval(r.continuation!,consent,r.context!):await core.confirmCopyRemoval(r.plan!,consent,r.context!);await result(r,outcome);}
   catch{if(own(r))publish({state:'uncertain',working:false,canInspect:true,message:'No se pudo confirmar el resultado. El seguimiento se conserva; revisa su estado.'});}
   finally{r.settling=false;if(own(r))publish(view.state==='working'?{working:false,state:'uncertain',canInspect:true}:{working:false});if(disposed)cleanup(r);else gate();}
  })();r.settlement=work;await work;
 }
 async function cancel(expected:RemovalView){
  const r=run;if(view!==expected||!r)return;
  r.abort.abort();
  // Wait for the exact preparation/confirm/continuation promise, including
  // refresh. cancelCopyRemoval also waits native settlement of its own plan.
  const settlement=r.settlement;
  if(r.plan)await core.cancelCopyRemoval(r.plan);
  await settlement;
  if(own(r)&&view.state==='ready')publish({state:'result',working:false,canConfirm:false,canContinue:false,revision:null,declaration:null,confirmed:false,message:'Revisión detenida. No se ha autorizado una retirada nueva.'});
  if(own(r)){cleanup(r);publish({working:false,canConfirm:false,canContinue:false});}
 }
 function callbacks(expected:RemovalView){
  const valid=()=>!disposed&&view===expected;
  return {
   declaration(value:RemovalPanelDeclaration){if(valid()&&run&&live(run)&&!view.working)publish({declaration:value,confirmed:false});},
   confirmed(value:boolean){if(valid()&&run&&live(run)&&!view.working)publish({confirmed:value});},
   confirm:(consent:removal.RemovalConsent)=>dispatch(expected,consent,false),
   continue:(consent:removal.RemovalConsent)=>dispatch(expected,consent,true),
   cancel:()=>valid()?cancel(expected):Promise.resolve(),
   inspect:()=>valid()?inspect():Promise.resolve(),
   close(){if(!valid()||view.working||run?.settling)return false;if(run)cleanup(run);publish({visible:false,canConfirm:false,canContinue:false,revision:null,declaration:null,confirmed:false});gate();return true;},
   show(){if(valid())publish({visible:true});},
  };
 }
 return {
  getView:()=>view,callbacks,start,
  initialize(snapshot:CopyRemovalStartup){if(initialized||disposed)return;initialized=true;pending=[...snapshot.pending];unknown=snapshot.unknown;publish({visible:pending.length>0||unknown,state:'uncertain',canInspect:pending.length>0||unknown,message:unknown?'No se pudo comprobar todo el seguimiento histórico. Su resultado sigue desconocido.':snapshot.storageUnavailable?'El seguimiento de pestaña no está disponible. Podrás revisar una copia, pero confirmar requiere guardarlo y comprobarlo.':null});gate();},
  async dispose(){if(disposed)return;disposed=true;const r=run;if(!r)return;r.abort.abort();if(r.plan)await core.cancelCopyRemoval(r.plan);await r.settlement;cleanup(r);},
 };
}
