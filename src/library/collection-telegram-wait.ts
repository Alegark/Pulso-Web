import {cooldownDeadline} from '../telegram/rpc-failure';
import type {TelegramSessionClient} from '../telegram/session-client';

const MAX_AUTO_WAIT_MS=15*60_000;
const RECONNECT_DELAYS=[5_000,10_000,20_000,40_000];

export function collectionTelegramWait(client:TelegramSessionClient,signal:AbortSignal,live:()=>boolean,initialWait:number,onWait:(until:number)=>void){
 const page=typeof document==='undefined'?null:document;
 const windowHost=typeof window==='undefined'?null:window;
 const online=()=>globalThis.navigator?.onLine!==false;
 let observedWait=initialWait;
 let generation=0,wake:(()=>void)|undefined,legacyWait=0;
 const changed=()=>{generation++;wake?.();};
 const connectionChanged=()=>wake?.();
 page?.addEventListener('visibilitychange',changed);
 page?.addEventListener('resume',changed);
 windowHost?.addEventListener('online',connectionChanged);
 windowHost?.addEventListener('offline',connectionChanged);
 const sleep=(ms:number)=>new Promise<void>(resolve=>{
  const timer=setTimeout(done,ms);
  function done(){clearTimeout(timer);signal.removeEventListener('abort',done);wake=undefined;resolve();}
  wake=done;
  signal.addEventListener('abort',done,{once:true});
  if(signal.aborted)done();
 });
 const occupied=()=>{
  const state=client.searchSnapshot?.();
  return !!state?.available&&(state.pending||state.cancelling);
 };
 const waitWhileOccupied=async()=>{while(live()&&occupied())await sleep(250);};
 const delayFor=(until:number)=>Math.min(Math.max(0,until-Date.now()),30_000);
 const duration=(ms:number)=>ms>=60_000?`${Math.ceil(ms/60_000)} min`:`${Math.ceil(ms/1000)} s`;
 const pauseForTrack=()=>{
  let disruptions=0,lastWait=0;
  return async(report:(message:string)=>void,interrupted=false,suspended=false):Promise<{message:string;automatic:boolean}|null>=>{
   if(interrupted&&!suspended)disruptions++;
   let attempts=0,restoring=false,waitingForFlood=false,wasOffline=false;
   let renew=interrupted&&(suspended||disruptions>=2);
   const retryDelay=interrupted?RECONNECT_DELAYS[Math.min(Math.max(0,disruptions-1),RECONNECT_DELAYS.length-1)]:0;
   let idleSince=Date.now(),retryAt=idleSince+retryDelay,nextAttemptAt=idleSince+RECONNECT_DELAYS[0];
   const reset=()=>{
    idleSince=Date.now();retryAt=idleSince+retryDelay;
    nextAttemptAt=idleSince+(RECONNECT_DELAYS[attempts]??0);
   };
   const sleepUntilWake=async(ms:number)=>{
    const before=Date.now(),observed=generation;
    await sleep(ms);
    if(generation!==observed||Date.now()-before>ms+1000)reset();
   };
   const pause=(message:string,automatic=false)=>({message,automatic});
   const networkPause=()=>pause('No se pudo reconectar con Telegram. Pulsa Continuar cuando vuelva la conexión.',true);
   while(live()){
    const remote=client.searchSnapshot(),session=client.snapshot?.();
    if(session?.phase==='restoring'){
     restoring=true;report('Reconectando con Telegram…');await sleepUntilWake(250);continue;
    }
    if(restoring){restoring=false;reset();retryAt=Date.now();}
    if(remote.retryBlocked&&!legacyWait)legacyWait=cooldownDeadline(remote);
    if(!remote.retryBlocked)legacyWait=0;
    const until=Math.max(remote.retryAt??0,session?.retryAt??0,legacyWait,observedWait);
    if(until>Date.now()){
     if(until>observedWait){observedWait=until;onWait(until);}
     const remaining=until-Date.now();
     if(remaining>MAX_AUTO_WAIT_MS||lastWait!==until&&disruptions>RECONNECT_DELAYS.length)
      return pause(`Telegram pide esperar ${duration(remaining)}. Pulsa Continuar cuando termine la espera.`);
     lastWait=until;waitingForFlood=true;renew=false;
     report(`Telegram pide esperar ${duration(remaining)} · continúo sola`);
     await sleepUntilWake(delayFor(until));
     continue;
    }
    if((session?.phase==='error'&&!['network','timeout','cancelled','rate-limit'].includes(session.error??''))||
       session&&['password','code','qr','disconnecting','disconnected'].includes(session.phase)||remote.error==='session-expired'){
     return pause('Vuelve a conectar Telegram y pulsa Continuar. El progreso se conserva.');
    }
    if(!online()){
     if(!wasOffline){wasOffline=true;reset();}
     if(Date.now()-idleSince>=60_000)return pause('Pulso sigue sin conexión. Pulsa Continuar cuando vuelva la red.',true);
     report('Pulso sigue sin conexión.');
     await sleepUntilWake(1000);continue;
    }
    if(wasOffline||waitingForFlood){
     reset();if(waitingForFlood)retryAt=Date.now();
     wasOffline=false;waitingForFlood=false;
    }
    // Even an unavailable channel can still own a pending operation.
    if(remote.pending||remote.cancelling){await sleepUntilWake(250);continue;}
    if(disruptions>RECONNECT_DELAYS.length)return pause('Telegram sigue sin responder. Pulsa Continuar para volver a intentarlo.',true);
    const ready=remote.available&&(!session||session.phase==='connected');
    if(ready&&!renew&&Date.now()>=retryAt)return null;
    report('Reconectando con Telegram…');
    if((renew&&ready||session?.phase==='error')&&client.reconnectForDownload){
     if(attempts===RECONNECT_DELAYS.length)return networkPause();
     if(Date.now()>=nextAttemptAt){
      if(client.reconnectForDownload()){
       attempts++;renew=false;restoring=true;
      }
     }
    }else if(Date.now()-idleSince>=60_000)return networkPause();
    await sleepUntilWake(250);
   }
   return null;
  };
 };
 return {online,generation:()=>generation,pauseForTrack,occupied,waitWhileOccupied,dispose(){
  page?.removeEventListener('visibilitychange',changed);
  page?.removeEventListener('resume',changed);
  windowHost?.removeEventListener('online',connectionChanged);
  windowHost?.removeEventListener('offline',connectionChanged);
 }};
}
