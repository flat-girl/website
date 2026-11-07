import { expect } from '@playwright/test'
import { test, installImageFixture } from './image-fixture'

test('desktop photo viewer supports click, drag, wheel, keyboard, and focus restoration', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await page.getByRole('link', { name: /View full size.*FlatGirl ShootA Couch04/ }).click()
  const viewer = page.getByRole('dialog', { name: 'Full-size photo viewer' })
  const stage = viewer.locator('.viewer-stage')
  const photo = viewer.getByRole('img', { name: 'FlatGirl ShootA Couch04' })
  await expect(viewer.getByRole('button', { name: 'Close' })).toBeFocused()
  await expect(photo).toHaveJSProperty('naturalWidth', 1080)
  const initial = (await photo.boundingBox())!
  await stage.click()
  await expect.poll(async () => (await photo.boundingBox())!.width).toBeGreaterThan(initial.width * 1.9)
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click()
  const beforePan = (await photo.boundingBox())!
  const bounds = (await stage.boundingBox())!
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x + 100, center.y + 70, { steps: 8 })
  await page.mouse.up()
  const afterPan = (await photo.boundingBox())!
  expect(afterPan.x).toBeGreaterThan(beforePan.x + 50)
  expect(afterPan.y).toBeGreaterThan(beforePan.y + 40)
  await page.mouse.wheel(0, -200)
  await expect.poll(async () => (await photo.boundingBox())!.width).toBeGreaterThan(afterPan.width)
  await page.keyboard.press('0')
  await expect.poll(async () => (await photo.boundingBox())!.width).toBeCloseTo(initial.width, 0)
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(viewer.getByRole('button', { name: 'Zoom out', exact: true })).toBeEnabled()
  await page.keyboard.press('ArrowRight')
  await expect(viewer.getByRole('img', { name: 'FlatGirl ShootA Chair04' })).toBeVisible()
  await expect(viewer.getByRole('button', { name: 'Zoom out', exact: true })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('viewer.png') })
  // Native modal focus must remain inside the viewer.
  await viewer.getByRole('button', { name: 'Next', exact: true }).focus()
  await page.keyboard.press('Tab')
  expect(await viewer.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(page.getByRole('link', { name: /View full size.*FlatGirl ShootA Chair04/ })).toBeFocused()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
})

test('phone photo viewer supports real two-finger pinch and one-finger pan', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
  await installImageFixture(context)
  const page = await context.newPage()
  await page.goto('/')
  await page.getByRole('link', { name: /View full size.*FlatGirl ShootA Couch04/ }).tap()
  const viewer = page.getByRole('dialog', { name: 'Full-size photo viewer' })
  const photo = viewer.getByRole('img', { name: 'FlatGirl ShootA Couch04' })
  await expect(photo).toHaveJSProperty('naturalWidth', 1080)
  const initial = (await photo.boundingBox())!
  const bounds = (await viewer.locator('.viewer-stage').boundingBox())!
  const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2
  const client = await context.newCDPSession(page)
  const fingers = (distance: number) => [{ x: cx - distance, y: cy, id: 1 }, { x: cx + distance, y: cy, id: 2 }]
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(45) })
  for (const distance of [55, 70, 85, 100]) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(distance) })
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(async () => (await photo.boundingBox())!.width).toBeGreaterThan(initial.width * 2)
  const beforePan = (await photo.boundingBox())!
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + 60, y: cy + 40, id: 1 }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(async () => (await photo.boundingBox())!.x).toBeGreaterThan(beforePan.x + 30)
  await viewer.getByRole('button', { name: 'Next', exact: true }).tap()
  await expect(viewer.getByRole('img', { name: 'FlatGirl ShootA Chair04' })).toBeVisible()
  await expect(viewer.getByRole('button', { name: 'Zoom out', exact: true })).toBeDisabled()
  await viewer.getByRole('button', { name: 'Close' }).tap()
  await expect(viewer).toHaveCount(0)
  await context.close()
})

test('small photos finish before full-size background preloading starts', async ({ page }) => {
  const smallRequested = new Set<string>()
  const smallFinished = new Set<string>()
  const largeRequested = new Set<string>()
  let firstLargeSmallCount = -1
  let release = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.addInitScript(() => { (window as any).__initialLoadDone = false; window.addEventListener('load', () => { (window as any).__initialLoadDone = true }) })
  await page.route(/-(480|960)\.webp$/, async route => {
    smallRequested.add(route.request().url())
    if (!route.request().url().includes('couch04')) await pending
    await route.fallback()
  })
  page.on('requestfinished', request => {
    if (/-(480|960)\.webp$/.test(request.url())) smallFinished.add(request.url())
  })
  page.on('request', request => {
    if (!request.url().endsWith('-1080.webp')) return
    if (!largeRequested.size) firstLargeSmallCount = smallFinished.size
    largeRequested.add(request.url())
  })
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect.poll(() => smallRequested.size).toBe(7)
    expect(largeRequested.size).toBe(0)
    release()
    await expect.poll(() => largeRequested.size).toBe(7)
    expect(firstLargeSmallCount).toBe(7)
    expect(await page.evaluate(() => (window as any).__initialLoadDone)).toBe(true)
  } finally { release() }
})

test('viewer keeps a preview and navigation when a full-size image fails', async ({ page }) => {
  await page.route('**/*-1080.webp', route => route.abort())
  await page.goto('/')
  await page.getByRole('link', { name: /View full size.*FlatGirl ShootA Couch04/ }).click()
  const viewer = page.getByRole('dialog', { name: 'Full-size photo viewer' })
  await expect(viewer.getByText('Full-size photo could not load. Showing preview.')).toBeVisible()
  const preview = viewer.locator('img[aria-hidden="true"]')
  await expect(preview).toHaveJSProperty('complete', true)
  expect(await preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  expect(await preview.evaluate((image: HTMLImageElement) => image.currentSrc)).toContain('-480.webp')
  await viewer.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(viewer.getByText('2 of 7')).toBeVisible()
  await viewer.getByRole('button', { name: 'Close' }).click()
  await expect(viewer).toHaveCount(0)
})
