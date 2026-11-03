import React from 'react';
import type {Track} from '../library/library';
import {createMusicSuggestionsClient,normalizeMusicSuggestionsQuery,type MusicSuggestion} from '../library/music-suggestions';
import type {TelegramSessionClient,BotsSnapshot,BotSearchSnapshot} from '../telegram/session-client';
import type {SessionState} from '../telegram/session-protocol';
import {isBotSearchQuery,parseBotSearchTarget,type BotSearchTarget,type BotSearchRow,type BotSearchError} from '../telegram/bot-search-protocol';
import {musicSearchCatalog} from '../library/music-search-catalog';
import {MusicSearchPanel,type MusicSearchResultRow} from './MusicSearchPanel';

// One RAM-only transport per document, including cooldown across account/scope changes.
// Construction performs no IO. Each mounted view owns only its request and AbortSignal.
const suggestionsClient=createMusicSuggestionsClient();
interface Props {
 visible:boolean;scopeKey:string;client:TelegramSessionClient|null;phase:SessionState['phase'];
 bots:BotsSnapshot|null;searchState:BotSearchSnapshot|null;canConnect:boolean;tracks:readonly Track[];
}
const fold=(s:string)=>s.normalize('NFC').trim().toLocaleLowerCase('es');
function resultView(row:BotSearchRow,target:BotSearchTarget|null):MusicSearchResultRow {
 let title:string,subtitle:string|null,match:MusicSearchResultRow['match']='unknown';
 if(row.kind==='audio'){
  title=row.title??'Audio sin título informado';subtitle=[row.performer,row.durationSeconds+' s',Math.round(row.bytes/1024)+' KiB'].filter(Boolean).join(' · ');
  if(target){const titleKnown=!!row.title,artistKnown=!!row.performer&&!!target.artist;
   if(titleKnown&&fold(row.title!)!==fold(target.title)||artistKnown&&fold(row.performer!)!==fold(target.artist!))match='conflict';
   else if(titleKnown&&artistKnown)match='compatible';
  }
 }else if(row.kind==='option'){title=row.label;subtitle='El bot no ha informado metadatos suficientes para confirmar la canción.';}
 else{title=row.text;subtitle=null;}
 return {id:row.rowRef,kind:row.kind,title,subtitle,correlation:row.correlation,match};
}
const searchErrors:Record<BotSearchError,string>={
 cancelled:'Consulta detenida. Un mensaje ya enviado puede permanecer en tu chat.',timeout:'El bot no respondió dentro del plazo. No se repetirá la consulta automáticamente.',busy:'Hay otra operación de Telegram pendiente.',expired:'Estos resultados han caducado. Haz una consulta nueva si quieres continuar.',
 'session-expired':'La sesión de Telegram ha caducado. Vuelve a conectarla.',limit:'La consulta o la respuesta supera los límites admitidos.',unsupported:'Este bot o su respuesta todavía no son compatibles con este adaptador.','identity-changed':'El perfil del bot ha cambiado. Comprueba su identidad y vuelve a añadirlo.',
 'rate-limit':'Telegram ha limitado las consultas. Respeta la espera indicada antes de volver a buscar.',network:'No se pudo completar la consulta al bot.',uncertain:'No se pudo confirmar si el bot recibió o completó la consulta. Revisa su chat antes de repetirla.','needs-start':'Abre el chat del bot en Telegram e inícialo allí; después vuelve a buscar aquí.',
};
/** Root owns the session and the view. No playback, callback RPC, download or persistence. */
export function MusicSearchController(props:Props){
 const [query,setQuery]=React.useState('');
 const [chosenId,setChosenId]=React.useState<string|null>(null),[resultsVisible,setResultsVisible]=React.useState(false);
 const [remote,setRemote]=React.useState<readonly MusicSuggestion[]>([]),[remoteQuery,setRemoteQuery]=React.useState<string|null>(null),[suggesting,setSuggesting]=React.useState(false),[suggestionError,setSuggestionError]=React.useState<string|null>(null),[suggestionNotice,setSuggestionNotice]=React.useState<string|null>(null);
 const [retry,setRetry]=React.useState(0),[notice,setNotice]=React.useState<string|null>(null),[displayedQuery,setDisplayedQuery]=React.useState<string|null>(null),[selectedResult,setSelectedResult]=React.useState<string|null>(null);
 const [,pulse]=React.useReducer(n=>n+1,0);
 const latest=React.useRef(props),mounted=React.useRef(false),viewEpoch=React.useRef(0),committed=React.useRef<object|null>(null),metadataAttempt=React.useRef<{abort:AbortController}|null>(null),metadataEpoch=React.useRef(0);
 const chosenDraft=React.useRef<string|null>(null);
 const renderToken={};const renderEpoch=viewEpoch.current;
 React.useLayoutEffect(()=>{latest.current=props;mounted.current=true;committed.current=renderToken;return()=>{committed.current=null;};});
 React.useEffect(()=>()=>{mounted.current=false;metadataAttempt.current?.abort.abort();},[]);
 const current=()=>mounted.current&&committed.current===renderToken&&viewEpoch.current===renderEpoch&&latest.current.visible&&latest.current.scopeKey===props.scopeKey&&latest.current.client===props.client;
 const client=props.client,state=client?.searchSnapshot()??props.searchState,action=client?.captureSearchActionCurrent(),cancel=client?.captureSearchCancel(),projection=client?.captureSearchCurrent();
 const choices=React.useMemo(()=>musicSearchCatalog(query,props.tracks,remoteQuery===normalizeMusicSuggestionsQuery(query)?remote:[]),[query,props.tracks,remote,remoteQuery]);
 const primary=props.bots?.providers[0]??null;
 const selectedProvider=primary?{id:primary.providerRef,username:primary.username,label:primary.label,supported:primary.username.toLowerCase()==='ivkmbot'}:null;
 const provider=primary?.providerRef??null,ownPending=!!cancel||!!state?.cancelling;
 const limited=!!state?.retryBlocked||state?.retryAt!==null&&state?.retryAt!==undefined&&Date.now()<state.retryAt;
 const ready=props.canConnect&&props.phase==='connected'&&!!state?.available&&!state.pending&&!limited&&!!selectedProvider?.supported;
 const rateNotice=state?.retryBlocked?'Telegram ha limitado las consultas sin indicar un plazo utilizable. No se reintentará automáticamente.':limited&&state?.retryAt?'Telegram permite reintentar después de '+new Date(state.retryAt).toLocaleTimeString()+'.':null;
 const results=displayedQuery!==null&&state?.queryId===displayedQuery?state.rows.map(row=>resultView(row,state.expectedTarget)):[];
 const revokeMetadata=()=>{++metadataEpoch.current;const attempt=metadataAttempt.current;metadataAttempt.current=null;attempt?.abort.abort();setSuggesting(false);};
 const bump=()=>{++viewEpoch.current;pulse();};
 const edit=(queryChanged=false)=>{bump();chosenDraft.current=null;if(queryChanged){revokeMetadata();setRemote([]);setRemoteQuery(null);setResultsVisible(false);}setChosenId(null);setDisplayedQuery(null);setSelectedResult(null);setNotice(null);cancel?.();if(action?.())client?.clearSearch(action);};
 React.useEffect(()=>{
  bump();setDisplayedQuery(null);setSelectedResult(null);setChosenId(null);
 },[props.scopeKey,props.bots?.revision,props.bots?.scopeKey]);
 React.useEffect(()=>{if(!props.visible){metadataAttempt.current?.abort.abort();client?.captureSearchCancel()?.();setDisplayedQuery(null);setSelectedResult(null);}},[props.visible,client]);
 React.useEffect(()=>{const until=state?.retryAt;if(!until||until<=Date.now())return;const timer=setTimeout(()=>{if(mounted.current)pulse();},until-Date.now()+1);return()=>clearTimeout(timer);},[state?.retryAt]);
 React.useEffect(()=>{
  const expires=state?.expiresAt;if(!expires||!client)return;
  const timer=setTimeout(()=>{if(latest.current.client===client){client.revalidate();pulse();}},Math.max(0,expires-Date.now()+1));return()=>clearTimeout(timer);
 },[state?.expiresAt,client]);
 React.useEffect(()=>{
  const abort=new AbortController(),attempt={abort};metadataAttempt.current?.abort.abort();metadataAttempt.current=attempt;
  setRemote([]);setRemoteQuery(null);setSuggestionError(null);setSuggesting(false);
  const valid=normalizeMusicSuggestionsQuery(query);
  if(chosenDraft.current!==null&&query===chosenDraft.current){setSuggestionNotice('Canción elegida para consultar al bot principal.');return()=>abort.abort();}
  if(!props.visible||!valid){setSuggestionNotice(query?'Escribe entre 3 y 160 caracteres para obtener sugerencias.':null);return()=>abort.abort();}
  const scope=props.scopeKey,epoch=metadataEpoch.current,waitUntil=Date.now()+15000;
  const live=()=>epoch===metadataEpoch.current&&mounted.current&&!abort.signal.aborted&&metadataAttempt.current===attempt&&latest.current.visible&&latest.current.scopeKey===scope;
  let timer:ReturnType<typeof setTimeout>|undefined;
  setSuggesting(true);setSuggestionNotice(null);
  const run=()=>{
   if(!live())return;
   const rate=suggestionsClient.getRateState(),wait=rate.retryAt===null?0:Math.max(0,rate.retryAt-Date.now());
   // Wait for original cancellation/body cleanup, never overlap or release its slot by a clock.
   // This is dispatch of the latest draft, not retry of a failed remote request.
   if(rate.state==='busy'){
    if(Date.now()<waitUntil){timer=setTimeout(run,100);return;}
    setSuggesting(false);setSuggestionError('La consulta anterior sigue cerrándose. Vuelve a intentar las sugerencias.');return;
   }
   if(rate.state==='blocked'||wait>2000){setSuggesting(false);setSuggestionError('LRCLIB ha limitado las consultas. Espera antes de reintentar.');return;}
   if(wait>0){timer=setTimeout(run,wait+1);return;}
   void suggestionsClient.search(valid,{signal:abort.signal,current:live}).then(result=>{
    if(!live())return;setSuggesting(false);
    if(result.state==='ready'){setRemoteQuery(valid);setRemote(result.tracks);setSuggestionNotice(result.tracks.length?null:'No hay sugerencias para este nombre. Prueba con otro nombre de canción o álbum.');}
    else if(result.state==='rate-limited')setSuggestionError(result.retryAt===null?'LRCLIB ha limitado las consultas y no indicó una espera utilizable.':'LRCLIB ha limitado las consultas. Podrás reintentar después de '+new Date(result.retryAt).toLocaleTimeString()+'.');
    else if(result.state==='busy')setSuggestionError('La consulta anterior sigue cerrándose. Vuelve a intentar las sugerencias.');
    else if(result.state==='unavailable')setSuggestionError('No se pudieron obtener sugerencias. Puedes reintentarlo o ver las coincidencias de tu biblioteca.');
   }).catch(()=>{if(live()){setSuggesting(false);setSuggestionError('No se pudieron obtener sugerencias.');}});
  };
  timer=setTimeout(run,450);
  return()=>{if(timer!==undefined)clearTimeout(timer);abort.abort();};
 },[query,props.visible,props.scopeKey,retry]);
 function search(chosen:BotSearchTarget,text:string){
  if(!current()||!ready||!provider||!action?.())return;
  if(!isBotSearchQuery(text.trim())){setNotice('Escribe una consulta de hasta 160 caracteres, sin comandos ni saltos de línea.');return;}
  const before=client!.searchSnapshot().queryId;
  client!.searchBot({providerRef:provider,query:text.trim(),...(chosen?{target:chosen}:{}),consent:true},action);
  const after=client!.searchSnapshot();
  if(after.queryId&&after.queryId!==before){setDisplayedQuery(after.queryId);setSelectedResult(null);setNotice(null);}
 }
 function showResults(){
  if(!current()||!query.trim())return;
  setResultsVisible(true);
 }
 function choose(id:string){
  if(!current()||ownPending)return;const choice=choices.find(c=>c.id===id);if(!choice)return;
  if(choice.kind==='album'){edit();setQuery(choice.title);setResultsVisible(true);return;}
  const chosen=parseBotSearchTarget({title:choice.title.normalize('NFC').trim(),artist:choice.artist?.normalize('NFC').trim()||null,album:choice.album?.normalize('NFC').trim()||null,durationSeconds:choice.duration});
  if(!chosen){setNotice('Los metadatos de esta sugerencia no se pueden enviar completos. Prueba otra canción.');return;}
  // Only a selected metadata song can reach Telegram. Submit/Enter never calls this.
  revokeMetadata();
  if(ready)search(chosen,chosen.title);
  else setNotice(!primary?'Añade un bot en «Bots de música» para consultar esta canción.':!selectedProvider?.supported?'El bot principal todavía no es compatible. Cambia su orden en «Bots de música».':'Conecta Telegram y vuelve a elegir la canción para consultarla.');
  bump();chosenDraft.current=query;setChosenId(id);setResultsVisible(true);
 }
 return <MusicSearchPanel query={query} onQueryChange={value=>{if(!current())return;edit(true);setQuery(value.slice(0,640));}}
  suggestions={choices.map(c=>({id:c.id,kind:c.kind,title:c.title,subtitle:(c.kind==='track'?[c.artist,c.album]:[c.artist]).filter(Boolean).join(' · ')||null,source:c.source}))} resultsVisible={resultsVisible} selectedSuggestionId={chosenId} suggestionsPending={suggesting} suggestionsError={suggestionError} suggestionsNotice={suggestionNotice}
  onRetrySuggestions={()=>{if(current()&&!ownPending){edit();setRetry(n=>n+1);}}}
  primaryProvider={selectedProvider}
  sessionReady={props.phase==='connected'} canSearch={ready} searchPending={ownPending}
  onSearch={showResults} onChooseSuggestion={choose}
  onCancel={()=>{cancel?.();if(mounted.current&&latest.current.client===client)setNotice('Consulta detenida. Revisa el chat del bot antes de repetir si el envío quedó incierto.');}}
  results={results} selectedResultId={selectedResult} onSelectResult={id=>{if(current()&&projection?.()&&results.some(row=>row.id===id)){setSelectedResult(id);setNotice('Opción seleccionada sólo en Pulso. La descarga pertenece al siguiente paso.');}}}
  status={rateNotice??notice??(displayedQuery&&state?.queryId===displayedQuery&&!state.error&&results.length?'Respuesta del bot recibida. Revisa las opciones; la identidad musical sigue sin confirmar.':null)} error={state?.error?searchErrors[state.error]:null} uncertain={state?.delivery==='uncertain'} current={current}/>;
}
