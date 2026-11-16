// A public token selects direct browser access for every commerce operation.
// Errors never fall back to the private-token server route.
export function useCommerceRequest() {
  const config = useRuntimeConfig().public
  return async function commerceRequest(path: string, endpoint: () => string, init: RequestInit = {}) {
    if (config.commerceSource !== 'shopify' || !config.shopifyStorefrontPublicToken) {
      return fetch(endpoint(), init)
    }
    const { createShopifyCommerce, CommerceError } = await import('#shared/utils/shopify')
    const fetcher: typeof fetch = (url, options) => fetch(url, {
      ...options,
      signal: init.signal && options?.signal
        ? AbortSignal.any([init.signal, options.signal]) : options?.signal,
      cache: 'no-store', credentials: 'omit',
    })
    const api = createShopifyCommerce(config.shopifyStorefrontPublicToken, fetcher, 'public')
    try {
      if (path === 'product') return Response.json(await api.readProduct())
      if (path === 'checkout') return Response.json(await api.createCheckout(JSON.parse(String(init.body))), { status: 201 })
      if (path.startsWith('policies/')) {
        const result = await api.readPolicy(decodeURIComponent(path.slice('policies/'.length)))
        return Response.json(result, { status: result.policy ? 200 : 404 })
      }
      throw new CommerceError(404, 'NOT_FOUND')
    } catch (error) {
      return Response.json({ error: { code: error instanceof CommerceError ? error.code : 'UNAVAILABLE' } },
        { status: error instanceof CommerceError ? error.status : 503 })
    }
  }
}
