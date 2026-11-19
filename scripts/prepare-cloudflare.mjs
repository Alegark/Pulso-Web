import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cp, lstat, mkdir, open, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {candidateManifest, markPublished, planRetention, sha256, verifyFile} from './cloudflare-retention.mjs';

const root = resolve(import.meta.dirname, '..');
const base = resolve(root, '.local/cloudflare-setup');
const site = resolve(base, 'site');
const snapshot = resolve(base, 'build-root');
const manifestPath = resolve(base, 'site-manifest.json');
const json = value => JSON.stringify(value, null, 2) + '\n';
const loadJson = async path => JSON.parse(await readFile(path, 'utf8'));

async function readInventory(directory, prefix = '') {
  assert.ok((await lstat(directory)).isDirectory(), 'Se requiere un directorio de assets real');
  const files = [];
  const entries = await readdir(directory, {withFileTypes: true});
  for (const item of entries) {
    const path = prefix + item.name, fullPath = resolve(directory, item.name);
    if (item.isDirectory()) {
      files.push(...await readInventory(fullPath, path + '/'));
      continue;
    }
    assert.ok(item.isFile(), `Tipo de archivo no admitido: ${path}`);
    const metadata = await lstat(fullPath);
    assert.ok(metadata.isFile() && metadata.size <= 25 * 1024 * 1024, `Archivo inválido o demasiado grande: ${path}`);
    const bytes = await readFile(fullPath);
    files.push({path, bytes: bytes.length, sha256: sha256(bytes)});
  }
  return files;
}

async function writeExclusive(path, body) {
  const file = await open(path, 'wx');
  try {
    try {
      await file.writeFile(body);
    } finally {
      await file.close();
    }
  } catch (error) {
    await rm(path, {force: true});
    throw error;
  }
}

async function prepare() {
  await mkdir(base, {recursive: true});
  await rm(snapshot, {recursive: true, force: true});
  await mkdir(snapshot);
  for (const name of ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'index.html',
    'pilot.html', 'samples.html', 'src', 'public', 'scripts', 'tests', 'vendor', 'deployment', 'wrangler.jsonc']) {
    await cp(resolve(root, name), resolve(snapshot, name), {recursive: true});
  }
  await symlink(resolve(root, 'node_modules'), resolve(snapshot, 'node_modules'), 'dir');
  execFileSync('npm', ['run', 'build'], {cwd: snapshot, stdio: 'inherit'});
  await rm(site, {recursive: true, force: true});
  await cp(resolve(snapshot, 'dist'), site, {recursive: true});
  const policy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
  await writeFile(resolve(site, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: ${policy}\n  Cache-Control: no-cache\n`);
  await writeFile(resolve(site, '.assetsignore'), 'telegram-config.json\n.env*\n*.map\n.assetsignore\n');
  const latest = await loadJson(resolve(site, 'latest.json'));
  assert.equal(latest.version, 1, 'Versión del puntero inválida');
  const manifest = candidateManifest(latest.entry, await readInventory(site));
  await writeFile(manifestPath, json(manifest));
  console.log(`Candidato de Cloudflare preparado: ${manifest.files.length} archivos.`);
}

async function responseBytes(response, limit, path) {
  try {
    assert.ok(response.status === 200 && response.body, `HTTP ${response.status}: ${path}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      assert.ok(size <= limit, `Respuesta demasiado grande: ${path}`);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } finally {
    if (response.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}

function publicSource(value) {
  const origin = new URL(value);
  assert.ok(origin.protocol === 'https:' && origin.origin === value, 'Se requiere el origen HTTPS público');
  return async (path, limit) => {
    const url = new URL('/' + path, origin);
    const options = {redirect: 'manual', signal: AbortSignal.timeout(30_000)};
    let response = await fetch(url, options);
    if ([301, 302, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const canonical = new URL(response.headers.get('location'), url);
      assert.ok(path.startsWith('releases/') && canonical.href === url.href.slice(0, -5),
        `Redirección no admitida: ${path}`);
      response = await fetch(canonical, options);
    }
    return responseBytes(response, limit, path);
  };
}

export async function freezeSite({directory, candidate, previous, legacyEvidence, asOf, output, loadPrevious, dryRun}) {
  const plan = planRetention({candidate, previous, legacyEvidence, asOf});
  const actual = await readInventory(directory);
  assert.equal(actual.length, candidate.files.length, 'El sitio y el manifiesto candidato difieren');
  const expected = new Map(candidate.files.map(file => [file.path, file]));
  for (const file of actual) {
    const record = expected.get(file.path);
    assert.ok(record?.bytes === file.bytes && record.sha256 === file.sha256, `Bytes o SHA-256 distintos: ${file.path}`);
  }
  const latest = await loadJson(resolve(directory, 'latest.json'));
  assert.ok(latest.version === 1 && latest.entry === candidate.currentEntry, 'latest.json difiere del candidato');
  if (dryRun) return plan;

  // A failed freeze leaves the clean candidate retryable. The upload manifest
  // appears only after all retained files have been verified and copied.
  const added = [];
  try {
    for (const file of plan.copy) {
      const body = verifyFile(file, await loadPrevious(file));
      const destination = resolve(directory, file.path);
      await mkdir(dirname(destination), {recursive: true});
      await writeExclusive(destination, body);
      added.push(destination);
    }
    await writeExclusive(output, json(plan.manifest));
  } catch (error) {
    await Promise.all(added.map(path => rm(path, {force: true})));
    throw error;
  }
  return plan;
}

async function main() {
  if (process.argv.length === 2) return prepare();
  const {values: args} = parseArgs({options: {
    'dry-run': {type: 'boolean'}, 'freeze': {type: 'boolean'}, 'mark-published': {type: 'boolean'},
    'candidate-manifest': {type: 'string'}, 'site': {type: 'string'}, 'output': {type: 'string'},
    'previous-manifest': {type: 'string'}, 'previous-sha256': {type: 'string'}, 'previous-origin': {type: 'string'},
    'legacy-entry': {type: 'string'}, 'legacy-published-at': {type: 'string'}, 'as-of': {type: 'string'},
    'published-at': {type: 'string'},
  }});
  assert.equal([args['dry-run'], args.freeze, args['mark-published']].filter(Boolean).length, 1,
    'Selecciona --dry-run, --freeze o --mark-published');
  if (args['mark-published']) {
    const frozen = await loadJson(args['candidate-manifest']);
    await writeExclusive(args.output, json(markPublished(frozen, args['published-at'])));
    return;
  }

  assert.ok(args['as-of'] && args['previous-manifest'] && args['previous-sha256'],
    'Indica --as-of, --previous-manifest y el --previous-sha256 de su recibo');
  const previousBody = await readFile(args['previous-manifest']);
  assert.equal(sha256(previousBody), args['previous-sha256'], 'SHA-256 del manifiesto publicado distinto del recibo');
  const previous = JSON.parse(previousBody);
  const candidate = await loadJson(args['candidate-manifest'] ?? manifestPath);
  const legacyEvidence = args['legacy-entry'] || args['legacy-published-at']
    ? {entry: args['legacy-entry'], publishedAt: args['legacy-published-at']} : undefined;
  let loadPrevious;
  if (args.freeze) {
    assert.ok(args.output && args['previous-origin'], 'Indica --output y --previous-origin para el freeze');
    const readPublic = publicSource(args['previous-origin']);
    const latest = JSON.parse(await readPublic('latest.json', 1024));
    assert.ok(latest.version === 1 && latest.entry === (legacyEvidence?.entry ?? previous.currentEntry),
      'La publicación activa difiere del manifiesto anterior');
    loadPrevious = file => readPublic(file.path, file.bytes);
  }
  const plan = await freezeSite({
    directory: args.site ?? site, candidate, previous, legacyEvidence, asOf: args['as-of'],
    output: args.output, loadPrevious, dryRun: args['dry-run'],
  });
  console.log(json({
    asOf: args['as-of'],
    currentEntry: plan.manifest.currentEntry,
    retainedPublications: plan.manifest.releases.length - 1,
    legacyRetained: !!plan.manifest.legacy,
    copiedFiles: plan.copy.length,
    totalFiles: plan.manifest.files.length,
    retiredFiles: plan.retired.length,
    retiredBytes: plan.retiredBytes,
    retired: plan.retired.map(({path, bytes}) => ({path, bytes})),
  }).trimEnd());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
