import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { AlbumCatalog, parseAlbumDetail } from '../../src/library/album-catalog'

const collection = { wrapperType: 'collection', collectionType: 'Album', collectionId: 42, collectionName: 'Edition', artistName: 'Artist', trackCount: 3 }
const track = (disc: number, position: number, count: number, id = position) => ({ wrapperType: 'track', kind: 'song', collectionId: 42, trackId: id, discNumber: disc, discCount: 2, trackNumber: position, trackCount: count, trackName: `Track ${position}`, artistName: 'Artist', trackTimeMillis: null })
const body = () => ({ resultCount: 4, results: [{ ...collection }, track(2, 1, 1, 1), track(1, 2, 2, 1), track(1, 1, 2, 1)] })
const request = () => ({ signal: new AbortController().signal, current: () => true })

test('complete multidisc sorts positions and retains repeated recording occurrences', () => {
  const result = parseAlbumDetail(body(), 42)
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.value.tracks.map(t => [t.disc, t.position, t.trackId]), [[1, 1, 1], [1, 2, 1], [2, 1, 1]])
})
test('rejects missing, duplicate, incorrect edition and malformed fields', () => {
  const missing = body(); missing.results.pop(); missing.resultCount--
  assert.deepEqual(parseAlbumDetail(missing, 42), { ok: false, reason: 'incomplete' })
  const duplicate = body(); duplicate.results[2] = track(1, 1, 2)
  assert.deepEqual(parseAlbumDetail(duplicate, 42), { ok: false, reason: 'incomplete' })
  assert.equal(parseAlbumDetail(body(), 43).ok, false)
  const malformed = body(); malformed.results[1] = { ...track(2, 1, 1), trackName: '' }
  assert.equal(parseAlbumDetail(malformed, 42).ok, false)
})
test('construction, stale request and cache have no extra IO; endpoint is constrained', async () => {
  let calls = 0
  const fetcher: typeof fetch = async (url, options) => { calls++; assert.match(String(url), /^https:\/\/itunes\.apple\.com\/lookup\?/); assert.equal(options?.credentials, 'omit'); assert.equal(options?.redirect, 'error'); return new Response(JSON.stringify(body())) }
  const catalog = new AlbumCatalog(fetcher)
  assert.equal(calls, 0)
  assert.equal((await catalog.load(42, { ...request(), current: () => false })).ok, false)
  assert.equal((await catalog.load(42, request())).ok, true)
  assert.equal((await catalog.load(42, request())).ok, true)
  assert.equal(calls, 1)
})
test('aborted during fetch rejects stale body', async () => {
  const controller = new AbortController()
  const catalog = new AlbumCatalog(async () => { controller.abort(); return new Response(JSON.stringify(body())) })
  assert.deepEqual(await catalog.load(42, { signal: controller.signal, current: () => true }), { ok: false, reason: 'cancelled' })
})
test('stream over byte limit is cancelled and never parsed', async () => {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(1048577)) }, cancel() { cancelled = true } })
  const catalog = new AlbumCatalog(async () => new Response(stream))
  assert.deepEqual(await catalog.load(99, request()), { ok: false, reason: 'too-large' })
  assert.equal(cancelled, true)
})
test('direct input refuses getters, exotic prototypes, cycles, wrong kind and cross edition', () => {
  let invoked = false
  const accessor = body()
  Object.defineProperty(accessor.results[0], 'collectionName', { get() { invoked = true; return 'Edition' } })
  assert.equal(parseAlbumDetail(accessor, 42).ok, false)
  assert.equal(invoked, false)
  const exotic = body(); Object.setPrototypeOf(exotic.results[0], { inherited: true })
  assert.equal(parseAlbumDetail(exotic, 42).ok, false)
  const cycle = body(); Object.assign(cycle, { cycle })
  assert.equal(parseAlbumDetail(cycle, 42).ok, false)
  const wrong = body(); wrong.results[1] = { ...track(2, 1, 1), kind: 'music-video' }
  assert.equal(parseAlbumDetail(wrong, 42).ok, false)
  const cross = body(); cross.results[1] = { ...track(2, 1, 1), collectionId: 43 }
  assert.equal(parseAlbumDetail(cross, 42).ok, false)
})
test('declared primary artist and unknown duration are preserved in frozen DTOs', () => {
  const input = body()
  Object.assign(input.results[0], { artistId: 55 })
  Object.assign(input.results[1], { artistId: 55, artistName: 'Artist & Guest', trackTimeMillis: 0 })
  const result = parseAlbumDetail(input, 42)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.tracks[2].primaryArtist, 'Artist')
  assert.equal(result.value.tracks[2].artist, 'Artist & Guest')
  assert.equal(result.value.tracks[2].durationMs, null)
  assert.ok(Object.isFrozen(result.value.tracks[2]) && Object.isFrozen(result.value.tracks) && Object.isFrozen(result.value.edition))
})
test('throwing or non-boolean current fails closed without IO', async () => {
  let calls = 0
  const catalog = new AlbumCatalog(async () => { calls++; return new Response() })
  assert.deepEqual(await catalog.load(1, { ...request(), current: () => { throw Error('stale') } }), { ok: false, reason: 'cancelled' })
  assert.deepEqual(await catalog.load(1, { ...request(), current: () => 1 as unknown as boolean }), { ok: false, reason: 'cancelled' })
  assert.equal(calls, 0)
})

test('cancelled noncooperative fetch retains the global queue through late body cleanup and queued deadline', async () => {
  let deliver!: (response: Response) => void
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  let calls = 0
  let bodyCancelled = false
  const catalog = new AlbumCatalog(async () => { calls++; started(); return new Promise<Response>(resolve => { deliver = resolve }) })
  const controller = new AbortController()
  const first = catalog.load(201, { signal: controller.signal, current: () => true })
  await entered
  controller.abort()
  assert.deepEqual(await first, { ok: false, reason: 'cancelled' })
  const second = new AlbumCatalog(async () => { calls++; return new Response() })
  assert.deepEqual(await second.load(202, request()), { ok: false, reason: 'timeout' })
  assert.equal(calls, 1)
  deliver(new Response(new ReadableStream({ cancel() { bodyCancelled = true } })))
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(bodyCancelled, true)
  assert.equal(calls, 1)
})
test('title-only search uses US market and returns frozen copies', async () => {
  let requested = ''
  const catalog = new AlbumCatalog(async url => { requested = String(url); return new Response(JSON.stringify({ resultCount: 1, results: [collection] })) })
  const result = await catalog.search('Edition', null, request())
  assert.equal(result.ok, true)
  assert.equal(new URL(requested).searchParams.get('country'), 'US')
  assert.equal(new URL(requested).searchParams.get('term'), 'Edition')
  if (result.ok) assert.ok(Object.isFrozen(result.value) && Object.isFrozen(result.value[0]))
})
test('oversize response and rate limit are explicit', async () => {
  const huge = new AlbumCatalog(async () => new Response('x', { headers: { 'content-length': '1048577' } }))
  assert.deepEqual(await huge.load(42, request()), { ok: false, reason: 'too-large' })
  const throttled = new AlbumCatalog(async () => new Response('', { status: 429, headers: { 'retry-after': '20' } }))
  assert.deepEqual(await throttled.load(42, request()), { ok: false, reason: 'rate-limited' })
  const abort = new AbortController(); const pending = throttled.load(43, { signal: abort.signal, current: () => true }); abort.abort()
  assert.deepEqual(await pending, { ok: false, reason: 'cancelled' })
})


test('unknown Retry-After retains at least a minute across instances', async () => {
  const actualNow = Date.now
  let now = actualNow() + 30000
  Date.now = () => now
  try {
    let calls = 0
    const limited = new AlbumCatalog(async () => { calls++; return new Response('', { status: 429 }) })
    assert.deepEqual(await limited.load(301, request()), { ok: false, reason: 'rate-limited' })
    now += 59999
    const controller = new AbortController()
    const next = new AlbumCatalog(async () => { calls++; return new Response() }).load(302, { signal: controller.signal, current: () => true })
    await new Promise(resolve => setTimeout(resolve, 25))
    assert.equal(calls, 1)
    controller.abort()
    assert.deepEqual(await next, { ok: false, reason: 'cancelled' })
  } finally { Date.now = actualNow }
})
