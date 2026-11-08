import { createServer } from 'node:http'
import { chromium } from 'playwright-core'

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; connect-src https://musicbrainz.org https://itunes.apple.com; script-src 'unsafe-inline'" })
  res.end('<!doctype html><title>Isolated catalog CORS check</title>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext()
  const page = await context.newPage()
  const diagnostics = []
  const headers = []
  page.on('response', response => { if (/^https:\/\/(musicbrainz\.org|itunes\.apple\.com)\//.test(response.url())) headers.push({url: response.url(), status: response.status(), acao: response.headers()['access-control-allow-origin'] ?? null}) })
  page.on('console', msg => { if (msg.type() === 'error') diagnostics.push(msg.text()) })
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  const result = await page.evaluate(async () => {
    const url = 'https://musicbrainz.org/ws/2/release/59211ea4-ffd2-4ad9-9a4e-941d3148024a?inc=recordings%2Bartist-credits&fmt=json'
    try {
      const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(15000) })
      const body = await response.json()
      return { status: response.status, type: response.type, responseUrl: response.url, contentType: response.headers.get('content-type'), bodyKeys: Object.keys(body).slice(0, 12), acao: response.headers.get('access-control-allow-origin'), id: body.id ?? null, media: Array.isArray(body.media) ? body.media.map(m => ({ position: m.position, count: m['track-count'], rows: m.tracks?.length ?? null })) : null }
    } catch (error) { return { error: String(error) } }
  })
  const itunes = await page.evaluate(async () => {
    try {
      const response = await fetch('https://itunes.apple.com/lookup?id=1440869641&entity=song&limit=200', { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(15000) })
      const body = await response.json()
      return { status: response.status, type: response.type, count: body.resultCount, collections: body.results?.filter(row => row.wrapperType === 'collection').map(row => ({ count: row.trackCount, id: row.collectionId })), tracks: body.results?.filter(row => row.wrapperType === 'track').map(row => ({ disc: row.discNumber, discs: row.discCount, position: row.trackNumber, count: row.trackCount, collection: row.collectionId })) }
    } catch (error) { return { error: String(error) } }
  })
  console.log(JSON.stringify({ musicbrainz: result, itunes, headers, diagnostics }, null, 2))
  await context.close()
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
