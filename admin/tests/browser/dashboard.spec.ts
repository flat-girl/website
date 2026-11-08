import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const { createEdge } = createRequire(import.meta.url)('../../../cloud/aws/lambda/admin-auth.cjs')
import { demoMetrics } from '../../shared/demo'
const now = Date.parse('2026-11-08T20:25:00Z')
test('persisted dashboard views, weighted rates, environment isolation, responsive layout', async ({ page }) => {
  let scans = 0
  await page.route('**/api/metrics?*', route => route.fulfill({ json: demoMetrics(new URL(route.request().url()).searchParams.get('environment') || 'production', now) }))
  await page.route('**/api/rollups/ensure', route => { scans++; return route.fulfill({ json: demoMetrics('production', now) }) })
  await page.goto('/')
  const favicon = await page.locator('link[rel="icon"]').getAttribute('href')
  expect(favicon).toBeTruthy()
  const fixtureAuthorization = 'Basic local-route-fixture'
  const edge = createEdge({ read: async () => createHash('sha256').update(fixtureAuthorization).digest('hex') })
  const routed = await edge({ Records: [{ cf: { request: { uri: new URL(favicon!, page.url()).pathname, headers: {
    host: [{ value: 'admin.flatgirl.net' }], authorization: [{ value: fixtureAuthorization }],
  } } } }] })
  expect(routed.status).toBeUndefined()
  expect((await page.request.get(favicon!)).status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Signup dashboard' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hourly activity' })).toBeVisible()
  await page.getByRole('button', { name: 'Week', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Daily activity' })).toBeVisible()
  await page.getByRole('button', { name: 'All time', exact: true }).click()
  await page.getByLabel('Cumulative totals').check()
  await expect(page.getByRole('heading', { name: 'Cumulative growth' })).toBeVisible()
  await page.getByRole('button', { name: 'Event rate', exact: true }).first().click()
  await page.getByText('View data table', { exact: true }).first().click()
  await expect(page.getByRole('table').first()).toBeVisible()
  await page.getByLabel('View counting').selectOption('total')
  await expect(page.getByText('Total views · all time', { exact: true })).toBeVisible()
  await page.getByLabel('View counting').selectOption('unique')
  await expect(page.getByText('Est. unique views · all time', { exact: true })).toBeVisible()
  expect(scans).toBe(0)
  await page.getByLabel('Environment').selectOption('beta')
  await expect(page.getByRole('status')).toContainText('Viewing')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/flat-girl-admin-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.screenshot({ path: '/tmp/flat-girl-admin-desktop.png', fullPage: true })
})
test('missing rollup shows mutex/update/viewing states and cached DLQ failures are unavailable', async ({ page }) => {
  let ensures = 0
  await page.route('**/api/metrics?*', route => route.fulfill({ json: { state: 'missing', data: null, dlq: null } }))
  await page.route('**/api/rollups/ensure', async route => {
    ensures++
    if (ensures === 1) return route.fulfill({ status: 202, json: { state: 'waiting', retryAfterMs: 500 } })
    if (ensures === 2) return route.fulfill({ status: 202, json: { state: 'updating', pages: 1, retryAfterMs: 500 } })
    const result = demoMetrics('production', now); result.dlq = { error: true, stale: false, freshUntil: now + 60000 }
    return route.fulfill({ json: result })
  })
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('Waiting for rollup mutex')
  await expect(page.getByRole('status')).toContainText('Updating dashboard data')
  await expect(page.getByRole('status')).toContainText('Viewing')
  await expect(page.getByText('Unavailable', { exact: true })).toBeVisible()
  expect(ensures).toBe(3)
})
test('failed refresh keeps the previous metrics and does not display a false zero', async ({ page }) => {
  let calls = 0
  await page.route('**/api/metrics?*', route => ++calls === 1 ? route.fulfill({ json: demoMetrics('production', now) }) : route.fulfill({ status: 503, json: { error: 'unavailable' } }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Hourly activity' })).toBeVisible()
  await page.getByRole('button', { name: '↻ Refresh' }).click()
  await expect(page.getByRole('status')).toContainText('Could not update')
  await expect(page.getByRole('heading', { name: 'Hourly activity' })).toBeVisible()
})
test('browser reuses Basic Auth on same-origin native fetch without a JavaScript password', async ({ browser }) => {
  const authorization = 'Basic ' + Buffer.from('admin:browser-fixture-only').toString('base64')
  let apiHeader = ''
  const server = createServer((req, res) => {
    if (req.headers.authorization !== authorization) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Flat Girl Admin"' }); res.end(); return }
    if (req.url === '/api/metrics') { apiHeader = req.headers.authorization; res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); return }
    res.setHeader('content-type', 'text/html'); res.end('<p id="status">loading</p><script>fetch("/api/metrics",{credentials:"same-origin"}).then(r=>r.json()).then(x=>document.querySelector("#status").textContent=x.ok?"ready":"error")</script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const context = await browser.newContext({ httpCredentials: { username: 'admin', password: 'browser-fixture-only' } })
  try { const page = await context.newPage(); await page.goto(`http://127.0.0.1:${address.port}`); await expect(page.locator('#status')).toHaveText('ready'); expect(apiHeader).toBe(authorization) }
  finally { await context.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
