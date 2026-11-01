import {installWorkerDatabaseRealm,bindWorkerRealm,workerDatabaseRealmCurrent} from '../storage/database-realms';
/// <reference lib="webworker" />
import {copyWorkerRequest,createImportV2Handler} from './import-protocol';
import {workerFailureOutcome} from './import-outcome';
const handle=createImportV2Handler(response=>self.postMessage(response));
installWorkerDatabaseRealm('import');
self.onmessage=event=>{if(bindWorkerRealm('import',event))return;
 const request=copyWorkerRequest(event.data);
 if(!request||request.type==='recover')return;
 if(!workerDatabaseRealmCurrent()){self.postMessage({version:2,type:'error',operationId:request.operationId,outcome:workerFailureOutcome('worker-protocol',false)});return;}
 void handle(request).catch(()=>self.postMessage({version:2,type:'error',operationId:request.operationId,outcome:workerFailureOutcome('worker-failed')}));
};
