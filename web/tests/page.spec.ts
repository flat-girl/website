import { expect } from '@playwright/test'
import { test, installImageFixture } from './image-fixture'

const photoNames = [
  'FlatGirl ShootA Couch04',
  'FlatGirl ShootA Chair04',
  'FlatGirl ShootA Rug02Front',
  'FlatGirl ShootA Rug02Back',
  'FlatGirl ShootA Bed02',
  'FlatGirl ShootA Chair03',
  'FlatGirl ShootA Outside01',
]

for (const width of [375, 1280]) {
  test(`carousel and image requests at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', msg => { if (msg.type() === 'error' || /hydration/i.test(msg.text())) errors.push(msg.text()) })
    page.on('response', response => { if (response.status() >= 400) errors.push(response.url()) })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Boring Flat Girl Plush Blanket')
    const carousel = page.getByRole('region', { name: 'Product photos' })
    expect(await carousel.locator('img').evaluateAll(images => images.map(image => image.alt))).toEqual(photoNames)
    const front = page.getByAltText(photoNames[0]!)
    const back = page.getByAltText(photoNames[1]!)
    await expect(front).toBeVisible()
    await expect(back).toBeHidden()
    await expect(front).toHaveJSProperty('complete', true)
    expect(await front.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    expect(await front.evaluate((img: HTMLImageElement) => img.currentSrc)).toContain('-480.webp')
    await page.screenshot({ path: testInfo.outputPath('page.png'), fullPage: true })
    await page.getByRole('button', { name: 'Next', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(back).toBeVisible()
    await expect(carousel.getByRole('status')).toHaveText('2 of 7')
    for (let index = 2; index < photoNames.length; index++) {
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await expect(page.getByAltText(photoNames[index]!)).toBeVisible()
      await expect(carousel.getByRole('status')).toHaveText(`${index + 1} of 7`)
    }
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(front).toBeVisible()
    await expect(carousel.getByRole('status')).toHaveText('1 of 7')
    await page.getByRole('button', { name: 'Previous' }).click()
    await expect(page.getByAltText(photoNames[6]!)).toBeVisible()
    await expect(carousel.getByRole('status')).toHaveText('7 of 7')
    await page.getByRole('link', { name: /View full size.*FlatGirl ShootA Outside01/ }).click()
    const viewer = page.getByRole('dialog', { name: 'Full-size photo viewer' })
    await expect(viewer).toBeVisible()
    await expect(viewer.getByRole('img', { name: photoNames[6]! })).toHaveJSProperty('naturalWidth', 1080)
    await viewer.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(viewer.getByRole('img', { name: photoNames[0]! })).toBeVisible()
    await viewer.getByRole('button', { name: 'Previous', exact: true }).click()
    await expect(viewer.getByRole('img', { name: photoNames[6]! })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
    await expect(page.getByRole('link', { name: /View full size.*FlatGirl ShootA Outside01/ })).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })
}

test('dense phone display selects the larger variant', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 900 }, deviceScaleFactor: 2 })
  await installImageFixture(context)
  const page = await context.newPage()
  await page.goto('/')
  const front = page.getByAltText(photoNames[0]!)
  await expect(front).toHaveJSProperty('complete', true)
  expect(await front.evaluate((img: HTMLImageElement) => img.currentSrc)).toContain('-960.webp')
  await context.close()
})

test('HTML remains useful without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false })
  await installImageFixture(context)
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Boring Flat Girl Plush Blanket')
  for (const name of photoNames) await expect(page.getByAltText(name)).toBeVisible()
  await expect(page.getByRole('link', { name: /View full size/ })).toHaveCount(7)
  await expect(page.getByRole('region', { name: 'Product photos' }).getByRole('button')).toHaveCount(0)
  await context.close()
})
