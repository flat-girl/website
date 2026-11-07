import { expect } from '@playwright/test'
import { test, installImageFixture } from './image-fixture'
import { signupEndpoint, widgetScript } from './signup-fixture'

test('signup form is always visible', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Notify me when it drops', exact: true })).toBeVisible()
})

test.describe('signup submission', () => {
  test.skip(process.env.FLAT_GIRL_TEST_SIGNUP !== 'true', 'Run npm run test:signup for the fixture API endpoint')
  for (const width of [375, 1280]) {
    test(`simple accessible signup at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      let sent: any
      await page.addInitScript(() => {
        const original = window.fetch
        ;(window as any).__signupCredentials = []
        window.fetch = (input, init) => {
          if (String(input).endsWith('/subscribe')) (window as any).__signupCredentials.push(init?.credentials)
          return original(input, init)
        }
      })
      await page.route(signupEndpoint, async route => {
        sent = route.request().postDataJSON()
        expect(route.request().headers().authorization).toBeUndefined()
        await route.fulfill({ json: { accepted: true } })
      })
      await page.goto('/')
      await expect(page.getByText(/Local preview|Test signup/)).toHaveCount(0)
      await expect(page.locator('#signup-privacy')).toBeVisible()
      await expect(page.getByRole('checkbox')).toHaveCount(0)
      await expect(page.getByText(/Submit your email to get/)).toBeVisible()
      await page.getByLabel('Email address').fill('reader@example.com')
      const submit = page.getByRole('button', { name: 'Notify me when it drops', exact: true })
      await expect(submit).toBeEnabled()
      await page.getByLabel('Email address').scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath('signup.png'), fullPage: true })
      await submit.focus(); await page.keyboard.press('Enter')
      await expect(page.getByText('Thanks—your notification request has been received.')).toBeFocused()
      expect(sent).toEqual({ email: 'reader@example.com', website: '', turnstileToken: 'fixture-token-0' })
      expect(await page.evaluate(() => (window as any).__signupCredentials)).toEqual(['include'])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
  }

  test('provider failure preserves email and uses a fresh token on manual retry', async ({ page }) => {
    const bodies: any[] = []
    await page.route(signupEndpoint, async route => {
      bodies.push(route.request().postDataJSON())
      await route.fulfill(bodies.length === 1 ? { status: 503, body: 'Unavailable' } : { json: { accepted: true } })
    })
    await page.goto('/')
    await page.getByLabel('Email address').fill('reader@example.com')
    await page.getByRole('button', { name: 'Notify me when it drops', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('couldn’t confirm')
    await expect(page.getByLabel('Email address')).toHaveValue('reader@example.com')
    await page.getByRole('button', { name: 'Notify me when it drops', exact: true }).click()
    await expect(page.getByText('Thanks—your notification request has been received.')).toBeVisible()
    expect(bodies.map(b => b.turnstileToken)).toEqual(['fixture-token-0', 'fixture-token-1'])
  })

  test('expiry disables submission and stale widget callbacks cannot restore old tokens', async ({ page }) => {
    await page.goto('/')
    const submit = page.getByRole('button', { name: 'Notify me when it drops', exact: true })
    await expect(submit).toBeEnabled()
    await page.evaluate(() => (window as any).__signupWidgets[0]['expired-callback']())
    await expect(submit).toBeDisabled()
    await page.getByRole('button', { name: 'Retry verification' }).click()
    await expect(submit).toBeEnabled()
    await page.evaluate(() => (window as any).__signupWidgets[0]['error-callback']())
    await expect(submit).toBeEnabled()
  })

  test('blocked widget script can be retried', async ({ page }) => {
    let attempts = 0
    await page.route('https://challenges.cloudflare.com/**', async route => {
      if (++attempts === 1) await route.abort()
      else await route.fulfill({ contentType: 'application/javascript', body: widgetScript })
    })
    await page.goto('/')
    await expect(page.getByText(/Verification could not load/)).toBeVisible()
    await page.getByRole('button', { name: 'Retry verification' }).click()
    await expect(page.getByRole('button', { name: 'Notify me when it drops', exact: true })).toBeEnabled()
    expect(attempts).toBe(2)
  })

  test('double submit makes one request and does not promise a new subscription', async ({ page }) => {
    let requests = 0, release: () => void = () => {}
    const pending = new Promise<void>(resolve => { release = resolve })
    await page.route(signupEndpoint, async route => { requests++; await pending; await route.fulfill({ json: { accepted: true } }) })
    await page.goto('/')
    await page.getByLabel('Email address').fill('reader@example.com')
    await expect(page.getByRole('button', { name: 'Notify me when it drops', exact: true })).toBeEnabled()
    await page.locator('form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await expect(page.getByRole('button', { name: 'Submitting…' })).toBeDisabled()
    await expect.poll(() => requests).toBe(1)
    release()
    await expect(page.getByText('Thanks—your notification request has been received.')).toBeVisible()
    expect(requests).toBe(1)
  })

  test('gateway throttles and unexpected success bodies show errors', async ({ page }) => {
    let attempts = 0
    await page.route(signupEndpoint, route => route.fulfill(++attempts === 1 ? { status: 429, body: 'Rate exceeded' } : { json: { accepted: false } }))
    await page.goto('/')
    await page.getByLabel('Email address').fill('reader@example.com')
    await page.getByRole('button', { name: 'Notify me when it drops', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('wait a minute')
    await page.getByRole('button', { name: 'Notify me when it drops', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('couldn’t confirm')
    await expect(page.getByLabel('Email address')).toHaveValue('reader@example.com')
  })

  test('browser timeout preserves input and offers a new verification', async ({ page }) => {
    await page.clock.install()
    await page.route(signupEndpoint, () => {})
    await page.goto('/')
    await page.getByLabel('Email address').fill('reader@example.com')
    await page.getByRole('button', { name: 'Notify me when it drops', exact: true }).click()
    await page.clock.fastForward(18001)
    await expect(page.getByRole('alert')).toContainText('couldn’t confirm')
    await expect(page.getByLabel('Email address')).toHaveValue('reader@example.com')
    await expect(page.getByRole('button', { name: 'Notify me when it drops', exact: true })).toBeEnabled()
  })

  test('without JavaScript the form explains the requirement and cannot submit', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false })
    await installImageFixture(context)
    const page = await context.newPage()
    await page.goto('/')
    await expect(page.getByText('Please enable JavaScript to sign up for the notification.')).toBeVisible()
    await expect(page.getByLabel('Email address')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Notify me when it drops', exact: true })).toBeDisabled()
    await context.close()
  })
})
