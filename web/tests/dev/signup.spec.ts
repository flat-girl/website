import { expect, test } from '@playwright/test'

test('local signup submits to the mock without contacting providers', async ({ page }) => {
  const providers: string[] = []
  await page.route(/challenges\.cloudflare\.com|brevo\.com|flatgirl\.net\/subscribe/, route => {
    providers.push(route.request().url())
    return route.abort()
  })
  await page.goto('/')
  await expect(page.getByText('Local preview — signups are simulated; no email is sent.')).toBeVisible()
  await page.getByLabel('Email address').fill('reader@example.com')
  const response = page.waitForResponse(response => response.url().endsWith('/api/subscribe'))
  await page.getByRole('button', { name: 'Notify me when it drops', exact: true }).click()
  expect(await (await response).json()).toEqual({ accepted: true })
  await expect(page.getByText('Thanks—your notification request has been received.')).toBeFocused()
  expect(providers).toEqual([])
})

test('local signup can retry after an API failure', async ({ page }) => {
  await page.route('**/api/subscribe', route => route.fulfill({ status: 503, body: 'Unavailable' }), { times: 1 })
  await page.goto('/')
  await page.getByLabel('Email address').fill('reader@example.com')
  const submit = page.getByRole('button', { name: 'Notify me when it drops', exact: true })
  await submit.click()
  await expect(page.getByRole('alert')).toContainText('couldn’t confirm')
  await expect(page.getByLabel('Email address')).toHaveValue('reader@example.com')
  await submit.click()
  await expect(page.getByText('Thanks—your notification request has been received.')).toBeVisible()
})

test('local endpoint rejects invalid signup input', async ({ request }) => {
  const response = await request.post('/api/subscribe', {
    data: { email: 'invalid', website: '', turnstileToken: 'local-signup-1' },
  })
  expect(response.status()).toBe(400)
})
