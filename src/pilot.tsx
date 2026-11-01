import React from 'react';
import {createRoot} from 'react-dom/client';
import {Player} from './playback/player';
import './style.css';
import {offlineFixtures} from './playback/local-fixtures';
import {readRecord, writeRecord} from './storage/database';
const audio = new Audio();
audio.preload = 'metadata';
const player = new Player(audio);
let preparation = '';
let preparing = false;
let abortPreparation: AbortController | null = null;
async function prepare(download: boolean) {
  if (!owner || preparing) return;
  preparing = true; preparation = 'Verificando archivos…'; player.pause(); window.dispatchEvent(new Event('pulso-owner'));
  const operation = new AbortController(); abortPreparation = operation;
  try { const entries = await offlineFixtures(download, operation.signal, ownerProof); operation.signal.throwIfAborted();
    const saved = !download ? await readRecord<{version: number; trackId: string; index: number; position: number}>('settings', 'fixture-playback') : null;
    player.setQueue(entries);
    if (saved?.version === 1 && Number.isInteger(saved.index) && entries[saved.index]?.trackId === saved.trackId && Number.isFinite(saved.position) && saved.position >= 0) player.select(saved.index, false, saved.position);
    preparation = 'Tres archivos completos verificados. Cola pausada; pulsa Reproducir.'; }
  catch (error) { preparation = operation.signal.aborted ? 'Preparación cancelada. Se conservan archivos ya publicados.' : error instanceof Error ? error.message : 'Almacenamiento no disponible.'; }
  finally { preparing = false; abortPreparation = null; window.dispatchEvent(new Event('pulso-owner')); }
}
player.setQueue(['A', 'B', 'C'].map((name, i) => ({id: `occurrence-${i}`, trackId: `fixture-${name}`, title: `Tono sintético ${name}`, src: new URL(`fixtures/${name}.wav`, document.baseURI).href})));
let lastSave = 0;
let writes = Promise.resolve();
player.subscribe(() => {
  if (!owner || preparing || !player.current || !player.current.src.includes('/_pulso/media/')) return;
  if (player.state === 'playing' && Date.now() - lastSave < 2000) return;
  lastSave = Date.now();
  const saved = {version: 1, trackId: player.current.trackId, index: player.index, position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0};
  writes = writes.then(() => writeRecord('settings', 'fixture-playback', saved)).catch(() => { preparation = 'No se pudo guardar la posición. Los audios y la cola activa se conservan.'; });
});
let owner = false;
const ownerProof = `pulso-web:local:owner:${crypto.randomUUID()}`;
if (navigator.locks) {
  void navigator.locks.request('pulso-web:local:playback', {ifAvailable: true}, async lock => {
    if (!lock) return;
    await navigator.locks.request(ownerProof, async () => {
      owner = true; void prepare(false); window.dispatchEvent(new Event('pulso-owner'));
      await new Promise<void>(() => {});
    });
  });
}
if ('mediaSession' in navigator) {
  const actions = {play: () => { if (owner) void player.play(); }, pause: () => player.pause(), nexttrack: () => { if (owner) player.next(); }, previoustrack: () => { if (owner) player.previous(); }, seekto: (d: MediaSessionActionDetails) => { if (d.seekTime !== undefined) player.seek(d.seekTime); }};
  for (const [action, fn] of Object.entries(actions)) { try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, fn); } catch { /* Capacidad opcional */ } }
  player.subscribe(() => {
    if (!owner) return;
    navigator.mediaSession.metadata = player.current ? new MediaMetadata({title: player.current.title, artist: 'Pulso · fixture sintética'}) : null;
    navigator.mediaSession.playbackState = player.state === 'playing' ? 'playing' : 'paused';
  });
}
function App() {
  const [, update] = React.useReducer(n => n + 1, 0);
  React.useEffect(() => { const off = player.subscribe(update); window.addEventListener('pulso-owner', update); return () => { off(); window.removeEventListener('pulso-owner', update); }; }, []);
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  return <main><p>PULSO WEB · T2</p><h1>Piloto de audio local</h1><p>Tres archivos sintéticos de 4 segundos. Preparación offline experimental, separada de tu futura biblioteca.</p><section aria-label="Transporte local"><button disabled={!owner || preparing} onClick={() => void prepare(true)}>Preparar audios offline</button><button disabled={!preparing} onClick={() => abortPreparation?.abort()}>Cancelar preparación</button><p role="status">{preparation}</p></section>
    <section aria-label="Reproductor"><h2>{player.current?.title ?? 'Elige una pista'}</h2><p role="status">{player.state}{player.error && ` · ${player.error}`}</p>
      <div className="controls"><button disabled={!owner || preparing} onClick={() => player.previous()}>Anterior</button><button disabled={!owner || preparing} onClick={() => void player.play()}>Reproducir</button><button onClick={() => player.pause()}>Pausar</button><button disabled={!owner || preparing || player.index === 2} onClick={() => player.next()}>Siguiente</button></div>
      <label>Posición: {audio.currentTime.toFixed(1)} / {duration.toFixed(1)} s<input aria-label="Posición en segundos" type="range" min="0" max={duration} step="0.1" value={Math.min(audio.currentTime, duration)} disabled={!owner || !duration} onChange={e => player.seek(Number(e.target.value))}/></label>
    </section><section><h2>Cola de prueba</h2><ol>{player.entries.map((entry, i) => <li key={entry.id}><button disabled={!owner || preparing} aria-current={player.index === i ? 'true' : undefined} onClick={() => player.select(i, true)}>{entry.title}</button></li>)}</ol></section>
    {!owner && <p role="status">Reproducción bloqueada: esperando exclusión de pestaña o Web Locks no disponible. No se toma control automáticamente.</p>}
    <p>iPhone bloqueado: NO EJECUTADO. Este piloto no acredita aceptación móvil. Telegram no está conectado.</p>
    <details><summary>Capacidades detectadas</summary><p>Contexto seguro: {String(isSecureContext)} · Media Session: {String('mediaSession' in navigator)} · Web Locks: {String(!!navigator.locks)} · OPFS: {String(!!navigator.storage?.getDirectory)} · Service Worker: {String('serviceWorker' in navigator)}</p></details>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
