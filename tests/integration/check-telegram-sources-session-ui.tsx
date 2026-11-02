/** TESTONLY UI entry: synthetic Worker responses, no SDK/config/Telegram. */
import React from 'react';
import {createRoot} from 'react-dom/client';
import {TelegramPanel} from '../../src/ui/TelegramPanel';
import {Activity} from '../../src/playback/ownership';
import type {SessionCommand} from '../../src/telegram/session-protocol';
import type {SourcesCommand,SourceRow} from '../../src/telegram/sources-protocol';
import '../../src/style.css';
import '../../src/ui/shell.css';
const id=()=>crypto.randomUUID();
const saved=():SourceRow=>({peerRef:id(),kind:'saved',name:'Mensajes guardados'});
class SyntheticWorker {
 onmessage:((event:MessageEvent)=>void)|null=null;onerror=null;onmessageerror=null;
 binding={accountRef:id(),accountEpoch:1};saved=saved();messages:(SessionCommand|SourcesCommand)[]=[];held:SourcesCommand|null=null;terminations=0;
 constructor(){fixture.workers.push(this);}
 terminate(){this.terminations++;}
 postMessage(command:SessionCommand|SourcesCommand){this.messages.push(command);if('session'in command){const phase=command.type==='begin'?'code':command.type==='code'?'password':command.type==='password'?'connected':'disconnected';queueMicrotask(()=>this.onmessage?.({data:{version:2,session:command.session,request:command.request,phase,error:null,retryAt:null,delivery:phase==='code'?'app':null,binding:phase==='connected'?this.binding:null,saved:phase==='connected'?this.saved:null}} as MessageEvent));return;}
 const c=command;
 if(c.type==='sources.page'){if(c.cursor===null)this.saved=saved();this.held=c;if(!fixture.hold)this.release();}
 else if(c.type==='sources.select')this.source(c,{type:'sources.selected',revision:++fixture.revision,peerRefs:c.peerRefs});
 else if(c.type==='sources.clear')this.source(c,{type:'sources.cleared',revision:++fixture.revision});
 else {this.source(c,{type:'sources.cancelled',targetRequestId:c.targetRequestId});if(this.held){this.source(this.held,{type:'sources.error',error:'cancelled',retryAt:null,retryBlocked:false});this.held=null;}}
 }
 source(command:SourcesCommand,fields:Record<string,unknown>){const {protocol,version,sessionId,accountRef,accountEpoch,listEpoch,operationId,requestId}=command;queueMicrotask(()=>this.onmessage?.({data:{protocol,version,reply:{protocol,version,sessionId,accountRef,accountEpoch,listEpoch,operationId,requestId,...fields},saved:this.saved,sessionClosed:false}} as MessageEvent));}
 release(){const c=this.held;if(!c||c.type!=='sources.page')return;this.held=null;const rows:SourceRow[]=[{peerRef:id(),kind:'channel',name:fixture.title}];this.source(c,{type:'sources.page',folder:c.folder,items:c.cursor===null?[this.saved,...rows]:rows,cursor:c.cursor===null?id():null,end:c.cursor===null?'more':'exhausted'});}
}
const fixture={workers:[] as SyntheticWorker[],hold:false,revision:0,title:('<img src=x onerror=alert(1)> https://example.invalid/ '+ 'Fuente ficticia extensa '.repeat(4)).trim(),generation:0,available:true,activity:new Activity(),purge(){this.generation++;this.available=false;render();},restore(){this.available=true;render();},unmount(){root.unmount();}};
Object.defineProperty(globalThis,'Worker',{value:SyntheticWorker,configurable:true});
Object.defineProperty(globalThis,'testSourcesSession',{value:fixture});
const root=createRoot(document.getElementById('root')!);fixture.activity.open();
const capture=()=>{const generation=fixture.generation,scope=fixture.activity.scope();return()=>generation===fixture.generation&&scope()&&fixture.available;};
function render(){root.render(<><button id="outside">Control externo de prueba</button><TelegramPanel activity={fixture.activity} canConnect={fixture.available} scopeKey="TESTONLY" captureCurrent={capture} libraryPending/><button id="after">Después del panel</button></>);}
render();
