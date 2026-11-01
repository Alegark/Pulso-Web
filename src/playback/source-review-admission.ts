import type {LocalAsset} from '../library/library';
import type {Activity} from './ownership';
import type {createLocalCopyProtection,SourceReservationBlockedReason} from './local-copy-protection';

type Protection=ReturnType<typeof createLocalCopyProtection>;
export interface SourceReviewReservation {
 current():boolean;
 /** Caller must wait for its exact attempt to settle before releasing. */
 release():void;
}
export type SourceReviewResult=
 | {kind:'reserved';reservation:SourceReviewReservation}
 | {kind:'blocked';reason:SourceReservationBlockedReason|'busy'|'admission-unavailable'};
const safe=(guard:()=>boolean)=>{try{return guard();}catch{return false;}};

/** Root-only admission. This capability never reads, changes or deletes files.
 * The future review caller receives a handle, never the registry or its capture.
 * An occupied but stale attempt remains excluded until its own settlement. */
export function createSourceReviewAdmission(host:{
 protection:Protection;
 activity:Activity;
 canReserve():boolean;
 captureCurrent():()=>boolean;
 changed():void;
}) {
 let epoch=0;
 const hasReservation=()=>host.protection.hasReservation();
 const canPrepare=()=>!hasReservation()&&host.protection.canPrepare();
 const notify=()=>{try{host.changed();}catch{/* Notification is not admission. */}};
 function captureCurrent(){
  const saved=epoch;
  let guard:()=>boolean;
  try{guard=host.captureCurrent();}catch{guard=()=>false;}
  return()=>saved===epoch&&!hasReservation()&&safe(guard);
 }
 function reserve(target:Readonly<LocalAsset>):SourceReviewResult {
  if(hasReservation())return {kind:'blocked',reason:'reservation-active'};
  // Existing writes, reads, workers and uncertain outcomes must settle first.
  if(!safe(host.canReserve)||!host.activity.idle)return {kind:'blocked',reason:'busy'};
  const current=captureCurrent();
  if(!current())return {kind:'blocked',reason:'admission-unavailable'};
  const operation=host.activity.begin();
  if(!operation)return {kind:'blocked',reason:'admission-unavailable'};
  let result:ReturnType<Protection['reserve']>;
  try{result=host.protection.reserve(host.protection.capture(),target);}
  catch{operation.end();return {kind:'blocked',reason:'invalid-capture'};}
  if(result.kind==='blocked'){operation.end();return result;}
  ++epoch;const acquired=epoch,owned=result.reservation;
  let released=false;
  const reservation:SourceReviewReservation=Object.freeze({
   current:()=>!released&&epoch===acquired&&operation.current()&&owned.current(),
   release(){
    if(released)return;released=true;
    // Registry release is identity-bound; this token only ends its own Activity.
    owned.release();++epoch;operation.end();notify();
   },
  });
  notify();return Object.freeze({kind:'reserved',reservation});
 }
 return Object.freeze({hasReservation,canPrepare,captureCurrent,reserve});
}
