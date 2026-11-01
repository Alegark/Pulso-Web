const worker = new Worker(new URL('./sdk-worker.ts',import.meta.url),{type:'module'});
const requestId = crypto.randomUUID();
const timeout = setTimeout(()=>{document.querySelector('#result')!.textContent='FAIL timeout';worker.terminate();},15000);
worker.onmessage = async event => {
 if(event.data?.requestId!==requestId||event.data?.version!==1)return;
 clearTimeout(timeout);worker.terminate();
 const expected = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('pulso-web-public-preflight')))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const passed = event.data.digest===expected&&event.data.wasmOrigin===location.origin&&event.data.constructors?.every((x:string)=>x==='function');
 const result={passed,version:'0.32.7',workerProtocol:1,wasmSameOrigin:event.data.wasmOrigin===location.origin,sha256Match:event.data.digest===expected,telegramConnected:false,userAgent:navigator.userAgent};
 (window as unknown as {pulsoSdk:unknown}).pulsoSdk=result;
 document.querySelector('#result')!.textContent=(passed?'PASS':'FAIL')+' '+JSON.stringify(result,null,2);
};
worker.postMessage({version:1,type:'preflight',requestId});
