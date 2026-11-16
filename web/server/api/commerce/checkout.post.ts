import { fixtureProduct } from '../../utils/commerce-fixtures'
import { shopifySource, commerceResult } from '../../utils/commerce-source'

export default defineEventHandler(async event => {
  if (!import.meta.dev) throw createError({ statusCode: 404 })
  setHeader(event, 'cache-control', 'no-store')
  const shopify = shopifySource(event)
  if (shopify) return commerceResult(event, async () => {
    const result = await shopify.createCheckout(await readBody(event))
    setResponseStatus(event, 201)
    return result
  })
  const query = getQuery(event)
  const scenario = String(query.scenario || 'available')
  const body = await readBody(event)
  function error(status: number, code: string) {
    setResponseStatus(event, status)
    return { error: { code } }
  }
  if (!body || !Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 5
    || body.expectedUnitPrice?.currencyCode !== 'USD' || typeof body.expectedUnitPrice?.amount !== 'string') {
    return error(400, 'INVALID_REQUEST')
  }
  if (scenario === 'checkout-slow') await new Promise(resolve => setTimeout(resolve, 2000))
  if (scenario === 'checkout-timeout') await new Promise(resolve => setTimeout(resolve, 17000))
  if (scenario === 'checkout-error') return error(503, 'UNAVAILABLE')
  if (scenario === 'rate-limited') return error(429, 'RATE_LIMITED')
  const data = fixtureProduct(scenario, true)
  if (!data.salesOpen) return error(403, 'SALES_CLOSED')
  if (!data.product.availableForSale) return error(409, 'SOLD_OUT')
  if (body.quantity > (data.product.quantityAvailable ?? 5)) return error(409, 'QUANTITY_UNAVAILABLE')
  if (body.expectedUnitPrice.amount !== data.product.price.amount) return error(409, 'PRICE_CHANGED')
  setResponseStatus(event, 201)
  if (scenario === 'unsafe-checkout') return { checkoutUrl: 'https://flatgirl.myshopify.com/checkout' }
  return { checkoutUrl: `/api/commerce/mock-checkout?quantity=${body.quantity}` }
})
