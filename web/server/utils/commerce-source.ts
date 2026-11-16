import { setResponseStatus, setHeader, createError, type H3Event } from 'h3'
import { createShopifyCommerce, CommerceError } from '../../shared/utils/shopify'

export function shopifySource(event: H3Event) {
  const config = useRuntimeConfig(event)
  setHeader(event, 'x-flatgirl-commerce-source', config.public.commerceSource)
  if (config.public.commerceSource === 'local') return null
  if (config.public.commerceSource !== 'shopify') throw createError({ statusCode: 500, statusMessage: 'Invalid commerce source' })
  return config.public.shopifyStorefrontPublicToken
    ? createShopifyCommerce(config.public.shopifyStorefrontPublicToken, fetch, 'public')
    : createShopifyCommerce(config.shopifyStorefrontToken)
}

export async function commerceResult<T>(event: H3Event, operation: () => Promise<T>) {
  try { return await operation() } catch (error) {
    setResponseStatus(event, error instanceof CommerceError ? error.status : 503)
    return { error: { code: error instanceof CommerceError ? error.code : 'UNAVAILABLE' } }
  }
}
