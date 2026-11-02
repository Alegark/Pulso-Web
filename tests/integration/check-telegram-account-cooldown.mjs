/** Isolated in-memory bundle: SDK/auth/crypto dependencies INJECTED; no Telegram client. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {build} from 'vite';
import Long from 'long';
import {User} from '../../node_modules/@mtcute/core/highlevel/types/peers/user.js';
const root=process.cwd(),artifactRoot=resolve(root,'.local/telegram-account-cooldown-parent');
const fixture={clients:[],users:[],send:[],authCalls:[],destroy:0};globalThis.__botProvidersCore=fixture;
const mockClient=`export class BaseTelegramClient { constructor(options){this.options=options;this.calls=[];globalThis.__botProvidersCore.clients.push(this);} async prepare(){} async call(request,options){this.calls.push({request,options});if(request._==='contacts.resolveUsername'){if(globalThis.__botProvidersCore.onIdentity)return globalThis.__botProvidersCore.onIdentity(request,options);throw Error('unexpected identity call');}if(request._==='messages.getDialogs'){if(globalThis.__botProvidersCore.onDialogs)return globalThis.__botProvidersCore.onDialogs(request,options);return {_: 'messages.dialogs',dialogs:[],chats:[],users:[],messages:[]};}return {};}async destroy(){globalThis.__botProvidersCore.destroy++;} }`;
const mockWeb=`export class WebPlatform{};export class WebSocketTransport{};export class MemoryStorage{}`;
const mockMethods=`const f=globalThis.__botProvidersCore;export async function sendCode(client,params){f.authCalls.push({type:'begin',params});return f.send.shift();}export async function signIn(client,params){f.authCalls.push({type:'code',params});return f.users.shift();}export async function checkPassword(client,params){f.authCalls.push({type:'password',params});return f.users.shift();}`;
const stubs=new Map([['@mtcute/core/client.js',mockClient],['@mtcute/web',mockWeb],['@mtcute/core/utils.js','export const LogManager={OFF:0};'],['@mtcute/core/methods.js',mockMethods],['@mtcute/wasm',`export const getWasmUrl=()=> 'https://fixture.invalid/test-only.wasm';`]]);
const output=await build({configFile:false,root:artifactRoot,envDir:artifactRoot,publicDir:false,logLevel:'silent',plugins:[{name:'test-only-sdk',enforce:'pre',resolveId(id){if(id==='long')return {id:import.meta.resolve('long'),external:true};if(stubs.has(id))return '\0fixture:'+id;if(id.endsWith('/crypto-provider')||id==='./crypto-provider')return '\0fixture:crypto';},load(id){if(process.env.PULSO_COOLDOWN_BASELINE&&id===resolve(root,'src/telegram/temporary-sdk.ts'))return readFileSync(process.env.PULSO_COOLDOWN_BASELINE,'utf8');if(id==='\0fixture:crypto')return 'export async function openCrypto(){return {}}';if(id.startsWith('\0fixture:'))return stubs.get(id.slice(9));}}],build:{write:false,minify:false,lib:{entry:resolve(root,'src/telegram/temporary-sdk.ts'),formats:['es'],fileName:'test-only'},rolldownOptions:{output:{codeSplitting:false}}}});
const chunks=(Array.isArray(output)?output:[output]).flatMap(x=>x.output).filter(x=>x.type==='chunk');assert.equal(chunks.length,1);
const oldFetch=globalThis.fetch,oldWS=globalThis.WebSocket,oldIDB=globalThis.indexedDB,oldLocal=globalThis.localStorage;
let wasmFetches=0,storageTouches=0,networkTouches=0;
globalThis.fetch=async url=>{assert.ok(url==='https://fixture.invalid/test-only.wasm','unexpected fetch blocked');wasmFetches++;return new Response(new Uint8Array([0,97,115,109,1,0,0,0]));};
globalThis.WebSocket=class {constructor(){networkTouches++;throw Error('Network forbidden');}};
Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open(){storageTouches++;throw Error('Storage forbidden');}}});
Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){storageTouches++;throw Error('Storage forbidden');}});

const drivers=[];let groups=0;
const signal=new AbortController().signal,nowOriginal=Date.now;let now=nowOriginal();Date.now=()=>now;
const tick=()=>new Promise(r=>setImmediate(r));
const {openTemporaryTelegram}=await import('data:text/javascript;base64,'+Buffer.from(chunks[0].code).toString('base64'));
async function open(){const d=await openTemporaryTelegram({apiId:12345,apiHash:'0'.repeat(32)},signal);drivers.push(d);fixture.send.push(new User({_: 'user',id:900001,self:true,firstName:'Synthetic'}));await d.begin('+15550000000',signal);const id=randomUUID();return {d,pool:d.createBotProviders(id),sources:d.createSources(id),client:fixture.clients.at(-1),id};}
const envelope=x=>({version:1,...x.d.getAccountBinding(),sessionId:x.id,operationId:randomUUID(),requestId:randomUUID()});
const bot=x=>({...envelope(x),protocol:'pulso-bot-providers',providerRevision:0,type:'bots.validate',input:'alpha'});
const page=x=>({...envelope(x),protocol:'pulso-sources',listEpoch:x.listEpoch=(x.listEpoch??0)+1,type:'sources.page',folder:'main',cursor:null});
const ctx={signal,current:()=>true};
try{
 // Real driver cancellation settles before late SDK failure; shared SDK ledger must survive.
 const x=await open();let reject;
 assert.equal(x.d.getAccountCooldown?.()??null,null);assert.equal(x.client.calls.length,0);
 fixture.onIdentity=()=>new Promise((_r,j)=>{reject=j;});
 const c=bot(x),reading=x.pool.handle(c,ctx);await tick();
 const {input:_input,...cancelBot}=c;assert.equal((await x.pool.handle({...cancelBot,type:'bots.cancel',requestId:randomUUID(),targetRequestId:c.requestId},ctx)).type,'bots.cancelled');
 assert.equal((await reading).error,'cancelled');reject({text:'FLOOD_WAIT_60'});assert.equal(await x.pool.whenSettled(),true);
 const count=x.client.calls.length;const denied=await x.sources.handle(page(x),ctx);assert.equal(denied.error,'rate-limit');assert.equal(x.client.calls.length,count);assert.ok(x.d.getAccountBinding());groups++;
 assert.deepEqual(x.d.getAccountCooldown?.(),{retryAt:now+60000,retryBlocked:false});assert.ok(Object.isFrozen(x.d.getAccountCooldown()));groups++;
 // No inherited wait in a new independent account adapter.
 const independent=await open();assert.equal(independent.d.getAccountCooldown?.(),null);groups++;
 // Expiration uses absolute clock, without running a timer callback. No automatic call.
 now+=60001;assert.equal(x.d.getAccountCooldown(),null);assert.equal(x.client.calls.length,count);
 fixture.onDialogs=async()=>({_: 'messages.dialogs',dialogs:[],chats:[],users:[],messages:[]});
 const allowed=await x.sources.handle(page(x),ctx);assert.equal(allowed.type,'sources.page');assert.equal(x.client.calls.length,count+1);groups++;
 // Reverse direction: late source FLOOD_WAIT gates profile validation.
 const y=await open();let rejectDialogs;fixture.onDialogs=()=>new Promise((_r,j)=>{rejectDialogs=j;});
 const sc=page(y),sourceRead=y.sources.handle(sc,ctx);await tick();
 const {folder:_folder,cursor:_cursor,...cancelSource}=sc;assert.equal((await y.sources.handle({...cancelSource,type:'sources.cancel',requestId:randomUUID(),targetRequestId:sc.requestId},ctx)).type,'sources.cancelled');
 assert.equal((await sourceRead).error,'cancelled');rejectDialogs({text:'FLOOD_WAIT_90'});assert.equal(await y.sources.whenSettled(),true);
 const yc=y.client.calls.length;const botDenied=await y.pool.handle(bot(y),ctx);assert.equal(botDenied.error,'rate-limit');assert.equal(y.client.calls.length,yc);assert.equal(y.d.getAccountCooldown().retryAt,now+90000);groups++;
 // Unknown wait stays conservative beyond arbitrary time, independent of order changes.
 const z=await open();fixture.onIdentity=async()=>{throw {text:'FLOOD_WAIT'};};
 assert.equal((await z.pool.handle(bot(z),ctx)).error,'rate-limit');assert.deepEqual(z.d.getAccountCooldown(),{retryAt:null,retryBlocked:true});
 now+=86400001;const zc=z.client.calls.length;assert.equal((await z.sources.handle(page(z),ctx)).error,'rate-limit');assert.equal(z.client.calls.length,zc);assert.deepEqual(z.d.getAccountCooldown(),{retryAt:null,retryBlocked:true});groups++;
 // A primary non-rate-limit failure does not invent a wait; close clears private snapshot.
 const n=await open();fixture.onIdentity=async()=>{throw {text:'USERNAME_NOT_OCCUPIED'};};assert.equal((await n.pool.handle(bot(n),ctx)).error,'unsupported');assert.equal(n.d.getAccountCooldown(),null);
 await z.d.close();assert.equal(z.d.getAccountCooldown(),null);assert.equal(z.d.getAccountBinding(),null);groups++;
 assert.equal(networkTouches,0);assert.equal(storageTouches,0);
 console.log(JSON.stringify({status:'PASS',groups,environment:'Node in-memory Vite, SDK/auth/crypto injected; actual source/profile drivers',firstCause:'cancelled preserved',lateFloodBothDirections:true,absoluteExpiry:true,unknownSticky:true,networkTouches,storageTouches,telegram:'NOT EXECUTED'}));
}finally{Date.now=nowOriginal;for(const d of drivers)await d.close();globalThis.fetch=oldFetch;globalThis.WebSocket=oldWS;Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:oldIDB});if(oldLocal===undefined)delete globalThis.localStorage;else Object.defineProperty(globalThis,'localStorage',{configurable:true,value:oldLocal});delete globalThis.__botProvidersCore;}
