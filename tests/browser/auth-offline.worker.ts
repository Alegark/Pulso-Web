import {parseScope,record} from '../../src/telegram/auth-protocol';
import {AuthCoordinator,bindAuthPort,type OfflineAuthDriver} from '../../src/telegram/auth-state';
import {IndexedAuthScopeStore} from '../../src/telegram/auth-scope-store';
// Explicit synthetic driver in test entry ONLY. No SDK auth or network success claimed.
let externalAttempts=0,bound=false;
globalThis.fetch=(()=>{externalAttempts++;return Promise.reject(new Error('test-network-blocked'));}) as typeof fetch;
globalThis.WebSocket=class {constructor(){externalAttempts++;throw new Error('test-network-blocked');}} as unknown as typeof WebSocket;
const driver:OfflineAuthDriver={
 begin:async()=>({kind:'challenge',challenge:'SYNTHETIC_HASH_CANARY'}),
 code:async()=>({kind:'password-needed'}),
 password:async()=>({kind:'verified-user',accountId:'123456',isBot:false}),
 close:async()=>{},
};
globalThis.onmessage=event=>{
 if(record(event.data,['diagnostics'])&&event.data.diagnostics===true){globalThis.postMessage({externalAttempts});return;}
 const scope=record(event.data,['scope'])?parseScope(event.data.scope):null;
 if(bound||!scope||event.ports.length!==1){for(const p of event.ports)p.close();return;}
 bound=true;bindAuthPort(event.ports[0]!,new AuthCoordinator(scope,new IndexedAuthScopeStore(indexedDB),driver));
};
