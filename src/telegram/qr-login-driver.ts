import {dataRecord} from './sources-protocol';
import {parseQrLoginChallenge,type QrLoginChallenge} from './qr-login-protocol';
export interface QrLoginTransport {
 exportToken(signal:AbortSignal):Promise<unknown>;
 importToken(dcId:number,token:Uint8Array,signal:AbortSignal):Promise<unknown>;
 authorize(signal:AbortSignal):Promise<void>;
 current():boolean;
}
/** Explicit check/renew: no SMS, polling, generic RPC, or automatic account authorization. */
export function createQrLoginDriver(transport:QrLoginTransport,clock:()=>number=Date.now){
 let closed=false,started=false,startedAt=0,flight=false;
 const valid=(signal:AbortSignal,checkDeadline=true)=>{if(closed||signal.aborted||!transport.current())throw Error('cancelled');if(checkDeadline&&started&&clock()-startedAt>600000)throw Error('qr-expired');};
 const token=(value:unknown):value is Uint8Array=>value instanceof Uint8Array&&value.byteLength>=16&&value.byteLength<=128;
 async function step(signal:AbortSignal,begin:boolean):Promise<QrLoginChallenge|null>{
  valid(signal);if(flight||begin===started)throw Error('unsupported');if(begin){started=true;startedAt=clock();}flight=true;
  try{
   let raw=dataRecord(await transport.exportToken(signal));valid(signal);
   if(raw?._==='auth.loginTokenMigrateTo'){
    if(!Number.isSafeInteger(raw.dcId)||Number(raw.dcId)<=0||Number(raw.dcId)>100||!token(raw.token))throw Error('unsupported');
    raw=dataRecord(await transport.importToken(Number(raw.dcId),new Uint8Array(raw.token),signal));valid(signal);
    if(raw?._!=='auth.loginTokenSuccess')throw Error('unsupported');
   }
   if(raw?._==='auth.loginTokenSuccess'){await transport.authorize(signal);valid(signal,false);closed=true;return null;}
   if(raw?._!=='auth.loginToken'||!token(raw.token)||typeof raw.expires!=='number'||!Number.isSafeInteger(raw.expires))throw Error('unsupported');
   const expiresAt=raw.expires*1000;if(expiresAt<=clock()||expiresAt>clock()+300000)throw Error('qr-expired');
   const encoded=btoa(String.fromCharCode(...raw.token)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
   const challenge=parseQrLoginChallenge({url:'tg://login?token='+encoded,expiresAt});if(!challenge)throw Error('unsupported');return challenge;
  }finally{flight=false;}
 }
 return Object.freeze({begin:(signal:AbortSignal)=>step(signal,true),check:(signal:AbortSignal)=>step(signal,false),close(){closed=true;}});
}
