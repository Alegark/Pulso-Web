/// <reference lib="webworker" />
import {BaseTelegramClient, TelegramWorker, TelegramWorkerPort, WebCryptoProvider} from '@mtcute/web';
import wasmUrl from '@mtcute/wasm/mtcute.wasm?url';
// Preflight de bundle/worker/WASM únicamente: no cliente, sesión, socket ni credencial.
self.onmessage = async event => {
  if (event.data?.version !== 1 || event.data?.type !== 'preflight' || typeof event.data.requestId !== 'string') return;
  try {
    const crypto = new WebCryptoProvider({wasmInput: wasmUrl});
    await crypto.initialize();
    const digest = Array.from(crypto.sha256(new TextEncoder().encode('pulso-web-public-preflight'))).map(x=>x.toString(16).padStart(2,'0')).join('');
    self.postMessage({version:1,requestId:event.data.requestId,digest,constructors:[BaseTelegramClient,TelegramWorker,TelegramWorkerPort].map(x=>typeof x),wasmOrigin:new URL(wasmUrl,location.href).origin});
  } catch { self.postMessage({version:1,requestId:event.data.requestId,error:'sdk-preflight-failed'}); }
};
