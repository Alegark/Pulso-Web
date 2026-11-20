import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {formatStorageMB} from './storage-format';
import {AUDIO_FILE_MAX_BYTES} from '../storage/audio-limits';
import {matchingSongRows} from './selected-song';
import {botAudioMismatchFields,type BotSearchTarget,type BotDownloadedAudio,type BotSearchRow} from '../telegram/bot-search-protocol';
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
export type CandidateDisposition='retry'|'parked'|'stopped';
type Result={state:'audio';audio:BotDownloadedAudio}|{state:'known-failure';reasons:readonly AcquisitionFailureReason[]}|{state:'uncertain'|'unavailable'|'parked'|'stopped'};
/** Reissued queries get fresh rowRefs. Exclude the same projected selection across queries. */
function candidateIdentity(row:BotSearchRow):readonly unknown[]{
 return row.kind==='option'?[row.kind,row.label]:row.kind==='audio'?[row.kind,row.title,row.performer,row.durationSeconds,row.mimeType,row.bytes]:[row.kind,row.text];
}
export async function acquireFromOrderedBots(p:{client:TelegramSessionClient;providers:readonly OrderedProvider[];revision:number;target:BotSearchTarget;signal:AbortSignal;current:()=>boolean;networkCurrent:()=>boolean;remoteClock?:{settledAt:number};collection?:boolean;accept?:(audio:BotDownloadedAudio,rowKey:string)=>Promise<CandidateDisposition|'saved'>;excludedDigests?:ReadonlySet<string>;excludedRowKeys?:ReadonlySet<string>;progress:(provider:OrderedProvider,index:number,queryId:string|null)=>void}):Promise<Result> {
 const {client}=p,target={...p.target},network=p.networkCurrent,current=p.current,revision=p.revision,deadline=Date.now()+SONG_SEARCH_MS;
 const seen=new Set<string>(),providers=p.providers.filter(provider=>{if(seen.has(provider.providerRef))return false;seen.add(provider.providerRef);return true;}).slice(0,5).map(provider=>({...provider}));
 const reasons:AcquisitionFailureReason[]=[],excludedRows=new Set(p.excludedRowKeys);
 let expired=false,unavailable=false;
 let ownedCancel:(()=>void)|undefined;
 const cancel=()=>{try{ownedCancel?.();}catch{/* Cancellation cannot grant a new lane. */}};
 const timer=setTimeout(()=>{expired=true;cancel();},SONG_SEARCH_MS);
 p.signal.addEventListener('abort',cancel);
 const live=()=>!expired&&!p.signal.aborted&&Date.now()<deadline&&current()&&network()&&client.botsSnapshot().revision===revision;
 const delay=(ms:number)=>new Promise<void>(resolve=>{
  const timer=setTimeout(done,ms);
  function done(){clearTimeout(timer);p.signal.removeEventListener('abort',done);resolve();}
  p.signal.addEventListener('abort',done,{once:true});
  if(p.signal.aborted)done();
 });
 const wait=async()=>{const ms=p.remoteClock?Math.max(0,p.remoteClock.settledAt+1000-Date.now()):0;if(ms)await delay(ms);};
 const waitForLane=async()=>{
  const until=Math.min(deadline,Date.now()+TELEGRAM_WAIT_MS);
  while(current()&&!p.signal.aborted&&Date.now()<until){
   const state=client.searchSnapshot();
   if(state.retryBlocked||(state.retryAt??0)>=until)return false;
   if(network()&&client.botsSnapshot().revision!==revision)return false;
   if(live()&&state.available&&!state.pending&&!state.cancelling&&(state.retryAt??0)<=Date.now())return true;
   if(p.collection)return false;
   await delay(state.retryAt&&state.retryAt>Date.now()?state.retryAt-Date.now():250);
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
 try {
  for(let i=0;i<providers.length;i++){
   const provider=providers[i];
   let selections=0,retries=0;
   while(selections<CANDIDATES_PER_BOT){
    await wait();
    if(p.accept){
     if(!await waitForLane())return {state:current()&&!p.signal.aborted?'unavailable':'stopped'};
    }else if(!live())return {state:'uncertain'};
    const before=client.searchSnapshot();
    if(!p.accept&&(before.pending||!before.available||before.retryBlocked||before.retryAt!==null&&before.retryAt>Date.now()||before.error==='uncertain'))return {state:'uncertain'};
    const retryTransient=async()=>{
     if(retries++>=TRANSIENT_RETRIES_PER_BOT)return false;
     await delay(250);
     return true;
    };
    p.progress(provider,i,null);
    let queryId:string|null=null;
    const terminal=new Promise<void>(resolve=>{
     const unsubscribe=client.subscribeSearch(s=>{if(queryId&&(!s.pending||!s.available)){unsubscribe();resolve();}});
     const allowed=client.captureSearchActionCurrent();if(live()&&allowed())client.searchBot({providerRef:provider.providerRef,query:target.title,target,consent:true},allowed,admission=>{queryId=admission.queryId;ownedCancel=admission.cancel;if(expired||p.signal.aborted)cancel();});
     const now=client.searchSnapshot();
     if(!queryId||!now.pending){unsubscribe();resolve();}
    });
    p.progress(provider,i,queryId);await terminal;ownedCancel=undefined;settled();
    const found=client.searchSnapshot();
    if(!same(found,provider.providerRef,queryId)||found.error||found.delivery!=='acknowledged'||!live()){
     if(!p.accept)return {state:'uncertain'};
     if(p.collection&&(!live()||found.retryBlocked||(found.retryAt??0)>Date.now()))return {state:'unavailable'};
     const ownReply=owned(found,provider.providerRef,queryId);
     if(!p.collection&&(!queryId||ownReply&&transient(found))&&await retryTransient())continue;
     if(ownReply&&found.delivery==='acknowledged'&&(found.error==='file-too-large'||found.error==='file-invalid'))reasons.push(found.error);
     else if(p.collection)return {state:'unavailable'};
     else unavailable=true;
     break;
    }
    const occurrences=new Map<string,number>();
    const matches=matchingSongRows(found.rows,target).map(row=>{
     const identity=JSON.stringify([provider.providerRef,...candidateIdentity(row)]);
     const occurrence=occurrences.get(identity)??0;
     occurrences.set(identity,occurrence+1);
     // The first occurrence uses the key already stored in v50 checkpoints.
     const key=bytesToHex(sha256(new TextEncoder().encode(occurrence?JSON.stringify([identity,occurrence]):identity)));
     return {row,key};
    }).filter(candidate=>!excludedRows.has(candidate.key));
    const selected=matches[0];
    if(!selected){if(!selections)reasons.push('no-compatible-row');break;}
    const hasAlternate=matches.some(candidate=>candidate.key!==selected.key);
    await wait();
    if(p.accept&&!await waitForLane())return {state:current()&&!p.signal.aborted?'unavailable':'stopped'};
    const prior=client.searchSnapshot(),allowed=client.captureSearchActionCurrent();
    if(!live()||!same(prior,provider.providerRef,queryId)||prior.error||prior.delivery!=='acknowledged'||!prior.rows.some(r=>r.rowRef===selected.row.rowRef)||!allowed()){
     if(!p.accept)return {state:'uncertain'};
     if(p.collection)return {state:'unavailable'};
     if(await retryTransient())continue;
     unavailable=true;break;
    }
    let admittedDownload=false;
    const downloading=client.downloadBot(selected.row.rowRef,allowed,admission=>{if(admission.queryId===queryId){admittedDownload=true;ownedCancel=admission.cancel;if(expired||p.signal.aborted)cancel();}});
    const audio=await downloading;ownedCancel=undefined;settled();
    const after=client.searchSnapshot();
    if(!admittedDownload||!live()||!same(after,provider.providerRef,queryId)){
     if(!p.accept)return {state:'uncertain'};
     if(p.collection)return {state:'unavailable'};
     if((!admittedDownload||owned(after,provider.providerRef,queryId)&&transient(after)&&after.delivery!=='uncertain')&&await retryTransient())continue;
     reasons.push('file-invalid');
     break;
    }
    if(audio&&JSON.stringify(audio.target)!==JSON.stringify(target)){
     if(!p.accept)return {state:'uncertain'};
     reasons.push('returned-audio-mismatch');break;
    }
    if(audio&&!p.excludedDigests?.has(audio.sha256)){
     if(!p.accept)return {state:'audio',audio};
     let disposition:CandidateDisposition|'saved';
     try{disposition=await p.accept(audio,selected.key);}catch{return {state:'stopped'};}
     if(disposition==='saved')return {state:'audio',audio};
     if(disposition!=='retry')return {state:disposition};
     reasons.push('file-invalid');
    }else if(p.collection&&!audio&&(
     after.delivery==='uncertain'||['busy','network','timeout','expired','session-expired','rate-limit','cancelled','uncertain'].includes(after.error??'')
    ))return {state:'unavailable'};
    else if(p.accept&&transient(after)&&after.delivery!=='uncertain'){
     if(await retryTransient())continue;
     reasons.push('file-invalid');
     break;
    }else if(audio||after.delivery!=='uncertain'&&after.error==='file-invalid')reasons.push('file-invalid');
    else if(after.error==='conflict'&&after.delivery==='not-dispatched')reasons.push('selection-changed');
    else if(after.error==='file-too-large'&&after.delivery!=='uncertain')reasons.push('file-too-large');
    else if(after.delivery==='acknowledged'&&after.error===null&&after.rows.some(r=>r.kind==='audio')&&!matchingSongRows(after.rows,target).length){
     reasons.push('returned-audio-mismatch');
     for(const row of after.rows)if(row.kind==='audio')for(const field of botAudioMismatchFields(row,target))reasons.push(`audio-${field}-mismatch`);
    }else if(!p.accept)return {state:'uncertain'};
    else if(p.collection)return {state:'unavailable'};
    else if(after.delivery==='uncertain'){reasons.push('file-invalid');break;}
    else reasons.push('file-invalid');

    excludedRows.add(selected.key);
    selections++;
    if(!p.accept||!hasAlternate)break;
   }
  }
  if(!current()||p.signal.aborted)return {state:p.accept?'stopped':'uncertain'};
  if(unavailable&&!reasons.some(reason=>reason!=='no-compatible-row'))return {state:'unavailable'};
  return {state:'known-failure',reasons};
 }catch{cancel();return {state:'uncertain'};}finally{clearTimeout(timer);p.signal.removeEventListener('abort',cancel);}
}
