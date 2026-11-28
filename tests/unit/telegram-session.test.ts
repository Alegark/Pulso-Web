import test from 'node:test';
import assert from 'node:assert/strict';
import {Activity} from '../../src/playback/ownership';
import {TelegramSessionClient,type SessionWorker} from '../../src/telegram/session-client';
import {parseSessionCommand,parseSessionReply,sessionFailure,type SessionCommand,type SessionReply,type SessionState} from '../../src/telegram/session-protocol';
import {telegramBlockReason} from '../../src/telegram/admission';
const phone='+15555550123'; // DTO fixture only; never used with the SDK or network.
test('editable drafts never grant send authority over root safety gates',()=>{
 const ready={supported:true,owner:true,acquiring:false,storageReady:true,busy:false,reserved:false,queuePending:false};
 assert.equal(telegramBlockReason(ready),null);
 assert.equal(telegramBlockReason({...ready,owner:false,storageReady:false}),'storage');
 for(const [change,reason] of [[{supported:false},'unsupported'],[{owner:false},'no-control'],[{owner:false,acquiring:true},'acquiring'],[{storageReady:false},'storage'],[{busy:true},'busy'],[{reserved:true},'busy'],[{queuePending:true},'busy']] as const)assert.equal(telegramBlockReason({...ready,...change}),reason);
});
class WorkerFixture implements SessionWorker {
 onmessage:SessionWorker['onmessage']=null;onerror:SessionWorker['onerror']=null;onmessageerror:SessionWorker['onmessageerror']=null;messages:SessionCommand[]=[];terminations=0;
 postMessage(c:SessionCommand){this.messages.push(c);}terminate(){++this.terminations;}
 reply(phase:SessionReply['phase'],error:SessionReply['error']=null,retryAt:number|null=null,vaultGeneration?:string){const c=this.messages.at(-1)!;this.onmessage?.({data:{version:2,session:c.session,request:c.request,phase,error,retryAt,...(vaultGeneration?{vaultGeneration}:{}),delivery:phase==='code'?'app':null,binding:phase==='connected'?{accountRef:crypto.randomUUID(),accountEpoch:1}:null,saved:phase==='connected'?{peerRef:crypto.randomUUID(),kind:'saved',name:'Mensajes guardados'}:null}} as MessageEvent);}
}
function setup(timeout=1000,clearVault: (generation:string|null)=>Promise<void>=async()=>{}){const activity=new Activity();activity.open();let admitted=true;const workers:WorkerFixture[]=[],states:SessionState[]=[];const client=new TelegramSessionClient(activity,()=>{const scope=activity.scope();return()=>scope()&&admitted&&activity.admitted;},s=>states.push(s),()=>{const w=new WorkerFixture();workers.push(w);return w;},timeout,undefined,undefined,undefined,undefined,undefined,undefined,clearVault);return {activity,client,workers,states,deny:()=>{admitted=false;}};}
test('closed DTOs reject extras, accessors, malformed phones and nonterminal replies',()=>{
 const c={version:2,session:crypto.randomUUID(),request:crypto.randomUUID(),type:'begin',value:phone};assert.ok(parseSessionCommand(c));assert.equal(parseSessionCommand({...c,sessionString:'never-accepted'}),null);assert.equal(parseSessionCommand({...c,value:'123'}),null);
 assert.equal(parseSessionCommand(Object.defineProperty({...c},'value',{get(){throw Error('hostile');},enumerable:true})),null);
 assert.equal(parseSessionReply({...c,phase:'connected'},c.session,c.request),null);
 assert.equal(parseSessionReply({version:2,session:c.session,request:c.request,phase:'authorizing',error:null,retryAt:null,delivery:null},c.session,c.request),null);
});
test('errors are closed and rate limits preserve a bounded retry time',()=>{
 assert.equal(sessionFailure({message:'SESSION_PASSWORD_NEEDED'}).passwordNeeded,true);assert.equal(sessionFailure({errorMessage:'PHONE_CODE_INVALID'}).error,'code-invalid');
 assert.equal(sessionFailure(Object.defineProperty({},'text',{get(){throw Error('hostile');}})).error,'network');
 const s=sessionFailure({text:'FLOOD_WAIT_60'});assert.equal(s.error,'rate-limit');assert.ok(s.retryAt!>Date.now());assert.equal(sessionFailure({message:'API_ID_INVALID'}).error,'api-invalid');assert.equal(sessionFailure({message:'API_ID_PUBLISHED_FLOOD'}).error,'api-restricted');assert.equal(sessionFailure({message:'configuration'}).error,'configuration');
 assert.equal(JSON.stringify(sessionFailure({message:`unknown private data ${phone}`})).includes(phone),false);
});
test('known zero-second auth flood has a finite wait and deactivated accounts expire',()=>{
 const now=Date.now(),result=sessionFailure({text:'FLOOD_WAIT_0'});
 assert.equal(result.error,'rate-limit');assert.ok(result.retryAt!==null&&result.retryAt>=now+1000);
 assert.equal(sessionFailure({text:'USER_DEACTIVATED_BAN'}).error,'session-expired');
});
test('no worker before valid admitted phone and concurrent begin is ignored',()=>{const s=setup();assert.equal(s.workers.length,0);s.client.begin('invalid');assert.equal(s.workers.length,0);s.client.begin(phone);s.client.begin(phone);assert.equal(s.workers.length,1);assert.equal(s.activity.count,1);assert.equal(s.workers[0].messages.length,1);s.client.dispose();assert.equal(s.activity.count,0);});
test('phone-code-password flow is correlated; state contains no credentials (synthetic replies)',()=>{
 const s=setup();s.client.begin(phone);const w=s.workers[0];w.reply('code');assert.equal(s.activity.count,0);s.client.submit('code','12345');w.reply('password');s.client.submit('password','synthetic-private-password');w.reply('connected');assert.equal(s.client.snapshot().phase,'connected');assert.equal(s.activity.count,0);const text=JSON.stringify(s.states);assert.equal(text.includes(phone),false);assert.equal(text.includes('12345'),false);assert.equal(text.includes('synthetic-private-password'),false);s.client.dispose();
});
test('incorrect code/password keeps the appropriate stage for explicit retry',()=>{const s=setup();s.client.begin(phone);const w=s.workers[0];w.reply('code');s.client.submit('code','12345');w.reply('code','code-invalid');assert.equal(s.client.snapshot().phase,'code');s.client.submit('code','54321');w.reply('password');s.client.submit('password','fixture');w.reply('password','password-invalid');assert.equal(s.client.snapshot().phase,'password');assert.equal(w.terminations,0);s.client.dispose();});
test('stale scope after an Activity ABA cannot publish authentication',()=>{const s=setup();s.client.begin(phone);const w=s.workers[0];s.activity.invalidate();s.activity.open();w.reply('connected');assert.equal(s.client.snapshot().phase,'error');assert.equal(w.terminations,1);assert.equal(s.activity.count,0);s.client.dispose();});
test('captured old worker callback cannot retire or publish into the next session',()=>{const s=setup();s.client.begin(phone);const old=s.workers[0],late=old.onmessage!;const c=old.messages[0];s.client.stop();s.client.begin(phone);late({data:{version:2,session:c.session,request:c.request,phase:'connected',error:null,retryAt:null,delivery:null}} as MessageEvent);assert.equal(s.workers[1].terminations,0);assert.equal(s.client.snapshot().phase,'sending-code');s.client.dispose();});
test('timeout terminates only this worker and ends its token',async()=>{const s=setup(10);const other=s.activity.begin()!;s.client.begin(phone);await new Promise(r=>setTimeout(r,30));assert.equal(s.client.snapshot().error,'timeout');assert.equal(s.activity.count,1);assert.equal(s.workers[0].terminations,1);other.end();s.client.dispose();});
test('malformed and foreign replies fail closed before any connected state',()=>{for(const kind of ['extra','foreign']){const s=setup();s.client.begin(phone);const w=s.workers[0],c=w.messages[0];w.onmessage?.({data:{version:2,session:c.session,request:kind==='foreign'?crypto.randomUUID():c.request,phase:'connected',error:null,retryAt:null,delivery:null,...(kind==='extra'?{rawUser:'not-accepted'}:{})}} as MessageEvent);assert.equal(s.client.snapshot().error,'protocol');assert.equal(s.activity.count,0);s.client.dispose();}});
test('rate limit prevents a new worker before retryAt',()=>{const s=setup();s.client.begin(phone);s.workers[0].reply('error','rate-limit',Date.now()+60000);s.client.begin(phone);assert.equal(s.workers.length,1);assert.equal(s.client.snapshot().error,'rate-limit');s.client.dispose();});
test('logout confirmation releases the worker; denial is not remote success',()=>{const s=setup();s.client.begin(phone);const w=s.workers[0];w.reply('connected');s.client.logout();assert.equal(s.client.snapshot().phase,'disconnecting');w.reply('error','logout-unconfirmed');assert.equal(s.client.snapshot().error,'logout-unconfirmed');assert.equal(w.terminations,1);assert.equal(s.activity.count,0);s.client.dispose();});
test('worker failure during logout cannot be reported as confirmed revocation',async()=>{const s=setup();s.client.begin(phone);const w=s.workers[0];w.reply('connected');s.client.logout();w.onerror?.({preventDefault(){}} as ErrorEvent);await new Promise(r=>setImmediate(r));assert.equal(s.client.snapshot().error,'logout-unconfirmed');assert.equal(s.activity.count,0);assert.equal(w.terminations,1);s.client.dispose();});
test('revalidate and disposal deny later writes and are idempotent',()=>{const s=setup();s.client.begin(phone);s.deny();s.client.revalidate();assert.equal(s.workers[0].terminations,1);s.client.submit('code','12345');s.client.begin(phone);assert.equal(s.workers.length,1);s.client.dispose();s.client.dispose();s.client.begin(phone);assert.equal(s.workers.length,1);assert.equal(s.activity.count,0);});

test('restore and forget accept no credential payload and require current admission',()=>{
 for(const type of ['restore','forget'] as const){const c={version:2,session:crypto.randomUUID(),request:crypto.randomUUID(),type,value:''};assert.equal(parseSessionCommand(c)?.type,type);assert.equal(parseSessionCommand({...c,value:'not-allowed'}),null);}
 const s=setup();s.deny();s.client.restore();s.client.forgetSavedSession();assert.equal(s.workers.length,0);s.client.dispose();
});
test('restore can recover a session without phone/code/password or concurrent workers',()=>{const s=setup();s.client.restore();s.client.restore();const w=s.workers[0];assert.equal(w.messages.length,1);assert.equal(w.messages[0].type,'restore');assert.equal(w.messages[0].value,'');assert.equal(s.client.snapshot().phase,'restoring');w.reply('connected');assert.equal(s.client.snapshot().phase,'connected');assert.equal(s.activity.count,0);s.client.dispose();});
test('an absent saved authorization settles disconnected without requesting a code',()=>{const s=setup();s.client.restore();s.workers[0].reply('disconnected');assert.equal(s.client.snapshot().phase,'disconnected');assert.equal(s.activity.count,0);assert.equal(s.workers[0].messages.length,1);assert.equal(s.workers[0].terminations,1);s.client.dispose();});
test('revoked restoration guard rejects late success',()=>{const s=setup();s.client.restore();s.activity.invalidate();s.activity.open();s.workers[0].reply('connected');assert.equal(s.client.snapshot().phase,'error');assert.equal(s.workers[0].terminations,1);assert.equal(s.activity.count,0);s.client.dispose();});
test('forget uses only its empty command and reports a local storage failure honestly',()=>{const s=setup();s.client.forgetSavedSession();const w=s.workers[0];assert.equal(w.messages[0].type,'forget');assert.equal(s.client.snapshot().phase,'disconnecting');w.onerror?.({preventDefault(){}} as ErrorEvent);assert.equal(s.client.snapshot().error,'session-storage');assert.equal(s.activity.count,0);s.client.forgetSavedSession();s.workers[1].reply('disconnected');assert.equal(s.client.snapshot().phase,'disconnected');s.client.dispose();});

test('resend carries no credential and accepts only advertised SMS/call deadlines',()=>{
 const s=crypto.randomUUID(),r=crypto.randomUUID(),command={version:2,session:s,request:r,type:'resend',value:''};
 assert.ok(parseSessionCommand(command));assert.equal(parseSessionCommand({...command,value:'private challenge'}),null);
 const reply={version:2,session:s,request:r,phase:'code',error:null,retryAt:null,delivery:'app',binding:null,saved:null};
 for(const delivery of ['sms','call'])assert.ok(parseSessionReply({...reply,codeResend:{delivery,availableAt:Date.now()+1000}},s,r));
 for(const codeResend of [{delivery:'app',availableAt:0},{delivery:'sms',availableAt:NaN},{delivery:'sms',availableAt:-1},{delivery:'sms',availableAt:0,phoneCodeHash:'not permitted'}])assert.equal(parseSessionReply({...reply,codeResend},s,r),null);
 assert.equal(parseSessionReply({...reply,phase:'password',codeResend:{delivery:'sms',availableAt:0}},s,r),null);
});
test('resend is manual, deadline-gated, singleflight and bound to the existing worker',()=>{
 const s=setup();s.client.begin(phone);const w=s.workers[0],c=w.messages[0];
 const reply=(availableAt:number)=>w.onmessage?.({data:{version:2,session:c.session,request:c.request,phase:'code',error:null,retryAt:null,delivery:'app',binding:null,saved:null,codeResend:{delivery:'sms',availableAt}}} as MessageEvent);
 reply(Date.now()+60000);s.client.resend();assert.equal(w.messages.length,1);s.client.stop();
 s.client.begin(phone);const active=s.workers[1],begin=active.messages[0];active.onmessage?.({data:{version:2,session:begin.session,request:begin.request,phase:'code',error:null,retryAt:null,delivery:'app',binding:null,saved:null,codeResend:{delivery:'sms',availableAt:0}}} as MessageEvent);
 assert.equal(active.messages.length,1);const stale=s.client.captureSessionCurrent();s.client.resend();s.client.resend();assert.equal(active.messages.length,2);assert.equal(active.messages[1].type,'resend');assert.equal(active.messages[1].value,'');assert.equal(s.workers.length,2);assert.equal(stale(),false);assert.equal(s.client.snapshot().phase,'sending-code');s.client.stop();active.reply('code');assert.equal(s.client.snapshot().phase,'error');assert.equal(s.activity.count,0);s.client.dispose();
});
test('missing offer, flood wait and lost admission never dispatch resend',()=>{
 for(const mode of ['missing','flood','denied'] as const){const s=setup();s.client.begin(phone);const w=s.workers[0],c=w.messages[0];w.onmessage?.({data:{version:2,session:c.session,request:c.request,phase:'code',error:mode==='flood'?'rate-limit':null,retryAt:mode==='flood'?Date.now()+60000:null,delivery:'app',binding:null,saved:null,...(mode==='missing'?{}:{codeResend:{delivery:'sms',availableAt:0}})}} as MessageEvent);if(mode==='denied')s.deny();s.client.resend();assert.equal(w.messages.length,1);s.client.dispose();}
});

test('failed logout post and failed page vault deletion report a distinct error',async()=>{
 let attempts=0;const s=setup(1000,async()=>{attempts++;throw Error('fixture storage failed');});
 try{s.client.begin(phone);const w=s.workers[0];w.reply('connected');w.postMessage=()=>{throw Error('fixture worker closed');};
 s.client.logout();s.client.restore();assert.equal(s.workers.length,1);
 await new Promise(r=>setImmediate(r));assert.equal(attempts,1);assert.equal(s.client.snapshot().error,'logout-storage-unconfirmed');
 }finally{s.client.dispose();}
});

test('interrupted logout clears only the authorization generation of the connected worker',async()=>{
 const generation=crypto.randomUUID(),cleared:(string|null)[]=[];const s=setup(1000,async value=>{cleared.push(value);});
 try{s.client.begin(phone);s.workers[0].reply('connected',null,null,generation);
 assert.equal(Object.hasOwn(s.client.snapshot(),'vaultGeneration'),false);
 s.client.logout();s.client.stop();
 await new Promise(r=>setImmediate(r));assert.deepEqual(cleared,[generation]);assert.equal(s.client.snapshot().error,'logout-unconfirmed');
 }finally{s.client.dispose();}
});
