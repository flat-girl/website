import { fixtureProduct } from '../../utils/commerce-fixtures'
import { previewStockOverride } from '../../../shared/utils/shopify'
import { shopifySource, commerceResult } from '../../utils/commerce-source'

export default defineEventHandler(async event => {
  if (!import.meta.dev) throw createError({ statusCode: 404 })
  setHeader(event, 'cache-control', 'no-store')
  const stockOverride = previewStockOverride(getRequestURL(event))
  const shopify = shopifySource(event, stockOverride)
  if (shopify) return commerceResult(event, () => shopify.readProduct())
  const query = getQuery(event)
  const scenario = String(query.scenario || 'available')
  if (scenario === 'slow') await new Promise(resolve => setTimeout(resolve, 2000))
  if (scenario === 'timeout') await new Promise(resolve => setTimeout(resolve, 12000))
  if (scenario === 'error') {
    setResponseStatus(event, 503)
    return { error: { code: 'UNAVAILABLE' } }
  }
  if (scenario === 'malformed') return { schemaVersion: 1, product: { price: '60' } }
  return fixtureProduct(scenario, query.updated === '1', stockOverride)
})
