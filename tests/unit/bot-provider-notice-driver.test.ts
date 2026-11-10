import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import Long from 'long';
import {createBotProvidersDriver} from '../../src/telegram/bot-providers-driver';
import type {BotProvidersClock} from '../../src/telegram/bot-providers-driver';
import {createBotSearchSdkDriver} from '../../src/telegram/bot-search-driver';
import {parseBotSearchReply} from '../../src/telegram/bot-search-protocol';
const identity=()=>({_:'contacts.resolvedPeer',peer:{_:'peerUser',userId:101},chats:[],users:[{_:'user',id:101,bot:true,username:'lydbot',accessHash:new Long(123,45),firstName:'Own fixture'}]});
const history=(messages:unknown[]=[])=>({_:'messages.messages',messages,users:[],chats:[]});
const target={title:'Own Song',artist:'Own Artist',album:null,durationSeconds:1};
const bytes=new Uint8Array(100);bytes.set(new TextEncoder().encode('RIFF'));bytes.set(new TextEncoder().encode('WAVE'),8);
const doc=(size=100)=>({_:'document',id:new Long(11,3),accessHash:new Long(25,4),fileReference:new Uint8Array([1,3]),dcId:2,mimeType:'audio/wav',size,attributes:[{_:'documentAttributeAudio',duration:1,title:target.title,performer:target.artist}]});
const msg=(media?:unknown,peer=101)=>({_:'message',id:12,peerId:{_:'peerUser',userId:peer},fromId:{_:'peerUser',userId:peer},message:'',replyTo:{_:'messageReplyHeader',replyToMsgId:10},...(media?{media:{_:'messageMediaDocument',document:media}}:{replyMarkup:{_:'replyInlineMarkup',rows:[{_:'keyboardInlineButtonRow',buttons:[{_:'keyboardInlineButton',text:'Own Song — Own Artist',type:{_:'inlineButtonTypeCallback',data:new Uint8Array([8,9])}}]}]}})});
async function setup(option=false,mutate?:(r:any,defaultValue:any,callbackDone:boolean)=>any,time?:BotProvidersClock){
 const binding={accountRef:randomUUID(),accountEpoch:1},sessionId=randomUUID(),ctx={signal:new AbortController().signal,current:()=>true};let invalidations=0,callbackDone=false;
 const pool=createBotProvidersDriver(binding,sessionId,{resolveIdentity:async()=>identity(),invalidateSession(){invalidations++;}});
 const env=()=>({protocol:'pulso-bot-providers',version:1,...binding,sessionId,providerRevision:0,operationId:randomUUID(),requestId:randomUUID()});
 const offer=await pool.handle({...env(),type:'bots.validate',input:'lydbot'},ctx);assert.equal(offer?.type,'bots.validated');const ref=offer!.type==='bots.validated'?offer.offer.providerRef:'';
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
test('callback alert/native UI are inert presentation; URLs still stop before bytes',async()=>{
 for(const flag of [null,'alert','url','nativeUi','hasUrl']){const s=await setup(true,(r,v)=>r._==='messages.getBotCallbackAnswer'?{...v,message:'  Descargando <script> https://example.invalid  ',...(flag?{[flag]:flag==='url'?'https://example.invalid':true}:{})}:v);try{const result=await s.download();const notices=s.progress.filter(x=>x.type==='bot-search.provider-notice');assert.equal(notices.length,1);assert.equal(notices[0].text,'Descargando <script> https://example.invalid');assert.ok(parseBotSearchReply(notices[0],s.dl as never));if(flag&&flag!=='alert'&&flag!=='nativeUi'){assert.equal(result?.type,'bot-search.error');if(result?.type==='bot-search.error'){assert.equal(result.error,'unsupported');assert.equal(result.delivery,'acknowledged');}assert.equal(s.calls.some(x=>x.r._==='upload.getFile'),false);}else{assert.equal(result?.type,'bot-search.downloaded');assert.ok(s.progress.indexOf(notices[0])<s.progress.findIndex(x=>x.type==='bot-search.download-progress'));}}finally{s.driver.close();}}
});
test('unknown constructor or accessor message never publishes text or trusts unknown acknowledgement',async()=>{for(const unknown of [true,false]){let reads=0;const s=await setup(true,(r,v)=>{if(r._!=='messages.getBotCallbackAnswer')return v;if(unknown)return {...v,_:'other',message:'synthetic'};const a={...v};Object.defineProperty(a,'message',{get(){reads++;return 'synthetic';}});return a;});try{const result=await s.download();assert.equal(s.progress.some(x=>x.type==='bot-search.provider-notice'),false);assert.equal(reads,0);if(unknown){assert.equal(result?.type,'bot-search.error');if(result?.type==='bot-search.error')assert.equal(result.delivery,'uncertain');}}finally{s.driver.close();}}});

test('malformed presentation flags stop before bytes and cannot request a native surface',async()=>{
 for(const flag of ['alert','nativeUi']){const s=await setup(true,(r,v)=>r._==='messages.getBotCallbackAnswer'?{...v,[flag]:'native-action'}:v);try{const result=await s.download();assert.equal(result?.type,'bot-search.error');if(result?.type==='bot-search.error')assert.equal(result.error,'unsupported');assert.equal(s.calls.some(x=>x.r._==='upload.getFile'),false);}finally{s.driver.close();}}
});
