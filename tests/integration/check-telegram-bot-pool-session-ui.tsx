/** Native React/client/worker composition. Only the worker's SDK boundary is synthetic. */
import {createRoot} from 'react-dom/client';
import {TelegramPanel} from '../../src/ui/TelegramPanel';
import {TelegramSessionClient} from '../../src/telegram/session-client';
import {Activity} from '../../src/playback/ownership';
import '../../src/style.css';
import '../../src/ui/shell.css';
const fixture={activity:new Activity(),available:true,generation:0,client:null as TelegramSessionClient|null,workers:[] as Worker[],messages:[] as unknown[],holdOrder:false,acks:[] as (()=>void)[],
 release(){const acks=this.acks.splice(0);for(const ack of acks)ack();},
 purge(){this.generation++;this.available=false;render();},restore(){this.available=true;render();},unmount(){root.unmount();}};
const begin=TelegramSessionClient.prototype.begin;
TelegramSessionClient.prototype.begin=function(phone){fixture.client=this;begin.call(this,phone);};
const NativeWorker=Worker;
class FixtureWorker extends NativeWorker {
 constructor(url:URL|string,options?:WorkerOptions){super(url,options);fixture.workers.push(this);
  const post=this.postMessage.bind(this);this.postMessage=(message:unknown)=>{fixture.messages.push(structuredClone(message));post(message);};
  let callback:((e:MessageEvent)=>void)|null=null;
  Object.defineProperty(this,'onmessage',{configurable:true,get:()=>callback,set:(value:typeof callback)=>{callback=value;}});
  this.addEventListener('message',e=>{const cb=callback;if(!cb)return;if(fixture.holdOrder&&e.data?.reply?.type==='bots.ordered')fixture.acks.push(()=>cb(e));else cb(e);});
 }
}
Object.defineProperty(globalThis,'Worker',{value:FixtureWorker,configurable:true});
Object.defineProperty(globalThis,'r131',{value:fixture});
const root=createRoot(document.getElementById('root')!);fixture.activity.open();
const capture=()=>{const epoch=fixture.generation,activity=fixture.activity.scope();return()=>epoch===fixture.generation&&activity()&&fixture.available;};
function render(){root.render(<><button id="outside">Control externo</button><TelegramPanel activity={fixture.activity} canConnect={fixture.available} scopeKey="r131-fixture" captureCurrent={capture} libraryPending/><button id="after">Después</button></>);}
render();
