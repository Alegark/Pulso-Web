// Isolated presentation build only. Fresh loopback port and sandboxed headless Chromium.
import assert from 'node:assert/strict';
import {build, preview} from 'vite';
import {chromium} from 'playwright-core';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dir = '.local/bot-providers-panel-current';
const evidence = '.local/evidence/bot-providers-panel-current.json';
const report = {passed: false, cases: [], errors: [], external: [], attempts: [], limits: [
  'Synthetic props and callbacks only; no SDK, Telegram, real profiles, compatibility, musical search/download or account.',
  'Desktop sandboxed Chromium; no iPhone/Safari/VoiceOver, actual touch or real zoom. 200% uses CSS root font enlargement.',
  'No product integration/build/publication or acceptance of P0-W/T4/T9.'
]};
try { const old = JSON.parse(await readFile(evidence, 'utf8')); report.attempts = [...old.attempts, ...(old.failure ? [{failure: old.failure, cases: old.cases}] : [])]; } catch {}
await mkdir(dir, {recursive: true});
await mkdir('.local/evidence', {recursive: true});
const pass = name => { report.cases.push(name); console.log('PASS ' + name); };
let browser, context, server, page;
const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const host = async (method, ...args) => { await page.evaluate(({method, args}) => window.botPanelHost[method](...args), {method, args}); await frames(); };
const calls = () => page.evaluate(() => window.botPanelHost.calls);
const input = () => page.getByLabel('@usuario o enlace público de Telegram', {exact: true});
const button = name => page.getByRole('button', {name, exact: true});
const order = () => page.locator('[data-bot-row]').evaluateAll(elements => elements.map(e => e.dataset.botRow));
const active = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id);
// Read React's actual committed DOM event props; no copied implementation callbacks.
const saveHandler = async (selector, event, slot) => page.evaluate(({selector, event, slot}) => {
 const element = document.querySelector(selector);
 const key = Object.keys(element).find(key => key.startsWith('__reactProps$'));
 window[slot] = {handler: element[key][event], element};
}, {selector, event, slot});
const invoke = async slot => { await page.evaluate(slot => window[slot].handler({preventDefault() {}, currentTarget: window[slot].element}), slot); await frames(); };
try {
 await writeFile(`${dir}/fixture.html`, '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/tests/integration/check-bot-providers-panel-fixture.tsx"></script></html>');
 await build({configFile: false, logLevel: 'error', build: {outDir: `${dir}/build`, emptyOutDir: true, rolldownOptions: {input: `${dir}/fixture.html`}}});
 server = await preview({configFile: false, build: {outDir: `${dir}/build`}, preview: {host: '127.0.0.1', port: 0, strictPort: true}});
 const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
 browser = await chromium.launch({executablePath: '/usr/bin/chromium', headless: true, chromiumSandbox: true});
 report.browser = browser.version();
 context = await browser.newContext({serviceWorkers: 'block', viewport: {width: 900, height: 700}});
 await context.route('**/*', route => {
   if (new URL(route.request().url()).origin === origin) return route.continue();
   report.external.push(route.request().url()); return route.abort();
 });
 await context.addInitScript(() => {
   window.panelIO = [];
   const deny = name => (..._args) => { window.panelIO.push(name); throw Error('Unexpected panel IO: ' + name); };
   window.fetch = deny('fetch'); window.XMLHttpRequest = deny('XHR'); window.WebSocket = deny('WebSocket');
   window.EventSource = deny('EventSource'); navigator.sendBeacon = deny('beacon');
   Storage.prototype.setItem = deny('storage.setItem'); Storage.prototype.getItem = deny('storage.getItem');
   Storage.prototype.removeItem = deny('storage.removeItem'); Storage.prototype.clear = deny('storage.clear');
   indexedDB.open = deny('indexedDB.open'); indexedDB.deleteDatabase = deny('indexedDB.deleteDatabase');
   navigator.storage.getDirectory = deny('OPFS');
 });
 page = await context.newPage(); page.setDefaultTimeout(7000);
 page.on('pageerror', error => report.errors.push(error.stack));
 await page.goto(`${origin}/${dir}/fixture.html`);
 await page.waitForFunction(() => window.botPanelHost);
 assert.deepEqual(await calls(), []); assert.deepEqual(await order(), []);
 assert.ok(await page.getByText('Aún no has añadido bots.', {exact: false}).isVisible());
 assert.equal(await input().inputValue(), '');
 assert.equal(await button('Comprobar y añadir').isDisabled(), true);
 assert.deepEqual(await page.evaluate(() => window.panelIO), []);
 pass('initial zero rows, no defaults, actionable empty state and zero mount callbacks/network/storage');
 assert.deepEqual(await page.locator('[aria-label=\"Sugerencias de bots\"] button').allTextContents(), ['@KDMusic_Bot', '@DeezerMusicBot']);
 await button('Usar sugerencia @KDMusic_Bot').click(); assert.equal(await input().inputValue(), '@KDMusic_Bot');
 await button('Usar sugerencia @DeezerMusicBot').click(); assert.equal(await input().inputValue(), '@DeezerMusicBot');
 assert.deepEqual(await calls(), []); assert.deepEqual(await order(), []);
 await input().fill(' https://t.me/another_fixturebot ');
 assert.deepEqual(await calls(), []);
 await button('Comprobar y añadir').focus(); await page.keyboard.press('Enter');
 assert.deepEqual(await calls(), [['add', 'https://t.me/another_fixturebot']]);
 assert.deepEqual(await order(), []);
 assert.deepEqual(await page.evaluate(() => window.panelIO), []);
 pass('suggestions/fill perform no IO/callback; explicit keyboard submit emits trimmed public input once, rows stay controlled');
 await host('reset'); await host('seed', 5);
 await button('Usar sugerencia @KDMusic_Bot').click();
 assert.equal(await input().inputValue(), '@KDMusic_Bot'); assert.equal(await button('Comprobar y añadir').isDisabled(), true);
 await page.locator('form').evaluate(form => form.requestSubmit());
 assert.deepEqual(await calls(), []); assert.equal((await order()).length, 5);
 assert.ok(await page.getByText('Has alcanzado el límite de 5 bots.', {exact: false}).isVisible());
 pass('confirmed five rows prevent sixth add including form submit after suggestion; explicit limit');
 await host('reset'); await host('seed', 3);
 assert.equal(await button('Subir @fixture0bot').isDisabled(), true);
 assert.equal(await button('Bajar @fixture2bot').isDisabled(), true);
 await button('Subir @fixture1bot').click();
 assert.deepEqual(await calls(), [['move', 'id-1', 'up']]);
 assert.deepEqual(await order(), ['id-0', 'id-1', 'id-2']);
 await host('confirmMove', 'id-1', 'up');
 assert.deepEqual(await order(), ['id-1', 'id-0', 'id-2']);
 assert.equal(await active(), 'Bajar @fixture1bot');
 assert.deepEqual(await page.locator('.bot-providers-priority').allTextContents(), ['Principal', 'Secundario', '3.º']);
 await button('Bajar @fixture0bot').click(); await host('confirmMove', 'id-0', 'down');
 assert.deepEqual(await order(), ['id-1', 'id-2', 'id-0']);
 assert.equal(await active(), 'Subir @fixture0bot');
 pass('up/down use stable IDs, obey boundaries, wait for confirmed props, update ordinals and preserve useful focus');
 await button('Quitar @fixture2bot').click(); assert.equal((await order()).length, 3);
 await host('confirmRemove', 'id-2'); assert.equal(await active(), 'Quitar @fixture0bot');
 await button('Quitar @fixture0bot').click(); await host('confirmRemove', 'id-0');
 assert.equal(await active(), 'Quitar @fixture1bot');
 await button('Quitar @fixture1bot').click(); await host('confirmRemove', 'id-1');
 assert.equal(await input().evaluate(e => e === document.activeElement), true);
 pass('confirmed deletion focuses successor, predecessor, then form input with zero optimistic deletion');
 for (const interaction of ['Tab', 'pointer', 'focus', 'same-origin-pointer']) {
   await host('reset'); await host('seed', 3);
   await button('Quitar @fixture1bot').click();
   if (interaction === 'Tab') await page.keyboard.press('Tab');
   if (interaction === 'pointer') await button('Otro control').click();
   if (interaction === 'focus') await input().focus();
   if (interaction === 'same-origin-pointer') await button('Quitar @fixture1bot').dispatchEvent('pointerdown');
   const before = await active();
   await host('confirmRemove', 'id-1');
   assert.equal(await active(), interaction === 'same-origin-pointer' ? '' : before);
 }
 pass('delayed remove never steals focus after Tab, outside pointer, other focus or later pointer on origin');
 await host('reset'); await host('seed', 3);
 await button('Subir @fixture1bot').click(); await button('Otro control').click();
 await host('confirmMove', 'id-1', 'up'); assert.equal(await active(), 'outside');
 await button('Quitar @fixture1bot').click(); await host('invalidate'); await host('confirmRemove', 'id-1');
 assert.equal(await active(), '');
 pass('delayed reorder and revoked original capture do not relocate focus');
 await host('reset'); await host('seed', 3);
 await button('Quitar @fixture1bot').click();
 await host('set', {pending: true});
 await host('set', {pending: false, error: 'Cambio cancelado.'});
 await host('confirmRemove', 'id-1');
 assert.equal(await active(), '');
 pass('failed/cancelled pending action retires focus intent before any later unrelated confirmation');
 await host('reset'); await host('seed', 2);
 await saveHandler('[data-bot-row="id-0"] [data-bot-action="up"]', 'onClick', 'boundaryUp');
 await saveHandler('[data-bot-row="id-1"] [data-bot-action="down"]', 'onClick', 'boundaryDown');
 await invoke('boundaryUp'); await invoke('boundaryDown'); assert.deepEqual(await calls(), []);
 pass('actual disabled boundary handlers also deny out-of-range moves');
 await host('reset'); await host('seed', 2); await input().fill('@old_fixturebot');
 await saveHandler('form', 'onSubmit', 'oldAdd');
 await saveHandler('[data-bot-row="id-0"] [data-bot-action="down"]', 'onClick', 'oldMove');
 await saveHandler('[data-bot-row="id-0"] [data-bot-action="remove"]', 'onClick', 'oldRemove');
 await host('invalidate'); await host('fresh');
 for (const slot of ['oldAdd', 'oldMove', 'oldRemove']) await invoke(slot);
 assert.deepEqual(await calls(), []);
 await button('Comprobar y añadir').click(); assert.deepEqual(await calls(), [['add', '@old_fixturebot']]);
 await host('reset'); await host('seed', 2); await input().fill('@scope_draftbot');
 await saveHandler('form', 'onSubmit', 'scopeAdd');
 await host('retireScope'); assert.equal(await input().inputValue(), ''); await invoke('scopeAdd');
 assert.deepEqual(await calls(), []);
 pass('actual old React handlers keep original authority after fresh render; scope switch synchronously clears draft and denies old submit');
 await host('reset'); await host('seed', 2); await input().fill('@fixturebot');
 await saveHandler('form', 'onSubmit', 'gateAdd');
 await saveHandler('[data-bot-row="id-0"] [data-bot-action="down"]', 'onClick', 'gateMove');
 await saveHandler('[data-bot-row="id-0"] [data-bot-action="remove"]', 'onClick', 'gateRemove');
 for (const patch of [{canEdit: false}, {canEdit: true, pending: true}, {canEdit: true, pending: false, revision: 42}]) {
   await host('set', patch);
   for (const slot of ['gateAdd', 'gateMove', 'gateRemove']) await invoke(slot);
 }
 assert.deepEqual(await calls(), []);
 await host('set', {pending: true, canEdit: false, error: 'No se pudo comprobar el perfil.'});
 await host('invalidate'); await button('Cancelar cambio').click(); assert.deepEqual(await calls(), [['cancel']]);
 assert.equal(await page.locator('section').getAttribute('aria-busy'), 'true');
 assert.equal(await page.getByRole('alert').textContent(), 'No se pudo comprobar el perfil.');
 await host('set', {pending: false, notice: 'Orden actualizado.'});
 assert.equal(await page.getByRole('status').textContent(), 'Orden actualizado.');
 assert.equal(await button('Cancelar cambio').count(), 0);
 pass('stale callbacks deny closed edit/pending/revision gates; cancel remains usable with canEdit false and revoked authority; controlled status/error');
 await host('reset');
 await host('set', {rows: [{id: 'hostile-"[]', username: '<script>fixture</script>' + 'long'.repeat(50), label: '<img src=x onerror=alert(1)>' + 'Nombre'.repeat(90), profileStatus: 'verified', compatibility: 'unsupported'}], revision: 1});
 assert.equal(await page.locator('section a, section img, section script').count(), 0);
 assert.equal(await page.locator('.bot-providers-name bdi').count(), 2);
 assert.equal(await page.locator('.bot-providers-name bdi').first().getAttribute('dir'), 'auto');
 assert.ok((await page.locator('section').textContent()).includes('<img src=x onerror=alert(1)>'));
 assert.ok((await page.locator('section').textContent()).includes('Perfil comprobado. Búsqueda musical no compatible.'));
 pass('hostile/long labels and handles render as inert isolated text, no links or HTML; verified profile never implies musical support');
 report.layout = [];
 for (const [width, height, scale] of [[320,568,100], [320,568,200], [568,320,200]]) {
   await page.setViewportSize({width, height});
   await page.evaluate(scale => { document.documentElement.style.fontSize = scale + '%'; }, scale);
   await frames();
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   for (const target of await page.locator('.bot-providers button, .bot-providers input').all()) {
     const box = await target.boundingBox(); assert.ok(box.height >= 44 && box.width >= 44, JSON.stringify(box));
     if (await target.isEnabled()) {
       await target.focus(); await frames();
       const reachable = await target.evaluate(e => {const b = e.getBoundingClientRect(); const x = b.x+b.width/2, y=b.y+b.height/2; const hit = document.elementFromPoint(x,y); return b.left >= 0 && b.right <= innerWidth && y >= 0 && y <= innerHeight && (hit === e || e.contains(hit));});
       assert.ok(reachable, await target.getAttribute('aria-label'));
     }
   }
   report.layout.push({width, height, fontPercent: scale, overflow: false, targetsAtLeast44: true});
 }
 pass('320px and 568x320 with 200% font: long names wrap, no horizontal overflow, controls >=44px and reachable by keyboard');
 assert.deepEqual(await page.evaluate(() => window.panelIO), []);
 assert.deepEqual(report.errors, []); assert.deepEqual(report.external, []);
 await host('reset'); await host('seed', 2);
 await saveHandler('[data-bot-row="id-0"] [data-bot-action="remove"]', 'onClick', 'unmounted');
 await host('unmount'); await invoke('unmounted'); assert.deepEqual(await calls(), []);
 pass('unmounted actual handler cannot mutate; zero instrumented IO/errors/external attempts across suite');
 report.passed = true;
} catch (error) {
 report.failure = {message: error.message, stack: error.stack}; process.exitCode = 1;
} finally {
 await context?.close(); await browser?.close();
 if (server) await new Promise(resolve => server.httpServer.close(resolve));
 report.cleanup = {contextClosed: !context || !context.pages().length, browserClosed: !browser || !browser.isConnected(), serverClosed: !server?.httpServer.listening};
 report.sources = {};
 for (const path of ['src/ui/BotProvidersPanel.tsx','src/ui/bot-providers.css','tests/integration/check-bot-providers-panel-fixture.tsx','tests/integration/check-bot-providers-panel.mjs']) {
   const bytes = await readFile(path); report.sources[path] = {bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
 }
 await writeFile(evidence, JSON.stringify(report, null, 2) + '\n');
 console.log(JSON.stringify({passed: report.passed, cases: report.cases.length, failure: report.failure, evidence}));
}
