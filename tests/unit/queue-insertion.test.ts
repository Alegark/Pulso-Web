import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Player,type Entry,type Media,type State} from '../../src/playback/player.ts';
import {planQueueInsertion,type InsertionRequest,type QueueStructure,type InsertionPlan} from '../../src/playback/queue-insertion.ts';

// Declared unit double: no browser/codec/audibility or native media claims.
class FakeMedia extends EventTarget implements Media {
  calls:string[]=[];
  registrations=new Map<string,EventListener[]>();
  active=new Map<string,Set<EventListener>>();
  private source='';private time=0;
  duration=50;ended=false;error:{code:number}|null=null;
  rejection:Promise<void>|null=null;
  get src(){return this.source;} set src(value:string){this.calls.push('src');this.source=value;}
  get currentTime(){return this.time;} set currentTime(value:number){this.calls.push('time');this.time=value;}
  play(){this.calls.push('play');return this.rejection??Promise.resolve();}
  pause(){this.calls.push('pause');}
  load(){this.calls.push('load');this.ended=false;this.time=0;}
  override addEventListener(type:string,listener:EventListener){
    this.calls.push('add:'+type);this.registrations.set(type,[...(this.registrations.get(type)??[]),listener]);
    const set=this.active.get(type)??new Set();set.add(listener);this.active.set(type,set);super.addEventListener(type,listener);
  }
  override removeEventListener(type:string,listener:EventListener){this.calls.push('remove:'+type);this.active.get(type)?.delete(listener);super.removeEventListener(type,listener);}
  event(type:string){this.dispatchEvent(new Event(type));}
}
const e=(id:string,trackId=id):Entry=>({id,trackId,title:trackId,src:`https://test.invalid/${id}`});
const originals=()=>[e('A1','A'),e('B','B'),e('A2','A')];
function setup(entries=originals(),admitted=()=>true){const audio=new FakeMedia();let observers=0;
 const player=new Player(audio,admitted,()=>{observers++;return ()=>{observers++;};});player.setQueue(entries);
 return {audio,player,observers:()=>observers};}
function request(player:Player,placement:'next'|'end'='end',entries=[e('X')],anchor:string|null=null):InsertionRequest {
 return {intentId:'intent',placement,entries,expectedQueueRevision:player.queueRevision,expectedQueueEpoch:player.queueEpoch,afterEntryId:anchor};
}
const structure=(currentEntryId:string|null='B',shuffleOrder:readonly string[]|null=null):QueueStructure=>({queueRevision:3,queueEpoch:2,entries:originals(),currentEntryId,shuffleOrder});
const req=(patch:Partial<InsertionRequest>={}):InsertionRequest=>({intentId:'intent',placement:'next',entries:[e('X','A'),e('Y','B')],expectedQueueRevision:3,expectedQueueEpoch:2,afterEntryId:'B',...patch});
function plan(s=structure(),r=req()):InsertionPlan {const result=planQueueInsertion(s,r);assert.equal(result.kind,'planned');if(result.kind!=='planned')throw Error('expected plan');return result.plan;}
const ids=(entries:readonly Entry[])=>entries.map(entry=>entry.id);
function snapshot(player:Player,audio:FakeMedia){return {structure:player.structure(),entries:player.entries,index:player.index,current:player.current,
 state:player.state,error:player.error,generation:player.generation,repeat:player.repeat,order:player.shuffleOrder,
 src:audio.src,time:audio.currentTime,ended:audio.ended,listeners:[...audio.active].map(([type,set])=>[type,[...set]])};}

test('pure planner: A/B/A occurrences, next/end and no-current prepend preserve old identities and inputs',()=>{
 for(const placement of ['next','end'] as const){const s=structure(),r=req({placement,afterEntryId:placement==='next'?'B':null});
  const before=structuredClone({s,r});const p=plan(s,r);
  assert.deepEqual(ids(p.entries),placement==='next'?['A1','B','X','Y','A2']:['A1','B','A2','X','Y']);
  assert.equal(p.index,1);assert.equal(p.currentEntryId,'B');assert.deepEqual(p.addedEntryIds,['X','Y']);
  for(const old of s.entries)assert.equal(p.entries.find(e=>e.id===old.id),old);
  assert.notEqual(p.entries,s.entries);assert.notEqual(p.entries.find(e=>e.id==='X'),r.entries[0]);
  assert.deepEqual({s,r},before);r.entries[0].title='caller changed';assert.equal(p.entries.find(e=>e.id==='X')!.title,'A');
 }
 const p=plan(structure(null),req({afterEntryId:null}));assert.deepEqual(ids(p.entries),['X','Y','A1','B','A2']);assert.equal(p.index,-1);
});
test('shuffle exact permutation/history and FIFO tail are retained in both orders without reshuffle',()=>{
 const s=structure('B',['A2','B','A1']),p=plan(s);
 assert.deepEqual(p.shuffleOrder,['A2','B','X','Y','A1']);assert.equal(p.index,1);assert.notEqual(p.shuffleOrder,s.shuffleOrder);
 const second=plan({...s,entries:p.entries,shuffleOrder:p.shuffleOrder},req({entries:[e('Z')],afterEntryId:'Y'}));
 assert.deepEqual(ids(second.entries),['A1','B','X','Y','Z','A2']);assert.deepEqual(second.shuffleOrder,['A2','B','X','Y','Z','A1']);
 const append=plan(s,req({placement:'end',afterEntryId:null}));assert.deepEqual(append.shuffleOrder,['A2','B','A1','X','Y']);
 assert.equal(new Set(second.shuffleOrder).size,second.entries.length);
});
test('invalid input/order/anchor fails closed, including impossible FIFO tail in either history',()=>{
 const rejected=(s:QueueStructure,r:InsertionRequest,reason:string)=>assert.deepEqual(planQueueInsertion(s,r),{kind:'rejected',reason});
 for(const patch of [{intentId:''},{intentId:'x'.repeat(257)},{placement:'other'},{expectedQueueRevision:NaN},{expectedQueueEpoch:-1},{entries:[]},
  {entries:[e('A1')]},{entries:[e('X'),e('X')]},{entries:[{...e('X'),src:''}]},{entries:[{...e('X'),title:'x'.repeat(4097)}]},
  {entries:[{...e('X'),trackId:'a\u0000'}]},{entries:[{...e('X'),id:'x'.repeat(257)}]},{entries:[{...e('X'),extra:'no'}]}])rejected(structure(),req(patch as Partial<InsertionRequest>),'invalid-input');
 for(const order of [[],['A1','A1','B'],['A1','B','missing'],['A1','B'],['A1','B',3]])rejected({...structure(),shuffleOrder:order as string[]},req(),'invalid-order');
 for(const [s,r]of [[structure(),req({afterEntryId:'missing'})],[structure(),req({afterEntryId:'A1'})],
  [structure('B',['A2','B','A1']),req({afterEntryId:'A2'})],[structure(),req({afterEntryId:null})],
  [structure(null),req()],[structure(),req({placement:'end'})],[structure('missing'),req()]] as const)rejected(s,r,'invalid-anchor');
 rejected({...structure(),entries:[e('A1'),e('A1')]},req(),'invalid-input');
});
test('data-only boundaries reject getters without invoking them, sparse arrays and throwing reflection',()=>{
 let invoked=0;const getter=()=>{invoked++;throw Error('must not execute');};
 const badEntry=Object.defineProperty(e('X'),'src',{get:getter});
 const badRequest=Object.defineProperty(req(),'afterEntryId',{get:getter});
 const badStructure=Object.defineProperty(structure(),'entries',{get:getter});
 const entries=[e('X')];Object.defineProperty(entries,'0',{get:getter});
 for(const [s,r]of [[structure(),req({entries:[badEntry]})],[structure(),badRequest],[badStructure,req()],
  [structure(),req({entries})],[structure(),req({entries:new Array(1)})],[structure(),null],
  [new Proxy({}, {getPrototypeOf(){throw Error('untrusted proxy');}}),req()]] as const)
  assert.deepEqual(planQueueInsertion(s as QueueStructure,r as InsertionRequest),{kind:'rejected',reason:'invalid-input'});
 assert.equal(invoked,0);
});
test('queue limits are inclusive at 1000, no partial insertion and no UUID format constraint',()=>{
 const entries=Array.from({length:999},(_,i)=>e(String(i)));
 const s={...structure(null),entries};assert.equal(plan(s,req({entries:[e('last')],placement:'end',afterEntryId:null})).entries.length,1000);
 assert.deepEqual(planQueueInsertion(s,req({entries:[e('X'),e('Y')],placement:'end',afterEntryId:null})),{kind:'rejected',reason:'limit-exceeded'});
 assert.equal(plan({...s,entries:[]},req({entries:Array.from({length:1000},(_,i)=>e(String(i))),afterEntryId:null})).entries.length,1000);
 assert.deepEqual(planQueueInsertion({...s,entries:[]},req({entries:Array.from({length:1001},(_,i)=>e(String(i))),afterEntryId:null})),{kind:'rejected',reason:'limit-exceeded'});
});
for(const state of ['paused','playing','loading','buffering','error','ended'] as State[])test(`Player insertion preserves media, listeners, error, modes and current in ${state}`,()=>{
 const {audio,player,observers}=setup();player.select(1);player.restoreModes('all',['A2','B','A1']);
 if(state==='paused')audio.event('pause');else if(state==='playing')audio.event('playing');else if(state==='buffering')audio.event('waiting');
 else if(state==='error'){audio.error={code:2};audio.event('error');}else if(state==='ended'){player.setRepeat('off');player.select(0);audio.ended=true;audio.event('ended');}
 assert.equal(player.state,state);audio.currentTime=12;const before=snapshot(player,audio),observed=observers();audio.calls=[];
 let emitted=0,installed=false;player.subscribe(()=>{emitted++;assert.equal(installed,true);assert.ok(player.entries.some(e=>e.id==='X'));});
 const result=player.insertQueue(request(player),p=>{assert.equal(p.currentEntryId,before.current.id);assert.equal(player.entries,before.entries);installed=true;return true;});
 assert.equal(result.kind,'inserted');assert.equal(emitted,1);assert.deepEqual(audio.calls,[]);assert.equal(observers(),observed);
 assert.equal(player.current,before.current);assert.equal(player.index,before.index);assert.equal(player.state,before.state);assert.equal(player.error,before.error);
 assert.equal(player.generation,before.generation);assert.equal(player.repeat,before.repeat);assert.deepEqual(player.shuffleOrder,['A2','B','A1','X']);
 assert.equal(audio.src,before.src);assert.equal(audio.currentTime,before.time);assert.equal(audio.ended,before.ended);
 assert.deepEqual([...audio.active].map(([type,set])=>[type,[...set]]),before.listeners);
 assert.equal(player.queueRevision,before.structure.queueRevision+1);assert.equal(player.queueEpoch,before.structure.queueEpoch);
});
test('insert before current in natural order derives current index by ID, explicit next keeps old semantics',()=>{
 const {player}=setup();player.select(2);player.setShuffle(true,()=>0);
 const anchor=player.current.id;assert.equal(player.insertQueue(request(player,'next',[e('X')],anchor),()=>true).kind,'inserted');
 assert.equal(player.current.id,anchor);player.next();assert.equal(player.current.id,'X');
 const {player:other}=setup();other.select(0);const stale=request(other,'next',[e('X')],'A1');other.select(1);
 // Same structure revision: root must re-resolve anchor after selection. Old anchor is now invalid.
 assert.deepEqual(other.insertQueue(stale,()=>true),{kind:'rejected',reason:'invalid-anchor'});
 assert.equal(other.insertQueue(request(other,'next',[e('X')],'B'),()=>true).kind,'inserted');other.next();assert.equal(other.current.id,'X');
});
test('vacancy insertion stays unselected and paused without source/load; first explicit Play selects zero',async()=>{
 const {audio,player}=setup([]);audio.calls=[];let emits=0;player.subscribe(()=>emits++);
 assert.equal(player.insertQueue(request(player,'next',[e('X')]),()=>true).kind,'inserted');
 assert.equal(emits,1);assert.equal(player.index,-1);assert.equal(player.current,undefined);assert.equal(player.state,'paused');assert.equal(audio.src,'');assert.deepEqual(audio.calls,[]);
 assert.equal(player.insertQueue(request(player,'next',[e('Y')]),()=>true).kind,'inserted');assert.deepEqual(ids(player.entries),['Y','X']);
 await player.play();assert.equal(player.current.id,'Y');assert.equal(audio.src,e('Y').src);assert.equal(audio.calls.filter(c=>c==='play').length,1);
});
test('insertion is all-or-nothing for stale, invalid, nonowner, suspended, hook false/throw and bad admission',()=>{
 let admitted=true;const {audio,player}=setup(originals(),()=>admitted);player.select(1);let emits=0,calls=0;player.subscribe(()=>emits++);
 const reject=(r:InsertionRequest,reason:string,hook=()=>{calls++;return true;})=>{
  const before=snapshot(player,audio),emitted=emits,called=calls;audio.calls=[];
  assert.deepEqual(player.insertQueue(r,hook),{kind:'rejected',reason});assert.deepEqual(snapshot(player,audio),before);
  assert.deepEqual(audio.calls,[]);assert.equal(emits,emitted);return called;
 };
 reject({...request(player),expectedQueueRevision:0},'stale-queue');reject({...request(player),expectedQueueEpoch:0},'stale-queue');
 reject(request(player,'end',[e('B')]),'invalid-input');assert.equal(calls,0);
 admitted=false;reject(request(player),'not-admitted');admitted=true;
 reject(request(player),'protection-rejected',()=>false);reject(request(player),'protection-rejected',()=>{throw Error('registry rejected');});
 assert.equal(player.insertQueue(request(player),()=>true).kind,'inserted');
 player.suspend();reject(request(player),'not-admitted');
 const throwing=new Player(new FakeMedia(),()=>{throw Error('owner');});assert.deepEqual(throwing.insertQueue(req(),()=>true),{kind:'rejected',reason:'not-admitted'});
});
test('private hook command reentry cannot mutate player or media; nested insert rejects and thrown mutation is contained',()=>{
 const {audio,player}=setup();player.select(1);const r=request(player);const before=snapshot(player,audio);audio.calls=[];
 let nested:unknown;assert.deepEqual(player.insertQueue(r,p=>{
  player.setQueue([]);player.select(0);void player.play();player.pause();player.seek(10);player.next();player.previous();
  player.setRepeat('all');player.setShuffle(true);player.restoreModes('all',null);player.moveEntry('A1',1);player.removeFuture('A2');player.suspend();
  nested=player.insertQueue(r,()=>true);assert.deepEqual(snapshot(player,audio),before);
  (p.addedEntryIds as string[]).push('tamper');return true;
 }),{kind:'rejected',reason:'protection-rejected'});
 assert.deepEqual(nested,{kind:'rejected',reason:'protection-rejected'});assert.deepEqual(snapshot(player,audio),before);assert.deepEqual(audio.calls,[]);
 assert.equal(player.insertQueue(r,()=>true).kind,'inserted');
});
test('CAS is repeated after admission immediately before the private hook',()=>{
 const audio=new FakeMedia();let turn=0,armed=false,player:Player;
 player=new Player(audio,()=>{if(armed&&++turn===2)player.moveEntry('A2',-1);return true;});player.setQueue(originals());player.select(0);
 const r=request(player);let hook=0;armed=true;
 assert.deepEqual(player.insertQueue(r,()=>{hook++;return true;}),{kind:'rejected',reason:'stale-queue'});assert.equal(hook,0);assert.deepEqual(ids(player.entries),['A1','A2','B']);
});
test('pending ended sees additions once; already consumed ended stays ended until explicit gesture',()=>{
 const {audio,player}=setup([e('A')]);player.select(0);const callback=audio.registrations.get('ended')![0],generation=player.generation;
 assert.equal(player.insertQueue(request(player),()=>true).kind,'inserted');audio.ended=true;callback(new Event('ended'));
 assert.equal(player.current.id,'X');assert.equal(player.generation,generation+1);audio.ended=true;callback(new Event('ended'));assert.equal(player.current.id,'X');
 const {audio:a,player:p}=setup([e('A')]);p.select(0);a.ended=true;a.event('ended');assert.equal(p.state,'ended');
 const ended=a.registrations.get('ended')![0];a.calls=[];assert.equal(p.insertQueue(request(p,'next',[e('X')],'A'),()=>true).kind,'inserted');
 ended(new Event('ended'));assert.equal(p.current.id,'A');assert.equal(p.state,'ended');assert.deepEqual(a.calls,[]);p.next();assert.equal(p.current.id,'X');
});
test('repeat one repeats current; repeat all wrap and previous history include inserted occurrences',()=>{
 const {audio,player}=setup([e('A'),e('B')]);player.select(0);player.setRepeat('one');player.insertQueue(request(player,'next',[e('X')],'A'),()=>true);
 audio.ended=true;audio.event('ended');assert.equal(player.current.id,'A');player.next();assert.equal(player.current.id,'X');
 player.setRepeat('all');player.setShuffle(true,()=>0);const order=[...player.shuffleOrder!];player.insertQueue(request(player,'end',[e('Y')]),()=>true);
 assert.deepEqual(player.shuffleOrder,[...order,'Y']);player.select(player.entries.findIndex(e=>e.id==='Y'));audio.ended=true;audio.event('ended');assert.equal(player.current.id,order[0]);
 player.select(player.entries.findIndex(e=>e.id==='Y'));audio.currentTime=0;player.previous();assert.equal(player.current.id,order.at(-1));
});
test('old play rejection still cannot affect a newer selection after insertion; current pending rejection remains current',async()=>{
 const {audio,player}=setup();player.select(0);let reject!:(e:Error)=>void;audio.rejection=new Promise((_,r)=>reject=r);
 const playing=player.play();player.insertQueue(request(player),()=>true);player.select(1);audio.rejection=null;reject(Error('old'));await playing;assert.equal(player.error,'');assert.equal(player.current.id,'B');
 audio.rejection=new Promise((_,r)=>reject=r);const current=player.play();player.insertQueue(request(player,'end',[e('Y')]),()=>true);
 reject(Error('current'));await current;assert.equal(player.state,'error');assert.notEqual(player.error,'');
});
test('revision tracks effective structure only; epoch tracks replacement/suspension, not media generation',async()=>{
 const {audio,player}=setup();assert.equal(player.queueRevision,1);assert.equal(player.queueEpoch,1);
 player.select(0);await player.play();audio.event('playing');audio.event('timeupdate');player.seek(4);player.pause();player.setRepeat('one');
 audio.ended=true;audio.event('ended');player.next();player.previous();assert.equal(player.queueRevision,1);assert.equal(player.queueEpoch,1);
 player.moveEntry('missing',1);player.moveEntry('A1',-1);player.removeFuture(player.current.id);player.removeFuture('missing');assert.equal(player.queueRevision,1);
 player.moveEntry('A2',-1);assert.equal(player.queueRevision,2);player.removeFuture('B');assert.equal(player.queueRevision,3);
 player.setShuffle(false);assert.equal(player.queueRevision,3);player.setShuffle(true,()=>0);assert.equal(player.queueRevision,4);
 const order=[...player.shuffleOrder!];player.restoreModes('all',order);assert.equal(player.queueRevision,4);
 player.restoreModes('one',[...order].reverse());assert.equal(player.queueRevision,5);player.restoreModes('off',null);assert.equal(player.queueRevision,6);
 player.setShuffle(false);assert.equal(player.queueRevision,6);assert.equal(player.queueEpoch,1);
 player.suspend();assert.equal(player.queueEpoch,2);assert.equal(player.queueRevision,6);
 player.setQueue([]);assert.equal(player.queueEpoch,3);assert.equal(player.queueRevision,7);
});
test('structure is a defensive immutable snapshot; output has derived index when current lies after splice',()=>{
 const {player}=setup();player.select(2);const s=player.structure();assert.notEqual(s.entries,player.entries);assert.notEqual(s.entries[0],player.entries[0]);
 assert.throws(()=>{s.entries[0].title='overwrite';});assert.equal(player.entries[0].title,'A');
 // A resolved tail after current can insert before other later natural entries; planner always derives index.
 const p=plan({...structure(),entries:originals(),currentEntryId:'A2'},req({afterEntryId:'A2'}));assert.equal(p.index,2);
});
test('Player 1000 bound rejects atomically before hook; next may target a still valid FIFO tail',()=>{
 const {audio,player}=setup(Array.from({length:999},(_,i)=>e(String(i))));player.select(900);const old=player.current;
 assert.equal(player.insertQueue(request(player,'next',[e('last')],'900'),()=>true).kind,'inserted');assert.equal(player.entries.length,1000);assert.equal(player.current,old);
 let calls=0,emits=0;player.subscribe(()=>emits++);const before=snapshot(player,audio);audio.calls=[];
 assert.deepEqual(player.insertQueue(request(player),()=>{calls++;return true;}),{kind:'rejected',reason:'limit-exceeded'});
 assert.deepEqual(snapshot(player,audio),before);assert.equal(calls,0);assert.equal(emits,0);assert.deepEqual(audio.calls,[]);
 const {player:p}=setup();p.select(1);p.restoreModes('off',['A2','B','A1']);
 p.insertQueue(request(p,'next',[e('X'),e('Y')],'B'),()=>true);p.insertQueue(request(p,'next',[e('Z')],'Y'),()=>true);
 assert.deepEqual(ids(p.entries),['A1','B','X','Y','Z','A2']);assert.deepEqual(p.shuffleOrder,['A2','B','X','Y','Z','A1']);
});

for(const field of ['id','trackId','title','src'] as const)test(`preserve validated nonenumerable ${field} in newly inserted entries`,()=>{
 const added=e('X'),expected={...added};Object.defineProperty(added,field,{value:added[field],enumerable:false});
 const {audio,player}=setup();player.select(0);const selected=player.current,before=snapshot(player,audio);audio.calls=[];
 const inserted=player.insertQueue(request(player,'end',[added]),()=>true);assert.equal(inserted.kind,'inserted');
 const actual=player.entries.at(-1)!;assert.deepEqual(actual,expected);assert.deepEqual(Reflect.ownKeys(actual),['id','trackId','title','src']);assert.equal(Object.isFrozen(actual),true);
 assert.equal(player.current,selected);assert.equal(player.generation,before.generation);assert.equal(audio.src,before.src);assert.equal(audio.currentTime,before.time);assert.deepEqual(audio.calls,[]);
 assert.equal(player.insertQueue(request(player,'end',[e('Y')]),()=>true).kind,'inserted');assert.equal(player.entries.at(-1)?.id,'Y');
});
