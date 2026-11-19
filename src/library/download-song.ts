import {acquireFromOrderedBots,type CandidateDisposition} from './ordered-bot-acquisition';
import type {AlbumRow} from './album-acquisition';
import type {PendingDownload} from './library-download-checkpoint';
import type {SongChoice,SongPlaybackAttempt} from './selected-song';
import {isBotSearchQuery,parseBotSearchTarget} from '../telegram/bot-search-protocol';

export const parkedSong={state:'uncertain',reason:'parked',message:'Pendiente en Almacenamiento'} as const;

export async function downloadSong(p:Omit<Parameters<typeof acquireFromOrderedBots>[0],'target'|'accept'|'excludedDigests'>&{
 choice:SongChoice;attempt:SongPlaybackAttempt;trackId?:string;index:number;
 mark:(pending:PendingDownload)=>void;message:(message:string)=>void;
}):Promise<(Partial<AlbumRow>&{state:AlbumRow['state']}) | {state:'stopped'}>{
 const {choice,attempt,signal,current,trackId}=p;
 const target=parseBotSearchTarget({title:choice.title,artist:choice.artist,album:choice.album,durationSeconds:choice.duration||null});
 if(!target?.artist||!isBotSearchQuery(target.title+' '+target.artist))return {state:'failed',reason:'missing-metadata',message:'Faltan datos para buscarla'};
 let savedId:string|null=null;
 const failedDigests=new Set<string>();
 const network=()=>p.mark({kind:'network',index:p.index});
 network();
 p.message('Buscando canción…');
 const result=await acquireFromOrderedBots({...p,target,excludedDigests:failedDigests,accept:async (audio):Promise<CandidateDisposition|'saved'>=>{
  // One repeat of the same bytes for a transient write failure, after proving
  // that the previous operation published nothing. Every write has a new ID.
  for(let write=0;write<2;write++){
   if(!current()||attempt.waitForDownload&&!await attempt.waitForDownload(signal)||!current())return 'stopped';
   const operationId=crypto.randomUUID();
   p.mark({kind:'save',index:p.index,operationId});
   p.message('Guardando copia…');
   let local:Awaited<ReturnType<SongPlaybackAttempt['save']>>={state:'uncertain',trackId:null};
   try{local=await attempt.save(audio,choice,signal,()=>{},operationId);}
   catch{/* A lost save response must be checked against its receipt. */}
   if(!current())return 'stopped';
   if(local.state==='saved'&&local.trackId&&(!trackId||local.trackId===trackId)){
    savedId=local.trackId;
    return 'saved';
   }
   const receipt=await reconcileSongDownload(attempt,operationId,trackId,choice,signal);
   if(!current())return 'stopped';
   if(receipt?.state==='saved'&&receipt.trackId&&(!trackId||receipt.trackId===trackId)){
    savedId=receipt.trackId;
    return 'saved';
   }
   if(local.storageUnavailable)return 'stopped';
   if(receipt?.state!=='missing'&&(receipt||local.state!=='failed')){
    await parkSongDownload(attempt,operationId,signal);
    return 'parked';
   }
   if(!local.retryWrite)break;
  }
  failedDigests.add(audio.sha256);
  network();
  p.message('Probando otra opción…');
  return 'retry';
 }});
 if(result.state==='stopped'||!current())return {state:'stopped'};
 if(savedId)return {state:'downloaded',trackId:savedId,confirmed:true,message:'Descargada'};
 if(result.state==='parked')return parkedSong;
 if(result.state==='unavailable'||result.state==='uncertain')return {state:'failed',message:'Telegram no respondió a tiempo'};
 if(result.state==='known-failure'&&result.reasons.some(reason=>reason!=='no-compatible-row'))return {state:'failed',reason:'no-valid-file',message:'Ningún bot entregó un archivo válido'};
 if(result.state==='known-failure'&&result.reasons.length)return {state:'failed',reason:'not-found',message:'No existe en tus bots'};
 return {state:'failed',message:'No hay bots disponibles'};
}

export async function reconcileSongDownload(attempt:SongPlaybackAttempt,operationId:string,trackId:string|undefined,choice:SongChoice,signal:AbortSignal){
 try{return trackId?await attempt.reconcileDownload?.(operationId,trackId,signal,true):await attempt.reconcileSongDownload?.(operationId,choice,signal);}
 catch{return {state:'uncertain' as const,trackId:null};}
}

export async function parkSongDownload(attempt:SongPlaybackAttempt,operationId:string,signal:AbortSignal){
 try{await attempt.parkDownload?.(operationId,signal);}catch{/* Keep the original receipt and the storage gate. */}
}
