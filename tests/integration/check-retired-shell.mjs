// Real browsers and production navigation/update handlers on a synthetic origin.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {chromium, webkit} from 'playwright-core';
import {build} from 'vite';
import {shellAssetRequest} from '../../deployment/cloudflare/navigation.mjs';
import {chromiumPath} from '../../scripts/chromium-path.mjs';

const old = '1111111111111111', current = '2222222222222222';
const entry = version => `/releases/${version}.html`;
const js = version => `/assets/index-${version}.js`;
const moduleFiles = ['/', entry(old), js(old)];
const csp = "default-src 'self'; script-src 'self'; worker-src 'self'; object-src 'none'";
const listen = server => new Promise(done => server.listen(0, '127.0.0.1', done));

async function bundle(source, define = {}) {
  const result = await build({
    configFile: false, publicDir: false, logLevel: 'error', define,
    build: {write: false, lib: {entry: resolve(source), formats: ['es']}},
  });
  return result[0].output.find(item => item.type === 'chunk').code;
}

const worker = (await bundle('src/service-worker/sw.ts', {SHELL_FILES: JSON.stringify(moduleFiles)}))
  .replaceAll('pulso-shell-BUILD_ID', 'pulso-shell-' + old);
const updater = await bundle('src/service-worker/automatic-update.ts');
assert.ok(chromiumPath, 'Chromium requerido');
const outcomes = [];
for (const [name, driver, options] of [
  ['Chromium', chromium, {executablePath: chromiumPath, chromiumSandbox: true}],
  ['WebKit', webkit, {}],
]) {
  let version = old;
  const server = createServer((request, response) => {
    const original = new Request(origin + request.url, {headers: request.headers});
    const path = new URL(shellAssetRequest(original).url).pathname;
    const html = '<!doctype html><meta charset="utf-8"><div id="root"></div>' +
      `<script type="module" src="${js(version)}"></script>`;
    const script = `
      import {createAutomaticUpdater} from '/automatic-update.js';
      document.querySelector('#root').textContent = ${JSON.stringify(version)};
      let time = 0;
      const core = createAutomaticUpdater({
        origin: location.origin, bundle: new URL(import.meta.url).pathname,
        fetcher: (...args) => fetch(...args), session: sessionStorage,
        ready: () => true, prepare: async () => true, enter: () => () => {},
        navigate: path => location.replace(path), reload: () => location.reload(),
        pending: () => {}, now: () => time, quietMs: 1,
      });
      window.checkVersion = async () => {
        await core.check(); await core.tick(); time += 2; await core.tick();
      };
    `;
    const routes = {
      '/': ['text/html', html],
      [entry(version)]: ['text/html', html],
      [js(version)]: ['text/javascript', script],
      '/latest.json': ['application/json', JSON.stringify({version: 1, entry: entry(version)})],
      '/automatic-update.js': ['text/javascript', updater],
      '/sw.js': ['text/javascript', worker],
    };
    const route = routes[path];
    if (!route) return response.writeHead(404, {'Cache-Control': 'no-store'}).end();
    response.writeHead(200, {'Content-Type': route[0], 'Content-Security-Policy': csp, 'Cache-Control': 'no-store'});
    response.end(route[1]);
  });
  await listen(server);
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser, context;
  try {
    browser = await driver.launch({headless: true, ...options});
    context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    context.on('page', tab => tab.on('pageerror', error => errors.push(error.message)));
    await page.goto(origin + entry(old));
    await page.waitForFunction(expected => document.querySelector('#root')?.textContent === expected, old);
    await page.evaluate(() => navigator.serviceWorker.register('/sw.js', {type: 'module'}).then(() => undefined));
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.evaluate(() => localStorage.setItem('retention-test', 'preserved'));

    version = current;
    for (const path of [entry(old), js(old)]) assert.equal((await context.request.get(origin + path)).status(), 404);
    const guest = await browser.newContext({serviceWorkers: 'block'});
    try {
      const fresh = await guest.newPage();
      fresh.setDefaultTimeout(12000);
      const navigation = await fresh.goto(origin + entry(old));
      assert.equal(navigation.status(), 200);
      assert.equal(navigation.fromServiceWorker(), false);
      await fresh.waitForFunction(expected => document.querySelector('#root')?.textContent === expected, current);
    } finally {
      await guest.close();
    }
    const shortcut = await context.newPage();
    shortcut.setDefaultTimeout(12000);
    const navigation = await shortcut.goto(origin + entry(old));
    assert.equal(navigation.status(), 200);
    assert.equal(navigation.fromServiceWorker(), true);
    await shortcut.waitForFunction(expected => document.querySelector('#root')?.textContent === expected, current);
    assert.equal(await shortcut.evaluate(() => localStorage.getItem('retention-test')), 'preserved');

    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await page.evaluate(() => window.checkVersion());
    await page.waitForURL(origin + entry(current));
    await page.waitForFunction(expected => document.querySelector('#root')?.textContent === expected, current);
    await page.evaluate(async () => { await window.checkVersion(); await window.checkVersion(); });
    assert.equal(navigations, 1);
    assert.deepEqual(errors, []);
    outcomes.push({engine: name, version: browser.version(), retiredFiles: 404, updateNavigations: navigations});
  } finally {
    try {
      await context?.close();
      await browser?.close();
    } finally {
      await new Promise(done => server.close(done));
    }
  }
}
console.log(JSON.stringify(outcomes));
