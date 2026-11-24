import {beginSongAggregate,type SongMeasurement} from '../diagnostics/song-aggregate';
import type {SongRejection} from '../diagnostics/contract';
import {sessionBotHealth} from './bot-health';
import {beginSongTiming} from '../diagnostics/song-timing';
import {elapsedMs,type DownloadResult} from '../diagnostics/download-timing';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {formatStorageMB} from './storage-format';
import {AUDIO_FILE_MAX_BYTES} from '../storage/audio-limits';
import {matchingSongRows,type SongImportRejection} from './selected-song';
import {BOT_SEARCH_BOUNDS,botAudioMismatchFields,botOptionDurationMismatch,isBotSearchLimitError,type BotSearchError,type BotSearchTarget,type BotDownloadedAudio,type BotSearchRow} from '../telegram/bot-search-protocol';
import type {BotsSnapshot,TelegramSessionClient} from '../telegram/session-client';

export type OrderedProvider={providerRef:string;label:string};
export function orderedProviders(bots:BotsSnapshot|null):OrderedProvider[] {
 const seen=new Set<string>(),usernames=new Set<string>();
 return (bots?.providers??[]).filter(p=>{const username=p.username.toLowerCase();if(!['ivkmbot','lydbot','ansmusicbot','kdmusic_bot','deezermusicbot'].includes(username)||seen.has(p.providerRef)||usernames.has(username))return false;seen.add(p.providerRef);usernames.add(username);return true;}).slice(0,5).map(p=>({providerRef:p.providerRef,label:p.label}));
}
export type AcquisitionFailureReason='no-compatible-row'|'returned-audio-mismatch'|'file-too-large'|'file-invalid'|'selection-changed'|'audio-title-version-mismatch'|'audio-artist-mismatch'|'audio-duration-mismatch';
/** Closed explanations shared by individual and album acquisition. Never assert
 * catalogue absence from a local validation failure. */
export function acquisitionFailureText(reasons:readonly AcquisitionFailureReason[]):string {
 const fields=[...new Set(reasons)].flatMap(reason=>reason==='audio-title-version-mismatch'?['título/versión']:reason==='audio-artist-mismatch'?['artista']:reason==='audio-duration-mismatch'?['duración']:[]);
 const mismatch=fields.length?`Diferencias observadas en los audios recibidos: ${fields.join(', ')}. [D02]`:'El audio recibido no coincide con la canción. [D02]';
 const messages:Record<AcquisitionFailureReason,string>={
  'no-compatible-row':'Las opciones del bot no pudieron vincularse con el título y artista elegidos. [D01]',
  'returned-audio-mismatch':mismatch,
  'audio-title-version-mismatch':'En los audios recibidos se observó título o versión incompatible.',
  'audio-artist-mismatch':'En los audios recibidos se observó crédito de artista incompatible o incompleto; se exige el crédito completo.',
  'audio-duration-mismatch':'En los audios recibidos se observó duración fuera de la tolerancia permitida.',
  'file-too-large':`El bot entregó un archivo que supera el límite actual de ${formatStorageMB(AUDIO_FILE_MAX_BYTES)} de Pulso. No se descargó. [D03]`,
  'file-invalid':'El archivo recibido está incompleto o su formato no es compatible. No se guardó. [D04]',
  'selection-changed':'La opción del bot cambió antes de confirmar la descarga. [D05]',
 };
 return [...new Set(reasons)].filter(reason=>!reason.startsWith('audio-')).map(reason=>messages[reason]).join(' ')||'No se pudo confirmar una coincidencia musical.';
}
const CANDIDATES_PER_BOT=5;
const TRANSIENT_RETRIES_PER_BOT=2;
const SONG_SEARCH_MS=180_000;
const TELEGRAM_WAIT_MS=60_000;
const BACKUP_BOT_RESERVE_MS=30_000;
const METADATA_REJECTIONS_PER_BOT=2;
export type CandidateDisposition='retry'|'parked'|'stopped'|'unavailable'|SongImportRejection;
export interface CollectionBotProgress {
 completed:Set<number>;
 reasons:AcquisitionFailureReason[];
}

type Result={state:'audio';audio:BotDownloadedAudio}|{state:'known-failure';reasons:readonly AcquisitionFailureReason[]}|{state:'uncertain'|'unavailable'|'timed-out'|'parked'|'stopped'|'telegram'};
/** Reissued queries get fresh rowRefs. Exclude the same projected selection across queries. */
function candidateIdentity(row:BotSearchRow):readonly unknown[]{
 return row.kind==='option'?[row.kind,row.label]:row.kind==='audio'?[row.kind,row.title,row.performer,row.durationSeconds,row.mimeType,row.bytes]:[row.kind,row.text];
}
const diagnosticError=(error:BotSearchError):SongRejection=>isBotSearchLimitError(error)?'limit':error;
const mismatchReason=(field:ReturnType<typeof botAudioMismatchFields>[number])=>field==='title-version'?'mismatch-title':field==='artist'?'mismatch-artist':'mismatch-duration';
const mismatchText=(fields:ReadonlySet<SongRejection>)=>[fields.has('mismatch-title')?'título/versión':'',fields.has('mismatch-artist')?'artista':'',fields.has('mismatch-duration')?'duración':''].filter(Boolean).join(', ');
const mb=(bytes:number,total:number)=>{const digits=total<100_000?2:1;return (bytes/1_000_000).toLocaleString('es',{minimumFractionDigits:digits,maximumFractionDigits:digits});};

export async function acquireFromOrderedBots(p:{client:TelegramSessionClient;providers:readonly OrderedProvider[];revision:number;target:BotSearchTarget;signal:AbortSignal;current:()=>boolean;networkCurrent:()=>boolean;audioCurrent?:()=>boolean;interruptOnTelegram?:boolean;remoteClock?:{settledAt:number};collection?:CollectionBotProgress;accept?:(audio:BotDownloadedAudio,rowKey:string)=>Promise<CandidateDisposition|'saved'>;excludedDigests?:ReadonlySet<string>;excludedRowKeys?:ReadonlySet<string>;measurement?:SongMeasurement;status?:(message:string)=>void;progress:(provider:OrderedProvider,index:number,queryId:string|null)=>void}):Promise<Result> {
 const {client}=p,target={...p.target},network=p.networkCurrent,current=p.current,revision=p.revision,collection=p.collection;
 let deadline=performance.now()+SONG_SEARCH_MS;
 const ownMeasurement=!p.accept&&!p.measurement,measurement=p.measurement??(ownMeasurement?beginSongAggregate():undefined);
 const seen=new Set<string>(),providers=p.providers.filter(provider=>{if(seen.has(provider.providerRef))return false;seen.add(provider.providerRef);return true;}).slice(0,5).map((provider,i)=>({...provider,i}));
 const health=p.accept?sessionBotHealth(client,client.botsSnapshot().scopeKey):undefined;
 const order=health?.order(providers)??providers;
 let precedingBot=false;
 const reasons=collection?.reasons??[],excludedRows=new Set(p.excludedRowKeys);
 let expired=false,unavailable=false,incompleteBot=false,botTimedOut=false,botUntil=Infinity;
 const botExpired=()=>botTimedOut||botUntil<deadline&&performance.now()>=botUntil;
 const until=()=>Math.min(botUntil,deadline);
 let ownedCancel:(()=>void)|undefined;
 const cancel=()=>{try{ownedCancel?.();}catch{/* Cancellation cannot grant a new lane. */}};
 const expire=()=>{expired=botUntil>=deadline;botTimedOut=!expired;cancel();};
 let timer:ReturnType<typeof setTimeout>|undefined;
 const arm=()=>{clearTimeout(timer);timer=setTimeout(expire,Math.max(0,until()-performance.now()));};
 const extend=(ms:number)=>{deadline+=ms;botUntil+=ms;arm();};
 arm();
 p.signal.addEventListener('abort',cancel);
 const live=()=>!expired&&!botTimedOut&&!p.signal.aborted&&performance.now()<until()&&current()&&network()&&client.botsSnapshot().revision===revision;
 const delay=(ms:number)=>new Promise<void>(resolve=>{
  const timer=setTimeout(done,ms);
  function done(){clearTimeout(timer);p.signal.removeEventListener('abort',done);resolve();}
  p.signal.addEventListener('abort',done,{once:true});
  if(p.signal.aborted)done();
 });
 const wait=async()=>{const ms=p.remoteClock?Math.max(0,p.remoteClock.settledAt+1000-Date.now()):0;if(ms)await delay(ms);};
 const batch=!!(collection||p.interruptOnTelegram);
 const channelDown=(state:ReturnType<TelegramSessionClient['searchSnapshot']>,ownError=false)=>
  !network()||client.botsSnapshot().revision!==revision||!state.available||state.retryBlocked||(state.retryAt??0)>Date.now()||
  (client.snapshot?.().retryAt??0)>Date.now()||ownError&&['network','session-expired','rate-limit'].includes(state.error??'');
 const waitForLane=async()=>{
  if(batch){
   // Another search owns the lane. It uses its own timeout and doesn't spend this song's budget.
   const waitingSince=performance.now();
   clearTimeout(timer);
   while(current()&&!p.signal.aborted&&!expired){
    const state=client.searchSnapshot();
    if(channelDown(state))return false;
    if(!state.pending&&!state.cancelling){
     extend(performance.now()-waitingSince);
     if(!live())return false;
     return true;
    }
    await delay(250);
   }
   return false;
  }
  const laneDeadline=Math.min(until(),performance.now()+TELEGRAM_WAIT_MS);
  while(current()&&!p.signal.aborted&&performance.now()<laneDeadline){
   const state=client.searchSnapshot(),retryIn=Math.max(0,(state.retryAt??0)-Date.now());
   if(botExpired()||state.retryBlocked||retryIn>=laneDeadline-performance.now())return false;
   if(network()&&client.botsSnapshot().revision!==revision)return false;
   if(live()&&state.available&&!state.pending&&!state.cancelling&&(state.retryAt??0)<=Date.now())return true;
   await delay(retryIn||250);
  }
  return false;
 };
 const transient=(s:ReturnType<TelegramSessionClient['searchSnapshot']>)=>
  s.error==='rate-limit'||s.delivery!=='uncertain'&&['busy','network','timeout','expired'].includes(s.error??'');
 const settled=()=>{if(p.remoteClock)p.remoteClock.settledAt=Date.now();};
 const owned=(s:ReturnType<TelegramSessionClient['searchSnapshot']>,provider:string,q:string|null)=>
  !!q&&s.queryId===q&&s.providerRef===provider&&s.providerRevision===revision&&JSON.stringify(s.expectedTarget)===JSON.stringify(target);
 const same=(s:ReturnType<TelegramSessionClient['searchSnapshot']>,provider:string,q:string|null)=>
  owned(s,provider,q)&&!s.pending&&s.available&&!s.retryBlocked&&(s.retryAt===null||s.retryAt<=Date.now());
 const confirmedRejection=(s:ReturnType<TelegramSessionClient['searchSnapshot']>,own:boolean)=>
  own&&(s.delivery!=='uncertain'&&(s.error==='file-too-large'||s.error==='file-invalid')||
   s.delivery==='acknowledged'&&(['unsupported','needs-start','limit'].includes(s.error??'')||isBotSearchLimitError(s.error)||
    s.error===null&&s.rows.some(row=>row.kind==='audio')&&!matchingSongRows(s.rows.filter(row=>row.kind==='audio'),target).length));
 try {
  providersLoop:for(const [position,provider] of order.entries()){
   const {i}=provider;
   if(collection?.completed.has(i))continue;
   const next=order.slice(position+1).filter(slot=>!collection?.completed.has(slot.i)).length;
   const remaining=Math.max(0,deadline-performance.now());
   const reserve=Math.min(BACKUP_BOT_RESERVE_MS,Math.floor(remaining/(next+1)));
   botTimedOut=false;botUntil=deadline-reserve*next;arm();
   let switching=precedingBot,rejectedStatus='';
   precedingBot=true;
   const botStarted=performance.now();
   let healthOutcome:BotSearchError|'reply'|undefined;
   let selections=0,retries=0,metadataRejections=0,selectionRetried=false,reusableQuery:string|null=null,callbackBudget:number=BOT_SEARCH_BOUNDS.callbackBudgetMs;
   const filteredOptions=new Set<string>(),optionKeys=new Map<string,string>();
   const markBotTimeout=()=>{incompleteBot=true;};
   const observeError=(error:BotSearchError,started:number)=>{
    measurement?.rejection(diagnosticError(error),elapsedMs(started));
    if(error==='timeout'||error==='unsupported'||error==='limit'||isBotSearchLimitError(error))healthOutcome=error;
   };
   while(selections<CANDIDATES_PER_BOT){
    const timing=beginSongTiming();
    let timingResult:DownloadResult='failed',waitingSince=performance.now();
    try{
    if(!reusableQuery)await wait();
    if(p.accept){
     const available=await waitForLane();
     if(timing)timing.values.waitMs=elapsedMs(waitingSince);
     if(!available){
      if(botExpired()&&!channelDown(client.searchSnapshot())){markBotTimeout();break;}
      if(batch&&channelDown(client.searchSnapshot()))return {state:'telegram'};
      if(batch&&expired)break providersLoop;
      return {state:current()&&!p.signal.aborted?'unavailable':'stopped'};
     }
    }else if(!live()) {if(botExpired()){markBotTimeout();break;}return {state:'uncertain'};}
    if(timing)timing.values.waitMs=elapsedMs(waitingSince);
    const before=client.searchSnapshot();
    if(!p.accept&&(before.pending||!before.available||before.retryBlocked||before.retryAt!==null&&before.retryAt>Date.now()||before.error==='uncertain'))return {state:'uncertain'};
    const retryTransient=async()=>{
     if(retries++>=TRANSIENT_RETRIES_PER_BOT)return false;
     await delay(250);
     return true;
    };
    let queryId:string|null=reusableQuery;
    reusableQuery=null;
    const searchStarted=performance.now();
    const reuse=!!queryId&&same(before,provider.providerRef,queryId)&&before.expiresAt!==null&&
     before.expiresAt>Date.now()&&before.rows.some(row=>row.kind==='option')&&
     (!before.error||before.error==='file-invalid'||before.error==='file-too-large');
    if(!reuse){
     optionKeys.clear();
     p.status?.(`${switching?'Probando otro bot… ':''}Consultando bot ${i+1} de ${providers.length}…`);
     switching=false;
     p.progress(provider,i,null);
     queryId=null;
     const terminal=new Promise<void>(resolve=>{
      const unsubscribe=client.subscribeSearch(s=>{if(queryId&&(!s.pending||!s.available)){unsubscribe();resolve();}});
      const allowed=client.captureSearchActionCurrent();
      if(live()&&allowed())client.searchBot({providerRef:provider.providerRef,query:target.title,target,consent:true},allowed,admission=>{
       queryId=admission.queryId;measurement?.bot(i);ownedCancel=admission.cancel;if(expired||botTimedOut||p.signal.aborted)cancel();
      },timing||measurement?value=>{timing?.search(value);measurement?.network(value);}:undefined);
      const now=client.searchSnapshot();
      if(!queryId||!now.pending){unsubscribe();resolve();}
     });
     p.progress(provider,i,queryId);await terminal;ownedCancel=undefined;settled();
    }
    const found=client.searchSnapshot();
    if(!same(found,provider.providerRef,queryId)||!reuse&&found.error||found.delivery!=='acknowledged'||!live()){
     const ownReply=owned(found,provider.providerRef,queryId);
     if(queryId&&(expired||botExpired()))observeError('timeout',searchStarted);
     else if(ownReply&&found.error)observeError(found.error,searchStarted);
     if(botExpired()&&!channelDown(found,ownReply)){
      markBotTimeout();
      break;
     }
     if(!p.accept)return {state:'uncertain'};
     if(batch&&channelDown(found,ownReply))return {state:'telegram'};
     if(collection){
      if(!queryId&&(found.pending||found.cancelling))continue;
      if(queryId&&!ownReply&&!selectionRetried&&live()){selectionRetried=true;continue;}
      if(ownReply&&found.delivery==='acknowledged'&&(found.error==='file-too-large'||found.error==='file-invalid'))reasons.push(found.error);
      break;
     }
     if((!queryId||ownReply&&transient(found))&&await retryTransient())continue;
     if(ownReply&&found.delivery==='acknowledged'&&(found.error==='file-too-large'||found.error==='file-invalid'))reasons.push(found.error);
     else unavailable=true;
     break;
    }
    healthOutcome??='reply';
    const occurrences=new Map<string,number>();
    const matches=matchingSongRows(reuse?found.rows.filter(row=>row.kind==='option'):found.rows,target).map(row=>{
     const retainedKey=optionKeys.get(row.rowRef);
     if(retainedKey)return {row,key:retainedKey};
     const identity=JSON.stringify([provider.providerRef,...candidateIdentity(row)]);
     const occurrence=occurrences.get(identity)??0;
     occurrences.set(identity,occurrence+1);
     // The first occurrence uses the key already stored in v50 checkpoints.
     const key=bytesToHex(sha256(new TextEncoder().encode(occurrence?JSON.stringify([identity,occurrence]):identity)));
     if(row.kind==='option')optionKeys.set(row.rowRef,key);
     return {row,key};
    }).filter(({row,key})=>{
     if(excludedRows.has(key))return false;
     if(!botOptionDurationMismatch(row,target))return true;
     if(!filteredOptions.has(key)){
      filteredOptions.add(key);measurement?.candidate(true);if(measurement)measurement.values.candidatesRejected++;
      measurement?.rejection('mismatch-duration');reasons.push('returned-audio-mismatch','audio-duration-mismatch');
      rejectedStatus='La opción no coincide (duración) · probando otra…';
      p.status?.(rejectedStatus);
     }
     return false;
    });
    const selected=matches[0];
    if(!selected){if(!selections&&!filteredOptions.size){reasons.push('no-compatible-row');measurement?.rejection('no-compatible-row');}break;}
    const menu=selected.row.kind==='option';
    if(menu&&callbackBudget<=0)break;
    const hasAlternate=matches.some(candidate=>candidate.key!==selected.key);
    waitingSince=performance.now();
    const available=!p.accept||await waitForLane();
    if(timing)timing.values.waitMs+=elapsedMs(waitingSince);
    if(!available){
     if(botExpired()&&!channelDown(client.searchSnapshot())){markBotTimeout();break;}
     if(batch&&channelDown(client.searchSnapshot()))return {state:'telegram'};
     if(batch&&expired)break providersLoop;
     return {state:current()&&!p.signal.aborted?'unavailable':'stopped'};
    }
    const prior=client.searchSnapshot(),allowed=client.captureSearchActionCurrent();
    if(!live()||!same(prior,provider.providerRef,queryId)||(!reuse&&prior.error)||prior.delivery!=='acknowledged'||!prior.rows.some(r=>r.rowRef===selected.row.rowRef)||!allowed()){
     if((expired||botExpired())&&!channelDown(prior,owned(prior,provider.providerRef,queryId))){markBotTimeout();break;}
     if(!p.accept)return {state:'uncertain'};
     if(batch&&channelDown(prior,owned(prior,provider.providerRef,queryId)))return {state:'telegram'};
     if(collection){
      // A manual search may replace the selected row. Get a fresh selection once.
      if(!same(prior,provider.providerRef,queryId)&&!selectionRetried&&live()){
       selectionRetried=true;continue;
      }
      reasons.push('selection-changed');measurement?.rejection('selection-changed');break;
     }
     if(await retryTransient())continue;
     unavailable=true;break;
    }
    let admittedDownload=false,transferStarted:number|undefined,lastProgress=-Infinity;
    const downloadStarted=performance.now();
    const unsubscribe=p.status||menu?client.subscribeSearch(s=>{
     const progress=s.downloadProgress;
     if(!admittedDownload||p.signal.aborted||!owned(s,provider.providerRef,queryId)||!s.pending||!progress?.total||s.cancelling)return;
     transferStarted??=performance.now();
     if(performance.now()-lastProgress<250&&progress.bytes!==progress.total)return;
     lastProgress=performance.now();
     p.status?.(`Descargando ${mb(progress.bytes,progress.total)} de ${mb(progress.total,progress.total)} MB…`);
    }):undefined;
    let audio:BotDownloadedAudio|null;
    try{
     audio=await client.downloadBot(selected.row.rowRef,allowed,admission=>{
      if(admission.queryId!==queryId)return;
      admittedDownload=true;measurement?.candidate(menu);ownedCancel=admission.cancel;
      if(menu)p.status?.(`${rejectedStatus?rejectedStatus+' ':''}El bot prepara el archivo…`);
      rejectedStatus='';
      if(expired||botTimedOut||p.signal.aborted)cancel();
     },timing||measurement?value=>{timing?.download(value);measurement?.network(value);}:undefined,
     menu&&p.accept?callbackBudget:undefined);
    }finally{unsubscribe?.();ownedCancel=undefined;}
    if(menu)callbackBudget-=Math.round((transferStarted??performance.now())-downloadStarted);
    const after=client.searchSnapshot();
    // The admitted download already validates the worker reply against its
    // query. For a collection, received bytes only need the captured authority.
    const audioAuthorized=current()&&!p.signal.aborted&&(p.audioCurrent?.()??true);
    if(batch&&audio&&!audioAuthorized)return {state:current()&&!p.signal.aborted?'telegram':'stopped'};
    const received=collection&&audio&&admittedDownload&&audioAuthorized&&!!p.audioCurrent;
    const afterOwn=owned(after,provider.providerRef,queryId);
    if(admittedDownload&&!audio&&(expired||botExpired()))observeError('timeout',downloadStarted);
    else if(admittedDownload&&afterOwn&&after.error)observeError(after.error,downloadStarted);
    if(reuse&&afterOwn&&after.delivery==='not-dispatched'&&(after.error==='conflict'||after.error==='expired')&&!selectionRetried&&live()){
     selectionRetried=true;continue;
    }
    if(admittedDownload&&measurement){
     if(audio)measurement.values.candidatesDownloaded++;
     else if(afterOwn&&(!after.error||!['cancelled','network','rate-limit','session-expired','busy','uncertain','expired'].includes(after.error)))measurement.values.candidatesRejected++;
    }
    const rejected=collection&&admittedDownload&&confirmedRejection(after,afterOwn);
    if(!received&&batch&&channelDown(after,afterOwn))return {state:'telegram'};
    if(!audio&&(expired||botExpired()||menu&&admittedDownload&&afterOwn&&after.error==='timeout')){
     if(!p.accept&&expired)return {state:'uncertain'};
     markBotTimeout();
     break;
    }
    if(!received&&!rejected&&(!admittedDownload||!live()||!same(after,provider.providerRef,queryId))){
     if(!p.accept)return {state:'uncertain'};
     if(collection){
      if(!admittedDownload&&(after.pending||after.cancelling))continue;
      reasons.push('file-invalid');break;
     }
     if((!admittedDownload||owned(after,provider.providerRef,queryId)&&transient(after)&&after.delivery!=='uncertain')&&await retryTransient())continue;
     reasons.push('file-invalid');
     break;
    }
    if(!audio&&batch&&afterOwn&&after.delivery==='acknowledged'&&
     (['unsupported','needs-start','limit'].includes(after.error??'')||isBotSearchLimitError(after.error)))break;
    if(audio&&JSON.stringify(audio.target)!==JSON.stringify(target)){
     if(!p.accept)return {state:'uncertain'};
     reasons.push('returned-audio-mismatch');break;
    }
    const excludedAudio=!!audio&&p.excludedDigests?.has(audio.sha256);
    if(audio&&!excludedAudio){
     timing?.attach(audio);
     if(!p.accept){timingResult='received';if(measurement)measurement.values.winningBotSlot=i;return {state:'audio',audio};}
     let disposition:CandidateDisposition|'saved';
     // Finish the atomic local save without spending the next bot's network reserve.
     clearTimeout(timer);
     const importStarted=performance.now();
     try{disposition=await p.accept(audio,selected.key);}catch{return {state:'stopped'};}
     finally{if(measurement)measurement.values.importMs+=elapsedMs(importStarted);extend(performance.now()-importStarted);}
     if(disposition==='saved'){
      timingResult='saved';health?.observe(provider.providerRef,elapsedMs(botStarted),'success');
      if(measurement)measurement.values.winningBotSlot=i;
      return {state:'audio',audio};
     }
     if(disposition==='parked'||disposition==='unavailable')timingResult='uncertain';
     if(disposition!=='retry'&&disposition!=='import-tag-mismatch'&&disposition!=='import-duration-mismatch')return {state:batch&&disposition==='unavailable'?'telegram':disposition};
     measurement?.rejection(disposition==='retry'?'file-invalid':disposition);
     if(disposition!=='retry'){
      metadataRejections++;
      health?.observe(provider.providerRef,elapsedMs(botStarted),'metadata-rejected');
      const field=disposition==='import-tag-mismatch'?'metadatos':'duración';
      rejectedStatus=`La opción no coincide (${field}) · probando otra…`;
     }
     reasons.push('file-invalid');
    }else if(!collection&&p.accept&&transient(after)&&after.delivery!=='uncertain'){
     if(await retryTransient())continue;
     reasons.push('file-invalid');
     break;
    }else if(audio||after.delivery!=='uncertain'&&after.error==='file-invalid')reasons.push('file-invalid');
    else if(after.error==='conflict'&&after.delivery==='not-dispatched')reasons.push('selection-changed');
    else if(after.error==='file-too-large'&&after.delivery!=='uncertain')reasons.push('file-too-large');
    else if(after.delivery==='acknowledged'&&after.error===null&&after.rows.some(r=>r.kind==='audio')&&!matchingSongRows(after.rows.filter(r=>r.kind==='audio'),target).length){
     reasons.push('returned-audio-mismatch');
     const fields=new Set<SongRejection>();
     for(const row of after.rows)if(row.kind==='audio')for(const field of botAudioMismatchFields(row,target)){
      reasons.push(`audio-${field}-mismatch`);fields.add(mismatchReason(field));
     }
     for(const field of fields)measurement?.rejection(field);
     const text=mismatchText(fields);
     rejectedStatus=text?`La opción no coincide (${text}) · probando otra…`:'La opción no coincide · probando otra…';
     p.status?.(rejectedStatus);
    }else if(!p.accept)return {state:'uncertain'};
    else if(collection){reasons.push('file-invalid');break;}
    else if(after.delivery==='uncertain'){reasons.push('file-invalid');break;}
    else reasons.push('file-invalid');

    if(audio&&measurement)measurement.values.candidatesRejected++;
    if(excludedAudio)measurement?.rejection('file-invalid');
    excludedRows.add(selected.key);
    selections++;
    if(!p.accept||!hasAlternate||metadataRejections>=METADATA_REJECTIONS_PER_BOT)break;
    if(menu&&afterOwn&&after.expiresAt!==null&&after.rows.some(row=>row.kind==='option'))reusableQuery=queryId;
    }finally{timing?.finish(p.signal.aborted&&timingResult==='failed'?'cancelled':timingResult);}
   }
   if(healthOutcome&&(healthOutcome!=='reply'||!metadataRejections))health?.observe(provider.providerRef,elapsedMs(botStarted),healthOutcome);
   collection?.completed.add(i);
  }
  if(!current()||p.signal.aborted)return {state:p.accept?'stopped':'uncertain'};
  if(batch&&channelDown(client.searchSnapshot()))return {state:'telegram'};
  if(incompleteBot)return {state:batch?'timed-out':p.accept?'unavailable':'uncertain'};
  if(batch&&!reasons.length)reasons.push('no-compatible-row');
  if(!batch&&unavailable&&reasons.every(reason=>reason==='no-compatible-row'))return {state:'unavailable'};
  return {state:'known-failure',reasons};
 }catch{cancel();return {state:batch&&channelDown(client.searchSnapshot())?'telegram':'uncertain'};}finally{clearTimeout(timer);p.signal.removeEventListener('abort',cancel);if(ownMeasurement)measurement?.finish();}
}
