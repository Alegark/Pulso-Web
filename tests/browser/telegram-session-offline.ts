const worker=new Worker(new URL('./session.worker-offline.ts',import.meta.url),{type:'module'});
worker.onmessage=event=>{Object.assign(globalThis,{telegramOfflineResult:event.data});worker.terminate();};
worker.onerror=()=>{Object.assign(globalThis,{telegramOfflineResult:{passed:false,stage:'worker-error'}});worker.terminate();};
worker.postMessage('prepare-only');
