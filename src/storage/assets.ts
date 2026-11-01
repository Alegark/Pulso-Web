import {admittedTransaction,closeDatabase} from './database';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {committed, openDatabase, readRecord, request, writeRecord} from './database';
import {validFixture, validManifest} from './manifest';
export const CHUNK_SIZE = 64 * 1024;
export interface Fixture { id: string; file: string; mime: string; bytes: number; sha256: string }
export interface Manifest { id: string; namespace: 'local'; storageKey: string; bytes: number; sha256: string; mime: string; chunks: number; state: 'complete'; revision: number }
interface Job { operation: string; state: 'writing' | 'cancelled' | 'sealed'; chunks: number; bytes: number }
export class FixtureStore {
  // Primera implementación deliberadamente acotada a fixtures públicas con huella conocida.
  async save(fixture: Fixture, source: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Manifest> {
    if (!validFixture(fixture)) throw new Error('invalid-fixture');
    signal.throwIfAborted();
    const operation = crypto.randomUUID(); const hash = sha256.create(); let count = 0; let length = 0;
    const previous = await readRecord<Manifest>('assets', fixture.id);
    await writeRecord('jobs', operation, {operation, state: 'writing', chunks: 0, bytes: 0} satisfies Job);
    const reader = source.getReader();
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', abort, {once: true});
    try {
      while (true) {
        signal.throwIfAborted(); const {done, value} = await reader.read(); if (done) break;
        for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
          signal.throwIfAborted(); const bytes = value.slice(offset, offset + CHUNK_SIZE);
          if (length + bytes.length > fixture.bytes) throw new Error('integrity-length');
          hash.update(bytes); length += bytes.length;
          const db = await openDatabase();
          try {
            const tx = admittedTransaction(db,['chunks', 'jobs'], 'readwrite'); const complete = committed(tx);
            tx.objectStore('chunks').put(bytes, [operation, count++]);
            tx.objectStore('jobs').put({operation, state: 'writing', chunks: count, bytes: length} satisfies Job, operation);
            await complete;
          } finally { closeDatabase(db); }
        }
      }
      signal.throwIfAborted(); const digest = bytesToHex(hash.digest());
      if (length !== fixture.bytes || digest !== fixture.sha256) throw new Error('integrity');
      // Relectura independiente de los bytes persistidos antes de publicar.
      const verification = sha256.create(); let reread = 0;
      for (let i = 0; i < count; i++) { const bytes = await readRecord<Uint8Array>('chunks', [operation, i]); if (!bytes) throw new Error('integrity-missing'); verification.update(bytes); reread += bytes.length; }
      if (reread !== length || bytesToHex(verification.digest()) !== digest) throw new Error('integrity-readback');
      signal.throwIfAborted();
      const manifest: Manifest = {id: fixture.id, namespace: 'local', storageKey: operation, bytes: length, sha256: digest, mime: fixture.mime, chunks: count, state: 'complete', revision: (previous?.revision ?? 0) + 1};
      const db = await openDatabase();
      try {
        const tx = admittedTransaction(db,['assets', 'jobs'], 'readwrite'); const complete = committed(tx);
        const current = await request<Manifest | undefined>(tx.objectStore('assets').get(fixture.id));
        if ((current?.revision ?? 0) !== (previous?.revision ?? 0) || signal.aborted) { tx.abort(); await complete; throw new Error('write-conflict'); }
        tx.objectStore('assets').put(manifest, fixture.id);
        tx.objectStore('jobs').put({operation, state: 'sealed', chunks: count, bytes: length} satisfies Job, operation);
        await complete; return manifest;
      } finally { closeDatabase(db); }
    } catch (error) {
      // Fallo/commit incierto: conservar staging; jamás borrar una posible publicación.
      throw error;
    } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  }
  async verify(fixture: Fixture): Promise<Manifest | null> {
    const manifest = await readRecord<Manifest>('assets', fixture.id);
    if (!validManifest(manifest, fixture)) return null;
    const hash = sha256.create(); let length = 0;
    for (let i = 0; i < manifest.chunks; i++) {
      const bytes = await readRecord<Uint8Array>('chunks', [manifest.storageKey, i]); if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > CHUNK_SIZE) return null;
      length += bytes.length; if (length > manifest.bytes) return null; hash.update(bytes);
    }
    return length === manifest.bytes && bytesToHex(hash.digest()) === manifest.sha256 ? manifest : null;
  }
}
