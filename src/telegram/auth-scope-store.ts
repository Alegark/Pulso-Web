import {account,parseScope,record,sameScope,uuid,type AuthScope} from './auth-protocol';
export const CONTROL_DB='pulso-web:telegram:control:v1';
export function sessionDatabase(slot:string):string {if(!uuid(slot))throw new Error('invalid');return `pulso-web:telegram:session:v1:${slot}`;}
interface SlotRecord {scope:AuthScope; tombstone:boolean; deleted:boolean; deletion?:'pending'|'error'|'completed'}
/** Safe internal storage boundary; raw IDB errors never cross the coordinator. */
export class AuthStorageError extends Error {constructor(){super('storage');}}
export interface AuthScopeStore {
 register(scope:AuthScope,current:()=>boolean,signal?:AbortSignal):Promise<void>;
 bind(scope:AuthScope,accountId:string,namespaceId:string,current:()=>boolean,signal?:AbortSignal):Promise<AuthScope>;
 tombstone(scope:AuthScope):Promise<void>;
 cleanup(scope:AuthScope):Promise<boolean>;
}
/** Own control DB only. A persisted tombstone is permanent; slots are never reused. */
export class IndexedAuthScopeStore implements AuthScopeStore {
 constructor(private readonly idb:IDBFactory){}
 private open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{let settled=false;const r=this.idb.open(CONTROL_DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('slots');r.onsuccess=()=>{if(settled){r.result.close();return;}settled=true;r.result.onversionchange=()=>r.result.close();resolve(r.result);};r.onerror=r.onblocked=()=>{settled=true;reject(new AuthStorageError());};});}
 private async update(scope:AuthScope,fn:(old:SlotRecord|undefined)=>SlotRecord,signal?:AbortSignal):Promise<SlotRecord>{
  const valid=parseScope(scope);if(!valid)throw new Error('invalid');
  let db:IDBDatabase;try{db=await this.open();}catch{throw new AuthStorageError();}return new Promise((resolve,reject)=>{
   let tx:IDBTransaction;
   try{tx=db.transaction('slots','readwrite');}catch{db.close();reject(new AuthStorageError());return;}
   let result:SlotRecord;
   // A guard can synchronously abort via expire(). Every path tolerates a finished tx.
   const abort=()=>{try{tx.abort();}catch{/* Already settled. */}};
   const finish=()=>{signal?.removeEventListener('abort',abort);db.close();};
   tx.oncomplete=()=>{finish();resolve(result);};
   tx.onabort=()=>{finish();reject(new AuthStorageError());};
   tx.onerror=()=>{abort();};
   signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted){abort();return;}
   try{
    const store=tx.objectStore('slots'),r=store.get(valid.sessionSlotId);
    r.onsuccess=()=>{try{
     let old:SlotRecord|undefined;
     if(r.result!==undefined){const v:unknown=r.result;if(!record(v,['scope','tombstone','deleted','deletion'],['scope','tombstone','deleted'])||!parseScope(v.scope)||typeof v.tombstone!=='boolean'||typeof v.deleted!=='boolean'||(v.deletion!==undefined&&!['pending','error','completed'].includes(v.deletion as string)))throw new AuthStorageError();old=v as unknown as SlotRecord;}
     result=fn(old);store.put(result,valid.sessionSlotId);
    }catch{abort();}};
   }catch{abort();}
  });
 }

 async register(scope:AuthScope,current:()=>boolean,signal?:AbortSignal):Promise<void>{await this.update(scope,old=>{if(!current()||scope.accountId!==null||scope.namespaceId!==null||(old&&(old.tombstone||old.scope.accountId!==null||old.scope.ownerId!==scope.ownerId)))throw new Error('scope');return {scope:parseScope(scope)!,tombstone:false,deleted:false};},signal);}
 async bind(scope:AuthScope,accountId:string,namespaceId:string,current:()=>boolean,signal?:AbortSignal):Promise<AuthScope>{
  if(!account(accountId)||!uuid(namespaceId))throw new Error('scope');
  return (await this.update(scope,old=>{if(!current()||!old||old.tombstone||!sameScope(old.scope,scope)||old.scope.accountId!==null)throw new Error('scope');return {scope:{...scope,accountId,namespaceId},tombstone:false,deleted:false};},signal)).scope;
 }
 async tombstone(scope:AuthScope):Promise<void>{await this.update(scope,old=>{if(!old){if(scope.accountId!==null)throw new Error('scope');return {scope:parseScope(scope)!,tombstone:true,deleted:false};}if(old.scope.ownerId!==scope.ownerId||old.scope.sessionSlotId!==scope.sessionSlotId)throw new Error('scope');return {...old,tombstone:true};});}
 async cleanup(scope:AuthScope):Promise<boolean>{
  // Lookup the exact registered slot before deleting; never enumerate origin databases.
  let issue=false;
  const row=await this.update(scope,old=>{
   if(!old||!old.tombstone||old.scope.ownerId!==scope.ownerId)throw new Error('scope');
   if(old.deleted||old.deletion==='pending')return old;
   issue=true;return {...old,deletion:'pending'};
  });
  if(row.deleted)return true;
  if(!issue)return false;
  // deleteDatabase cannot be cancelled. blocked means pending, not "retry required".
  // Late callbacks persist only this exact tombstoned slot, never coordinator/UI state.
  return new Promise<boolean>(resolve=>{
   const reconcile=async(deleted:boolean)=>{
    try{await this.update(scope,old=>{if(!old||!old.tombstone||old.scope.ownerId!==scope.ownerId)throw new Error('scope');return {...old,deleted,deletion:deleted?'completed':'error'};});resolve(deleted);}
    catch{resolve(false);} // Keep durable pending on uncertain journal IO; never re-delete.
   };
   try{const r=this.idb.deleteDatabase(sessionDatabase(scope.sessionSlotId));
    r.onblocked=()=>resolve(false);
    r.onsuccess=()=>{void reconcile(true);};
    r.onerror=()=>{void reconcile(false);};
   }catch{void reconcile(false);}
  });
 }
}
