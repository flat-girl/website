import { expect, test } from '@playwright/test'
import { createWidgetScript } from '../signup-fixture'

test.beforeEach(async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/**', route => route.fulfill({
    contentType: 'application/javascript', body: createWidgetScript('XXXX.DUMMY.TOKEN.XXXX'),
  }))
})

test('local signup uses the production form and verification flow with the local endpoint', async ({ page }) => {
  const providers: string[] = []
  await page.route(/brevo\.com|flatgirl\.net\/subscribe/, route => {
    providers.push(route.request().url())
    return route.abort()
  })
  await page.goto('/')
  await expect(page.getByText(/Local preview|Test signup/)).toHaveCount(0)
  await expect(page.locator('#signup-privacy')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__signupWidgets?.length)).toBe(1)
  await page.getByLabel('Email address').fill('reader@example.com')
  const response = page.waitForResponse(response => response.url().endsWith('/api/subscribe'))
  await page.getByRole('button', { name: 'Keep me posted', exact: true }).click()
  expect(await (await response).json()).toEqual({ accepted: true })
  await expect(page.getByText('Request received; we will be in touch.')).toBeFocused()
  expect(providers).toEqual([])
})

test('backend rejects an invalid email and allows retry after correction', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Email address').fill('not-an-email')
  const submit = page.getByRole('button', { name: 'Keep me posted', exact: true })
  const response = page.waitForResponse(response => response.url().endsWith('/api/subscribe'))
  await submit.click()
  expect((await response).status()).toBe(400)
  await expect(page.getByRole('alert')).toContainText('Please check your email address and try again.')
  await expect(page.getByLabel('Email address')).toHaveValue('not-an-email')
  await page.getByLabel('Email address').fill('reader@example.com')
  await submit.click()
  await expect(page.getByText('Request received; we will be in touch.')).toBeFocused()
})

test('local endpoint rejects invalid signup input', async ({ request }) => {
  const response = await request.post('/api/subscribe', {
    data: { email: 'invalid', website: '', turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' },
  })
  expect(response.status()).toBe(400)
})

test('local endpoint rejects non-test verification tokens', async ({ request }) => {
  const response = await request.post('/api/subscribe', {
    data: { email: 'reader@example.com', website: '', turnstileToken: 'not-a-test-token' },
  })
  expect(response.status()).toBe(400)
})

for (const scenario of [
  { email: 'rate-limit@example.com', status: 429, message: 'Too many requests right now.' },
  { email: 'verification@example.com', status: 403, message: 'Please complete a new verification and try again.' },
  { email: 'server-error@example.com', status: 503, message: 'We couldn’t confirm your signup.' },
  { email: 'malformed@example.com', status: 200, message: 'We couldn’t confirm your signup.' },
  { email: 'unexpected@example.com', status: 200, message: 'We couldn’t confirm your signup.' },
]) {
  test(`mock scenario ${scenario.email} shows its error and recovers`, async ({ page }) => {
    await page.goto('/')
    const email = page.getByLabel('Email address')
    const submit = page.getByRole('button', { name: 'Keep me posted', exact: true })
    await email.fill(scenario.email)
    const response = page.waitForResponse(response => response.url().endsWith('/api/subscribe'))
    await submit.click()
    expect((await response).status()).toBe(scenario.status)
    await expect(page.getByRole('alert')).toContainText(scenario.message)
    await expect(email).toHaveValue(scenario.email)
    await email.fill('reader@example.com')
    await expect(page.getByRole('alert')).toBeEmpty()
    await submit.click()
    await expect(page.getByText('Request received; we will be in touch.')).toBeFocused()
  })
}

test('mock timeout reaches the browser abort and allows retry', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await page.getByLabel('Email address').fill('timeout@example.com')
  const submit = page.getByRole('button', { name: 'Keep me posted', exact: true })
  const sent = page.waitForRequest(request => request.url().endsWith('/api/subscribe'))
  await submit.click()
  await sent
  await expect(page.getByRole('button', { name: 'Submitting…' })).toBeDisabled()
  await page.clock.fastForward(18001)
  await expect(page.getByRole('alert')).toContainText('We couldn’t confirm your signup.')
  await expect(page.getByLabel('Email address')).toHaveValue('timeout@example.com')
  await page.getByLabel('Email address').fill('reader@example.com')
  await submit.click()
  await expect(page.getByText('Request received; we will be in touch.')).toBeFocused()
})

test('mock addresses are matched after trimming and normalizing case', async ({ request }) => {
  const response = await request.post('/api/subscribe', {
    data: { email: '  RATE-LIMIT@EXAMPLE.COM  ', website: '', turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' },
  })
  expect(response.status()).toBe(429)
})
