import {installWorkerDatabaseRealm,bindWorkerRealm,workerDatabaseRealmCurrent} from '../storage/database-realms';
/// <reference lib="webworker" />
import {copyWorkerRequest,createRecoveryV2Handler} from './import-protocol';
import {workerFailureOutcome} from './import-outcome';
const handle=createRecoveryV2Handler(response=>self.postMessage(response),workerDatabaseRealmCurrent);
installWorkerDatabaseRealm('recovery');
self.onmessage=event=>{if(bindWorkerRealm('recovery',event))return;
 const request=copyWorkerRequest(event.data);
 if(!request||request.type!=='recover')return;
 if(!workerDatabaseRealmCurrent()){self.postMessage({version:2,type:'error',requestId:request.requestId,outcome:workerFailureOutcome('worker-protocol',false)});return;}
 void handle(request).catch(()=>self.postMessage({version:2,type:'error',requestId:request.requestId,outcome:workerFailureOutcome('worker-failed')}));
};
