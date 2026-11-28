import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {get} from 'node:https';
import {extname, resolve} from 'node:path';
import {Readable} from 'node:stream';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {hash as blake3} from 'blake3-wasm';
import {sha256, verifyFile} from './cloudflare-retention.mjs';

const json = (path) => readFile(path, 'utf8').then(JSON.parse);
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
async function saveVerified(path, value) {
  try {
    await save(path, value);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    assert.deepEqual(await json(path), value, 'El recibo existente difiere de la lectura actual');
  }
}
const digest = bytes => ({bytes: Buffer.byteLength(bytes), sha256: sha256(bytes)});
const ordered = rows => rows.toSorted((a, b) => a.name.localeCompare(b.name));
const names = rows => rows.map(({name, type}) => ({name, type}));
const timeout = 30_000;

export function parseAddedCsv(value, pattern, name) {
  if (value === undefined) return [];
  assert.equal(typeof value, 'string', `--${name} debe ser una lista explícita`);
  const rows = value.split(',').map(item => item.trim());
  const validator = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
  assert.ok(rows.length && rows.every(item => item && validator.test(item)) && new Set(rows).size === rows.length,
    `--${name} debe ser una lista explícita, válida y sin duplicados`);
  return rows;
}

export function expectedRulesList(priorRules, addedRules = []) {
  assert.ok(Array.isArray(priorRules) && Array.isArray(addedRules), 'Las reglas deben ser listas');
  const expected = [...priorRules, ...addedRules];
  assert.equal(new Set(expected).size, expected.length, 'Una regla añadida ya existe en prior.rules');
  return expected;
}

export function expectedBindingsList(priorBindings, addedSecrets = []) {
  assert.ok(Array.isArray(priorBindings) && Array.isArray(addedSecrets),
    'La transición explícita requiere prior.bindings con nombres y tipos');
  const rows = ordered([...priorBindings, ...addedSecrets.map(name => ({name, type: 'secret_text'}))]);
  assert.equal(new Set(rows.map(row => row.name)).size, rows.length,
    'Un secreto añadido ya existe en prior.bindings');
  return rows;
}

export function assertTransitionInputs({prior, deployment, version, addedSecrets = []}) {
  if (addedSecrets.length === 0) {
    assert.equal(prior.deployment, deployment);
    assert.equal(prior.version, version);
    return;
  }
  assert.ok(deployment && version, 'La transición de secretos requiere deployment y version');
  assert.notEqual(deployment, prior.deployment, 'La transición requiere el deployment intermedio actual');
  assert.notEqual(version, prior.version, 'La transición requiere la version intermedia actual');
}

export function expectedRuntimeSnapshot(before, config, prior, addedRules = [], addedSecrets = []) {
  assert.deepEqual(config.assets.run_worker_first, expectedRulesList(prior.rules, addedRules),
    'Reglas distintas de prior.rules más las añadidas declaradas');
  if (Array.isArray(prior.bindings)) {
    const expected = expectedBindingsList(prior.bindings, addedSecrets);
    assert.deepEqual(ordered(names(before.settings.bindings)), expected,
      'Bindings intermedios distintos de prior.bindings más secretos declarados');
    assert.deepEqual(ordered(names(before.secrets)), expected.filter(binding => binding.type === 'secret_text'),
      'Secretos intermedios distintos de los declarados');
  } else {
    assert.equal(addedSecrets.length, 0, 'Los secretos nuevos requieren prior.bindings con nombres y tipos');
    assert.equal(before.settings.bindings.length, prior.bindings, 'Cambió el número de bindings');
  }
  const snapshot = structuredClone(runtimeSnapshot(before));
  snapshot.runtime.assets.raw_run_worker_first = config.assets.run_worker_first;
  snapshot.runtime.assets.static_routing.user_worker = config.assets.run_worker_first;
  return snapshot;
}

export function runtimeSnapshot({settings, scriptSettings, version, subdomain, domain, secrets}) {
  const {annotations, ...execution} = settings;
  return {
    settings: {...execution, bindings: ordered(execution.bindings)},
    scriptSettings, subdomain, domain, secretNames: ordered(names(secrets)), runtime: version.resources.script_runtime,
  };
}

export function snapshotHash(snapshot) {
  const sorted = (key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value;
  return sha256(JSON.stringify(snapshot, sorted));
}

export function verifyBeforeState({
  state, pointerState, module, previous, prior, config, origin, deployment, version, addedRules = [], addedSecrets = [],
}) {
  assertTransitionInputs({prior, deployment, version, addedSecrets});
  assert.equal(state.deployment.id, deployment, 'Cambió el despliegue activo');
  assert.equal(state.version.id, version, 'Cambió la versión activa');
  assert.deepEqual(pointerState, {version: 1, entry: previous.currentEntry});
  assert.deepEqual(config.assets.run_worker_first, expectedRulesList(prior.rules, addedRules),
    'Reglas distintas de prior.rules más las añadidas declaradas');
  assert.deepEqual(digest(module), prior.module, 'El módulo remoto difiere del recibo previo');
  if (Array.isArray(prior.bindings)) {
    const expected = expectedBindingsList(prior.bindings, addedSecrets);
    assert.deepEqual(ordered(names(state.settings.bindings)), expected,
      'Bindings intermedios distintos de prior.bindings más secretos declarados');
    assert.deepEqual(ordered(names(state.secrets)), expected.filter(binding => binding.type === 'secret_text'),
      'Secretos intermedios distintos de los declarados');
  } else {
    assert.equal(addedSecrets.length, 0, 'Los secretos nuevos requieren prior.bindings con nombres y tipos');
    assert.equal(state.settings.bindings.length, prior.bindings, 'Cambió el número de bindings');
  }
  checkLive(state, config, origin, prior.rules);
  return true;
}

export function verifyReadyState(ready, freeze) {
  assert.equal(snapshotHash(runtimeSnapshot(ready)), freeze.beforeRuntimeSha256,
    'Cambió el estado previo durante la carga de assets');
  return true;
}

export function verifyAfterState({
  after, config, origin, prior, deployment, addedSecrets = [], freeze, versionReference,
}) {
  checkLive(after, config, origin);
  if (Array.isArray(prior.bindings)) {
    const expected = expectedBindingsList(prior.bindings, addedSecrets);
    assert.deepEqual(ordered(names(after.settings.bindings)), expected,
      'Bindings finales distintos de prior más secretos declarados');
    assert.deepEqual(ordered(names(after.secrets)), expected.filter(binding => binding.type === 'secret_text'),
      'Secretos finales distintos de los declarados');
  } else {
    assert.equal(addedSecrets.length, 0, 'Los secretos nuevos requieren prior.bindings con nombres y tipos');
    assert.equal(after.settings.bindings.length, prior.bindings, 'Cambió el número final de bindings');
  }
  assert.notEqual(after.deployment.id, deployment, 'El despliegue de la petición sigue activo');
  assert.notEqual(after.deployment.id, prior.deployment, 'El despliegue anterior sigue activo');
  assert.equal(after.version.id.replaceAll('-', ''), versionReference.replaceAll('-', ''));
  assert.equal(snapshotHash(runtimeSnapshot(after)), freeze.runtimeSha256, 'Cambió el estado de ejecución');
  return true;
}

const publicFetch = (origin, path, headers) => fetch(new URL(path, origin), {
  headers, redirect: 'manual', signal: AbortSignal.timeout(timeout),
});
const pointer = async origin => {
  const res = await publicFetch(origin, '/latest.json');
  assert.equal(res.status, 200, 'latest.json HTTP');
  return res.json();
};

async function prepare(origin, work, source, previousSha, arg) {
  const time = arg['as-of'] ?? new Date().toISOString();
  const script = resolve(source, 'scripts/prepare-cloudflare.mjs');
  const flags = ['--previous-manifest', resolve(arg['previous-manifest']), '--previous-sha256', previousSha, '--as-of', time];
  for (const [step, args] of [
    ['dry-run', []],
    ['freeze', ['--previous-origin', origin, '--output', resolve(work, 'frozen-site-manifest.json')]],
  ]) {
    const output = execFileSync(process.execPath, [script, '--' + step, ...flags, ...args], {cwd: source, encoding: 'utf8'});
    await save(resolve(work, 'retention-' + step + '.json'), JSON.parse(output));
  }
}

function mcpReader(name) {
  return `async () => {
    const base = '/accounts/' + accountId + '/workers';
    const path = base + '/scripts/' + ${JSON.stringify(name)};
    const get = async (url) => (await cloudflare.request({method:'GET', path:url})).result;
    const [deployments, settings, scriptSettings, subdomain, domain, secrets] = await Promise.all([
      get(path+'/deployments'), get(path+'/settings'), get(path+'/script-settings'),
      get(path+'/subdomain'), get(base+'/subdomain'), get(path+'/secrets'),
    ]);
    const deployment = deployments.deployments[0];
    const version = await get(path+'/versions/'+deployment.versions[0].version_id);
    return {deployment, settings, scriptSettings, subdomain, domain:domain.subdomain, version, secrets, account:accountId};
  }`;
}

const readModule = name => `async () => {
  const path = '/accounts/' + accountId + '/workers/scripts/' + ${JSON.stringify(name)} + '/content/v2';
  const body = await cloudflare.request({method:'GET',path});
  const endHeaders = body.indexOf('\\r\\n\\r\\n');
  const boundary = body.slice(0,body.indexOf('\\r\\n'));
  const end = body.lastIndexOf('\\r\\n'+boundary+'--');
  if (!boundary.startsWith('--') || !body.slice(0,endHeaders).includes('filename="worker.js"') || end <= endHeaders ||
      body.indexOf('\\r\\n'+boundary,endHeaders) !== end) throw Error('Se esperaba un solo módulo worker.js');
  return {module:body.slice(endHeaders+4,end)};
}`;

function checkLive(state, config, origin, rules=config.assets.run_worker_first) {
  const {settings, subdomain, domain, version, deployment, secrets} = state;
  const runtime = version.resources.script_runtime;
  assert.deepEqual(runtime.assets.raw_run_worker_first, rules);
  assert.deepEqual(runtime.assets.static_routing.user_worker, rules);
  assert.equal(runtime.assets.not_found_handling, config.assets.not_found_handling);
  assert.equal(settings.compatibility_date, config.compatibility_date);
  assert.deepEqual(settings.compatibility_flags ?? [], config.compatibility_flags ?? []);
  assert.deepEqual(subdomain, {enabled:config.workers_dev, previews_enabled:config.preview_urls});
  assert.equal(new URL(origin).hostname, `${config.name}.${domain}.workers.dev`);
  assert.deepEqual(deployment.versions, [{version_id: version.id, percentage: 100}]);
  assert.deepEqual(ordered(settings.bindings.filter(b => b.type === 'secret_text')), ordered(names(secrets)));
  assert.deepEqual(ordered(settings.bindings.filter(b => b.type === 'ratelimit')),
    ordered(config.ratelimits.map(b => ({...b, type:'ratelimit'}))));
  assert.deepEqual(ordered(version.resources.bindings), ordered(settings.bindings));
}

async function checkBefore({
  state, origin, previous, prior, config, deployment, version, addedRules, addedSecrets, readRemoteModule,
}) {
  const [pointerState, remote] = await Promise.all([pointer(origin), readRemoteModule()]);
  verifyBeforeState({
    state, pointerState, module: remote.module, previous, prior, config, origin, deployment, version, addedRules, addedSecrets,
  });
  return remote.module;
}

async function assetsFor(site, frozen) {
  const entries = (await readdir(site, {recursive: true, withFileTypes: true})).filter(x => !x.isDirectory());
  assert.ok(entries.every(x => x.isFile()), 'El sitio contiene enlaces u otros archivos especiales');
  assert.deepEqual(entries.map(x => resolve(x.parentPath, x.name)).sort(),
    frozen.files.map(x => resolve(site, x.path)).sort(), 'El sitio difiere del inventario congelado');
  assert.deepEqual(await json(resolve(site, 'latest.json')), {version:1, entry:frozen.currentEntry});
  const manifest = {}, payloads = new Map();
  for (const file of frozen.files) {
    assert.ok(!file.path.startsWith('/') && !file.path.split('/').some(part => !part || part === '..'));
    const bytes = verifyFile(file, await readFile(resolve(site, file.path)));
    if (['.assetsignore', '_headers', '_redirects', 'telegram-config.json'].includes(file.path) || file.path.endsWith('.map')) continue;
    const hash = blake3(Buffer.from(bytes.toString('base64') + extname(file.path).slice(1))).toString('hex').slice(0, 32);
    manifest['/' + file.path] = {hash, size:bytes.length};
    assert.ok(!payloads.has(hash) || payloads.get(hash).sha256 === file.sha256, 'Colisión del hash de assets');
    payloads.set(hash, {...file, body:bytes});
  }
  return {manifest, payloads};
}

const mime = {
  '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.json':'application/json',
  '.wasm':'application/wasm', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon',
  '.webmanifest':'application/manifest+json', '.txt':'text/plain', '.gz':'application/gzip',
  '.mp3':'audio/mpeg', '.m4a':'audio/mp4', '.wav':'audio/wav',
};

async function uploadAssets(execute, name, account, {manifest, payloads}, work) {
  const upload = await execute(`async () => (await cloudflare.request({
    method:'POST',path:'/accounts/'+accountId+'/workers/scripts/'+${JSON.stringify(name)}+'/assets-upload-session',
    body:${JSON.stringify({manifest})}
  })).result`);
  assert.ok(typeof upload.jwt === 'string' && upload.jwt && Array.isArray(upload.buckets), 'Sesión de assets inválida');
  const hashes = upload.buckets.flat();
  assert.ok(new Set(hashes).size === hashes.length && hashes.every(hash => payloads.has(hash)), 'Buckets de assets inválidos');
  const uploaded = [];
  let completion = upload.buckets.length ? null : upload.jwt;
  for (const bucket of upload.buckets) {
    const form = new FormData();
    for (const hash of bucket) {
      const {path, body, bytes, sha256} = payloads.get(hash);
      form.append(hash, new Blob([body.toString('base64')], {type:mime[extname(path)] ?? 'application/octet-stream'}), hash);
      uploaded.push({path, bytes, sha256});
    }
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/assets/upload?base64=true`, {
      method:'POST', headers:{Authorization:`Bearer ${upload.jwt}`}, body:form,
      redirect:'error', signal:AbortSignal.timeout(180_000),
    });
    const result = await response.json().catch(() => null);
    assert.ok(response.ok && result?.success, `Subida de bucket HTTP ${response.status}`);
    if (result.result?.jwt) completion = result.result.jwt;
  }
  assert.ok(typeof completion === 'string' && completion, 'Falta la confirmación de assets');
  await save(resolve(work, 'asset-upload.json'), {
    buckets:upload.buckets.length, uploaded, assets:Object.keys(manifest).length, distinctHashes:payloads.size,
  });
  return completion;
}

function workerMetadata(state, config, jwt, headers) {
  const {settings, scriptSettings, version} = state;
  const runtime = version.resources.script_runtime;
  const keep = ['durable_object_namespace', 'secret_text', 'plain_text'];
  const bindings = settings.bindings.filter(b => !keep.includes(b.type));
  assert.ok(bindings.every(b => ['assets', 'ratelimit'].includes(b.type)), 'Revisar tipo de binding nuevo');
  assert.equal(headers, runtime.assets.raw_headers, 'Cambió la política estática del Worker');
  const metadata = {
    main_module:'worker.js',
    bindings,
    keep_bindings:keep,
    assets:{jwt, config:{
      html_handling:runtime.assets.html_handling,
      not_found_handling:runtime.assets.not_found_handling,
      run_worker_first:config.assets.run_worker_first,
      _headers:headers,
      ...(runtime.assets.raw_redirects && {_redirects:runtime.assets.raw_redirects}),
    }},
  };
  for (const field of ['compatibility_date', 'compatibility_flags', 'usage_model', 'logpush', 'limits', 'placement', 'tags', 'tail_consumers', 'observability']) {
    const value = field === 'observability' ? scriptSettings[field] : settings[field] ?? runtime[field];
    if (value != null && (Object.keys(Object(value)).length || typeof value !== 'object')) metadata[field] = value;
  }
  return metadata;
}

function putWorker(execute, name, state, metadata, worker) {
  return execute(`async () => {
    const path='/accounts/'+accountId+'/workers/scripts/'+${JSON.stringify(name)};
    const get = async suffix => (await cloudflare.request({method:'GET',path:path+suffix})).result;
    const [deployments,versions] = await Promise.all([get('/deployments'),get('/versions')]);
    if (deployments.deployments[0].id !== ${JSON.stringify(state.deployment.id)} ||
        versions.items[0].id !== ${JSON.stringify(state.version.id)}) return {conflict:true};
    const form = new FormData();
    form.append('metadata',new Blob([JSON.stringify(${JSON.stringify(metadata)})],{type:'application/json'}));
    form.append('worker.js',new Blob([${JSON.stringify(worker)}],{type:'application/javascript+module'}),'worker.js');
    try {
      const r = await cloudflare.request({method:'PUT',path,body:form});
      return {success:r.success,versionReference:r.result?.deployment_id,id:r.result?.id,hasAssets:r.result?.has_assets};
    } catch (error) {
      const message = String(error);
      return {success:false,http:message.match(/(?:HTTP|status)[ :]+(\\d{3})/i)?.[1],errors:message.match(/\\b10021\\b/g)};
    }
  }`);
}

async function publicVerify(origin, frozen, turnstileKey) {
  assert.deepEqual(await pointer(origin), {version:1,entry:frozen.currentEntry});
  const entry = frozen.currentEntry;
  const canonical = entry.slice(0,-5);
  const meta = entry.slice('/releases/'.length,-5);
  const redirect = await publicFetch(origin, entry);
  assert.equal(redirect.status, 307);
  assert.equal(redirect.headers.get('location'), canonical);
  await redirect.body?.cancel();
  const html = await publicFetch(origin, canonical);
  assert.equal(html.status, 200);
  const checkPage = async (res, path) => {
    assert.equal(res.status, 200, path);
    const csp = res.headers.get('content-security-policy');
    for (const directive of ['script-src', 'frame-src']) {
      assert.ok(csp?.split(';').some(rule => rule.trim().startsWith(directive+' ') &&
        rule.trim().split(/\s+/).includes('https://challenges.cloudflare.com')), 'Falta Turnstile en CSP');
    }
    assert.ok((await res.text()).includes(`name="pulso-release" content="${meta}"`), 'Meta pulso-release incorrecto');
  };
  await checkPage(html, canonical);
  const files = frozen.files.filter(f => !['.assetsignore','_headers','_redirects','account-config.json'].includes(f.path) && !f.path.endsWith('.map'));
  async function checkAsset(file) {
    const path = '/' + file.path;
    let res = await publicFetch(origin, path);
    if (res.status === 307 && path.endsWith('.html')) {
      const location = res.headers.get('location');
      const canonical = path === '/index.html' ? '/' : path.slice(0,-5);
      assert.equal(new URL(location, origin).href, new URL(canonical, origin).href, path);
      await res.body?.cancel();
      res = await publicFetch(origin, canonical);
    }
    assert.equal(res.status, 200, path);
    verifyFile(file, Buffer.from(await res.arrayBuffer()));
  }
  for (let i = 0; i < files.length; i+=8) await Promise.all(files.slice(i,i+8).map(checkAsset));
  const history = files.filter(f => /^releases\/[a-f0-9]{16}\.html$/.test(f.path) && '/'+f.path !== entry);
  const navigationHeaders = [
    {Accept:'text/html'},
    {Accept:'*/*', 'Sec-Fetch-Mode':'navigate', 'Sec-Fetch-Dest':'document'},
  ];
  // fetch() fija Sec-Fetch-Mode automáticamente y no admite el modo navigate.
  const navigation = (path, headers) => new Promise((resolve, reject) => {
    get(new URL(path, origin), {headers, signal:AbortSignal.timeout(timeout)}, res => {
      resolve(new Response(Readable.toWeb(res), {status:res.statusCode, headers:res.headers}));
    }).on('error', reject);
  });
  for (let i = 0; i < history.length; i += 4) {
    await Promise.all(history.slice(i,i+4).map(async file => {
      for (const headers of navigationHeaders) {
        for (const path of ['/'+file.path, '/'+file.path.slice(0,-5)]) {
          await checkPage(await navigation(path, headers), path);
        }
      }
    }));
  }
  await checkPage(await publicFetch(origin, '/', navigationHeaders[0]), '/');
  const account = await publicFetch(origin, '/account-config.json');
  assert.equal(account.status, 200);
  assert.ok(turnstileKey && (await account.json()).turnstileSiteKey === turnstileKey, 'Turnstile no coincide con el binding');
  const anonymous = {};
  for (const path of ['/api/account-profile', '/api/account-library','/api/youtube-playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf']) {
    const res = await publicFetch(origin, path);
    assert.equal(res.status, 401, path);
    anonymous[path] = res.status;
    await res.body?.cancel();
  }
  const {path, ...sw} = files.find(f => f.path === 'sw.js');
  return {entry, redirect:307, canonical, canonicalStatus:200, meta, static:files.length, sw, history:history.length*4,
    currentNavigation:'PASS', turnstile:{csp:true, siteKeyMatches:true}, anonymous};
}

async function verifyDeployment({config, execute, read, origin, frozen, work, freeze, put, prior, deployment, addedSecrets}) {
  const after = await read();
  verifyAfterState({
    after, config, origin, prior, deployment, addedSecrets, freeze, versionReference: put.versionReference,
  });
  assert.deepEqual(digest((await execute(readModule(config.name))).module), freeze.worker);
  const readback = {deployment:after.deployment.id, version:after.version.id, versionNumber:after.version.number,
    createdAt:after.deployment.created_on, percentage:100, module:freeze.worker, rules:config.assets.run_worker_first,
    bindings:names(after.settings.bindings), runtimeMatch:true, settingsMatch:true, secretNamesMatch:true, bindingMatch:true};
  await saveVerified(resolve(work, 'mcp-readback.json'), readback);

  // El despliegue activo puede preceder brevemente a la propagación del puntero público.
  for (let attempt = 0; attempt < 12; attempt++) {
    if ((await pointer(origin)).entry === frozen.currentEntry) break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  const https = await publicVerify(origin, frozen, after.settings.bindings.find(b => b.name === 'PULSO_TURNSTILE_SITE_KEY')?.text);
  await saveVerified(resolve(work, 'https-readback.json'), https);
  console.log(JSON.stringify({https, deployment:readback.deployment, version:readback.version, module:readback.module}));
}

async function main(argv) {
  const {positionals: [command], values: arg} = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries([
      'source', 'work', 'previous-manifest', 'previous-sha256', 'previous-receipt', 'origin',
      'worker-module', 'mcp-client', 'deployment', 'version', 'as-of', 'expected-added-rules', 'expected-added-secrets',
    ].map(name => [name, {type: 'string'}])),
  }, argv);
  const addedRules = parseAddedCsv(arg['expected-added-rules'], /^\/[A-Za-z0-9_./*-]+$/, 'expected-added-rules');
  const addedSecrets = parseAddedCsv(arg['expected-added-secrets'], /^[A-Z][A-Z0-9_]{0,127}$/, 'expected-added-secrets');
  assert.ok(['preflight','freeze','publish','verify'].includes(command), 'Usa preflight, freeze, publish o verify');
  const work = resolve(arg.work);
  const source = resolve(arg.source);
  const origin = new URL(arg.origin).origin;
  assert.equal(origin, arg.origin);
  assert.ok(origin.startsWith('https://'));
  const site = resolve(source, '.local/cloudflare-setup/site');
  const config = await json(resolve(source, 'wrangler.jsonc'));
  const previousBody = await readFile(arg['previous-manifest']);
  const previous = JSON.parse(previousBody);
  const prior = await json(arg['previous-receipt']);
  const previousSha = sha256(previousBody);
  assert.equal(previousSha, arg['previous-sha256'], 'SHA-256 del manifiesto anterior distinto del recibo');
  assertTransitionInputs({prior, deployment: arg.deployment, version: arg.version, addedSecrets});
  assert.deepEqual(config.assets.run_worker_first, expectedRulesList(prior.rules, addedRules),
    'Reglas distintas de prior.rules más las añadidas declaradas');
  if (addedSecrets.length) expectedBindingsList(prior.bindings, addedSecrets);
  if (command === 'freeze') return prepare(origin, work, source, previousSha, arg);
  const {createClient} = await import(pathToFileURL(resolve(arg['mcp-client'])).href);
  const client = await createClient();
  const execute = code => client.tool('execute', {code, truncate:false});
  const read = () => execute(mcpReader(config.name));
  const readRemoteModule = () => execute(readModule(config.name));
  if (command === 'verify') {
    const freeze = await json(resolve(work, 'freeze.json'));
    const put = await json(resolve(work, 'worker-upload.json'));
    const frozenBody = await readFile(resolve(work, 'frozen-site-manifest.json'));
    assert.deepEqual(digest(frozenBody), freeze.manifest);
    return verifyDeployment({
      config, execute, read, origin, frozen:JSON.parse(frozenBody), work, freeze, put, prior,
      deployment: arg.deployment, addedSecrets,
    });
  }
  const before = await read();
  const moduleBefore = await checkBefore({
    state: before, origin, previous, prior, config, deployment: arg.deployment, version: arg.version,
    addedRules, addedSecrets, readRemoteModule,
  });
  if (command === 'preflight') {
    console.log(JSON.stringify({entry:previous.currentEntry, deployment:before.deployment.id, version:before.version.id,
      module:digest(moduleBefore), rules:config.assets.run_worker_first.length, addedRules, addedSecrets, bindings:before.settings.bindings.length}));
    return;
  }

  const frozenBody = await readFile(resolve(work, 'frozen-site-manifest.json'));
  const frozen = JSON.parse(frozenBody);
  const assets = await assetsFor(site, frozen);
  const simulation = await readFile(arg['worker-module'], 'utf8');
  const normalizePaths = text => text.replace(/^\/\/ (?:\.\.\/)+node_modules\//gm, '// node_modules/');
  const worker = normalizePaths(simulation) === normalizePaths(moduleBefore) ? moduleBefore : simulation;
  const freeze = {currentEntry:frozen.currentEntry, files:frozen.files.length,
    legacyFiles:frozen.legacy?.assets.length ?? 0, worker:digest(worker), simulation:digest(simulation),
    reusedActiveModule:worker === moduleBefore, manifest:digest(frozenBody),
    beforeRuntimeSha256:snapshotHash(runtimeSnapshot(before)),
    runtimeSha256:snapshotHash(expectedRuntimeSnapshot(before,config,prior,addedRules,addedSecrets))};
  await save(resolve(work, 'freeze.json'), freeze);
  const headers = await readFile(resolve(site, '_headers'), 'utf8');
  const metadata = workerMetadata(before, config, undefined, headers);
  await checkBefore({
    state: await read(), origin, previous, prior, config, deployment: arg.deployment, version: arg.version,
    addedRules, addedSecrets, readRemoteModule,
  });
  const completion = await uploadAssets(execute, config.name, before.account, assets, work);
  const ready = await read();
  await checkBefore({
    state: ready, origin, previous, prior, config, deployment: arg.deployment, version: arg.version,
    addedRules, addedSecrets, readRemoteModule,
  });
  verifyReadyState(ready, freeze);
  metadata.assets.jwt = completion;
  const put = await putWorker(execute, config.name, ready, metadata, worker);
  await save(resolve(work, 'worker-upload.json'), put);
  assert.ok(put.success && put.versionReference && put.hasAssets,
    `PUT del Worker sin despliegue confirmado: ${JSON.stringify(put)}`);

  console.log(JSON.stringify({workerUpload:put}));
  await verifyDeployment({config, execute, read, origin, frozen, work, freeze, put, prior,
    deployment: arg.deployment, addedSecrets});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    // Los detalles de una excepción pueden incluir el cuerpo de una petición MCP o JWT.
    const safe = String(error.message).replace(/[\w-]{20,}\.[\w-]{20,}\.[\w-]{15,}/g, '[REDACTADO]');
    console.error(safe.slice(0, 500));
    process.exitCode = 1;
  }
}
