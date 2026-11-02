/// <reference lib="webworker" />
import {openTemporaryTelegram} from '../../src/telegram/temporary-sdk';
import {decodeTelegramApiIdentity} from '../../src/telegram/api-identity';
declare const self:DedicatedWorkerGlobalScope;
let stage='configuration',external=0,idb=0,sockets=0;
const nativeFetch=fetch.bind(globalThis);
globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,self.location.href);if(u.origin!==self.location.origin){++external;throw Error('external-denied');}return nativeFetch(input,init);};
Object.defineProperty(globalThis,'WebSocket',{value:class {constructor(){++sockets;throw Error('network-denied');}},configurable:true});
Object.defineProperty(indexedDB,'open',{value:()=>{++idb;throw Error('unexpected-session-database');}});
self.onmessage=()=>{void (async()=>{try{
 const response=await fetch('/telegram-config.json',{cache:'no-store'});const identity=decodeTelegramApiIdentity(await response.text());if(!identity)throw Error('configuration');
 stage='real-sdk-memory-prepare';const driver=await openTemporaryTelegram(identity,new AbortController().signal);
 stage='release';const a=driver.close(),b=driver.close();if(a!==b)throw Error('release-not-shared');await a;
 self.postMessage({passed:true,realSdkConstructed:true,networkConnected:false,accountAuthenticated:false,memoryOnly:true,external,idb,sockets,releaseShared:true});
 }catch{self.postMessage({passed:false,stage,external,idb,sockets});}finally{self.close();}})();};
