// node --import tsx tests/integration/check-bot-search-sdk-settlement.mjs
// Installed SDK serialization/sendRpc/result/cancel methods; synthetic transport/session only.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import Long from 'long';
import {__tlWriterMap} from '../../node_modules/@mtcute/core/tl/binary/writer.js';
import {SessionConnection} from '../../node_modules/@mtcute/core/network/session-connection.js';
import {createBotProvidersDriver,botProvidersFailure} from '../../src/telegram/bot-providers-driver.ts';
import {createBotSearchSdkDriver as currentDriver} from '../../src/telegram/bot-search-driver.ts';
import {projectBotSearchPage as currentProject} from '../../src/telegram/bot-search-page.ts';
const args=process.argv.slice(2),baselinePath=args.find(a=>a.startsWith('--baseline-driver='))?.slice(18),baseline=!!baselinePath;
const createDriver=baseline?(await import(pathToFileURL(resolve(baselinePath)).href)).createBotSearchSdkDriver:currentDriver;
const project=baseline?(await import(pathToFileURL(resolve(baselinePath.replace('bot-search-driver.ts','bot-search-page.ts'))).href)).projectBotSearchPage:currentProject;
const folder=process.env.PULSO_SDK_SETTLEMENT_OUTPUT??'.local/music-search-sdk-fix-parent';await mkdir(folder,{recursive:true});
const report={passed:false,baselineExpectedDefect:baseline,environment:'Node; installed mtcute SessionConnection methods and TL writer; synthetic transport/auth/peers; no sockets/account',cases:[],cleanup:false};
const id=()=>crypto.randomUUID(),tick=()=>new Promise(r=>setImmediate(r));
const identity=()=>({_: 'contacts.resolvedPeer',peer:{_: 'peerUser',userId:101},chats:[],users:[{_: 'user',id:101,bot:true,username:'ivkmbot',accessHash:new Long(123,45,false),firstName:'Synthetic'}]});
const history=(messages=[])=>({_: 'messages.messages',messages,users:[],chats:[]});
async function setup(){
 const binding={accountRef:id(),accountEpoch:1},sessionId=id(),context={signal:new AbortController().signal,current:()=>true};let invalidations=0,sends=0,observed=0,unknown=0,shared=null,packet=null,conn=null;
 const options=[];
 const pool=createBotProvidersDriver(binding,sessionId,{resolveIdentity:async()=>identity(),invalidateSession(){invalidations++;}});
 const pe=()=>({protocol:'pulso-bot-providers',version:1,...binding,sessionId,providerRevision:pool.getSnapshot().revision,operationId:id(),requestId:id()});
 const offer=await pool.handle({...pe(),type:'bots.validate',input:'ivkmbot'},context),ref=offer.offer.providerRef;
 await pool.handle({...pe(),type:'bots.setOrder',expectedRevision:0,providerRefs:[ref]},context);
 const driver=createDriver(binding,sessionId,{providers:pool,current(s){if(s.aborted)throw s.reason;},invalidateSession(){invalidations++;pool.close();},getAccountCooldown:()=>shared,
  call:async(request,opts)=>{
   options.push({method:request._,timeout:opts.timeout,hasAbort:!!opts.abortSignal});
   if(request._==='contacts.resolveUsername')return identity();if(request._==='messages.getHistory')return history();
   sends++;const msgId=Long.fromNumber(1000+sends),map=new Map();conn=Object.create(SessionConnection.prototype);
   Object.assign(conn,{_destroyed:false,_usable:false,params:{disableUpdates:false},_writerMap:__tlWriterMap,_readerMap:{_results:{}},_crypto:{gzip:()=>null},log:{warn(){unknown++;},debug(){},verbose(){}},_session:{initConnectionCalled:true,pendingMessages:map,queuedCancelReq:[],queuedStateReq:[],getStateSchedule:{remove(){}},recentOutgoingMsgIds:{has:()=>false}},_sendAck(){},_onMessageAcked(){},_flushTimer:{emitWhenIdle(){}},_enqueueRpc(rpc){packet=rpc;packet.msgId=msgId;map.set(msgId,{_:'rpc',rpc});}});
   // Native SDK timeout/cancellation are used exactly as the product adapter supplies them.
   try{const result=await conn.sendRpc(request,opts.timeout,opts.abortSignal);if(result._==='mt_rpc_error')throw {text:result.errorMessage};return result;}
   catch(error){if(error?.text?.startsWith('FLOOD_')||error?.text==='SESSION_REVOKED')observed++;const f=botProvidersFailure(error,Date.now());if(f.error==='rate-limit')shared={retryAt:f.retryAt,retryBlocked:f.retryBlocked};throw error;}
  }
 });
 const command={protocol:'pulso-bot-search',version:1,...binding,sessionId,providerRevision:1,queryId:id(),requestId:id(),type:'bot-search.search',providerRef:ref,query:'Synthetic fixture',consent:true};
 const deliver=text=>conn._onRpcResult(Long.fromNumber(9000),{long:()=>packet.msgId,peekUint:()=>0x2144ca19,object:()=>({_: 'mt_rpc_error',errorCode:text.startsWith('FLOOD')?420:401,errorMessage:text})});
 return {driver,pool,context,command,options,deliver,get stats(){return {invalidations,sends,observed,unknown,pending:conn?conn._session.pendingMessages.size:0,queuedCancel:conn?conn._session.queuedCancelReq.length:0,nativeTimer:!!packet?.timeout};},async waitSend(){for(let i=0;i<100&&!packet;i++)await tick();assert.ok(packet,'native send enqueued');},async cleanup(){driver.close();if(packet&&!packet.done&&!packet.cancelled)conn._cancelRpc(packet,true);await tick();pool.close();}};
}
try{
 for(const late of ['FLOOD_WAIT_172800','SESSION_REVOKED']){
  const x=await setup();try{
   const result=x.driver.handle(x.command,x.context);await x.waitSend();
   const {providerRef,query,consent,...env}=x.command;void providerRef;void query;void consent;
   const ack=await x.driver.handle({...env,type:'bot-search.cancel',requestId:id(),targetRequestId:x.command.requestId},x.context);assert.equal(ack.type,'bot-search.cancelled');
   const primary=await result;assert.equal(primary.error,'cancelled');assert.equal(primary.delivery,'uncertain');
   let settled=false;void x.driver.whenSettled().then(()=>{settled=true;});await tick();
   if(baseline){assert.equal(settled,true);assert.equal(x.stats.pending,0);assert.equal(x.stats.queuedCancel,1);x.deliver(late);await tick();assert.equal(x.stats.observed,0);assert.equal(x.stats.unknown,1);assert.equal(x.stats.invalidations,0);}
   else{
    assert.ok(x.options.every(o=>o.timeout===0&&!o.hasAbort));assert.equal(settled,false);assert.equal(x.stats.pending,1);assert.equal(x.stats.queuedCancel,0);assert.equal(x.stats.nativeTimer,false);
    x.deliver(late);assert.equal(await x.driver.whenSettled(),true);await tick();assert.equal(x.stats.pending,0);assert.equal(x.stats.observed,1);assert.equal(x.stats.unknown,0);
    const next=await x.driver.handle({...x.command,queryId:id(),requestId:id()},x.context);assert.equal(next.error,late.startsWith('FLOOD')?'rate-limit':'session-expired');assert.equal(x.stats.sends,1);assert.equal(x.stats.invalidations,late.startsWith('FLOOD')?0:1);
   }
   report.cases.push({name:late,passed:true,observed:x.stats,scope:baseline?'Original native-abort defect reproduced':'Original native RPC observed after UI cancel; next send denied'});
  }finally{await x.cleanup();}
 }
 if(!baseline){
  const x=await setup();const started=Date.now();try{
   const primary=await x.driver.handle(x.command,x.context);assert.equal(primary.error,'uncertain');assert.equal(primary.delivery,'uncertain');assert.equal(x.stats.pending,1);assert.equal(x.stats.nativeTimer,false);
   assert.equal(await x.driver.whenSettled(),false);assert.equal(x.stats.invalidations,1);const next=await x.driver.handle({...x.command,queryId:id(),requestId:id()},x.context);assert.equal(next.error,'session-expired');assert.equal(x.stats.sends,1);
   report.cases.push({name:'real local 15s deadline + 2s grace, no SDK timer, exact session quarantined',passed:true,elapsedMs:Date.now()-started,observed:x.stats});
  }finally{await x.cleanup();}
 }
 const common={_: 'message',id:12,peerId:{_: 'peerUser',userId:101},fromId:{_: 'peerUser',userId:101},message:'Synthetic response'};
 for(const peer of [undefined,{_: 'peerUser',userId:101},{_: 'peerUser',userId:202},{_: 'peerChannel',channelId:303},{_: 'peerChat',chatId:101},{_: 'peerUser',userId:'101'},{}]){
  const rows=project(history([{...common,replyTo:{_: 'messageReplyHeader',replyToMsgId:10,...(peer?{replyToPeerId:peer}:{})}}]),101,0,10).rows;
  const allowed=peer===undefined||peer._==='peerUser'&&peer.userId===101;
  assert.equal(rows.length,baseline||allowed?1:0);if(rows.length)assert.equal(rows[0].correlation,'reply');report.cases.push({name:'reply peer '+(peer?peer._??'invalid':'omitted'),passed:true,expectedRows:baseline||allowed?1:0,rows:rows.length});
 }
 report.passed=true;
}catch(error){report.failure={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}
finally{report.cleanup=true;await writeFile(folder+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
