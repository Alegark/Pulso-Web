import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import Long from 'long';
import {createBotProvidersDriver} from '../../src/telegram/bot-providers-driver';
import type {BotProvidersClock} from '../../src/telegram/bot-providers-driver';
import {createBotSearchSdkDriver} from '../../src/telegram/bot-search-driver';
import {projectBotCallbackPage,botSearchDocumentIdentity} from '../../src/telegram/bot-search-page';
const identity=()=>({_:'contacts.resolvedPeer',peer:{_:'peerUser',userId:101},chats:[],users:[{_:'user',id:101,bot:true,username:'ivkmbot',accessHash:new Long(123,45),firstName:'Own fixture'}]});
const history=(messages:unknown[]=[])=>({_:'messages.messages',messages,users:[],chats:[]});
const target={title:'Own Song',artist:'Own Artist',album:null,durationSeconds:1};
const bytes=new Uint8Array(100);bytes.set(new TextEncoder().encode('RIFF'));bytes.set(new TextEncoder().encode('WAVE'),8);
const doc=(size=100)=>({_:'document',id:new Long(11,3),accessHash:new Long(25,4),fileReference:new Uint8Array([1,3]),dcId:2,mimeType:'audio/wav',size,attributes:[{_:'documentAttributeAudio',duration:1,title:target.title,performer:target.artist}]});
const msg=(media?:unknown,peer=101)=>({_:'message',id:12,peerId:{_:'peerUser',userId:peer},fromId:{_:'peerUser',userId:peer},message:'',replyTo:{_:'messageReplyHeader',replyToMsgId:10},...(media?{media:{_:'messageMediaDocument',document:media}}:{replyMarkup:{_:'replyInlineMarkup',rows:[{_:'keyboardInlineButtonRow',buttons:[{_:'keyboardInlineButton',text:'Own Song — Own Artist',type:{_:'inlineButtonTypeCallback',data:new Uint8Array([8,9])}}]}]}})});
async function setup(option=false,mutate?:(r:any,defaultValue:any,callbackDone:boolean)=>any,time?:BotProvidersClock){
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
 }} as never,time);
 const command={protocol:'pulso-bot-search' as const,version:1 as const,...binding,sessionId,providerRevision:1,queryId:randomUUID(),requestId:randomUUID(),type:'bot-search.search',providerRef:ref,query:target.title,target,consent:true};
 const response=await driver.handle(command,ctx);assert.equal(response?.type,'bot-search.result');
 const dl={...command,type:'bot-search.download',requestId:randomUUID(),rowRef:response?.type==='bot-search.result'?response.rows[0].rowRef:''};delete (dl as any).query;
 return {driver,dl,ctx,calls,progress,get invalidations(){return invalidations;},download:()=>driver.handle(dl,{...ctx,publish:r=>progress.push(r)})};
}

const fakeTime=()=>{let now=0,id=0;const timers=new Map<number,{at:number;fn:()=>void}>();const clock={now:()=>now,setTimeout(fn:()=>void,ms:number){const key=++id;timers.set(key,{at:now+ms,fn});return key;},clearTimeout(key:number){timers.delete(key);}} as unknown as BotProvidersClock;return {clock,advance(ms:number){const end=now+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=end;},timers};};
test('callback edit of exact selected menu is found without an extra RPC or callback',async()=>{
 const time=fakeTime();let baselines=0,polls=0;
 const s=await setup(true,(r,v,clicked)=>{
  if(r._==='messages.getHistory'&&r.limit===1){baselines++;return history([{...msg(),id:baselines===1?9:12}]);}
  // Native getHistory min_id semantics: only IDs strictly greater than minId.
  if(r._==='messages.getHistory'&&clicked){polls++;return history(12>r.minId?[msg(polls>=3?doc():undefined)]:[]);}
  if(r._==='messages.getMessages'&&clicked)return history([msg(doc())]);
  return v;
 },time.clock);
 let done=false;const result=s.download().then(r=>{done=true;return r;});await new Promise(r=>setImmediate(r));
 for(let n=0;n<61&&!done;n++){time.advance(1000);await new Promise(r=>setImmediate(r));}
 try{const r=await result;assert.equal(r?.type,'bot-search.downloaded');assert.equal(polls,3);assert.equal(s.calls.filter(x=>x.r._==='messages.getBotCallbackAnswer').length,1);assert.equal(s.calls.filter(x=>x.r._==='messages.getMessages').length,3);assert.equal(s.calls.filter(x=>x.r._==='upload.getFile').length,1);assert.equal(await s.driver.whenSettled(),true);}finally{s.driver.close();}assert.equal(time.timers.size,0);
});
test('callback history excludes older neighbouring audio, but includes exact menu edit and newer replies',()=>{
 const selected=msg(doc());const neighbour={...msg(doc()),id:13};const newer={...msg(doc()),id:16};const p=projectBotCallbackPage(history([neighbour,selected,newer]),101,15,10,12,null,target);
 assert.equal(p.rows.filter(r=>r.kind==='audio').length,2);assert.deepEqual([...p.refs.values()].filter(r=>r.row?.kind==='audio').map(r=>r.messageId),[12,16]);
});
test('unchanged selected menu does not turn older matching audio into a download',()=>{
 const p=projectBotCallbackPage(history([msg(),{...msg(doc()),id:13}]),101,15,10,12,null,target);assert.equal(p.rows.filter(r=>r.kind==='audio').length,0);assert.equal(p.rows.filter(r=>r.kind==='option').length,0);
});
test('callback window keeps concurrency and exact peer/reply validation',()=>{
 const concurrent={...msg(),id:16,out:true};assert.equal(projectBotCallbackPage(history([msg(doc()),concurrent]),101,15,10,12,null,target).concurrent,true);
 const replyForeign={...msg(doc()),replyTo:{_:'messageReplyHeader',replyToMsgId:10,replyToPeerId:{_:'peerUser',userId:202}}};assert.equal(projectBotCallbackPage(history([replyForeign]),101,12,10,12,null,target).rows.length,0);
 assert.throws(()=>projectBotCallbackPage(history([msg(doc(),202)]),101,12,10,12,null,target));
 const wrongAuthor={...msg(doc()),fromId:{_:'peerUser',userId:202}};assert.equal(projectBotCallbackPage(history([wrongAuthor]),101,12,10,12,null,target).rows.length,0);
});

test('unchanged audio attached to the selected keyboard is not a new callback result',()=>{
 const original={...msg(doc()),replyMarkup:msg().replyMarkup};const fingerprint=botSearchDocumentIdentity(original);
 assert.equal(projectBotCallbackPage(history([original]),101,12,10,12,fingerprint,target).rows.length,0);
 const changed={...original,media:{_:'messageMediaDocument',document:{...doc(),id:new Long(55,4)}}};
 assert.equal(projectBotCallbackPage(history([changed]),101,12,10,12,fingerprint,target).rows.filter(r=>r.kind==='audio').length,1);
});

test('caption, keyboard, audio tags and renewed locator do not make the old document new',()=>{
 const original={...msg(doc()),replyMarkup:msg().replyMarkup};const before=botSearchDocumentIdentity(original);
 for(const candidate of [
  {...original,message:'Updated caption'},
  {...original,replyMarkup:undefined},
  {...original,media:{_:'messageMediaDocument',document:{...doc(),fileReference:new Uint8Array([5,6,7])}}},
  {...original,media:{_:'messageMediaDocument',document:{...doc(),attributes:[{_:'documentAttributeAudio',duration:2,title:'Edited title',performer:target.artist}]}}},
 ])assert.equal(projectBotCallbackPage(history([candidate]),101,12,10,12,before,target).rows.filter(r=>r.kind==='audio').length,0);
});
