import {admittedTransaction, closeDatabase, openExistingDatabase, request} from '../storage/database';
import {transactionDone} from '../storage/transaction-done';
import {WRITER_LOCK} from '../storage/asset-reader';

export interface LibraryMembership {readonly version:1; readonly trackId:string; readonly added:boolean}
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const invalid=()=>new Error('Invalid library membership');
const stale=()=>new Error('Library membership operation is no longer current');
function check(current:()=>boolean):void {if(current()!==true)throw stale();}

export function libraryMembershipKey(trackId:string):[string,number,string] {
 if(!uuid(trackId))throw invalid();
 return ['library-membership',1,trackId];
}
export function makeLibraryMembership(trackId:string,added:boolean):LibraryMembership {
 if(!uuid(trackId)||typeof added!=='boolean')throw invalid();
 return Object.freeze({version:1,trackId,added});
}
export function copyLibraryMembership(value:unknown,trackId:string):LibraryMembership|null {
 try {
  if(!uuid(trackId)||value===null||typeof value!=='object')return null;
  const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null)return null;
  const keys=Reflect.ownKeys(value);if(keys.length!==3||!keys.every(k=>typeof k==='string'&&['version','trackId','added'].includes(k)))return null;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const v=descriptors.version, id=descriptors.trackId, added=descriptors.added;
  if(!v||!id||!added||!('value' in v)||!('value' in id)||!('value' in added)||v.value!==1||id.value!==trackId||typeof added.value!=='boolean')return null;
  return makeLibraryMembership(trackId,added.value);
 } catch {return null;}
}

/** At most 10,000 UUIDs per call; only the requested settings keys are read. */
export async function readLibraryTrackIds(trackIds:readonly string[],current:()=>boolean):Promise<ReadonlySet<string>> {
 if(!Array.isArray(trackIds)||trackIds.length>10000||!trackIds.every(uuid))throw invalid();
 check(current);const db=await openExistingDatabase();let tx:IDBTransaction|undefined;let done:Promise<void>|undefined;
 try {
  check(current);tx=admittedTransaction(db,'settings','readonly');done=transactionDone(tx);
  const store=tx.objectStore('settings');const ids=[...new Set(trackIds)];
  const values=await Promise.all(ids.map(async id=>{const key=libraryMembershipKey(id);const [value,present]=await Promise.all([request(store.get(key)),request(store.getKey(key))]);return {value,present};}));check(current);
  const result=new Set<string>();ids.forEach((id,i)=>{const {value,present}=values[i];if(present===undefined){result.add(id);return;}const record=copyLibraryMembership(value,id);if(!record)throw invalid();if(record.added)result.add(id);});
  await done;check(current);return result;
 } catch(error) {if(tx&&done){try{tx.abort();}catch{/* already settled */}try{await done;}catch{/* preserve primary error */}}throw error;}
 finally {closeDatabase(db);}
}

/** A winning commit can exist even if the caller's guard expires after the put. */
export async function addTrackToLibrary(trackId:string,current:()=>boolean):Promise<{changed:boolean}> {
 const key=libraryMembershipKey(trackId);check(current);
 return navigator.locks.request(WRITER_LOCK,async()=>{
  check(current);const db=await openExistingDatabase();let tx:IDBTransaction|undefined;let done:Promise<void>|undefined;
  try {
   check(current);tx=admittedTransaction(db,['tracks','settings'],'readwrite');done=transactionDone(tx);
   const tracks=tx.objectStore('tracks'),settings=tx.objectStore('settings');
   const [track,value,present]=await Promise.all([request(tracks.get(trackId)),request(settings.get(key)),request(settings.getKey(key))]);check(current);
   const descriptor=track&&typeof track==='object'?Object.getOwnPropertyDescriptor(track,'id'):undefined;
   if(!descriptor||!('value' in descriptor)||descriptor.value!==trackId)throw invalid();
   const record=present===undefined?undefined:copyLibraryMembership(value,trackId);if(present!==undefined&&!record)throw invalid();
   const changed=record?.added===false;
   if(changed){check(current);settings.put(makeLibraryMembership(trackId,true),key);}
   await done;check(current);return {changed};
  } catch(error) {if(tx&&done){try{tx.abort();}catch{/* already settled */}try{await done;}catch{/* preserve primary error */}}throw error;}
  finally {closeDatabase(db);}
 });
}
