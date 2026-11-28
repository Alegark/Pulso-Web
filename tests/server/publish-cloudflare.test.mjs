import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {
  assertTransitionInputs,
  expectedBindingsList,
  expectedRulesList,
  expectedRuntimeSnapshot,
  parseAddedCsv,
  runtimeSnapshot,
  snapshotHash,
  verifyAfterState,
  verifyBeforeState,
  verifyReadyState,
} from '../../scripts/publish-cloudflare.mjs';

const configV70 = JSON.parse(await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
const addedRules = ['/api/youtube-playlist'];
const addedSecrets = ['YOUTUBE_API_KEY'];
const targetRules = configV70.assets.run_worker_first;
const priorRules = targetRules.filter(rule => !addedRules.includes(rule));
const priorBindings = [
  {name: configV70.assets.binding, type: 'assets'},
  ...configV70.durable_objects.bindings.map(binding => ({name: binding.name, type: 'durable_object_namespace'})),
  ...configV70.ratelimits.map(binding => ({name: binding.name, type: 'ratelimit'})),
  {name: 'PULSO_TURNSTILE_SITE_KEY', type: 'secret_text'},
  ...Array.from({length: 6}, (_, index) => ({name: `SYNTHETIC_SECRET_${index + 1}`, type: 'secret_text'})),
];
const moduleText = 'export default {fetch(){return new Response("synthetic")}};';
const moduleDigest = {
  bytes: Buffer.byteLength(moduleText),
  sha256: createHash('sha256').update(moduleText).digest('hex'),
};
const origin = `https://${configV70.name}.${configV70.name}.workers.dev`;
const previous = {currentEntry: '/releases/v69.html'};
const pointerState = {version: 1, entry: previous.currentEntry};

function stateFixture({
  deploymentId = 'D_v69', versionId = 'V_v69', rules = priorRules, bindings = priorBindings,
} = {}) {
  const liveBindings = bindings.map(binding => binding.type === 'ratelimit'
    ? {...configV70.ratelimits.find(configBinding => configBinding.name === binding.name), type: 'ratelimit'}
    : structuredClone(binding));
  const runtimeRules = [...rules];
  const version = {
    id: versionId,
    number: 1,
    resources: {
      script_runtime: {
        assets: {
          raw_run_worker_first: runtimeRules,
          static_routing: {user_worker: [...runtimeRules]},
          not_found_handling: configV70.assets.not_found_handling,
        },
      },
      bindings: structuredClone(liveBindings),
    },
  };
  return {
    deployment: {
      id: deploymentId,
      versions: [{version_id: versionId, percentage: 100}],
      created_on: '2026-11-28T00:00:00.000Z',
    },
    settings: {
      annotations: {synthetic: true},
      compatibility_date: configV70.compatibility_date,
      compatibility_flags: [],
      bindings: liveBindings,
    },
    scriptSettings: {},
    subdomain: {enabled: configV70.workers_dev, previews_enabled: configV70.preview_urls},
    domain: configV70.name,
    version,
    secrets: liveBindings.filter(binding => binding.type === 'secret_text').map(({name, type}) => ({name, type})),
  };
}

function priorFixture({deployment = 'D_v69', version = 'V_v69', rules = priorRules, bindings = priorBindings} = {}) {
  return {deployment, version, rules, bindings, module: moduleDigest};
}

function beforeArguments({state, prior, config, deployment, version, rules = [], secrets = []}) {
  return {
    state,
    pointerState,
    module: moduleText,
    previous,
    prior,
    config,
    origin,
    deployment,
    version,
    addedRules: rules,
    addedSecrets: secrets,
  };
}

test('parsea las listas de transición sin duplicados y construye expectativas ordenadas', () => {
  assert.deepEqual(parseAddedCsv(undefined, /^\/[A-Za-z0-9_./*-]+$/, 'rules'), []);
  assert.deepEqual(parseAddedCsv('/api/one, /api/two', /^\/[A-Za-z0-9_./*-]+$/, 'rules'), ['/api/one', '/api/two']);
  assert.throws(() => parseAddedCsv('/api/one,/api/one', /^\/[A-Za-z0-9_./*-]+$/, 'rules'));
  assert.deepEqual(expectedRulesList(['/a'], ['/b']), ['/a', '/b']);
  assert.throws(() => expectedRulesList(['/a'], ['/a']));
  assert.deepEqual(expectedBindingsList([{name: 'BASE', type: 'secret_text'}], ['NEW']), [
    {name: 'BASE', type: 'secret_text'}, {name: 'NEW', type: 'secret_text'},
  ]);
});

test('modo estricto conserva deployment, version, reglas y bindings exactos', () => {
  const prior = priorFixture();
  const config = structuredClone(configV70);
  config.assets.run_worker_first = [...priorRules];
  const state = stateFixture();
  assertTransitionInputs({prior, deployment: prior.deployment, version: prior.version});
  assert.equal(verifyBeforeState(beforeArguments({
    state, prior, config, deployment: prior.deployment, version: prior.version,
  })), true);

  const changedRules = structuredClone(state);
  changedRules.version.resources.script_runtime.assets.raw_run_worker_first.push('/changed');
  changedRules.version.resources.script_runtime.assets.static_routing.user_worker.push('/changed');
  assert.throws(() => verifyBeforeState(beforeArguments({
    state: changedRules, prior, config, deployment: prior.deployment, version: prior.version,
  })));

  const changedBindings = structuredClone(state);
  changedBindings.settings.bindings[0].name = 'UNDECLARED_BINDING';
  changedBindings.version.resources.bindings[0].name = 'UNDECLARED_BINDING';
  assert.throws(() => verifyBeforeState(beforeArguments({
    state: changedBindings, prior, config, deployment: prior.deployment, version: prior.version,
  })));

  const changedDeployment = stateFixture({deploymentId: 'D_unexpected'});
  assert.throws(() => verifyBeforeState(beforeArguments({
    state: changedDeployment, prior, config, deployment: prior.deployment, version: prior.version,
  })));
  assert.throws(() => assertTransitionInputs({prior, deployment: 'D_unexpected', version: prior.version}));
  assert.throws(() => assertTransitionInputs({prior, deployment: prior.deployment, version: 'V_unexpected'}));
});

test('transición autorizada verifica el estado intermedio, el runtime previo y el esperado tras PUT', () => {
  assert.equal(priorRules.length, 14);
  assert.equal(targetRules.length, 15);
  assert.equal(priorBindings.length, 13);

  const prior = priorFixture();
  const deployment = 'D_secret';
  const version = 'V_secret';
  const config = structuredClone(configV70);
  const beforeBindings = expectedBindingsList(priorBindings, addedSecrets);
  assert.equal(beforeBindings.length, 14);
  const before = stateFixture({deploymentId: deployment, versionId: version, bindings: beforeBindings});
  assert.equal(verifyBeforeState(beforeArguments({
    state: before, prior, config, deployment, version, rules: addedRules, secrets: addedSecrets,
  })), true);

  const freeze = {
    beforeRuntimeSha256: snapshotHash(runtimeSnapshot(before)),
    runtimeSha256: snapshotHash(expectedRuntimeSnapshot(before, config, prior, addedRules, addedSecrets)),
  };
  assert.notEqual(freeze.beforeRuntimeSha256, freeze.runtimeSha256);
  const ready = structuredClone(before);
  assert.equal(snapshotHash(runtimeSnapshot(ready)), freeze.beforeRuntimeSha256);
  assert.equal(ready.version.resources.script_runtime.assets.raw_run_worker_first.length, 14);
  assert.equal(verifyReadyState(ready, freeze), true);

  const after = stateFixture({
    deploymentId: 'D_v70', versionId: 'V_v70', rules: targetRules, bindings: beforeBindings,
  });
  assert.equal(verifyAfterState({
    after, config, origin, prior, deployment, addedSecrets, freeze, versionReference: 'V_v70',
  }), true);
  assert.equal(after.deployment.id, 'D_v70');
  assert.equal(after.settings.bindings.length, 14);
  assert.equal(after.version.resources.script_runtime.assets.raw_run_worker_first.length, 15);
  assert.equal(snapshotHash(runtimeSnapshot(after)), freeze.runtimeSha256);
  assert.throws(() => verifyAfterState({
    after: stateFixture({deploymentId: deployment, versionId: 'V_v70', rules: targetRules, bindings: beforeBindings}),
    config, origin, prior, deployment, addedSecrets, freeze, versionReference: 'V_v70',
  }));
  assert.throws(() => verifyAfterState({
    after: stateFixture({deploymentId: prior.deployment, versionId: 'V_v70', rules: targetRules, bindings: beforeBindings}),
    config, origin, prior, deployment, addedSecrets, freeze, versionReference: 'V_v70',
  }));
});

test('transición rechaza reglas o secretos fuera del conjunto autorizado y argumentos antiguos', () => {
  const prior = priorFixture();
  const deployment = 'D_secret';
  const version = 'V_secret';
  const beforeBindings = expectedBindingsList(priorBindings, addedSecrets);
  const before = stateFixture({deploymentId: deployment, versionId: version, bindings: beforeBindings});
  const config = structuredClone(configV70);
  const args = beforeArguments({state: before, prior, config, deployment, version, rules: addedRules, secrets: addedSecrets});

  const extraRuleConfig = structuredClone(config);
  extraRuleConfig.assets.run_worker_first.push('/api/undeclared');
  assert.throws(() => verifyBeforeState({...args, config: extraRuleConfig}));

  const extraSecretBindings = [...beforeBindings, {name: 'UNDECLARED_SECRET', type: 'secret_text'}];
  const extraSecret = stateFixture({deploymentId: deployment, versionId: version, bindings: extraSecretBindings});
  assert.throws(() => verifyBeforeState({...args, state: extraSecret}));

  const missingSecretBindings = beforeBindings.filter(binding => binding.name !== addedSecrets[0]);
  const missingSecret = stateFixture({deploymentId: deployment, versionId: version, bindings: missingSecretBindings});
  assert.throws(() => verifyBeforeState({...args, state: missingSecret}));

  assert.throws(() => assertTransitionInputs({
    prior, deployment: prior.deployment, version, addedSecrets,
  }));
  assert.throws(() => assertTransitionInputs({
    prior, deployment, version: prior.version, addedSecrets,
  }));
});

