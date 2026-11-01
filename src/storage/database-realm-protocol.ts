/** Control plane only. Business requests and owner proofs use their own protocols. */
export const REALM_PROTOCOL='pulso-idb-realm' as const;
export const REALM_VERSION=1 as const;
export type RealmKind='import'|'recovery'|'batch'|'copies';
export type RealmLifecycle='blocked'|'versionchange'|'version-incompatible'|'connection-closed';
type Header={protocol:typeof REALM_PROTOCOL;version:1};
export type RealmControl=Header & (
 |{type:'bind';attempt:string;kind:RealmKind}
 |{type:'bound';attempt:string}
 |{type:'anomaly';attempt:string;sequence:number;state:RealmLifecycle}
 |{type:'revoke'|'retired';attempt:string;sequence:number}
 |{type:'not-ready';attempt:string;reason:'schema-not-ready'}
 |{type:'sw-anomaly';state:RealmLifecycle}
 |{type:'revalidate';requestId:string;ownerProof:string}
 |{type:'revalidated';requestId:string;state:RealmLifecycle|'ready'|'schema-not-ready'}
);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
export const isRealmLifecycle=(v:unknown):v is RealmLifecycle=>typeof v==='string'&&['blocked','versionchange','version-incompatible','connection-closed'].includes(v);
/** Reads only own data descriptors; hostile reflection traps fail closed. */
export function copyRealmControl(value:unknown):RealmControl|null {
 try{
  if(!value||typeof value!=='object'||![null,Object.prototype].includes(Object.getPrototypeOf(value)))return null;
  const descriptors=Object.getOwnPropertyDescriptors(value),result:Record<string,unknown>={};
  for(const key of Reflect.ownKeys(descriptors)){
   if(typeof key!=='string')return null;
   const d=descriptors[key];if(!('value'in d)||!d.enumerable)return null;
   Object.defineProperty(result,key,{value:d.value,enumerable:true,configurable:true,writable:true});
  }
  if(result.protocol!==REALM_PROTOCOL||result.version!==1)return null;
  let fields:string[];
  switch(result.type){
   case 'bind':fields=['attempt','kind'];if(!['import','recovery','batch','copies'].includes(result.kind as string))return null;break;
   case 'bound':fields=['attempt'];break;
   case 'anomaly':fields=['attempt','sequence','state'];if(!isRealmLifecycle(result.state))return null;break;
   case 'retired':case 'revoke':fields=['attempt','sequence'];break;
   case 'not-ready':fields=['attempt','reason'];if(result.reason!=='schema-not-ready')return null;break;
   case 'sw-anomaly':fields=['state'];if(!isRealmLifecycle(result.state))return null;break;
   case 'revalidate':fields=['requestId','ownerProof'];if(typeof result.ownerProof!=='string'||!/^pulso-web:local:owner:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(result.ownerProof))return null;break;
   case 'revalidated':fields=['requestId','state'];if(!isRealmLifecycle(result.state)&&result.state!=='ready'&&result.state!=='schema-not-ready')return null;break;
   default:return null;
  }
  const expected=['protocol','version','type',...fields];
  if(Object.keys(result).length!==expected.length||expected.some(key=>!Object.hasOwn(result,key)))return null;
  if(fields.includes('attempt')&&!uuid(result.attempt)||fields.includes('requestId')&&!uuid(result.requestId))return null;
  if(fields.includes('sequence')&&(!Number.isSafeInteger(result.sequence)||Number(result.sequence)<=0))return null;
  return result as RealmControl;
 }catch{return null;}
}
export function realmControl<T extends Omit<RealmControl,'protocol'|'version'>>(message:T):T&Header {return {protocol:REALM_PROTOCOL,version:1,...message};}
