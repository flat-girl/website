import { test, expect } from '@playwright/test'
import { createShopifyCommerce, policyParagraphs } from '../../shared/utils/shopify'

const variant = 'gid://shopify/ProductVariant/68124854681876'
const product = 'gid://shopify/Product/15491665297684'
const productData = ({ price = { amount: '60.0', currencyCode: 'USD' }, ...extra }:
  { price?: { amount: string; currencyCode: string }; [key: string]: unknown } = {}) => ({ product: {
  id: product, title: 'Blanket', availableForSale: true, totalInventory: 499,
  priceRange: { minVariantPrice: price, maxVariantPrice: price }, ...extra,
} })
const cartData = (extra = {}) => ({ cartCreate: { userErrors: [], warnings: [], cart: {
  checkoutUrl: 'https://flatgirl.myshopify.com/checkouts/example', totalQuantity: 2,
  lines: { nodes: [{ quantity: 2, merchandise: { id: variant } }] },
  cost: { subtotalAmount: { amount: '120.0', currencyCode: 'USD' } }, ...extra,
} } })
const input = { quantity: 2, expectedUnitPrice: { amount: '60.00', currencyCode: 'USD' } }
function adapter(responses: unknown[]) {
  const calls: { url: string; options: RequestInit }[] = []
  const fetcher = (async (url, options) => {
    calls.push({ url: String(url), options: options! })
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next instanceof Response ? next : Response.json({ data: next })
  }) as typeof fetch
  return { api: createShopifyCommerce('test-private-token', fetcher), calls }
}

test('product request uses private header, pinned endpoint and normalized cents', async () => {
  const { api, calls } = adapter([productData()])
  const result = await api.readProduct()
  expect(result.product.price).toEqual({ amount: '60.00', currencyCode: 'USD' })
  expect(result.product.quantityAvailable).toBe(499)
  expect(calls[0]?.url).toBe('https://tepwtx-zw.myshopify.com/api/2026-10/graphql.json')
  expect(calls[0]?.options.headers).toHaveProperty('Shopify-Storefront-Private-Token', 'test-private-token')
  expect(calls[0]?.options.redirect).toBe('error')
  const request = JSON.parse(String(calls[0]?.options.body))
  expect(request.variables).toEqual({ id: product })
  expect(request.query).toContain('product(id: $id)')
  expect(request.query).toContain('totalInventory')
  expect(request.query).not.toContain('quantityAvailable')
  expect(request.query).not.toContain('variants(')
  expect(request.query).not.toContain('ProductVariant')
  expect(result.product).not.toHaveProperty('variantId')
})

test('product inventory and price load without any variant data', async () => {
  const data = productData({ totalInventory: 425 })
  const result = (await adapter([data]).api.readProduct()).product
  expect(result.quantityAvailable).toBe(425)
  expect(result.price).toEqual({ amount: '60.00', currencyCode: 'USD' })
})

test('unknown product inventory stays unknown and invalid inventory fails closed', async () => {
  expect((await adapter([productData({ totalInventory: null })]).api.readProduct()).product.quantityAvailable).toBeNull()
  for (const totalInventory of [-1, 1.5, '425', undefined]) {
    await expect(adapter([productData({ totalInventory })]).api.readProduct())
      .rejects.toMatchObject({ code: 'INVALID_SHOPIFY_RESPONSE' })
  }
})

test('missing or differing product prices fail closed', async () => {
  for (const priceRange of [undefined, {}, {
    minVariantPrice: { amount: '60.00', currencyCode: 'USD' },
    maxVariantPrice: { amount: '65.00', currencyCode: 'USD' },
  }]) {
    await expect(adapter([productData({ priceRange })]).api.readProduct())
      .rejects.toMatchObject({ code: 'INVALID_SHOPIFY_RESPONSE' })
  }
})

test('public access uses only the browser-safe header for product, rich policy and checkout', async () => {
  const responses = [productData(), { shop: { policy: { title: 'Returns', body: '<p>Sales are <strong>final</strong>.</p>' } } }, productData(), cartData()]
  const fetcher = (async (_url, options) => {
    expect(options?.headers).toEqual({ 'content-type': 'application/json', 'X-Shopify-Storefront-Access-Token': 'test-public-token' })
    return Response.json({ data: responses.shift() })
  }) as typeof fetch
  const api = createShopifyCommerce('test-public-token', fetcher, 'public')
  expect((await api.readProduct()).product.price.amount).toBe('60.00')
  expect(JSON.stringify((await api.readPolicy('refund-policy')).policy?.content)).toContain('strong')
  expect((await api.createCheckout(input)).checkoutUrl).toBe('https://flatgirl.myshopify.com/checkouts/example')
  expect(responses).toHaveLength(0)
})

test('rejected public token fails without retrying with private access', async () => {
  let requests = 0
  const fetcher = (async (_url, options) => {
    requests++
    expect(options?.headers).not.toHaveProperty('Shopify-Storefront-Private-Token')
    return new Response('', { status: 403 })
  }) as typeof fetch
  await expect(createShopifyCommerce('invalid-public-token', fetcher, 'public').readPolicy('privacy-policy'))
    .rejects.toMatchObject({ code: 'SHOPIFY_AUTH_FAILED' })
  expect(requests).toBe(1)
})

test('HTML policies preserve entities, lists and useful links as escaped text', () => {
  expect(policyParagraphs('<h2>Privacy &amp; cookies</h2><p>Contact <a href="mailto:hi@example.com">us</a>.<br>Thanks&nbsp;all.</p><ol><li>First</li><li>Second</li></ol><script>alert(1)</script><style>bad</style>')).toEqual([
    'Privacy & cookies', 'Contact us (mailto:hi@example.com).\nThanks all.', '1. First\n\n2. Second',
  ].flatMap(p => p.split('\n\n')))
  expect(policyParagraphs('<p>&lt;img src=x onerror=bad&gt; <a href="javascript:bad()">Text</a></p>')).toEqual(['<img src=x onerror=bad> Text'])
})

test('policy fields are allowlisted and missing Shopify policies stay missing', async () => {
  const { api, calls } = adapter([{ shop: { policy: { title: 'Privacy', body: '<p>Our policy.</p>' } } }, { shop: { policy: null } }])
  expect((await api.readPolicy('privacy-policy')).policy?.paragraphs).toEqual(['Our policy.'])
  expect(JSON.parse(String(calls[0]?.options.body)).query).toContain('policy: privacyPolicy')
  expect((await api.readPolicy('refund-policy')).policy).toBeNull()
  await expect(api.readPolicy('privacyPolicy { id }')).rejects.toMatchObject({ status: 404 })
  expect(calls).toHaveLength(2)
})

test('checkout validates authoritative quantity, variant, subtotal and returned host', async () => {
  const { api, calls } = adapter([productData(), cartData()])
  expect(await api.createCheckout(input)).toEqual({ checkoutUrl: 'https://flatgirl.myshopify.com/checkouts/example' })
  expect(calls).toHaveLength(2)
  expect(JSON.parse(String(calls[1]?.options.body)).variables.input).toEqual({
    lines: [{ merchandiseId: variant, quantity: 2 }], buyerIdentity: { countryCode: 'US' },
  })
})

test('branded checkout preserves the returned path and query and keeps the API host', async () => {
  const checkoutUrl = 'https://shopify.flatgirl.net/checkouts/example?key=fixture-key'
  const { api, calls } = adapter([productData(), cartData({ checkoutUrl })])
  expect(await api.createCheckout(input)).toEqual({ checkoutUrl })
  expect(calls.every(call => call.url === 'https://tepwtx-zw.myshopify.com/api/2026-10/graphql.json')).toBe(true)
})

for (const [extra, code] of [
  [{ totalInventory: 0 }, 'SOLD_OUT'],
  [{ totalInventory: 1 }, 'QUANTITY_UNAVAILABLE'],
  [{ price: { amount: '61.00', currencyCode: 'USD' } }, 'PRICE_CHANGED'],
] as const) {
  test(`checkout avoids cart creation on ${code}`, async () => {
    const { api, calls } = adapter([productData(extra)])
    await expect(api.createCheckout(input)).rejects.toMatchObject({ status: 409, code })
    expect(calls).toHaveLength(1)
  })
}

test('invalid quantity and missing token never send a Shopify request', async () => {
  const { api, calls } = adapter([])
  for (const quantity of [0, 6, 1.5, '2']) await expect(api.createCheckout({ ...input, quantity })).rejects.toMatchObject({ status: 400 })
  expect(calls).toHaveLength(0)
  await expect(createShopifyCommerce('').readProduct()).rejects.toMatchObject({ code: 'SHOPIFY_NOT_CONFIGURED' })
})

for (const [extra, code] of [
  [{ checkoutUrl: 'http://shopify.flatgirl.net/checkouts/example' }, 'INVALID_CHECKOUT_URL'],
  [{ checkoutUrl: 'https://shopify.flatgirl.net.evil.example/checkouts/example' }, 'INVALID_CHECKOUT_URL'],
  [{ checkoutUrl: 'https://user@shopify.flatgirl.net/checkouts/example' }, 'INVALID_CHECKOUT_URL'],
  [{ checkoutUrl: 'https://shopify.flatgirl.net:8443/checkouts/example' }, 'INVALID_CHECKOUT_URL'],
  [{ checkoutUrl: 'https://untrusted.example/checkouts/example' }, 'INVALID_CHECKOUT_URL'],
  [{ checkoutUrl: 'http://flatgirl.myshopify.com/checkout' }, 'INVALID_CHECKOUT_URL'],
  [{ checkoutUrl: 'https://flatgirl.myshopify.com.evil.example/checkout' }, 'INVALID_CHECKOUT_URL'],
  [{ checkoutUrl: 'https://user:pass@flatgirl.myshopify.com/checkout' }, 'INVALID_CHECKOUT_URL'],
  [{ totalQuantity: 1 }, 'UNAVAILABLE'],
  [{ cost: { subtotalAmount: { amount: '60', currencyCode: 'USD' } } }, 'PRICE_CHANGED'],
] as const) {
  test(`cart validation rejects ${JSON.stringify(extra)}`, async () => {
    const { api } = adapter([productData(), cartData(extra)])
    await expect(api.createCheckout(input)).rejects.toMatchObject({ code })
  })
}

test('cart warnings and ambiguous transport errors do not retry or expose request details', async () => {
  const warning = cartData()
  const warned = { ...warning, cartCreate: { ...warning.cartCreate, warnings: [{ code: 'MERCHANDISE_NOT_ENOUGH_STOCK' }] } }
  await expect(adapter([productData(), warned]).api.createCheckout(input)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  const { api, calls } = adapter([productData(), new Error('request contained test-private-token')])
  await expect(api.createCheckout(input)).rejects.toMatchObject({ message: 'UNAVAILABLE' })
  expect(calls).toHaveLength(2)
})

test('HTTP and GraphQL errors are bounded, redacted failures', async () => {
  await expect(adapter([new Response('secret', { status: 401 })]).api.readProduct()).rejects.toMatchObject({ code: 'SHOPIFY_AUTH_FAILED' })
  await expect(adapter([Response.json({ errors: [{ message: 'test-private-token' }] })]).api.readProduct()).rejects.toMatchObject({ message: 'INVALID_SHOPIFY_RESPONSE' })
  await expect(adapter([{ node: {} }]).api.readProduct()).rejects.toMatchObject({ code: 'INVALID_SHOPIFY_RESPONSE' })
})
