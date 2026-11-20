import {cooldownDeadline} from '../telegram/rpc-failure';
import type {TelegramSessionClient} from '../telegram/session-client';

const MAX_AUTO_WAIT_MS=15*60_000;
const RECONNECT_DELAYS=[5_000,10_000,20_000,40_000];

export function collectionTelegramWait(client:TelegramSessionClient,signal:AbortSignal,live:()=>boolean,initialWait:number,onWait:(until:number)=>void){
 const page=typeof document==='undefined'?null:document;
 const windowHost=typeof window==='undefined'?null:window;
 const foreground=()=>page?.visibilityState!=='hidden'&&globalThis.navigator?.onLine!==false;
 let observedWait=initialWait;
 let generation=0,wake:(()=>void)|undefined,legacyWait=0;
 const changed=()=>{generation++;wake?.();};
 page?.addEventListener('visibilitychange',changed);
 windowHost?.addEventListener('pageshow',changed);
 windowHost?.addEventListener('online',changed);
 windowHost?.addEventListener('offline',changed);
 const sleep=(ms:number)=>new Promise<void>(resolve=>{
  const timer=setTimeout(done,ms);
  function done(){clearTimeout(timer);signal.removeEventListener('abort',done);wake=undefined;resolve();}
  wake=done;
  signal.addEventListener('abort',done,{once:true});
  if(signal.aborted)done();
 });
 const delayFor=(until:number)=>Math.min(Math.max(0,until-Date.now()),30_000);
 const duration=(ms:number)=>ms>=60_000?`${Math.ceil(ms/60_000)} min`:`${Math.ceil(ms/1000)} s`;
 const pauseForTrack=()=>{
  let disruptions=0,reconnectAt=0,gaveRestore=false,wasConnected=false,lastWait=0,waitingForFlood=false,wasBackground=false;
  return async(report:(message:string)=>void,interrupted=false,suspended=false):Promise<string|null>=>{
   if(interrupted){
    if(!suspended)disruptions++;
    reconnectAt=Date.now()+RECONNECT_DELAYS[Math.min(Math.max(0,disruptions-1),RECONNECT_DELAYS.length-1)];
    wasConnected=client.searchSnapshot().available;
    gaveRestore=false;waitingForFlood=false;
   }
   while(live()){
    const remote=client.searchSnapshot(),session=client.snapshot?.();
    if(remote.retryBlocked&&!legacyWait)legacyWait=cooldownDeadline(remote);
    if(!remote.retryBlocked)legacyWait=0;
    const until=Math.max(remote.retryAt??0,session?.retryAt??0,legacyWait,observedWait);
    if(until>Date.now()){
     if(until>observedWait){observedWait=until;onWait(until);}
     const remaining=until-Date.now();
     if(remaining>MAX_AUTO_WAIT_MS||lastWait!==until&&disruptions>RECONNECT_DELAYS.length)
      return `Telegram pide esperar ${duration(remaining)}. Pulsa Continuar cuando termine la espera.`;
     lastWait=until;waitingForFlood=true;
     report(`Telegram pide esperar ${duration(remaining)} · continúo sola`);
     await sleep(delayFor(until));
     continue;
    }
    if(!foreground()){
     wasBackground=true;
     report('La descarga continúa al volver a Pulso con conexión.');
     await sleep(1000);
     continue;
    }
    if(wasBackground){
     // A frozen tab does not spend the reconnect budget while its timers are stopped.
     reconnectAt=Date.now();wasBackground=false;
    }
    if((session?.phase==='error'&&!['network','timeout','cancelled','rate-limit'].includes(session.error??''))||
       session&&['password','code','qr','disconnecting'].includes(session.phase)||
       session?.phase==='disconnected'){
     return 'Vuelve a conectar Telegram y pulsa Continuar. El progreso se conserva.';
    }
    if(disruptions>RECONNECT_DELAYS.length)return 'Telegram sigue sin responder. Pulsa Continuar para volver a intentarlo.';
    if(remote.available&&!remote.pending&&!remote.cancelling&&(waitingForFlood||Date.now()>=reconnectAt)){
     // One renewal after repeated errors, or after a failed attempt crossed a suspension.
     if(interrupted&&!waitingForFlood&&!gaveRestore&&(disruptions>=2||suspended)&&wasConnected&&client.reconnectForDownload){
      gaveRestore=true;client.reconnectForDownload();
      if(!client.searchSnapshot().available){report('Reconectando con Telegram…');await sleep(250);continue;}
     }
     return null;
    }
    if(!reconnectAt)reconnectAt=Date.now()+RECONNECT_DELAYS[0];
    report('Reconectando con Telegram…');
    if(!remote.pending&&!remote.cancelling&&!gaveRestore&&Date.now()>=reconnectAt&&session?.phase==='error'){
     gaveRestore=true;
     client.reconnectForDownload?.();
    }
    if(Date.now()-reconnectAt>=60_000)return 'No se pudo reconectar con Telegram. Pulsa Continuar cuando vuelva la conexión.';
    await sleep(250);
   }
   return '';
  };
 };
 return {foreground,generation:()=>generation,pauseForTrack,dispose(){
  page?.removeEventListener('visibilitychange',changed);
  windowHost?.removeEventListener('pageshow',changed);
  windowHost?.removeEventListener('online',changed);
  windowHost?.removeEventListener('offline',changed);
 }};
}
