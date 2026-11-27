import {LibraryDownloadController,type CollectionDownloadAction} from './LibraryDownloadController';
import {albumCoordinator,notifyAlbumDownload} from '../library/album-download';
import {orderedProviders,acquireFromOrderedBots} from '../library/ordered-bot-acquisition';
import {parseBotSearchTarget} from '../telegram/bot-search-protocol';
import type {CollectionSlot} from '../playback/continuous-collection';
import type {SongChoice} from '../library/selected-song';
import {formatStorageMB} from '../library/storage-format';
import {AUDIO_FILE_MAX_BYTES} from '../storage/audio-limits';
import {registerUpdateBlocker} from '../service-worker/update-blockers';
import type {BotDownloadedAudio} from '../telegram/bot-search-protocol';
import type {SongPlaybackAttempt,SongManagement,SongCopyInspection} from '../library/selected-song';
import React from 'react';
import {createPortal} from 'react-dom';
import type {Track,Playlist} from '../library/library';
import {MusicSearchController} from './MusicSearchController';
import type {Activity} from '../playback/ownership';
import {TelegramSourcesPanel} from './TelegramSourcesPanel';
import {BotProvidersController} from './BotProvidersController';
import {TelegramSessionClient,type SourcesSnapshot,type BotsSnapshot,type BotSearchSnapshot} from '../telegram/session-client';
import {initialSessionState,sessionErrorText,type SessionState} from '../telegram/session-protocol';
import {telegramBlockText,type TelegramBlockReason} from '../telegram/admission';
import {TelegramPhoneFields} from './TelegramPhoneFields';
import {TelegramQrLogin} from './TelegramQrLogin';
import {hasSavedTelegramSession} from '../telegram/saved-session';
import {useTelegramPhonePreference} from '../accounts/telegram-phone-preference';
import {normalizeInternationalTelegramPhone,internationalPhoneNumberErrorText as phoneNumberErrorText} from '../telegram/phone-number';
import './telegram.css';
import {RequiredSetup,SetupBots,setupWasCompleted,rememberCompletedSetup} from './RequiredSetup';
type MusicSearchProps = React.ComponentProps<typeof MusicSearchController>;
export interface ContinuousPrefetchRunner {
 isReady():boolean;
 downloadSlot(slot:CollectionSlot,signal:AbortSignal):Promise<{state:'ready';trackId:string}|{state:'failed';channelWide:boolean;message?:string}|{state:'cancelled'}>;
}
export interface TelegramPanelProps {
 onContinuousPrefetchRunner?:(runner:ContinuousPrefetchRunner|null)=>void;
 trackMenuHost?:MusicSearchProps['trackMenuHost']; warmConnectionSignal?:number;
 songAliases?:MusicSearchProps['songAliases'];localAvailability?:MusicSearchProps['localAvailability'];
 libraryAlbum?:{page:NonNullable<MusicSearchProps['libraryAlbum']>;target:HTMLElement;visible:boolean};
 savedAlbums?:MusicSearchProps['savedAlbums'];
 saveAlbum?:MusicSearchProps['saveAlbum'];
 albumSaveBlockedReason?:string;
 connectionWorkPending?:()=>boolean;
 captureDownloadOwner?:()=>()=>boolean;downloadStorageReady?:()=>boolean;downloadUpdateWait?:'checking'|'updating'|null;onStopDownloadUpdate?:()=>void;downloadCollection?:CollectionDownloadAction;downloadStorageTarget?:HTMLElement|null;canSaveArtist?:boolean;savedArtists?:MusicSearchProps['savedArtists'];saveArtist?:MusicSearchProps['saveArtist'];requiredSetup?:boolean;onSetupReady?:(ready:boolean)=>void;accountId?:string;activity:Activity;canConnect:boolean;scopeKey:string;captureCurrent:()=>()=>boolean;captureLifetime?:()=>()=>boolean;captureSongPlayback?:()=>SongPlaybackAttempt|null;captureSongDownload?:()=>SongPlaybackAttempt|null;captureAlbumDownload?:()=>SongPlaybackAttempt|null;captureBatchDownload?:(recoverPending?:boolean)=>SongPlaybackAttempt|null;onReviewDownloadStorage?:()=>void;onReviewedDownload?:(operationId?:string)=>void;captureSongCopyInspection?:()=>SongCopyInspection|null;blockedReason?:TelegramBlockReason;libraryPending?:boolean;libraryLoaded?:boolean;onCheckControl?:()=>void;onRequestControl?:()=>void;searchTarget?:HTMLElement|null;searchVisible?:boolean;localTracks?:readonly Track[];libraryTrackIds?:ReadonlySet<string>;songPlaylists?:readonly Playlist[];playerTrackId?:string|null;playerPlaying?:boolean;captureSongManagement?:(id:string)=>SongManagement|null;captureDownloadSave?:()=>((audio:BotDownloadedAudio,signal:AbortSignal,onProgress:(bytes:number)=>void)=>Promise<'saved'|'failed'|'uncertain'>)|null}
export function TelegramPanel({onContinuousPrefetchRunner,warmConnectionSignal,trackMenuHost,songAliases,localAvailability,libraryAlbum,savedAlbums,saveAlbum,albumSaveBlockedReason,connectionWorkPending,requiredSetup=false,captureDownloadOwner,downloadStorageReady,onSetupReady,downloadUpdateWait,onStopDownloadUpdate,downloadCollection,downloadStorageTarget,savedArtists,saveArtist,canSaveArtist,accountId,activity,canConnect,scopeKey,captureCurrent,captureLifetime=captureCurrent,captureSongPlayback,captureSongDownload,captureAlbumDownload,captureBatchDownload,onReviewDownloadStorage,onReviewedDownload,captureSongCopyInspection,blockedReason='busy',libraryPending=false,libraryLoaded=false,onCheckControl,onRequestControl,searchTarget=null,searchVisible=false,localTracks=[],libraryTrackIds,songPlaylists=[],playerTrackId=null,playerPlaying=false,captureSongManagement,captureDownloadSave}:TelegramPanelProps){
 const preference=useTelegramPhonePreference(accountId),phoneTouched=React.useRef(false);
 const phoneAttempt=React.useRef<{client:TelegramSessionClient;accountId:string;phone:string;scope:string}|null>(null);
 const [searchState,setSearchState]=React.useState<BotSearchSnapshot|null>(null);
 const [sources,setSources]=React.useState<SourcesSnapshot|null>(null);
 const [bots,setBots]=React.useState<BotsSnapshot|null>(null);
 const [vault,setVault]=React.useState<{accountId?:string;state:'present'|'absent'|'unknown'}|null>(null);
 const savedSession=vault&&vault.accountId===accountId?vault.state:'checking';
 const resumeTried=React.useRef<TelegramSessionClient|null>(null),pageSuspended=React.useRef(false);
 const [pageGeneration,setPageGeneration]=React.useState(0);
 const [state,setState]=React.useState<SessionState>(initialSessionState);const [phone,setPhone]=React.useState('');const [country,setCountry]=React.useState('');const [code,setCode]=React.useState('');const [password,setPassword]=React.useState('');const [consent,setConsent]=React.useState(false);
 const [now,setNow]=React.useState(Date.now);const client=React.useRef<TelegramSessionClient|null>(null);const heading=React.useRef<HTMLHeadingElement>(null);const input=React.useRef<HTMLInputElement>(null);const current=React.useRef(captureCurrent);current.current=captureCurrent;
 React.useEffect(()=>{if(warmConnectionSignal)client.current?.connectionActivity?.();},[warmConnectionSignal]);
 const updateState=React.useRef({phase:state.phase,phone,code,password,country});updateState.current={phase:state.phase,phone,code,password,country};
 React.useLayoutEffect(()=>registerUpdateBlocker(()=>{
  const service=client.current,phase=service?.snapshot().phase??updateState.current.phase;
  const search=service?.searchSnapshot(),bots=service?.botsSnapshot(),sources=service?.sourcesSnapshot();
  return !!albumCoordinator.prefetchFlight||!['disconnected','connected','error'].includes(phase)||Object.entries(updateState.current).some(([key,value])=>key!=='phase'&&value.trim()!=='')||
   !!(search?.pending||search?.cancelling||bots?.pending||bots?.cancelling||sources?.pending||sources?.reading||sources?.cancelling);
 }),[]);
 const lifetime=React.useRef(captureLifetime);lifetime.current=captureLifetime;
 const pendingConnectionWork=React.useRef(connectionWorkPending);pendingConnectionWork.current=connectionWorkPending;
 const panel=React.useRef<HTMLElement>(null),focusIntent=React.useRef(false);
 React.useEffect(()=>{
  let live=true;phoneAttempt.current=null;
  const service=new TelegramSessionClient(activity,()=>lifetime.current(),value=>{if(live)setState(value);},undefined,undefined,value=>{if(live)setSources(value);},undefined,undefined,value=>{if(live)setBots(value);},value=>{if(live)setSearchState(value);},()=>current.current());
  const revalidate=()=>service.revalidate();
  service.configureConnectionLifecycle(document.visibilityState==='visible',()=>!!(albumCoordinator.running||albumCoordinator.dispatching||albumCoordinator.songFlight||albumCoordinator.prefetchFlight||pendingConnectionWork.current?.()));
  albumCoordinator.listeners.add(revalidate);
  client.current=service;setState(initialSessionState());setSources(null);setBots(null);setSearchState(null);
  return()=>{live=false;albumCoordinator.listeners.delete(revalidate);client.current=null;service.dispose();};
 },[activity,scopeKey]);
 React.useEffect(()=>{const active=!['disconnected','error'].includes(state.phase);client.current?.revalidate();if(!lifetime.current()()){client.current?.stop(active?'cancelled':null);setCode('');setPassword('');if(active){setCountry('');setPhone('');setConsent(false);}}},[canConnect,scopeKey]);
 React.useEffect(()=>{client.current?.revalidate();});
 React.useEffect(()=>{
  if(!['disconnected','error','connected'].includes(state.phase))return;
  let live=true;void hasSavedTelegramSession().then(present=>{if(live)setVault({accountId,state:present?'present':'absent'});}).catch(()=>{if(live)setVault(previous=>previous&&previous.accountId===accountId?previous:{accountId,state:'unknown'});});
  return()=>{live=false;};
 },[accountId,scopeKey,state.phase]);
 React.useEffect(()=>{
  const service=client.current;if(pageSuspended.current||document.visibilityState!=='visible'||!service||resumeTried.current===service||savedSession!=='present'||state.phase!=='disconnected'||!canConnect||navigator.onLine===false||!current.current()())return;
  resumeTried.current=service;service.restore();
 },[savedSession,state.phase,canConnect,scopeKey,pageGeneration]);
 React.useEffect(()=>{
  const close=(event:PageTransitionEvent)=>{
   pageSuspended.current=true;
   if(event.persisted){resumeTried.current=null;client.current?.stop(null);}
   else client.current?.stop('cancelled');
  };
  const reopen=(event:PageTransitionEvent)=>{
   if(event.persisted){
    pageSuspended.current=false;
    client.current?.setConnectionVisibility(document.visibilityState==='visible');
    setPageGeneration(value=>value+1);
   }
  };
  const visibility=()=>{
   const visible=document.visibilityState==='visible';
   const service=client.current;
   service?.setConnectionVisibility(visible);
   if(visible&&!pageSuspended.current&&service?.snapshot().phase==='disconnected')setPageGeneration(value=>value+1);
  };
  document.addEventListener('visibilitychange',visibility);
  addEventListener('pagehide',close);addEventListener('pageshow',reopen);
  return()=>{document.removeEventListener('visibilitychange',visibility);removeEventListener('pagehide',close);removeEventListener('pageshow',reopen);};
 },[]);
 React.useEffect(()=>{const pointer=()=>{focusIntent.current=false;};const key=(event:KeyboardEvent)=>{if(event.key==='Tab')focusIntent.current=false;};const focus=(event:FocusEvent)=>{if(event.target instanceof Element&&event.target!==document.body&&event.target!==document.documentElement&&!panel.current?.contains(event.target))focusIntent.current=false;};addEventListener('pointerdown',pointer,true);addEventListener('keydown',key,true);addEventListener('focusin',focus,true);return()=>{focusIntent.current=false;removeEventListener('pointerdown',pointer,true);removeEventListener('keydown',key,true);removeEventListener('focusin',focus,true);};},[]);
 React.useEffect(()=>{if(!state.retryAt&&!state.codeResend)return;const until=Math.max(state.retryAt??0,state.codeResend?.availableAt??0);setNow(Date.now());if(Date.now()>=until)return;const timer=setInterval(()=>{const value=Date.now();setNow(value);if(value>=until)clearInterval(timer);},1000);return()=>clearInterval(timer);},[state.retryAt,state.codeResend]);
 React.useEffect(()=>{if(state.phase==='error')phoneAttempt.current=null;if(state.phase==='connected'){phoneTouched.current=false;setCountry('');setPhone('');setCode('');setPassword('');}if(!focusIntent.current)return;if(state.phase==='code'||state.phase==='password')input.current?.focus();else if(state.phase==='qr')panel.current?.querySelector<HTMLElement>('[data-telegram-qr-heading]')?.focus();else if(state.phase==='connected')heading.current?.focus();if(['code','qr','password','connected'].includes(state.phase))focusIntent.current=false;},[state.phase]);
 const pending=['restoring','sending-code','authorizing','disconnecting'].includes(state.phase),retrying=state.retryAt!==null&&now<state.retryAt;
 const draft=React.useRef<object|null>(null),draftToken={};
 React.useLayoutEffect(()=>{draft.current=draftToken;return()=>{if(draft.current===draftToken)draft.current=null;};});
 const draftCurrent=()=>draft.current===draftToken&&savedSession==='absent'&&!pending&&(state.phase==='disconnected'||state.phase==='error');
 const actionCurrent=captureCurrent(),actionClient=client.current,sessionAction=actionClient?.captureSessionCurrent(),localStop=actionClient?.captureLocalStop();
 const qrChallenge=actionClient?.qrChallenge();
 const qrCurrent=()=>client.current===actionClient&&!!sessionAction?.()&&actionCurrent()&&canConnect&&!pending&&!!panel.current?.getClientRects().length;
 const beginQr=()=>{if(!qrCurrent()||retrying||!['disconnected','error','code'].includes(state.phase)||state.phase!=='code'&&(savedSession!=='absent'||draft.current!==draftToken))return;if(state.phase==='code'&&!localStop?.())return;phoneAttempt.current=null;resumeTried.current=actionClient;setCode('');setPassword('');focusIntent.current=true;actionClient?.beginQr();};
 React.useEffect(()=>{if(preference.phone&&!phoneTouched.current&&savedSession==='absent'&&['disconnected','error'].includes(state.phase))setPhone(preference.phone);},[preference.phone,savedSession,state.phase]);
 React.useEffect(()=>{const attempt=phoneAttempt.current;if(state.phase!=='connected'||!attempt)return;phoneAttempt.current=null;if(attempt.client===client.current&&attempt.scope===scopeKey&&attempt.accountId===accountId)void preference.remember(attempt.phone,attempt.accountId);},[state.phase,scopeKey,accountId,preference]);
 const [completion,setCompletion]=React.useState(()=>({accountId,done:setupWasCompleted(accountId)}));
 const completed=completion.accountId===accountId?completion.done:setupWasCompleted(accountId);
 const restoring=state.phase==='restoring'||savedSession==='checking'||
  state.phase==='disconnected'&&savedSession==='present'&&navigator.onLine!==false&&(canConnect||blockedReason==='busy'||blockedReason==='acquiring');
 const downloadConnection=state.phase==='connected'?(bots?.binding?'connected':'initializing'):
  restoring?'initializing':!canConnect?'blocked':'disconnected';
 const setupNeeded=requiredSetup&&(!completed||savedSession==='checking'||savedSession==='unknown'||savedSession==='absent'&&state.phase!=='connected'||state.phase==='connected'&&!!bots?.binding&&bots.providers.length===0);
 React.useLayoutEffect(()=>{onSetupReady?.(!setupNeeded);},[onSetupReady,setupNeeded]);
 const setupNeededRef=React.useRef(setupNeeded);setupNeededRef.current=setupNeeded;
 const latestRef=React.useRef({phase:state.phase,bots,localTracks,captureSongDownload,onContinuousPrefetchRunner});
 latestRef.current={phase:state.phase,bots,localTracks,captureSongDownload,onContinuousPrefetchRunner};
 React.useEffect(()=>{
  const runner:ContinuousPrefetchRunner={
   isReady(){const p=latestRef.current,c=client.current,s=c?.searchSnapshot();return !setupNeededRef.current&&p.phase==='connected'&&navigator.onLine!==false&&orderedProviders(p.bots).length>0&&!!s?.available&&!s.pending&&!s.cancelling&&!s.retryBlocked&&(s.retryAt===null||s.retryAt<=Date.now());},
   async downloadSlot(slot,signal){
    if(signal.aborted||!runner.isReady()||albumCoordinator.running||albumCoordinator.dispatching||albumCoordinator.songFlight||albumCoordinator.prefetchFlight)return {state:'failed',channelWide:true};
    const attempt=latestRef.current.captureSongDownload?.();if(!attempt?.current())return {state:'failed',channelWide:true};
    let choice:SongChoice;
    if(slot.kind==='album-track')choice=slot.choice;
    else {const track=latestRef.current.localTracks.find(t=>t.id===slot.trackId);if(!track)return {state:'failed',channelWide:false};choice={source:'local',id:'local:'+track.id,title:track.manualOverrides.title??track.catalogChoice?.title??track.title,artist:'artist' in track.manualOverrides?track.manualOverrides.artist??null:track.catalogChoice?.artist??track.artist,album:'album' in track.manualOverrides?track.manualOverrides.album??null:track.catalogChoice?.album??track.album,duration:track.catalogChoice?.duration??track.duration};}
    const target=parseBotSearchTarget({title:choice.title.normalize('NFC').trim(),artist:choice.artist?.normalize('NFC').trim()||null,album:choice.album?.normalize('NFC').trim()||null,durationSeconds:choice.duration});if(!target)return {state:'failed',channelWide:false};
    const abort=new AbortController(),onAbort=()=>abort.abort();signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)abort.abort();
    const token={};albumCoordinator.prefetchFlight={token,abort:()=>abort.abort()};notifyAlbumDownload(albumCoordinator);
    try{
     const local=await attempt.lookup(choice,abort.signal);if(abort.signal.aborted)return {state:'cancelled'};
     if(local){await attempt.rememberAlias?.(choice,local,abort.signal);return {state:'ready',trackId:local};}
     const service=client.current,providers=orderedProviders(latestRef.current.bots),revision=latestRef.current.bots?.revision,networkCurrent=service?.captureBotsCurrent();
     if(!service||!providers.length||revision===undefined||!networkCurrent)return {state:'failed',channelWide:true};
     const current=()=>!abort.signal.aborted&&albumCoordinator.prefetchFlight?.token===token&&attempt.current()&&networkCurrent()&&latestRef.current.bots?.revision===revision;
     const result=await acquireFromOrderedBots({client:service,providers,revision,target,signal:abort.signal,current,networkCurrent,remoteClock:albumCoordinator.remoteClock,progress:()=>{}});
     if(abort.signal.aborted)return {state:'cancelled'};
     if(result.state!=='audio')return {state:'failed',channelWide:result.state!=='known-failure'||result.reasons.some(r=>['rate-limit','session-expired','network','uncertain','busy','timeout'].includes(r))};
     const saved=await attempt.save(result.audio,choice,abort.signal,()=>{});if(abort.signal.aborted)return {state:'cancelled'};
     return saved.state==='saved'&&saved.trackId?{state:'ready',trackId:saved.trackId}:{state:'failed',channelWide:saved.state==='uncertain'};
    }finally{signal.removeEventListener('abort',onAbort);if(albumCoordinator.prefetchFlight?.token===token){delete albumCoordinator.prefetchFlight;notifyAlbumDownload(albumCoordinator);}}
   },
  };
  const register=latestRef.current.onContinuousPrefetchRunner;register?.(runner);return()=>register?.(null);
 },[]);

 const finishSetup=()=>{const service=client.current,snapshot=service?.botsSnapshot();if(service!==actionClient||!sessionAction?.()||!actionCurrent()||!canConnect||service?.snapshot().phase!=='connected'||!snapshot?.binding||snapshot.pending||snapshot.cancelling||!snapshot.providers.length)return;rememberCompletedSetup(accountId);setCompletion({accountId,done:true});};
 const normalizedPhone=normalizeInternationalTelegramPhone(phone);
 const draftReason=setupNeeded&&phone===''?null:!normalizedPhone.ok?phoneNumberErrorText[normalizedPhone.error]:!consent?'Marca la autorización para enviar tu número a Telegram.':null;
 const draftHelpId=React.useId(),draftReasonId=React.useId();
 const start=(event:React.FormEvent)=>{event.preventDefault();if(client.current!==actionClient||!sessionAction?.()||!actionCurrent()||!canConnect||!draftCurrent()||!consent||pending||retrying||!normalizedPhone.ok)return;resumeTried.current=actionClient;focusIntent.current=true;if(accountId&&actionClient)phoneAttempt.current={client:actionClient,accountId,phone:normalizedPhone.e164,scope:scopeKey};client.current?.begin(normalizedPhone.e164);setCode('');setPassword('');};
 const submit=(event:React.FormEvent)=>{event.preventDefault();if(client.current!==actionClient||!sessionAction?.()||!actionCurrent()||!canConnect||pending||retrying)return;focusIntent.current=true;if(state.phase==='code'){client.current?.submit('code',code);setCode('');}else if(state.phase==='password'){client.current?.submit('password',password);setPassword('');}};
 const connection=<section ref={panel} className="telegram-panel" aria-label="Conexión a Telegram"><h2 ref={heading} tabIndex={-1}>Tu cuenta de Telegram</h2>
 {!setupNeeded&&<><p>Conecta tu propia cuenta. Pulso conserva la autorización de Telegram en este navegador para recuperar la conexión al volver. No guarda tu código ni tu contraseña. «Cerrar sesión en Telegram» elimina la autorización guardada de esta conexión; la música y las playlists se conservan.</p>
 <p>En Buscar puedes consultar sugerencias y enviar una consulta al bot elegido. Al elegir una opción musical puedes obtener su audio y obtener una copia de reproducción de hasta {formatStorageMB(AUDIO_FILE_MAX_BYTES)} en este navegador. Se elige automáticamente la mejor coincidencia; «Agregar canción» y «Añadir a playlist» son acciones aparte.</p></>}
 {libraryPending&&<p role="status">Hay una comprobación pendiente de la biblioteca local. Puedes iniciar sesión en Telegram; los cambios en la biblioteca siguen en pausa.</p>}
 {!canConnect&&<div><p role="status">{telegramBlockText[blockedReason??'busy']}</p>{blockedReason==='no-control'&&<div className="controls">{onCheckControl&&<button onClick={onCheckControl}>Comprobar control</button>}{onRequestControl&&<button onClick={onRequestControl}>Usar en esta pestaña</button>}</div>}</div>}
 {(state.phase==='disconnected'||state.phase==='error')&&savedSession==='checking'&&<p role="status">Comprobando tu sesión guardada de Telegram…</p>}
 {(state.phase==='disconnected'||state.phase==='error')&&savedSession==='present'&&<div><p role="status">Tu sesión de Telegram sigue guardada en este navegador. Puedes reconectarla sin volver a escribir tu número.</p><button disabled={!canConnect||pending||retrying} onClick={()=>{if(client.current!==actionClient||!sessionAction?.()||!actionCurrent()||!canConnect||retrying)return;resumeTried.current=actionClient;actionClient?.restore();}}>Reconectar Telegram</button></div>}
 {(state.phase==='disconnected'||state.phase==='error')&&savedSession==='unknown'&&<p role="alert">No se pudo comprobar la sesión guardada. Puedes eliminarla de este navegador antes de iniciar otra conexión.</p>}
 {(state.phase==='disconnected'||state.phase==='error')&&(savedSession==='present'||savedSession==='unknown'||state.error==='session-storage'||state.error==='logout-storage-unconfirmed')&&<button disabled={!canConnect||pending} onClick={()=>{if(client.current!==actionClient||!sessionAction?.()||!actionCurrent()||!canConnect)return;resumeTried.current=actionClient;actionClient?.forgetSavedSession();}}>Eliminar sesión guardada</button>}
 {(state.phase==='disconnected'||state.phase==='error')&&savedSession==='absent'&&<form onSubmit={start}><TelegramPhoneFields phone={phone} country={country} disabled={pending} helpId={draftHelpId} reasonId={draftReason?draftReasonId:undefined} invalid={phone!==''&&!normalizedPhone.ok} onPhone={value=>{if(draftCurrent()){phoneTouched.current=true;setPhone(value);}}} onCountry={value=>{if(draftCurrent()){phoneTouched.current=true;setCountry(value);}}}/><p id={draftHelpId} className="telegram-phone-help">{setupNeeded?'Incluye + y el prefijo de tu país.':'Escribe o pega el número internacional con + y prefijo. También puedes buscar un país para insertar su prefijo. Los ceros se conservan.'}</p><label className="telegram-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={pending}/>Autorizo conectar esta pestaña con Telegram y enviar mi número para iniciar sesión.</label><button disabled={!canConnect||!consent||!normalizedPhone.ok||pending||retrying} aria-describedby={draftReason?draftReasonId:undefined}>Enviar código de acceso</button>{draftReason&&<p id={draftReasonId} role="status">{draftReason}</p>}</form>}
 {state.phase==='code'&&<form onSubmit={submit}><p>{state.delivery==='sms'?'Telegram envió el código por SMS.':state.delivery==='call'?'Telegram enviará el código mediante una llamada.':state.delivery==='email'?'Comprueba el código enviado por Telegram a tu correo.':'Abre Telegram y busca el código de acceso en el mensaje de servicio.'}</p><label>Código de Telegram<input ref={input} type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} pattern="[0-9]{1,12}" maxLength={12} required disabled={!canConnect||pending}/></label><button disabled={!canConnect||pending||retrying}>Confirmar código</button></form>}
 {state.phase==='code'&&<div className="telegram-code-help"><p>¿No llegó el código? Comprueba el número internacional que escribiste y el chat de servicio «Telegram» en tus otras sesiones abiertas.</p>{state.codeResend?<><button type="button" disabled={!canConnect||pending||retrying||now<state.codeResend.availableAt} onClick={()=>{if(client.current!==actionClient||!sessionAction?.()||!actionCurrent()||!canConnect||pending||retrying)return;focusIntent.current=true;setCode('');actionClient?.resend();}}>Reenviar código por {state.codeResend.delivery==='sms'?'SMS':'llamada'}</button>{now<state.codeResend.availableAt&&<p role="status">Telegram permite reenviarlo en {Math.ceil((state.codeResend.availableAt-now)/1000)} segundos.</p>}</>:<p>Telegram todavía no ha habilitado otro método de envío para este intento. Pulso no puede forzar un SMS. Puedes detener la conexión local para corregir el número.</p>}</div>}
 {!setupNeeded&&(state.phase==='code'||['disconnected','error'].includes(state.phase)&&savedSession==='absent')&&<div className="telegram-qr-option"><button type="button" disabled={!canConnect||pending||retrying} onClick={beginQr}>Entrar con Telegram o QR</button><p>Autoriza desde Telegram en tu teléfono, sin recibir un código ni escribir tu número.</p></div>}
 {state.phase==='qr'&&qrChallenge&&<TelegramQrLogin challenge={qrChallenge} disabled={!canConnect||pending||retrying||state.error==='rate-limit'&&state.retryAt===null} current={qrCurrent} onCheck={()=>{if(qrCurrent()){focusIntent.current=true;actionClient?.checkQr();}}}/>}
 {state.phase==='password'&&<form onSubmit={submit}><label>Contraseña de verificación en dos pasos<input ref={input} type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} maxLength={1024} required disabled={!canConnect||pending}/></label><button disabled={!canConnect||pending||retrying}>Verificar contraseña</button></form>}
 {pending&&<p role="status">{state.phase==='restoring'?'Recuperando tu sesión de Telegram…':state.phase==='sending-code'?'Conectando con Telegram…':state.phase==='disconnecting'?'Cerrando o eliminando la sesión de Telegram…':'Comprobando el acceso…'}</p>}
 {state.phase==='connected'&&!setupNeeded&&<><p role="status">Cuenta autenticada en esta pestaña. Los perfiles y las otras fuentes sólo se consultan cuando lo pides.</p>{client.current&&bots?.binding&&<BotProvidersController client={client.current} state={bots} canConnect={canConnect}/>}<details><summary>Otras fuentes de Telegram</summary>{client.current&&sources?.binding&&<TelegramSourcesPanel client={client.current} state={sources} canConnect={canConnect}/>}</details><button disabled={!canConnect||pending} onClick={()=>{if(actionCurrent()&&sessionAction?.()&&client.current===actionClient){resumeTried.current=actionClient;actionClient?.logout();}}}>Cerrar sesión en Telegram</button></>}
 {setupNeeded&&state.phase==='connected'&&(client.current&&bots?.binding?<><SetupBots client={client.current} state={bots} canConnect={canConnect} onFinish={finishSetup}/><button type="button" className="setup-secondary" disabled={!canConnect||!!bots.pending} onClick={()=>{if(actionCurrent()&&sessionAction?.()&&client.current===actionClient){resumeTried.current=actionClient;actionClient?.logout();}}}>Usar otra cuenta de Telegram</button></>:<p role="status">Preparando tus bots…</p>)}
 {preference.notice&&<p role="status">{preference.notice}</p>}
 {state.error&&<p role="alert">{sessionErrorText[state.error]}{retrying?` Podrás volver a intentarlo en ${Math.ceil((state.retryAt!-now)/1000)} segundos.`:''}</p>}
 {!['disconnected','error'].includes(state.phase)&&(!setupNeeded||state.phase!=='connected')&&<><button onClick={()=>{resumeTried.current=actionClient;if(!localStop?.())return;setCountry('');setPhone('');setCode('');setPassword('');}}>{setupNeeded?'Corregir número':'Detener conexión local'}</button>{!setupNeeded&&<p>Detener esta pestaña conserva la sesión guardada. Para eliminarla, usa «Cerrar sesión en Telegram» o «Eliminar sesión guardada».</p>}</>}
 </section>;
 const musicSearch:Omit<MusicSearchProps,'visible'>={
  accountId,songAliases,localAvailability,savedAlbums,saveAlbum,albumSaveBlockedReason,savedArtists,saveArtist,canSaveArtist,scopeKey,client:client.current,
  phase:state.phase,bots,searchState,canConnect,tracks:localTracks,libraryTrackIds,playlists:songPlaylists,
  trackMenuHost,playerTrackId,playerPlaying,captureSongManagement,captureDownloadSave,captureSongPlayback,captureSongDownload,captureSongCopyInspection,
 };
 return <>{setupNeeded?createPortal(<RequiredSetup step={state.phase==='connected'?'bots':'phone'}>{connection}</RequiredSetup>,document.body):connection}
 <LibraryDownloadController libraryPending={libraryPending} libraryLoaded={libraryLoaded} captureAlbum={captureAlbumDownload} saveAlbum={saveAlbum} captureAlbumManagement={captureSongManagement} captureOwner={captureDownloadOwner} storageReady={downloadStorageReady} updateWait={downloadUpdateWait} onStopUpdate={onStopDownloadUpdate} collection={downloadCollection} storageTarget={downloadStorageTarget} accountId={accountId} captureLifetime={captureLifetime} captureBatch={captureBatchDownload} onReviewStorage={onReviewDownloadStorage} onReviewed={onReviewedDownload} tracks={localTracks} client={client.current} bots={bots} connected={state.phase==='connected'&&!setupNeeded} connectionPhase={downloadConnection} capture={captureSongDownload} capturePlay={captureSongPlayback}/>
 {searchTarget&&createPortal(<MusicSearchController {...musicSearch} key={scopeKey} visible={searchVisible&&!setupNeeded}/>,searchTarget)}
 {libraryAlbum&&createPortal(<MusicSearchController {...musicSearch} key={scopeKey+':'+libraryAlbum.page.editionId}
  libraryAlbum={libraryAlbum.page} visible={libraryAlbum.visible&&!setupNeeded}/>,libraryAlbum.target)}
 </>;
}
