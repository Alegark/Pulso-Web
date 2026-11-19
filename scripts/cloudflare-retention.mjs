import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const windowMs = 30 * 24 * 60 * 60 * 1000;
const minimumPrevious = 3;
const entryPattern = /^\/releases\/[a-f0-9]{16}\.html$/;
const shaPattern = /^[a-f0-9]{64}$/;
const pathPattern = /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const byPath = (a, b) => compare(a.path, b.path);
const newestFirst = (a, b) => compare(b.publishedAt, a.publishedAt) || compare(a.entry, b.entry);
export const sha256 = body => createHash('sha256').update(body).digest('hex');
export const immutablePath = path => path.startsWith('assets/') || entryPattern.test('/' + path);

function timestamp(value) {
  const ms = Date.parse(value);
  assert.ok(typeof value === 'string' && Number.isFinite(ms) && new Date(ms).toISOString() === value,
    'Fecha UTC inválida. Usa el formato ISO con milisegundos');
  return ms;
}

function inventory(files) {
  assert.ok(Array.isArray(files) && files.length > 0 && files.length <= 20000, 'Inventario de Cloudflare inválido');
  const indexed = new Map();
  for (const file of files) {
    assert.ok(file && typeof file.path === 'string' && pathPattern.test(file.path) &&
      !file.path.split('/').some(part => part === '.' || part === '..' ||
        part.startsWith('.env') || part === 'telegram-config.json') &&
      (!file.path.startsWith('releases/') || entryPattern.test('/' + file.path)), 'Ruta de asset inválida');
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 25 * 1024 * 1024 &&
      typeof file.sha256 === 'string' && shaPattern.test(file.sha256), `Integridad inválida: ${file.path}`);
    assert.ok(!indexed.has(file.path), `Ruta duplicada: ${file.path}`);
    indexed.set(file.path, file);
  }
  return indexed;
}

function listAssets(paths, files, covered) {
  assert.ok(Array.isArray(paths) && paths.length > 0 && new Set(paths).size === paths.length, 'Lista de assets inválida');
  for (const path of paths) {
    assert.ok(files.has(path) && immutablePath(path), `Asset de versión inválido o ausente: ${path}`);
    covered.add(path);
  }
}

function validate(manifest, {pending = false} = {}) {
  assert.equal(manifest.schemaVersion, 1, 'Esquema de procedencia desconocido');
  const files = inventory(manifest.files);
  const {currentEntry, releases, legacy} = manifest;
  assert.ok(typeof currentEntry === 'string' && entryPattern.test(currentEntry) && files.has(currentEntry.slice(1)),
    'Entrada actual inválida o ausente');
  assert.ok(Array.isArray(releases) && releases.length > 0, 'Faltan versiones en el manifiesto');
  const covered = new Set(), publications = new Set();
  let latest = '';
  for (const [index, release] of releases.entries()) {
    assert.ok(release && typeof release.entry === 'string' && entryPattern.test(release.entry), 'Entrada de versión inválida');
    listAssets(release.assets, files, covered);
    assert.ok(release.assets.includes(release.entry.slice(1)) &&
      release.assets.every(path => !path.startsWith('releases/') || path === release.entry.slice(1)),
      'La versión debe incluir su propio HTML');
    if (pending && index === 0) {
      assert.equal(release.publishedAt, null, 'El candidato aún no está publicado');
      continue;
    }
    timestamp(release.publishedAt);
    const key = JSON.stringify([release.entry, release.publishedAt]);
    assert.ok(!publications.has(key), 'Publicación duplicada');
    publications.add(key);
    if (release.publishedAt > latest) latest = release.publishedAt;
  }
  assert.equal(releases[0].entry, currentEntry, 'La primera versión debe ser la actual');
  if (!pending) assert.equal(releases[0].publishedAt, latest, 'La versión actual debe ser la más reciente');
  if (legacy !== undefined) {
    timestamp(legacy.lastPublishedAt);
    listAssets(legacy.assets, files, covered);
    assert.ok(legacy.assets.some(path => entryPattern.test('/' + path)), 'Faltan entradas en el inventario heredado');
  }
  for (const path of files.keys()) {
    assert.ok(!immutablePath(path) || covered.has(path), `Asset sin procedencia: ${path}`);
  }
  return files;
}

export function candidateManifest(currentEntry, files) {
  const manifest = {
    schemaVersion: 1,
    currentEntry,
    releases: [{entry: currentEntry, publishedAt: null, assets: files.map(file => file.path).filter(immutablePath).sort(compare)}],
    files: [...files].sort(byPath),
  };
  validate(manifest, {pending: true});
  return manifest;
}

export function planRetention({candidate, previous, legacyEvidence, asOf}) {
  const now = timestamp(asOf), cutoff = now - windowMs;
  const currentFiles = validate(candidate, {pending: true});
  assert.ok(candidate.releases.length === 1 && !Object.hasOwn(candidate, 'legacy'),
    'Se requiere un candidato limpio, antes del freeze');

  let previousFiles = new Map(), history = [], legacy;
  if (previous && !Object.hasOwn(previous, 'schemaVersion')) {
    assert.ok(Object.keys(previous).every(key => ['files', 'builtAt'].includes(key)) && legacyEvidence,
      'Un manifiesto sin procedencia requiere evidencia de la última publicación');
    previousFiles = inventory(previous.files);
    assert.ok(typeof legacyEvidence.entry === 'string' && entryPattern.test(legacyEvidence.entry) &&
      previousFiles.has(legacyEvidence.entry.slice(1)), 'La entrada pública heredada falta del inventario');
    legacy = {
      lastPublishedAt: legacyEvidence.publishedAt,
      assets: [...previousFiles.keys()].filter(immutablePath).sort(compare),
    };
  } else if (previous) {
    assert.ok(!legacyEvidence, 'El manifiesto ya registra procedencia');
    previousFiles = validate(previous);
    history = [...previous.releases].sort(newestFirst);
    legacy = previous.legacy;
  }

  const floor = new Set([candidate.currentEntry]);
  const retained = [];
  for (const release of history) {
    const age = timestamp(release.publishedAt);
    assert.ok(age <= now, 'Publicación posterior a la fecha de corte');
    const inFloor = floor.size <= minimumPrevious && !floor.has(release.entry);
    if (inFloor) floor.add(release.entry);
    if (inFloor || age >= cutoff) retained.push(release);
  }
  if (legacy) {
    const lastPublished = timestamp(legacy.lastPublishedAt);
    assert.ok(lastPublished <= now, 'Publicación heredada posterior a la fecha de corte');
    const newerEntries = new Set(retained.filter(release =>
      release.entry !== candidate.currentEntry && timestamp(release.publishedAt) > lastPublished).map(release => release.entry));
    if (lastPublished < cutoff && newerEntries.size >= minimumPrevious) legacy = undefined;
  }

  const keep = new Set([...retained.flatMap(release => release.assets), ...(legacy?.assets ?? [])]);
  const copy = [], retired = [];
  for (const file of [...previousFiles.values()].sort(byPath)) {
    const current = currentFiles.get(file.path);
    if (!immutablePath(file.path)) {
      assert.ok(current, `Falta una ruta estable en el candidato: ${file.path}`);
    } else if (current) {
      assert.ok(current.bytes === file.bytes && current.sha256 === file.sha256, `Colisión de asset inmutable: ${file.path}`);
    } else if (keep.has(file.path)) {
      copy.push(file);
    } else {
      retired.push(file);
    }
  }
  const manifest = {
    schemaVersion: 1,
    currentEntry: candidate.currentEntry,
    plannedAt: asOf,
    releases: [...candidate.releases, ...retained],
    ...(legacy && {legacy}),
    files: [...candidate.files, ...copy].sort(byPath),
  };
  validate(manifest, {pending: true});
  return {
    manifest,
    copy,
    retired,
    retiredBytes: retired.reduce((total, file) => total + file.bytes, 0),
  };
}

export function markPublished(manifest, publishedAt) {
  validate(manifest, {pending: true});
  assert.ok(timestamp(publishedAt) >= timestamp(manifest.plannedAt), 'Fecha de publicación anterior al freeze');
  const [current, ...history] = manifest.releases;
  const result = {...manifest, releases: [{...current, publishedAt}, ...history]};
  delete result.plannedAt;
  validate(result);
  return result;
}

export function verifyFile(file, body) {
  assert.ok(body.length === file.bytes && sha256(body) === file.sha256, `Bytes o SHA-256 distintos: ${file.path}`);
  return body;
}
