/// <reference lib="webworker" />
import {parseSessionCommand,sessionFailure,type SessionCommand,type SessionReply,type Delivery} from './session-protocol';
import {decodeTelegramApiIdentity,API_IDENTITY_INPUT_BYTES} from './api-identity';
import {parseAccountBinding,parseSourcesCommand,type SourcesCommand} from './sources-protocol';
import type {SourcesDriver} from './sources-driver';
import {parseSaved,type SourcesBridgeReply} from './sources-bridge-protocol';
declare const self:DedicatedWorkerGlobalScope;
let session='',phase:SessionReply['phase']='disconnected',active=false,phone='';
let client:import('./temporary-sdk').TemporaryTelegramDriver|undefined;
const abort=new AbortController();
let sources:SourcesDriver|undefined,page:Promise<void>|null=null,control=false;
function closeLocal(){abort.abort();sources?.close();void client?.close().catch(()=>{});self.close();}
async function sourceCommand(command:SourcesCommand){
 if(!sources||!client||phase!=='connected'||active||command.sessionId!==session||command.type!=='sources.cancel'&&(page||control)||command.type==='sources.cancel'&&control){closeLocal();return;}
 const driver=client,core=sources;const binding=parseAccountBinding(driver.getAccountBinding());
 if(!binding||command.accountRef!==binding.accountRef||command.accountEpoch!==binding.accountEpoch){closeLocal();return;}
 const current=()=>!abort.signal.aborted&&client===driver&&driver.getAccountBinding()?.accountRef===binding?.accountRef&&driver.getAccountBinding()?.accountEpoch===binding?.accountEpoch;
 const run=async()=>{
  try{const reply=await core.handle(command,{signal:abort.signal,current});
   const settled=command.type==='sources.page'?await core.whenSettled():true;
   if(!reply){closeLocal();return;}
   const sessionClosed=!settled||!current()||!driver.getAccountBinding();
   self.postMessage({protocol:'pulso-sources',version:1,reply,sessionClosed,saved:sessionClosed?null:core.getSaved()} satisfies SourcesBridgeReply);
   if(sessionClosed)closeLocal();
  }catch{closeLocal();}
 };
 if(command.type==='sources.page'){const flight=run();page=flight;try{await flight;}finally{if(page===flight)page=null;}}
 else{control=true;try{await run();}finally{control=false;}}
}

async function configuration(){
 const response=await fetch('/telegram-config.json',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:abort.signal});
 if(!response.ok||!response.body)throw Error('configuration');
 const reader=response.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
 try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>API_IDENTITY_INPUT_BYTES)throw Error('configuration');chunks.push(r.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const data=new Uint8Array(bytes);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
 const config=decodeTelegramApiIdentity(new TextDecoder('utf-8',{fatal:true}).decode(data));if(!config)throw Error('configuration');return config;
}
async function open(){
 const identity=await configuration();
 const {openTemporaryTelegram}=await import('./temporary-sdk');client=await openTemporaryTelegram(identity,abort.signal);return client;
}
function reply(command:SessionCommand,error:SessionReply['error']=null,retryAt:number|null=null,delivery:Delivery|null=null){self.postMessage({version:2,session,request:command.request,phase,error,retryAt,delivery,binding:phase==='connected'?parseAccountBinding(client!.getAccountBinding()):null,saved:phase==='connected'?parseSaved(sources!.getSaved()):null} satisfies SessionReply);}
self.onmessage=event=>{
 if(event.data?.protocol==='pulso-sources'){const source=parseSourcesCommand(event.data);if(!source){closeLocal();return;}void sourceCommand(source);return;}
 const command=parseSessionCommand(event.data);if(!command||active||session&&command.session!==session){closeLocal();return;}
 if(!session){if(command.type!=='begin'){closeLocal();return;}session=command.session;}
 if(command.type==='begin'&&phase!=='disconnected'||command.type==='code'&&phase!=='code'||command.type==='password'&&phase!=='password'||command.type==='logout'&&phase!=='connected'){closeLocal();return;}
 active=true;
 void (async()=>{
  try{
   if(command.type==='logout'){
    if(page){const settled=await sources!.quiesce();await page;if(!settled||!client?.getAccountBinding()){phase='error';reply(command,'logout-unconfirmed');closeLocal();return;}}
    await client!.logout(abort.signal);client=undefined;phone='';phase='disconnected';reply(command);self.close();return;
   }
   if(command.type==='begin'){
    const ready=await open();phone=command.value;
    const delivery=await ready.begin(phone,abort.signal);
    if(delivery!==null){phase='code';reply(command,null,null,delivery);return;}
   }else if(command.type==='code')await client!.code(phone,command.value,abort.signal);
   else await client!.password(command.value,abort.signal);
   if(!parseAccountBinding(client!.getAccountBinding())){phase='error';reply(command,'protocol');closeLocal();return;}
   sources=client!.createSources(session);if(!parseSaved(sources.getSaved())){phase='error';reply(command,'protocol');closeLocal();return;}
   phase='connected';phone='';reply(command);
  }catch(error){
   const safe=sessionFailure(error);
   if(safe.passwordNeeded&&(command.type==='code'||command.type==='begin')){phase='password';reply(command);return;}
   const retryable=command.type==='code'&&safe.error==='code-invalid'||command.type==='password'&&safe.error==='password-invalid'||(command.type==='code'||command.type==='password')&&safe.error==='rate-limit';
   if(retryable){phase=command.type==='code'?'code':'password';reply(command,safe.error,safe.retryAt);return;}
   phase='error';phone='';reply(command,command.type==='logout'?'logout-unconfirmed':safe.error,safe.retryAt);
   abort.abort();await client?.close().catch(()=>{});self.close();
  }finally{active=false;}
 })();
};
self.onmessageerror=closeLocal;
