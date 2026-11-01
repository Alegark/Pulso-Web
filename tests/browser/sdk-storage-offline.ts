// Isolated local experiment. No product entry imports this page.
export {};
declare global {interface Window {sdkStorageOffline:Promise<unknown>}}
let pageNetworkAttempts=0;
window.fetch=(()=>{pageNetworkAttempts++;return Promise.reject(Error('network-disabled'));}) as typeof fetch;
window.WebSocket=class {constructor(){pageNetworkAttempts++;throw Error('network-disabled');}} as unknown as typeof WebSocket;
window.sdkStorageOffline=new Promise(resolve=>{
 const worker=new Worker(new URL('./sdk-storage-offline.worker.ts',import.meta.url),{type:'module'});
 const timeout=setTimeout(()=>{worker.terminate();resolve({passed:false,failure:'worker-timeout',pageNetworkAttempts});},45000);
 worker.onmessage=e=>{clearTimeout(timeout);worker.terminate();resolve({...e.data,pageNetworkAttempts});};
 worker.onerror=e=>{e.preventDefault();clearTimeout(timeout);worker.terminate();resolve({passed:false,failure:'worker-error',pageNetworkAttempts});};
 worker.postMessage({run:true});
});
