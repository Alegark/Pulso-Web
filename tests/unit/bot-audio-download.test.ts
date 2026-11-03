import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import Long from 'long';
import {createBotProvidersDriver} from '../../src/telegram/bot-providers-driver';
import {createBotSearchSdkDriver} from '../../src/telegram/bot-search-driver';
import {parseBotSearchReply,BOT_SEARCH_BOUNDS} from '../../src/telegram/bot-search-protocol';
const identity=()=>({_:'contacts.resolvedPeer',peer:{_:'peerUser',userId:101},chats:[],users:[{_:'user',id:101,bot:true,username:'ivkmbot',accessHash:new Long(123,45),firstName:'Own fixture'}]});
const history=(messages:unknown[]=[])=>({_:'messages.messages',messages,users:[],chats:[]});
const target={title:'Own Song',artist:'Own Artist',album:null,durationSeconds:1};
const bytes=new Uint8Array(100);bytes.set(new TextEncoder().encode('RIFF'));bytes.set(new TextEncoder().encode('WAVE'),8);
const doc=(size=100)=>({_:'document',id:new Long(11,3),accessHash:new Long(25,4),fileReference:new Uint8Array([1,3]),dcId:2,mimeType:'audio/wav',size,attributes:[{_:'documentAttributeAudio',duration:1,title:target.title,performer:target.artist}]});
const msg=(media?:unknown,peer=101)=>({_:'message',id:12,peerId:{_:'peerUser',userId:peer},fromId:{_:'peerUser',userId:peer},message:'',replyTo:{_:'messageReplyHeader',replyToMsgId:10},...(media?{media:{_:'messageMediaDocument',document:media}}:{replyMarkup:{_:'replyInlineMarkup',rows:[{_:'keyboardInlineButtonRow',buttons:[{_:'keyboardInlineButton',text:'Own Song — Own Artist',type:{_:'inlineButtonTypeCallback',data:new Uint8Array([8,9])}}]}]}})});
async function setup(option=false,mutate?:(r:any,defaultValue:any,callbackDone:boolean)=>any){
 const binding={accountRef:randomUUID(),accountEpoch:1},sessionId=randomUUID(),ctx={signal:new AbortController().signal,current:()=>true};let invalidations=0,callbackDone=false;
 const pool=createBotProvidersDriver(binding,sessionId,{resolveIdentity:async()=>identity(),invalidateSession(){invalidations++;}});
 const env=()=>({protocol:'pulso-bot-providers',version:1,...binding,sessionId,providerRevision:0,operationId:randomUUID(),requestId:randomUUID()});
 const offer=await pool.handle({...env(),type:'bots.validate',input:'ivkmbot'},ctx);assert.equal(offer?.type,'bots.validated');const ref=offer!.type==='bots.validated'?offer.offer.providerRef:'';
 await pool.handle({...env(),type:'bots.setOrder',expectedRevision:0,providerRefs:[ref]},ctx);
 const calls:any[]=[],progress:any[]=[];
 const driver=createBotSearchSdkDriver(binding,sessionId,{providers:pool,current(s){if(s.aborted)throw Error('cancelled');},getAccountCooldown:()=>null,invalidateSession(){invalidations++;},call:async(r:any,o:any)=>{
  calls.push({r,o});let v:any;
  switch(r._){case 'contacts.resolveUsername':v=identity();break;case 'messages.sendMessage':v={_:'updateShortSentMessage',out:true,id:10};break;case 'messages.getHistory':v=r.limit===1?history():history([msg(option&&!callbackDone?undefined:doc())]);break;case 'messages.getMessages':v=history([msg(option&&!callbackDone?undefined:doc())]);break;case 'messages.getBotCallbackAnswer':assert.deepEqual(r.data,new Uint8Array([8,9]));callbackDone=true;v={_:'messages.botCallbackAnswer',cacheTime:0};break;case 'upload.getFile':assert.equal(o.dcId,2);assert.equal(o.kind,'download');v={_:'upload.file',bytes:bytes.slice(),mtime:0};break;default:throw Error('unexpected');}
  return mutate?await mutate(r,v,callbackDone):v;
 }} as never);
 const command={protocol:'pulso-bot-search' as const,version:1 as const,...binding,sessionId,providerRevision:1,queryId:randomUUID(),requestId:randomUUID(),type:'bot-search.search',providerRef:ref,query:target.title,target,consent:true};
 const response=await driver.handle(command,ctx);assert.equal(response?.type,'bot-search.result');
 const dl={...command,type:'bot-search.download',requestId:randomUUID(),rowRef:response?.type==='bot-search.result'?response.rows[0].rowRef:''};delete (dl as any).query;
 return {driver,dl,ctx,calls,progress,get invalidations(){return invalidations;},download:()=>driver.handle(dl,{...ctx,publish:r=>progress.push(r)})};
}
test('direct audio uses private location, one sequential download, exact hash/Blob and second revalidation',async()=>{
 const s=await setup();const r=await s.download();assert.equal(r?.type,'bot-search.downloaded');assert.ok(parseBotSearchReply(r,s.dl as never));
 if(r?.type==='bot-search.downloaded'){assert.equal(r.audio.sha256,createHash('sha256').update(bytes).digest('hex'));assert.deepEqual(new Uint8Array(await r.audio.blob.arrayBuffer()),bytes);assert.equal(r.audio.bytes,100);}
 assert.equal(s.calls.filter(x=>x.r._==='upload.getFile').length,1);assert.equal(s.calls.filter(x=>x.r._==='messages.getMessages').length,2);
 for(const {o} of s.calls){assert.equal(o.timeout,0);assert.equal(o.maxRetryCount,0);assert.equal(o.floodSleepThreshold,0);assert.equal(o.abortSignal,undefined);}
 assert.equal((await s.driver.handle({...s.dl,requestId:randomUUID()},s.ctx))?.type,'bot-search.error');s.driver.close();
});
test('explicit option sends exact callback once, then downloads a reply audio',async()=>{const s=await setup(true);const r=await s.download();assert.equal(r?.type,'bot-search.downloaded');assert.equal(s.calls.filter(x=>x.r._==='messages.getBotCallbackAnswer').length,1);s.driver.close();});
test('changed menu and foreign known peer reject before callback or bytes',async()=>{
 for(const foreign of [false,true]){const s=await setup(true,(r,v)=>r._==='messages.getMessages'?history([foreign?msg(undefined,202):{...msg(),message:'changed'}]):v);const r=await s.download();assert.equal(r?.type,'bot-search.error');assert.equal(s.calls.some(x=>['upload.getFile','messages.getBotCallbackAnswer'].includes(x.r._)),false);s.driver.close();}
});
test('oversize rejected before bytes; short and wrong headers never return a file',async()=>{
 for(const mode of ['size','short','header']){const s=await setup(false,(r,v)=>mode==='size'&&['messages.getHistory','messages.getMessages'].includes(r._)&&r.limit!==1?history([msg(doc(8388609))]):r._==='upload.getFile'?{...v,bytes:mode==='short'?bytes.slice(1):new Uint8Array(100)}:v);const r=await s.download();assert.equal(r?.type,'bot-search.error');if(r?.type==='bot-search.error')assert.equal(r.error,mode==='size'?'file-too-large':'file-invalid');if(mode==='size')assert.equal(s.calls.some(x=>x.r._==='upload.getFile'),false);s.driver.close();}
});
test('recent callback document is offered for explicit second selection, never downloaded automatically',async()=>{
 const s=await setup(true,(r,v,clicked)=>clicked&&['messages.getHistory','messages.getMessages'].includes(r._)&&r.limit!==1?history([{...msg(doc()),replyTo:undefined}]):v);
 const r=await s.download();assert.equal(r?.type,'bot-search.result');if(r?.type==='bot-search.result')assert.equal(r.rows[0].correlation,'recent');
 assert.equal(s.calls.filter(x=>x.r._==='upload.getFile').length,0);assert.equal(s.calls.filter(x=>x.r._==='messages.getBotCallbackAnswer').length,1);s.driver.close();
 assert.equal(BOT_SEARCH_BOUNDS.downloadMs,120000);
});
test('cancel preserves the file RPC lane and observes a late revocation without a second request',async()=>{
 let reject!:(e:unknown)=>void;const pending=new Promise((_,r)=>reject=r);const s=await setup(false,(r,v)=>r._==='upload.getFile'?pending:v);
 const abort=new AbortController();const result=s.driver.handle(s.dl,{signal:abort.signal,current:()=>true});
 while(!s.calls.some(x=>x.r._==='upload.getFile'))await new Promise(r=>setImmediate(r));
 abort.abort();const early=await result;assert.equal(early?.type,'bot-search.error');if(early?.type==='bot-search.error')assert.equal(early.error,'cancelled');
 let settled=false;void s.driver.whenSettled().then(()=>settled=true);await new Promise(r=>setImmediate(r));assert.equal(settled,false);
 reject({text:'SESSION_REVOKED'});assert.equal(await s.driver.whenSettled(),true);assert.equal(s.invalidations,1);assert.equal(s.calls.filter(x=>x.r._==='upload.getFile').length,1);s.driver.close();
});

test('a file part larger than the remaining document never emits invalid progress',async()=>{
 const s=await setup(false,(r,v)=>r._==='upload.getFile'?{...v,bytes:new Uint8Array(101)}:v);const r=await s.download();assert.equal(r?.type,'bot-search.error');assert.equal(s.progress.some(p=>p.type==='bot-search.download-progress'),false);s.driver.close();
});
