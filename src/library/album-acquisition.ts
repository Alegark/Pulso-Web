import type {AlbumDetail,AlbumTrack} from './album-catalog';
import type {SongChoice,SongPlaybackAttempt,SongManagement} from './selected-song';
import {matchingSongRows} from './selected-song';
import {isBotSearchQuery,parseBotSearchTarget} from '../telegram/bot-search-protocol';
import type {TelegramSessionClient} from '../telegram/session-client';

export function albumTrackChoice(track:AlbumTrack,album:string):SongChoice {
 return {id:`itunes:${track.releaseId}:${track.disc}:${track.position}:${track.trackId}`,source:'itunes',title:track.title,artist:track.artist,searchArtist:track.primaryArtist??track.artist,album,duration:track.durationMs===null?null:track.durationMs/1000};
}
export type AlbumRowState='unattempted'|'ready'|'reused'|'downloaded'|'failed'|'uncertain';
export interface AlbumRow {state:AlbumRowState;trackId:string|null;confirmed:boolean;message:string}
export interface AlbumProgress {rows:AlbumRow[];message:string}
export interface AlbumAcquisition {
 detail:AlbumDetail;attempt:SongPlaybackAttempt;client:TelegramSessionClient|null;provider:string|null;revision:number|undefined;
 management:(id:string)=>SongManagement|null;signal:AbortSignal;current:()=>boolean;update:(value:AlbumProgress)=>void;rows:AlbumRow[];remoteClock?:{settledAt:number};uncertainTracks?:Set<number>;
}
export async function acquireAlbum(p:AlbumAcquisition):Promise<void> {
 const rows=p.rows.map(row=>row.confirmed?{...row,state:'ready' as const,confirmed:false,message:'Pendiente de verificar de nuevo.'}:{...row});
 const live=()=>{try{return !p.signal.aborted&&p.current()&&p.attempt.current();}catch{return false;}};
 const update=(message:string)=>{for(let i=0;i<rows.length;i++)if(rows[i].state==='uncertain')p.uncertainTracks?.add(p.detail.tracks[i].trackId);p.update({rows:rows.map(row=>({...row})),message});};
 const remoteClock=p.remoteClock??{settledAt:0};
 const uncertainTracks=new Set([...(p.uncertainTracks??[]),...p.detail.tracks.filter((_,i)=>rows[i].state==='uncertain').map(t=>t.trackId)]);
 update('Comprobando copias…');
 try {
  for(let i=0;i<p.detail.tracks.length;i++){
   if(!live())break;
   const row=rows[i],choice=albumTrackChoice(p.detail.tracks[i],p.detail.edition.title);
   let id=await p.attempt.lookup(choice,p.signal);if(!live())break;
   // A previous uncertain delivery must never be dispatched again without a verified copy.
   if(!id&&(row.state==='uncertain'||uncertainTracks.has(p.detail.tracks[i].trackId))){row.state='uncertain';row.message='Requiere revisión en Almacenamiento antes de repetir.';update(row.message);continue;}
   if(id){uncertainTracks.delete(p.detail.tracks[i].trackId);p.uncertainTracks?.delete(p.detail.tracks[i].trackId);}
   row.confirmed=false;
   let downloaded=false;
   if(!id){
    const client=p.client,provider=p.provider;
    if(!client||!provider){update('Conecta un bot compatible para continuar con las pistas pendientes.');return;}
    const target=parseBotSearchTarget({title:choice.title,artist:choice.searchArtist??choice.artist,album:choice.album,durationSeconds:choice.duration});
    if(!target||!isBotSearchQuery(target.title)){row.state='failed';row.message='Metadatos insuficientes.';update(row.message);continue;}
    const wait=Math.max(0,remoteClock.settledAt+1000-Date.now());
    if(wait)await new Promise<void>(resolve=>{const timer=setTimeout(done,wait);function done(){clearTimeout(timer);p.signal.removeEventListener('abort',done);resolve();}p.signal.addEventListener('abort',done,{once:true});if(p.signal.aborted)done();});
    if(!live())break;
    const initial=client.searchSnapshot();
    if(initial.pending||!initial.available||initial.retryBlocked||initial.retryAt!==null&&initial.retryAt>Date.now()||initial.error==='uncertain'){update('Telegram está ocupado, limitado o requiere revisión.');return;}
    const network=client.captureBotsCurrent();if(!network()||!live())break;
    let queryId:string|null=null;
    const terminal=new Promise<void>(resolve=>{
     const unsubscribe=client.subscribeSearch(snapshot=>{if(queryId&&(!snapshot.pending||!snapshot.available)){unsubscribe();resolve();}});
     const allowed=client.captureSearchActionCurrent();
     if(live()&&network()&&allowed())client.searchBot({providerRef:provider,query:target.title,target,consent:true},allowed);
     const now=client.searchSnapshot();queryId=now.queryId!==initial.queryId?now.queryId:null;
     if(!queryId||!now.pending){unsubscribe();resolve();}
    });
    const cancel=()=>client.captureSearchCancel()?.();p.signal.addEventListener('abort',cancel,{once:true});if(p.signal.aborted)cancel();
    await terminal;p.signal.removeEventListener('abort',cancel);remoteClock.settledAt=Date.now();
    const found=client.searchSnapshot();
    if(!live()||!network()){if(queryId){row.state='uncertain';row.message='Consulta interrumpida; revisa antes de repetir.';}break;}
    if(!queryId||found.queryId!==queryId||found.error||found.delivery==='uncertain'||found.retryBlocked||found.retryAt!==null&&found.retryAt>Date.now()) {row.state='uncertain';row.message='Consulta sin confirmar; revisa Telegram.';update(row.message);return;}
    const matches=matchingSongRows(found.rows,target);
    if(!matches.length){row.state='failed';row.message='Sin coincidencia suficiente.';update(row.message);continue;}
    const allowed=client.captureSearchActionCurrent();if(!live()||!network()||!allowed())break;
    const abortDownload=()=>client.captureSearchCancel()?.();p.signal.addEventListener('abort',abortDownload,{once:true});
    const audio=await client.downloadBot(matches[0].rowRef,allowed);p.signal.removeEventListener('abort',abortDownload);remoteClock.settledAt=Date.now();
    if(!live()||!network()){row.state='uncertain';row.message='Descarga interrumpida; revisa antes de repetir.';break;}
    if(!audio){const state=client.searchSnapshot();if(state.error==='file-too-large'){row.state='failed';row.message='La pista supera 8 MiB.';update(row.message);continue;}row.state='uncertain';row.message='Descarga sin confirmar; revisa Telegram.';update(row.message);return;}
    const saved=await p.attempt.save(audio,choice,p.signal,()=>{});
    if(saved.state==='saved'&&saved.trackId){id=saved.trackId;row.trackId=id;row.state='ready';row.message='Copia guardada.';}
    else if(saved.state==='uncertain'){row.trackId=saved.trackId;row.state='uncertain';row.message='La copia requiere revisión en Almacenamiento.';update(row.message);return;}
    else {row.state='failed';row.message=live()?'No se pudo guardar la pista.':'Operación detenida sin confirmar la copia.';update(row.message);return;}
    if(!live())break;
    downloaded=true;
   }
   row.trackId=id;row.state='ready';row.message='Copia verificada.';
   if(!live())break;
   const added=await p.attempt.addToLibrary(id,live,p.signal);
   if(added){row.confirmed=true;row.state=downloaded?'downloaded':'reused';row.message='En Biblioteca.';}
   if(!live())break;
   if(!added){row.message='No se pudo confirmar Biblioteca.';update(row.message);return;}
   update('Pista incorporada a Biblioteca.');
  }
  if(!live())update('Operación detenida. Las copias ya confirmadas se conservan.');
  else update(rows.every(row=>row.confirmed)?'Álbum listo en Biblioteca.':'Álbum incompleto: revisa las pistas pendientes o fallidas.');
 }catch(error){update(error instanceof Error?error.message:'No se pudo comprobar la copia local.');}
}
