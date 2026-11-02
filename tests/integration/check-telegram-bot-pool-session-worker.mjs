/** Real session.worker + frozen bot/source cores in VM; SDK boundary INJECTED, no Telegram. */
import {build} from 'vite';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {randomUUID,webcrypto} from 'node:crypto';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const artifacts=resolve('.local/telegram-bot-pool-integration-r131');
const sdk=`import Long from 'long';
import {createSourcesDriver,sourcesFailure} from ${JSON.stringify(resolve('src/telegram/sources-driver.ts'))};
import {createBotProvidersDriver} from ${JSON.stringify(resolve('src/telegram/bot-providers-driver.ts'))};
export async function openTemporaryTelegram(){
 const f=globalThis.fixture;let binding=null,sources=null,bots=null,cooldown={retryAt:null,retryBlocked:false};
 const invalidate=()=>{binding=null;sources?.close();bots?.close();f.invalidated++;};
 const read=async(fn)=>{if(cooldown.retryBlocked||cooldown.retryAt>Date.now())throw {text:'FLOOD_WAIT_UNKNOWN'};f.active++;f.maxActive=Math.max(f.maxActive,f.active);try{return await fn();}catch(e){const c=sourcesFailure(e,Date.now());if(c.error==='rate-limit'){cooldown.retryBlocked ||=c.retryBlocked;if(c.retryAt!==null)cooldown.retryAt=Math.max(cooldown.retryAt??0,c.retryAt);}throw e;}finally{f.active--;f.settled++;}};
 return {async begin(){f.auth.push('begin');binding={accountRef:crypto.randomUUID(),accountEpoch:1};return null;},async code(){},async password(){},getAccountBinding(){return binding;},getAccountCooldown(){return binding?Object.freeze({...cooldown}):null;},
 createSources(session){return sources??=createSourcesDriver(binding,session,{getDialogs:()=>read(()=>{f.pages++;return f.dialogs();}),invalidateSession:invalidate},f.clock);},
 createBotProviders(session){f.created++;return bots??=createBotProvidersDriver(binding,session,{async resolveIdentity(username){const result=await read(()=>{f.profiles++;return f.profile(username);});return {_: 'contacts.resolvedPeer',peer:{_: 'peerUser',userId:result.id??700001},chats:[],users:[{_: 'user',id:result.id??700001,bot:true,username:result.username,accessHash:new Long(123,0,false),firstName:'Bot sintético'}]};},invalidateSession:invalidate},f.clock);},
 async logout(){f.auth.push('logout');f.logoutActive=f.active;const ok=await bots?.quiesce();if(ok===false)throw Error('logout-unconfirmed');await sources?.quiesce();binding=null;},async close(){binding=null;sources?.close();bots?.close();f.destroy++;}};
}`;
const bundle=await build({configFile:false,root:artifacts,envDir:artifacts,publicDir:false,logLevel:'silent',plugins:[{name:'r131-sdk-fixture',enforce:'pre',resolveId(id){if(id==='./temporary-sdk')return '\0r131-sdk';},load(id){if(id==='\0r131-sdk')return sdk;}}],build:{write:false,minify:false,lib:{entry:resolve('src/telegram/session.worker.ts'),formats:['es']},rolldownOptions:{output:{codeSplitting:false}}}});
const chunks=(Array.isArray(bundle)?bundle:[bundle]).flatMap(r=>r.output).filter(r=>r.type==='chunk');assert.equal(chunks.length,1);
await writeFile(resolve(artifacts,'worker-VM-INJECTED.js'),chunks[0].code);
let externalNetwork=0,configFetches=0;const cases=[];
const tick=()=>new Promise(r=>setImmediate(r));
function setup(){
 let releaseProfile,rejectProfile,releasePage,rejectPage,closed=false;const messages=[],timers=new Set();
 const fixture={auth:[],profiles:0,pages:0,created:0,active:0,maxActive:0,settled:0,invalidated:0,destroy:0,logoutActive:null,deadline:null};
 fixture.profile=username=>new Promise((r,j)=>{releaseProfile=(id=700001)=>r({username,id});rejectProfile=j;});
 fixture.dialogs=()=>new Promise((r,j)=>{releasePage=()=>r({_: 'messages.dialogs',dialogs:[],chats:[],users:[],messages:[]});rejectPage=j;});
 fixture.clock={now:()=>Date.now(),setTimeout(fn,ms){if(ms===15000)fixture.deadline=fn;const t=setTimeout(()=>{timers.delete(t);fn();},ms===2000?30:ms===15000?1000:ms);timers.add(t);return t;},clearTimeout(t){clearTimeout(t);timers.delete(t);}};
 const self={onmessage:null,onmessageerror:null,postMessage(v){messages.push(JSON.parse(JSON.stringify(v)));},close(){closed=true;}};
 const context=vm.createContext({fixture,self,crypto:webcrypto,AbortController,TextDecoder,TextEncoder,setTimeout,clearTimeout,fetch:async url=>{assert.equal(url,'/telegram-config.json');configFetches++;return new Response(JSON.stringify({api_id:12345,api_hash:'0'.repeat(32)}));},WebSocket(){externalNetwork++;throw Error('Forbidden');}});
 vm.runInContext(chunks[0].code,context);const session=randomUUID();
 const send=c=>vm.runInContext(`self.onmessage({data:${JSON.stringify(c)}})`,context);
 return {fixture,messages,session,send,closed:()=>closed,
  async auth(){send({version:2,session,request:randomUUID(),type:'begin',value:'+15550000000'});await tick();const c=messages.at(-1);assert.equal(c.phase,'connected');return c;},
  bot(c,revision=0){return {protocol:'pulso-bot-providers',version:1,sessionId:session,...c.binding,providerRevision:revision,operationId:randomUUID(),requestId:randomUUID()};},
  source(c){return {protocol:'pulso-sources',version:1,sessionId:session,...c.binding,listEpoch:2,operationId:randomUUID(),requestId:randomUUID()};},
  releaseProfile:(id)=>releaseProfile(id),rejectProfile:e=>rejectProfile(e),releasePage:()=>releasePage(),rejectPage:e=>rejectPage(e),
  cleanup(){self.onmessageerror?.();for(const t of timers)clearTimeout(t);},
 };
}
async function run(label,fn){const s=setup();try{await fn(s);assert.ok(s.fixture.maxActive<=1);cases.push(label);}finally{s.cleanup();}}
await run('auth v2 exact bootstrap, lazy bots, explicit profile then CAS order and local remove',async s=>{
 const c=await s.auth();assert.equal(s.fixture.created,0);assert.equal(s.fixture.profiles,0);assert.equal(s.fixture.pages,0);assert.deepEqual(Object.keys(c).sort(),['binding','delivery','error','phase','request','retryAt','saved','session','version']);
 const e=s.bot(c);s.send({...e,type:'bots.validate',input:'alpha'});await tick();assert.equal(s.fixture.profiles,1);s.releaseProfile();await tick();const offer=s.messages.at(-1).reply.offer;assert.ok(offer);assert.equal(s.messages.at(-1).sessionClosed,false);
 s.send({...e,type:'bots.setOrder',requestId:randomUUID(),expectedRevision:0,providerRefs:[offer.providerRef]});await tick();assert.equal(s.messages.at(-1).reply.revision,1);assert.equal(s.fixture.profiles,1);
 s.send({...s.bot(c,1),type:'bots.setOrder',expectedRevision:1,providerRefs:[]});await tick();assert.equal(s.messages.at(-1).reply.revision,2);assert.equal(s.fixture.profiles,1);
});
await run('cancel ACK separate from terminal settlement; cancellation is not auth closure',async s=>{
 const c=await s.auth(),e=s.bot(c);s.send({...e,type:'bots.validate',input:'alpha'});await tick();s.send({...e,type:'bots.cancel',requestId:randomUUID(),targetRequestId:e.requestId});await tick();assert.equal(s.messages.at(-1).reply.type,'bots.cancelled');assert.equal(s.messages.some(m=>m.reply?.requestId===e.requestId),false);assert.equal(s.fixture.active,1);s.releaseProfile();await tick();const terminal=s.messages.find(m=>m.reply?.requestId===e.requestId);assert.equal(terminal.reply.error,'cancelled');assert.equal(terminal.sessionClosed,false);assert.equal(s.closed(),false);assert.equal(s.fixture.profiles,1);
});
await run('deadline timer before late success waits settlement and cannot validate or select',async s=>{
 const c=await s.auth(),e=s.bot(c);s.send({...e,type:'bots.validate',input:'alpha'});await tick();assert.equal(typeof s.fixture.deadline,'function');s.fixture.deadline();await tick();assert.equal(s.messages.some(m=>m.reply?.requestId===e.requestId),false);s.releaseProfile();await tick();const terminal=s.messages.find(m=>m.reply?.requestId===e.requestId);assert.equal(terminal.reply.error,'timeout');assert.equal(terminal.sessionClosed,false);assert.equal(s.fixture.profiles,1);
});
await run('late SESSION_REVOKED preserves cancelled first cause and forces binding closure',async s=>{
 const c=await s.auth(),e=s.bot(c);s.send({...e,type:'bots.validate',input:'alpha'});await tick();s.send({...e,type:'bots.cancel',requestId:randomUUID(),targetRequestId:e.requestId});await tick();s.rejectProfile({text:'SESSION_REVOKED'});await tick();const terminal=s.messages.find(m=>m.reply?.requestId===e.requestId);assert.equal(terminal.reply.error,'cancelled');assert.equal(terminal.sessionClosed,true);assert.equal(s.closed(),true);
});
for(const text of ['FLOOD_WAIT_172800','FLOOD_WAIT_UNKNOWN'])for(const direction of ['bot-to-source','source-to-bot'])await run(`${direction} late ${text} shared ledger before next RPC`,async s=>{
 const c=await s.auth(),isBot=direction==='bot-to-source',e=isBot?s.bot(c):s.source(c);
 s.send({...e,...(isBot?{type:'bots.validate',input:'alpha'}:{type:'sources.page',folder:'main',cursor:null})});await tick();
 s.send({...e,type:isBot?'bots.cancel':'sources.cancel',requestId:randomUUID(),targetRequestId:e.requestId});await tick();
 (isBot?s.rejectProfile:s.rejectPage)({text});await tick();
 const terminal=s.messages.find(m=>m.reply?.requestId===e.requestId);assert.equal(terminal.reply.error,'cancelled');assert.equal(terminal.sessionClosed,false);
 if(text.endsWith('172800'))assert.ok(terminal.reply.retryAt>Date.now()+86400000);else assert.equal(terminal.reply.retryBlocked,true);
 s.send(isBot?{...s.source(c),type:'sources.page',folder:'main',cursor:null}:{...s.bot(c),type:'bots.validate',input:'beta'});await tick();assert.equal(s.messages.at(-1).reply.error,'rate-limit');assert.equal(s.fixture.profiles,isBot?1:0);assert.equal(s.fixture.pages,isBot?0:1);
});
await run('logout quiesces bot lookup, keeps live binding after pool close, then exact auth logout',async s=>{
 const c=await s.auth(),e=s.bot(c);s.send({...e,type:'bots.validate',input:'alpha'});await tick();s.send({version:2,session:s.session,request:randomUUID(),type:'logout',value:''});await tick();assert.equal(s.fixture.auth.includes('logout'),false);s.releaseProfile();await tick();assert.equal(s.fixture.logoutActive,0);assert.equal(s.messages.find(m=>m.reply?.requestId===e.requestId).sessionClosed,false);assert.equal(s.messages.at(-1).phase,'disconnected');
});
await run('noncooperative SDK grace forces local closure without remote logout',async s=>{
 const c=await s.auth(),e=s.bot(c);s.send({...e,type:'bots.validate',input:'alpha'});await tick();s.send({version:2,session:s.session,request:randomUUID(),type:'logout',value:''});await new Promise(r=>setTimeout(r,50));assert.equal(s.closed(),true);assert.equal(s.fixture.auth.includes('logout'),false);assert.ok(s.messages.some(m=>m.error==='logout-unconfirmed'));s.releaseProfile();await tick();
});
for(const first of ['bot','source'])await run(`${first} RPC blocks other namespace in worker before second RPC`,async s=>{
 const c=await s.auth();s.send(first==='bot'?{...s.bot(c),type:'bots.validate',input:'alpha'}:{...s.source(c),type:'sources.page',folder:'main',cursor:null});await tick();s.send(first==='source'?{...s.bot(c),type:'bots.validate',input:'alpha'}:{...s.source(c),type:'sources.page',folder:'main',cursor:null});await tick();assert.equal(s.closed(),true);assert.equal(s.fixture.profiles+s.fixture.pages,1);if(first==='bot')s.releaseProfile();else s.releasePage();await tick();
});
await run('bot route closed parser rejects sixth ref, never casts to auth/source',async s=>{const c=await s.auth();s.send({...s.bot(c),type:'bots.setOrder',expectedRevision:0,providerRefs:Array.from({length:6},()=>randomUUID())});await tick();assert.equal(s.closed(),true);assert.equal(s.fixture.profiles+s.fixture.pages,0);});
assert.equal(externalNetwork,0);
const report={status:'PASS',cases,externalNetwork,configFetches,kind:'Real worker/core in Node VM; synthetic SDK factory implementing shared cooldown contract',clockInjection:'Core 15s→1000ms, grace2s→30ms TESTONLY; native ordering/deferred settlement',realTelegram:false,productBuild:false,cleanup:true};
await writeFile(resolve(artifacts,'worker-vm.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
