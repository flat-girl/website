import type { FullConfig } from '@playwright/test'

// Refuse before any test can submit Buy now against an operator's live preview.
export default async function requireLocalCommerce(config: FullConfig) {
  const base = config.projects[0]?.use.baseURL
  const response = await fetch(`${base}/api/commerce/product`, { signal: AbortSignal.timeout(10000) })
  if (response.headers.get('x-flatgirl-commerce-source') !== 'local') {
    throw new Error('Dev browser tests require FLAT_GIRL_COMMERCE_SOURCE=local. Switch the source and restart Nuxt; no checkout tests were run.')
  }
}
