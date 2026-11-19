import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {candidateManifest, markPublished, planRetention, sha256} from '../../scripts/cloudflare-retention.mjs';
import {freezeSite} from '../../scripts/prepare-cloudflare.mjs';

const now = '2026-11-18T23:50:00.000Z';
const daysAgo = days => new Date(Date.parse(now) - days * 86400000).toISOString();
const entry = id => '/releases/' + String(id).padStart(16, '0') + '.html';
const path = id => entry(id).slice(1);
const record = (path, text = path) => ({path, bytes: Buffer.byteLength(text), sha256: sha256(text)});
const shared = 'assets/font-shared.woff2';
const stable = ['sw.js', 'latest.json', 'THIRD-PARTY-NOTICES.txt', 'third-party-licenses.json', 'telegram-sources.tar.gz'];
const assets = id => [path(id), shared, `assets/index-${id}.js`, `assets/lazy-${id}.css`, `assets/mtcute-${id}.wasm`];
const draft = (id, extra = []) => candidateManifest(entry(id), [...assets(id), ...stable, ...extra]
  .map(name => record(name, name === 'latest.json' ? JSON.stringify({version: 1, entry: entry(id)}) : name)));
const release = (id, age) => ({entry: entry(id), publishedAt: daysAgo(age), assets: assets(id)});
const published = (releases, legacy) => ({
  schemaVersion: 1, currentEntry: releases[0].entry, releases, ...(legacy && {legacy}),
  files: [...new Set([...stable, ...releases.flatMap(item => item.assets), ...(legacy?.assets ?? [])])].map(name => record(name)),
});
const retirement = (candidate, previous, legacyEvidence) => planRetention({candidate, previous, legacyEvidence, asOf: now});

test('conserva todas las publicaciones de los últimos 30 días, incluido el límite exacto', () => {
  const history = [release(6, 1), release(5, 2), release(4, 3), release(3, 30), release(2, 31), release(1, 32)];
  const plan = retirement(draft(7), published(history));
  assert.deepEqual(plan.manifest.releases.map(item => item.entry), [7, 6, 5, 4, 3].map(entry));
  const expected = [...assets(2), ...assets(1)].filter(name => name !== shared).sort().map(name => record(name));
  assert.deepEqual(plan.retired, expected);
  assert.equal(plan.retiredBytes, expected.reduce((sum, file) => sum + file.bytes, 0));
  assert.ok(plan.manifest.files.some(file => file.path === shared));
  assert.deepEqual(retirement(draft(7), published(history)), plan);
});

test('el mínimo cuenta tres HTML distintos y permite volver a publicar la entrada actual', () => {
  const history = [release(5, 31), release(5, 32), release(4, 33), release(3, 34), release(2, 35), release(1, 36)];
  const plan = retirement(draft(5), published(history));
  assert.deepEqual(plan.manifest.releases.map(item => item.entry), [5, 4, 3, 2].map(entry));
  assert.ok(!plan.retired.some(file => file.path === path(5)));
  assert.equal(markPublished(plan.manifest, now).releases[0].publishedAt, now);
  assert.ok(!Object.hasOwn(markPublished(plan.manifest, now), 'plannedAt'));
});

test('el legado se conserva por la fecha límite y hasta conocer tres entradas anteriores más nuevas', () => {
  const oldAssets = [...new Set([...assets(1), ...assets(2)])];
  const previous = {files: [...oldAssets, ...stable].map(name => record(name))};
  const evidence = {entry: entry(2), publishedAt: daysAgo(60)};
  const first = retirement(draft(3), previous, evidence);
  assert.deepEqual(first.retired, []);
  assert.deepEqual(first.manifest.legacy.assets, oldAssets.sort());
  const stillNeeded = retirement(draft(5), published([release(4, 38), release(3, 40)], first.manifest.legacy));
  assert.deepEqual(stillNeeded.retired, []);
  const dated = [release(5, 35), release(4, 38), release(3, 40)];
  const expired = retirement(draft(6), published(dated, first.manifest.legacy));
  assert.ok(expired.retired.some(file => file.path === path(1)));
  assert.ok(!expired.retired.some(file => file.path === shared));
  assert.equal(expired.manifest.legacy, undefined);
  const recent = retirement(draft(6), published([release(5, 1), release(4, 2), release(3, 3)],
    {...first.manifest.legacy, lastPublishedAt: daysAgo(30)}));
  assert.deepEqual(recent.retired, []);
});

test('rechaza inventarios corruptos, procedencia incompleta y colisiones', () => {
  const good = published([release(1, 1)]);
  for (const [damaged, error] of [
    [{files: good.files}, /requiere evidencia/],
    [{...good, schemaVersion: 42}, /Esquema/],
    [{...good, files: [...good.files, good.files[0]]}, /duplicada/],
    [{...good, files: [...good.files, record('assets/../a')]}, /Ruta/],
    [{...good, files: [...good.files, record('assets/unowned.js')]}, /sin procedencia/],
    [{...good, releases: [{...good.releases[0], assets: [...assets(1), 'assets/missing.js']}]}, /ausente/],
    [{...good, releases: [release(1, -1)]}, /posterior/],
    [{...good, files: good.files.map(file => file.path === shared ? record(shared, 'changed') : file)}, /Colisión/],
    [{...good, files: good.files.map(file => file.path === shared ? {...file, sha256: 'invalid'} : file)}, /Integridad/],
  ]) assert.throws(() => retirement(draft(2), damaged), error);
  const candidate = draft(2);
  candidate.files = candidate.files.filter(file => file.path !== 'sw.js');
  assert.throws(() => retirement(candidate, good), /ruta estable/);
});

test('freeze copia los bytes verificados y revierte el staging ante un SHA distinto', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'pulso-retention-'));
  const directory = join(temporary, 'site'), output = join(temporary, 'frozen.json');
  const candidate = draft(5), previous = published([release(4, 1), release(3, 2), release(2, 3), release(1, 31)]);
  const pathToFile = file => join(directory, file.path);
  const body = file => Buffer.from(file.path === 'latest.json'
    ? JSON.stringify({version: 1, entry: candidate.currentEntry}) : file.path);
  const config = {directory, output, asOf: now, candidate, previous};
  try {
    for (const file of candidate.files) {
      await mkdir(dirname(pathToFile(file)), {recursive: true});
      await writeFile(pathToFile(file), body(file));
    }
    const plan = await freezeSite({...config, dryRun: true, loadPrevious: () => assert.fail('La simulación es local')});
    assert.ok(plan.retired.some(file => file.path === path(1)));
    const failedFile = plan.copy[1];
    await assert.rejects(freezeSite({...config, loadPrevious: async file => file === failedFile
      ? Buffer.alloc(file.bytes, 65) : body(file)}), /SHA-256 distintos/);
    await assert.rejects(readFile(output), {code: 'ENOENT'});
    await assert.rejects(readFile(pathToFile(plan.copy[0])), {code: 'ENOENT'});
    const frozen = await freezeSite({...config, loadPrevious: async file => body(file)});
    assert.deepEqual(JSON.parse(await readFile(output)), frozen.manifest);
    assert.deepEqual(await readFile(pathToFile(plan.copy[0])), body(plan.copy[0]));
    await assert.rejects(readFile(join(directory, path(1))), {code: 'ENOENT'});

    const previousPath = join(temporary, 'previous.json');
    await writeFile(previousPath, JSON.stringify(previous));
    assert.throws(() => execFileSync(process.execPath, [
      'scripts/prepare-cloudflare.mjs', '--dry-run', '--as-of', now, '--previous-manifest', previousPath,
      '--previous-sha256', '0'.repeat(64),
    ], {stdio: 'pipe'}), /SHA-256 del manifiesto publicado distinto/);
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
});
