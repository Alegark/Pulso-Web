import {eventKeys,increment,MAX_BYTES,operationValues,plain,resultKeys,validResult,type DiagnosticEvent,type Operation,type Result} from './contract';
export interface Handle { readonly diagnosticHandle: true }
export interface SessionSnapshot { readonly enabled:boolean; readonly revision:number; readonly events:readonly Readonly<DiagnosticEvent>[]; readonly droppedRecords:number; readonly rejectedRecords:number }
const snapshots=new WeakSet<object>();
export function isSessionSnapshot(value:unknown):value is SessionSnapshot {return !!value&&typeof value==='object'&&snapshots.has(value);}
/** Weak issuance table: no pending-operation list and no retained business objects. */
export function createDiagnosticSession(uuid:()=>string=()=>crypto.randomUUID()) {
 let epoch=Symbol();let sequence=0,enabled=false,dropped=0,rejected=0,revision=0;
 let events:Readonly<DiagnosticEvent>[]=[];
 const issued=new WeakMap<object,{id:string;operation:Operation;epoch:symbol;capture:boolean;current:()=>boolean;used:Set<string>}>();
 const listeners=new Set<()=>void>();
 let snapshot:SessionSnapshot=Object.freeze({enabled,revision,events:Object.freeze([]),droppedRecords:dropped,rejectedRecords:rejected});
 snapshots.add(snapshot);
 function publish(){snapshot=Object.freeze({enabled,revision:(revision=increment(revision)),events:Object.freeze([...events]),droppedRecords:dropped,rejectedRecords:rejected});snapshots.add(snapshot);for(const fn of listeners)try{fn();}catch{/* observers cannot affect product */}}
 function reset(keepEnabled:boolean){epoch=Symbol();enabled=keepEnabled;events=[];sequence=0;dropped=0;rejected=0;publish();}
 return {
  getSnapshot:()=>snapshot,
  subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
  setEnabled(value:boolean){if(value!==enabled)reset(value);},
  clear(){reset(enabled);},
  resetScope(){reset(false);},
  // A review's scope survives new records, but never a clear/consent/ownership transition.
  scope(){const saved=epoch;return()=>saved===epoch;},
  begin(operation:Operation,current:()=>boolean):Handle|null {
   try{if(!operationValues.includes(operation)||!current())return null;
    const id=uuid();if(typeof id!=='string'||id.length!==36||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))return null;
    const handle=Object.freeze({diagnosticHandle:true as const});issued.set(handle,{id,operation,epoch,capture:enabled,current,used:new Set()});return handle;
   }catch{return null;}
  },
  complete(handle:Handle|null,value:unknown,slot:'primary'|'refresh'|'cleanup'='primary') {
   try{
    if(!handle)return;const meta=issued.get(handle);if(!meta||meta.epoch!==epoch||!meta.current()||!meta.capture||!enabled)return;
    if(!['primary','refresh','cleanup'].includes(slot)||meta.used.has(slot))return;
    const copy=plain(value,resultKeys);if(!copy||!validResult(copy)){rejected=increment(rejected);publish();return;}
    meta.used.add(slot);
    if(sequence===2147483647){dropped=increment(dropped);publish();return;}
    const event:Record<string,unknown>={sequence:++sequence,correlationId:meta.id,operation:meta.operation};for(const key of resultKeys)event[key]=copy[key];
    // Copy only validated primitive fields. No caller-owned references reach the ring.
    const safe=Object.freeze(event) as unknown as Readonly<DiagnosticEvent>;
    events.push(safe);
    while(events.length>100||new TextEncoder().encode(JSON.stringify(events)).byteLength>MAX_BYTES){events.shift();dropped=increment(dropped);}
    publish();
   }catch{/* diagnostics never throws into a product operation */}
  },
  finish(handle:Handle|null){if(handle)issued.delete(handle);}
 };
}
export type DiagnosticSession=ReturnType<typeof createDiagnosticSession>;
// Keep the exact schema visible to type consumers without exposing internal issuance state.
export const diagnosticFields=eventKeys;
export type {Result};
