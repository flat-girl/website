import { expect } from '@playwright/test'
import { test, installImageFixture } from './image-fixture'

for (const width of [375, 1280]) {
  test(`carousel and image requests at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    const requests: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', msg => { if (msg.type() === 'error' || /hydration/i.test(msg.text())) errors.push(msg.text()) })
    page.on('response', response => { if (response.status() >= 400) errors.push(response.url()) })
    page.on('request', request => requests.push(request.url()))
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Boring Flat Girl')
    const front = page.getByAltText('Sarah, front view')
    const back = page.getByAltText('Sarah, back view')
    await expect(front).toBeVisible()
    await expect(back).toBeHidden()
    await expect(front).toHaveJSProperty('complete', true)
    expect(await front.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    expect(await front.evaluate((img: HTMLImageElement) => img.currentSrc)).toContain('-480.webp')
    await page.screenshot({ path: testInfo.outputPath('page.png'), fullPage: true })
    await page.getByRole('button', { name: 'Next', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(back).toBeVisible()
    await expect(page.getByRole('region', { name: 'Sarah front and back' }).getByRole('status')).toHaveText('2 of 2')
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(front).toBeVisible()
    await page.getByRole('button', { name: 'Previous' }).click()
    await expect(back).toBeVisible()
    expect(requests.some(url => url.includes('-1696.webp'))).toBe(false)
    const popupPromise = context.waitForEvent('page')
    await page.getByRole('link', { name: /Sarah, back view/ }).click()
    const popup = await popupPromise
    await popup.waitForLoadState()
    expect(popup.url()).toContain('-1696.webp')
    await expect(popup.locator('img')).toHaveJSProperty('naturalWidth', 1696)
    await popup.close()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })
}

test('dense phone display selects the larger variant', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 900 }, deviceScaleFactor: 2 })
  await installImageFixture(context)
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:3000/')
  const front = page.getByAltText('Sarah, front view')
  await expect(front).toHaveJSProperty('complete', true)
  expect(await front.evaluate((img: HTMLImageElement) => img.currentSrc)).toContain('-960.webp')
  await context.close()
})

test('HTML remains useful without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  await installImageFixture(context)
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:3000/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Boring Flat Girl')
  await expect(page.getByAltText('Sarah, front view')).toBeVisible()
  await expect(page.getByAltText('Sarah, back view')).toBeVisible()
  await expect(page.getByRole('link', { name: /View full size/ })).toHaveCount(2)
  await expect(page.getByRole('region', { name: 'Sarah front and back' }).getByRole('button')).toHaveCount(0)
  await context.close()
})
