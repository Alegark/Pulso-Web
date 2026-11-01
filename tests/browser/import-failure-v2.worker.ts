/// <reference lib="webworker" />
import {createImportV2Handler,createRecoveryV2Handler,copyWorkerRequest} from '../../src/imports/import-protocol';
const send=(response:unknown)=>self.postMessage(response);
const importing=createImportV2Handler(send),recovery=createRecoveryV2Handler(send);
self.onmessage=event=>{if(event.data?.type==='test-probe'){let calls=0;const getter={version:2,type:'cancel',operationId:event.data.id};Object.defineProperty(getter,'operationId',{get(){calls++;throw Error('PRIVATE_CANARY');}});const rejected=copyWorkerRequest(getter)===null;self.postMessage({type:'test-probed',rejected,calls});return;}if(event.data?.type==='test-init'){inject(event.data);return;}void importing(event.data).then(handled=>{if(!handled)return recovery(event.data);});};
function inject(params:{backend:string;fault:string}){
if(params.backend==='idb')Object.defineProperty(navigator.storage,'getDirectory',{value:undefined});
if(params.fault==='quota'){
 const put=IDBObjectStore.prototype.put;
 if(params.backend==='idb')IDBObjectStore.prototype.put=function(...args){if(this.name==='chunks')throw hostileQuota();return put.apply(this,args);};
 else FileSystemWritableFileStream.prototype.write=async function(){throw hostileQuota();};
}
if(params.fault==='close'){
 const close=FileSystemWritableFileStream.prototype.close;FileSystemWritableFileStream.prototype.close=async function(){await close.call(this);throw Error('PRIVATE_CANARY lost ACK');};
}

}

function hostileQuota(){const error=new DOMException('PRIVATE_CANARY raw cause','QuotaExceededError');for(const key of ['name','message','stack','cause'])Object.defineProperty(error,key,{get(){throw Error('PRIVATE_CANARY getter');}});return error;}
