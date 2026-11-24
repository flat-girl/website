import { expect } from '@playwright/test'
import { test, installImageFixture } from './image-fixture'
import { signupEndpoint } from './signup-fixture'
import { readFile, readdir } from 'node:fs/promises'

test.describe('generated commerce build', () => {
  test.skip(process.env.FLAT_GIRL_TEST_COMMERCE !== 'true', 'Requires the explicit static commerce fixture build')

  const endpoint = 'https://tepwtx-zw.myshopify.com/api/2026-10/graphql.json'
  const variant = 'gid://shopify/ProductVariant/68124854681876'
  const pack = 'gid://shopify/ProductVariant/68279777100052'
  const product = (available = true) => ({ product: {
    id: 'gid://shopify/Product/15491665297684', title: 'Blanket',
    availableForSale: available, totalInventory: available ? 499 : 0,
    priceRange: {
      minVariantPrice: { amount: '60.00', currencyCode: 'USD' },
      maxVariantPrice: { amount: '60.00', currencyCode: 'USD' },
    },
  } })
  const cart = (quantity: number, checkoutUrl: string) => ({ cartCreate: { userErrors: [], warnings: [], cart: {
    checkoutUrl, totalQuantity: quantity * 2,
    lines: { nodes: [
      { quantity, merchandise: { id: variant }, cost: { totalAmount: { amount: String(quantity * 60), currencyCode: 'USD' } } },
      { quantity, merchandise: { id: pack }, cost: { totalAmount: { amount: '0', currencyCode: 'USD' } } },
    ] },
    cost: { subtotalAmount: { amount: String(quantity * 60), currencyCode: 'USD' } },
  } } })

  test.beforeEach(async ({ context }) => {
    // Abort all Shopify traffic unless an individual test explicitly intercepts it.
    await context.route('https://**.myshopify.com/**', route => route.abort())
    await context.route('**/api/commerce/**', route => { throw new Error('Unexpected private/mock fallback: ' + route.request().url()) })
  })

  test('public token ignores scenarios and makes one validated checkout handoff', async ({ page }) => {
    const operations: string[] = []
    await page.route(endpoint, async route => {
      expect(route.request().headers()['x-shopify-storefront-access-token']).toBe('test-public-token')
      expect(route.request().headers()['shopify-storefront-private-token']).toBeUndefined()
      const body = route.request().postDataJSON()
      if (body.query.includes('cartCreate')) {
        operations.push('cart')
        expect(body.variables.input).toEqual({ lines: [{ merchandiseId: variant, quantity: 2 }, { merchandiseId: pack, quantity: 2 }], buyerIdentity: { countryCode: 'US' } })
        return route.fulfill({ json: { data: cart(2, 'https://flatgirl.myshopify.com/checkout/fixture') } })
      }
      operations.push('product')
      return route.fulfill({ json: { data: product() } })
    })
    await page.route('https://flatgirl.myshopify.com/checkout/fixture', route => route.fulfill({ contentType: 'text/html', body: '<h1>Intercepted checkout</h1>' }))
    await page.goto('/?commerce=sold-out')
    await page.getByRole('button', { name: 'Increase quantity' }).click()
    await expect(page.getByLabel('Email address')).toHaveCount(0)
    await page.getByRole('button', { name: 'Buy now', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Intercepted checkout' })).toBeVisible()
    expect(operations).toEqual(['product', 'product', 'cart'])
  })

  test('public token rejects localhost checkout and sold-out signup reuses the existing request', async ({ page }) => {
    let available = true
    await page.route(endpoint, route => route.fulfill({ json: { data: route.request().postDataJSON().query.includes('cartCreate')
      ? cart(1, 'http://localhost:3000/api/commerce/mock-checkout?quantity=1') : product(available) } }))
    await page.goto('/')
    await page.getByRole('button', { name: 'Buy now', exact: true }).click()
    await expect(page.locator('.purchase-message')).toContainText('Checkout could not open')
    available = false
    await page.reload()
    await expect(page.getByText('Drop 2 - 0 of 500 Remaining', { exact: true })).toHaveCSS('text-decoration-line', 'line-through')
    await page.route(signupEndpoint, async route => {
      const body = route.request().postDataJSON()
      expect(Object.keys(body).sort()).toEqual(['email', 'turnstileToken', 'website'])
      expect(body.email).toBe('soldout@example.com')
      await route.fulfill({ json: { accepted: true } })
    })
    await page.getByLabel('Email address').fill('soldout@example.com')
    await page.getByRole('button', { name: 'Keep me posted' }).click()
    await expect(page.locator('.signup-success')).toBeVisible()
  })

  test('availability updates after returning from checkout', async ({ page }) => {
    let available = true
    await page.route(endpoint, route => route.fulfill({ json: { data: product(available) } }))
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Buy now', exact: true })).toBeEnabled()
    const firstDrop = page.getByText('Drop 1 - 0 of 500 Remaining', { exact: true })
    await expect(firstDrop).toHaveCSS('text-decoration-line', 'line-through')
    await expect(page.getByText('Drop 2 - 499 of 500 Remaining', { exact: true })).toHaveCSS('text-decoration-line', 'none')
    await expect(page.locator('.signup')).toHaveCount(0)
    available = false
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('heading', { name: 'Get notified about future drops' })).toBeFocused()
    await expect(page.getByRole('button', { name: 'Sold out', exact: true })).toBeDisabled()
    await expect(firstDrop).toHaveCSS('text-decoration-line', 'line-through')
    await expect(page.getByText('Drop 2 - 0 of 500 Remaining', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Selected quantity')).toHaveText('0')
    await expect(page.locator('#fulfillment-note')).toHaveCount(0)
    available = true
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('button', { name: 'Buy now', exact: true })).toBeEnabled()
    await expect(page.locator('.signup')).toHaveCount(0)
  })

  test('all generated policies support direct links, refresh and retry', async ({ page }) => {
    let failing = false
    await page.route(endpoint, route => {
      expect(route.request().postDataJSON().query).toContain('policy:')
      return failing ? route.fulfill({ status: 503 }) : route.fulfill({ json: { data: {
        shop: { policy: { title: 'Policy', body: '<p>Current Shopify policy.</p>' } },
      } } })
    })
    for (const handle of ['shipping-policy', 'privacy-policy', 'refund-policy', 'terms-of-service', 'contact-information']) {
      await page.goto(`/policies/${handle}/`)
      await expect(page.getByText('Current Shopify policy.')).toBeVisible()
      await page.reload()
      await expect(page.getByText('Current Shopify policy.')).toBeVisible()
    }
    failing = true
    await page.reload()
    await expect(page.getByText('This policy is currently unavailable. Please try again.')).toBeVisible()
    failing = false
    await page.getByRole('button', { name: 'Try again?' }).click()
    await expect(page.getByText('Current Shopify policy.')).toBeVisible()
  })

  test('public authorization failure never falls back to the private endpoint', async ({ page }) => {
    await page.route(endpoint, route => route.fulfill({ status: 401 }))
    await page.goto('/')
    await expect(page.getByText('Availability could not load. Please try again.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Buy now', exact: true })).toHaveCount(0)
  })

  test('without JavaScript the story, photos and checkout explanation remain', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false })
    await installImageFixture(context)
    const page = await context.newPage()
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Boring Flat Girl Plush Blanket')
    await expect(page.locator('noscript').filter({ hasText: 'Enable JavaScript to check availability and buy a blanket.' })).toBeVisible()
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
