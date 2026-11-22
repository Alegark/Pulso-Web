import {elapsedMs,emptyNetworkTiming,measure,type NetworkTiming} from '../diagnostics/download-timing';
import {classifyTelegramFailure,cooldownDeadline} from './rpc-failure';
import {assembleBotDownloadBytes,botDownloadTransferMs,BotDownloadBytesFailure} from './bot-download-bytes';
import {recordingTitleCandidate} from '../library/recording-title';
import Long from 'long';
import type {tl} from '@mtcute/core';
import type {BaseTelegramClient} from '@mtcute/core/client.js';
import {botProvidersFailure,type BotProvidersClock,type BotSearchProviderCapture,type BotProvidersDriver} from './bot-providers-driver';
import {isUuid,parseAccountBinding,type AccountBinding} from './sources-protocol';
import {BOT_SEARCH_BOUNDS as B,copyBotSearchEnvelope,botPollDelay,botSearchText,formatBotSearchQuery,parseBotSearchCommand,matchingSongRows,type BotSearchEnvelope,type BotSearchReply,type BotSearchError,type BotSearchDelivery} from './bot-search-protocol';
import {assertBotSearchRawBudget,botSearchAck,botSearchBaseline,BotSearchProjectionError,projectBotSearchPage,projectBotCallbackPage,botSearchDocumentIdentity,botSearchKnownMessage,botSearchMessageFingerprint,botSearchAudioFingerprint,botSearchDocument,type BotSearchPrivateRef} from './bot-search-page';
/** Inject only inside the worker. No generic RPC, root peers or arbitrary message identifiers. */
export interface BotSearchDependency {
 captureProvider(ref:string,revision:number):BotSearchProviderCapture|null;
 resolveIdentity(username:string,signal:AbortSignal,timeoutMs:number):Promise<unknown>;
 readHistory(peer:tl.TypeInputPeer,minId:number,limit:1|20,signal:AbortSignal,timeoutMs:number):Promise<unknown>;
 sendQuery(peer:tl.TypeInputPeer,query:string,randomId:Long,signal:AbortSignal,timeoutMs:number):Promise<unknown>;
 readKnown?(peer:tl.TypeInputPeer,messageId:number,signal:AbortSignal):Promise<unknown>;
 callback?(peer:tl.TypeInputPeer,messageId:number,data:Uint8Array,signal:AbortSignal):Promise<unknown>;
 readDocumentPart?(document:NonNullable<ReturnType<typeof botSearchDocument>>,offset:number,limit:number,signal:AbortSignal):Promise<Uint8Array>;
 isOtherDc?(dcId:number):boolean|null;
 invalidateSession():void;
 getAccountCooldown?():{readonly retryAt:number|null;readonly retryBlocked:boolean}|null;
}
export interface BotSearchContext {readonly signal:AbortSignal;readonly current:()=>boolean;readonly publish?:(reply:BotSearchReply)=>void;readonly timing?:(timing:NetworkTiming)=>void}
export interface BotSearchDriver {
 handle(raw:unknown,context:BotSearchContext):Promise<BotSearchReply|null>;
 whenSettled():Promise<boolean>;
 quiesce():Promise<boolean>;
 close():void;
}
const clock:BotProvidersClock={now:()=>Date.now(),setTimeout:(f,n)=>setTimeout(f,n),clearTimeout:t=>clearTimeout(t)};
interface Failure {error:BotSearchError;retryAt:number|null;retryBlocked:boolean}
const fail=(error:BotSearchError):Failure=>({error,retryAt:null,retryBlocked:false});
const randomLong=()=>{const a=crypto.getRandomValues(new Int32Array(2));return new Long(a[0],a[1],false);};
/** One flight including original RPC settlement; no queue/retry/fallback. Neither a cancel ACK
 * nor an early result retires its physical lane. false settlement quarantines the exact session.
 * Final DTOs also require the receiving root's original non-reviving authority before UI use. */
export function createBotSearchDriver(bindingInput:AccountBinding,sessionId:string,dependency:BotSearchDependency,time:BotProvidersClock=clock):BotSearchDriver {
 const binding=parseAccountBinding(bindingInput);if(!binding||!isUuid(sessionId))throw Error('protocol');
 let closed=false,invalidated=false,settlement=Promise.resolve(true),cooldown:Failure|null=null;
 let identityRevision=-1;const identities=new Map<string,unknown>();
 const requests=new Set<string>(),queries=new Set<string>();
 // Future selection is intentionally unavailable. These bounded opaque handles have no public accessor.
 let retainedSearch:{providerRef:string;queryId:string;revision:number;baseline:number;outgoing:number;target:import('./bot-search-protocol').BotSearchTarget|null}|null=null;
 let retained:ReadonlyMap<string,BotSearchPrivateRef>=new Map(),retainedUntil=0;
 type Flight={e:BotSearchEnvelope;delivery:BotSearchDelivery;cause:Failure|null;stop(f:Failure):void};let flight:Flight|null=null;
 const close=()=>{if(closed)return;closed=true;retainedSearch=null;retained=new Map();retainedUntil=0;requests.clear();queries.clear();identities.clear();flight?.stop(fail('cancelled'));};
 const invalidate=()=>{close();if(!invalidated){invalidated=true;dependency.invalidateSession();}};
 const live=(ctx:BotSearchContext,capture?:BotSearchProviderCapture)=>{try{return !closed&&!ctx.signal.aborted&&ctx.current()&&(!capture||capture.current());}catch{return false;}};
 const response=(e:BotSearchEnvelope,f:Failure,delivery:BotSearchDelivery):BotSearchReply=>Object.freeze({...copyBotSearchEnvelope(e),type:'bot-search.error',...f,delivery});
 return Object.freeze({close,quiesce(){close();return settlement;},whenSettled(){return settlement;},
  async handle(raw:unknown,context:BotSearchContext):Promise<BotSearchReply|null>{
   const ctx=Object.freeze({signal:context.signal,current:context.current,publish:context.publish,timing:context.timing});
   const c=parseBotSearchCommand(raw);if(!c)return null;const e=copyBotSearchEnvelope(c);
   if(closed||e.sessionId!==sessionId||e.accountRef!==binding.accountRef||e.accountEpoch!==binding.accountEpoch)return response(e,fail('session-expired'),'not-dispatched');
   if(!live(ctx))return response(e,fail('cancelled'),'not-dispatched');
   if(requests.has(c.requestId))return response(e,fail('expired'),'not-dispatched');
   if(requests.size>=B.requestIds){invalidate();return response(e,fail('limit-requests'),'not-dispatched');}requests.add(c.requestId);
   if(c.type==='bot-search.cancel'){
    if(!flight||flight.e.requestId!==c.targetRequestId||flight.e.queryId!==c.queryId||flight.e.providerRevision!==c.providerRevision)return response(e,fail('expired'),'not-dispatched');
    flight.stop(fail('cancelled'));return Object.freeze({...e,type:'bot-search.cancelled',targetRequestId:c.targetRequestId});
   }
   if(flight)return response(e,fail('busy'),'not-dispatched');
   const selection=c.type==='bot-search.download'?retained.get(c.rowRef):null, previous=retainedSearch;
   if(c.type==='bot-search.download'&&(!selection||!previous||time.now()>=retainedUntil||previous.queryId!==c.queryId||previous.revision!==c.providerRevision||previous.providerRef!==c.providerRef||JSON.stringify(previous.target)!==JSON.stringify(c.target)))return response(e,fail('expired'),'not-dispatched');
   if(c.type==='bot-search.search'){if(queries.has(c.queryId))return response(e,fail('expired'),'not-dispatched');queries.add(c.queryId);}

   // Expiry is absolute and cannot be revived by reuse/reorder; no retained raw chat transcript.
   if(time.now()>=retainedUntil||retained.size){retained=new Map();retainedUntil=0;}
   if(identityRevision!==c.providerRevision){identities.clear();identityRevision=c.providerRevision;}
   const capture=dependency.captureProvider(c.providerRef,c.providerRevision);
   if(!capture){identities.delete(c.providerRef);return response(e,fail('expired'),'not-dispatched');}
   // Supported providers use private-chat music menus with layer232 callback
   // buttons. Selection still requires this attempt's exact peer, menu and target.
   if(capture.username!=='ivkmbot'&&capture.username!=='lydbot'&&capture.username!=='ansmusicbot'&&capture.username!=='kdmusic_bot'&&capture.username!=='deezermusicbot')return response(e,fail('unsupported'),'not-dispatched');
   const query=c.type==='bot-search.search'?formatBotSearchQuery(c):null;if(c.type==='bot-search.search'&&!query)return response(e,fail('limit-query'),'not-dispatched');
   const shared=dependency.getAccountCooldown?.();
   if(shared)return response(e,{error:'rate-limit',...shared},'not-dispatched');
   if(cooldown&&cooldown.retryAt!==null&&time.now()<cooldown.retryAt)return response(e,cooldown,'not-dispatched');
   const duration=c.type==='bot-search.download'?B.downloadResolveMs:B.timeoutMs;
   const abort=new AbortController();let deadline=time.now()+duration;
   let wake!:(v:BotSearchReply)=>void;const stopped=new Promise<BotSearchReply>(r=>{wake=r;});
   let settle!:(v:boolean)=>void;settlement=new Promise<boolean>(r=>{settle=r;});
   const metrics=emptyNetworkTiming();
   let transferStart:number|undefined,pollStart:number|undefined;
   let timer:ReturnType<typeof setTimeout>|undefined,grace:ReturnType<typeof setTimeout>|undefined,delay:ReturnType<typeof setTimeout>|undefined,delayWake:(()=>void)|undefined,finished=false,stopping=false;
   const finish=(ok:boolean)=>{if(finished)return;finished=true;ctx.signal.removeEventListener('abort',onAbort);if(timer!==undefined)time.clearTimeout(timer);if(grace!==undefined)time.clearTimeout(grace);if(delay!==undefined)time.clearTimeout(delay);if(flight===f)flight=null;
    if(transferStart!==undefined)metrics.transferMs=elapsedMs(transferStart);
    if(pollStart!==undefined)metrics[c.type==='bot-search.search'?'searchPollMs':'callbackPollMs']=elapsedMs(pollStart);
    try{ctx.timing?.(metrics);}catch{/* Observation cannot block settlement. */}
    settle(ok);};
   const f:Flight={e,delivery:'not-dispatched',cause:null,stop(cause){
    if(stopping)return;stopping=true;cause=f.cause??cause;if(cause.error==='timeout'&&f.delivery==='uncertain')cause=fail('uncertain');
    f.cause=cause;retained=new Map();retainedUntil=0;wake(response(e,cause,f.delivery));abort.abort();delayWake?.();
    grace=time.setTimeout(()=>{finish(false);invalidate();},B.settlementMs);
   }};
   const onAbort=()=>f.stop(fail('cancelled'));
   flight=f;ctx.signal.addEventListener('abort',onAbort,{once:true});timer=time.setTimeout(()=>f.stop(fail('timeout')),duration);
   // rawBytes bounds EACH metadata reply, not the sum of sequential replies.
   // Search: identity + baseline + ACK + bounded polls. Callback download:
   // identity + three exact-message reads + baseline + callback + bounded polls.
   // Raw replies are projected then discarded; this is not a peak heap bound.
   const metadataReplyLimit=c.type==='bot-search.download'?B.downloadReads+6:B.reads+3;
   let decoded=0,metadataReplies=0;
   const check=()=>{if(f.cause)throw f.cause;if(!live(ctx,capture)){f.stop(fail('cancelled'));throw f.cause;}if(time.now()>=deadline){f.stop(fail('timeout'));throw f.cause;}};
   const budget=(v:unknown)=>{const bytes=assertBotSearchRawBudget(v);if(++metadataReplies>metadataReplyLimit||decoded+bytes>B.rawBytes*metadataReplyLimit)throw new BotSearchProjectionError('limit','limit-attempt');decoded+=bytes;};
   const observe=(error:unknown):Failure=>{
    if(error instanceof BotSearchProjectionError)return fail(error.limit??error.code);
    if(error instanceof BotDownloadBytesFailure)return fail(error.code==='size'?'file-too-large':error.code==='cancelled'?'cancelled':'file-invalid');
    // SDK late failures are observed independently of a winning cancel/deadline cause.
    const kind=classifyTelegramFailure(error).error;
    if(kind==='invalid-peer'||kind==='access')identities.delete(c.providerRef);
    const cause=botProvidersFailure(error,time.now());
    if(cause.error==='session-expired'){if(!f.cause)f.cause=cause;invalidate();}
    if(cause.error==='rate-limit'){
     cooldown={error:'rate-limit',retryAt:Math.max(cooldown?.retryAt??0,cooldownDeadline(cause,time.now())),retryBlocked:false};
     return cooldown;
    }
    return cause.error==='network'&&f.delivery==='uncertain'?fail('uncertain'):cause;
   };
   const rpc=async(fn:(ms:number)=>Promise<unknown>,count=true)=>{check();try{const v=await fn(Math.max(1,deadline-time.now()));check();if(count)budget(v);check();return v;}catch(error){
    if(error===f.cause)throw error;const cause=observe(error);if(!f.cause)f.cause=cause;throw f.cause;
   }};
   const poll=async(read:number,history:(ms:number)=>Promise<unknown>)=>{
    pollStart??=performance.now();await sleepPoll(read);
    metrics[c.type==='bot-search.search'?'searchReads':'callbackReads']++;return rpc(history);
   };
   const sleepPoll=async(read:number)=>{
    check();
    await new Promise<void>(resolve=>{delayWake=resolve;delay=time.setTimeout(()=>{delay=undefined;delayWake=undefined;resolve();},botPollDelay(read));});
    check();
   };
   const work=Promise.resolve().then(async():Promise<BotSearchReply>=>{
    try{
     check();
     const approved=await measure(ms=>{metrics.resolveMs=ms;},async()=>{
      try{
       const identity=identities.has(c.providerRef)?identities.get(c.providerRef):await rpc(ms=>dependency.resolveIdentity(capture.username,abort.signal,ms));
       const verified=capture.verifyIdentity(identity);if(!verified)throw fail(capture.current()?'unsupported':'identity-changed');
       check();identities.set(c.providerRef,identity);return verified;
      }catch(error){identities.delete(c.providerRef);throw error;}
     });
     if(c.type==='bot-search.download'){
      if(!dependency.readKnown||!dependency.readDocumentPart||!selection?.row||!previous)throw fail('unsupported');
      const known=async(ref:BotSearchPrivateRef)=>{
       const raw=await rpc(()=>dependency.readKnown!(approved.peer,ref.messageId,abort.signal));const message=botSearchKnownMessage(raw,approved.botId,ref.messageId);
       if(!message)throw fail('conflict');
       if(ref.row?.kind==='audio'&&ref.audioFingerprint){
        if(botSearchAudioFingerprint(message)!==ref.audioFingerprint)throw fail('conflict');
        const fresh=projectBotSearchPage({_: 'messages.messages',messages:[message],users:[],chats:[]},approved.botId,Math.min(previous.baseline,ref.messageId-1),previous.outgoing,[selection.messageId],c.target);
        if(matchingSongRows(fresh.rows.filter(row=>row.kind==='audio'),c.target).length!==1)throw fail('conflict');
       }else if(botSearchMessageFingerprint(message)!==ref.fingerprint)throw fail('conflict');
       return message;
      };
      let selected=selection,message=await known(selected);
      if(selected.row?.kind==='option'){
       const selectedDocumentId=botSearchDocumentIdentity(message);
       const fold=(v:string)=>v.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
       if(!dependency.callback||!selected.callbackData||!(matchingSongRows([selected.row],c.target).length===1||!['kdmusic_bot','deezermusicbot'].includes(capture.username)&&fold(c.target.title).length>=3&&fold(selected.row.label).includes(fold(c.target.title))))throw fail('unsupported');
       const baseline=botSearchBaseline(await rpc(ms=>dependency.readHistory(approved.peer,0,1,abort.signal,ms)),approved.botId);
       f.delivery='uncertain';if(ctx.publish&&live(ctx,capture))try{ctx.publish({...e,type:'bot-search.sending',delivery:'uncertain'});}catch{/* Observers cannot own or repeat the callback. */}
       const answer=await measure(ms=>{metrics.callbackMs=ms;},()=>rpc(()=>dependency.callback!(approved.peer,selected.messageId,selected.callbackData!.slice(),abort.signal)));
       if(!answer||typeof answer!=='object'||Object.getOwnPropertyDescriptor(answer,'_')?.value!=='messages.botCallbackAnswer')throw fail('unsupported');
       f.delivery='acknowledged';
       const notice=botSearchText(Object.getOwnPropertyDescriptor(answer,'message')?.value,500);
       if(notice&&ctx.publish&&live(ctx,capture))try{ctx.publish(Object.freeze({...e,type:'bot-search.provider-notice',text:notice}));}catch{/* Observers cannot own transport. */}
       // `alert` and `nativeUi` are presentation hints, not media or authority.
       // We render only inert notice text and never launch a native/game surface.
       // Continuation still requires an actual matching document in this chat.
       // https://core.telegram.org/constructor/messages.botCallbackAnswer
       for(const key of ['alert','nativeUi']){
        const field=Object.getOwnPropertyDescriptor(answer,key);
        if(field&&(!('value'in field)||field.value!==undefined&&typeof field.value!=='boolean'))throw fail('unsupported');
       }
       if(['url','hasUrl'].some(key=>{const field=Object.getOwnPropertyDescriptor(answer,key);return !!field&&(!('value' in field)||!!field.value);}))throw fail('unsupported');
       let unmatched:ReturnType<typeof projectBotCallbackPage>|null=null;
       for(let read=0;;read++){
        check();if(read>=B.downloadReads){
         if(!unmatched)throw fail('timeout');
         retained=unmatched.refs;retainedUntil=time.now()+B.resultTtlMs;retainedSearch={...previous,baseline};
         return {...e,type:'bot-search.result',delivery:'acknowledged',rows:unmatched.rows.filter(row=>row.kind==='audio'),expiresAt:retainedUntil,expectedTarget:c.target};
        }
        const raw=await poll(read,ms=>dependency.readHistory(approved.peer,Math.min(baseline,selection.messageId-1),20,abort.signal,ms));
        const page=projectBotCallbackPage(raw,approved.botId,baseline,previous.outgoing,selection.messageId,selectedDocumentId,c.target);if(page.concurrent)throw fail('uncertain');
        const audio=page.rows.filter(row=>row.kind==='audio'),matches=matchingSongRows(audio,c.target);
        if(audio.length){
         // Correlation may be recent. Fresh exact-peer window plus ONE compatible
         // recording permits continuation; equal matches keep the ranked first one.
         // The first audio need not be the selected recording. Keep observing
         // this same callback's bounded window without fetching unrelated bytes
         // or sending another query/callback.
         if(!matches.length)unmatched=page;
         else{metrics.callbackPollMs=elapsedMs(pollStart!);pollStart=undefined;selected=page.refs.get(matches[0].rowRef)!;message=await known(selected);break;}
        }
       }
      }
      const row=selected.row;if(row?.kind!=='audio')throw fail('unsupported');
      const fold=(v:string)=>v.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
      if(!row.title||!recordingTitleCandidate(row.title,c.target.title,c.target.album,c.target.durationSeconds)||c.target.artist&&(!row.performer||fold(row.performer)!==fold(c.target.artist)))throw fail('conflict');
      const document=botSearchDocument(message);if(!document)throw fail('unsupported');
      check();
      const transferMs=botDownloadTransferMs(row.bytes);
      deadline=time.now()+transferMs;
      if(timer!==undefined)time.clearTimeout(timer);
      timer=time.setTimeout(()=>f.stop(fail('timeout')),transferMs);
      const progress=(bytes:number)=>{if(ctx.publish&&live(ctx,capture)&&!f.cause)try{ctx.publish({...e,type:'bot-search.download-progress',bytes,total:row.bytes});}catch{/* Observation does not own transport. */}};
      try{metrics.otherDc=dependency.isOtherDc?.(document.dcId)??null;}catch{/* Optional observation. */}
      transferStart=performance.now();
      const result=await assembleBotDownloadBytes({bytes:row.bytes,mime:row.mimeType},async(offset,limit)=>{
       if(offset===0)progress(0);
       const part=await rpc(()=>dependency.readDocumentPart!(document,offset,limit,abort.signal),false);
       if(part instanceof Uint8Array){metrics.parts++;metrics.bytes+=part.length;}
       return part as Uint8Array;
      },()=>live(ctx,capture)&&!f.cause&&time.now()<deadline,progress,error=>f.stop(f.cause??observe(error)));
      metrics.transferMs=elapsedMs(transferStart);transferStart=undefined;
      await known(selected);check();retained=new Map();retainedSearch=null;
      return {...e,type:'bot-search.downloaded',audio:{...result,target:c.target,...(fold(row.title)!==fold(c.target.title)?{recordingTitle:row.title}:{})}};
     }
     const baseline=botSearchBaseline(await rpc(ms=>dependency.readHistory(approved.peer,0,1,abort.signal,ms)),approved.botId);check();
     const randomId=randomLong();check();
     f.delivery='uncertain';
     // Progress is advisory only, guarded immediately; it contains neither query nor peer.
     if(ctx.publish&&live(ctx,capture)){try{ctx.publish(Object.freeze({...e,type:'bot-search.sending',delivery:'uncertain'}));}catch{/* UI observers cannot change authority. */}}
     const ack=botSearchAck(await measure(ms=>{metrics.sendMs=ms;},()=>rpc(ms=>dependency.sendQuery(approved.peer,query!,randomId,abort.signal,ms))),approved.botId,randomId);
     if(!ack||ack<=baseline)throw fail('uncertain');f.delivery='acknowledged';check();
     let lastCandidates:ReturnType<typeof projectBotSearchPage>|null=null,sawBotReply=false;
     let rejectedFile:ReturnType<typeof projectBotSearchPage>['rejectedFile'];
     const searchResult=(page:ReturnType<typeof projectBotSearchPage>):BotSearchReply=>{
      retained=page.refs;retainedUntil=time.now()+B.resultTtlMs;retainedSearch={providerRef:c.providerRef,queryId:c.queryId,revision:c.providerRevision,baseline,outgoing:ack,target:c.target??null};check();
      return Object.freeze({...e,type:'bot-search.result',delivery:'acknowledged',rows:page.rows,expiresAt:retainedUntil,expectedTarget:c.target??null});
     };
     for(let reads=0;reads<B.reads;reads++){
      if(deadline-time.now()<=botPollDelay(reads))break;
      const page=projectBotSearchPage(await poll(reads,ms=>dependency.readHistory(approved.peer,baseline,20,abort.signal,ms)),approved.botId,baseline,ack,[],c.target??null);check();
      if(page.concurrent)throw fail('uncertain');
      if(page.rows.some(row=>row.kind==='option'||row.kind==='audio')){
       lastCandidates=page;
       if(page.rows.some(row=>row.kind==='option')||!c.target?.artist||matchingSongRows(page.rows,c.target).length)return searchResult(page);
      }
      // Only a closed, explicit reply can establish an empty result; generic
      // text, history silence and unsupported menus remain inconclusive.
      rejectedFile??=page.rejectedFile;
      if(!lastCandidates&&!rejectedFile&&page.rows.some(row=>row.kind==='message'&&row.correlation==='reply'&&
       /^(?:no (?:se )?encontraron resultados|no results found)[.!]?$/iu.test(row.text)))return searchResult(page);
      sawBotReply ||= page.unrecognized||page.rows.length>0;
     }
     if(rejectedFile)throw fail(rejectedFile);
     if(lastCandidates)return searchResult(lastCandidates);
     throw fail(sawBotReply?'unsupported':'timeout');
    }catch(error){
     // Internally constructed causes are data-only; SDK errors were normalized in rpc.
     const known=error&&typeof error==='object'&&Object.getPrototypeOf(error)===Object.prototype&&Object.getOwnPropertyDescriptor(error,'error')?.value;
     const cause=f.cause??(typeof known==='string'?error as Failure:observe(error));
     if(cause.error==='conflict'||cause.error==='identity-changed')identities.delete(c.providerRef);
     if(!f.cause)f.cause=cause;return response(e,cause,f.delivery);
    }
   }).finally(()=>finish(true));
   return Promise.race([work,stopped]);
  },
 });
}

/** Production SDK observation boundary. A UI abort must NOT invoke mtcute's
 * _cancelRpc: it removes pendingMessages and discards late FLOOD/revocation.
 * timeout:0 disables the SDK's local cancellation timer (installed sendRpc checks
 * truthiness). The driver owns its 15s deadline + 2s settlement grace, then closes
 * the exact session with settlement=false if the original RPC remains unresolved.
 * This is never an unlimited admission: no next driver RPC runs after local revocation.
 * Injectable call is worker-private, never a root/session API. */
export function createBotSearchSdkDriver(binding:AccountBinding,sessionId:string,sdk:{
 readonly call:BaseTelegramClient['call'];readonly providers:BotProvidersDriver;
 readonly current:(signal:AbortSignal)=>void;readonly invalidateSession:()=>void;readonly isOtherDc?:(dcId:number)=>boolean|null;
 readonly getAccountCooldown:NonNullable<BotSearchDependency['getAccountCooldown']>;
},time?:BotProvidersClock):BotSearchDriver {
 return createBotSearchDriver(binding,sessionId,{
  captureProvider:(ref,revision)=>sdk.providers.captureSearchProvider(ref,revision),
  async resolveIdentity(username,abort,_timeout){sdk.current(abort);const r=await sdk.call({_: 'contacts.resolveUsername',username},{timeout:0,floodSleepThreshold:0,maxRetryCount:0});sdk.current(abort);return r;},
  async readHistory(peer,minId,limit,abort,_timeout){sdk.current(abort);const r=await sdk.call({_: 'messages.getHistory',peer,offsetId:0,offsetDate:0,addOffset:0,limit,maxId:0,minId,hash:Long.ZERO},{timeout:0,floodSleepThreshold:0,maxRetryCount:0});sdk.current(abort);return r;},
  async sendQuery(peer,query,randomId,abort,_timeout){sdk.current(abort);const r=await sdk.call({_: 'messages.sendMessage',peer,message:query,randomId,noWebpage:true},{timeout:0,floodSleepThreshold:0,maxRetryCount:0});sdk.current(abort);return r;},
  async readKnown(_peer,id,abort){sdk.current(abort);const r=await sdk.call({_:'messages.getMessages',id:[{_:'inputMessageID',id}]},{timeout:0,maxRetryCount:0,floodSleepThreshold:0});sdk.current(abort);return r;},
  async callback(peer,msgId,data,abort){sdk.current(abort);const r=await sdk.call({_:'messages.getBotCallbackAnswer',peer,msgId,data},{timeout:0,maxRetryCount:0,floodSleepThreshold:0});sdk.current(abort);return r;},
  async readDocumentPart(document,offset,limit,abort){sdk.current(abort);const r=await sdk.call({_:'upload.getFile',location:document.location,offset,limit,precise:true},{dcId:document.dcId,kind:'download',timeout:0,maxRetryCount:0,floodSleepThreshold:0});sdk.current(abort);if(r._!=='upload.file')throw new BotSearchProjectionError('unsupported');return r.bytes;},
  getAccountCooldown:sdk.getAccountCooldown,isOtherDc:sdk.isOtherDc,invalidateSession:sdk.invalidateSession,
 },time);
}
