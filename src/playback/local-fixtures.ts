import {fixtures} from '../fixtures';
import {FixtureStore} from '../storage/assets';
import type {Entry} from './player';
export async function offlineFixtures(download: boolean, signal: AbortSignal, ownerProof: string): Promise<Entry[]> {
  if (!navigator.serviceWorker || !navigator.locks) throw new Error('Este piloto necesita Service Worker y Web Locks.');
  await navigator.serviceWorker.register('/sw.js', {type:'module'});
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', listener); reject(new Error('Recarga para activar el transporte local.')); }, 10000);
    const listener = () => { clearTimeout(timer); resolve(); }; navigator.serviceWorker.addEventListener('controllerchange', listener, {once:true});
  });
  const store = new FixtureStore();
  for (const fixture of fixtures) {
    signal.throwIfAborted();
    if (await store.verify(fixture)) continue;
    if (!download) throw new Error('Fixtures incompletas. Prepara los audios con conexión antes de probar offline.');
    const response = await fetch(fixture.file, {signal});
    if (!response.ok || !response.body) throw new Error('No se pudieron obtener las fixtures.');
    await store.save(fixture, response.body, signal);
  }
  signal.throwIfAborted();
  const channel = new MessageChannel();
  const tokens = await new Promise<string[]>((resolve,reject) => {
    const timer = window.setTimeout(() => { channel.port1.close(); reject(new Error('El transporte no respondió.')); },10000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); if (event.data?.version === 1 && Array.isArray(event.data.tokens)) resolve(event.data.tokens); else reject(new Error(event.data?.error ?? 'Protocolo incompatible.')); };
    navigator.serviceWorker.controller!.postMessage({version:1,type:'fixture-tickets',ownerProof,assetIds:fixtures.map(f => f.id)},[channel.port2]);
  });
  return fixtures.map((f,i) => ({id:crypto.randomUUID(),trackId:f.id,title:`Tono sintético ${'ABC'[i]} · ${f.mime === 'audio/mp4' ? 'AAC-LC' : 'MP3'}`,src:new URL(`/_pulso/media/${tokens[i]}`,location.origin).href}));
}
