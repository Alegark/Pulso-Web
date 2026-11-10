import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import Long from 'long';
import {createBotProvidersDriver} from '../../src/telegram/bot-providers-driver';
import type {BotProvidersClock} from '../../src/telegram/bot-providers-driver';
import {createBotSearchSdkDriver} from '../../src/telegram/bot-search-driver';
import {parseBotSearchReply} from '../../src/telegram/bot-search-protocol';
const identity=()=>({_:'contacts.resolvedPeer',peer:{_:'peerUser',userId:101},chats:[],users:[{_:'user',id:101,bot:true,username:'ansmusicbot',accessHash:new Long(123,45),firstName:'Own fixture'}]});
const history=(messages:unknown[]=[])=>({_:'messages.messages',messages,users:[],chats:[]});
const target={title:'Own Song',artist:'Own Artist',album:null,durationSeconds:1};
const bytes=new Uint8Array(100);bytes.set(new TextEncoder().encode('RIFF'));bytes.set(new TextEncoder().encode('WAVE'),8);
const doc=(size=100)=>({_:'document',id:new Long(11,3),accessHash:new Long(25,4),fileReference:new Uint8Array([1,3]),dcId:2,mimeType:'audio/wav',size,attributes:[{_:'documentAttributeAudio',duration:1,title:target.title,performer:target.artist}]});
const msg=(media?:unknown,peer=101)=>({_:'message',id:12,peerId:{_:'peerUser',userId:peer},fromId:{_:'peerUser',userId:peer},message:'',replyTo:{_:'messageReplyHeader',replyToMsgId:10},...(media?{media:{_:'messageMediaDocument',document:media}}:{replyMarkup:{_:'replyInlineMarkup',rows:[{_:'keyboardInlineButtonRow',buttons:[{_:'keyboardInlineButton',text:'Own Song — Own Artist',type:{_:'inlineButtonTypeCallback',data:new Uint8Array([8,9])}}]}]}})});
async function setup(option=false,mutate?:(r:any,defaultValue:any,callbackDone:boolean)=>any,time?:BotProvidersClock){
 const binding={accountRef:randomUUID(),accountEpoch:1},sessionId=randomUUID(),ctx={signal:new AbortController().signal,current:()=>true};let invalidations=0,callbackDone=false;
 const pool=createBotProvidersDriver(binding,sessionId,{resolveIdentity:async()=>identity(),invalidateSession(){invalidations++;}});
 const env=()=>({protocol:'pulso-bot-providers',version:1,...binding,sessionId,providerRevision:0,operationId:randomUUID(),requestId:randomUUID()});
 const offer=await pool.handle({...env(),type:'bots.validate',input:'ansmusicbot'},ctx);assert.equal(offer?.type,'bots.validated');const ref=offer!.type==='bots.validated'?offer.offer.providerRef:'';
 await pool.handle({...env(),type:'bots.setOrder',expectedRevision:0,providerRefs:[ref]},ctx);
 const calls:any[]=[],progress:any[]=[];
 const driver=createBotSearchSdkDriver(binding,sessionId,{providers:pool,current(s){if(s.aborted)throw Error('cancelled');},getAccountCooldown:()=>null,invalidateSession(){invalidations++;},call:async(r:any,o:any)=>{
  calls.push({r,o});let v:any;
  switch(r._){case 'contacts.resolveUsername':v=identity();break;case 'messages.sendMessage':v={_:'updateShortSentMessage',out:true,id:10};break;case 'messages.getHistory':v=r.limit===1?history():history([msg(option&&!callbackDone?undefined:doc())]);break;case 'messages.getMessages':v=history([msg(option&&!callbackDone?undefined:doc())]);break;case 'messages.getBotCallbackAnswer':assert.deepEqual(r.data,new Uint8Array([8,9]));callbackDone=true;v={_:'messages.botCallbackAnswer',cacheTime:0};break;case 'upload.getFile':assert.equal(o.dcId,2);assert.equal(o.kind,'download');v={_:'upload.file',bytes:bytes.slice(),mtime:0};break;default:throw Error('unexpected');}
  return mutate?await mutate(r,v,callbackDone):v;
 }} as never,time);
 const command={protocol:'pulso-bot-search' as const,version:1 as const,...binding,sessionId,providerRevision:1,queryId:randomUUID(),requestId:randomUUID(),type:'bot-search.search',providerRef:ref,query:target.title,target,consent:true};
 const response=await driver.handle(command,ctx);assert.equal(response?.type,'bot-search.result');
 const dl={...command,type:'bot-search.download',requestId:randomUUID(),rowRef:response?.type==='bot-search.result'?response.rows[0].rowRef:''};delete (dl as any).query;
 return {driver,dl,ctx,calls,progress,get invalidations(){return invalidations;},download:()=>driver.handle(dl,{...ctx,publish:r=>progress.push(r)})};
}
test('AnsMusicBot uses the same verified direct-audio and selected-menu download contracts',async()=>{
 for(const option of [false,true]){const s=await setup(option);try{const r=await s.download();assert.equal(r?.type,'bot-search.downloaded');assert.ok(parseBotSearchReply(r,s.dl as never));if(r?.type==='bot-search.downloaded'){assert.equal(r.audio.sha256,createHash('sha256').update(bytes).digest('hex'));assert.deepEqual(new Uint8Array(await r.audio.blob.arrayBuffer()),bytes);}
 assert.equal(s.calls.filter(x=>x.r._==='messages.sendMessage').length,1);assert.equal(s.calls.find(x=>x.r._==='messages.sendMessage').r.message,'Own Song Own Artist');assert.equal(s.calls.filter(x=>x.r._==='messages.getBotCallbackAnswer').length,option?1:0);assert.equal(s.calls.filter(x=>x.r._==='upload.getFile').length,1);assert.equal(s.calls.filter(x=>x.r._==='messages.getMessages').length,option?3:2);const count=s.calls.length;assert.equal((await s.driver.handle({...s.dl,requestId:randomUUID()},s.ctx))?.type,'bot-search.error');assert.equal(s.calls.length,count);assert.equal(await s.driver.whenSettled(),true);for(const {o}of s.calls){assert.equal(o.timeout,0);assert.equal(o.maxRetryCount,0);assert.equal(o.floodSleepThreshold,0);assert.equal(o.abortSignal,undefined);}
 }finally{s.driver.close();}}
});
test('AnsMusicBot still rejects a foreign or changed menu before its callback or file transfer',async()=>{
 for(const foreign of [false,true]){const s=await setup(true,(r,v)=>r._==='messages.getMessages'?history([foreign?msg(undefined,202):{...msg(),message:'changed'}]):v);try{const r=await s.download();assert.equal(r?.type,'bot-search.error');assert.equal(s.calls.some(x=>['messages.getBotCallbackAnswer','upload.getFile'].includes(x.r._)),false);}finally{s.driver.close();}}
});

test('AnsMusicBot holds a single flight until bytes settle',async()=>{
 let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
 const s=await setup(false,async(r,v)=>{if(r._==='upload.getFile'){entered();await waiting;}return v;});
 try{const pending=s.download();await started;const competing=await s.driver.handle({...s.dl,requestId:randomUUID()},s.ctx);assert.equal(competing?.type,'bot-search.error');if(competing?.type==='bot-search.error')assert.equal(competing.error,'busy');release();assert.equal((await pending)?.type,'bot-search.downloaded');assert.equal(s.calls.filter(x=>x.r._==='upload.getFile').length,1);}finally{release();s.driver.close();}
});
test('unknown provider remains unsupported before SDK calls',async()=>{
 const binding={accountRef:randomUUID(),accountEpoch:1},sessionId=randomUUID(),ctx={signal:new AbortController().signal,current:()=>true};
 const pool=createBotProvidersDriver(binding,sessionId,{resolveIdentity:async()=>({...identity(),users:[{...identity().users[0],username:'unknownbot'}]}),invalidateSession(){}});
 const env=()=>({protocol:'pulso-bot-providers',version:1,...binding,sessionId,providerRevision:0,operationId:randomUUID(),requestId:randomUUID()});
 const offer=await pool.handle({...env(),type:'bots.validate',input:'unknownbot'},ctx);assert.equal(offer?.type,'bots.validated');const ref=offer!.type==='bots.validated'?offer.offer.providerRef:'';await pool.handle({...env(),type:'bots.setOrder',expectedRevision:0,providerRefs:[ref]},ctx);let calls=0;
 const driver=createBotSearchSdkDriver(binding,sessionId,{providers:pool,current(){},getAccountCooldown:()=>null,invalidateSession(){},call:async()=>{calls++;throw Error('unexpected');}} as never);
 try{const result=await driver.handle({protocol:'pulso-bot-search',version:1,...binding,sessionId,providerRevision:1,queryId:randomUUID(),requestId:randomUUID(),type:'bot-search.search',providerRef:ref,query:target.title,target,consent:true},ctx);assert.equal(result?.type,'bot-search.error');if(result?.type==='bot-search.error')assert.equal(result.error,'unsupported');assert.equal(calls,0);}finally{driver.close();}
});
