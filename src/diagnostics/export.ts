import {eventKeys,MAX_BYTES,plain,validEvent,type DiagnosticEvent} from './contract';
import {isSessionSnapshot,type SessionSnapshot} from './session';
export const capabilityFields=['indexedDbApi','webLocksApi','broadcastChannelApi','opfsApi','serviceWorkerApi','storageEstimateApi','storageOperation','observedBackend','observedTransport'] as const;
export type CapabilityField=typeof capabilityFields[number];
export type Capabilities=Readonly<Record<CapabilityField,string>>;
export const limitValues={mode:'local',sdk:'not-integrated',browserEvidence:'partial',physicalEvidence:'pending'} as const;
export const limitFields=Object.keys(limitValues) as (keyof typeof limitValues)[];
export const fieldSets={errors:eventKeys,capabilities:capabilityFields,limits:limitFields};
export type Dataset=keyof typeof fieldSets;
export type Selection=Record<Dataset,readonly string[]>;
export interface Review { readonly json:string; readonly bytes:number }
const reviews=new WeakMap<Review,string>();
function selected(value:unknown,allowed:readonly string[]):string[] {
 if(!Array.isArray(value)||value.length>allowed.length)throw Error('invalid-selection');
 const copy:string[]=[];
 for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!('value'in d)||typeof d.value!=='string'||!allowed.includes(d.value)||copy.includes(d.value))throw Error('invalid-selection');copy.push(d.value);}
 if(Reflect.ownKeys(value).length!==value.length+1)throw Error('invalid-selection');
 return allowed.filter(k=>copy.includes(k));
}
function capabilityValue(key:string,value:unknown){
 const values=key==='storageOperation'?['not-observed','succeeded','failed','unknown']:key==='observedBackend'?['idb','opfs','unknown']:key==='observedTransport'?['sw','bounded-blob','unknown']:['available','unavailable','unknown'];
 if(typeof value!=='string'||!values.includes(value))throw Error('invalid-capability');return value;
}
/** Synchronous bounded projection. Serialize only fresh closed primitive DTOs. */
export function projectReview(snapshot:SessionSnapshot,selection:Selection,capabilities:Capabilities):Review {
 if(!isSessionSnapshot(snapshot))throw Error('unissued-snapshot');
 const s=plain(selection,['errors','capabilities','limits']);if(!s)throw Error('invalid-selection');
 const fields={errors:selected(s.errors,eventKeys),capabilities:selected(s.capabilities,capabilityFields),limits:selected(s.limits,limitFields)};
 if(!Object.values(fields).some(a=>a.length))throw Error('empty-selection');
 const datasets:Record<string,unknown>=Object.create(null);
 if(fields.errors.length){
  const state=plain(snapshot,['enabled','revision','events','droppedRecords','rejectedRecords']);
  if(!state||!Array.isArray(state.events)||state.events.length>100)throw Error('invalid-snapshot');
  const rows:Record<string,unknown>[]=[];
  for(let i=0;i<state.events.length;i++){
   const d=Object.getOwnPropertyDescriptor(state.events,String(i));if(!d||!('value'in d))throw Error('invalid-event');
   const e=plain(d.value,eventKeys);if(!e||!validEvent(e))throw Error('invalid-event');
   const row:Record<string,unknown>=Object.create(null);for(const key of fields.errors)row[key]=e[key as keyof DiagnosticEvent];rows.push(row);
  }
  datasets.errors=rows;
 }
 if(fields.capabilities.length){const c=plain(capabilities,capabilityFields);if(!c)throw Error('invalid-capabilities');const row:Record<string,string>=Object.create(null);for(const key of fields.capabilities)row[key]=capabilityValue(key,c[key]);datasets.capabilities=row;}
 if(fields.limits.length){const row:Record<string,string>=Object.create(null);for(const key of fields.limits)row[key]=limitValues[key as keyof typeof limitValues];datasets.limits=row;}
 const json=JSON.stringify({format:'pulso-web-diagnostics',version:1,datasets},null,2),bytes=new TextEncoder().encode(json).byteLength;
 if(bytes>MAX_BYTES)throw Error('projection-limit');
 const review=Object.freeze({json,bytes});reviews.set(review,json);return review;
}
export function serializeReviewed(review:Review):string {
 const json=reviews.get(review);if(json===undefined)throw Error('unissued-review');return json;
}
