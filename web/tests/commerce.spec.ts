import { expect } from '@playwright/test'
import { test, installImageFixture } from './image-fixture'
import { fixtureProduct } from '../server/utils/commerce-fixtures'
import { readFile, readdir } from 'node:fs/promises'

test.describe('generated commerce build', () => {
  test.skip(process.env.FLAT_GIRL_TEST_COMMERCE !== 'true', 'Requires the explicit static commerce fixture build')

  test('production ignores scenario switches and makes a single validated checkout handoff', async ({ page }) => {
    const requests: string[] = []
    await page.route('https://commerce.invalid/commerce/**', async route => {
      requests.push(route.request().url())
      if (route.request().url().endsWith('/product')) return route.fulfill({ json: fixtureProduct('available') })
      expect(route.request().postDataJSON()).toEqual({ quantity: 2, expectedUnitPrice: { amount: '60.00', currencyCode: 'USD' } })
      return route.fulfill({ status: 201, json: { checkoutUrl: 'https://flatgirl.myshopify.com/checkout/fixture' } })
    })
    await page.route('https://flatgirl.myshopify.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Intercepted checkout</h1>' }))
    await page.goto('/?commerce=sold-out')
    await page.getByRole('button', { name: 'Increase quantity' }).click()
    await expect(page.getByLabel('Email address')).toHaveCount(0)
    await page.getByRole('button', { name: 'Buy now', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Intercepted checkout' })).toBeVisible()
    expect(requests).toEqual(['https://commerce.invalid/commerce/product', 'https://commerce.invalid/commerce/checkout'])
  })

  test('production rejects localhost checkout and does not enable sold-out subscriptions', async ({ page }) => {
    await page.route('https://commerce.invalid/commerce/product', route => route.fulfill({ json: fixtureProduct('available') }))
    await page.route('https://commerce.invalid/commerce/checkout', route => route.fulfill({ status: 201, json: { checkoutUrl: 'http://localhost:3000/api/commerce/mock-checkout?quantity=1' } }))
    await page.goto('/')
    await page.getByRole('button', { name: 'Buy now', exact: true }).click()
    await expect(page.locator('.purchase-message')).toContainText('Checkout could not open')
    await page.route('https://commerce.invalid/commerce/product', route => route.fulfill({ json: fixtureProduct('sold-out') }))
    await page.reload()
    await expect(page.locator('.stock')).toHaveText('Drop 1 - 0 of 500 Remaining')
    await expect(page.locator('.stock')).toHaveCSS('text-decoration-line', 'line-through')
    await expect(page.getByText("Email updates aren't available just yet. Please check back.")).toBeVisible()
    await expect(page.getByLabel('Email address')).toHaveCount(0)
  })

  test('page switches purchase and signup independently as availability changes', async ({ page }) => {
    let scenario = 'available'
    let reads = 0
    await page.route('https://commerce.invalid/commerce/product', route => {
      reads++
      return route.fulfill({ json: fixtureProduct(scenario) })
    })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Buy now', exact: true })).toBeEnabled()
    expect(reads).toBe(1)
    await expect(page.locator('.signup')).toHaveCount(0)
    await expect(page.locator('.stock')).toHaveCSS('text-decoration-line', 'none')
    await expect(page.locator('.purchase #fulfillment-note')).toBeVisible()

    scenario = 'sold-out'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('heading', { name: 'Get notified about what comes next' })).toBeFocused()
    await expect(page.locator('.purchase')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sold out', exact: true })).toBeDisabled()
    await expect(page.getByLabel('Selected quantity')).toHaveText('0')
    await expect(page.getByRole('button', { name: 'Decrease quantity' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Increase quantity' })).toBeDisabled()
    await expect(page.getByText('$60', { exact: true })).toBeVisible()
    await expect(page.locator('#fulfillment-note')).toHaveCount(0)
    await expect(page.locator('[aria-describedby="fulfillment-note"]')).toHaveCount(0)
    await expect(page.locator('.stock')).toHaveText('Drop 1 - 0 of 500 Remaining')
    await expect(page.locator('.stock')).toHaveCSS('text-decoration-line', 'line-through')

    scenario = 'closed'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('heading', { name: 'Get notified when we drop' })).toBeVisible()
    await expect(page.locator('.purchase')).toHaveCount(0)
    await expect(page.locator('.stock')).toHaveCount(0)

    scenario = 'available'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('button', { name: 'Buy now', exact: true })).toBeEnabled()
    await expect(page.locator('.signup')).toHaveCount(0)
  })

  test('generated policy routes load directly and have a working retry', async ({ page }) => {
    await page.route('https://commerce.invalid/commerce/policies/shipping-policy', route => route.fulfill({ json: {
      schemaVersion: 1, policy: { handle: 'shipping-policy', title: 'Shipping Policy', paragraphs: ['Shipping terms from the policy API.'] },
    } }))
    await page.goto('/policies/shipping-policy/')
    await expect(page.getByRole('heading', { name: 'Shipping Policy' })).toBeVisible()
    await expect(page.getByText('Shipping terms from the policy API.')).toBeVisible()
    await page.reload()
    await expect(page.getByText('Shipping terms from the policy API.')).toBeVisible()
  })

  test('without JavaScript the story, photos and checkout explanation remain', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false })
    await installImageFixture(context)
    const page = await context.newPage()
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Boring Flat Girl Plush Blanket')
    await expect(page.locator('noscript')).toBeVisible()
    await expect(page.locator('noscript')).toHaveJSProperty('textContent', 'Enable JavaScript to check availability and buy a blanket.')
    await expect(page.getByRole('button', { name: 'Buy now', exact: true })).toHaveCount(0)
    await context.close()
  })
})

test('generated client contains no local commerce fixtures or mock checkout routes', async () => {
  const files = await readdir('.output/public/_nuxt', { recursive: true })
  const source = (await Promise.all(files.filter(f => /\.(js|json)$/.test(f)).map(f => readFile(`.output/public/_nuxt/${f}`, 'utf8')))).join('\n')
  expect(source).not.toContain('quantityAvailable:327')
  expect(source).not.toContain('Local policy draft')
  expect(source).not.toContain('/api/commerce/mock-checkout')
  expect(source).not.toContain('quantity-changed')
  // The live variant ID is intentionally bundled by the public-token adapter.
})
