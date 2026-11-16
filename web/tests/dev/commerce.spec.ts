import { expect, test } from '@playwright/test'
import { createWidgetScript } from '../signup-fixture'
import { fixtureProduct } from '../../server/utils/commerce-fixtures'

test.beforeEach(async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/**', route => route.fulfill({
    contentType: 'application/javascript', body: createWidgetScript('XXXX.DUMMY.TOKEN.XXXX'),
  }))
})

for (const width of [375, 1280]) {
  test(`minimal purchase page and keyboard quantity controls at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', msg => { if (/hydration/i.test(msg.text())) errors.push(msg.text()) })
    await page.goto('/')
    await expect(page.getByText('$60', { exact: true })).toBeVisible()
    await expect(page.getByText('327 of 500 remaining')).toBeVisible()
    await expect(page.getByText('Free Shipping!', { exact: true })).toBeVisible()
    await expect(page.getByText(/Shop Pay/)).toHaveCount(0)
    await expect(page.getByLabel('Email address')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__signupWidgets)).toBeUndefined()
    await expect(page.getByText(/Subtotal|Alaska|contiguous/)).toHaveCount(0)
    const minus = page.getByRole('button', { name: 'Decrease quantity' })
    const plus = page.getByRole('button', { name: 'Increase quantity' })
    await expect(minus).toBeDisabled()
    await plus.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('Selected quantity')).toHaveText('2')
    for (let i = 0; i < 3; i++) await plus.click()
    await expect(page.getByLabel('Selected quantity')).toHaveText('5')
    await expect(plus).toBeDisabled()
    for (let i = 0; i < 4; i++) await minus.click()
    await expect(minus).toBeDisabled()
    await expect(page.getByLabel('Selected quantity')).toHaveText('1')
    await expect(page.getByRole('navigation', { name: 'Store policies' }).getByRole('link')).toHaveCount(5)
    await page.screenshot({ path: testInfo.outputPath('purchase.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })
}

test('low and unknown inventory never invent a stock count', async ({ page }) => {
  await page.goto('/?commerce=low-stock')
  await expect(page.getByText('2 of 500 remaining')).toBeVisible()
  await page.getByRole('button', { name: 'Increase quantity' }).click()
  await expect(page.getByRole('button', { name: 'Increase quantity' })).toBeDisabled()
  await page.goto('/?commerce=unknown-stock')
  await expect(page.getByRole('button', { name: 'Buy now', exact: true })).toBeEnabled()
  await expect(page.getByText(/of 500 remaining/)).toHaveCount(0)
})

test('loading never flashes signup', async ({ page }) => {
  await page.goto('/?commerce=slow')
  await expect(page.getByText('Checking availability…')).toBeVisible()
  await expect(page.getByLabel('Email address')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Buy now', exact: true })).toBeEnabled()
})

for (const scenario of ['error', 'malformed']) {
  test(`${scenario} can retry without claiming sold out`, async ({ page }) => {
    await page.goto(`/?commerce=${scenario}`)
    await expect(page.getByText('Availability could not load. Please try again.')).toBeVisible()
    await expect(page.getByText('Sold out', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Email address')).toHaveCount(0)
    await page.route('**/api/commerce/product?*', route => route.fulfill({ json: fixtureProduct('available') }))
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('button', { name: 'Buy now', exact: true })).toBeEnabled()
  })
}

for (const scenario of ['sold-out', 'closed', 'waitlist']) {
  test(`${scenario} uses parent copy and correct subscription metadata`, async ({ page }) => {
    await page.goto(`/?commerce=${scenario}`)
    await expect(page.getByRole('heading', { name: scenario === 'sold-out' ? 'Get notified about what comes next' : 'Get notified when we drop' })).toBeVisible()
    if (scenario === 'sold-out') {
      await expect(page.getByRole('button', { name: 'Sold out', exact: true })).toBeDisabled()
      await expect(page.getByLabel('Selected quantity')).toHaveText('0')
      await expect(page.getByRole('button', { name: 'Decrease quantity' })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Increase quantity' })).toBeDisabled()
      await expect(page.locator('.stock')).toHaveCSS('text-decoration-line', 'line-through')
      await expect(page.locator('#fulfillment-note')).toHaveCount(0)
    } else {
      await expect(page.getByRole('button', { name: 'Buy now', exact: true })).toHaveCount(0)
    }
    await page.getByLabel('Email address').fill('reader@example.com')
    const sent = page.waitForRequest(request => request.url().endsWith('/api/subscribe'))
    await page.getByRole('button', { name: 'Keep me posted' }).click()
    expect((await sent).postDataJSON()).toEqual({ email: 'reader@example.com', website: '', turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
      ...(scenario === 'sold-out' ? { purpose: 'sold_out' } : {}) })
    await expect(page.locator('.signup-success')).toBeFocused()
  })
}

test('mock checkout receives selected quantity once and cannot place an order', async ({ page }) => {
  let requests = 0
  page.on('request', req => { if (req.url().includes('/api/commerce/checkout')) requests++ })
  await page.goto('/?commerce=checkout-slow')
  await page.getByRole('button', { name: 'Increase quantity' }).click()
  const sent = page.waitForRequest(req => req.url().includes('/api/commerce/checkout'))
  await page.locator('.purchase-form').evaluate(form => {
    for (let i = 0; i < 2; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect((await sent).postDataJSON()).toEqual({ quantity: 2, expectedUnitPrice: { amount: '60.00', currencyCode: 'USD' } })
  await expect(page.getByRole('button', { name: 'Opening checkout…' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Increase quantity' })).toBeDisabled()
  await expect(page.getByRole('heading', { name: 'Mock checkout' })).toBeVisible()
  await expect(page.getByText('2 blankets selected.')).toBeVisible()
  await expect(page.getByText(/No order was placed/)).toBeVisible()
  expect(requests).toBe(1)
  await page.goBack()
  await expect(page.getByRole('button', { name: 'Buy now', exact: true })).toBeEnabled()
})

for (const scenario of ['checkout-error', 'rate-limited', 'unsafe-checkout']) {
  test(`${scenario} preserves quantity and stays on our page`, async ({ page }) => {
    await page.goto(`/?commerce=${scenario}`)
    await page.getByRole('button', { name: 'Increase quantity' }).click()
    await page.getByRole('button', { name: 'Buy now', exact: true }).click()
    await expect(page.locator('.purchase-message')).toContainText(/try again/)
    await expect(page.getByLabel('Selected quantity')).toHaveText('2')
    await expect(page.getByRole('button', { name: 'Buy now', exact: true })).toBeEnabled()
    expect(new URL(page.url()).pathname).toBe('/')
  })
}

test('price change requires a second purchase action', async ({ page }) => {
  await page.goto('/?commerce=price-changed')
  await page.getByRole('button', { name: 'Buy now', exact: true }).click()
  await expect(page.getByText('$64', { exact: true })).toBeVisible()
  await expect(page.locator('.purchase-message')).toContainText('price changed')
  await page.getByRole('button', { name: 'Buy now', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mock checkout' })).toBeVisible()
})

test('stock decrease clamps quantity and announces the adjustment', async ({ page }) => {
  await page.goto('/?commerce=quantity-changed')
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Increase quantity' }).click()
  await page.getByRole('button', { name: 'Buy now', exact: true }).click()
  await expect(page.getByLabel('Selected quantity')).toHaveText('2')
  await expect(page.locator('.purchase-message')).toContainText('Quantity adjusted to 2')
  await expect(page.getByRole('button', { name: 'Increase quantity' })).toBeDisabled()
})

for (const scenario of ['stock-changed', 'sales-closed']) {
  test(`${scenario} refreshes into the correct signup`, async ({ page }) => {
    await page.goto(`/?commerce=${scenario}`)
    await page.getByRole('button', { name: 'Buy now', exact: true }).click()
    await expect(page.getByRole('heading', { name: scenario === 'stock-changed' ? 'Get notified about what comes next' : 'Get notified when we drop' })).toBeFocused()
  })
}

test('checkout timeout requires manual retry and preserves quantity', async ({ page }) => {
  await page.clock.install()
  await page.route('**/api/commerce/checkout?*', () => {})
  await page.goto('/')
  await page.getByRole('button', { name: 'Increase quantity' }).click()
  await page.getByRole('button', { name: 'Buy now', exact: true }).click()
  await page.clock.fastForward(15001)
  await expect(page.locator('.purchase-message')).toContainText('Checkout could not open')
  await expect(page.getByLabel('Selected quantity')).toHaveText('2')
  await expect(page.getByRole('button', { name: 'Buy now', exact: true })).toBeEnabled()
})

test('all policy links work with direct loads and back navigation', async ({ page }) => {
  await page.goto('/')
  const paths = await page.getByRole('navigation', { name: 'Store policies' }).getByRole('link').evaluateAll(links => links.map(a => a.getAttribute('href')!))
  for (const path of paths) {
    await page.goto(path)
    await expect(page.getByText('Local policy draft — not yet published.')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.reload()
    await expect(page.getByText('Local policy draft — not yet published.')).toBeVisible()
    await page.getByRole('link', { name: 'Back to blanket' }).click()
    await expect(page.getByRole('button', { name: 'Buy now', exact: true })).toBeEnabled()
  }
})

test('policy errors are retryable and policy content is escaped', async ({ page }) => {
  await page.route('**/api/commerce/policies/privacy-policy', route => route.fulfill({ status: 503 }))
  await page.goto('/policies/privacy-policy/')
  await expect(page.getByText('This policy is currently unavailable. Please try again.')).toBeVisible()
  await page.route('**/api/commerce/policies/privacy-policy', route => route.fulfill({ json: {
    schemaVersion: 1, policy: { handle: 'privacy-policy', title: 'Privacy Policy', paragraphs: ['<img src=x onerror="window.injected=true">'] },
  } }))
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('main p')).toContainText('<img')
  await expect(page.locator('main p img')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).injected)).toBeUndefined()
})
