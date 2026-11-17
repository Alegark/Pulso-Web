import {ACTIVE_LIBRARY_ACCOUNT} from '../accounts/library-local';
import {WRITER_LOCK} from '../storage/asset-reader';
import {admittedTransaction, closeDatabase, openExistingDatabase, readRecord, request} from '../storage/database';
import {transactionDone} from '../storage/transaction-done';
import type {CatalogArtist} from './album-catalog';
import {musicBrainzId} from './catalog-id';

const LIMIT = 500;
const key = (accountId: string) => ['saved-catalog-artists', 1, accountId];

function validArtist(value: unknown): value is CatalogArtist {
 if (!value || typeof value !== 'object' || !('id' in value) || !('name' in value)) return false;
 return (musicBrainzId(value.id) || typeof value.id === 'number' && Number.isSafeInteger(value.id) && value.id > 0)
  && typeof value.name === 'string' && !!value.name.trim() && value.name.length <= 300;
}

function savedArtists(value: unknown): CatalogArtist[] {
 if (value === undefined) return [];
 if (!Array.isArray(value) || value.length > LIMIT || !value.every(validArtist)
  || new Set(value.map(artist => artist.id)).size !== value.length) throw Error('saved-artists');
 return value.map(({id,name}) => ({id,name}));
}

export async function readSavedArtists(accountId: string): Promise<CatalogArtist[]> {
 return savedArtists(await readRecord('settings', key(accountId)));
}

export async function setSavedArtist(accountId: string, artist: CatalogArtist, save: boolean, current: () => boolean): Promise<CatalogArtist[]> {
 if (!current() || !validArtist(artist)) throw Error('saved-artist');
 return navigator.locks.request(WRITER_LOCK, async () => {
  if (!current()) throw Error('account-changed');
  const db = await openExistingDatabase();
  try {
   const tx = admittedTransaction(db, ['settings'], 'readwrite');
   const done = transactionDone(tx);
   try {
    const settings = tx.objectStore('settings');
    const [active, raw] = await Promise.all([request(settings.get(ACTIVE_LIBRARY_ACCOUNT)), request(settings.get(key(accountId)))]);
    if (!current() || active !== accountId) throw Error('account-changed');
    const rows = savedArtists(raw);
    const existing = rows.find(row => row.id === artist.id);
    if (save && !existing && rows.length >= LIMIT) throw Error('saved-artist-limit');
    const next = save ? (existing ? rows : [...rows, {id:artist.id,name:artist.name}]) : rows.filter(row => row.id !== artist.id);
    if (next !== rows && (save || existing)) settings.put(next, key(accountId));
    await done;
    return next;
   } catch (error) {
    try { tx.abort(); } catch { /* Transaction already settled. */ }
    await done.catch(() => {});
    throw error;
   }
  } finally {
   closeDatabase(db);
  }
 });
}
