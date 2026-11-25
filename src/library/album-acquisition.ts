import {musicBrainzId} from './catalog-id';
import type {CatalogId} from './catalog-id';
import type {AlbumDetail,AlbumTrack} from './album-catalog';
import type {SongChoice,SongPlaybackAttempt,SongManagement} from './selected-song';
import {orderedProviders,type CollectionBotProgress,type OrderedProvider} from './ordered-bot-acquisition';
import {collectionTelegramWait} from './collection-telegram-wait';
import {downloadSong,parkedSong} from './download-song';
import type {PendingDownload} from './library-download-checkpoint';
import type {TelegramSessionClient} from '../telegram/session-client';

export function albumTrackChoice(track:AlbumTrack,album:string):SongChoice {
 const mb=musicBrainzId(track.releaseId)&&musicBrainzId(track.trackId);
 return {id:mb?`musicbrainz:${String(track.releaseId).slice(12)}:${track.disc}:${track.position}:${String(track.trackId).slice(12)}`:`itunes:${track.releaseId}:${track.disc}:${track.position}:${track.trackId}`,source:mb?'musicbrainz':'itunes',title:track.title,artist:track.artist,searchArtist:track.primaryArtist??track.artist,album,duration:track.durationMs===null?null:track.durationMs/1000};
}
export type AlbumRowState='unattempted'|'ready'|'reused'|'downloaded'|'failed'|'uncertain';
export interface AlbumRow {state:AlbumRowState;trackId:string|null;confirmed:boolean;message:string;reason?:'not-found'|'no-valid-file'|'missing-metadata'|'parked'}
export interface AlbumProgress {rows:AlbumRow[];message:string;waiting?:boolean}
export interface AlbumAcquisition {
 detail:AlbumDetail;attempt:SongPlaybackAttempt;client:TelegramSessionClient|null;provider:string|null;providers?:readonly OrderedProvider[];revision:number|undefined;
 management:(id:string)=>SongManagement|null;signal:AbortSignal;current:()=>boolean;update:(value:AlbumProgress)=>void;rows:AlbumRow[];remoteClock?:{settledAt:number};uncertainTracks?:Set<CatalogId>;interruptOnTelegram?:boolean;
}
export async function acquireAlbum(p:AlbumAcquisition):Promise<'completed'|'interrupted'> {
 const rows=p.rows.map(row=>row.confirmed?{...row,state:'ready' as const,confirmed:false,message:'Pendiente de verificar de nuevo.'}:{...row});
 const live=()=>{try{return !p.signal.aborted&&p.current()&&p.attempt.current();}catch{return false;}};
 const update=(message:string,waiting=false)=>p.update({rows:rows.map(row=>({...row})),message,waiting});
 const remoteClock=p.remoteClock??{settledAt:0},networkCurrent=p.client?.captureBotsCurrent();
 const providers=p.providers??(p.provider?[{providerRef:p.provider,label:'Bot'}]:[]);
 const initialBots=p.interruptOnTelegram?p.client?.botsSnapshot():undefined;
 const providerNames=providers.map(provider=>initialBots?.providers?.find(row=>row.providerRef===provider.providerRef)?.username);
 const telegramWait=p.interruptOnTelegram&&p.client?collectionTelegramWait(p.client,p.signal,live,0,()=>{},'Reintentar descarga en cola'):null;
 let interruption:string|undefined;
 const storageStopped='No se pudo continuar con el almacenamiento actual.';
 update('Comprobando copias…');
 try {
  for(let i=0;i<p.detail.tracks.length;i++){
   if(!live())break;
   const row=rows[i],track=p.detail.tracks[i],choice=albumTrackChoice(track,p.detail.edition.title);
   const previouslyParked=row.state==='uncertain'||p.uncertainTracks?.has(track.trackId);
   const park=()=>{
    Object.assign(row,parkedSong);
    p.uncertainTracks?.add(track.trackId);
   };
   let id:string|null=null,downloaded=false;
   if(p.attempt.waitForDownload&&!await p.attempt.waitForDownload(p.signal)){interruption=storageStopped;break;}
   try{id=await p.attempt.lookup(choice,p.signal,true);}catch{if(!live())break;park();update(row.message);continue;}
   if(!live())break;
   if(!id&&previouslyParked){park();update(row.message);continue;}
   row.confirmed=false;
   delete row.reason;
   if(!id){
    if(!p.client||!networkCurrent||!providers.length||p.revision===undefined){
     row.state='failed';row.message='No hay bots disponibles';update(row.message);continue;
    }
    let pending:PendingDownload|undefined;
    const collection:CollectionBotProgress|undefined=telegramWait?{completed:new Set(),reasons:[]}:undefined;
    const pause=telegramWait?.pauseForTrack();
    let interrupted=false,suspended=false,lastSuspension=-1;
    const status=(message:string,waiting=false)=>{row.message=message;update(message,waiting);};
    while(live()){
     const paused=await pause?.(message=>status(message,true),interrupted,suspended);
     if(!live())break;
     if(paused){interruption=paused.message;break;}
     const bots=telegramWait?p.client.botsSnapshot():undefined;
     const sameSession=bots?.scopeKey===initialBots?.scopeKey;
     const activeProviders=bots&&!sameSession?orderedProviders(bots):providers;
     if(bots&&(sameSession?bots.revision!==p.revision:activeProviders.length!==providers.length||
      activeProviders.some((provider,index)=>bots.providers.find(row=>row.providerRef===provider.providerRef)?.username!==providerNames[index]))){
      interruption='La selección de bots cambió. Revisa Telegram y pulsa Reintentar descarga en cola.';break;
     }
     const captured=bots?p.client.captureBotsCurrent():networkCurrent;
     const audioCurrent=()=>captured()&&(!bots||p.client?.botsSnapshot().revision===bots.revision);
     const generation=telegramWait?.generation()??0;
     const crossedSuspension=()=>!!telegramWait&&telegramWait.generation()!==generation&&telegramWait.generation()!==lastSuspension;
     const result=await downloadSong({client:p.client,providers:activeProviders,revision:bots?.revision??p.revision,signal:p.signal,current:live,
      networkCurrent:()=>audioCurrent()&&globalThis.navigator?.onLine!==false,audioCurrent:telegramWait?audioCurrent:undefined,
      suspended:crossedSuspension,collection,remoteClock,interruptOnTelegram:p.interruptOnTelegram,
      attempt:p.attempt,choice,index:i,mark:value=>{pending=value;},message:status,progress:()=>{}});
     if(result.state==='stopped'||!live()){
      if(pending?.kind==='save')park();
      interruption=storageStopped;break;
     }
     if(result.state==='telegram'||result.state==='suspended'){
      interrupted=true;suspended=crossedSuspension();
      if(suspended)lastSuspension=telegramWait?.generation()??-1;
      continue;
     }
     Object.assign(row,result);
     if(result.state==='uncertain')park();
     if(result.state==='downloaded'&&result.trackId){downloaded=true;id=result.trackId;}
     else update(row.message);
     break;
    }
    if(interruption||!live())break;
    if(!id)continue;
   }
   p.uncertainTracks?.delete(track.trackId);
   row.trackId=id;row.confirmed=false;row.state='ready';row.message='Copia verificada';
   let added=false;
   try{added=await p.attempt.addToLibrary(id,live,p.signal);}catch{/* The copy remains available for the next verification. */}
   if(!live())break;
   if(added){row.confirmed=true;row.state=downloaded?'downloaded':'reused';row.message=downloaded?'Descargada':'Ya descargada';}
   else{row.state='failed';row.message='No se pudo añadir a Biblioteca';}
   update(row.message);
  }
  if(!live())update('Operación detenida. Las copias ya confirmadas se conservan.');
  else if(interruption)update(interruption,true);
  else update(rows.every(row=>row.confirmed)?'Álbum listo en Biblioteca.':'Álbum incompleto: revisa las pistas pendientes o fallidas.');
  return live()&&!interruption?'completed':'interrupted';
 }catch{update(storageStopped,true);return 'interrupted';}
 finally{telegramWait?.dispose();}
}
